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
// with GIT_TERMINAL_PROMPT=0. Without a repo, git runs from /, so it reads no repo's config.

import { execFile } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { delimiter, join, resolve, sep } from "node:path";

export type GitRequest = {
  readonly args: readonly string[];
  // the clone to run in; null runs git outside any repo
  readonly repo: string | null;
  // the environment git starts from: normally process.env
  readonly env: NodeJS.ProcessEnv;
  // the factory's own GitHub App helper ("!<path>/github-app.sh git-credential"), the one repo-set helper kept; null
  // keeps none
  readonly ownHelper: string | null;
  readonly stdin: string | null;
};

export type GitResult =
  | { readonly kind: "ok"; readonly stdout: string; readonly stderr: string }
  | { readonly kind: "failed"; readonly exitCode: number; readonly stdout: string; readonly stderr: string }
  | { readonly kind: "refused"; readonly reason: string };

type Override = { readonly key: string; readonly value: string };

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
  | { readonly kind: "gitproxy" };

const REPO_RULES: readonly { readonly pattern: RegExp; readonly rule: RepoRule }[] = [
  { pattern: /^core\.sshcommand$/, rule: { kind: "neutral", value: "ssh" } },
  { pattern: /^(core\.askpass|core\.alternaterefscommand|gpg\.ssh\.defaultkeycommand)$/, rule: { kind: "neutral", value: "" } },
  { pattern: /^core\.gitproxy$/, rule: { kind: "gitproxy" } },
  { pattern: /^filter\..*\.required$/, rule: { kind: "neutral", value: "false" } },
  { pattern: /^filter\..*\.(clean|smudge|process)$/, rule: { kind: "neutral", value: "" } },
  { pattern: /^diff\..*\.textconv$/, rule: { kind: "neutral", value: "cat" } },
  { pattern: /^remote\..*\.uploadpack$/, rule: { kind: "neutral", value: "git-upload-pack" } },
  { pattern: /^remote\..*\.receivepack$/, rule: { kind: "neutral", value: "git-receive-pack" } },
  {
    pattern:
      /^(diff\.external|diff\..*\.command|merge\..*\.driver|url\..*\.(insteadof|pushinsteadof)|http\.(.*\.)?(proxy|sslverify|curloptresolve))$/,
    rule: { kind: "refuse" },
  },
  { pattern: /^credential\.(.*\.)?helper$/, rule: { kind: "helper" } },
];

type Run = { readonly code: number; readonly stdout: string; readonly stderr: string };

function run(file: string, args: readonly string[], env: NodeJS.ProcessEnv, stdin: string | null): Promise<Run> {
  return new Promise((done) => {
    const child = execFile(file, [...args], { env, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = error === null ? 0 : typeof error.code === "number" ? error.code : 1;
      done({ code, stdout, stderr });
    });
    // git may exit before it reads its input; that is git's answer, not a failure of ours
    child.stdin?.on("error", () => undefined);
    child.stdin?.end(stdin ?? "");
  });
}

// trustedPath : PATH without relative entries and without entries inside the repo.
export function trustedPath(path: string, repo: string | null): string {
  const inside = repo === null ? null : resolve(repo);
  return path
    .split(delimiter)
    .filter((p) => p.startsWith(sep))
    .filter((p) => inside === null || (resolve(p) !== inside && !resolve(p).startsWith(inside + sep)))
    .join(delimiter);
}

function findGit(path: string): string | null {
  for (const dir of path.split(delimiter).filter((d) => d.length > 0)) {
    const candidate = join(dir, "git");
    try {
      accessSync(candidate, constants.X_OK);
      if (!statSync(candidate).isDirectory()) {
        return candidate;
      }
    } catch {
      // not here; try the next entry
    }
  }
  return null;
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
  const keys = new Set<string>();
  for (let i = 0; i + 1 < parts.length; i += 2) {
    if (parts[i] === "local" || parts[i] === "worktree") {
      keys.add(parts[i + 1]!);
    }
  }
  return [...keys].sort();
}

type Plan = { readonly kind: "ok"; readonly overrides: readonly Override[] } | { readonly kind: "refused"; readonly reason: string };

// overrides : the GIT_CONFIG_COUNT entries for one call, or a refusal.
export function plan(trusted: readonly Override[], repoSet: readonly string[], repoHelpers: (key: string) => readonly string[], ownHelper: string | null): Plan {
  const values = (key: string): readonly string[] => trusted.filter((t) => t.key === key).map((t) => t.value);
  const last = (key: string, neutral: string): Override => ({ key, value: values(key).at(-1) ?? neutral });
  const out: Override[] = ALWAYS.map((o) => last(o.key, o.value));
  for (const key of repoSet) {
    const rule = REPO_RULES.find((r) => r.pattern.test(key))?.rule;
    if (rule === undefined) {
      continue;
    }
    switch (rule.kind) {
      case "neutral":
        out.push(last(key, rule.value));
        break;
      case "gitproxy":
        out.push(last(key, ""), { key: "protocol.git.allow", value: "never" });
        break;
      case "refuse":
        if (values(key).length === 0) {
          return { kind: "refused", reason: `the repo's own config sets ${key}, which would run a program or redirect git; remove it` };
        }
        out.push(last(key, ""));
        break;
      case "helper":
        out.push({ key, value: "" }, ...values(key).map((value) => ({ key, value })));
        if (ownHelper !== null && repoHelpers(key).includes(ownHelper)) {
          out.push({ key, value: ownHelper });
        }
        break;
      default: {
        const unreachable: never = rule;
        return unreachable;
      }
    }
  }
  return { kind: "ok", overrides: out };
}

// hostGit : runs git as the request says, hardened as the header says.
export async function hostGit(request: GitRequest): Promise<GitResult> {
  const path = trustedPath(request.env.PATH ?? "", request.repo);
  const git = findGit(path);
  if (git === null) {
    return { kind: "refused", reason: "no git on a trusted PATH entry" };
  }
  const base: NodeJS.ProcessEnv = { ...request.env, PATH: path, GIT_TERMINAL_PROMPT: "0" };
  const dir = request.repo ?? "/";
  const system = await run(git, ["config", "--system", "--null", "--list"], base, null);
  const global = await run(git, ["config", "--global", "--null", "--list"], base, null);
  const trusted = [...parseList(system.code === 0 ? system.stdout : ""), ...parseList(global.code === 0 ? global.stdout : "")];
  const scoped = await run(git, ["-C", dir, "config", "--show-scope", "--null", "--name-only", "--list"], base, null);
  const repoSet = repoKeys(scoped.code === 0 ? scoped.stdout : "");
  const helperValues = new Map<string, readonly string[]>();
  for (const key of repoSet.filter((k) => /^credential\.(.*\.)?helper$/.test(k))) {
    const local = await run(git, ["-C", dir, "config", "--local", "--null", "--get-all", key], base, null);
    helperValues.set(key, local.stdout.split("\0").filter((v) => v.length > 0));
  }
  const decided = plan(trusted, repoSet, (key) => helperValues.get(key) ?? [], request.ownHelper);
  if (decided.kind === "refused") {
    return decided;
  }
  const already = Number(request.env.GIT_CONFIG_COUNT ?? "0");
  const env: NodeJS.ProcessEnv = { ...base, GIT_CONFIG_COUNT: String(already + decided.overrides.length) };
  decided.overrides.forEach((o, i) => {
    env[`GIT_CONFIG_KEY_${already + i}`] = o.key;
    env[`GIT_CONFIG_VALUE_${already + i}`] = o.value;
  });
  const result = await run(git, ["-C", dir, ...request.args], env, request.stdin);
  return result.code === 0
    ? { kind: "ok", stdout: result.stdout, stderr: result.stderr }
    : { kind: "failed", exitCode: result.code, stdout: result.stdout, stderr: result.stderr };
}
