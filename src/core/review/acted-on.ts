// acted-on — the automated review's acted-on rate (ADR-0015 R4; #220): a finding counts as acted on when a later commit
// on the branch changes its file:line region. Deterministic, with no model call. Each full round keeps its Act on and
// Consider findings with its head (findings.json, beside act-on.json); the next full round diffs the earlier head with
// its own (git diff -U0) and marks each kept finding acted on when a changed line of its file, in the earlier head's
// numbering, is within REGION lines of it. The run records carry the rows (records.ts, review-ended), and `usage`
// sums them per lens and bucket (usage.ts).
//
// The lens is the finder that found it: rule or logic (Finding.kind); the category is the finding's Martian category
// (#218), so the rate reads per category too. A diff that merges the default branch in can touch a finding's region too, so the rate counts such a line as
// acted on: an upper bound, never a model's guess. A round whose diff cannot be read gets no rows, so the rate never
// fails a round.

import type { Result } from "../forge/api.js";
import { hostGit } from "../git.js";
import { keepJson, readKept, type At } from "../kept.js";
import { CATEGORIES, type Category } from "../eval/golden.js";
import type { Bucket, Kind, Sorted } from "./verdicts.js";

export const FINDINGS_FILE = "findings.json";

export const REGION = 5;

const ASKED: readonly Bucket[] = ["act_on", "consider"];

export type Tracked = {
  readonly id: string;
  readonly lens: Kind;
  readonly category: Category;
  readonly bucket: Bucket;
  readonly file: string;
  readonly line: number;
  readonly rule?: string;
};

export type ActedRow = Tracked & { readonly acted: boolean };

export type Acted = { readonly since: string; readonly rows: readonly ActedRow[] };

export function ruleIdOf(f: Pick<Sorted, "rule">): string {
  return f.rule === "" ? "logic" : f.rule;
}

export function trackedOf(sorted: readonly Sorted[]): readonly Tracked[] {
  return sorted
    .filter((f) => ASKED.includes(f.bucket))
    .map((f) => ({
      id: f.id,
      lens: f.kind,
      category: f.category,
      bucket: f.bucket,
      file: f.file,
      line: f.line,
      rule: ruleIdOf(f),
    }));
}

export type FoundByRule = Readonly<Record<string, Readonly<Partial<Record<Bucket, number>>>>>;

export function foundOf(sorted: readonly Sorted[]): FoundByRule {
  const out: Record<string, Partial<Record<Bucket, number>>> = {};
  for (const f of sorted) {
    const rule = ruleIdOf(f);
    const per = out[rule] ?? {};
    out[rule] = { ...per, [f.bucket]: (per[f.bucket] ?? 0) + 1 };
  }
  return out;
}

export function keepTracked(at: At, sorted: readonly Sorted[]): Promise<Result<string>> {
  return keepJson(at, FINDINGS_FILE, trackedOf(sorted));
}

const LENSES: ReadonlySet<unknown> = new Set(["rule", "logic"]);
const RULE_TYPES: ReadonlySet<string> = new Set(["undefined", "string"]);
const BUCKETS: ReadonlySet<unknown> = new Set(ASKED);
const KNOWN: ReadonlySet<unknown> = new Set(CATEGORIES);

function fieldsOf(raw: unknown): Record<string, unknown> {
  return typeof raw === "object" && raw !== null ? { ...raw } : {};
}

function hasWords(r: Record<string, unknown>): boolean {
  return [r.id, r.file].every((v) => typeof v === "string") && RULE_TYPES.has(typeof r.rule);
}

function isTracked(raw: unknown): raw is Tracked {
  const r = fieldsOf(raw);
  return hasWords(r) && LENSES.has(r.lens) && KNOWN.has(r.category) && BUCKETS.has(r.bucket) && isLine(r.line);
}

export function isActedRow(raw: unknown): raw is ActedRow {
  return isTracked(raw) && typeof Reflect.get(raw, "acted") === "boolean";
}

function isLine(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 1;
}

function parsed(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export async function readTracked(at: At): Promise<readonly Tracked[]> {
  const text = await readKept(at, FINDINGS_FILE);
  const raw = text.kind === "ok" ? parsed(text.value) : undefined;
  return Array.isArray(raw) && raw.every(isTracked) ? raw : [];
}

type Span = { readonly from: number; readonly to: number };

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/gm;
const OLD = /^--- a\/(.*)$/m;

function spanOf(m: RegExpExecArray): Span {
  const from = Number(m[1]);
  const count = m[2] === undefined ? 1 : Number(m[2]);
  return count === 0 ? { from, to: from + 1 } : { from, to: from + count - 1 };
}

function fileSpans(section: string): readonly (readonly [string, readonly Span[]])[] {
  const old = OLD.exec(section);
  return old === null ? [] : [[old[1] ?? "", [...section.matchAll(HUNK)].map(spanOf)]];
}

export function changedSpans(diff: string): ReadonlyMap<string, readonly Span[]> {
  return new Map(diff.split(/^diff --git /m).flatMap(fileSpans));
}

export function actedRows(
  tracked: readonly Tracked[],
  spans: ReadonlyMap<string, readonly Span[]>,
): readonly ActedRow[] {
  return tracked.map((t) => ({
    ...t,
    acted: (spans.get(t.file) ?? []).some((s) => s.from - REGION <= t.line && t.line <= s.to + REGION),
  }));
}

export async function actedSince(input: {
  readonly repo: string;
  readonly env: NodeJS.ProcessEnv;
  readonly recordsDir: string;
  readonly change: number;
  readonly since: string;
  readonly head: string;
}): Promise<Acted | "none"> {
  const tracked = await readTracked({ recordsDir: input.recordsDir, change: input.change, head: input.since });
  if (tracked.length === 0 || input.since === input.head) {
    return "none";
  }
  const diff = await hostGit({
    args: ["diff", "-U0", "--no-renames", "--no-color", "--no-ext-diff", input.since, input.head, "--"],
    repo: { kind: "repo", path: input.repo },
    env: input.env,
    stdin: { kind: "none" },
  });
  return diff.kind === "ok" ? { since: input.since, rows: actedRows(tracked, changedSpans(diff.stdout)) } : "none";
}

export type Rate = { readonly acted: number; readonly of: number };

function rateOf(rows: readonly ActedRow[]): Rate {
  return { acted: rows.filter((r) => r.acted).length, of: rows.length };
}

export function actedRates(rows: readonly ActedRow[]): {
  readonly all: Rate;
  readonly lens: Readonly<Record<string, Rate>>;
  readonly category: Readonly<Record<string, Rate>>;
  readonly bucket: Readonly<Record<string, Rate>>;
} {
  const by = (key: "lens" | "category" | "bucket") =>
    Object.fromEntries(
      [...new Set(rows.map((r) => r[key]))].toSorted().map((k) => [k, rateOf(rows.filter((r) => r[key] === k))]),
    );
  return { all: rateOf(rows), lens: by("lens"), category: by("category"), bucket: by("bucket") };
}
