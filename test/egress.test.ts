import { describe, expect, it } from "vitest";
import { ownGitHostsOf, parseAllowlist } from "../src/core/egress/allowlist.js";
import { readyFieldsOf } from "../src/core/project.js";
import { squidConf } from "../src/core/egress/squid.js";
import { proxyEnv } from "../src/core/egress/env.js";

describe("parseAllowlist", () => {
  it("keeps host names, sorted, and drops one a dotted entry covers", () => {
    expect(
      parseAllowlist(
        [" api.anthropic.com ", ".npmjs.org", "registry.npmjs.org", "npmjs.org", "repo1.maven.org", ""],
        [],
      ),
    ).toEqual({
      kind: "ok",
      hosts: [".npmjs.org", "api.anthropic.com", "repo1.maven.org"],
    });
  });

  it("does not let a dotted entry cover a host that only ends with the same letters", () => {
    expect(parseAllowlist([".x.com", "foox.com"], [])).toEqual({ kind: "ok", hosts: [".x.com", "foox.com"] });
  });

  it("keeps a name listed twice once", () => {
    expect(parseAllowlist(["api.anthropic.com", "api.anthropic.com"], [])).toEqual({
      kind: "ok",
      hosts: ["api.anthropic.com"],
    });
  });

  it("refuses an empty list", () => {
    expect(parseAllowlist(["", "  "], []).kind).toBe("refused");
  });

  it.each([
    ["*.npmjs.org", "wildcard"],
    ["https://api.anthropic.com", "scheme, port or path"],
    ["api.anthropic.com:443", "scheme, port or path"],
    ["203.0.113.7", "IP address"],
    ["API.Anthropic.com", "lower-case host name"],
    ["localhost", "lower-case host name"],
  ])("refuses %s and says why", (entry, why) => {
    expect(parseAllowlist(["api.anthropic.com", entry], [])).toEqual({
      kind: "refused",
      reason: expect.stringContaining(why),
    });
  });

  it.each(["github.com", "api.github.com", ".github.com", "gitlab.com", ".gitlab.com", "registry.gitlab.com"])(
    "refuses the public git host %s, since the runner holds no git login and needs none",
    (entry) => {
      expect(parseAllowlist(["api.anthropic.com", entry], [])).toEqual({
        kind: "refused",
        reason: `${JSON.stringify(entry)} is a git host; the runner needs none, because the host clones, pushes and posts`,
      });
    },
  );

  it("refuses the project's own git host, and a dotted entry that covers it", () => {
    expect(parseAllowlist(["gitlab.corp.example"], []).kind).toBe("ok");
    expect(parseAllowlist(["gitlab.corp.example"], ["gitlab.corp.example"]).kind).toBe("refused");
    expect(parseAllowlist([".corp.example"], ["gitlab.corp.example"]).kind).toBe("refused");
  });

  it("keeps a host that only ends with a git host's letters, and the image registries near them", () => {
    expect(parseAllowlist(["notgithub.com", "ghcr.io", "objects.githubusercontent.com"], [])).toEqual({
      kind: "ok",
      hosts: ["ghcr.io", "notgithub.com", "objects.githubusercontent.com"],
    });
  });

  it("names every bad entry at once", () => {
    const result = parseAllowlist(["*.a.com", "10.0.0.1"], []);
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

// AC-4 of #485: a project on a company GitLab gets that host refused, whichever layer names it, and every caller
// passes the project's own host (parseAllowlist has no default for it)
describe("the project's own git host on the allowlist (#485)", () => {
  const file = { gate: "local", verify: ["make", "test"], ready: { programs: ["make"] } };

  it("refuses the company GitLab the machine names", () => {
    const read = readyFieldsOf(
      "/p.json",
      { ...file, egress: { allow: ["gitlab.corp.example"] } },
      {
        FACTORY_FORGE_HOST: "gitlab.corp.example",
      },
    );
    expect(read.kind).toBe("failed");
    expect(read.kind === "failed" ? read.reason : "").toContain("is a git host");
  });

  it("refuses the company GitLab a settings file names", () => {
    const raw = { ...file, gitHostName: "GitLab.Corp.Example ", egress: { allow: [".corp.example"] } };
    expect(readyFieldsOf("/p.json", raw, {}).kind).toBe("failed");
  });

  it("keeps a harmless host when the project's own git host is set", () => {
    const raw = { ...file, gitHostName: "gitlab.corp.example", egress: { allow: ["api.anthropic.com"] } };
    expect(readyFieldsOf("/p.json", raw, {}).kind).toBe("ok");
  });

  it("reads the own host lower case, once, and never a public one", () => {
    expect(ownGitHostsOf([" GitLab.Corp.Example", "gitlab.corp.example", "github.com", "", undefined])).toEqual([
      "gitlab.corp.example",
    ]);
  });
});
