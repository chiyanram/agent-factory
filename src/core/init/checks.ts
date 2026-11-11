// checks — the pieces `agent-factory init` checks once the files are written (#369), each a ✓ or a ✗ with its fix:
// the pinned srt, the claude CLI, srt and agent-factory under the active Node, the model token's days left (read from
// its expiry record, never the token), the git host login for the project, the toolchain the project declares against
// the one PATH gives a run, and the coordinator's settings. Every program call goes through the probes, so a test runs
// none. It never runs a command only a human runs; a ✗ prints the command for the human.

import { join } from "node:path";
import type { Result, Runner } from "../forge/api.js";
import { SRT_INSTALL, SRT_VERSION } from "../box/srt-plan.js";
import { MANAGERS, tilde } from "../box/srt-toolchains.js";
import { under } from "../box/srt-programs.js";
import { tokenAge, tokenRecord, type Age, type Meta } from "../token/index.js";
import type { Declared, HostKind, Tool } from "./detect.js";

export type Check = { readonly ok: boolean; readonly line: string; readonly fix: string };

export type Probes = {
  readonly run: Runner;
  readonly env: NodeJS.ProcessEnv;
  // a program on PATH: the PATH entry it was found in, and its real path; none when PATH has none
  readonly which: (name: string) => Promise<{ readonly found: string; readonly real: string } | "none">;
  // the Node this command runs on
  readonly execPath: string;
  // the person's home, where the toolchain managers keep their installs
  readonly home: string;
  readonly platform: NodeJS.Platform;
  readonly now: Date;
  // this package's version
  readonly version: string;
  // the latest release's version (#482); none in a test
  readonly latest?: () => Promise<Result<string>>;
  // the project's default branch, read through the Forge seam with the project's identity: the login works
  readonly gitHost: (project: string) => Promise<Result<string>>;
  // the coordinator's settings hold its wall
  readonly wall: () => Promise<Result<string>>;
};

function pass(line: string): Check {
  return { ok: true, line, fix: "" };
}

function fail(line: string, fix: string): Check {
  return { ok: false, line, fix };
}

// the one-line install of this package's own release (GUIDE "Install a pinned version")
export function selfInstall(version: string): string {
  return `npm i -g https://github.com/chiyanram/agent-factory/releases/download/v${version}/chiyanram-agent-factory-${version}.tgz`;
}

function srtFix(platform: NodeJS.Platform): string {
  return platform === "linux" ? `${SRT_INSTALL} (and install bubblewrap, socat and ripgrep)` : SRT_INSTALL;
}

// srtCheck : srt on PATH at the pinned version; the pin moves only once a release's changes are reviewed (S7)
export async function srtCheck(p: Probes): Promise<Check> {
  const srt = await p.which("srt");
  if (srt === "none") {
    return fail("srt is not on PATH for the active Node", srtFix(p.platform));
  }
  const got = await p.run({ bin: srt.found, args: ["--version"], stdin: "", env: p.env });
  const version = got.stdout.trim();
  return got.code === 0 && version === SRT_VERSION
    ? pass(`srt ${SRT_VERSION}, the pinned version`)
    : fail(
        `srt is ${JSON.stringify(version || got.stderr.trim())}, not the pinned ${SRT_VERSION} (S7: a new srt is pinned only after its changes are reviewed)`,
        srtFix(p.platform),
      );
}

export async function claudeCheck(p: Probes): Promise<Check> {
  return (await p.which("claude")) === "none"
    ? fail("claude is not on PATH: runs need the claude CLI", "install Claude Code, then open a new shell")
    : pass("claude is on PATH");
}

// nodeCheck : agent-factory on PATH, under the Node that PATH gives (a Node upgrade leaves the old one's global
// packages behind)
export async function nodeCheck(p: Probes): Promise<Check> {
  const [self, node] = [await p.which("agent-factory"), await p.which("node")];
  const reinstall = `${selfInstall(p.version)} && ${SRT_INSTALL}`;
  if (self === "none") {
    return fail("agent-factory is not on PATH for the active Node", reinstall);
  }
  return node !== "none" && node.real !== p.execPath
    ? fail(
        `agent-factory runs on ${tilde(p.execPath, p.home)}, but PATH's node is ${tilde(node.real, p.home)}: after a Node switch, reinstall both under it`,
        reinstall,
      )
    : pass(`agent-factory ${p.version} on the active Node`);
}

const RENEW = "claude setup-token, then agent-factory setup claude (you run both; init never reads the token)";

// tokenCheck : the claude token's expiry on record, read without the token
export async function tokenCheck(home: string, now: Date): Promise<Check> {
  const meta = await tokenRecord(home, "claude");
  if (meta === "none") {
    return fail("claude token: none on record", RENEW);
  }
  return ageCheck(meta, tokenAge(meta, now));
}

function ageCheck(meta: Meta, age: Age): Check {
  switch (age.kind) {
    case "valid":
      return pass(`claude token: ${age.daysLeft} days left (expires ${meta.expiresAt})`);
    case "expiring":
      return fail(`claude token: expires in ${age.daysLeft} days (${meta.expiresAt})`, RENEW);
    case "expired":
      return fail(`claude token: expired at ${age.since}`, RENEW);
    case "unknown":
      return fail(`claude token: ${age.reason}`, RENEW);
  }
}

function loginFix(host: HostKind, hostName: string): string {
  if (host === "github") {
    return "gh auth login";
  }
  return `glab auth login --hostname ${hostName === "" ? "gitlab.com" : hostName}`;
}

export async function gitHostCheck(
  p: Probes,
  where: { readonly name: string; readonly host: HostKind; readonly hostName: string; readonly project: string },
): Promise<Check> {
  const branch = await p.gitHost(where.name);
  return branch.kind === "ok"
    ? pass(`${where.host}: ${where.project} answers with your login (default branch ${branch.value})`)
    : fail(`${where.host}: ${where.project} does not answer: ${branch.reason}`, loginFix(where.host, where.hostName));
}

export async function wallCheck(p: Probes): Promise<Check> {
  const wall = await p.wall();
  return wall.kind === "ok"
    ? pass("the coordinator's settings hold its wall")
    : fail(`the coordinator's settings: ${wall.reason}`, "agent-factory setup coordinator");
}

// the program each declared tool puts on PATH
const PROGRAMS: Readonly<Record<string, string>> = {
  java: "java",
  node: "node",
  nodejs: "node",
  python: "python3",
  go: "go",
  golang: "go",
  gradle: "gradle",
  maven: "mvn",
  ruby: "ruby",
};

// majorOf : the first number in a version, such as 27 in "temurin-27.0.1" or 25 in "25.0.1-tem"; "" when none. Pure.
export function majorOf(version: string): string {
  return /\d+/.exec(version)?.[0] ?? "";
}

// owner : the toolchain manager whose install folder holds a program's real path, and the version folder it sits in.
// Pure.
export function owner(real: string, home: string): { readonly manager: string; readonly version: string } | "none" {
  const m = MANAGERS.find((x) => under(real, join(home, x.installs)));
  if (m === undefined) {
    return "none";
  }
  const [, version = ""] = real.slice(join(home, m.installs).length + 1).split("/");
  return { manager: m.name, version };
}

// a .tool-versions file is read by mise as well as asdf
function sameManager(declared: Declared, manager: string): boolean {
  return declared.manager === manager || (declared.file === ".tool-versions" && manager === "mise");
}

function fixFor(declared: Declared): string {
  const m = MANAGERS.find((x) => x.name === declared.manager);
  return `put ${declared.manager}'s install first on PATH${m === undefined ? "" : `: ${m.fix}`}; load it after any other manager in your shell profile`;
}

// toolCheck : one declared tool against the program PATH resolves, which is the one a run gets (a run gets PATH,
// never JAVA_HOME); a ✗ names the manager that wins
export async function toolCheck(p: Probes, declared: Declared, tool: Tool): Promise<Check | "skip"> {
  const program = PROGRAMS[tool.name.replace(/^.*:/, "")];
  if (program === undefined) {
    return "skip";
  }
  const said = `${declared.file} declares ${tool.name} ${tool.version}`;
  const got = await p.which(program);
  return got === "none"
    ? fail(`${program} is not on PATH; ${said}`, `install it with ${declared.manager}, then ${fixFor(declared)}`)
    : resolvedTool({ program, said, declared, tool, real: got.real, home: p.home });
}

type Resolved = {
  readonly program: string;
  readonly said: string;
  readonly declared: Declared;
  readonly tool: Tool;
  readonly real: string;
  readonly home: string;
};

// matches : the program PATH gives is the declared manager's, at the declared major version
function matches(r: Resolved, found: { readonly manager: string; readonly version: string }): boolean {
  const wanted = majorOf(r.tool.version);
  return sameManager(r.declared, found.manager) && (wanted === "" || majorOf(found.version) === wanted);
}

function resolvedTool(r: Resolved): Check {
  const found = owner(r.real, r.home);
  const where = tilde(r.real, r.home);
  if (found !== "none" && matches(r, found)) {
    return pass(`${r.program}: ${found.manager} ${found.version}, as ${r.declared.file} declares`);
  }
  const winner =
    found === "none" ? `outside any known manager (${where})` : `${found.manager}'s ${found.version} (${where})`;
  return fail(
    `PATH's ${r.program} is ${winner}, but ${r.said}: a run gets only PATH, so it would use that one`,
    fixFor(r.declared),
  );
}

export async function toolchainChecks(p: Probes, declared: Declared | "none"): Promise<readonly Check[]> {
  if (declared === "none") {
    return [];
  }
  const each: Check[] = [];
  for (const tool of declared.tools) {
    const c = await toolCheck(p, declared, tool);
    if (c !== "skip") {
      each.push(c);
    }
  }
  return each;
}

// checkLines : each check as it prints: ✓ or ✗, and a ✗'s fix under it
export function checkLines(checks: readonly Check[]): string {
  return checks.map((c) => (c.ok ? `  ✓ ${c.line}\n` : `  ✗ ${c.line}\n      fix: ${c.fix}\n`)).join("");
}
