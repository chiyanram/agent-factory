import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Result } from "../src/core/forge/api.js";
import { dryNotify, notifyPluginOf, pingPost, pluginNotify, webhookSecrets } from "../src/core/notify.js";
import { renderPost } from "../src/core/post.js";
import { makeFakes } from "../src/core/plugin/fakes.js";
import { addPlugin, type Setup } from "../src/core/plugin/registry.js";
import { checkWebhook, saveDiscordWebhook, secret, type TokenStore } from "../src/core/token/index.js";
import { tempDir } from "./temp.js";

const BUNDLED = join(import.meta.dirname, "..", "plugins", "discord", "plugin");
const NODE_DIR = dirname(process.execPath);
const HOOK = "https://discord.com/api/webhooks/1234567890/abcdefghijklmnopqrstuvwxyz_-0123";

let root = "";
let home = "";
beforeEach(() => {
  root = tempDir("factory-notify-");
  home = join(root, "home");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

// a token store in memory: what was put, and what get answers
function memoryStore(held: Record<string, string> = {}): TokenStore {
  return {
    where: "memory",
    put: async ({ runner, token }) => {
      held[runner] = token.reveal();
      return { kind: "ok" };
    },
    get: async (runner) =>
      held[runner] === undefined
        ? { kind: "missing", reason: `no ${runner} token; run: agent-factory setup ${runner}` }
        : { kind: "found", token: secret(held[runner]), meta: { madeAt: "", expiresAt: "" } },
  };
}

const ok = <T>(value: T): Result<T> => ({ kind: "ok", value });

function rendered(ping: Parameters<typeof pingPost>[1]): string {
  const text = renderPost(pingPost(WHERE, ping));
  return text.kind === "ok" ? text.text : "";
}
const WHERE = { project: "ledger", mark: "#" };

describe("the Discord webhook in the token store (#119)", () => {
  it("takes only a Discord webhook URL, and never quotes what was pasted", () => {
    expect(checkWebhook(` ${HOOK}\n`)).toMatchObject({ kind: "ok" });
    for (const bad of [
      "",
      "https://evil.example/api/webhooks/1/abcdefghijklmnopqrstuvwxyz",
      `${HOOK}?wait=true`,
      "ghp_x",
    ]) {
      const checked = checkWebhook(bad);
      expect(checked).toMatchObject({ kind: "refused" });
      expect(checked.kind === "refused" && bad !== "" && checked.reason.includes(bad)).toBe(false);
    }
  });

  it("is stored under its own name, and handed only to the discord plugin's notify calls", async () => {
    const held: Record<string, string> = {};
    const store = memoryStore(held);
    expect(await saveDiscordWebhook({ store, pasted: HOOK, now: new Date("2026-11-08T00:00:00Z") })).toMatchObject({
      kind: "saved",
      meta: { expiresAt: "9999-12-31T00:00:00.000Z" },
    });
    expect(held.discord).toBe(HOOK);
    const secrets = webhookSecrets(ok(store), BUNDLED);
    const real = realpathSync(BUNDLED);
    const given = await secrets({ plugin: "discord", capability: "notify", source: real });
    expect(given.kind === "ok" && given.value.webhook?.reveal()).toBe(HOOK);
    // a Secret never prints
    expect(given.kind === "ok" && JSON.stringify(given.value)).toBe('{"webhook":"[secret]"}');
    expect(await secrets({ plugin: "discord", capability: "context.read", source: real })).toEqual({
      kind: "ok",
      value: {},
    });
    // a plugin of any name added from another file is never handed it, though it calls itself discord
    expect(await secrets({ plugin: "discord", capability: "notify", source: "/home/x/discord/plugin" })).toEqual({
      kind: "ok",
      value: {},
    });
    expect(
      await webhookSecrets(ok(memoryStore()), BUNDLED)({ plugin: "discord", capability: "notify", source: real }),
    ).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("setup discord"),
    });
  });
});

describe("the pings (#119)", () => {
  it("are posting templates: no mention, reference or link forms, whatever the reason says", () => {
    const post = pingPost(WHERE, {
      kind: "needs-you",
      ticket: "PROJ-1",
      change: 12,
      why: "@everyone see https://x.io #3",
    });
    const text = renderPost(post);
    expect(text.kind === "ok" && text.text).toBe(
      "[coordinator] PROJ-1 needs you: @⁠everyone see https:⁠//x.io #⁠3\n\n- project: ledger\n- change: #⁠12",
    );
    expect(renderPost(pingPost(WHERE, { kind: "asked", ticket: "PROJ-2", change: "none" }))).toMatchObject({
      text: expect.stringContaining("- change: no change yet"),
    });
  });

  it("go out through the bundled discord plugin: the text on curl's stdin, the webhook in no argv and no answer", async () => {
    const fakes = await makeFakes(["curl"], [{ code: 0, stdout: "", stderr: "" }]);
    if (fakes.kind === "failed") {
      throw new Error(fakes.reason);
    }
    try {
      const setup: Setup = {
        home,
        env: { HOME: root, LANG: "C" },
        path: `${fakes.value.dir}:${NODE_DIR}`,
        secrets: webhookSecrets(ok(memoryStore({ discord: HOOK })), BUNDLED),
      };
      expect((await addPlugin(setup, BUNDLED)).kind).toBe("ok");
      const notify = pluginNotify({ setup, plugin: "discord", ...WHERE });
      const ping = { kind: "ready", ticket: "PROJ-3", change: 14, head: "1".repeat(40) } as const;
      expect(await notify(ping)).toEqual({ kind: "ok" });
      const calls = await fakes.value.calls();
      expect(calls).toHaveLength(1);
      const [call] = calls;
      expect(JSON.parse(String(call?.stdin))).toEqual({ content: rendered(ping), allowed_mentions: { parse: [] } });
      expect(call?.argv[0]).toBe("--disable");
      expect(call?.argv).toContain("--config");
      expect(JSON.stringify(call)).not.toContain(HOOK);
    } finally {
      await fakes.value.remove();
    }
  });

  it("fail with the reason, never the webhook, when there is none or curl fails", async () => {
    const fakes = await makeFakes(
      ["curl"],
      [{ code: 22, stdout: "", stderr: `curl: (22) POST ${new URL(HOOK).pathname} returned 404\n` }],
    );
    if (fakes.kind === "failed") {
      throw new Error(fakes.reason);
    }
    try {
      const base = { home, env: { HOME: root, LANG: "C" }, path: `${fakes.value.dir}:${NODE_DIR}` };
      expect((await addPlugin(base, BUNDLED)).kind).toBe("ok");
      const none = pluginNotify({
        setup: { ...base, secrets: webhookSecrets(ok(memoryStore()), BUNDLED) },
        plugin: "discord",
        ...WHERE,
      });
      expect(await none({ kind: "asked", ticket: "PROJ-1", change: 12 })).toMatchObject({
        kind: "failed",
        reason: expect.stringContaining("no Discord webhook"),
      });
      const held = { discord: HOOK };
      const refused = pluginNotify({
        setup: { ...base, secrets: webhookSecrets(ok(memoryStore(held)), BUNDLED) },
        plugin: "discord",
        ...WHERE,
      });
      const sent = await refused({ kind: "asked", ticket: "PROJ-1", change: 12 });
      expect(sent).toMatchObject({ kind: "failed", reason: expect.stringContaining("curl exited 22") });
      expect(JSON.stringify(sent)).not.toContain(HOOK);
      expect(JSON.stringify(sent)).not.toContain("abcdefghijklmnopqrstuvwxyz_-0123");
    } finally {
      await fakes.value.remove();
    }
  });

  it("print instead of sending under a dry run, and come from the project file's notify plugin", async () => {
    const lines: string[] = [];
    expect(await dryNotify((l) => lines.push(l))({ kind: "asked", ticket: "PROJ-1", change: 12 })).toEqual({
      kind: "ok",
    });
    expect(lines).toEqual(["DRY RUN: notify: PROJ-1: the writer asked a question that waits on you"]);
    expect(await notifyPluginOf({ home, project: "ledger" })).toEqual({ kind: "ok", value: "" });
    mkdirSync(join(home, "projects"), { recursive: true });
    writeFileSync(join(home, "projects", "ledger.json"), JSON.stringify({ connectors: { notify: "discord" } }));
    expect(await notifyPluginOf({ home, project: "ledger" })).toEqual({ kind: "ok", value: "discord" });
  });
});
