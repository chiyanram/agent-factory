// scrub — what looks like a token or a key, replaced before a text is kept or posted (P4: no record, trace
// or post ever holds a secret). The writer's why (writer/why.ts), every string a run record keeps (dispatch/records.ts)
// and every text the host posts (cleanField in post.ts, cleanBody in pr-body.ts) pass through it. Pure.

export const SCRUBBED = "[scrubbed]";

// a named value: what follows a name and its separator, kept on the line. It stops at white space, a quote, "," or "}",
// and at a Markdown closer (` ) ] |) that ends a code span, a link or a cell, so the scrub leaves that closer in place;
// a closer followed by anything else is part of the value
const CLOSER = "[`)\\]|]";
const VALUE = `(?:[^\\s"',}\`)\\]|]|${CLOSER}(?![\\s.,;:\`)\\]|]|$))+`;
const SEPARATOR = `["']?[ \\t]*[:=][ \\t]*["']?`;
// an Authorization header's scheme other than Bearer (whose rule is its own): the credential after it is the value
const SCHEME = "(?:Basic|Token|Digest|Negotiate|NTLM|ApiKey)[ \\t]+";

// a value that reads as no secret: a placeholder, a count, or [scrubbed] itself. The value stops at "}" or "]", so
// ${NAME} and [scrubbed] arrive without their ends; one that stops at a space inside <…> is OPEN_ANGLE
const PLACEHOLDER = /^(?:…+|\.{3,}|<[^<>\s]*>|\$\{[A-Za-z_]\w*\}?|\$[A-Z_][A-Z0-9_]*|x+|X+|\*+|\d+|\[scrubbed\]?)$/;

// a placeholder with a space in it, such as <your key>: its first word, then the rest of it up to ">" on the line
const OPEN_ANGLE = /^<[^<>\s]*$/;
const ANGLE_REST = /^[^<>\n]*>/;

// prose : whether a plain word (token, Password) and an unquoted ":" are followed by one word of letters. Pure.
function prose(name: string, separator: string, value: string): boolean {
  return /^(?:[a-z]+|[A-Z][a-z]+)$/.test(name) && /^[ \t]*:[ \t]*$/.test(separator) && /^[A-Za-z][a-z]*$/.test(value);
}

// openAngle : whether the value is the first word of a <…> placeholder that the rest of its line closes. Pure.
function openAngle(value: string, rest: string): boolean {
  return OPEN_ANGLE.test(value) && ANGLE_REST.test(rest);
}

// namedValue : the replacer for a name and its value: the value scrubbed, unless it reads as no secret: a placeholder,
// a count, or prose
function namedValue(match: string, name: string, separator: string, value: string, at: number, text: string): string {
  const kept =
    PLACEHOLDER.test(value) || prose(name, separator, value) || openAngle(value, text.slice(at + match.length));
  return kept ? match : `${name}${separator}${SCRUBBED}`;
}

// what looks like a secret: the model login and API keys, git host tokens, cloud and chat keys, a JWT, an
// Authorization header's value, and NAME=value where the name says token, secret, password or key (namedValue)
const SECRETS: readonly (readonly [RegExp, string | typeof namedValue])[] = [
  // a PEM private key, whole, across its lines; one cut off before its END line ends at its last line of key text
  [
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----(?:[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----|(?:\r?\n[A-Za-z0-9+/=]+(?=\r?\n|$))*)/g,
    SCRUBBED,
  ],
  // a login in a URL: scheme://user:password@host
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi, `$1${SCRUBBED}@`],
  [/\bsk-ant-[\w-]+/g, SCRUBBED],
  [/\bsk-[\w-]{20,}/g, SCRUBBED],
  // git host tokens, short ones too: a prefix this specific is never prose; under 8 characters it is a name, such as
  // ghs_test, not a token
  [/\bgh[opsur]_\w{8,}/g, SCRUBBED],
  [/\bgithub_pat_\w{8,}/g, SCRUBBED],
  [/\bglpat-[\w-]{8,}/g, SCRUBBED],
  [/\bxox[abeoprs]-[\w-]{8,}/g, SCRUBBED],
  [/\bAKIA[0-9A-Z]{16}\b/g, SCRUBBED],
  [/\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]*/g, SCRUBBED],
  [/\b(Bearer)\s+[\w.~+/=-]+/gi, `$1 ${SCRUBBED}`],
  [new RegExp(`\\b(Authorization)(${SEPARATOR}(?:${SCHEME})?)(?!Bearer\\s)(${VALUE})`, "gi"), namedValue],
  [new RegExp(`\\b(\\w*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY)\\w*)(${SEPARATOR})(${VALUE})`, "gi"), namedValue],
];

// scrubSecrets : the text with each thing that looks like a token or a key replaced by SCRUBBED. Pure.
export function scrubSecrets(text: string): string {
  // two calls, one per kind of replacement, because no one overload of replace takes either
  return SECRETS.reduce(
    (t, [pattern, by]) => (typeof by === "string" ? t.replace(pattern, by) : t.replace(pattern, by)),
    text,
  );
}

// scrubbedJson : a value as JSON text with every string in it scrubbed, so the text still parses: a whole-text scrub
// could cut a string's closing quote or a key's number. Pure.
export function scrubbedJson(value: unknown, indent?: number): string {
  return JSON.stringify(value, (_key, v: unknown) => (typeof v === "string" ? scrubSecrets(v) : v), indent);
}
