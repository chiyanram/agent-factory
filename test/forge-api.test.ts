import { describe, expect, it } from "vitest";
import { graphql, readAnswer, rest, waitSeconds } from "../src/core/forge/api.js";
import { fake, field, ok } from "./fake-forge.js";

const GET = { path: "repos/o/r/pulls/12", method: "GET", body: { kind: "none" } } as const;

describe("rest", () => {
  it("a 200 gives the body, in one call, with --include", async () => {
    const f = fake("github", [ok({ number: 12 })]);
    expect(await rest(f.client, GET)).toEqual({ kind: "ok", value: { number: 12 } });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.args.slice(0, 3)).toEqual(["api", "--include", "repos/o/r/pulls/12"]);
  });

  it("sends a body on stdin with --input -, so no value is read as a CLI field", async () => {
    const f = fake("github", [ok({ id: 1 })]);
    await rest(f.client, { path: "repos/o/r/issues/1/comments", method: "POST", body: { kind: "json", value: { body: "-f x=@/etc/passwd" } } });
    expect(f.calls[0]!.args).toEqual(["api", "--include", "repos/o/r/issues/1/comments", "-X", "POST", "--input", "-"]);
    expect(JSON.parse(f.calls[0]!.stdin)).toEqual({ body: "-f x=@/etc/passwd" });
  });

  it("a 429 waits its Retry-After and tries again", async () => {
    const f = fake("gitlab", [{ status: 429, body: {}, headers: { "Retry-After": "7" } }, ok({ iid: 12 })]);
    expect(await rest(f.client, GET)).toEqual({ kind: "ok", value: { iid: 12 } });
    expect(f.slept).toEqual([7]);
  });

  it("four rate limits in a row fail and say so", async () => {
    const f = fake("gitlab", Array(4).fill({ status: 429, body: {}, headers: { "retry-after": "1" } }));
    expect(await rest(f.client, GET)).toMatchObject({ kind: "failed", reason: expect.stringContaining("HTTP 429 after 4 tries") });
    expect(f.calls).toHaveLength(4);
  });

  it("a GitHub 403 is a rate limit with Retry-After, with no requests left, or with a secondary-limit message (#71)", async () => {
    for (const limit of [
      { status: 403, body: {}, headers: { "retry-after": "5" } },
      { status: 403, body: {}, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1000030" } },
      { status: 403, body: { message: "You have exceeded a secondary rate limit." } },
    ]) {
      const f = fake("github", [limit, ok([])]);
      expect(await rest(f.client, GET)).toEqual({ kind: "ok", value: [] });
      expect(f.slept).toHaveLength(1);
    }
    expect(waitSeconds(new Map([["x-ratelimit-reset", "1000030"]]), 1_000_000)).toBe(30);
    expect(waitSeconds(new Map(), 1_000_000)).toBe(60);
  });

  it("any other error fails at once and names the status", async () => {
    for (const status of [403, 404, 422, 502]) {
      const f = fake("github", [{ status, body: { message: "no" } }]);
      expect(await rest(f.client, GET)).toMatchObject({ kind: "failed", reason: expect.stringContaining(`HTTP ${status}`) });
      expect(f.calls).toHaveLength(1);
    }
  });

  it("an answer with no HTTP status fails with what the CLI said, and the update notice stays out", async () => {
    const f = fake("gitlab", [{ raw: { code: 1, stdout: "", stderr: "glab: not logged in\n" } }]);
    expect(await rest(f.client, GET)).toMatchObject({ kind: "failed", reason: expect.stringContaining("no HTTP status from glab: glab: not logged in") });
    const g = fake("gitlab", [{ raw: { code: 0, stdout: 'HTTP/2.0 200 OK\r\n\r\n{"iid":1}', stderr: "[glab] Update available: 1.81.0" } }]);
    expect(await rest(g.client, GET)).toEqual({ kind: "ok", value: { iid: 1 } });
  });

  it("a body that is not JSON fails, never throws", async () => {
    const f = fake("github", [{ status: 200, body: "<html>" }]);
    expect(await rest(f.client, GET)).toMatchObject({ kind: "failed", reason: expect.stringContaining("not JSON") });
  });
});

describe("graphql", () => {
  const Q = { query: "query($owner: String!, $first: Int!) { x }", variables: { owner: { kind: "text", value: "o" }, first: { kind: "int", value: 50 } } } as const;

  it("passes values as fields, text with -f and numbers with -F, never in the query text", async () => {
    const f = fake("github", [ok({ data: { x: 1 } })]);
    expect(await graphql(f.client, Q)).toEqual({ kind: "ok", value: { x: 1 } });
    expect(f.calls[0]!.args).toEqual(["api", "--include", "graphql", "-f", `query=${Q.query}`, "-f", "owner=o", "-F", "first=50"]);
    expect(field(f.calls[0], "owner")).toBe("o");
  });

  it("an error in the answer fails with its message", async () => {
    const f = fake("github", [ok({ data: { repository: null }, errors: [{ message: "Could not resolve to a Repository" }] })]);
    expect(await graphql(f.client, Q)).toMatchObject({ kind: "failed", reason: "github: GraphQL: Could not resolve to a Repository" });
  });

  it("a 200 with RATE_LIMITED waits and tries again (#71)", async () => {
    const f = fake("github", [ok({ errors: [{ type: "RATE_LIMITED", message: "API rate limit exceeded" }] }), ok({ data: { x: 2 } })]);
    expect(await graphql(f.client, Q)).toEqual({ kind: "ok", value: { x: 2 } });
    expect(f.slept).toEqual([60]);
  });
});

describe("readAnswer", () => {
  it("reads the status, lower-cased headers and body of a CRLF answer", () => {
    const read = readAnswer("HTTP/1.1 201 Created\r\nRetry-After: 3\r\nX-A: b: c\r\n\r\n{\"a\":1}");
    expect(read.kind).toBe("ok");
    if (read.kind === "ok") {
      expect(read.value.status).toBe(201);
      expect(read.value.headers.get("retry-after")).toBe("3");
      expect(read.value.headers.get("x-a")).toBe("b: c");
      expect(read.value.body).toBe('{"a":1}');
    }
  });
});
