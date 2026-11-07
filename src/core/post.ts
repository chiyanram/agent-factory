// post — the one place that builds text the factory posts to a forge, Jira or an issue (#126; ADR-0012 S13).
//
// The words in a post come from a writer, a reviewer or a ticket, and any of them may carry an injected line. Posted
// with a person's or a bot's login, such a line acts: on GitLab a line that starts with "/" is a quick action run as
// the poster (/approve, /merge, /label); on GitHub and GitLab "@name" pings people and "closes #12" closes an issue on
// merge; a link or an image can carry data out. So no free text is posted. A post is a fixed template, and outside
// words only fill its fields, each made inert by cleanField. It breaks the characters that start each of these, rather
// than matching every form a forge accepts, because a pattern always misses one (a review of the first version found
// "closing #1", "Closes issue #1" and a mention right after a code span):
//   - one line: line breaks and runs of white space become one space; control and invisible format characters go
//   - "\" is escaped first, so no later escape can be undone
//   - "@" (mentions, e-mail links), "#" and "!" (issue and merge-request references, and so closing keywords; Jira
//     images) get an invisible word joiner (U+2060) after them, and "://" and "www." (links) one inside, so no forge sees a
//     mention, a reference or a link
//   - HTML is escaped; "[", "]", "{", "}", "|" and "`" get a backslash, so no Markdown or Jira link, image, macro or
//     code span forms
//   - a field never starts with "/", and it is capped in length after all of this, with "…" when cut
// The template writes the seat prefix ("[writer] " and so on) and the labels, so a field never starts a line. A label
// must be the factory's own plain words: renderPost refuses any other, as a result, never by throwing, so a caller
// such as the dispatcher handles the refusal instead of stopping mid-run.

export type Seat = "writer" | "reviewer" | "coordinator";

export type PostField = { readonly label: string; readonly value: string };

export type Post = {
  readonly seat: Seat;
  readonly title: string;
  readonly fields: readonly PostField[];
  readonly items: readonly string[];
};

export type RenderResult =
  | { readonly kind: "ok"; readonly text: string }
  | { readonly kind: "refused"; readonly reason: string };

export const DEFAULT_FIELD_LIMIT = 500;

const JOIN = "\u2060";
// Every C0 and C1 control character, the invisible format characters a field could use to undo a break (zero-width
// spaces and joiners, bidi controls, the word joiner itself, the BOM), and the line and paragraph separators.
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2028\u2029\u2060-\u2064\ufeff]/g;
const LABEL = /^[A-Za-z0-9 ()_.,'-]+$/;

function cut(text: string, limit: number): string {
  const chars = Array.from(text);
  if (chars.length <= limit) {
    return text;
  }
  let kept = chars.slice(0, Math.max(0, limit - 1));
  // never end on an escaping "\" or on a character whose word joiner was cut off
  while (kept.length > 0 && /[\\@#!:.]/.test(kept[kept.length - 1]!)) {
    kept = kept.slice(0, -1);
  }
  return `${kept.join("").trimEnd()}…`;
}

// cleanField : one field's words, made inert inside a template line. See the header for the rules.
export function cleanField(value: string, limit: number = DEFAULT_FIELD_LIMIT): string {
  const flat = value.replace(CONTROL, " ").replace(/\s+/g, " ").trim();
  const inert = flat
    .replace(/\\/g, "\\\\")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[[\]{}|`]/g, "\\$&")
    .replace(/[@#!]/g, `$&${JOIN}`)
    .replace(/:\/\//g, `:${JOIN}//`)
    .replace(/\b(www)\./gi, `$1${JOIN}.`);
  const capped = cut(inert, limit);
  return capped.startsWith("/") ? `\\${capped}` : capped;
}

// renderPost : the full text of one post. The first line is "[seat] title"; each field is "- label: value"; each item
// is "- value". A label outside the factory's own plain words is refused, so no caller can pass outside text as one.
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
