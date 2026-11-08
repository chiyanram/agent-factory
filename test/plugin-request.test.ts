import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { approve } from "../src/core/approval.js";
import { DEFAULT_POLICY, pluginConfigOf, readPluginConfig } from "../src/core/plugin/config.js";
import { callPlugin, addPlugin, type Setup } from "../src/core/plugin/registry.js";
import { confirm, quoted, request, shown } from "../src/core/plugin/request.js";
import { onTicket, readLog } from "../src/core/plugin/writes.js";
import { readProjectFile } from "../src/core/project.js";
import { specHash } from "../src/core/spec.js";
import { REQUEST_COMMANDS } from "../src/request-cli.js";

const SPEC = [
  "# PROJ-1: renewals refuse a reserved loan",
  "",
  "## Intent",
  "",
  "A member cannot renew a loan someone else has reserved.",
  "",
  "## Acceptance criteria",
  "",
  "1. Renewing a reserved loan answers 409 Conflict.",
  "",
  "## Design",
  "",
  "none",
  "",
  "## Lane",
  "",
  "bug",
  "",
].join("\n");

let root = "";
let home = "";
let sent = "";
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "factory-request-"));
  home = join(root, "home");
  sent = join(root, "sent.jsonl");
  mkdirSync(join(home, "specs", "ledger", "PROJ-1"), { recursive: true });
  writeFileSync(join(home, "specs", "ledger", "PROJ-1", "spec.md"), SPEC);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const setup = (): Setup => ({ home, env: { HOME: "/h", LANG: "C", TRACK_LOG: sent }, path: process.env.PATH ?? "" });

const TRACKER = {
  protocol: 1,
  name: "tracker",
  version: "1.0.0",
  capabilities: [{ name: "tracker.comment" }, { name: "tracker.create" }, { name: "notify" }],
  writes: ["tracker.comment", "tracker.create", "notify"],
  env: ["TRACK_LOG"],
};

// a plugin that appends each request to TRACK_LOG and answers done, or failed when the text says FAIL
function plugin(name: string, described: unknown = TRACKER): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "plugin");
  writeFileSync(
    path,
    `#!${process.execPath}
const fs = require("node:fs");
const out = (v) => process.stdout.write(JSON.stringify(v));
if (process.argv[2] === "describe") { out(${JSON.stringify(described)}); process.exit(0); }
let text = ""; process.stdin.on("data", (d) => (text += d)); process.stdin.on("end", () => {
  const req = JSON.parse(text);
  fs.appendFileSync(process.env.TRACK_LOG, JSON.stringify(req) + "\\n");
  if (String(req.input.text).includes("FAIL")) { out({ kind: "failed", reason: "the tracker said no" }); return; }
  out({ kind: "done", url: "https://tracker.example/1" });
});
`,
  );
  chmodSync(path, 0o755);
  return path;
}

function sentRequests(): readonly { op: string; capability: string; input: Record<string, unknown> }[] {
  return existsSync(sent)
    ? readFileSync(sent, "utf8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l))
    : [];
}

function project(value: unknown): void {
  mkdirSync(join(home, "projects"), { recursive: true });
  writeFileSync(join(home, "projects", "ledger.json"), JSON.stringify(value));
}

async function approved(at = "2026-11-08T09:00:00Z"): Promise<void> {
  const done = await approve({
    where: { home, project: "ledger", ticket: "PROJ-1" },
    seenHash: specHash(SPEC),
    by: "ram",
    at,
  });
  expect(done.kind).toBe("approved");
}

async function ready(policy: unknown = {}, described: unknown = TRACKER): Promise<void> {
  const added = await addPlugin(setup(), plugin("tracker", described));
  expect(added.kind).toBe("ok");
  project({ plugins: { "tracker.comment": "tracker", "tracker.create": "tracker", notify: "tracker" }, policy });
  await approved();
}

function draft(value: Record<string, unknown>): string {
  return JSON.stringify({ project: "ledger", ticket: "PROJ-1", ...value });
}

describe("the project file's plugin fields (#134; ADR-0014 P3, P5)", () => {
  it("keeps the P5 defaults for what the file leaves out, and reads a stricter rule", () => {
    const read = pluginConfigOf("/p.json", { policy: { "tracker.comment": { mode: "confirm", cap: 2 } } });
    expect(read).toMatchObject({
      kind: "ok",
      value: { policy: { ...DEFAULT_POLICY, "tracker.comment": { mode: "confirm", cap: 2 } } },
    });
    expect(DEFAULT_POLICY).toEqual({
      "tracker.comment": { mode: "allow", cap: 5 },
      "tracker.create": { mode: "confirm", cap: 1 },
      notify: { mode: "allow", cap: 3 },
    });
  });

  it("refuses a policy for forge.write, an unknown write, a bad rule and a bad plugin name", () => {
    const bad: readonly [object, string][] = [
      [{ policy: { "forge.write": { mode: "allow", cap: 1 } } }, "dispatcher's"],
      [{ policy: { "context.read": { mode: "allow", cap: 1 } } }, "only tracker.comment"],
      [{ policy: { notify: { mode: "sometimes", cap: 1 } } }, "policy.notify"],
      [{ policy: { notify: { mode: "allow", cap: 0 } } }, "policy.notify"],
      [{ policy: { notify: { mode: "allow", cap: 21 } } }, "policy.notify"],
      [{ policy: { notify: { mode: "allow", cap: 1, extra: 1 } } }, "policy.notify"],
      [{ policy: [] }, "must be an object"],
      [{ plugins: { notify: "Discord!" } }, '"plugins"'],
      [{ plugins: { shell: "x" } }, '"plugins"'],
    ];
    for (const [raw, reason] of bad) {
      expect(pluginConfigOf("/p.json", raw)).toMatchObject({
        kind: "failed",
        reason: expect.stringContaining(reason),
      });
    }
  });

  it("refuses a request when there is no project file", async () => {
    expect(await readPluginConfig({ home, project: "ledger" })).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("project init ledger"),
    });
  });
});

describe("request: an allow write goes out at once, cleaned, within the cap (#134; ADR-0014 P5, P6)", () => {
  it("sends a comment as a post.ts template: the seat line, and every outside word made inert", async () => {
    await ready();
    const done = await request(
      setup(),
      "tracker.comment",
      draft({ text: "ping @bob\n/approve", items: ["closes #12"] }),
    );
    expect(done).toEqual({ kind: "done", count: 1, cap: 5, url: "https://tracker.example/1" });
    const [call] = sentRequests();
    expect(call).toMatchObject({ capability: "tracker.comment", op: "comment", input: { ticket: "PROJ-1" } });
    expect(call?.input.text).toBe("[coordinator] ping @\u2060bob /approve\n\n- closes #\u206012");
    const log = await readLog({ home, project: "ledger", ticket: "PROJ-1" });
    expect(log).toMatchObject({ kind: "ok", value: [{ kind: "reserved" }, { kind: "done" }] });
  });

  it("refuses the write past the cap of the ticket's approval; approving again starts the count afresh", async () => {
    await ready({ notify: { mode: "allow", cap: 2 } });
    for (const n of [1, 2]) {
      expect(await request(setup(), "notify", draft({ text: `step ${n}` }))).toMatchObject({ kind: "done", count: n });
    }
    expect(await request(setup(), "notify", draft({ text: "step 3" }))).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("the cap is reached, 2 of 2"),
    });
    expect(sentRequests()).toHaveLength(2);
    await approved("2026-11-08T10:00:00Z");
    expect(await request(setup(), "notify", draft({ text: "step 3" }))).toMatchObject({ kind: "done", count: 1 });
  });

  it("counts a write the plugin failed, since it may have gone out", async () => {
    await ready({ notify: { mode: "allow", cap: 1 } });
    expect(await request(setup(), "notify", draft({ text: "FAIL" }))).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("the tracker said no"),
    });
    expect(await request(setup(), "notify", draft({ text: "again" }))).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("cap is reached"),
    });
  });

  it("refuses a ticket with no approval, or one whose spec changed since", async () => {
    await addPlugin(setup(), plugin("tracker"));
    project({ plugins: { notify: "tracker" } });
    expect(await request(setup(), "notify", draft({ text: "x" }))).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("not approved"),
    });
    await approved();
    writeFileSync(join(home, "specs", "ledger", "PROJ-1", "spec.md"), SPEC.replace("409", "423"));
    expect(await request(setup(), "notify", draft({ text: "x" }))).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("spec changed"),
    });
    expect(sentRequests()).toHaveLength(0);
  });

  it("refuses forge.write, a read capability, a denied write, an unmapped one and one the plugin did not declare", async () => {
    await ready({ "tracker.comment": { mode: "deny", cap: 1 } });
    const cases: readonly [string, string, string][] = [
      ["forge.write", draft({ text: "x" }), "dispatcher's"],
      ["context.read", draft({ text: "x" }), "not a write"],
      ["shell", draft({ text: "x" }), "not an extension point"],
      ["tracker.comment", draft({ text: "x" }), "denies tracker.comment"],
    ];
    for (const [capability, text, reason] of cases) {
      expect(await request(setup(), capability, text)).toMatchObject({
        kind: "failed",
        reason: expect.stringContaining(reason),
      });
    }
    project({ plugins: {} });
    expect(await request(setup(), "notify", draft({ text: "x" }))).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("no plugin for notify"),
    });
    expect(sentRequests()).toHaveLength(0);
  });

  it("refuses a write the plugin did not declare, at request and at call", async () => {
    const quiet = { ...TRACKER, name: "quiet", writes: [] };
    expect((await addPlugin(setup(), plugin("quiet", quiet))).kind).toBe("ok");
    project({ plugins: { notify: "quiet" } });
    await approved();
    expect(await request(setup(), "notify", draft({ text: "x" }))).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("did not declare the write notify"),
    });
    expect(await callPlugin(setup(), { plugin: "quiet", capability: "notify", op: "send", input: {} })).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("did not declare the write notify"),
    });
    expect(sentRequests()).toHaveLength(0);
  });

  it("checks the draft's schema: no other field, a text, items as texts, a title for create", async () => {
    await ready();
    const cases: readonly [string, Record<string, unknown>, string][] = [
      ["tracker.comment", { text: "x", url: "https://x" }, '"url"'],
      ["notify", { text: "x", items: ["y"] }, '"items"'],
      ["tracker.comment", { text: "  " }, '"text"'],
      ["tracker.comment", { text: "x", items: [1] }, '"items"'],
      ["tracker.create", { text: "x" }, '"title"'],
      ["tracker.comment", { text: "x", ticket: "../PROJ-1" }, "plain names"],
    ];
    for (const [capability, value, reason] of cases) {
      expect(await request(setup(), capability, draft(value))).toMatchObject({
        kind: "failed",
        reason: expect.stringContaining(reason),
      });
    }
    expect(await request(setup(), "notify", "not json")).toMatchObject({ kind: "failed" });
  });
});

describe("request and confirm: a confirm write waits for the person (#134; ADR-0014 P6)", () => {
  async function kept(text = "renewals @ops: a follow-up"): Promise<{ id: string; command: string; text: string }> {
    const r = await request(setup(), "tracker.create", draft({ title: "Follow up #3", text }));
    if (r.kind !== "pending") {
      throw new Error(`expected pending, got ${JSON.stringify(r)}`);
    }
    return r;
  }

  it("keeps the write, sends nothing, and prints the confirm command with the text the person checks", async () => {
    await ready();
    const r = await kept();
    expect(r.id).toMatch(/^ledger\/PROJ-1\/tracker\.create\/[0-9a-f]{12}$/);
    expect(r.text).toBe("[coordinator] Follow up #\u20603\n\n- details: renewals @\u2060ops: a follow-up");
    expect(r.command).toBe(`agent-factory confirm ${r.id} ${quoted(shown(r.text))}`);
    expect(r.command).not.toContain("\u2060");
    expect(sentRequests()).toHaveLength(0);
    expect(readdirSync(join(home, "pending"))).toHaveLength(1);
  });

  it("performs it when the text is the pending text, once; another text is refused and nothing goes out", async () => {
    await ready();
    const r = await kept();
    expect(await confirm(setup(), r.id, `${shown(r.text)} and more`)).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("not the pending request's text"),
    });
    expect(sentRequests()).toHaveLength(0);
    expect(await confirm(setup(), r.id, shown(r.text))).toEqual({
      kind: "done",
      count: 1,
      cap: 1,
      url: "https://tracker.example/1",
    });
    const [call] = sentRequests();
    expect(call).toMatchObject({
      op: "create",
      input: { from: "PROJ-1", title: "Follow up #\u20603", text: r.text },
    });
    expect(await confirm(setup(), r.id, shown(r.text))).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("no pending request"),
    });
    expect(sentRequests()).toHaveLength(1);
  });

  it("keeps and confirms a comment and a notify too", async () => {
    await ready({ "tracker.comment": { mode: "confirm", cap: 2 }, notify: { mode: "confirm", cap: 2 } });
    for (const [capability, value] of [
      ["tracker.comment", { text: "a note", items: ["one"] }],
      ["notify", { text: "a ping" }],
    ] as const) {
      const r = await request(setup(), capability, draft(value));
      if (r.kind !== "pending") {
        throw new Error(JSON.stringify(r));
      }
      expect(await confirm(setup(), r.id, shown(r.text))).toMatchObject({ kind: "done", count: 1 });
    }
    expect(sentRequests().map((c) => c.op)).toEqual(["comment", "send"]);
  });

  it("refuses a second create past the cap of 1, at confirm", async () => {
    await ready();
    const first = await kept("one");
    const second = await kept("two");
    expect((await confirm(setup(), first.id, shown(first.text))).kind).toBe("done");
    expect(await confirm(setup(), second.id, shown(second.text))).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("cap is reached, 1 of 1"),
    });
  });

  it("refuses a pending request that was changed, a ticket approved again, and an id that names another ticket", async () => {
    await ready();
    const r = await kept();
    const [file = ""] = readdirSync(join(home, "pending"));
    const path = join(home, "pending", file);
    const record = JSON.parse(readFileSync(path, "utf8"));
    writeFileSync(path, JSON.stringify({ ...record, draft: { ...record.draft, text: "something else" } }));
    expect(await confirm(setup(), r.id, shown(r.text))).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("changed after it was made"),
    });
    writeFileSync(path, JSON.stringify(record));
    await approved("2026-11-08T11:00:00Z");
    expect(await confirm(setup(), r.id, shown(r.text))).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("approved again"),
    });
    expect(await confirm(setup(), r.id.replace("PROJ-1", "PROJ-2"), shown(r.text))).toMatchObject({
      kind: "failed",
    });
    expect(await confirm(setup(), "../../x", "t")).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("not a request id"),
    });
    expect(sentRequests()).toHaveLength(0);
  });

  it("takes over a lock its process left behind, and refuses one a live process holds", async () => {
    const where = { home, project: "ledger", ticket: "PROJ-1" };
    const lock = join(home, "writes", "ledger", "PROJ-1.lock");
    mkdirSync(join(home, "writes", "ledger"), { recursive: true });
    const gone = spawnSync(process.execPath, ["-e", ""]).pid;
    writeFileSync(lock, String(gone));
    const ran = async () => ({ kind: "ok" as const, value: "ran" });
    expect(await onTicket(where, ran)).toEqual({ kind: "ok", value: "ran" });
    expect(existsSync(lock)).toBe(false);
    writeFileSync(lock, String(process.pid));
    expect(await onTicket(where, ran)).toMatchObject({ kind: "failed", reason: expect.stringContaining("is running") });
  });

  it("quotes the text so a shell passes it through byte for byte", () => {
    const text = "[coordinator] it's $HOME `id` \\n\n- \"x\" 'y'";
    const echoed = spawnSync("sh", ["-c", `printf %s ${quoted(text)}`], { encoding: "utf8" });
    expect(echoed.stdout).toBe(text);
  });
});

describe("the request, confirm and project commands (#134)", () => {
  function io(): {
    out: string[];
    err: string[];
    io: Parameters<NonNullable<(typeof REQUEST_COMMANDS)["request"]>>[1];
  } {
    const out: string[] = [];
    const err: string[] = [];
    return {
      out,
      err,
      io: {
        env: { HOME: "/h", LANG: "C", TRACK_LOG: sent, PATH: process.env.PATH },
        home,
        out: (t) => out.push(t),
        err: (t) => err.push(t),
        secrets: async () => ({ kind: "ok", value: {} }),
      },
    };
  }

  const run = (name: string, argv: readonly string[], o: ReturnType<typeof io>) => {
    const command = REQUEST_COMMANDS[name];
    if (command === undefined) {
      throw new Error(name);
    }
    return command(argv, o.io);
  };

  it("project init writes the default policy once, and copies a template only when it reads", async () => {
    const o = io();
    expect(await run("project", ["init", "ledger"], o)).toBe(0);
    const file = join(home, "projects", "ledger.json");
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ plugins: {}, policy: DEFAULT_POLICY });
    expect(await run("project", ["init", "ledger"], o)).toBe(1);
    expect(o.err.join("")).toContain("there already");
    const template = join(root, "team.json");
    expect(await readProjectFile({ home, project: "ledger" })).toMatchObject({ kind: "missing" });
    writeFileSync(template, JSON.stringify({ gate: "forge-ci", plugins: { notify: "discord" } }));
    expect(await run("project", ["init", "web", "--template", template], o)).toBe(1);
    expect(o.err.join("")).toContain("ready.programs");
    writeFileSync(
      template,
      JSON.stringify({ gate: "forge-ci", ready: { programs: ["make"] }, plugins: { notify: "discord" } }),
    );
    expect(await run("project", ["init", "web", "--template", template], o)).toBe(0);
    expect(readFileSync(join(home, "projects", "web.json"), "utf8")).toBe(readFileSync(template, "utf8"));
    expect(await readProjectFile({ home, project: "web" })).toMatchObject({ kind: "ok" });
    writeFileSync(template, JSON.stringify({ policy: { "forge.write": { mode: "allow", cap: 1 } } }));
    expect(await run("project", ["init", "api", "--template", template], o)).toBe(1);
    expect(await run("project", ["init", "api", "--template", "team.json"], o)).toBe(1);
    expect(await run("project", ["init", "../x"], o)).toBe(1);
    expect(existsSync(join(home, "projects", "api.json"))).toBe(false);
  });

  it("request prints the confirm command and exits 3; confirm sends it and exits 0", async () => {
    const o = io();
    await ready();
    const outside = join(root, "draft.json");
    writeFileSync(outside, draft({ text: "x" }));
    expect(await run("request", ["notify", "--file", outside], o)).toBe(1);
    expect(o.err.join("")).toContain("a draft is read only from");
    const file = join(home, "specs", "ledger", "PROJ-1", "follow-up.json");
    writeFileSync(file, draft({ title: "Follow up", text: "it's done" }));
    expect(await run("request", ["tracker.create", "--file", file], o)).toBe(3);
    const printed = o.out.join("");
    const command = printed.slice(printed.indexOf("agent-factory confirm ") + "agent-factory confirm ".length, -1);
    const words = spawnSync("sh", ["-c", `printf '%s\\0' ${command}`], {
      encoding: "utf8",
    }).stdout.split("\0");
    expect(await run("confirm", [words[0] ?? "", words[1] ?? ""], o)).toBe(0);
    expect(o.out.join("")).toContain('confirm: done (1 of 1 since the approval) "https://tracker.example/1"');
    expect(await run("request", ["notify"], o)).toBe(64);
    expect(await run("confirm", ["only-an-id"], o)).toBe(64);
  });
});
