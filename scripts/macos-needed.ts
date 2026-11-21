// macos-needed — whether ci.yml's test-macos job runs for this event. macOS runners are few and slow to start, so a
// pull request asks for one only when the change can behave differently on a Mac. It stays a required check: a job
// that its `if` skips counts as passing, and the skip comes only from what the PR touches or its draft state.
//
//   run=false   a draft pull request (the factory opens its PRs as drafts; marking it ready runs macOS), or one whose
//               every changed file is docs only (DOCS below)
//   run=true    every other event: a push to main, the release's workflow_call, a merge group; any pull request
//               that touches code, tests, scripts, prompts, plugins, evals, the package files or the workflows; and
//               whenever it cannot tell (no event, no base, a failed diff), so it fails toward running
//
//   node scripts/macos-needed.ts     (ci.yml's macos-gate job; writes run=… to $GITHUB_OUTPUT when set)
//
// It reads this repository's own history, not a project's clone, so it runs plain git, as check-eval-proof does.
// Runs on Node's type stripping (Node 22.18+), so it uses only erasable TypeScript.

import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";

const DOCS: readonly RegExp[] = [
  /^docs\//,
  /^[^/]+\.md$/,
  /^\.github\/pull_request_template\.md$/,
  /^\.github\/ISSUE_TEMPLATE\//,
];

export function isDocs(file: string): boolean {
  return DOCS.some((d) => d.test(file));
}

export type Change =
  | { readonly kind: "other"; readonly event: string }
  | { readonly kind: "pull_request"; readonly draft: boolean; readonly changed: readonly string[] | undefined };

export type Decision = { readonly run: boolean; readonly why: string };

export function decide(c: Change): Decision {
  if (c.kind === "other") {
    return { run: true, why: `event ${c.event || "unknown"} always runs macOS` };
  }
  if (c.draft) {
    return { run: false, why: "a draft pull request; marking it ready runs macOS" };
  }
  return byFiles(c.changed);
}

function byFiles(changed: readonly string[] | undefined): Decision {
  if (changed === undefined) {
    return { run: true, why: "cannot list the changed files, so macOS runs" };
  }
  if (changed.length === 0) {
    return { run: true, why: "no changed file listed, so macOS runs" };
  }
  const code = changed.find((f) => !isDocs(f));
  return code === undefined
    ? { run: false, why: "every changed file is docs only" }
    : { run: true, why: `${code} changed` };
}

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? (Reflect.get(value, key) as unknown) : undefined;
}

function sha(value: unknown): string | undefined {
  return typeof value === "string" && /^[0-9a-f]{40}$/.test(value) ? value : undefined;
}

function parse(text: string | undefined): unknown {
  try {
    return JSON.parse(text ?? "") as unknown;
  } catch {
    return undefined;
  }
}

export function changeOf(
  event: string,
  eventText: string | undefined,
  diff: (base: string, head: string) => readonly string[] | undefined,
): Change {
  if (event !== "pull_request") {
    return { kind: "other", event };
  }
  const pr = field(parse(eventText), "pull_request");
  const base = sha(field(field(pr, "base"), "sha"));
  const head = sha(field(field(pr, "head"), "sha"));
  const changed = base !== undefined && head !== undefined ? diff(base, head) : undefined;
  return { kind: "pull_request", draft: field(pr, "draft") === true, changed };
}

function gitDiff(base: string, head: string): readonly string[] | undefined {
  const r = spawnSync("git", ["-c", "core.quotePath=false", "diff", "--name-only", "-z", `${base}...${head}`], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return r.status === 0 ? r.stdout.split("\0").filter((f) => f !== "") : undefined;
}

if (process.argv[1] === import.meta.filename) {
  const path = process.env.GITHUB_EVENT_PATH ?? "";
  const text = path !== "" && existsSync(path) ? readFileSync(path, "utf8") : undefined;
  const d = decide(changeOf(process.env.GITHUB_EVENT_NAME ?? "", text, gitDiff));
  console.log(`macos-needed: run=${d.run}: ${d.why}`);
  const out = process.env.GITHUB_OUTPUT ?? "";
  if (out !== "") {
    appendFileSync(out, `run=${d.run}\n`);
  }
}
