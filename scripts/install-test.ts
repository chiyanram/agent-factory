// install-test — the clean-machine install test (#485): the built package, installed as a person installs it, then
// the setup commands on a fresh home, against a fake git host. CI runs it on Ubuntu and on macOS, and the release runs
// CI first, so a failure blocks a release.
//
//   node scripts/install-test.ts      (after npm ci; CI's install-test and test-macos jobs)
//
// It packs the package, installs the tarball with npm into an empty prefix, makes a fresh HOME with no FACTORY_*
// variable and no git config, and a small clone on main, with one commit, whose origin is a GitHub project. The
// programs a person's machine would hold are faked, in a folder on PATH before the system's: `gh` answers the git host's
// API for that project from canned replies (a fake git host), and `claude` and `srt` answer as the pinned versions do.
// Then:
//   1. agent-factory --version                  prints the package's version
//   2. agent-factory init demo --yes            writes user.json, the project file and the coordinator's settings; only
//                                               the model login, which no machine has before a person logs in, may fail
//   3. agent-factory start demo 1 --no-loop     a person's START on issue 1, whose body is the spec
//   4. agent-factory dispatch demo --dry-run    reaches the decision table, exits 0 and names a decision for ticket 1
// A signal, a spawn error, a stack trace or an uncaught error fails it; so does any non-zero exit of start or the dry
// run, any failed init check but the model login, and a pin of rulebook@chiyanram at any commit but the one
// .github/rules-pack.json names (#607).
//
// Runs on Node's type stripping (Node 22.18+), so it uses only erasable TypeScript.

import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type Ran = {
  readonly code: number | null;
  readonly signal: string | null;
  readonly error: string;
  readonly out: string;
  readonly err: string;
};

export type Seen = {
  readonly version: Ran;
  readonly init: Ran;
  readonly start: Ran;
  readonly dispatch: Ran;
  readonly branch: string;
  readonly files: Readonly<Record<string, boolean>>;
  readonly pin: { readonly written: string; readonly engine: string };
};

export const ALLOWED_FAILED = [/^claude token: none on record$/];

const CRASH = /^\s+at \S|^(?:\w*Error|Error)(?: \[[A-Z_]+\])?: |\bERR_[A-Z_]{3,}\b/m;

function ended(what: string, r: Ran): readonly string[] {
  return [
    ...(r.signal === null ? [] : [`agent-factory ${what} was ended by ${r.signal}`]),
    ...(r.error === "" ? [] : [`agent-factory ${what} could not run: ${r.error}`]),
    ...(CRASH.test(r.out + r.err) ? [`agent-factory ${what} crashed: ${(r.out + r.err).trim().slice(0, 400)}`] : []),
  ];
}

function exitOk(what: string, r: Ran): readonly string[] {
  return r.code === 0 ? [] : [`agent-factory ${what} exited ${String(r.code)}: ${r.err.trim().slice(0, 300)}`];
}

function versionProblems(r: Ran, version: string): readonly string[] {
  return r.code === 0 && r.out.trim() === version
    ? []
    : [`agent-factory --version printed ${JSON.stringify(r.out.trim())}, not ${version}`];
}

export function failedChecks(out: string): readonly string[] {
  return out.split("\n").flatMap((line) => {
    const m = /^\s*✗ (.+)$/.exec(line);
    return m === null ? [] : [m[1] ?? ""];
  });
}

function initProblems(seen: Seen): readonly string[] {
  const failed = failedChecks(seen.init.out).filter((c) => !ALLOWED_FAILED.some((a) => a.test(c)));
  const exit =
    seen.init.code === 0 || seen.init.code === 1 ? [] : [`agent-factory init exited ${String(seen.init.code)}`];
  const refused = seen.init.err.includes("agent-factory init:")
    ? [`agent-factory init refused: ${seen.init.err.trim()}`]
    : [];
  const missing = Object.entries(seen.files).flatMap(([file, there]) => (there ? [] : [`init left no ${file}`]));
  return [...exit, ...refused, ...failed.map((c) => `init check failed: ${c}`), ...missing];
}

function decided(r: Ran): readonly string[] {
  return /^1: \S/m.test(r.out)
    ? []
    : [`agent-factory dispatch --dry-run named no decision for ticket 1: ${r.out.trim()}`];
}

function onMain(branch: string): readonly string[] {
  return branch === "main" ? [] : [`the demo clone is on ${JSON.stringify(branch)}, not main`];
}

function pinProblems(pin: Seen["pin"]): readonly string[] {
  if (pin.engine === "") {
    return ["the engine's rules-pack pin (.github/rules-pack.json) has no commit"];
  }
  return pin.written === pin.engine
    ? []
    : [
        `init pinned rulebook@chiyanram at ${pin.written === "" ? "nothing" : pin.written}, not the engine's rules-pack pin ${pin.engine}`,
      ];
}

export function problems(seen: Seen, version: string): readonly string[] {
  return [
    ...ended("--version", seen.version),
    ...ended("init", seen.init),
    ...ended("start", seen.start),
    ...ended("dispatch", seen.dispatch),
    ...versionProblems(seen.version, version),
    ...initProblems(seen),
    ...exitOk("start", seen.start),
    ...exitOk("dispatch --dry-run", seen.dispatch),
    ...decided(seen.dispatch),
    ...onMain(seen.branch),
    ...pinProblems(seen.pin),
  ];
}

const SPEC = [
  "# 1: the readme names the project",
  "",
  "## Intent",
  "",
  "The readme says what demo is.",
  "",
  "## Acceptance criteria",
  "",
  "1. README.md names demo.",
  "",
  "## Design",
  "",
  "none",
  "",
  "## Lane",
  "",
  "tiny",
  "",
].join("\n");

const FAKE_GH = `#!/usr/bin/env node
const fs = require("fs");
const args = process.argv.slice(2);
if (process.env.FAKE_GH_LOG) fs.appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify(args) + "\\n");
const reply = (status, body) => {
  process.stdout.write("HTTP/2.0 " + status + " X\\r\\nContent-Type: application/json\\r\\n\\r\\n" + JSON.stringify(body));
  process.exit(status >= 400 ? 1 : 0);
};
if (args[0] !== "api") { process.stderr.write("fake gh: only api\\n"); process.exit(1); }
const query = (args.find((a) => a.startsWith("query=")) || "").slice(6);
const page = { hasNextPage: false, endCursor: null };
if (args.includes("graphql")) {
  if (query.includes("collaborators(")) reply(200, { data: { repository: { collaborators: { pageInfo: page, edges: [{ permission: "ADMIN", node: { login: "demo-bot" } }] } } } });
  if (query.includes("pullRequests(")) reply(200, { data: { repository: { pullRequests: { pageInfo: page, nodes: [] } } } });
  reply(200, { errors: [{ message: "fake gh: no answer for this query" }] });
}
const path = args.find((a, i) => i > 0 && !a.startsWith("-") && args[i - 1] !== "-X") || "";
if (path === "user") reply(200, { login: "demo-bot" });
if (path === "repos/example/demo") reply(200, { default_branch: "main", full_name: "example/demo" });
if (path.startsWith("repos/example/demo/git/matching-refs/")) reply(200, []);
if (path === "repos/example/demo/issues/1") reply(200, { number: 1, body: ${JSON.stringify(SPEC)} });
if (path.startsWith("repos/example/demo/pulls")) reply(200, []);
if (path.startsWith("repos/chiyanram/agent-factory/releases")) reply(404, { message: "Not Found" });
reply(404, { message: "Not Found" });
`;

function fakeVersion(text: string): string {
  return `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(`${text}\n`)});\n`;
}

function fakes(root: string, srtVersion: string): string {
  const dir = join(root, "fakes");
  mkdirSync(dir);
  for (const [name, text] of [
    ["gh", FAKE_GH],
    ["claude", fakeVersion("2.0.0 (Claude Code)")],
    ["srt", fakeVersion(srtVersion)],
  ] as const) {
    writeFileSync(join(dir, name), text);
    chmodSync(join(dir, name), 0o755);
  }
  return dir;
}

function run(file: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv): Ran {
  const r = spawnSync(file, [...args], { cwd, env, encoding: "utf8", timeout: 5 * 60 * 1000 });
  return {
    code: r.status,
    signal: r.signal,
    error: r.error === undefined ? "" : r.error.message,
    out: r.stdout ?? "",
    err: r.stderr ?? "",
  };
}

function installed(
  root: string,
  repo: string,
  srtVersion: string,
): { readonly bin: string; readonly env: NodeJS.ProcessEnv } {
  const packs = join(root, "packs");
  mkdirSync(packs);
  execFileSync("npm", ["pack", "--silent", "--pack-destination", packs], { cwd: repo, stdio: "inherit" });
  const tarball = readdirSync(packs).find((f) => f.endsWith(".tgz")) ?? "";
  const prefix = join(root, "prefix");
  execFileSync("npm", ["install", "--global", "--prefix", prefix, "--no-audit", "--no-fund", join(packs, tarball)], {
    stdio: "inherit",
  });
  const home = join(root, "home");
  mkdirSync(home);
  const env: NodeJS.ProcessEnv = {
    PATH: `${join(prefix, "bin")}:${fakes(root, srtVersion)}:${process.env.PATH ?? ""}`,
    HOME: home,
    GIT_CONFIG_NOSYSTEM: "1",
    FAKE_GH_LOG: join(root, "gh.log"),
    ...(process.env.LANG === undefined ? {} : { LANG: process.env.LANG }),
  };
  return { bin: join(prefix, "bin", "agent-factory"), env };
}

function clone(root: string, env: NodeJS.ProcessEnv): string {
  const dir = join(root, "demo");
  mkdirSync(dir);
  const git = (...args: string[]) => execFileSync("git", ["-c", "init.defaultBranch=main", ...args], { cwd: dir, env });
  git("init", "-q");
  git("remote", "add", "origin", "https://github.com/example/demo.git");
  writeFileSync(join(dir, "package.json"), '{"name":"demo","scripts":{"test":"true"}}\n');
  git("add", ".");
  git("-c", "user.name=demo", "-c", "user.email=demo@example.invalid", "commit", "-q", "-m", "demo");
  return dir;
}

function field(path: string, keys: readonly string[]): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    return "";
  }
  const value = keys.reduce<unknown>(
    (v, k) => (typeof v === "object" && v !== null ? Reflect.get(v, k) : undefined),
    parsed,
  );
  return typeof value === "string" ? value : "";
}

function srtVersionOf(repo: string): string {
  const text = readFileSync(join(repo, "src", "core", "box", "srt-plan.ts"), "utf8");
  return /export const SRT_VERSION = "([^"]+)"/.exec(text)?.[1] ?? "";
}

function main(): number {
  const repo = process.cwd();
  const version = String(JSON.parse(readFileSync(join(repo, "package.json"), "utf8")).version);
  const root = mkdtempSync(join(realpathSync(tmpdir()), "factory-install-"));
  try {
    const { bin, env } = installed(root, repo, srtVersionOf(repo));
    const dir = clone(root, env);
    const factory = join(String(env.HOME), ".factory");
    const versionRan = run(bin, ["--version"], dir, env);
    const init = run(bin, ["init", "demo", "--yes"], dir, env);
    const start = run(bin, ["start", "demo", "1", "--no-loop"], dir, env);
    const seen: Seen = {
      version: versionRan,
      init,
      start,
      dispatch: run(bin, ["dispatch", "demo", "--dry-run"], dir, env),
      branch: execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: dir, env, encoding: "utf8" }).trim(),
      files: Object.fromEntries(
        ["user.json", "projects/demo.json", "coordinator/.claude/settings.json"].map((f) => [
          f,
          existsSync(join(factory, f)),
        ]),
      ),
      pin: {
        written: field(join(factory, "projects", "demo.plugins.json"), ["rulebook@chiyanram", "commit"]),
        engine: field(join(repo, ".github", "rules-pack.json"), ["commit"]),
      },
    };
    for (const [name, r] of Object.entries({ init: seen.init, start: seen.start, dispatch: seen.dispatch })) {
      process.stdout.write(`--- ${name} (exit ${String(r.code)})\n${r.out}${r.err}\n`);
    }
    const found = problems(seen, version);
    process.stdout.write(
      found.length === 0
        ? `install test: ok on ${process.platform}\n`
        : `install test failed:\n${found.map((p) => `  ${p}\n`).join("")}`,
    );
    return found.length === 0 ? 0 : 1;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

if (process.argv[1] === import.meta.filename) {
  process.exit(main());
}
