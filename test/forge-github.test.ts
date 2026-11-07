import { describe, expect, it } from "vitest";
import { github, pipeline } from "../src/core/forge/github.js";
import type { Change } from "../src/core/forge/types.js";
import type { Post } from "../src/core/post.js";
import { fake, field, ok, type Scripted } from "./fake-forge.js";

const project = { owner: "chiyanram", name: "ledger" };
const post: Post = { seat: "reviewer", title: "Act on F1", fields: [], items: [] };

const page = (hasNextPage: boolean, endCursor = "c1") => ({ hasNextPage, endCursor: hasNextPage ? endCursor : null });
const collaborators = (edges: readonly [string, string][], more = false) =>
  ok({ data: { repository: { collaborators: { pageInfo: page(more), edges: edges.map(([login, permission]) => ({ permission, node: { login } })) } } } });
const comment = (body: string, at: string, login: string | null = "chiyanram", type = "User") => ({ body, createdAt: at, author: login === null ? null : { login, __typename: type } });
type PrOptions = { readonly rollup?: unknown; readonly labels?: readonly string[]; readonly comments?: readonly unknown[]; readonly older?: string };
const pr = (number: number, o: PrOptions = {}) => ({
  number,
  isDraft: false,
  headRefOid: `${number}`.repeat(8).slice(0, 8) + "ffffffff",
  headRefName: `factory/T-${number}`,
  labels: { pageInfo: { hasNextPage: false }, nodes: (o.labels ?? []).map((name) => ({ name })) },
  commits: { nodes: [{ commit: { statusCheckRollup: o.rollup === undefined ? null : o.rollup } }] },
  comments: { pageInfo: { hasPreviousPage: o.older !== undefined, startCursor: o.older ?? null }, nodes: o.comments ?? [] },
});
const open = (nodes: readonly unknown[], more = false) => ok({ data: { repository: { pullRequests: { pageInfo: page(more, "p1"), nodes } } } });
const merged = (numbers: readonly number[]) => ok({ data: { repository: { pullRequests: { pageInfo: page(false), nodes: numbers.map((number) => ({ number, headRefName: `factory/T-${number}` })) } } } });

describe("pipeline (#124)", () => {
  it("maps every check rollup state, and no checks at all is none", () => {
    expect(pipeline({ kind: "state", state: "SUCCESS" })).toEqual({ kind: "success" });
    expect(pipeline({ kind: "state", state: "FAILURE" })).toEqual({ kind: "failed" });
    expect(pipeline({ kind: "state", state: "ERROR" })).toEqual({ kind: "failed" });
    expect(pipeline({ kind: "state", state: "PENDING" })).toEqual({ kind: "running" });
    expect(pipeline({ kind: "state", state: "EXPECTED" })).toEqual({ kind: "running" });
    expect(pipeline({ kind: "none" })).toEqual({ kind: "none" });
  });

  it("an unknown state is unknown and keeps what GitHub said, never none", () => {
    expect(pipeline({ kind: "state", state: "STALE" })).toEqual({ kind: "unknown", raw: "STALE" });
  });
});

describe("changes", () => {
  it("reads team, open pull requests and merged claims, with levels in the seam's words", async () => {
    const f = fake("github", [
      collaborators([["chiyanram", "ADMIN"], ["dev2", "WRITE"], ["ann", "TRIAGE"]]),
      open([pr(4, { rollup: { state: "PENDING" }, labels: ["agent::claimed"], comments: [comment("[writer] OPEN: which port?", "2026-11-02T12:00:00Z")] })]),
      merged([9]),
    ]);
    const result = await github(f.client, project).changes({ label: "agent::claimed" });
    expect(result).toEqual({
      kind: "ok",
      value: {
        team: [
          { name: "chiyanram", level: "maintainer", bot: false },
          { name: "dev2", level: "maintainer", bot: false },
          { name: "ann", level: "guest", bot: false },
        ],
        open: [
          {
            number: 4,
            branch: "factory/T-4",
            head: "44444444ffffffff",
            draft: false,
            labels: ["agent::claimed"],
            pipeline: { kind: "running" },
            comments: [{ body: "[writer] OPEN: which port?", author: { name: "chiyanram" }, at: "2026-11-02T12:00:00Z" }],
          },
        ],
        merged: [{ number: 9, branch: "factory/T-9" }],
      },
    });
    expect(field(f.calls[2], "label")).toBe("agent::claimed");
    expect(f.calls[2]!.args.join(" ")).toContain("states: [MERGED]");
    for (const call of f.calls) {
      expect(field(call, "owner")).toBe("chiyanram");
      expect(field(call, "name")).toBe("ledger");
    }
  });

  it("pages past 50 open pull requests and past 100 collaborators, so none drops out (#71)", async () => {
    const f = fake("github", [
      collaborators([["chiyanram", "ADMIN"]], true),
      collaborators([["late", "WRITE"]]),
      open([pr(1)], true),
      open([pr(2)]),
      merged([]),
    ]);
    const result = await github(f.client, project).changes({ label: "agent::claimed" });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.value.team.map((p) => p.name)).toEqual(["chiyanram", "late"]);
      expect(result.value.open.map((c) => c.number)).toEqual([1, 2]);
    }
    expect(field(f.calls[0], "after")).toBe("");
    expect(field(f.calls[1], "after")).toBe("c1");
    expect(field(f.calls[3], "after")).toBe("p1");
  });

  it("reads the comments before the newest 100, oldest first, so an old ask still counts (#71)", async () => {
    const newest = [comment("thanks", "2026-11-03T10:00:00Z")];
    const older = { data: { repository: { pullRequest: { comments: { pageInfo: { hasPreviousPage: false, startCursor: "s0" }, nodes: [comment("[writer] OPEN: x", "2026-11-01T10:00:00Z")] } } } } };
    const f = fake("github", [collaborators([]), open([pr(3, { comments: newest, older: "s1" })]), ok(older), merged([])]);
    const result = await github(f.client, project).changes({ label: "agent::claimed" });
    expect(result.kind === "ok" ? result.value.open[0]!.comments.map((c) => c.body) : []).toEqual(["[writer] OPEN: x", "thanks"]);
    expect(field(f.calls[2], "before")).toBe("s1");
    expect(field(f.calls[2], "number")).toBe("3");
  });

  it("an App's comment carries its [bot] login, as REST and app-token name it", async () => {
    const f = fake("github", [collaborators([]), open([pr(5, { comments: [comment("[writer] OPEN: x", "2026-11-01T00:00:00Z", "ledger-factory", "Bot")] })]), merged([])]);
    const result = await github(f.client, project).changes({ label: "l" });
    expect(result.kind === "ok" ? result.value.open[0]!.comments[0]!.author : {}).toEqual({ name: "ledger-factory[bot]" });
    expect(f.calls[1]!.args.join(" ")).toContain("author { login __typename }");
  });

  it("a deleted author is a person with no name", async () => {
    const f = fake("github", [collaborators([]), open([pr(5, { comments: [comment("hi", "2026-11-01T00:00:00Z", null)] })]), merged([])]);
    const result = await github(f.client, project).changes({ label: "l" });
    expect(result.kind === "ok" ? result.value.open[0]!.comments[0]!.author : {}).toEqual({ name: "" });
  });

  it("fails on a GraphQL error, on a missing repository, and on an answer that is not the expected shape", async () => {
    const error = fake("github", [ok({ data: { repository: null }, errors: [{ message: "Could not resolve to a Repository" }] })]);
    expect(await github(error.client, project).changes({ label: "l" })).toMatchObject({ kind: "failed", reason: expect.stringContaining("Could not resolve") });
    const missing = fake("github", [ok({ data: { repository: null } })]);
    expect(await github(missing.client, project).changes({ label: "l" })).toMatchObject({ kind: "failed", reason: expect.stringContaining("no repository chiyanram/ledger") });
    const odd = fake("github", [collaborators([]), open([{ ...pr(6), headRefOid: 7 }])]);
    expect(await github(odd.client, project).changes({ label: "l" })).toMatchObject({ kind: "failed", reason: expect.stringContaining("headRefOid") });
  });

  it("a failed later page fails the whole list, never reads as the end", async () => {
    const f = fake("github", [collaborators([]), open([pr(1)], true), { status: 502, body: { message: "Bad Gateway" } }]);
    expect(await github(f.client, project).changes({ label: "l" })).toMatchObject({ kind: "failed", reason: expect.stringContaining("HTTP 502") });
  });
});

const PR = { merged: false, state: "open", head: { sha: "abc123", ref: "feat/x" }, base: { ref: "main" }, labels: [{ name: "agent::claimed" }], body: null };

describe("single calls", () => {
  it("change maps merged, open and closed, and a null body to empty", async () => {
    const f = fake("github", [ok(PR), ok({ ...PR, merged: true, state: "closed" }), ok({ ...PR, state: "closed" })]);
    const forge = github(f.client, project);
    expect(await forge.change({ number: 12 })).toEqual({
      kind: "ok",
      value: { number: 12, state: "opened", sha: "abc123", sourceBranch: "feat/x", targetBranch: "main", labels: ["agent::claimed"], description: "", anchor: { kind: "github", head: "abc123" } },
    });
    expect(await forge.change({ number: 12 })).toMatchObject({ value: { state: "merged" } });
    expect(await forge.change({ number: 12 })).toMatchObject({ value: { state: "closed" } });
  });

  it("addLabel fails when GitHub did not keep the label (#71)", async () => {
    const f = fake("github", [ok([{ name: "other" }])]);
    expect(await github(f.client, project).addLabel({ number: 12, label: "agent::claimed" })).toMatchObject({ kind: "failed", reason: expect.stringContaining("did not keep") });
    const g = fake("github", [ok([{ name: "agent::claimed" }])]);
    expect(await github(g.client, project).addLabel({ number: 12, label: "agent::claimed" })).toEqual({ kind: "ok" });
    expect(JSON.parse(g.calls[0]!.stdin)).toEqual({ labels: ["agent::claimed"] });
  });

  it("removeLabel: a 404 with the label already gone is a release; with it still there, a failure", async () => {
    const gone = fake("github", [{ status: 404, body: {} }, ok({ ...PR, labels: [] })]);
    expect(await github(gone.client, project).removeLabel({ number: 12, label: "agent::claimed" })).toEqual({ kind: "ok" });
    expect(gone.calls[0]!.args[2]).toBe("repos/chiyanram/ledger/issues/12/labels/agent%3A%3Aclaimed");
    const stuck = fake("github", [{ status: 404, body: {} }, ok(PR)]);
    expect(await github(stuck.client, project).removeLabel({ number: 12, label: "agent::claimed" })).toMatchObject({ kind: "failed" });
  });

  it("notes reads every page, past 100 comments (#71)", async () => {
    const hundred = Array.from({ length: 100 }, (_, i) => ({ body: `n${i}`, user: { login: "a" }, created_at: "2026-11-01T00:00:00Z" }));
    const f = fake("github", [ok(hundred), ok([{ body: "last", user: null, created_at: "2026-11-02T00:00:00Z" }])]);
    const notes = await github(f.client, project).notes({ number: 12 });
    expect(notes.kind === "ok" ? notes.value.length : 0).toBe(101);
    expect(notes.kind === "ok" ? notes.value[100] : {}).toEqual({ body: "last", author: { name: "" }, at: "2026-11-02T00:00:00Z" });
    expect(f.calls[1]!.args[2]).toContain("page=2");
  });

  it("note posts only through the template", async () => {
    const f = fake("github", [ok({ id: 1 })]);
    await github(f.client, project).note({ number: 12, post: { seat: "coordinator", title: "OPEN: @all /merge", fields: [], items: [] } });
    expect(JSON.parse(f.calls[0]!.stdin).body).toBe("[coordinator] OPEN: @⁠all /merge");
  });

  it("lineFinding anchors at the head; when GitHub refuses the line, a plain comment names file:line after the seat prefix", async () => {
    const change: Change = { number: 12, state: "opened", sha: "abc123", sourceBranch: "x", targetBranch: "main", labels: [], description: "", anchor: { kind: "github", head: "abc123" } };
    const anchored = fake("github", [{ status: 201, body: { id: 1 } }]);
    expect(await github(anchored.client, project).lineFinding({ change, at: { file: "src/A.java", line: 40 }, post })).toEqual({ kind: "ok" });
    expect(JSON.parse(anchored.calls[0]!.stdin)).toEqual({ body: "[reviewer] Act on F1", commit_id: "abc123", path: "src/A.java", line: 40, side: "RIGHT" });

    const refused: Scripted[] = [{ status: 422, body: { message: "Validation Failed" } }, { status: 201, body: { id: 2 } }];
    const f = fake("github", refused);
    expect(await github(f.client, project).lineFinding({ change, at: { file: "src/A.java", line: 400 }, post })).toEqual({ kind: "ok" });
    expect(f.calls[1]!.args[2]).toBe("repos/chiyanram/ledger/issues/12/comments");
    expect(JSON.parse(f.calls[1]!.stdin).body).toBe("[reviewer] Act on F1\n\n- at: src/A.java:400");
  });

  it("me names the App hint when gh has no user", async () => {
    const f = fake("github", [{ status: 403, body: { message: "Resource not accessible by integration" } }]);
    expect(await github(f.client, project).me()).toMatchObject({ kind: "failed", reason: expect.stringContaining("FACTORY_IDENTITY=app") });
    const g = fake("github", [ok({ login: "chiyanram" })]);
    expect(await github(g.client, project).me()).toEqual({ kind: "ok", value: "chiyanram" });
  });

  it("claimed lists the numbers in that state", async () => {
    const f = fake("github", [merged([3, 7])]);
    expect(await github(f.client, project).claimed({ state: "opened", label: "agent::claimed" })).toEqual({ kind: "ok", value: [3, 7] });
    expect(f.calls[0]!.args.join(" ")).toContain("states: [OPEN]");
  });
});
