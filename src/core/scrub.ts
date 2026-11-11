// scrub — what looks like a token or a key, replaced before a text is kept (#62, #485; P4: no record or trace ever
// holds a secret). The writer's why (writer/why.ts) and every string a run record keeps (dispatch/records.ts) pass
// through it. Pure.

export const SCRUBBED = "[scrubbed]";

// what looks like a secret: the model login and API keys, git host tokens, cloud and chat keys, a JWT, an
// Authorization header's value, and NAME=value where the name says token, secret, password or key
const SECRETS: readonly (readonly [RegExp, string])[] = [
  // a PEM private key, whole, across its lines
  [/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g, SCRUBBED],
  // a login in a URL: scheme://user:password@host
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi, `$1${SCRUBBED}@`],
  [/\bsk-ant-[\w-]+/g, SCRUBBED],
  [/\bsk-[\w-]{20,}/g, SCRUBBED],
  // git host tokens, short ones too: a prefix this specific is never prose
  [/\bgh[opsur]_\w{4,}/g, SCRUBBED],
  [/\bgithub_pat_\w{4,}/g, SCRUBBED],
  [/\bglpat-[\w-]{4,}/g, SCRUBBED],
  [/\bxox[abeoprs]-[\w-]{8,}/g, SCRUBBED],
  [/\bAKIA[0-9A-Z]{16}\b/g, SCRUBBED],
  [/\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]*/g, SCRUBBED],
  [/\b(Bearer)\s+[\w.~+/=-]+/gi, `$1 ${SCRUBBED}`],
  [/\b(Authorization)(["']?\s*[:=]\s*["']?)(?!Bearer\s)[^\s"',}]+/gi, `$1$2${SCRUBBED}`],
  [/\b(\w*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY)\w*)(["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, `$1$2${SCRUBBED}`],
];

// scrubSecrets : the text with each thing that looks like a token or a key replaced by SCRUBBED. Pure.
export function scrubSecrets(text: string): string {
  return SECRETS.reduce((t, [pattern, by]) => t.replace(pattern, by), text);
}
