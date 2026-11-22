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

type Rule = (text: string) => string;

function swap(pattern: RegExp, by: string): Rule {
  return (text) => text.replace(pattern, by);
}

function named(pattern: RegExp): Rule {
  return (text) => text.replace(pattern, namedValue);
}

const SECRETS: readonly Rule[] = [
  swap(
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----(?:[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----|(?:\r?\n[A-Za-z0-9+/=]+(?=\r?\n|$))*)/g,
    SCRUBBED,
  ),
  swap(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi, `$1${SCRUBBED}@`),
  swap(/\bsk-ant-[\w-]+/g, SCRUBBED),
  swap(/\bsk-[\w-]{20,}/g, SCRUBBED),
  swap(/\bgh[opsur]_\w{8,}/g, SCRUBBED),
  swap(/\bgithub_pat_\w{8,}/g, SCRUBBED),
  swap(/\bglpat-[\w-]{8,}/g, SCRUBBED),
  swap(/\bxox[abeoprs]-[\w-]{8,}/g, SCRUBBED),
  swap(/\bAKIA[0-9A-Z]{16}\b/g, SCRUBBED),
  swap(/\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]*/g, SCRUBBED),
  swap(/\b(Bearer)\s+[\w.~+/=-]+/gi, `$1 ${SCRUBBED}`),
  named(new RegExp(`\\b(Authorization)(${SEPARATOR}(?:${SCHEME})?)(?!Bearer\\s)(${VALUE})`, "gi")),
  named(new RegExp(`\\b(\\w*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY)\\w*)(${SEPARATOR})(${VALUE})`, "gi")),
];

export function scrubSecrets(text: string): string {
  return SECRETS.reduce((t, rule) => rule(t), text);
}

export function scrubbedJson(value: unknown, indent?: number): string {
  return JSON.stringify(value, (_key, v: unknown) => (typeof v === "string" ? scrubSecrets(v) : v), indent);
}
