// allowlist — the hosts a box may reach through the egress proxy (#130), read from the project file (ADR-0014 P3). Pure.
//
// One entry is a host name, lower case, with no scheme, port, path or wildcard: "api.anthropic.com". A leading dot
// also allows every subdomain: ".npmjs.org" allows registry.npmjs.org and npmjs.org. An IP address is refused, because
// the proxy matches names, and an IP entry would let a writer reach any service on it. An entry that a dotted entry
// already covers is dropped, because Squid refuses a list that names the same host twice.

export type Allowlist =
  | { readonly kind: "ok"; readonly hosts: readonly string[] }
  | { readonly kind: "refused"; readonly reason: string };

const LABEL = "[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?";
const HOST = new RegExp(`^\\.?(${LABEL}\\.)+[a-z]{2,63}$`);

type Check = { readonly fails: (entry: string) => boolean; readonly why: string };

// the first rule an entry breaks names the problem
const CHECKS: readonly Check[] = [
  { fails: (e) => e.includes("*"), why: 'a wildcard; write ".example.com" to allow every subdomain' },
  { fails: (e) => e.includes("/") || e.includes(":"), why: "a scheme, port or path; write the host name alone" },
  { fails: (e) => /^\.?[\d.]+$/.test(e), why: "an IP address; the proxy allows host names only" },
  { fails: (e) => !HOST.test(e), why: "not a lower-case host name" },
];

// covered : a dotted entry ".x.com" covers "x.com" and every "<sub>.x.com"
function covered(host: string, by: readonly string[]): boolean {
  return by.some((d) => d !== host && d.startsWith(".") && (`.${host}` === d || host.endsWith(d)));
}

export function parseAllowlist(entries: readonly string[]): Allowlist {
  const trimmed = entries.map((e) => e.trim()).filter((e) => e.length > 0);
  if (trimmed.length === 0) {
    return { kind: "refused", reason: "the egress allowlist is empty; a box needs at least its model API" };
  }
  const bad = trimmed.flatMap((e) =>
    CHECKS.filter((c) => c.fails(e))
      .slice(0, 1)
      .map((c) => `${JSON.stringify(e)} is ${c.why}`),
  );
  if (bad.length > 0) {
    return { kind: "refused", reason: bad.join("; ") };
  }
  const unique = [...new Set(trimmed)];
  return { kind: "ok", hosts: unique.filter((h) => !covered(h, unique)).toSorted() };
}
