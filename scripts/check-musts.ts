// check-musts — each AGENTS.md MUST that code can check, as a check (#221; ADR-0015 R5): a rule that code can check
// should not depend on the LLM reviewer. A finding names file:line, the rule and the MUST it breaks.
//
//   forge-seam        no "gh" or "glab" in src/ outside src/core/forge/, and no gh or glab command in a bash script
//                     under scripts/: bash has no forge seam any more (#285)
//   host-git          no "git" in src/ outside src/core/git.ts (hostGit), and no git command in a bash script under
//                     scripts/
//   spawn-seam        node:child_process only in the files below that run a program, so a forge or git call cannot
//                     hide behind a variable: a new one needs a reviewed entry here
//   forge-token       no forge token variable (GH_TOKEN, GITLAB_TOKEN, ...) in src/ outside src/core/forge/, nor in a
//                     bash script under scripts/, so no LLM seat is handed one (ADR-0012 S2, S6)
//   skip-permissions  no skip-permissions flag or bypass mode for an agent CLI (claude, copilot) in src/ or a bash
//                     script (ADR-0012 S11)
//   disable-comment   no lint or type-check disable comment in any tracked code file: fix the code (#148)
//   lint-baseline     scripts/lint-baseline.json raises no count above the default branch's, at the merge base (#148)
//   script-test       each scripts/<name>.sh has its tests/<name>.test.sh
// Comment lines are skipped, except by disable-comment. ALLOW below lists each real exception, matched by file, rule
// and a piece of the line, with the reason; an entry that matches nothing on a file that is there fails, so the list
// only shrinks.
//
//   node scripts/check-musts.ts [ROOT]     (make lint)
//
// The default branch is FACTORY_BASE_REF, else origin/<GITHUB_BASE_REF> on a pull request, else origin/main; CI checks
// out with fetch-depth 0, so it is there. git reads this repository's own files, not a project's, so it runs plain
// git, as check-links does. Runs on Node's type stripping (Node 22.18+), so it uses only erasable TypeScript.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type Rule =
  | "forge-seam"
  | "host-git"
  | "spawn-seam"
  | "forge-token"
  | "skip-permissions"
  | "disable-comment"
  | "lint-baseline"
  | "script-test";

type LineRule = {
  readonly rule: Rule;
  readonly applies: (file: string) => boolean;
  readonly bad: RegExp;
  readonly comments: boolean;
  readonly why: string;
};

export type Allow = { readonly file: string; readonly rule: Rule; readonly has: string; readonly why: string };
export type Source = { readonly file: string; readonly text: string };
export type Scan = { readonly findings: readonly string[]; readonly unused: readonly Allow[] };

const FORGE_WHY = "call the forge only through the Forge seam in src/core/forge/ (bash: a forge_* call)";
const GIT_WHY = "call git on a project's clone only through hostGit (src/core/git.ts)";
const TOKEN_WHY = "give no LLM seat a forge token; only the forge seam sets one (ADR-0012 S2, S6)";
const SKIP_WHY = "give no LLM seat a skip-permissions flag (ADR-0012 S11)";

const inSrc = (f: string): boolean => f.startsWith("src/") && f.endsWith(".ts");
const topScript = (f: string): boolean => /^scripts\/[^/]+\.sh$/.test(f);
const anySh = (f: string): boolean => f.startsWith("scripts/") && f.endsWith(".sh");
const code = (f: string): boolean => /\.(?:ts|mts|cts|js|mjs|cjs)$/.test(f) && !f.startsWith("tests/fixtures/");

// a bash command word: at the start of a line or after a separator, $( or a keyword
const command = (names: string): RegExp =>
  new RegExp(`(?:^|[;&|({]|\\$\\(|\\b(?:then|do|else|exec|time)\\s)\\s*(?:${names})(?=\\s|$|\\))`);

export const RULES: readonly LineRule[] = [
  {
    rule: "forge-seam",
    applies: (f) => inSrc(f) && !f.startsWith("src/core/forge/"),
    bad: /(["'`])(?:gh|glab)\1/,
    comments: false,
    why: FORGE_WHY,
  },
  { rule: "forge-seam", applies: anySh, bad: command("gh|glab"), comments: false, why: FORGE_WHY },
  {
    rule: "host-git",
    applies: (f) => inSrc(f) && f !== "src/core/git.ts",
    bad: /(["'`])git\1/,
    comments: false,
    why: GIT_WHY,
  },
  { rule: "host-git", applies: anySh, bad: command("git"), comments: false, why: GIT_WHY },
  {
    rule: "spawn-seam",
    applies: inSrc,
    bad: /["'](?:node:)?child_process["']/,
    comments: false,
    why: "start a program only through a reviewed runner (an ALLOW entry in scripts/check-musts.ts)",
  },
  {
    rule: "forge-token",
    applies: (f) => (inSrc(f) && !f.startsWith("src/core/forge/")) || anySh(f),
    bad: /\b(?:GH|GITHUB|GH_ENTERPRISE|GITHUB_ENTERPRISE|GLAB|GITLAB|CI_JOB)_TOKEN\b/,
    comments: false,
    why: TOKEN_WHY,
  },
  {
    rule: "skip-permissions",
    applies: (f) => inSrc(f) || anySh(f),
    bad: /--(?:allow-)?dangerously-skip-permissions|\bbypassPermissions\b|--allow-all(?:-tools)?\b|--yolo\b/,
    comments: false,
    why: SKIP_WHY,
  },
  {
    rule: "disable-comment",
    applies: code,
    bad: /(?:\/\/|\/\*)\s*(?:eslint-disable|oxlint-disable|biome-ignore|@ts-ignore|@ts-expect-error|@ts-nocheck)/,
    comments: true,
    why: "never add a disable comment; fix the code (#148)",
  },
];

// the real exceptions, each with its reason
export const ALLOW: readonly Allow[] = [
  {
    file: "src/core/coordinator.ts",
    rule: "forge-seam",
    has: '"gh",',
    why: "the coordinator's wall denies raw gh (S2)",
  },
  { file: "src/core/coordinator.ts", rule: "forge-seam", has: '"glab",', why: "the wall denies raw glab (S2)" },
  {
    file: "src/core/coordinator.ts",
    rule: "skip-permissions",
    has: '=== "bypassPermissions"',
    why: "the wall refuses a settings file in bypass mode",
  },
  {
    file: "src/core/writer/run.ts",
    rule: "skip-permissions",
    has: '"--dangerously-skip-permissions"',
    why: "the writer runs only in a box, where S11 allows skip-all; it holds no forge credential (S6)",
  },
  {
    file: "src/core/plugin/contract.ts",
    rule: "forge-token",
    has: "CI_JOB_TOKEN$",
    why: "FORBIDDEN_ENV: the names a plugin may never ask for",
  },
  { file: "src/core/forge/api.ts", rule: "spawn-seam", has: "node:child_process", why: "runProcess, the one runner" },
  { file: "src/core/git.ts", rule: "spawn-seam", has: "node:child_process", why: "hostGit" },
  { file: "src/core/plugin/exec.ts", rule: "spawn-seam", has: "node:child_process", why: "a plugin call (ADR-0014)" },
  { file: "src/core/review/model.ts", rule: "spawn-seam", has: "node:child_process", why: "the reviewer's claude run" },
  { file: "src/core/review/live.ts", rule: "spawn-seam", has: "node:child_process", why: "claude agents --json" },
  { file: "src/cli.ts", rule: "spawn-seam", has: "node:child_process", why: "the operator's interactive session" },
  {
    file: "test/floor.test.ts",
    rule: "disable-comment",
    has: "eslint-disable-next-line no-explicit-any",
    why: "a planted suppression in a project file, for the floor guard to find",
  },
];

const COMMENT = /^\s*(?:\/\/|\/\*|\*|#)/;

function allowedBy(allow: readonly Allow[], file: string, rule: Rule, line: string): Allow | undefined {
  return allow.find((a) => a.file === file && a.rule === rule && line.includes(a.has));
}

type Hit = { readonly at: string; readonly rule: LineRule; readonly line: string; readonly file: string };

function hits(source: Source, rules: readonly LineRule[]): readonly Hit[] {
  const lines = source.text.split("\n");
  return rules
    .filter((r) => r.applies(source.file))
    .flatMap((r) =>
      lines.flatMap((line, i) =>
        (r.comments || !COMMENT.test(line)) && r.bad.test(line)
          ? [{ at: `${source.file}:${i + 1}`, rule: r, line, file: source.file }]
          : [],
      ),
    );
}

// scan : every line that breaks a rule and has no ALLOW entry, and each entry for a scanned file that matched no line.
// Pure.
export function scan(sources: readonly Source[], allow: readonly Allow[] = ALLOW, rules = RULES): Scan {
  const all = sources.flatMap((s) => hits(s, rules));
  const used = new Set(all.map((h) => allowedBy(allow, h.file, h.rule.rule, h.line)));
  const findings = all
    .filter((h) => allowedBy(allow, h.file, h.rule.rule, h.line) === undefined)
    .map((h) => `${h.at}: ${h.rule.rule}: ${h.rule.why}`);
  const scanned = new Set(sources.map((s) => s.file));
  return { findings, unused: allow.filter((a) => scanned.has(a.file) && !used.has(a)) };
}

// untested : each top-level bash script with no tests/<name>.test.sh. Pure.
export function untested(listed: readonly string[]): readonly string[] {
  const have = new Set(listed);
  return listed
    .filter(topScript)
    .filter((f) => !have.has(`tests/${f.slice("scripts/".length, -".sh".length)}.test.sh`))
    .map((f) => `${f}: script-test: write each script with its tests/<script>.test.sh`);
}

export type Counts = Readonly<Record<string, number>>;

// raised : each lint-baseline key whose count is above the default branch's, a new key included. Pure.
export function raised(now: Counts, base: Counts): readonly string[] {
  return Object.keys(now)
    .filter((k) => (now[k] ?? 0) > (base[k] ?? 0))
    .map((k) => `scripts/lint-baseline.json: lint-baseline: ${k} is ${now[k]}, above ${base[k] ?? 0}; it only shrinks`);
}

// counts : a baseline's text as counts; text that does not parse counts nothing, so every key reads as raised
export function counts(text: string): Counts {
  try {
    const value = JSON.parse(text) as unknown;
    return typeof value === "object" && value !== null
      ? Object.fromEntries(Object.entries(value).filter(([, n]) => typeof n === "number"))
      : {};
  } catch {
    return {};
  }
}

function git(root: string, args: readonly string[]): { readonly code: number; readonly out: string } {
  const r = spawnSync("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status ?? -1, out: r.stdout };
}

// baseRef : the default branch to compare with
export function baseRef(env: NodeJS.ProcessEnv): string {
  const pr = env.GITHUB_BASE_REF ?? "";
  return env.FACTORY_BASE_REF || (pr === "" ? "origin/main" : `origin/${pr}`);
}

const BASELINE = "scripts/lint-baseline.json";

function baselineProblems(root: string, ref: string): readonly string[] {
  const base = git(root, ["merge-base", ref, "HEAD"]);
  if (base.code !== 0) {
    return [`${BASELINE}: lint-baseline: cannot find the default branch ${ref}; fetch it or set FACTORY_BASE_REF`];
  }
  const then = git(root, ["show", `${base.out.trim()}:${BASELINE}`]);
  const file = join(root, BASELINE);
  return raised(
    counts(existsSync(file) ? readFileSync(file, "utf8") : "{}"),
    counts(then.code === 0 ? then.out : "{}"),
  );
}

function files(root: string): readonly string[] {
  return git(root, ["-c", "core.quotePath=false", "ls-files", "-z", "-co", "--exclude-standard"])
    .out.split("\0")
    .filter((f) => f !== "" && existsSync(join(root, f)));
}

if (process.argv[1] === import.meta.filename) {
  const root = process.argv[2] ?? ".";
  const listed = files(root);
  const sources = listed.filter((f) => RULES.some((r) => r.applies(f)));
  const result = scan(sources.map((file) => ({ file, text: readFileSync(join(root, file), "utf8") })));
  const problems = [
    ...result.findings,
    ...result.unused.map((a) => `${a.file}: ${a.rule}: the ALLOW entry "${a.has}" matches no line; remove it`),
    ...untested(listed),
    ...baselineProblems(root, baseRef(process.env)),
  ];
  for (const problem of problems) {
    console.log(problem);
  }
  if (problems.length > 0) {
    console.log(`check-musts: ${problems.length} way(s) the code breaks an AGENTS.md MUST`);
    process.exit(1);
  }
}
