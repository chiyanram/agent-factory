// squid — the egress proxy's whole configuration, rendered from the allowlist (#130). Pure.
//
// The box sits on a Docker --internal network with no route out; this proxy is its only way out (decision B on #30,
// 2026-11-07). It allows a CONNECT to port 443 of an allowed host and nothing else: no plain HTTP, no other port, no
// cache. TLS is never opened, so the proxy sees only the host name. At work, every request leaves through the
// corporate proxy (upstream), never direct.

export const PROXY_PORT = 3128;

export type Upstream = { readonly kind: "none" } | { readonly kind: "proxy"; readonly host: string; readonly port: number };

export function squidConf(input: { readonly hosts: readonly string[]; readonly upstream: Upstream }): string {
  const lines = [
    "# rendered by agent-factory (#130); do not edit, it is written again on every start",
    `http_port ${PROXY_PORT}`,
    // -n: never match by reverse DNS, because the owner of an IP sets its PTR name and could name an allowed host
    `acl allowed dstdomain -n ${input.hosts.join(" ")}`,
    "acl CONNECT method CONNECT",
    "acl tls port 443",
    "http_access deny !CONNECT",
    "http_access deny !tls",
    "http_access allow allowed",
    "http_access deny all",
    "cache deny all",
    "via off",
    "forwarded_for delete",
    "access_log stdio:/dev/stdout",
    "cache_log /dev/stderr",
    ...upstreamLines(input.upstream),
  ];
  return `${lines.join("\n")}\n`;
}

function upstreamLines(upstream: Upstream): readonly string[] {
  switch (upstream.kind) {
    case "none":
      return [];
    case "proxy":
      return [`cache_peer ${upstream.host} parent ${upstream.port} 0 no-query default`, "never_direct allow all"];
  }
}
