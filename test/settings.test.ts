import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCli } from "../src/app.js";
import { saveFile } from "../src/settings-cli.js";
import { pluginConfigOf, readPluginConfig } from "../src/core/plugin/config.js";
import { pluginListOf } from "../src/core/process/plugins.js";
import { MODES } from "../src/core/plugin/policy.js";
import { projectPath, readProjectFile, readProjectRaw, readyFieldsOf } from "../src/core/project.js";
import { fileKeys, machineKeys, type FileKey } from "../src/core/settings/keys.js";
import { layered, modesOf, pinOf } from "../src/core/settings/layers.js";
import { keyLines } from "../src/core/settings/lines.js";
import { canonical, didYouMean, resolve, type FileLayer, type Resolved } from "../src/core/settings/resolve.js";
import { runEnv, settingOf } from "../src/core/settings/machine.js";
import { maxUsd, paths, REVIEW_MODELS } from "../src/core/review/settings.js";
import { pinnedModel } from "../src/core/settings/variables.js";
import { evalSettings } from "../src/core/eval/harness.js";
import { capsOf } from "../src/core/dispatch/caps.js";
import { tempDir } from "./temp.js";

let home = "";
beforeEach(() => {
  home = tempDir("factory-settings-");
  mkdirSync(join(home, "projects"));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
  GIT_CONFIG_NOSYSTEM: "1",
};

function text(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
function writeProject(value: unknown): string {
  const path = projectPath(home, "ledger");
  writeFileSync(path, typeof value === "string" ? value : text(value));
  return path;
}
function writeUser(value: unknown): void {
  writeFileSync(join(home, "user.json"), text(value));
}
function commitTeam(value: unknown): string {
  const dir = join(home, "teams", "acme");
  mkdirSync(dir, { recursive: true });
  const git = (args: readonly string[]): string =>
    execFileSync("git", ["-C", dir, ...args], { env: GIT_ENV, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  git(["init", "-q"]);
  writeFileSync(join(dir, "team.json"), text(value));
  git(["add", "team.json"]);
  git(["commit", "-q", "-m", "team"]);
  return git(["rev-parse", "HEAD"]).trim();
}

const BASE = { gate: "forge-ci", ready: { programs: ["make", "npm"], timeoutMinutes: 30 } };

type Run = { readonly code: number; readonly out: string; readonly err: string };
function discordOn(): string {
  const config = join(home, "claude");
  const id = "discord@claude-plugins-official";
  mkdirSync(join(config, "plugins"), { recursive: true });
  writeFileSync(join(config, "settings.json"), JSON.stringify({ enabledPlugins: { [id]: true } }));
  writeFileSync(
    join(config, "plugins", "installed_plugins.json"),
    JSON.stringify({ version: 2, plugins: { [id]: [{ scope: "user" }] } }),
  );
  return join(config, "settings.json");
}

async function cli(argv: readonly string[], env?: NodeJS.ProcessEnv): Promise<Run> {
  let out = "";
  let err = "";
  const code = await runCli(argv, {
    env: { ...process.env, CLAUDE_CONFIG_DIR: join(home, "claude"), ...env, FACTORY_HOME: home },
    out: (t) => (out += t),
    err: (t) => (err += t),
    readSecret: async () => "",
    readStdin: async () => "",
    system: {
      platform: "linux",
      uid: process.getuid?.() ?? -1,
      gid: process.getgid?.() ?? -1,
      run: async () => ({ code: 1, stdout: "", stderr: "no CLI in this test" }),
      interactive: async () => 0,
      background: async () => ({ kind: "failed", reason: "no background in this test" }),
      agent: async () => ({ code: 127, stdout: "", stderr: "no agent CLI in this test" }),
    },
  });
  return { code, out, err };
}

type Fixture = { readonly name: string; readonly text: string };

function fixtureOf(value: unknown): readonly Fixture[] {
  const [name, t] = [Reflect.get(Object(value), "name"), Reflect.get(Object(value), "text")];
  return typeof name === "string" && typeof t === "string" ? [{ name, text: t }] : [];
}

const FIXTURES: readonly Fixture[] = [
  JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "settings-golden.json"), "utf8")),
]
  .flat()
  .flatMap(fixtureOf);

function parsedOrUndefined(t: string): unknown {
  try {
    return JSON.parse(t) as unknown;
  } catch {
    return undefined;
  }
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function atPath(value: unknown, path: readonly string[]): { readonly found: boolean; readonly value: unknown } {
  let here = value;
  for (const part of path) {
    if (!isObject(here) || !Object.hasOwn(here, part)) {
      return { found: false, value: undefined };
    }
    here = Reflect.get(here, part) as unknown;
  }
  return { found: true, value: here };
}

function ownValue(raw: object, r: Resolved): { readonly id: string; readonly value: unknown } {
  const own = r.key.where === "file" ? atPath(raw, r.key.path) : { found: false, value: undefined };
  const fallback = r.key.where === "file" ? r.key.fallback : undefined;
  return { id: r.key.id, value: own.found ? own.value : fallback };
}

describe("settings golden: no team file and no user file resolve to today's values (#229)", () => {
  it(`has the project files of every existing test (${FIXTURES.length})`, () => {
    expect(FIXTURES.length).toBeGreaterThan(40);
  });

  const objects = FIXTURES.filter((f) => isObject(parsedOrUndefined(f.text)));
  const others = FIXTURES.filter((f) => !isObject(parsedOrUndefined(f.text)));

  it.each(others.map((f) => [f.name, f.text]))("%s: refused as before", async (_name, fileText) => {
    const path = writeProject(fileText);
    const refused = { kind: "failed", reason: `${path}: is not a JSON object` };
    expect(await readProjectFile({ home, project: "ledger" })).toEqual(refused);
    expect(await readPluginConfig({ home, project: "ledger" })).toEqual(refused);
  });

  it.each(objects.map((f) => [f.name, f.text]))("%s: read as before", async (_name, fileText) => {
    const path = writeProject(fileText);
    const raw = Object(parsedOrUndefined(fileText));
    expect(await readProjectFile({ home, project: "ledger" })).toEqual(readyFieldsOf(path, raw, process.env));
    expect(await readPluginConfig({ home, project: "ledger" })).toEqual(pluginConfigOf(path, raw));
    expect(await readProjectRaw({ home, project: "ledger" }, "")).toEqual({ kind: "ok", path, value: raw });
    const resolution = await layered({ home, env: {}, project: { path, text: fileText, value: raw } });
    expect(resolution.problems.filter((p) => p.level === "error")).toEqual([]);
    const keys = resolution.values.filter((r) => r.key.where === "file" && r.key.fixed === undefined);
    expect(keys.map((r) => ({ id: r.key.id, value: r.value }))).toEqual(keys.map((r) => ownValue(raw, r)));
  });

  it("the machine layer is the FACTORY_* variables as they are, one adapter for all; a list key's as a list", () => {
    const env = Object.fromEntries(machineKeys().map((k, i) => [k.env, `v${i}`]));
    const r = resolve({ layers: [], modes: new Map(), env, problems: [] });
    for (const k of machineKeys()) {
      const got = r.values.find((v) => v.key.id === k.id);
      const listed = k.class === "allow-list" || k.class === "deny-list";
      const value = listed ? [env[k.env]] : env[k.env];
      expect(got).toMatchObject({ value, sources: [{ layer: "machine", file: `env ${k.env}` }] });
    }
    const none = resolve({ layers: [], modes: new Map(), env: {}, problems: [] });
    expect(none.values.filter((v) => v.key.where === "machine" && v.set)).toEqual([]);
  });
});

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const POOLS: Readonly<Record<string, readonly unknown[]>> = {
  gate: ["forge-ci", "local"],
  verify: [
    ["make", "verify"],
    ["npm", "test"],
  ],
  "ready.programs": [["make"], ["make", "npm"], ["npm", "gradle"], ["make", "npm", "gradle"]],
  "ready.timeoutMinutes": [5, 30, 60, 240],
  "ready.testFiles": [["test/**"], ["spec/**"], ["test/**", "it/**"]],
  "egress.allow": [["a.example.com"], ["a.example.com", "b.example.com"], ["c.example.com"]],
  connectors: [{}, { notify: "discord" }],
  plugins: [[], ["rulebook@chiyanram"], ["rulebook@chiyanram", "team@acme"]],
  "ready.judgeFiles": [["ci/**"], ["ci/**", "build/**"]],
  "lanes.oneWayDoor": [["db/migrations/**"], ["infra/**"]],
  "quarantine.checks": [
    [],
    [{ check: "e2e", owner: "ram", added: "2026-11-10", expires: "2026-11-20", ticket: "#512" }],
  ],
  "quarantine.maxDays": [3, 7, 14],
  "review.lenses": [[], [{ name: "api", rubric: { file: "docs/review/api.md" } }]],
  "approval.floor": ["tiny"],
  work: [false, true],
  repoCommits: [false, true],
};

function poolOf(key: FileKey): readonly unknown[] {
  const policy = key.class === "ladder" ? (key.ladder ?? MODES) : [1, 3, 5, 20];
  return key.id.startsWith("policy.") ? policy : (POOLS[key.id] ?? []);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return isObject(value);
}

function setAt(target: Record<string, unknown>, path: readonly string[], value: unknown): void {
  const [head, ...rest] = path;
  if (head === undefined) {
    return;
  }
  if (rest.length === 0) {
    target[head] = value;
    return;
  }
  const next: unknown = target[head] ?? {};
  if (isRecord(next)) {
    target[head] = next;
    setAt(next, rest, value);
  }
}

function pickOf(next: () => number): <T>(xs: readonly T[]) => T | undefined {
  return (xs) => xs[Math.floor(next() * xs.length)];
}

function partnerSet(value: object, key: FileKey): boolean {
  return key.id.endsWith(".cap") && atPath(value, [...key.path.slice(0, -1), "mode"]).found;
}

function randomValues(next: () => number, name: FileLayer["name"]): Record<string, unknown> {
  const value: Record<string, unknown> = {};
  const pick = pickOf(next);
  const allowed = (k: FileKey): boolean => k.projectOnly !== true || name === "project";
  for (const key of fileKeys().filter((k) => allowed(k) && (partnerSet(value, k) || next() < 0.45))) {
    setAt(value, key.path, pick(poolOf(key)));
  }
  return value;
}

function randomModes(next: () => number): Record<string, string> {
  const pick = pickOf(next);
  const chosen = fileKeys().filter(() => next() < 0.3);
  return Object.fromEntries(
    chosen.map((key) => [
      key.id,
      pick(key.class === "allow-list" ? ["locked", "default", "open"] : ["locked", "default"]) ?? "default",
    ]),
  );
}

function randomLayer(name: FileLayer["name"], next: () => number): FileLayer {
  const value = randomValues(next, name);
  const all = name === "team" ? { ...value, modes: randomModes(next) } : value;
  return { name, file: `/${name}.json`, value: all, lines: keyLines(text(all)) };
}

function rank(key: FileKey, value: unknown): number {
  return (key.ladder ?? []).indexOf(String(value));
}

function list(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function within(inner: unknown, outer: unknown): boolean {
  return list(inner).every((v) => list(outer).includes(v));
}

type Looser = (key: FileKey, got: unknown, above: unknown, mode: string) => boolean;

const NOT_LOOSER: Readonly<Record<FileKey["class"], Looser>> = {
  ladder: (key, got, above) => rank(key, got) >= rank(key, above),
  cap: (_key, got, above) => Number(got) <= Number(above),
  "allow-list": (_key, got, above, mode) => within(above, got) && (mode === "open" || within(got, above)),
  "deny-list": (_key, got, above) => within(above, got),
  locked: (_key, got, above) => canonical(got) === canonical(above),
  preference: () => true,
};

function notLooser(key: FileKey, got: unknown, above: unknown, mode: string): boolean {
  return mode === "locked" ? canonical(got) === canonical(above) : NOT_LOOSER[key.class](key, got, above, mode);
}

function unread(key: FileKey, got: Resolved, effective: object): boolean {
  return key.fixed === undefined && canonical(atPath(effective, key.path).value) !== canonical(got.value);
}

function fileBreach(key: FileKey, team: FileLayer, mode: string, effective: object, got: Resolved): readonly string[] {
  const teamValue = atPath(team.value, key.path);
  const bad = teamValue.found && (!notLooser(key, got.value, teamValue.value, mode) || unread(key, got, effective));
  return bad ? [`${key.id}: ${JSON.stringify(got.value)} vs the team's ${JSON.stringify(teamValue.value)}`] : [];
}

function breach(
  team: FileLayer,
  modes: ReadonlyMap<string, string>,
  effective: object,
  got: Resolved,
): readonly string[] {
  const key = got.key;
  return key.where === "file" ? fileBreach(key, team, modes.get(key.id) ?? "default", effective, got) : [];
}

function breaches(
  team: FileLayer,
  modes: ReadonlyMap<string, string>,
  r: ReturnType<typeof resolve>,
): readonly string[] {
  return r.values.flatMap((got) => breach(team, modes, r.effective, got));
}

describe("settings property: a safety value is never looser than the team's (#229)", () => {
  it("holds over 2000 random team, project and user layers", () => {
    const next = rng(229);
    let refused = 0;
    const found: string[] = [];
    for (let n = 0; n < 2000; n += 1) {
      const team = randomLayer("team", next);
      const layers = [team, randomLayer("project", next), randomLayer("user", next)];
      const { modes } = modesOf(team);
      const r = resolve({ layers, modes, env: {}, problems: [] });
      refused += r.problems.some((p) => p.level === "error") ? 1 : 0;
      found.push(...breaches(team, modes, r));
    }
    expect(found).toEqual([]);
    expect(refused).toBeGreaterThan(0);
    expect(refused).toBeLessThan(2000);
  });
});

function layer(name: FileLayer["name"], value: object): FileLayer {
  return { name, file: `/${name}.json`, value, lines: keyLines(text(value)) };
}
function resolved(layers: readonly FileLayer[]): ReturnType<typeof resolve> {
  const team = layers.find((l) => l.name === "team");
  return resolve({ layers, modes: modesOf(team).modes, env: {}, problems: [] });
}
function valueOf(r: ReturnType<typeof resolve>, id: string): Resolved | undefined {
  return r.values.find((v) => v.key.id === id);
}
function readOnly(r: ReturnType<typeof resolve>, id = "srt.readOnly"): unknown {
  return valueOf(r, id)?.value;
}
function errors(r: ReturnType<typeof resolve>): readonly string[] {
  return r.problems.filter((p) => p.level === "error").map((p) => p.text);
}

describe("resolve: each class (#229)", () => {
  it("cap: the lowest wins; a higher value in a lower layer is refused, naming key, layer, file and the higher value's file", () => {
    const team = layer("team", { ready: { timeoutMinutes: 20 } });
    const ok = resolved([team, layer("project", { ready: { timeoutMinutes: 10 } })]);
    expect(valueOf(ok, "ready.timeoutMinutes")).toMatchObject({ value: 10, sources: [{ layer: "project" }] });
    expect(errors(ok)).toEqual([]);
    const loose = resolved([team, layer("project", {}), layer("user", { ready: { timeoutMinutes: 60 } })]);
    expect(valueOf(loose, "ready.timeoutMinutes")?.value).toBe(20);
    expect(errors(loose)).toEqual([
      "ready.timeoutMinutes: the user layer (/user.json:3) 60 is higher than 20; a cap key only gets stricter in a lower layer, and 20 comes from /team.json:3",
    ]);
  });

  it("ladder: the strictest wins; a policy mode can only climb from allow to confirm to deny", () => {
    const team = layer("team", { policy: { notify: { mode: "confirm", cap: 3 } } });
    const up = resolved([team, layer("project", { policy: { notify: { mode: "deny", cap: 3 } } })]);
    expect(valueOf(up, "policy.notify.mode")?.value).toBe("deny");
    const down = resolved([team, layer("project", { policy: { notify: { mode: "allow", cap: 3 } } })]);
    expect(valueOf(down, "policy.notify.mode")?.value).toBe("confirm");
    expect(errors(down)[0]).toContain(
      'policy.notify.mode: the project layer (/project.json:4) "allow" is looser than "confirm"',
    );
  });

  it("a spec.body mode is confirm or deny, never allow, in any layer (#542)", () => {
    const team = layer("team", { policy: { "spec.body": { mode: "allow", cap: 3 } } });
    const r = resolved([team]);
    expect(valueOf(r, "policy.spec.body.mode")?.value).toBe("confirm");
    expect(errors(r).join("\n")).toContain("policy.spec.body.mode");
    const deny = resolved([layer("team", { policy: { "spec.body": { mode: "deny", cap: 3 } } })]);
    expect(valueOf(deny, "policy.spec.body.mode")?.value).toBe("deny");
    expect(errors(deny)).toEqual([]);
  });

  it("allow-list: the team's entries stay; a lower layer adds only where the team marks it open", () => {
    const team = layer("team", { egress: { allow: ["a.example.com"] } });
    const add = resolved([team, layer("project", { egress: { allow: ["a.example.com", "b.example.com"] } })]);
    expect(valueOf(add, "egress.allow")?.value).toEqual(["a.example.com"]);
    expect(errors(add)[0]).toContain('adds ["b.example.com"], and only the team can widen an allow-list');
    const fewer = resolved([team, layer("project", { egress: { allow: [] } })]);
    expect(valueOf(fewer, "egress.allow")?.value).toEqual(["a.example.com"]);
    const open = layer("team", { egress: { allow: ["a.example.com"] }, modes: { "egress.allow": "open" } });
    const widened = resolved([open, layer("project", { egress: { allow: ["b.example.com"] } })]);
    expect(valueOf(widened, "egress.allow")?.value).toEqual(["a.example.com", "b.example.com"]);
    expect(errors(widened)).toEqual([]);
  });

  it("srt.readOnly: an allow-list, nested under srt in a file, and FACTORY_SRT_READ_ONLY below it (#371)", () => {
    const team = layer("team", { runner: "srt", srt: { readOnly: ["~/.cargo"] } });
    const add = resolved([team, layer("user", { srt: { readOnly: ["~/.cargo", "~/tools"] } })]);
    expect(valueOf(add, "srt.readOnly")).toMatchObject({ value: ["~/.cargo"], key: { class: "allow-list" } });
    expect(errors(add)[0]).toContain('srt.readOnly: the user layer (/user.json:3) adds ["~/tools"]');
    expect(readOnly(add, "runner")).toBe("srt");
    const open = layer("team", { srt: { readOnly: ["~/.cargo"] }, modes: { "srt.readOnly": "open" } });
    const widened = resolved([open, layer("user", { srt: { readOnly: ["~/tools"] } })]);
    expect(readOnly(widened)).toEqual(["~/.cargo", "~/tools"]);
    expect(errors(widened)).toEqual([]);
    const env = (value: string, layers: readonly FileLayer[]) =>
      resolve({ layers, modes: modesOf(layers.at(0)).modes, env: { FACTORY_SRT_READ_ONLY: value }, problems: [] });
    expect(readOnly(env("~/a:~/b", []))).toEqual(["~/a", "~/b"]);
    expect(readOnly(env('["~/a"]', []))).toEqual(["~/a"]);
    expect(errors(env("~/.cargo:~/x", [team]))[0]).toContain('adds ["~/x"]');
    expect(readOnly(env("~/x", [open]))).toEqual(["~/.cargo", "~/x"]);
    expect(errors(resolved([layer("user", { srt: { readOnly: "~/.cargo" } })]))[0]).toContain(
      "srt.readOnly in /user.json:3 must be a list of folders under your home",
    );
    expect(settingOf(runEnv({}, widened), "srt.readOnly")).toBe('["~/.cargo","~/tools"]');
  });

  it("deny-list: every layer adds", () => {
    const r = resolved([
      layer("team", { lanes: { oneWayDoor: ["db/**"] } }),
      layer("project", { lanes: { oneWayDoor: ["infra/**"] } }),
      layer("user", { lanes: { oneWayDoor: ["db/**", "keys/**"] } }),
    ]);
    expect(valueOf(r, "lanes.oneWayDoor")).toMatchObject({
      value: ["db/**", "infra/**", "keys/**"],
      sources: [{ layer: "team" }, { layer: "project" }, { layer: "user" }],
    });
  });

  it("locked: the highest layer wins, and the team's lock holds even on a key the team leaves unset", () => {
    const r = resolved([layer("team", { gate: "local" }), layer("project", { gate: "forge-ci" })]);
    expect(valueOf(r, "gate")?.value).toBe("local");
    expect(errors(r)[0]).toContain('gate: the project layer (/project.json:2) is locked at "local"');
    const lockedUnset = resolved([
      layer("team", { modes: { "ready.timeoutMinutes": "locked" } }),
      layer("project", { ready: { timeoutMinutes: 5 } }),
    ]);
    expect(errors(lockedUnset)[0]).toContain("sets a key the team locked");
    const connectors = resolved([
      layer("team", { connectors: { notify: "discord" } }),
      layer("user", { connectors: { notify: "other" } }),
    ]);
    expect(valueOf(connectors, "connectors")?.value).toEqual({ notify: "discord" });
    expect(errors(connectors)).toHaveLength(1);
    const plugins = resolved([layer("team", { plugins: ["rulebook@chiyanram"] }), layer("user", { plugins: [] })]);
    expect(valueOf(plugins, "plugins")?.value).toEqual(["rulebook@chiyanram"]);
    expect(errors(plugins)[0]).toContain('plugins: the user layer (/user.json:2) is locked at ["rulebook@chiyanram"]');
  });

  it("the approval floor cannot be turned off by any layer", () => {
    for (const name of ["team", "project", "user"] as const) {
      const r = resolved([layer(name, { approval: { floor: "feature" } })]);
      expect(valueOf(r, "approval.floor")?.value).toBe("tiny");
      expect(errors(r)).toHaveLength(1);
    }
    expect(valueOf(resolved([]), "approval.floor")).toMatchObject({ value: "tiny", sources: [{ layer: "engine" }] });
  });

  it("a team mode is locked, default or open, and only an allow-list or a preference can be open", () => {
    expect(modesOf(layer("team", { modes: { gate: "open" } })).problems[0]?.text).toContain("only an allow-list");
    expect(modesOf(layer("team", { modes: { gate: "sometimes" } })).problems[0]?.text).toContain(
      '"locked", "default" or "open"',
    );
    expect(modesOf(layer("team", { modes: { gat: "locked" } })).problems[0]?.text).toContain("not a settings key");
    expect(modesOf(layer("team", { modes: "x" })).problems[0]?.text).toContain("must map keys to modes");
  });

  it("an unknown key is a warning with did you mean; a machine key is a key a file holds (#254)", () => {
    const r = resolved([layer("user", { egress: { alow: ["a.example.com"] }, caps: { usdPerRun: 2 } })]);
    expect(r.problems).toEqual([
      { level: "warning", text: expect.stringContaining("unknown key egress.alow; did you mean egress.allow?") },
    ]);
    expect(didYouMean("zzzzzzzz")).toBe("");
  });

  it("a team or user value that is not what the key holds is an error with its file:line", () => {
    const r = resolved([layer("team", { ready: { timeoutMinutes: "ten" } })]);
    expect(errors(r)).toEqual(["ready.timeoutMinutes in /team.json:3 must be a whole number from 1 to 240"]);
  });
});

describe("the layers on disk (#229)", () => {
  it("reads the team at the commit the project pins, through hostGit, and the user file", async () => {
    const first = commitTeam({ ready: { timeoutMinutes: 40 }, egress: { allow: ["a.example.com"] } });
    commitTeam({ ready: { timeoutMinutes: 5 } });
    writeProject({ ...BASE, team: `acme@${first}`, egress: { allow: ["a.example.com"] } });
    writeUser({ ready: { timeoutMinutes: 15 } });
    expect(await readProjectFile({ home, project: "ledger" })).toMatchObject({
      kind: "ok",
      value: { ready: { timeoutSeconds: 15 * 60 }, egress: { allow: ["a.example.com"] } },
    });
  });

  it("refuses to start when a layer loosens a safety key, and when the pin does not read", async () => {
    const commit = commitTeam({ ready: { timeoutMinutes: 20 } });
    const path = writeProject({ ...BASE, team: `acme@${commit}` });
    expect(await readProjectFile({ home, project: "ledger" })).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining(`ready.timeoutMinutes: the project layer (${path}:8) 30 is higher than 20`),
    });
    writeProject({ ...BASE, team: `acme@${"0".repeat(40)}` });
    expect(await readProjectFile({ home, project: "ledger" })).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("cannot be read from the team's clone"),
    });
    writeProject({ ...BASE, team: "acme" });
    expect(await readPluginConfig({ home, project: "ledger" })).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining('"team" must be "<team>@<commit>"'),
    });
  });

  it("pinOf reads only <team>@<full commit>", () => {
    const c = "a".repeat(40);
    expect(pinOf(undefined)).toBe("none");
    expect(pinOf(`acme@${c}`)).toEqual({ team: "acme", commit: c });
    for (const bad of [`acme@${c.slice(1)}`, `../x@${c}`, `acme@${c}@x`, 7, `@${c}`]) {
      expect(pinOf(bad)).toBe("bad");
    }
  });
});

describe("agent-factory config and team (#229)", () => {
  it("config show prints each key's value, layer, file:line and class", async () => {
    const commit = commitTeam({ egress: { allow: ["a.example.com"] }, modes: { "egress.allow": "locked" } });
    const path = writeProject({ ...BASE, team: `acme@${commit}` });
    const r = await cli(["config", "show", "ledger"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^ready\.programs\s+\["make","npm"\]\s+project\s+\S+ledger\.json:4\s+allow-list$/m);
    expect(r.out).toMatch(
      /^egress\.allow\s+\["a\.example\.com"\]\s+team\s+\S+team\.json@\S+:3\s+allow-list \(team: locked\)$/m,
    );
    expect(r.out).toMatch(/^approval\.floor\s+"tiny"\s+engine\s+the engine\s+locked$/m);
    expect(r.out).toContain(path);
    const json = await cli(["config", "show", "ledger", "--json"]);
    expect(JSON.parse(json.out)).toContainEqual(
      expect.objectContaining({ key: "gate", value: "forge-ci", class: "locked" }),
    );
  });

  it("config check exits 0 on good layers, and 1 naming each error, including the readers'", async () => {
    writeProject(BASE);
    expect(await cli(["config", "check", "ledger"])).toMatchObject({ code: 0, out: "settings ok: ledger (no team)\n" });
    writeUser({ ready: { timeoutMinutes: 300 }, gat: "local" });
    const bad = await cli(["config", "check", "ledger"]);
    expect(bad.code).toBe(1);
    expect(bad.err).toContain("error: ready.timeoutMinutes in");
    expect(bad.err).toContain("warning:");
    expect(bad.err).toContain("did you mean gate?");
    rmSync(join(home, "user.json"));
    writeProject({ gate: "local", ready: { programs: ["make"] } });
    expect((await cli(["config", "check", "ledger"])).err).toContain('"verify" must be');
    expect((await cli(["config", "check", "nothere"])).code).toBe(1);
    expect((await cli(["config", "nope", "ledger"])).code).toBe(64);
    expect((await cli(["config", "toString", "ledger"])).code).toBe(64);
  });

  it("config check shows the Discord plugin's state, and a plugin not on is a warning, not an error (#555)", async () => {
    writeProject(BASE);
    const id = "discord@claude-plugins-official";
    const missing = await cli(["config", "check", "ledger"]);
    expect(missing.code).toBe(0);
    expect(missing.err).toContain(`warning: claude plugin ${id}: not installed`);
    const file = discordOn();
    const on = await cli(["config", "check", "ledger"]);
    expect(on).toMatchObject({ code: 0, err: "" });
    expect(on.out).toContain(`claude plugin ${id}: on (user, ${file})`);
  });

  it("config check refuses a clone whose origin is not the project's repo, naming both URLs (#640)", async () => {
    const clone = join(home, "clone");
    mkdirSync(clone);
    const git = (args: readonly string[]): void => {
      execFileSync("git", ["-C", clone, ...args], { env: GIT_ENV, stdio: "ignore" });
    };
    git(["init", "-q"]);
    git(["remote", "add", "origin", "https://github.com/someone/ledger.git"]);
    writeProject({ ...BASE, clone, gitHostProject: "chiyanram/ledger" });
    const bad = await cli(["config", "check", "ledger"], { FACTORY_FORGE: "github" });
    expect(bad.code).toBe(1);
    expect(bad.err).toContain("https://github.com/someone/ledger.git");
    expect(bad.err).toContain("github.com/chiyanram/ledger");
    git(["remote", "set-url", "origin", "git@github.com:ChiyanRam/ledger.git"]);
    expect(await cli(["config", "check", "ledger"], { FACTORY_FORGE: "github" })).toMatchObject({ code: 0 });
  });

  it("team update shows the change, checks it, then moves the pin; a failed check keeps the pin", async () => {
    const first = commitTeam({ ready: { timeoutMinutes: 60 } });
    const path = writeProject({ ...BASE, team: `acme@${first}` });
    const second = commitTeam({ ready: { timeoutMinutes: 45 }, connectors: { notify: "discord" } });
    const r = await cli(["team", "update", "ledger"]);
    expect(r).toMatchObject({ code: 0, err: "" });
    expect(r.out).toContain('connectors: {} -> {"notify":"discord"}');
    expect(r.out).toContain(`pinned acme@${second}`);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ ...BASE, team: `acme@${second}` });
    expect((await cli(["team", "update", "ledger"])).out).toContain("already pinned");

    commitTeam({ ready: { timeoutMinutes: 10 } });
    const refused = await cli(["team", "update", "ledger"]);
    expect(refused.code).toBe(1);
    expect(refused.out).toContain("ready.timeoutMinutes: 30 -> 10");
    expect(refused.err).toContain("30 is higher than 10");
    expect(refused.err).toContain(`the pin stays at ${second.slice(0, 12)}`);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ ...BASE, team: `acme@${second}` });
  });

  it("team update refuses a project with no pin, a commit that is not one, and bad words", async () => {
    writeProject(BASE);
    expect((await cli(["team", "update", "ledger"])).err).toContain("pins no team");
    commitTeam({});
    writeProject({ ...BASE, team: `acme@${"b".repeat(40)}` });
    expect((await cli(["team", "update", "ledger", "HEAD"])).err).toContain("is not a full commit id");
    expect((await cli(["team", "nope"])).code).toBe(64);
  });
});

describe("every module reads the resolved settings (#254)", () => {
  const withEnv = (layers: readonly FileLayer[], env: NodeJS.ProcessEnv): ReturnType<typeof resolve> =>
    resolve({ layers, modes: modesOf(layers.find((l) => l.name === "team")).modes, env, problems: [] });

  it("a machine key resolves through the files and its variable, the lowest layer, by its class", () => {
    const team = layer("team", { caps: { usdPerRun: 1 }, implementer: { model: "opus" } });
    const capped = withEnv([team], {});
    expect(valueOf(capped, "caps.usdPerRun")).toMatchObject({ value: 1, sources: [{ layer: "team" }] });
    expect(settingOf(runEnv({}, capped), "caps.usdPerRun")).toBe("1");
    expect(maxUsd(runEnv({}, capped))).toEqual({ kind: "ok", value: "1" });
    const lower = withEnv([team], { FACTORY_MAX_USD: "0.5", FACTORY_WRITER_MODEL: "sonnet" });
    expect(valueOf(lower, "caps.usdPerRun")).toMatchObject({ value: 0.5, sources: [{ layer: "machine" }] });
    expect(valueOf(lower, "implementer.model")?.value).toBe("sonnet");
    expect(errors(lower)).toEqual([]);
    const looser = withEnv([team], { FACTORY_MAX_USD: "5" });
    expect(errors(looser)).toEqual([
      "caps.usdPerRun: the machine layer (env FACTORY_MAX_USD) 5 is higher than 1; a cap key only gets stricter in a lower layer, and 1 comes from /team.json:3",
    ]);
    expect(errors(withEnv([team], { FACTORY_MAX_USD: "" }))[0]).toContain("cannot be compared");
  });

  it("a team's ticket and day caps reach the dispatcher, and a variable can only lower them (#131)", () => {
    const team = layer("team", { caps: { usdPerTicket: 3, tokensPerProjectDay: 5000 } });
    const fromTeam = withEnv([team], {});
    expect(capsOf(runEnv({}, fromTeam))).toMatchObject({
      kind: "ok",
      value: { ticket: { usd: 3 }, day: { tokens: 5000 } },
    });
    expect(errors(withEnv([team], { FACTORY_MAX_USD_TICKET: "4" }))[0]).toContain(
      "caps.usdPerTicket: the machine layer (env FACTORY_MAX_USD_TICKET) 4 is higher than 3",
    );
    expect(errors(withEnv([team], { FACTORY_MAX_TOKENS_DAY: "100" }))).toEqual([]);
  });

  it("the run hours are a cap a lower layer can only narrow, and runs at once a cap (#299)", () => {
    const team = layer("team", { runHours: "22-06", caps: { liveRuns: 2 } });
    const narrow = { FACTORY_RUN_HOURS: "23-05" };
    expect(capsOf(runEnv(narrow, withEnv([team], narrow)))).toMatchObject({
      kind: "ok",
      value: { runsAtOnce: 2, runHours: { text: "23-05" } },
    });
    expect(errors(withEnv([team], { FACTORY_RUN_HOURS: "20-06" }))[0]).toContain(
      'runHours: the machine layer (env FACTORY_RUN_HOURS) "20-06" is not within "22-06"',
    );
    expect(errors(withEnv([team], { FACTORY_MAX_RUNS: "3" }))[0]).toContain("3 is higher than 2");
    expect(errors(withEnv([layer("user", { runHours: "9-17" })], {}))[0]).toContain(
      'runHours in /user.json:2 must be hours in UTC as "HH-HH"',
    );
  });

  it("the runner kind is a ladder, none < srt < vm: a lower layer may climb, never loosen (#114)", () => {
    const team = layer("team", { runner: "srt" });
    expect(errors(withEnv([team], { FACTORY_BOX: "vm" }))).toEqual([]);
    expect(errors(withEnv([team], { FACTORY_BOX: "none" }))[0]).toContain("is looser");
    expect(errors(withEnv([layer("team", { runner: "vm" })], { FACTORY_BOX: "srt" }))[0]).toContain("is looser");
    expect(runEnv({}, withEnv([layer("user", { runner: "srt" })], {}))).toMatchObject({ FACTORY_BOX: "srt" });
    expect(errors(withEnv([layer("user", { runner: "laptop" })], {}))[0]).toContain('"none", "srt", "vm"');
  });

  it("the company CA is a preference key in NODE_EXTRA_CA_CERTS, an absolute path (#114)", () => {
    expect(runEnv({}, withEnv([layer("user", { egress: { caCerts: "/etc/ca.pem" } })], {}))).toMatchObject({
      NODE_EXTRA_CA_CERTS: "/etc/ca.pem",
    });
    expect(errors(withEnv([layer("user", { egress: { caCerts: "ca.pem" } })], {}))[0]).toContain(
      "an absolute file path",
    );
  });

  it("runEnv puts only a file's values in the variables; a variable alone stays exactly as it is", () => {
    const env = { FACTORY_MAX_USD: "2.50", FACTORY_DRY_RUN: "1" };
    expect(runEnv(env, withEnv([], env))).toEqual(env);
    const user = layer("user", { dryRun: "1", quietMinutes: 10 });
    expect(runEnv({}, withEnv([user], {}))).toMatchObject({ FACTORY_DRY_RUN: "1", FACTORY_QUIET_MINUTES: "10" });
    expect(errors(withEnv([layer("team", { dryRun: "1" })], { FACTORY_DRY_RUN: "0" }))[0]).toContain("is looser");
    expect(errors(withEnv([layer("user", { caps: { usdPerRun: "lots" } })], {}))[0]).toContain("a dollar amount");
  });

  it("a team file's spend cap stops a run: dispatch and review refuse a looser variable, naming the key", async () => {
    const commit = commitTeam({ caps: { usdPerRun: 1 } });
    writeProject({ ...BASE, team: `acme@${commit}` });
    for (const argv of [
      ["dispatch", "ledger", "--once"],
      ["review", "ledger", "7"],
    ]) {
      const r = await cli(argv, { FACTORY_MAX_USD: "5" });
      expect(r.code).toBe(1);
      expect(r.err).toContain("the settings layers refuse to start: caps.usdPerRun: the machine layer");
      expect(r.err).toContain("and 1 comes from ");
    }
  });

  it("config set refuses a project it cannot find, an unknown key and the team pin, and writes nothing", async () => {
    expect((await cli(["config", "set", "ledger", "gate", "local"])).err).toContain("no project file");
    expect((await cli(["config", "set", "../x", "gate", "local"])).err).toContain("is not a plain project name");
    const path = writeProject(BASE);
    const unknown = await cli(["config", "set", "ledger", "gat", "local"]);
    expect(unknown).toMatchObject({ code: 1 });
    expect(unknown.err).toContain("gat is not a settings key; did you mean gate?");
    expect((await cli(["config", "set", "ledger", "team", "acme@x"])).err).toContain("agent-factory team update");
    expect((await cli(["config", "set", "ledger", "gate"])).code).toBe(64);
    expect(readFileSync(path, "utf8")).toBe(text(BASE));
  });

  it("config set writes one key as JSON or as text, keeps every other byte, and prints config show's line", async () => {
    const path = writeProject(BASE);
    const r = await cli(["config", "set", "ledger", "ready.timeoutMinutes", "45"]);
    expect(r).toMatchObject({ code: 0, err: "" });
    expect(r.out).toMatch(/^ready\.timeoutMinutes\s+45\s+project\s+\S+ledger\.json:8\s+cap$/m);
    expect(readFileSync(path, "utf8")).toBe(text(BASE).replace('"timeoutMinutes": 30', '"timeoutMinutes": 45'));
    await cli(["config", "set", "ledger", "ready.programs", '["make"]']);
    await cli(["config", "set", "ledger", "eval.judgeModel", "claude-sonnet-5-5"]);
    expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({
      ready: { programs: ["make"], timeoutMinutes: 45 },
      eval: { judgeModel: "claude-sonnet-5-5" },
    });
    expect((await cli(["config", "set", "ledger", "ready.timeoutMinutes", "45"])).out).toContain("unchanged");
    expect((await cli(["config", "check", "ledger"])).code).toBe(0);
  });

  it("config set refuses a value the project file's readers refuse, and an error the file had stays a warning", async () => {
    const path = writeProject(BASE);
    const bad = await cli(["config", "set", "ledger", "gate", "banana"]);
    expect(bad.code).toBe(1);
    expect(bad.err).toContain('"gate" must be "forge-ci" or "local", got "banana"');
    expect(readFileSync(path, "utf8")).toBe(text(BASE));
    writeProject({ ...BASE, gate: "local" });
    const ok = await cli(["config", "set", "ledger", "ready.timeoutMinutes", "45"]);
    expect(ok.code).toBe(0);
    expect(ok.err).toContain("warning: ");
    expect(ok.err).toContain('"verify" must be');
  });

  it("config set refuses a value looser than a higher layer, naming where the higher value comes from", async () => {
    const commit = commitTeam({ ready: { timeoutMinutes: 20 } });
    const path = writeProject({ ...BASE, ready: { programs: ["make"] }, team: `acme@${commit}` });
    const before = readFileSync(path, "utf8");
    const team = await cli(["config", "set", "ledger", "ready.timeoutMinutes", "60"]);
    expect(team.code).toBe(1);
    expect(team.err).toMatch(
      /the project layer \(\S+ledger\.json:\d+\) 60 is higher than 20; .* 20 comes from \S+team\.json@\S+:3/,
    );
    const engine = await cli(["config", "set", "ledger", "approval.floor", "bug"]);
    expect(engine.code).toBe(1);
    expect(engine.err).toContain('"tiny" comes from the engine');
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("config set writes the other half of a new policy point at its resolved value", async () => {
    const path = writeProject(BASE);
    const r = await cli(["config", "set", "ledger", "policy.tracker.comment.mode", "deny"]);
    expect(r).toMatchObject({ code: 0, err: "" });
    expect(r.out).toMatch(/^policy\.tracker\.comment\.cap\s/m);
    expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({
      policy: { "tracker.comment": { mode: "deny", cap: expect.any(Number) } },
    });
  });

  it("config set warns when a lower layer wins, and refuses a write that makes a lower layer's value an error", async () => {
    writeProject(BASE);
    writeUser({ eval: { judgeModel: "claude-opus-5-5" } });
    const user = await cli(["config", "set", "ledger", "eval.judgeModel", "claude-sonnet-5-5"]);
    expect(user.code).toBe(0);
    expect(user.err).toMatch(/warning: eval\.judgeModel: \S+user\.json:\d+ wins over the project file/);
    rmSync(join(home, "user.json"));
    const variable = await cli(["config", "set", "ledger", "window.hours", "6"], { FACTORY_WINDOW_HOURS: "4" });
    expect(variable.err).toContain("warning: window.hours: env FACTORY_WINDOW_HOURS wins over the project file");
    writeUser({ ready: { timeoutMinutes: 25 } });
    const lower = await cli(["config", "set", "ledger", "ready.timeoutMinutes", "20"]);
    expect(lower.code).toBe(1);
    expect(lower.err).toMatch(/the user layer \(\S+user\.json:3\) 25 is higher than 20/);
  });

  it("saveFile refuses a file that changed since it was checked, and leaves no temporary file", async () => {
    const path = writeProject(BASE);
    expect(await saveFile(path, "{}\n", "{}\n")).toMatchObject({ kind: "failed" });
    expect(readFileSync(path, "utf8")).toBe(text(BASE));
    expect(await saveFile(join(home, "nothere", "x.json"), "", "{}")).toMatchObject({ kind: "failed" });
    expect(execFileSync("ls", [join(home, "projects")], { encoding: "utf8" })).toBe("ledger.json\n");
  });

  it("a run prints the unknown-key warnings", async () => {
    writeProject({ ...BASE, gatee: "local" });
    const r = await cli(["review", "ledger", "7"], { FACTORY_DRY_RUN: "1" });
    expect(r.err).toContain("agent-factory review: warning: ");
    expect(r.err).toContain("unknown key gatee; did you mean gate?");
  });

  it("ready.judgeFiles is a deny-list key: every layer adds, and the reader gets them all", async () => {
    const commit = commitTeam({ ready: { judgeFiles: ["ci/**"] } });
    writeProject({ ...BASE, team: `acme@${commit}`, ready: { ...BASE.ready, judgeFiles: ["build/**"] } });
    writeUser({ ready: { judgeFiles: ["ci/**", "deploy/**"] } });
    expect(await readProjectFile({ home, project: "ledger" })).toMatchObject({
      kind: "ok",
      value: { ready: { judgeFiles: ["ci/**", "build/**", "deploy/**"] } },
    });
  });

  it("P9: the commit opt-in is off by default, a project may turn it on, and it is refused at work", () => {
    expect(valueOf(resolved([]), "repoCommits")?.value).toBe(false);
    const on = resolved([layer("project", { repoCommits: true })]);
    expect(valueOf(on, "repoCommits")?.value).toBe(true);
    expect(errors(on)).toEqual([]);
    const userOff = resolved([layer("project", { repoCommits: true }), layer("user", { repoCommits: false })]);
    expect(valueOf(userOff, "repoCommits")?.value).toBe(false);
    const atWork = resolved([layer("team", { work: true }), layer("project", { repoCommits: true })]);
    expect(errors(atWork)).toEqual([
      "repoCommits: /project.json:2 opts in to commits to the product repo, and /team.json:2 marks the project as work, where nothing is ever committed (P9)",
    ]);
    const unmark = resolved([layer("team", { work: true }), layer("project", { work: false })]);
    expect(errors(unmark)[0]).toContain("work: the project layer (/project.json:2) false is looser than true");
    expect(errors(resolved([layer("project", { repoCommits: "yes" })]))[0]).toContain("must be true or false");
  });

  it("specStore is a ladder: local by default, a project may choose issue, local above wins, and work refuses issue (#381)", () => {
    expect(valueOf(resolved([]), "specStore")?.set).toBe(false);
    const issue = resolved([layer("project", { specStore: "issue" })]);
    expect(valueOf(issue, "specStore")?.value).toBe("issue");
    expect(errors(issue)).toEqual([]);
    const teamLocal = resolved([layer("team", { specStore: "local" }), layer("project", { specStore: "issue" })]);
    expect(errors(teamLocal)[0]).toContain(
      'specStore: the project layer (/project.json:2) "issue" is looser than "local"',
    );
    const userLocal = resolved([layer("project", { specStore: "issue" }), layer("user", { specStore: "local" })]);
    expect(valueOf(userLocal, "specStore")?.value).toBe("local");
    const atWork = resolved([layer("team", { work: true }), layer("project", { specStore: "issue" })]);
    expect(errors(atWork)).toEqual([
      'specStore: /project.json:2 keeps the specs in the git host issues, and /team.json:2 marks the project as work, where the spec stays local; set "specStore": "local"',
    ]);
    expect(errors(resolved([layer("project", { specStore: "jira" })]))[0]).toContain('one of "issue", "local"');
  });

  it("start resolves the project's layers, and poll and the note commands the user and machine layers", async () => {
    const commit = commitTeam({ caps: { usdPerRun: 1 } });
    writeProject({ ...BASE, team: `acme@${commit}` });
    const start = await cli(["start", "ledger", "5"], { FACTORY_MAX_USD: "5" });
    expect(start.code).toBe(1);
    expect(start.err).toContain("agent-factory start: ");
    expect(start.err).toContain("caps.usdPerRun: the machine layer");
    writeUser({ claimLabl: "x" });
    for (const argv of [["poll"], ["status", "5", "aaaa1111", "line"], ["ask", "5", "aaaa1111", "q"]]) {
      const r = await cli(argv);
      expect(r.err).toContain(`agent-factory ${argv[0]}: warning: `);
      expect(r.err).toContain("unknown key claimLabl; did you mean claimLabel?");
    }
    writeUser({ caps: { usdPerRun: "lots" } });
    const bad = await cli(["poll"]);
    expect(bad.code).toBe(1);
    expect(bad.err).toContain("caps.usdPerRun in");
  });

  it("the eval judge's spend cap and model are settings keys: a cap, and a preference", () => {
    const team = layer("team", { eval: { judgeUsdPerRun: 0.2, judgeModel: "claude-opus-5-5" } });
    const flags = { drafts: false, aim: "none" as const };
    expect(evalSettings(runEnv({}, withEnv([team], {})), flags)).toMatchObject({
      kind: "ok",
      value: { judgeUsd: "0.2", judgeModel: "claude-opus-5-5" },
    });
    expect(errors(withEnv([team], { FACTORY_JUDGE_MAX_USD: "1" }))[0]).toContain(
      "eval.judgeUsdPerRun: the machine layer (env FACTORY_JUDGE_MAX_USD) 1 is higher than 0.2",
    );
    expect(valueOf(withEnv([team], { FACTORY_JUDGE_MODEL: "claude-sonnet-5-5" }), "eval.judgeModel")?.value).toBe(
      "claude-sonnet-5-5",
    );
    const poll = layer("user", { poll: { minutes: 10 } });
    expect(settingOf(runEnv({}, withEnv([poll], {})), "poll.minutes")).toBe("10");
    expect(errors(withEnv([layer("user", { poll: { minutes: 90 } })], {}))[0]).toContain("from 1 to 60");
  });
});

describe("the reviewer's models, pinned to full ids (ADR-0015 E9, #213)", () => {
  it("tells a full model id from an alias", () => {
    const ids = ["claude-sonnet-5-5", "claude-opus-5-5", "claude-opus-4-5@20251101", "anthropic.claude-opus-5-5"];
    expect(ids.filter((id) => !pinnedModel(id))).toEqual([]);
    const aliases = ["sonnet", "opus", "haiku", "sonnet[1m]", "opusplan", "claude-sonnet-latest", "", 5, undefined];
    expect(aliases.filter((alias) => pinnedModel(alias))).toEqual([]);
  });

  it("defaults to full ids, which the eval's results file records", () => {
    expect(Object.values(REVIEW_MODELS).filter((id) => !pinnedModel(id))).toEqual([]);
    expect(paths({ FACTORY_REPO: "/r", FACTORY_RULEBOOK: "/b", FACTORY_HOME: "/h" }).kind).toBe("ok");
  });

  it("refuses an alias in a file layer and in the machine layer", () => {
    const team = layer("team", { review: { findModel: "sonnet" } });
    expect(errors(resolved([team]))).toEqual([
      'review.findModel in /team.json:3 must be a full model id, such as "claude-sonnet-5-5", never an alias such as "sonnet"',
    ]);
    expect(errors(resolved([layer("user", { eval: { judgeModel: "opus" } })]))[0]).toContain("eval.judgeModel");
    expect(errors(resolved([layer("user", { review: { logicModel: "claude-opus-5-5" } })]))).toEqual([]);
    const env = { FACTORY_REPO: "/r", FACTORY_RULEBOOK: "/b", FACTORY_HOME: "/h", FACTORY_RULE_MODEL: "sonnet" };
    expect(paths(env)).toEqual({
      kind: "failed",
      reason:
        'FACTORY_RULE_MODEL must be a full model id, such as "claude-sonnet-5-5", never an alias such as "sonnet", got "sonnet"',
    });
    expect(paths({ ...env, FACTORY_RULE_MODEL: "claude-sonnet-5-5" }).kind).toBe("ok");
  });
});

describe("the read-only runs' time limits (ADR-0012 S7, P7)", () => {
  const withEnv = (layers: readonly FileLayer[], env: NodeJS.ProcessEnv): ReturnType<typeof resolve> =>
    resolve({ layers, modes: modesOf(layers.find((l) => l.name === "team")).modes, env, problems: [] });

  it("are cap keys from 1 to 60, which a lower layer may only lower", () => {
    const team = layer("team", { review: { finderMinutes: 10 }, design: { minutes: 30 }, eval: { judgeMinutes: 5 } });
    expect(settingOf(runEnv({}, withEnv([team], {})), "review.finderMinutes")).toBe("10");
    expect(errors(withEnv([team], { FACTORY_FINDER_MINUTES: "15" }))[0]).toContain(
      "review.finderMinutes: the machine layer (env FACTORY_FINDER_MINUTES) 15 is higher than 10",
    );
    expect(errors(withEnv([layer("user", { onboard: { minutes: 61 } })], {}))[0]).toContain("from 1 to 60");
    expect(errors(withEnv([layer("user", { retro: { minutes: 0 } })], {}))[0]).toContain("from 1 to 60");
  });

  it("reach the review's finder and verify pass runs through paths", () => {
    const env = { FACTORY_REPO: "/r", FACTORY_HOME: "/h", FACTORY_VERIFY_MINUTES: "9" };
    expect(paths(env)).toMatchObject({
      kind: "ok",
      value: {
        limits: {
          finder: { minutes: 20, setting: "FACTORY_FINDER_MINUTES" },
          verify: { minutes: 9, setting: "FACTORY_VERIFY_MINUTES" },
        },
      },
    });
    expect(paths({ ...env, FACTORY_FINDER_MINUTES: "x" })).toEqual({
      kind: "failed",
      reason: "FACTORY_FINDER_MINUTES must be a whole number from 1 to 60",
    });
  });

  it("reach the eval's finder, verify and judge runs", () => {
    const flags = { drafts: false, aim: "none" as const };
    expect(evalSettings({ FACTORY_JUDGE_MINUTES: "3" }, flags)).toMatchObject({
      kind: "ok",
      value: {
        limits: {
          finder: { minutes: 20, setting: "FACTORY_FINDER_MINUTES" },
          verify: { minutes: 20, setting: "FACTORY_VERIFY_MINUTES" },
          judge: { minutes: 3, setting: "FACTORY_JUDGE_MINUTES" },
        },
      },
    });
    expect(evalSettings({ FACTORY_JUDGE_MINUTES: "90" }, flags)).toEqual({
      kind: "failed",
      reason: "FACTORY_JUDGE_MINUTES must be a whole number from 1 to 60",
    });
  });
});

describe("connectors and the plugin list (#232)", () => {
  it("reads the connectors with no warning", async () => {
    writeProject({ ...BASE, connectors: { notify: "discord" } });
    discordOn();
    const now = await readPluginConfig({ home, project: "ledger" });
    expect(now).toMatchObject({ kind: "ok" });
    expect(now.kind === "ok" ? [...now.value.plugins] : []).toEqual([["notify", "discord"]]);
    expect((await cli(["config", "check", "ledger"])).err).not.toContain("warning");
  });

  it("should refuse an old plugins map with a message that names the new form when the engine reads it (AC-1)", async () => {
    const path = writeProject({ ...BASE, plugins: { notify: "discord" } });
    expect(pluginListOf(path, { plugins: { notify: "discord" } })).toEqual({
      kind: "failed",
      reason: `${path}: a map of connectors is no longer read under "plugins": rename the key to "connectors"`,
    });
    const checked = await cli(["config", "check", "ledger"]);
    expect(checked.code).not.toBe(0);
    expect(checked.err).toContain('rename the key to "connectors"');
  });

  it("refuses a bad connector map, and reads connectors beside a plugin list", () => {
    expect(pluginConfigOf("/p.json", { connectors: ["discord"] })).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining('"connectors" must map extension points to connector names'),
    });
    const both = pluginConfigOf("/p.json", { connectors: { notify: "discord" }, plugins: ["rulebook@chiyanram"] });
    expect(both.kind === "ok" ? [...both.value.plugins] : []).toEqual([["notify", "discord"]]);
  });

  it("reads the plugin list in order: name@marketplace, each name once; none is the built-in process", () => {
    expect(pluginListOf("/p.json", {})).toEqual({ kind: "ok", value: [] });
    expect(pluginListOf("/p.json", { plugins: ["rulebook@chiyanram", "team-rules@acme"] })).toEqual({
      kind: "ok",
      value: [
        { name: "rulebook", marketplace: "chiyanram" },
        { name: "team-rules", marketplace: "acme" },
      ],
    });
    const bad = ["rulebook", "a@b@c", "../x@y", "a..b@c", ".a@b", "-a@b", "a b@c", "a/b@c", "", 7];
    for (const entry of bad) {
      expect(pluginListOf("/p.json", { plugins: [entry] })).toMatchObject({
        kind: "failed",
        reason: expect.stringContaining('"plugins" must be a list of plugins'),
      });
    }
    expect(pluginListOf("/p.json", { plugins: ["a@x", "a@y"] })).toMatchObject({ kind: "failed" });
    expect(pluginListOf("/p.json", { plugins: "rulebook@chiyanram" })).toMatchObject({ kind: "failed" });
  });

  it("AC-17 should accept a plugin name when Claude Code accepts it, and refuse it when Claude Code refuses it", () => {
    const long = `${"a".repeat(100)}@${"B".repeat(100)}`;
    for (const entry of ["Rulebook@Chiyanram", "team_rules@acme.io", "a.b-c_d@0x", long]) {
      expect(pluginListOf("/p.json", { plugins: [entry] })).toMatchObject({ kind: "ok" });
    }
    for (const entry of ["_a@b", "a@.b", "a@b..c", "a@b/c"]) {
      expect(pluginListOf("/p.json", { plugins: [entry] })).toMatchObject({ kind: "failed" });
    }
  });

  it("config check refuses a bad plugin list in the project file, and in a user file", async () => {
    writeProject({ ...BASE, plugins: ["rulebook"] });
    const r = await cli(["config", "check", "ledger"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain('"plugins" must be a list of plugins');
    writeProject({ ...BASE, plugins: ["rulebook@chiyanram"] });
    writeUser({ plugins: [] });
    const user = await cli(["config", "check", "ledger"]);
    expect(user.code).toBe(1);
    expect(user.err).toContain("plugins: the user layer");
  });
});
