// git — every git call the package makes on a project's clone, hardened against a planted hook or repo config
// (#87; ADR-0012 S12). The same rules as scripts/lib/git.sh, which the bash scripts use; keep the two in step.
//
// A branch or a writer can write the repo's own config (.git/config, a worktree's config.worktree, a file they include)
// or a hook. Plain git on the host would then run that program as the operator, outside any box. hostGit runs git so
// that every key that names a program comes from trusted config only:
//   trusted   the system and global config: the operator's own
//   untrusted the repo's local and worktree config, and what it includes: a branch or a writer may have written it
// Each such key gets its last trusted value or a neutral one, passed as GIT_CONFIG_COUNT entries (command scope), as
// Sandcastle's src/hostGitConfig.ts does (study on #83, section 3.3). A repo-set key that has no safe neutral value and
// no trusted one is refused, and git does not run. git and every program it starts come only from the trusted PATH,
// with GIT_TERMINAL_PROMPT=0. Without a repo, git runs from /, so it reads no repo's config. A failed read of the
// repo's keys, or a GIT_CONFIG_COUNT that is not a whole number, is refused: nothing is ever run unchecked.
// Every outcome is a sealed result; nothing here throws, and no null stands for a decision.

import { execFile } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { delimiter, join, resolve, sep } from "node:path";

export type RepoTarget = { readonly kind: "repo"; readonly path: string } | { readonly kind: "none" };
export type OwnHelper = { readonly kind: "helper"; readonly value: string } | { readonly kind: "none" };
export type Input = { readonly kind: "text"; readonly text: string } | { readonly kind: "none" };

export type GitRequest = {
  readonly args: readonly string[];
  // the clone to run in; "none" runs git outside any repo
  readonly repo: RepoTarget;
  // the environment git starts from: normally process.env
  readonly env: NodeJS.ProcessEnv;
  // the factory's own GitHub App helper ("!<path>/github-app.sh git-credential"), the one repo-set helper kept
  readonly ownHelper: OwnHelper;
  readonly stdin: Input;
};

export type GitResult =
  | { readonly kind: "ok"; readonly stdout: string; readonly stderr: string }
  | { readonly kind: "failed"; readonly exitCode: number; readonly stdout: string; readonly stderr: string }
  | { readonly kind: "refused"; readonly reason: string };

type Override = { readonly key: string; readonly value: string };
type Refused = { readonly kind: "refused"; readonly reason: string };

// Always set: last trusted value, else this neutral one.
const ALWAYS: readonly Override[] = [
  { key: "core.fsmonitor", value: "false" },
  { key: "core.hookspath", value: "/dev/null" },
  { key: "core.pager", value: "cat" },
  { key: "core.editor", value: "true" },
  { key: "sequence.editor", value: "true" },
  { key: "gpg.program", value: "gpg" },
  { key: "gpg.openpgp.program", value: "gpg" },
  { key: "gpg.x509.program", value: "gpgsm" },
  { key: "gpg.ssh.program", value: "ssh-keygen" },
  { key: "protocol.ext.allow", value: "never" },
  { key: "submodule.recurse", value: "false" },
  { key: "fetch.recursesubmodules", value: "false" },
];

// What to do with a key the repo itself sets.
type RepoRule =
  | { readonly kind: "neutral"; readonly value: string }
  | { readonly kind: "refuse" }
  | { readonly kind: "helper" }
  | { readonly kind: "gitproxy" }
  | { readonly kind: "ignore" };

const REPO_RULES: readonly { readonly pattern: RegExp; readonly rule: RepoRule }[] = [
  { pattern: /^core\.sshcommand$/, rule: { kind: "neutral", value: "ssh" } },
  {
    pattern: /^(core\.askpass|core\.alternaterefscommand|gpg\.ssh\.defaultkeycommand)$/,
    rule: { kind: "neutral", value: "" },
  },
  { pattern: /^core\.gitproxy$/, rule: { kind: "gitproxy" } },
  { pattern: /^filter\..*\.required$/, rule: { kind: "neutral", value: "false" } },
  { pattern: /^filter\..*\.(clean|smudge|process)$/, rule: { kind: "neutral", value: "" } },
  { pattern: /^diff\..*\.textconv$/, rule: { kind: "neutral", value: "cat" } },
  { pattern: /^remote\..*\.uploadpack$/, rule: { kind: "neutral", value: "git-upload-pack" } },
  { pattern: /^remote\..*\.receivepack$/, rule: { kind: "neutral", value: "git-receive-pack" } },
  {
    pattern:
      /^(diff\.external|diff\..*\.command|merge\..*\.driver|url\..*\.(insteadof|pushinsteadof)|http\.(.*\.)?(proxy|sslverify|curloptresolve)|remote\..*\.proxy)$/,
    rule: { kind: "refuse" },
  },
  { pattern: /^credential\.(.*\.)?helper$/, rule: { kind: "helper" } },
];

const IGNORE: RepoRule = { kind: "ignore" };

function ruleFor(key: string): RepoRule {
  return REPO_RULES.find((r) => r.pattern.test(key))?.rule ?? IGNORE;
}

type Run = { readonly code: number; readonly stdout: string; readonly stderr: string };

function run(file: string, args: readonly string[], env: NodeJS.ProcessEnv, stdin: Input): Promise<Run> {
  return new Promise((done) => {
    const child = execFile(file, [...args], { env, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = error === null ? 0 : typeof error.code === "number" ? error.code : 1;
      done({ code, stdout, stderr });
    });
    // git may exit before it reads its input; that is git's answer, not a failure of ours
    child.stdin?.on("error", () => undefined);
    child.stdin?.end(stdin.kind === "text" ? stdin.text : "");
  });
}

const NO_INPUT: Input = { kind: "none" };

// trustedPath : PATH without relative entries and without entries inside the repo.
export function trustedPath(path: string, repo: RepoTarget): string {
  const outside = (p: string): boolean =>
    repo.kind === "none" || (resolve(p) !== resolve(repo.path) && !resolve(p).startsWith(resolve(repo.path) + sep));
  return path
    .split(delimiter)
    .filter((p) => p.startsWith(sep) && outside(p))
    .join(delimiter);
}

type Found = { readonly kind: "found"; readonly path: string } | { readonly kind: "missing" };

function isProgram(file: string): boolean {
  try {
    accessSync(file, constants.X_OK);
    return !statSync(file).isDirectory();
  } catch {
    return false;
  }
}

function findGit(path: string): Found {
  const hit = path
    .split(delimiter)
    .filter((d) => d.length > 0)
    .map((d) => join(d, "git"))
    .find(isProgram);
  return hit === undefined ? { kind: "missing" } : { kind: "found", path: hit };
}

// "key\nvalue\0" records of `git config --null --list`, in order.
function parseList(stdout: string): readonly Override[] {
  return stdout
    .split("\0")
    .filter((r) => r.length > 0)
    .map((r) => {
      const at = r.indexOf("\n");
      return at < 0 ? { key: r, value: "" } : { key: r.slice(0, at), value: r.slice(at + 1) };
    });
}

// "scope\0key\0" pairs of `git config --show-scope --null --name-only --list`: the keys of local and worktree scope.
function repoKeys(stdout: string): readonly string[] {
  const parts = stdout.split("\0");
  const pairs = parts.flatMap((scope, i) =>
    i % 2 === 0 && i + 1 < parts.length ? [{ scope, key: parts[i + 1]! }] : [],
  );
  return [...new Set(pairs.filter((p) => p.scope === "local" || p.scope === "worktree").map((p) => p.key))].sort();
}

export type ConfigRead =
  | {
      readonly kind: "read";
      readonly trusted: readonly Override[];
      readonly repoSet: readonly string[];
      readonly repoHelpers: ReadonlyMap<string, readonly string[]>;
    }
  | Refused;

// readConfig : the trusted config and the keys the repo sets. A repo read that fails is a refusal, never an empty
// list: an empty list would leave every repo key unchecked (git before 2.26 has no --show-scope).
async function readConfig(git: string, dir: string, env: NodeJS.ProcessEnv): Promise<ConfigRead> {
  const system = await run(git, ["config", "--system", "--null", "--list"], env, NO_INPUT);
  const global = await run(git, ["config", "--global", "--null", "--list"], env, NO_INPUT);
  // an unreadable trusted file leaves the neutral values, which is the safe side
  const trusted = [
    ...parseList(system.code === 0 ? system.stdout : ""),
    ...parseList(global.code === 0 ? global.stdout : ""),
  ];
  const scoped = await run(
    git,
    ["-C", dir, "config", "--show-scope", "--null", "--name-only", "--list"],
    env,
    NO_INPUT,
  );
  if (scoped.code !== 0) {
    return { kind: "refused", reason: "cannot list the repo's own config keys (git 2.26 or later is needed)" };
  }
  const repoSet = repoKeys(scoped.stdout);
  const repoHelpers = new Map<string, readonly string[]>();
  for (const key of repoSet.filter((k) => ruleFor(k).kind === "helper")) {
    const local = await run(git, ["-C", dir, "config", "--local", "--null", "--get-all", key], env, NO_INPUT);
    // 1: the key is set only in the worktree's config; anything else is an error
    if (local.code !== 0 && local.code !== 1) {
      return { kind: "refused", reason: `cannot read the repo's ${key}` };
    }
    repoHelpers.set(
      key,
      local.stdout.split("\0").filter((v) => v.length > 0),
    );
  }
  return { kind: "read", trusted, repoSet, repoHelpers };
}

type Step = { readonly kind: "add"; readonly overrides: readonly Override[] } | Refused;

type Context = {
  readonly values: (key: string) => readonly string[];
  readonly repoHelpers: (key: string) => readonly string[];
  readonly ownHelper: OwnHelper;
};

function lastOr(ctx: Context, key: string, neutral: string): Override {
  return { key, value: ctx.values(key).at(-1) ?? neutral };
}

function neutralStep(ctx: Context, key: string, value: string): Step {
  return { kind: "add", overrides: [lastOr(ctx, key, value)] };
}

function gitproxyStep(ctx: Context, key: string): Step {
  return { kind: "add", overrides: [lastOr(ctx, key, ""), { key: "protocol.git.allow", value: "never" }] };
}

function refuseStep(ctx: Context, key: string): Step {
  return ctx.values(key).length > 0
    ? { kind: "add", overrides: [lastOr(ctx, key, "")] }
    : {
        kind: "refused",
        reason: `the repo's own config sets ${key}, which would run a program or redirect git; remove it`,
      };
}

// helperStep : an empty helper clears the list so far, then the trusted helpers, then the factory's own if the repo
// names it exactly.
function helperStep(ctx: Context, key: string): Step {
  const own =
    ctx.ownHelper.kind === "helper" && ctx.repoHelpers(key).includes(ctx.ownHelper.value) ? [ctx.ownHelper.value] : [];
  return {
    kind: "add",
    overrides: [{ key, value: "" }, ...[...ctx.values(key), ...own].map((value) => ({ key, value }))],
  };
}

function step(ctx: Context, key: string): Step {
  const rule = ruleFor(key);
  switch (rule.kind) {
    case "neutral":
      return neutralStep(ctx, key, rule.value);
    case "gitproxy":
      return gitproxyStep(ctx, key);
    case "refuse":
      return refuseStep(ctx, key);
    case "helper":
      return helperStep(ctx, key);
    case "ignore":
      return { kind: "add", overrides: [] };
    default: {
      const unreachable: never = rule;
      return unreachable;
    }
  }
}

export type Plan = { readonly kind: "ok"; readonly overrides: readonly Override[] } | Refused;

// plan : the GIT_CONFIG_COUNT entries for one call, or the first refusal.
export function plan(
  trusted: readonly Override[],
  repoSet: readonly string[],
  repoHelpers: (key: string) => readonly string[],
  ownHelper: OwnHelper,
): Plan {
  const ctx: Context = {
    values: (key) => trusted.filter((t) => t.key === key).map((t) => t.value),
    repoHelpers,
    ownHelper,
  };
  const start: Plan = { kind: "ok", overrides: ALWAYS.map((o) => lastOr(ctx, o.key, o.value)) };
  return repoSet.reduce<Plan>((acc, key) => {
    if (acc.kind === "refused") {
      return acc;
    }
    const next = step(ctx, key);
    return next.kind === "refused" ? next : { kind: "ok", overrides: [...acc.overrides, ...next.overrides] };
  }, start);
}

type Count = { readonly kind: "count"; readonly n: number } | Refused;

// callerCount : how many GIT_CONFIG_COUNT entries the caller set already; anything but a whole number is refused.
export function callerCount(value: string | undefined): Count {
  const text = value ?? "0";
  return /^\d+$/.test(text)
    ? { kind: "count", n: Number(text) }
    : { kind: "refused", reason: `GIT_CONFIG_COUNT is not a whole number ('${text}')` };
}

function withOverrides(env: NodeJS.ProcessEnv, from: number, overrides: readonly Override[]): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env, GIT_CONFIG_COUNT: String(from + overrides.length) };
  overrides.forEach((o, i) => {
    out[`GIT_CONFIG_KEY_${from + i}`] = o.key;
    out[`GIT_CONFIG_VALUE_${from + i}`] = o.value;
  });
  return out;
}

// hostGit : runs git as the request says, hardened as the header says.
export async function hostGit(request: GitRequest): Promise<GitResult> {
  const count = callerCount(request.env.GIT_CONFIG_COUNT);
  const path = trustedPath(request.env.PATH ?? "", request.repo);
  const git = findGit(path);
  if (count.kind === "refused") {
    return count;
  }
  if (git.kind === "missing") {
    return { kind: "refused", reason: "no git on a trusted PATH entry" };
  }
  const base: NodeJS.ProcessEnv = { ...request.env, PATH: path, GIT_TERMINAL_PROMPT: "0" };
  const dir = request.repo.kind === "repo" ? request.repo.path : "/";
  const config = await readConfig(git.path, dir, base);
  const decided =
    config.kind === "read"
      ? plan(config.trusted, config.repoSet, (key) => config.repoHelpers.get(key) ?? [], request.ownHelper)
      : config;
  if (decided.kind === "refused") {
    return decided;
  }
  const result = await run(
    git.path,
    ["-C", dir, ...request.args],
    withOverrides(base, count.n, decided.overrides),
    request.stdin,
  );
  return result.code === 0
    ? { kind: "ok", stdout: result.stdout, stderr: result.stderr }
    : { kind: "failed", exitCode: result.code, stdout: result.stdout, stderr: result.stderr };
}
