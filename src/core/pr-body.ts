// pr-body — the implementer's PR body, .factory/pr.md, cleaned for posting (#335; ADR-0012 S13 as amended on #30,
// decision 1A). Pure: no model, no forge.
//
// The implementer writes the PR body in Markdown (PR1–PR7: the reason, the evidence table, breaking or not, the
// rollback, the changed files, where to look first). A model wrote it, so it may carry an injected line, which acts once
// it is posted with a person's or a bot's login. The cleaner keeps the Markdown a person reads (headings, lists, tables,
// emphasis, code) and makes every acting part inert:
//   - control and invisible format characters go; line ends become "\n"
//   - anything shaped like a secret (scrubSecrets, scrub.ts) is replaced, once no hidden character can split it and
//     before the rules below break "://" or "@" in a login, so no PR body carries one out (P4)
//   - raw HTML is dropped: comments and tags, outside code; any "<" left (in code, or "a < b") gets a word joiner
//     (U+2060) after it, so no forge reads a tag or an autolink there, whatever it takes for code
//   - "@" gets a word joiner after it, so no forge sees a mention or an e-mail link
//   - "&" before an entity gets one too, so no entity hides a character the rules below look for
//   - a line whose first character is "/" (a GitLab quick action: /approve, /merge) gets a "\" before it
//   - each reference after a closing keyword (Fixes #12, closes owner/repo#3, Resolved !4, Closes and an issue's
//     address) gets a word joiner after its "#" or "!", or inside its "://", so only the engine's own lines can close a
//     ticket; a plain "#12" after no keyword stays
//   - a link or image to a host other than the project's git host becomes plain text: its words, then its address
//     with a word joiner inside "://", so no forge links it; a relative link stays, as it points at the git host
//   - a reference definition ("[id]: url") to another host gets a "\" before it, so it defines nothing
//   - a bare address to another host gets the same word joiner, and so does "www."
//   - the text is capped at a line end, with a note that says so
// The rules that make a part inert hold anywhere in the text: a reader that disagrees with this one about where code
// starts or ends still sees nothing that acts. Only dropping HTML looks for code first, so a type such as List<String>
// in code keeps its words. Cleaning cleaned text gives the same text.

import { scrubSecrets } from "./scrub.js";

export const PR_BODY_PATH = ".factory/pr.md";

export const MAX_PR_BODY = 20_000;

const JOIN = "\u2060";
const INVISIBLE = /[\p{Cf}\p{Default_Ignorable_Code_Point}\u2028\u2029]|(?![\n\t])\p{Cc}/gu;
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

export type Cleaning = {
  readonly host: string;
  readonly limit?: number;
};

export function cutNote(limit: number): string {
  return `_The factory cut this PR body at ${limit} characters._`;
}

type Line = { readonly text: string; readonly code: boolean };

// CommonMark: the info string after a backtick fence may not hold a backtick.
// https://spec.commonmark.org/0.31.2/#fenced-code-blocks
function fenceOf(line: string): string | undefined {
  const m = FENCE.exec(line);
  return m === null ? undefined : fenceIn(String(m[1]), String(m[2]));
}

function fenceIn(fence: string, info: string): string | undefined {
  return fence.startsWith("`") && info.includes("`") ? undefined : fence;
}

function closes(line: string, fence: string): boolean {
  const m = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
  const run = m?.[1] ?? "";
  return run.startsWith(fence[0] ?? "") && run.length >= fence.length;
}

function linesOf(text: string): readonly Line[] {
  const out: Line[] = [];
  let open: string | undefined;
  for (const line of text.split("\n")) {
    const code = open !== undefined || fenceOf(line) !== undefined;
    open = open === undefined ? fenceOf(line) : closes(line, open) ? undefined : open;
    out.push({ text: line, code });
  }
  return out;
}

function codeSpans(line: string): readonly string[] {
  return line.split(/((`+)(?:[^`]|[^`][\s\S]*?[^`])\2(?!`))/).filter((_, i) => i % 3 !== 2);
}

const TAG = /<!--[\s\S]*?(?:-->|$)|<[!?][^<>]*>|<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*)?\/?>/g;
const AUTOLINK = /<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*)>/g;

function noHtml(text: string): string {
  return linesOf(text)
    .map((l) =>
      l.code
        ? l.text
        : codeSpans(l.text)
            .map((part, i) => (i % 2 === 1 ? part : part.replace(AUTOLINK, "$1").replace(TAG, "")))
            .join(""),
    )
    .join("\n");
}

export function onHost(address: string, host: string): boolean {
  const a = address.trim().replace(/^<(.*)>$/, "$1");
  if (/[\\&\s]/.test(a) || /^[/\\]{2}/.test(a)) {
    return false;
  }
  return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(a) ? webOn(a, host) : true;
}

function webOn(address: string, host: string): boolean {
  try {
    const url = new URL(address);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname === host.toLowerCase();
  } catch {
    return false;
  }
}

function inertAddress(text: string): string {
  return text.replace(/:\/\//g, `:${JOIN}//`).replace(/\b(www)\./gi, `$1${JOIN}.`);
}

const LINK_TEXT = String.raw`\[((?:[^\[\]\n]|\[[^\[\]\n]*\])*)\]`;
const ADDRESS = String.raw`<[^<>\n]*>|[^\s()<>]*(?:\([^\s()]*\)[^\s()<>]*)*`;
const TITLE = String.raw`"[^"\n]*"|'[^'\n]*'|\([^()\n]*\)`;
const LINK = new RegExp(String.raw`(!?)${LINK_TEXT}\(\s*(${ADDRESS})(?:\s+(?:${TITLE}))?\s*\)`, "g");
const DEFINITION = /^( {0,3})(\[[^\]\n]+\]:)[ \t]*(\S*)/;

function plainDefinition(line: string, host: string): string {
  const m = DEFINITION.exec(line);
  if (m === null) {
    return line;
  }
  const indent = String(m[1]);
  const address = String(m[3]);
  return address !== "" && onHost(address, host) ? line : `${indent}\\${line.slice(indent.length)}`;
}

const STRAY = /\]\(\s*(<[^<>\n]*>|[^\s()<>]*)/g;

function noOutsideLinks(text: string, host: string): string {
  const linked = text.replace(LINK, (whole, _bang: string, words: string, address: string) => {
    if (onHost(address, host)) {
      return whole;
    }
    const where = address.replace(/^<(.*)>$/, "$1");
    return words === "" || words === where ? where : `${words} (${where})`;
  });
  return linked
    .replace(STRAY, (whole, address: string) => (onHost(address, host) ? whole : `]\\${whole.slice(1)}`))
    .split("\n")
    .map((line) => plainDefinition(line, host))
    .join("\n");
}

const BARE = /\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s<>()[\]"'`]*/g;

function noOutsideAddresses(text: string, host: string): string {
  const bare = text.replace(BARE, (a) => (onHost(a, host) ? a : inertAddress(a)));
  const www = new RegExp(String.raw`\b(www)\.(?!${host.replace(/\./g, "\\.")}(?![\w.-]))`, "gi");
  return bare.replace(www, `$1${JOIN}.`);
}

// GitHub's closing keywords and GitLab's default closing pattern, in any case.
// https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue
// https://docs.gitlab.com/user/project/issues/managing_issues/#default-closing-pattern
const KEYWORD = String.raw`\b(?:clos(?:e[sd]?|ing)|fix(?:e[sd]|ing)?|resolv(?:e[sd]?|ing)|implement(?:s|ed|ing)?)\b`;
const REF = String.raw`(?:[\w.-]+\/[\w./-]+)?[#!]\d+|[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s<>()[\]"'\`]+`;
const CLOSING = new RegExp(
  String.raw`(${KEYWORD}[*_~\`]*:?[*_~\`]*[ \t]+[*_~\`]*)((?:${REF})(?:[*_~\`]*(?:\s*,\s*|\s+(?:and\s+)?|\s*,\s*and\s+)(?:${REF}))*)`,
  "gi",
);

function noClosing(text: string): string {
  return text.replace(
    CLOSING,
    (_whole, keyword: string, refs: string) =>
      `${keyword}${refs.replace(/[#!]/g, `$&${JOIN}`).replace(/:\/\//g, `:${JOIN}//`)}`,
  );
}

function inert(text: string): string {
  return noClosing(text)
    .replace(/</g, `<${JOIN}`)
    .replace(/@/g, `@${JOIN}`)
    .replace(/&(?=#|[A-Za-z][A-Za-z0-9]*;)/g, `&${JOIN}`)
    .replace(/^([ \t>]*)\//gm, "$1\\/");
}

function openFence(text: string): string | undefined {
  let open: string | undefined;
  for (const line of text.split("\n")) {
    open = open === undefined ? fenceOf(line) : closes(line, open) ? undefined : open;
  }
  return open;
}

function linesWithin(text: string, room: number): readonly string[] {
  const kept: string[] = [];
  let used = 0;
  for (const line of text.split("\n")) {
    used += Array.from(line).length + 1;
    if (used > room) {
      break;
    }
    kept.push(line);
  }
  const first = Array.from(text.split("\n")[0] ?? "");
  return kept.length > 0
    ? kept
    : [
        first
          .slice(0, room)
          .join("")
          .replace(/[\\@&<:./]+$/, ""),
      ];
}

function capped(text: string, limit: number): string {
  if (Array.from(text).length <= limit) {
    return text;
  }
  const note = cutNote(limit);
  const room = Math.max(0, limit - Array.from(note).length - 16);
  const kept = linesWithin(text, room);
  const fence = openFence(kept.join("\n"));
  return [...kept, ...(fence === undefined ? [] : [fence]), "", note].join("\n");
}

export function cleanBody(text: string, cleaning: Cleaning): string {
  const host = cleaning.host.toLowerCase();
  const plain = scrubSecrets(text.replace(/\r\n?/g, "\n").replace(INVISIBLE, ""));
  const cleaned = inert(noOutsideAddresses(noOutsideLinks(noHtml(plain), host), host)).trim();
  return capped(cleaned, cleaning.limit ?? MAX_PR_BODY);
}
