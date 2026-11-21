// scrub — what looks like a token or a key, replaced before a text is kept or posted (P4: no record, trace
// or post ever holds a secret). The writer's why (writer/why.ts), every string a run record keeps (dispatch/records.ts)
// and every text the host posts (cleanField in post.ts, cleanBody in pr-body.ts) pass through it. Pure.

export const SCRUBBED = "[scrubbed]";

const CLOSER = "[`)\\]|]";
const VALUE = `(?:[^\\s"',}\`)\\]|]|${CLOSER}(?![\\s.,;:\`)\\]|]|$))+`;
const SEPARATOR = `["']?[ \\t]*[:=][ \\t]*["']?`;
const SCHEME = "(?:Basic|Token|Digest|Negotiate|NTLM|ApiKey)[ \\t]+";

const PLACEHOLDER = /^(?:…+|\.{3,}|<[^<>\s]*>|\$\{[A-Za-z_]\w*\}?|\$[A-Z_][A-Z0-9_]*|x+|X+|\*+|\d+|\[scrubbed\]?)$/;

const OPEN_ANGLE = /^<[^<>\s]*$/;
const ANGLE_REST = /^[^<>\n]*>/;

function prose(name: string, separator: string, value: string): boolean {
  return /^(?:[a-z]+|[A-Z][a-z]+)$/.test(name) && /^[ \t]*:[ \t]*$/.test(separator) && /^[A-Za-z][a-z]*$/.test(value);
}

function openAngle(value: string, rest: string): boolean {
  return OPEN_ANGLE.test(value) && ANGLE_REST.test(rest);
}

function namedValue(match: string, name: string, separator: string, value: string, at: number, text: string): string {
  const kept =
    PLACEHOLDER.test(value) || prose(name, separator, value) || openAngle(value, text.slice(at + match.length));
  return kept ? match : `${name}${separator}${SCRUBBED}`;
}

const SECRETS: readonly (readonly [RegExp, string | typeof namedValue])[] = [
  [
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----(?:[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----|(?:\r?\n[A-Za-z0-9+/=]+(?=\r?\n|$))*)/g,
    SCRUBBED,
  ],
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi, `$1${SCRUBBED}@`],
  [/\bsk-ant-[\w-]+/g, SCRUBBED],
  [/\bsk-[\w-]{20,}/g, SCRUBBED],
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

export function scrubSecrets(text: string): string {
  return SECRETS.reduce(
    (t, [pattern, by]) => (typeof by === "string" ? t.replace(pattern, by) : t.replace(pattern, by)),
    text,
  );
}

export function scrubbedJson(value: unknown, indent?: number): string {
  return JSON.stringify(value, (_key, v: unknown) => (typeof v === "string" ? scrubSecrets(v) : v), indent);
}
