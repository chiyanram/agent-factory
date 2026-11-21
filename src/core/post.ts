// post — the one place that builds text the factory posts to a forge, Jira or an issue (#126; ADR-0012 S13).
//
// The words in a post come from a writer, a reviewer or a ticket, and any of them may carry an injected line or a
// secret. Posted with a person's or a bot's login, such a line acts: on GitLab a line that starts with "/" is a quick
// action run as the poster (/approve, /merge, /label); on GitHub and GitLab "@name" pings people and a closing keyword
// before an issue reference closes that issue on merge; a link or an image can carry data out. So no free text is
// posted. A post is a fixed template, and outside words only fill its fields, each made inert by cleanField. It
// breaks the characters that start each of these, rather
// than matching every form a forge accepts, because a pattern always misses one (a review of the first version found
// "closing #1", "Closes issue #1" and a mention right after a code span):
//   - anything shaped like a secret (scrubSecrets, scrub.ts) is replaced first, while a key's lines are still lines,
//     and one that a hidden character splits too, so no post carries one out (P4)
//   - one line: line breaks and runs of white space become one space; control and invisible format characters go
//   - "\" is escaped first, so no later escape can be undone
//   - "@" (mentions, e-mail links), "#" and "!" (issue and merge-request references, and so closing keywords; Jira
//     images) get an invisible word joiner (U+2060) after them, "GH-" before a digit (GitHub's other reference form) one
//     after its hyphen, and "://" and every "www." (links, even after "_") one inside, so no forge sees a mention, a
//     reference or a link
//   - HTML is escaped; "[", "]", "{", "}", "|" and "`" get a backslash, so no Markdown or Jira link, image, macro or
//     code span forms
//   - a field never starts with "/", and it is capped in length after all of this, with "…" when cut
// The template writes the seat prefix ("[writer] " and so on) and the labels, so a field never starts a line. A label
// must be the factory's own plain words: renderPost refuses any other, as a result, never by throwing, so a caller
// such as the dispatcher handles the refusal instead of stopping mid-run.
//
// One post may carry model text past the template: a PR body (BodyPost) may end with the implementer's own Markdown,
// .factory/pr.md, and renderBody posts it only through cleanBody (pr-body.ts; ADR-0012 S13 as amended, #335). Notes and
// comments render with renderPost, which never reads it.

import { cleanBody } from "./pr-body.js";
import { scrubSecrets } from "./scrub.js";

export type Seat = "writer" | "reviewer" | "coordinator";

export type PostField = { readonly label: string; readonly value: string };

export type Post = {
  readonly seat: Seat;
  readonly title: string;
  readonly fields: readonly PostField[];
  readonly items: readonly string[];
};

export type PrBody = { readonly markdown: string; readonly host: string };

export type BodyPost = Post & { readonly prBody?: PrBody };

export type RenderResult =
  | { readonly kind: "ok"; readonly text: string }
  | { readonly kind: "refused"; readonly reason: string };

export const DEFAULT_FIELD_LIMIT = 500;

const JOIN = "\u2060";
export const CONTROL = /[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}\u2028\u2029]/gu;
const LABEL = /^[A-Za-z0-9 ()_.,'-]+$/;
const HIDDEN = /[\p{Cf}\p{Default_Ignorable_Code_Point}]/gu;

function cut(text: string, limit: number): string {
  const chars = Array.from(text);
  if (chars.length <= limit) {
    return text;
  }
  let kept = chars.slice(0, Math.max(0, limit - 1));
  while (kept.length > 0 && /[\\@#!:.]/.test(kept[kept.length - 1]!)) {
    kept = kept.slice(0, -1);
  }
  return `${kept.join("").trimEnd()}…`;
}

export function flatText(value: string): string {
  return value.replace(CONTROL, " ").replace(/\s+/g, " ").trim();
}

function scrubbed(value: string): string {
  const shown = value.replace(HIDDEN, "");
  const clean = scrubSecrets(shown);
  return clean === shown ? scrubSecrets(value) : clean;
}

export function cleanField(value: string, limit: number = DEFAULT_FIELD_LIMIT): string {
  const flat = flatText(scrubbed(value));
  const inert = flat
    .replace(/\\/g, "\\\\")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[[\]{}|`]/g, "\\$&")
    .replace(/[@#!]/g, `$&${JOIN}`)
    .replace(/:\/\//g, `:${JOIN}//`)
    .replace(/(www)\./gi, `$1${JOIN}.`)
    .replace(/(gh)-(?=\d)/gi, `$1-${JOIN}`);
  const capped = cut(inert, limit);
  return capped.startsWith("/") ? `\\${capped}` : capped;
}

export function renderPost(post: Post, limit: number = DEFAULT_FIELD_LIMIT): RenderResult {
  const bad = post.fields.find((f) => !LABEL.test(f.label));
  if (bad !== undefined) {
    return {
      kind: "refused",
      reason: `post label must be the factory's own plain words, got ${JSON.stringify(bad.label)}`,
    };
  }
  const head = [`[${post.seat}] ${cleanField(post.title, limit)}`];
  const body = [
    ...post.fields.map((f) => `- ${f.label}: ${cleanField(f.value, limit)}`),
    ...post.items.map((item) => `- ${cleanField(item, limit)}`),
  ];
  return { kind: "ok", text: [...head, ...(body.length > 0 ? ["", ...body] : [])].join("\n") };
}

export const PR_BODY_RULE = "---";

export function renderBody(post: BodyPost, limit: number = DEFAULT_FIELD_LIMIT): RenderResult {
  const head = renderPost(post, limit);
  if (head.kind === "refused" || post.prBody === undefined) {
    return head;
  }
  const markdown = cleanBody(post.prBody.markdown, { host: post.prBody.host });
  return markdown === "" ? head : { kind: "ok", text: `${head.text}\n\n${PR_BODY_RULE}\n\n${markdown}` };
}
