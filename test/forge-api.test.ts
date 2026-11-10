import { describe, expect, it } from "vitest";
import { graphql, processRunner, rateLimitedUntil, readAnswer, rest, waitSeconds } from "../src/core/forge/api.js";
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
    await rest(f.client, {
      path: "repos/o/r/issues/1/comments",
      method: "POST",
      body: { kind: "json", value: { body: "-f x=@/etc/passwd" } },
    });
    expect(f.calls[0]!.args).toEqual(["api", "--include", "repos/o/r/issues/1/comments", "-X", "POST", "--input", "-"]);
    expect(JSON.parse(f.calls[0]!.stdin)).toEqual({ body: "-f x=@/etc/passwd" });
  });

  it("a 429 waits its Retry-After and tries again", async () => {
    const f = fake("gitlab", [{ status: 429, body: {}, headers: { "Retry-After": "7" } }, ok({ iid: 12 })]);
    expect(await rest(f.client, GET)).toEqual({ kind: "ok", value: { iid: 12 } });
    expect(f.slept).toEqual([7]);
  });

  it("four rate limits in a row fail and say so, with the time the limit lasts until", async () => {
    const f = fake("gitlab", Array(4).fill({ status: 429, body: {}, headers: { "retry-after": "1" } }));
    expect(await rest(f.client, GET)).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("rate limited until 1970-01-12T13:46:41Z: HTTP 429 after 4 tries"),
    });
    expect(f.calls).toHaveLength(4);
    expect(f.slept).toEqual([1, 1, 1]);
  });

  it("a GitHub 403 is a rate limit with Retry-After, with no requests left, or with a secondary-limit message (#71)", async () => {
    for (const limit of [
      { status: 403, body: {}, headers: { "retry-after": "5" } },
      { status: 403, body: {}, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1000030" } },
      { status: 403, body: { message: "You have exceeded a secondary rate limit." } },
      { status: 403, body: { message: "You have triggered an abuse detection mechanism." } },
    ]) {
      const f = fake("github", [limit, ok([])]);
      expect(await rest(f.client, GET)).toEqual({ kind: "ok", value: [] });
      expect(f.slept).toHaveLength(1);
    }
    expect(waitSeconds(new Map(), 1_000_000)).toBe(60);
  });

  it("waits for the reset only when no requests are left, else a minute doubled for each limit in a row (#71, #62)", () => {
    const at = (h: Record<string, string>, tries = 1) => waitSeconds(new Map(Object.entries(h)), 1_000_000, tries);
    expect(at({ "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1000030" })).toBe(30);
    // a secondary limit: requests are left, and the reset is a second away
    expect(at({ "x-ratelimit-remaining": "4000", "x-ratelimit-reset": "1000001" })).toBe(60);
    expect(at({ "x-ratelimit-remaining": "4000" }, 2)).toBe(120);
    expect(at({}, 3)).toBe(240);
    expect(at({ "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1003600" })).toBe(3600);
    expect(at({ "retry-after": "7200" })).toBe(7200);
  });

  it("a limit that lasts past 5 minutes is not waited: one call, and the reason names the reset (#62)", async () => {
    const f = fake("github", [
      {
        status: 403,
        body: { message: "API rate limit exceeded" },
        headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1001200" },
      },
      ok([]),
    ]);
    const sent = await rest(f.client, GET);
    expect(sent).toEqual({
      kind: "failed",
      reason:
        "github: rate limited until 1970-01-12T14:06:40Z: HTTP 403 after 1 try on repos/o/r/pulls/12: API rate limit exceeded",
    });
    expect(f.calls).toHaveLength(1);
    expect(f.slept).toEqual([]);
    expect(rateLimitedUntil(sent.kind === "failed" ? sent.reason : "")).toBe(1_001_200_000);
  });

  it("any other error fails at once and names the status", async () => {
    for (const status of [403, 404, 422, 502]) {
      const f = fake("github", [{ status, body: { message: "no" } }]);
      expect(await rest(f.client, GET)).toMatchObject({
        kind: "failed",
        reason: expect.stringContaining(`HTTP ${status}`),
      });
      expect(f.calls).toHaveLength(1);
    }
  });

  it("an answer with no HTTP status fails with what the CLI said, and the update notice stays out", async () => {
    const f = fake("gitlab", [{ raw: { code: 1, stdout: "", stderr: "glab: not logged in\n" } }]);
    expect(await rest(f.client, GET)).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("no HTTP status from glab: glab: not logged in"),
    });
    const g = fake("gitlab", [
      { raw: { code: 0, stdout: 'HTTP/2.0 200 OK\r\n\r\n{"iid":1}', stderr: "[glab] Update available: 1.81.0" } },
    ]);
    expect(await rest(g.client, GET)).toEqual({ kind: "ok", value: { iid: 1 } });
  });

  it("a body that is not JSON fails, never throws", async () => {
    const f = fake("github", [{ status: 200, body: "<html>" }]);
    expect(await rest(f.client, GET)).toMatchObject({ kind: "failed", reason: expect.stringContaining("not JSON") });
  });
});

describe("graphql", () => {
  const Q = {
    query: "query($owner: String!, $first: Int!) { x }",
    variables: { owner: { kind: "text", value: "o" }, first: { kind: "int", value: 50 } },
  } as const;

  it("passes values as fields, text with -f and numbers with -F, never in the query text", async () => {
    const f = fake("github", [ok({ data: { x: 1 } })]);
    expect(await graphql(f.client, Q)).toEqual({ kind: "ok", value: { x: 1 } });
    expect(f.calls[0]!.args).toEqual([
      "api",
      "--include",
      "graphql",
      "-f",
      `query=${Q.query}`,
      "-f",
      "owner=o",
      "-F",
      "first=50",
    ]);
    expect(field(f.calls[0], "owner")).toBe("o");
  });

  it("an error in the answer fails with its message", async () => {
    const f = fake("github", [
      ok({ data: { repository: null }, errors: [{ message: "Could not resolve to a Repository" }] }),
    ]);
    expect(await graphql(f.client, Q)).toMatchObject({
      kind: "failed",
      reason: "github: GraphQL: Could not resolve to a Repository",
    });
  });

  it("a 200 with RATE_LIMITED waits and tries again (#71)", async () => {
    const f = fake("github", [
      ok({ errors: [{ type: "RATE_LIMITED", message: "API rate limit exceeded" }] }),
      ok({ data: { x: 2 } }),
    ]);
    expect(await graphql(f.client, Q)).toEqual({ kind: "ok", value: { x: 2 } });
    expect(f.slept).toEqual([60]);
  });

  // #62: "already exceeded" came back as a plain GraphQL error, and the pass failed with it as if it were any other
  it("knows a rate limit in each form: by type, by code, by message, at 200 or 403, primary or secondary (#62)", async () => {
    const reset = { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1002000" };
    for (const limit of [
      ok({ errors: [{ message: "API rate limit already exceeded for user ID 15411573." }] }),
      ok({ errors: [{ type: "RATE_LIMITED", message: "API rate limit exceeded for user ID 1." }] }),
      ok({ errors: [{ code: "graphql_rate_limit", message: "no more" }] }),
      {
        status: 200,
        body: { errors: [{ message: "API rate limit already exceeded for user ID 1." }] },
        headers: reset,
      },
      { status: 403, body: { errors: [{ type: "RATE_LIMITED", message: "API rate limit exceeded" }] } },
      { status: 403, body: { message: "You have exceeded a secondary rate limit. Please wait a few minutes." } },
      { status: 403, body: { documentation_url: "x" }, headers: { "retry-after": "30" } },
      { status: 429, body: {} },
    ] as const) {
      const f = fake("github", [limit, ok({ data: { x: 3 } })], 1);
      const sent = await graphql(f.client, Q);
      expect(sent).toMatchObject({ kind: "failed", reason: expect.stringContaining("github: rate limited until ") });
      expect(rateLimitedUntil(sent.kind === "failed" ? sent.reason : "")).not.toBe("none");
      expect(f.calls).toHaveLength(1);
    }
    expect(rateLimitedUntil("github: GraphQL: Could not resolve to a Repository")).toBe("none");
  });

  it("no retry storm: a limit with no time is tried at most 4 times, a minute apart and doubling (#62)", async () => {
    const limit = ok({ errors: [{ message: "API rate limit already exceeded for user ID 15411573." }] });
    const f = fake("github", Array(10).fill(limit));
    const sent = await graphql(f.client, Q);
    expect(f.calls).toHaveLength(4);
    expect(f.slept).toEqual([60, 120, 240]);
    expect(sent).toEqual({
      kind: "failed",
      reason:
        "github: rate limited until 1970-01-12T13:54:40Z: HTTP 200 after 4 tries on graphql: API rate limit already exceeded for user ID 15411573.",
    });
  });

  it("a primary limit whose reset is far off fails at once with the reset time (#62)", async () => {
    const f = fake("github", [
      {
        status: 200,
        body: { errors: [{ type: "RATE_LIMITED", message: "API rate limit exceeded for user ID 1." }] },
        headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1001800" },
      },
    ]);
    expect(await graphql(f.client, Q)).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("rate limited until 1970-01-12T14:16:40Z: HTTP 200 after 1 try on graphql"),
    });
    expect(f.calls).toHaveLength(1);
    expect(f.slept).toEqual([]);
  });
});

describe("readAnswer", () => {
  it("reads the status, lower-cased headers and body of a CRLF answer", () => {
    const read = readAnswer('HTTP/1.1 201 Created\r\nRetry-After: 3\r\nX-A: b: c\r\n\r\n{"a":1}');
    expect(read.kind).toBe("ok");
    if (read.kind === "ok") {
      expect(read.value.status).toBe(201);
      expect(read.value.headers.get("retry-after")).toBe("3");
      expect(read.value.headers.get("x-a")).toBe("b: c");
      expect(read.value.body).toBe('{"a":1}');
    }
  });
});

describe("processRunner (#228)", () => {
  // 3000 lines of "x": 6000 bytes, past a cap of 1000
  const LOUD = { bin: "sh", args: ["-c", "yes x | head -n 3000"], stdin: "", env: { PATH: process.env.PATH } };
  const run = processRunner({ maxBuffer: 1000, tailChars: 100 });

  it("stops a call whose output passes the cap when it keeps all of it", async () => {
    expect((await run(LOUD)).code).not.toBe(0);
  });

  it("never stops a call that keeps only the tail: the watcher hears all of it, the exit holds the end", async () => {
    const heard: string[] = [];
    const exit = await run({ ...LOUD, keep: "tail", watch: (chunk) => heard.push(chunk) });
    expect(exit.code).toBe(0);
    expect(heard.join("")).toBe("x\n".repeat(3000));
    expect(exit.stdout).toBe("x\n".repeat(50));
  });

  it("starts a call in its folder, and a stop ends the call's whole process group (#114)", async () => {
    const env = { PATH: process.env.PATH };
    const here = await run({ bin: "sh", args: ["-c", "pwd"], stdin: "", env, cwd: "/" });
    expect(here.stdout.trim()).toBe("/");
    const stop = new AbortController();
    // a child that would outlive its shell: the stop reaches it through the group
    const running = run({
      bin: "sh",
      args: ["-c", "sleep 30 & wait"],
      stdin: "",
      env,
      keep: "tail",
      stop: stop.signal,
    });
    setTimeout(() => stop.abort(), 50);
    const began = Date.now();
    expect((await running).code).not.toBe(0);
    expect(Date.now() - began).toBeLessThan(5000);
    const stoppedFirst = new AbortController();
    stoppedFirst.abort();
    const never = await run({ bin: "sh", args: ["-c", "sleep 30"], stdin: "", env, stop: stoppedFirst.signal });
    expect(never.code).not.toBe(0);
    // a stoppable call that keeps all of its output is still stopped past the cap
    expect((await run({ ...LOUD, stop: new AbortController().signal })).code).not.toBe(0);
    const quiet = await run({ bin: "sh", args: ["-c", "echo hi"], stdin: "", env, stop: new AbortController().signal });
    expect(quiet).toEqual({ code: 0, stdout: "hi\n", stderr: "" });
  });

  it("gives a tail call's exit code and stderr, and a program that cannot start fails", async () => {
    const failed = await run({ ...LOUD, args: ["-c", "echo no >&2; exit 3"], keep: "tail" });
    expect(failed).toEqual({ code: 3, stdout: "", stderr: "no\n" });
    expect((await run({ ...LOUD, bin: "/nonexistent/bin", keep: "tail" })).code).not.toBe(0);
  });
});
