// shared — what both adapters do the same way: paging, posting through the template, and the line-finding fallback.

import type { Note } from "../notes.js";
import { renderPost, type Post } from "../post.js";
import type { Done, Result, Variable } from "./api.js";
import type { Reader } from "./read.js";
import type { OpenChange } from "./types.js";

// A page of a list, and where the next one starts.
export type Cursor = { readonly kind: "start" } | { readonly kind: "after"; readonly cursor: string };
export type Page<T> = { readonly items: readonly T[]; readonly next: Cursor | { readonly kind: "end" } };

// No forge list the factory reads comes near this; more pages means the forge keeps answering "there is more".
const MAX_PAGES = 200;

// pages : every item of a paged list, in order. A failed page fails the whole list: a partial list would read as
// "nothing more" (no unclaimed change, no open ask), which is the silent default the seam must not have.
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

// after : the GraphQL variable for a cursor; none on the first page.
export function after(cursor: Cursor, name = "after"): Readonly<Record<string, Variable>> {
  return cursor.kind === "after" ? { [name]: { kind: "text", value: cursor.cursor } } : {};
}

// nextPage : the next page number of a REST list that pages by number: a full page means there may be more.
export function nextPage(full: boolean, page: number): Cursor | { readonly kind: "end" } {
  return full ? { kind: "after", cursor: String(page + 1) } : { kind: "end" };
}

// nextCursor : the next cursor from a GraphQL pageInfo at path. The cursor is read only when there is a next page:
// GraphQL sends null for it on the last page.
export function nextCursor(r: Reader, value: unknown, path: string): Cursor | { readonly kind: "end" } {
  return r.bool(value, `${path}.hasNextPage`)
    ? { kind: "after", cursor: r.text(value, `${path}.endCursor`) }
    : { kind: "end" };
}

export function text(variable: string): Variable {
  return { kind: "text", value: variable };
}

// rendered : the post's text, or the template's refusal as a failure.
export function rendered(post: Post): Result<string> {
  const result = renderPost(post);
  return result.kind === "ok" ? { kind: "ok", value: result.text } : { kind: "failed", reason: result.reason };
}

// unanchored : the same post with the file and line as a field, for a forge that refused the line. The seat prefix stays
// first, so the note still reads as the factory's under the developer's login (#128), and the path is cleaned like any
// other outside text.
export function unanchored(post: Post, at: { readonly file: string; readonly line: number }): Post {
  return { ...post, fields: [{ label: "at", value: `${at.file}:${at.line}` }, ...post.fields] };
}

export function done<T>(result: Result<T>): Done {
  return result.kind === "ok" ? { kind: "ok" } : result;
}

// An open change as its first page read it: its newest 100 comments, and whether older ones are left.
export type RawOpen = {
  readonly change: OpenChange;
  readonly more: boolean;
  readonly start: string;
  readonly manyLabels: boolean;
};
export type Earlier = { readonly notes: readonly Note[]; readonly more: boolean; readonly start: string };
export type FetchEarlier = (input: { readonly number: number; readonly before: Cursor }) => Promise<Result<Earlier>>;

// earlier : the comments before the newest 100, oldest first, page by page back to the first.
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

// completeAll : every open change with all of its comments, so an ask older than the newest 100 is still counted.
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
