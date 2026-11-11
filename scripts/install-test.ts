// install-test — the clean-machine install test (#485): the built package, installed as a person installs it, then
// the three setup commands on a fresh home. CI runs it on Ubuntu and on macOS, and the release runs CI first, so a
// failure blocks a release.
//
//   node scripts/install-test.ts      (after npm ci; CI's install-test job)
//
// It packs the package, installs the tarball with npm into an empty prefix, makes a fresh HOME with no FACTORY_*
// variable and no git config, and a small clone whose origin is a GitHub project. Then, with only the installed
// program on PATH before the system's:
//   1. agent-factory --version              prints the package's version
//   2. agent-factory init demo --yes        writes user.json, the project file and the coordinator's settings; a check
//                                           that needs a login this machine lacks may fail (exit 1), a refusal may not
//   3. agent-factory dispatch demo --dry-run   ends with an answer, never a crash
// The git host is not faked: the dry run's poll may be refused for want of a login, and that is an answer.
//
// Runs on Node's type stripping (Node 22.18+), so it uses only erasable TypeScript.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type Ran = { readonly code: number; readonly out: string; readonly err: string };

export type Seen = {
  readonly version: Ran;
  readonly init: Ran;
  readonly dispatch: Ran;
  // the files init must leave, each with whether it is there
  readonly files: Readonly<Record<string, boolean>>;
};

// a crash, as Node prints one: a stack frame or an uncaught error's name
const CRASH = /^\s+at .+\(.+:\d+:\d+\)$|\b(?:TypeError|ReferenceError|SyntaxError|RangeError):|ERR_[A-Z_]+/m;

function versionProblems(r: Ran, version: string): readonly string[] {
  return r.code === 0 && r.out.trim() === version
    ? []
    : [`agent-factory --version printed ${JSON.stringify(r.out.trim())}, not ${version}`];
}

// answered : a command that ended with an answer, 0 or 1, never a signal or another code
function exitProblems(what: string, r: Ran): readonly string[] {
  return [0, 1].includes(r.code) ? [] : [`agent-factory ${what} exited ${r.code}`];
}

function initProblems(seen: Seen): readonly string[] {
  const refused = seen.init.err.includes("agent-factory init:")
    ? [`agent-factory init refused: ${seen.init.err.trim()}`]
    : [];
  const missing = Object.entries(seen.files).flatMap(([file, there]) => (there ? [] : [`init left no ${file}`]));
  return [...exitProblems("init", seen.init), ...refused, ...missing];
}

function crashes(rs: readonly Ran[]): readonly string[] {
  return rs.flatMap((r) => (CRASH.test(r.out + r.err) ? [`a crash: ${(r.out + r.err).trim().slice(0, 400)}`] : []));
}

// problems : what the install test found wrong, one line each; none means it passed. Pure.
export function problems(seen: Seen, version: string): readonly string[] {
  return [
    ...versionProblems(seen.version, version),
    ...initProblems(seen),
    ...exitProblems("dispatch --dry-run", seen.dispatch),
    ...crashes([seen.version, seen.init, seen.dispatch]),
  ];
}

function run(file: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv): Ran {
  const r = spawnSync(file, [...args], { cwd, env, encoding: "utf8", timeout: 5 * 60 * 1000 });
  return { code: r.status ?? 1, out: r.stdout ?? "", err: r.stderr ?? "" };
}

function installed(root: string, repo: string): { readonly bin: string; readonly env: NodeJS.ProcessEnv } {
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
  // a clean machine: the system's PATH after the install, a fresh HOME, no factory variable, no git config
  const env: NodeJS.ProcessEnv = {
    PATH: `${join(prefix, "bin")}:${process.env.PATH ?? ""}`,
    HOME: home,
    GIT_CONFIG_NOSYSTEM: "1",
    ...(process.env.LANG === undefined ? {} : { LANG: process.env.LANG }),
  };
  return { bin: join(prefix, "bin", "agent-factory"), env };
}

function clone(root: string, env: NodeJS.ProcessEnv): string {
  const dir = join(root, "demo");
  mkdirSync(dir);
  execFileSync("git", ["init", "-q"], { cwd: dir, env });
  execFileSync("git", ["remote", "add", "origin", "https://github.com/example/demo.git"], { cwd: dir, env });
  writeFileSync(join(dir, "package.json"), '{"name":"demo","scripts":{"test":"true"}}\n');
  return dir;
}

function main(): number {
  const repo = process.cwd();
  const version = String(JSON.parse(readFileSync(join(repo, "package.json"), "utf8")).version);
  const root = mkdtempSync(join(tmpdir(), "factory-install-"));
  try {
    const { bin, env } = installed(root, repo);
    const dir = clone(root, env);
    const factory = join(String(env.HOME), ".factory");
    const seen: Seen = {
      version: run(bin, ["--version"], dir, env),
      init: run(bin, ["init", "demo", "--yes"], dir, env),
      dispatch: { code: 0, out: "", err: "" },
      files: {},
    };
    const after: Seen = {
      ...seen,
      dispatch: run(bin, ["dispatch", "demo", "--dry-run"], dir, env),
      files: Object.fromEntries(
        ["user.json", "projects/demo.json", "coordinator/.claude/settings.json"].map((f) => [
          f,
          existsSync(join(factory, f)),
        ]),
      ),
    };
    for (const [name, r] of Object.entries({ init: after.init, dispatch: after.dispatch })) {
      process.stdout.write(`--- ${name} (exit ${r.code})\n${r.out}${r.err}\n`);
    }
    const found = problems(after, version);
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
