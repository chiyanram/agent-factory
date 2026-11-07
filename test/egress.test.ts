import { describe, expect, it } from "vitest";
import { parseAllowlist } from "../src/core/egress/allowlist.js";
import { squidConf } from "../src/core/egress/squid.js";
import { proxyEnv } from "../src/core/egress/env.js";

describe("parseAllowlist", () => {
  it("keeps host names, sorted, and drops one a dotted entry covers", () => {
    expect(
      parseAllowlist([" api.anthropic.com ", ".npmjs.org", "registry.npmjs.org", "npmjs.org", "repo1.maven.org", ""]),
    ).toEqual({
      kind: "ok",
      hosts: [".npmjs.org", "api.anthropic.com", "repo1.maven.org"],
    });
  });

  it("does not let a dotted entry cover a host that only ends with the same letters", () => {
    expect(parseAllowlist([".x.com", "foox.com"])).toEqual({ kind: "ok", hosts: [".x.com", "foox.com"] });
  });

  it("keeps a name listed twice once", () => {
    expect(parseAllowlist(["api.anthropic.com", "api.anthropic.com"])).toEqual({
      kind: "ok",
      hosts: ["api.anthropic.com"],
    });
  });

  it("refuses an empty list", () => {
    expect(parseAllowlist(["", "  "]).kind).toBe("refused");
  });

  it.each([
    ["*.npmjs.org", "wildcard"],
    ["https://api.anthropic.com", "scheme, port or path"],
    ["api.anthropic.com:443", "scheme, port or path"],
    ["203.0.113.7", "IP address"],
    ["API.Anthropic.com", "lower-case host name"],
    ["localhost", "lower-case host name"],
  ])("refuses %s and says why", (entry, why) => {
    expect(parseAllowlist(["api.anthropic.com", entry])).toEqual({
      kind: "refused",
      reason: expect.stringContaining(why),
    });
  });

  it("names every bad entry at once", () => {
    const result = parseAllowlist(["*.a.com", "10.0.0.1"]);
    expect(result.kind).toBe("refused");
    if (result.kind !== "refused") return;
    expect(result.reason).toContain('"*.a.com" is a wildcard');
    expect(result.reason).toContain('"10.0.0.1" is an IP address');
  });
});

describe("squidConf", () => {
  const conf = squidConf({ hosts: [".npmjs.org", "api.anthropic.com"], upstream: { kind: "none" } });
  const lines = conf.split("\n");

  it("logs where its own user can write, never to the container's /dev/stdout, which stops Squid at start", () => {
    expect(conf).not.toContain("/dev/std");
    expect(lines.filter((l) => /^(access|cache)_log /.test(l)).every((l) => l.includes("/var/log/squid/"))).toBe(true);
  });

  it("allows the listed hosts by name only, never by reverse DNS", () => {
    expect(lines).toContain("acl allowed dstdomain -n .npmjs.org api.anthropic.com");
  });

  it("refuses plain HTTP and every port but 443 before it allows a host, and refuses the rest", () => {
    const access = lines.filter((l) => l.startsWith("http_access"));
    expect(access).toEqual([
      "http_access deny !CONNECT",
      "http_access deny !tls",
      "http_access allow allowed",
      "http_access deny all",
    ]);
  });

  it("goes direct when there is no upstream", () => {
    expect(conf).not.toMatch(/cache_peer|never_direct/);
  });

  it("sends every request through the corporate proxy when there is one", () => {
    const work = squidConf({
      hosts: ["api.anthropic.com"],
      upstream: { kind: "proxy", host: "proxy.corp.example", port: 8080 },
    });
    expect(work).toContain("cache_peer proxy.corp.example parent 8080 0 no-query default\n");
    expect(work).toContain("never_direct allow all\n");
  });
});

describe("proxyEnv", () => {
  const env = proxyEnv({ host: "factory-egress", port: 3128 });

  it("points every client at the proxy and keeps localhost direct", () => {
    expect(env.HTTPS_PROXY).toBe("http://factory-egress:3128");
    expect(env.https_proxy).toBe("http://factory-egress:3128");
    expect(env.HTTP_PROXY).toBe("http://factory-egress:3128");
    expect(env.NO_PROXY).toBe("localhost,127.0.0.1,::1");
  });

  it("points every JVM at the proxy", () => {
    expect(env.JAVA_TOOL_OPTIONS).toContain("-Dhttps.proxyHost=factory-egress -Dhttps.proxyPort=3128");
    expect(env.JAVA_TOOL_OPTIONS).toContain("-Dhttp.nonProxyHosts=localhost|127.*|[::1]");
  });
});
