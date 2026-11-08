import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pluginEnv, readDescribe } from "../src/core/plugin/contract.js";
import { testPlugin } from "../src/core/plugin/kit.js";
import {
  addPlugin,
  applyUpdate,
  callPlugin,
  planUpdate,
  readRegistry,
  type Setup,
} from "../src/core/plugin/registry.js";

let root = "";
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "factory-plugin-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const DESCRIBE = {
  protocol: 1,
  name: "echo",
  version: "1.0.0",
  capabilities: [{ name: "context.read" }, { name: "notify" }],
  writes: ["notify"],
  env: ["ECHO_SITE"],
};

// a plugin written as a Node script; `body` handles one parsed request (req) and prints its answer
function plugin(name: string, body: string, described: unknown = DESCRIBE): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "plugin");
  writeFileSync(
    path,
    `#!${process.execPath}
const out = (v) => process.stdout.write(JSON.stringify(v));
if (process.argv[2] === "describe") { out(${JSON.stringify(described)}); process.exit(0); }
let text = ""; process.stdin.on("data", (d) => (text += d)); process.stdin.on("end", () => {
  let req; try { req = JSON.parse(text); } catch { out({ kind: "failed", reason: "bad input" }); return; }
  ${body}
});
`,
  );
  chmodSync(path, 0o755);
  return path;
}

const ECHO = `
  if (req.op === "read") { out({ kind: "found", text: String(req.input.ref), env: Object.keys(process.env).sort() }); return; }
  if (req.op === "send") { out({ kind: "sent" }); return; }
  out({ kind: "unsupported", op: req.op });`;

const setup = (over: Partial<Setup> = {}): Setup => ({
  home: join(root, "home"),
  env: { HOME: "/home/x", LANG: "C", ECHO_SITE: "s", GH_TOKEN: "secret", ANTHROPIC_API_KEY: "sk-ant-x" },
  path: process.env.PATH ?? "",
  ...over,
});

describe("the plugin contract (#134; ADR-0014 P1, P8, P11)", () => {
  it("reads a describe; refuses another protocol, an unknown capability, an undeclared write and a model login", () => {
    expect(readDescribe(JSON.stringify(DESCRIBE))).toMatchObject({
      kind: "ok",
      value: { name: "echo", writes: ["notify"] },
    });
    const bad: readonly [unknown, string][] = [
      [{ ...DESCRIBE, protocol: 9 }, "protocol 9"],
      [{ ...DESCRIBE, name: "Echo!" }, "name"],
      [{ ...DESCRIBE, capabilities: [{ name: "shell" }] }, "capabilities"],
      [{ ...DESCRIBE, writes: ["tracker.create"] }, "not one of its capabilities"],
      [{ ...DESCRIBE, writes: ["context.read"] }, "capabilities"],
      [{ ...DESCRIBE, env: ["ANTHROPIC_API_KEY"] }, "model login"],
      [{ ...DESCRIBE, env: ["CLAUDE_CODE_OAUTH_TOKEN"] }, "model login"],
      ["not an object", "one JSON object"],
    ];
    for (const [value, reason] of bad) {
      expect(readDescribe(JSON.stringify(value))).toMatchObject({
        kind: "failed",
        reason: expect.stringContaining(reason),
      });
    }
    expect(readDescribe('{"a":1}\n{"b":2}')).toMatchObject({ kind: "failed" });
  });

  it("gives a plugin only the trusted PATH, HOME, LANG and the names it declared; never a model login", () => {
    const env = pluginEnv(
      { HOME: "/h", LANG: "C", SITE: "s", GH_TOKEN: "t", ANTHROPIC_API_KEY: "k", CLAUDE_CODE_OAUTH_TOKEN: "c" },
      ["SITE", "ANTHROPIC_API_KEY"],
      "/usr/bin",
    );
    expect(env).toEqual({ HOME: "/h", LANG: "C", SITE: "s", PATH: "/usr/bin" });
  });
});

describe("the registry: pinned by path and sha256 (#134; ADR-0014 P2)", () => {
  it("adds a plugin, calls it, and refuses it once its file changes", async () => {
    const path = plugin("echo", ECHO);
    const added = await addPlugin(setup(), path);
    expect(added).toMatchObject({ kind: "ok", value: { name: "echo", path, writes: ["notify"] } });
    const file = join(root, "home", "plugins.json");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const call = { plugin: "echo", capability: "context.read", op: "read", input: { ref: "PROJ-1" } } as const;
    const found = await callPlugin(setup(), call);
    expect(found).toMatchObject({ kind: "ok", value: { kind: "found", fields: { text: "PROJ-1" } } });
    // its env held only what it may have
    expect(found.kind === "ok" ? found.value.fields.env : []).toEqual(["ECHO_SITE", "HOME", "LANG", "PATH"]);
    writeFileSync(path, `${readFileSync(path, "utf8")}\n// changed\n`);
    expect(await callPlugin(setup(), call)).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("changed since it was added"),
    });
  });

  it("refuses a capability it did not declare, an unknown plugin, and a name another file holds", async () => {
    await addPlugin(setup(), plugin("echo", ECHO));
    expect(
      await callPlugin(setup(), { plugin: "echo", capability: "tracker.create", op: "x", input: {} }),
    ).toMatchObject({ kind: "failed", reason: expect.stringContaining("does not declare tracker.create") });
    expect(await callPlugin(setup(), { plugin: "nope", capability: "notify", op: "x", input: {} })).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("no plugin named nope"),
    });
    expect(await addPlugin(setup(), plugin("other", ECHO))).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("already"),
    });
  });

  it("refuses a relative path, a file that is not executable, and a plugins file that does not read", async () => {
    expect(await addPlugin(setup(), "echo/plugin")).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("absolute"),
    });
    const path = plugin("echo", ECHO);
    chmodSync(path, 0o644);
    expect(await addPlugin(setup(), path)).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("not executable"),
    });
    mkdirSync(join(root, "home"), { recursive: true });
    writeFileSync(join(root, "home", "plugins.json"), "{broken");
    expect(await readRegistry(join(root, "home"))).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("not JSON"),
    });
  });

  it("update shows the writes a new version adds, and records only when applied", async () => {
    const path = plugin("echo", ECHO);
    await addPlugin(setup(), path);
    plugin("echo", ECHO, {
      ...DESCRIBE,
      version: "2.0.0",
      capabilities: [...DESCRIBE.capabilities, { name: "tracker.create" }],
      writes: ["notify", "tracker.create"],
    });
    const change = await planUpdate(setup(), "echo");
    expect(change).toMatchObject({
      kind: "ok",
      value: { writesAdded: ["tracker.create"], after: { version: "2.0.0" } },
    });
    // not applied yet: the old pin still stands, so the changed file is refused
    expect(await callPlugin(setup(), { plugin: "echo", capability: "notify", op: "send", input: {} })).toMatchObject({
      kind: "failed",
    });
    const applied = change.kind === "ok" ? await applyUpdate(setup(), change.value) : change;
    expect(applied).toEqual({ kind: "ok" });
    expect(await callPlugin(setup(), { plugin: "echo", capability: "notify", op: "send", input: {} })).toMatchObject({
      kind: "ok",
      value: { kind: "sent" },
    });
  });

  it("a plugin that crashes, runs too long, prints too much or prints no JSON gives no result", async () => {
    const cases: readonly [string, string, string][] = [
      ["crash", "process.exit(3);", "exited 3"],
      ["slow", "setTimeout(() => out({ kind: 'sent' }), 5000);", "ran out of time"],
      ["huge", "process.stdout.write('x'.repeat(200000));", "printed more than"],
      ["noisy", "process.stdout.write('log line\\n'); out({ kind: 'sent' });", "not one JSON object"],
      ["nokind", "out({ ok: true });", "no kind"],
    ];
    for (const [name, body, reason] of cases) {
      const home = join(root, `home-${name}`);
      const s = setup({ home, limits: { timeoutMs: 1000, maxBytes: 100_000 } });
      await addPlugin(s, plugin(name, body, { ...DESCRIBE, name }));
      expect({
        name,
        out: await callPlugin(s, { plugin: name, capability: "notify", op: "send", input: {} }),
      }).toMatchObject({
        name,
        out: { kind: "failed", reason: expect.stringContaining(reason) },
      });
    }
  });
});

describe("the contract test kit: agent-factory plugin test (#134)", () => {
  it("passes a plugin that keeps the contract, with its fixtures", async () => {
    const path = plugin("echo", ECHO);
    const fixtures = join(root, "echo", "fixtures", "context.read");
    mkdirSync(fixtures, { recursive: true });
    writeFileSync(join(fixtures, "ticket.in.json"), JSON.stringify({ op: "read", input: { ref: "PROJ-7" } }));
    writeFileSync(join(fixtures, "ticket.out.json"), JSON.stringify({ kind: "found", text: "PROJ-7" }));
    const checks = await testPlugin(setup(), path);
    expect(checks.filter((c) => !c.ok)).toEqual([]);
    expect(checks.map((c) => c.name)).toEqual([
      "handshake",
      "fixture context.read/ticket",
      "bad input",
      "unknown op",
      "stdout is one JSON object",
      "env canary",
      "no token out",
    ]);
  });

  it("fails a plugin that crashes on bad input, logs on stdout, or prints a token", async () => {
    const failing = async (name: string, body: string) =>
      (await testPlugin(setup(), plugin(name, body, { ...DESCRIBE, name }))).filter((c) => !c.ok).map((c) => c.name);
    expect(await failing("noisy", "process.stdout.write('hi\\n'); out({ kind: 'unsupported' });")).toContain(
      "stdout is one JSON object",
    );
    expect(await failing("leak", "out({ kind: 'unsupported', token: 'ghp_' + 'a'.repeat(30) });")).toEqual([
      "no token out",
    ]);
    const crash = join(root, "crash");
    mkdirSync(crash);
    const path = join(crash, "plugin");
    writeFileSync(
      path,
      `#!${process.execPath}\nif (process.argv[2] === "describe") { process.stdout.write(${JSON.stringify(JSON.stringify({ ...DESCRIBE, name: "crash" }))}); } else { process.exit(1); }\n`,
    );
    chmodSync(path, 0o755);
    const crashed = (await testPlugin(setup(), path)).filter((c) => !c.ok).map((c) => c.name);
    expect(crashed).toEqual(expect.arrayContaining(["bad input", "unknown op"]));
  });

  it("stops at the handshake when describe is not valid", async () => {
    const checks = await testPlugin(setup(), plugin("old", ECHO, { ...DESCRIBE, name: "old", protocol: 7 }));
    expect(checks).toMatchObject([{ name: "handshake", ok: false, detail: expect.stringContaining("protocol 7") }]);
  });
});
