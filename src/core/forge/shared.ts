// shared — what both adapters do the same way: paging, posting through the template, the line-finding fallback, and
// the end of a failed CI job's log.
//
// A failed page fails the whole list, because a partial list reads as "nothing more". When two or more changes are open
// from one branch, no one of them is trusted, and a person decides.

import { tailOf } from "../kept.js";
import type { Note } from "../notes.js";
import { cleanField, renderBody, renderPost, type BodyPost, type Post } from "../post.js";
import { plainBranch } from "../branch.js";
import type { Done, Failed, Result, Variable } from "./api.js";
import type { Reader } from "./read.js";
import type { BranchState, ChangeRequest, FailedJob, JobLog, OpenChange } from "./types.js";

export type Cursor = { readonly kind: "start" } | { readonly kind: "after"; readonly cursor: string };
export type Page<T> = { readonly items: readonly T[]; readonly next: Cursor | { readonly kind: "end" } };

const MAX_PAGES = 200;

export async function pages<T>(fetch: (cursor: Cursor) => Promise<Result<Page<T>>>): Promise<Result<readonly T[]>> {
  const items: T[] = [];
  let cursor: Cursor = { kind: "start" };
  for (let n = 0; n < MAX_PAGES; n++) {
    const page = await fetch(cursor);
    if (page.kind === "failed") {
      return page;
    }
    items.push(...page.value.items);
    if (page.value.next.kind === "end") {
      return { kind: "ok", value: items };
    }
    cursor = page.value.next;
  }
  return { kind: "failed", reason: `the forge kept answering "there is more" after ${MAX_PAGES} pages` };
}

export function after(cursor: Cursor, name = "after"): Readonly<Record<string, Variable>> {
  return cursor.kind === "after" ? { [name]: { kind: "text", value: cursor.cursor } } : {};
}

export function nextPage(full: boolean, page: number): Cursor | { readonly kind: "end" } {
  return full ? { kind: "after", cursor: String(page + 1) } : { kind: "end" };
}

export function labelledAt(added: readonly { readonly at: string; readonly label: string }[], label: string): string {
  return added.filter((e) => e.label === label).reduce((max, e) => (e.at > max ? e.at : max), "");
}

export function nextCursor(r: Reader, value: unknown, path: string): Cursor | { readonly kind: "end" } {
  return r.bool(value, `${path}.hasNextPage`)
    ? { kind: "after", cursor: r.text(value, `${path}.endCursor`) }
    : { kind: "end" };
}

export function text(variable: string): Variable {
  return { kind: "text", value: variable };
}

export function rendered(post: Post): Result<string> {
  const result = renderPost(post);
  return result.kind === "ok" ? { kind: "ok", value: result.text } : { kind: "failed", reason: result.reason };
}

export function renderedBody(post: BodyPost): Result<string> {
  const result = renderBody(post);
  return result.kind === "ok" ? { kind: "ok", value: result.text } : { kind: "failed", reason: result.reason };
}

export function unanchored(post: Post, at: { readonly file: string; readonly line: number }): Post {
  return { ...post, fields: [{ label: "at", value: `${at.file}:${at.line}` }, ...post.fields] };
}

export function done<T>(result: Result<T>): Done {
  return result.kind === "ok" ? { kind: "ok" } : result;
}

export type RawOpen = {
  readonly change: OpenChange;
  readonly more: boolean;
  readonly start: string;
  readonly manyLabels: boolean;
};
export type Earlier = { readonly notes: readonly Note[]; readonly more: boolean; readonly start: string };
export type FetchEarlier = (input: { readonly number: number; readonly before: Cursor }) => Promise<Result<Earlier>>;

async function earlier(number: number, start: string, fetch: FetchEarlier): Promise<Result<readonly Note[]>> {
  const chunks: (readonly Note[])[] = [];
  let before: Cursor = { kind: "after", cursor: start };
  for (let n = 0; n < MAX_PAGES; n++) {
    const page = await fetch({ number, before });
    if (page.kind === "failed") {
      return page;
    }
    chunks.unshift(page.value.notes);
    if (!page.value.more) {
      return { kind: "ok", value: chunks.flat() };
    }
    before = { kind: "after", cursor: page.value.start };
  }
  return { kind: "failed", reason: `the forge kept answering "there are older comments" after ${MAX_PAGES} pages` };
}

async function complete(raw: RawOpen, mark: string, fetch: FetchEarlier): Promise<Result<OpenChange>> {
  if (raw.manyLabels) {
    return { kind: "failed", reason: `${mark}${raw.change.number} has more than 100 labels; the seam reads 100` };
  }
  if (!raw.more) {
    return { kind: "ok", value: raw.change };
  }
  const before = await earlier(raw.change.number, raw.start, fetch);
  return before.kind === "ok"
    ? { kind: "ok", value: { ...raw.change, comments: [...before.value, ...raw.change.comments] } }
    : before;
}

export async function completeAll(
  raws: readonly RawOpen[],
  mark: string,
  fetch: FetchEarlier,
): Promise<Result<readonly OpenChange[]>> {
  const changes: OpenChange[] = [];
  for (const raw of raws) {
    const full = await complete(raw, mark, fetch);
    if (full.kind === "failed") {
      return full;
    }
    changes.push(full.value);
  }
  return { kind: "ok", value: changes };
}

const TITLE_LIMIT = 200;

export type ChangeWords = { readonly title: string; readonly body: string };

export function reuse(
  numbers: readonly number[],
  where: { readonly mark: string; readonly branch: string },
): { readonly kind: "open" } | { readonly kind: "reuse"; readonly number: number } | Failed {
  const [only, second] = numbers;
  if (only === undefined) {
    return { kind: "open" };
  }
  return second === undefined
    ? { kind: "reuse", number: only }
    : {
        kind: "failed",
        reason: `${numbers.length} changes are open from ${where.branch}: ${numbers.map((n) => `${where.mark}${n}`).join(", ")}; a person decides`,
      };
}

export function changeWords(request: ChangeRequest): Result<ChangeWords> {
  if (!plainBranch(request.branch) || !plainBranch(request.base)) {
    return {
      kind: "failed",
      reason: `branch ${JSON.stringify(request.branch)} onto ${JSON.stringify(request.base)} is not a plain branch`,
    };
  }
  const body = renderedBody(request.body);
  return body.kind === "ok"
    ? { kind: "ok", value: { title: cleanField(request.title, TITLE_LIMIT), body: body.value } }
    : body;
}

export async function openOnce(input: {
  readonly mark: string;
  readonly request: ChangeRequest;
  readonly find: () => Promise<Result<readonly number[]>>;
  readonly create: (words: ChangeWords) => Promise<Result<number>>;
}): Promise<Result<number>> {
  const words = changeWords(input.request);
  if (words.kind === "failed") {
    return words;
  }
  const found = await input.find();
  return found.kind === "ok"
    ? act(reuse(found.value, { mark: input.mark, branch: input.request.branch }), () => input.create(words.value))
    : found;
}

function act(
  decided: ReturnType<typeof reuse>,
  create: () => Promise<Result<number>>,
): Promise<Result<number>> | Result<number> {
  switch (decided.kind) {
    case "open":
      return create();
    case "reuse":
      return { kind: "ok", value: decided.number };
    case "failed":
      return decided;
  }
}

export const MAX_JOB_LOGS = 3;

export async function withLogs<T>(
  jobs: readonly T[],
  name: (job: T) => string,
  log: (job: T) => Promise<JobLog>,
): Promise<readonly FailedJob[]> {
  return Promise.all(
    jobs.map(async (job, i) => ({
      name: name(job),
      log:
        i < MAX_JOB_LOGS
          ? await log(job)
          : ({ kind: "none", why: `only the first ${MAX_JOB_LOGS} logs are read` } as const),
    })),
  );
}

export function logOf(read: Result<string>): JobLog {
  return read.kind === "ok" ? { kind: "tail", text: tailOf(read.value) } : { kind: "none", why: read.reason };
}

export function branchStateOf(states: readonly string[]): BranchState {
  const order: readonly BranchState[] = ["merged", "opened", "closed"];
  return order.find((s) => states.includes(s)) ?? "none";
}
