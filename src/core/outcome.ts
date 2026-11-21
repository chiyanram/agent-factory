// outcome — what became of a merged ticket's change, read from the project's clone (#487 AC-3; need 1). At 2 weeks the
// outcome is clean, reverted or fixed on the same lines, and a revert or such a fix up to 30 days changes it; after 30
// days it is final. Before 2 weeks the change is watched. It is computed on read, by `usage`, and never stored (#487 Q7):
// git keeps the history, and the loop is not running after a merge.
//
// Every git call goes through hostGit on the project's clone (AGENTS.md MUST). The default branch is fetched into
// FETCHED, then read up to the last commit before the 30-day mark (or now):
//   reverted  a later commit whose message says "This reverts commit <the merge's commit>"
//   touched   each later commit that changed a line the merge added (`git blame --reverse` over those lines): shown,
//             and only one whose subject is a fix or a revert (`fix:`, `fix(scope):`, `revert:`, `Revert "…"`) counts
//             against the outcome (#487 Q6: a later feature may well change the same lines)
// The fetch writes only FETCHED: no branch, remote-tracking ref, HEAD or working tree of the person's clone changes, and
// a fetch that fails writes nothing. A clone, fetch or commit the reader cannot use is an unknown outcome with the
// reason, never a guess. Nothing here throws.
//
// A known limit: the commit that changed a line is taken as the first commit after the one the line was last seen in,
// on the ancestry path to the tip. On a linear default branch of squash merges, as the factory's projects use, that is
// exact; on a history with merge commits it may name a merge rather than the commit that changed the line.

import { hostGit, type GitResult } from "./git.js";

export type Commit = { readonly sha: string; readonly subject: string; readonly at: string };

export type MergeOutcome =
  | { readonly kind: "watching"; readonly day: number; readonly touched: readonly Commit[] }
  | { readonly kind: "clean"; readonly final: boolean; readonly touched: readonly Commit[] }
  | { readonly kind: "reverted"; readonly by: Commit; readonly final: boolean }
  | { readonly kind: "fixed"; readonly by: Commit; readonly final: boolean; readonly touched: readonly Commit[] }
  | { readonly kind: "unknown"; readonly why: string };

export const OUTCOME_DAYS = 14;
export const WATCH_DAYS = 30;
const DAY_MS = 86_400_000;
const FETCHED = "refs/factory/outcome-target";

type Read = { readonly repo: string; readonly env: NodeJS.ProcessEnv };

async function git(
  read: Read,
  args: readonly string[],
): Promise<{ ok: true; out: string } | { ok: false; why: string }> {
  const ran: GitResult = await hostGit({
    args,
    repo: { kind: "repo", path: read.repo },
    env: read.env,
    stdin: { kind: "none" },
  });
  if (ran.kind === "ok") {
    return { ok: true, out: ran.stdout };
  }
  return {
    ok: false,
    why: `git ${args[0] ?? ""}: ${ran.kind === "refused" ? ran.reason : ran.stderr.trim().split("\n")[0]}`,
  };
}

const FIX = /^(?:(?:fix|revert)(?:\([^)]*\))?!?:|Revert ")/i;

function commitOf(fields: readonly string[]): readonly (Commit & { readonly body: string })[] {
  const [sha, subject, at, body] = [0, 1, 2, 3].map((i) => fields[i] ?? "");
  return sha === undefined || sha === "" ? [] : [{ sha, subject: String(subject), at: String(at), body: String(body) }];
}

function commitsOf(log: string): readonly (Commit & { readonly body: string })[] {
  return log.split("\x1e").flatMap((r) => commitOf(r.replace(/^\n/, "").split("\x1f")));
}

type Added = { readonly file: string; readonly from: number; readonly count: number };

type Reading = { readonly file: string; readonly added: readonly Added[] };

const HUNK = /^@@ -\S+ \+(\d+)(?:,(\d+))? @@/;

function rangeOf(line: string): { readonly from: number; readonly count: number } | undefined {
  const hunk = HUNK.exec(line);
  const count = Number(hunk?.[2] ?? "1");
  return hunk === null || count === 0 ? undefined : { from: Number(hunk[1]), count };
}

function hunkStep(state: Reading, line: string): Reading {
  const range = rangeOf(line);
  return range === undefined ? state : { file: state.file, added: [...state.added, { file: state.file, ...range }] };
}

function diffStep(state: Reading, line: string): Reading {
  const path = /^\+\+\+ (?:b\/(.*)|\/dev\/null)$/.exec(line);
  return path === null ? hunkStep(state, line) : { file: path[1] ?? "", added: state.added };
}

export function addedOf(diff: string): readonly Added[] {
  return diff.split("\n").reduce<Reading>(diffStep, { file: "", added: [] }).added;
}

export function lastSeen(porcelain: string): ReadonlySet<string> {
  return new Set([...porcelain.matchAll(/^([0-9a-f]{40}) \d+ \d+/gm)].map((m) => m[1] ?? ""));
}

async function seenIn(read: Read, sha: string, tip: string): Promise<ReadonlySet<string>> {
  const diff = await git(read, ["diff", "-U0", "--no-color", "--no-ext-diff", `${sha}^1`, sha]);
  const seen = new Set<string>();
  for (const a of diff.ok ? addedOf(diff.out) : []) {
    const range = `${a.from},${a.from + a.count - 1}`;
    const blamed = await git(read, ["blame", "--reverse", "--porcelain", "-L", range, `${sha}..${tip}`, "--", a.file]);
    (blamed.ok ? [...lastSeen(blamed.out)] : []).forEach((c) => seen.add(c));
  }
  return seen;
}

async function nextAfter(read: Read, last: string, tip: string): Promise<string> {
  const next = await git(read, ["rev-list", "--ancestry-path", "--reverse", `${last}..${tip}`]);
  return next.ok ? (next.out.split("\n")[0] ?? "") : "";
}

async function touchedBy(read: Read, sha: string, tip: string, later: readonly Commit[]): Promise<readonly Commit[]> {
  const seen = [...(await seenIn(read, sha, tip))];
  const changers = await Promise.all(seen.map((last) => nextAfter(read, last, tip)));
  return later.filter((c) => changers.includes(c.sha));
}

export function verdict(input: {
  readonly day: number;
  readonly reverted?: Commit;
  readonly touched: readonly Commit[];
}): MergeOutcome {
  const final = input.day >= WATCH_DAYS;
  const fix = input.touched.find((c) => FIX.test(c.subject));
  if (input.reverted !== undefined) {
    return { kind: "reverted", by: input.reverted, final };
  }
  if (fix !== undefined) {
    return { kind: "fixed", by: fix, final, touched: input.touched };
  }
  return input.day < OUTCOME_DAYS
    ? { kind: "watching", day: input.day, touched: input.touched }
    : { kind: "clean", final, touched: input.touched };
}

const short = (c: Commit): string => `${c.sha.slice(0, 8)} ${c.subject}`;

type OutcomeMap = { readonly [O in MergeOutcome as O["kind"]]: O };

const HEADS: { readonly [K in keyof OutcomeMap]: (o: OutcomeMap[K]) => string } = {
  watching: (o) => `watching, day ${o.day} of ${OUTCOME_DAYS}`,
  clean: (o) => (o.final ? `clean, final at ${WATCH_DAYS} days` : `clean at ${OUTCOME_DAYS / 7} weeks`),
  reverted: (o) => `reverted by ${short(o.by)}${o.final ? ", final" : ""}`,
  fixed: (o) => `fixed on the same lines by ${short(o.by)}${o.final ? ", final" : ""}`,
  unknown: (o) => `unknown: ${o.why}`,
};

function headAs<K extends keyof OutcomeMap>(kind: K, o: OutcomeMap[K]): string {
  return HEADS[kind](o);
}

export function outcomeLines(o: MergeOutcome): readonly string[] {
  const touched = "touched" in o ? o.touched.filter((c) => !("by" in o) || c.sha !== o.by.sha) : [];
  return [`    outcome: ${headAs(o.kind, o)}`, ...touched.map((c) => `      touched by ${short(c)}`)];
}

export async function fetchDefault(read: Read): Promise<string> {
  const fetched = await git(read, ["fetch", "-q", "--no-tags", "origin", `+HEAD:${FETCHED}`]);
  return fetched.ok ? "" : fetched.why;
}

async function tipBefore(read: Read, end: number): Promise<{ ok: true; out: string } | { ok: false; why: string }> {
  const tip = await git(read, ["rev-list", "-1", `--before=${new Date(end).toISOString()}`, FETCHED]);
  return tip.ok ? { ok: true, out: tip.out.trim() } : tip;
}

async function tipAt(
  read: Read,
  end: number,
  fetched: boolean,
): Promise<{ ok: true; out: string } | { ok: false; why: string }> {
  const why = fetched ? "" : await fetchDefault(read);
  return why === "" ? tipBefore(read, end) : { ok: false, why };
}

export async function outcomeOf(
  input: Read & {
    readonly merged: { readonly at: string; readonly sha: string };
    readonly now: number;
    readonly fetched?: true;
  },
): Promise<MergeOutcome> {
  const at = Date.parse(input.merged.at);
  const day = Math.floor((input.now - at) / DAY_MS);
  const tip = await tipAt(input, Math.min(input.now, at + WATCH_DAYS * DAY_MS), input.fetched === true);
  if (!tip.ok) {
    return { kind: "unknown", why: tip.why };
  }
  const landed = await git(input, ["merge-base", "--is-ancestor", input.merged.sha, tip.out]);
  if (!landed.ok) {
    return { kind: "unknown", why: `the merge's commit ${input.merged.sha.slice(0, 8)} is not on the default branch` };
  }
  const log = await git(input, ["log", "--format=%H%x1f%s%x1f%cI%x1f%b%x1e", `${input.merged.sha}..${tip.out}`]);
  if (!log.ok) {
    return { kind: "unknown", why: log.why };
  }
  const later = commitsOf(log.out);
  const reverted = later.find((c) => c.body.includes(`This reverts commit ${input.merged.sha}`));
  const touched = await touchedBy(input, input.merged.sha, tip.out, later);
  const bare = (c: Commit): Commit => ({ sha: c.sha, subject: c.subject, at: c.at });
  return verdict({ day, touched: touched.map(bare), ...(reverted === undefined ? {} : { reverted: bare(reverted) }) });
}
