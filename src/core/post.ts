// post — the one place that builds text the factory posts to a forge, Jira or an issue (#126; ADR-0012 S13).
//
// The words in a post come from a writer, a reviewer or a ticket, and any of them may carry an injected line. Posted
// with a person's or a bot's login, such a line acts: on GitLab a line that starts with "/" is a quick action run as
// the poster (/approve, /merge, /label); on GitHub and GitLab "@name" pings people and "fixes #12" closes an issue on
// merge; on Jira "@name" pings. So no free text is posted. A post is a fixed template, and outside words only fill its
// fields, each cleaned by cleanField:
//   - one line: line breaks and runs of white space become one space; control characters go
//   - no backtick of its own, so it cannot close a code span; HTML is escaped and "[" "]" are escaped, so no tag,
//     link or image renders
//   - URLs, @mentions and closing keywords with their reference are put in code spans: they show, but do not link,
//     ping or close anything
//   - a field never starts with "/"; it is capped in length, with "…" when cut
// The template writes the seat prefix ("[writer] " and so on) and the labels, so a field can never start a line.

export type Seat = "writer" | "reviewer" | "coordinator";

export type PostField = { readonly label: string; readonly value: string };

export type Post = {
  readonly seat: Seat;
  readonly title: string;
  readonly fields?: readonly PostField[];
  readonly items?: readonly string[];
};

export const DEFAULT_FIELD_LIMIT = 500;

const URL = /\bhttps?:\/\/[^\s<>"']+/gi;
// GitHub and GitLab closing keywords, then an issue reference: #12, group/project#12 or a full URL (already a span).
const CLOSING = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|implement(?:s|ed)?)\b:?\s+(?:[\w.-]+\/[\w./-]+)?#\d+/gi;
// @user, @group/subgroup, @all; not the middle of an e-mail address or a word.
const MENTION = /(^|[^\w`])(@[\w.-]+(?:\/[\w.-]+)*)/g;
// Every C0 and C1 control character, plus the line and paragraph separators.
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;

function span(text: string): string {
  return `\`${text}\``;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function cut(text: string, limit: number): string {
  const chars = Array.from(text);
  return chars.length <= limit ? text : `${chars.slice(0, Math.max(0, limit - 1)).join("").trimEnd()}…`;
}

// cleanField : one field's words, made safe to place inside a template line. See the header for the rules.
export function cleanField(value: string, limit: number = DEFAULT_FIELD_LIMIT): string {
  const flat = cut(value.replace(/`/g, "'").replace(CONTROL, " ").replace(/\s+/g, " ").trim(), limit);
  // URLs first, so a keyword or a mention inside a URL is shown as it is, in the URL's span
  const urls = flat.match(URL) ?? [];
  const neutral = flat
    .split(URL)
    .map((text) =>
      escapeHtml(text)
        .replace(/[[\]]/g, "\\$&")
        .replace(CLOSING, (m) => span(m))
        .replace(MENTION, (_m, before: string, who: string) => `${before}${span(who)}`),
    )
    .reduce((out, text, i) => out + text + (i < urls.length ? span(urls[i]!) : ""), "");
  return neutral.startsWith("/") ? `\\${neutral}` : neutral;
}

// renderPost : the full text of one post. The first line is "[seat] title"; each field is "- label: value"; each item
// is "- value". Labels are the factory's own words, so only their line breaks are removed.
export function renderPost(post: Post, limit: number = DEFAULT_FIELD_LIMIT): string {
  const lines = [`[${post.seat}] ${cleanField(post.title, limit)}`];
  const fields = post.fields ?? [];
  const items = post.items ?? [];
  if (fields.length + items.length > 0) {
    lines.push("");
  }
  fields.forEach((f) => lines.push(`- ${f.label.replace(/\s+/g, " ").trim()}: ${cleanField(f.value, limit)}`));
  items.forEach((item) => lines.push(`- ${cleanField(item, limit)}`));
  return lines.join("\n");
}
