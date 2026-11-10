import { describe, expect, it } from "vitest";
import { github, mergeableOf, pipeline } from "../src/core/forge/github.js";
import type { Change } from "../src/core/forge/types.js";
import type { Post } from "../src/core/post.js";
import { fake, field, ok, type Scripted } from "./fake-forge.js";

const project = { owner: "chiyanram", name: "ledger" };
const post: Post = { seat: "reviewer", title: "Act on F1", fields: [], items: [] };

const page = (hasNextPage: boolean, endCursor = "c1") => ({ hasNextPage, endCursor: hasNextPage ? endCursor : null });
const collaborators = (edges: readonly [string, string][], more = false) =>
  ok({
    data: {
      repository: {
        collaborators: {
          pageInfo: page(more),
          edges: edges.map(([login, permission]) => ({ permission, node: { login } })),
        },
      },
    },
  });
const comment = (body: string, at: string, login: string | null = "chiyanram", type = "User") => ({
  body,
  createdAt: at,
  author: login === null ? null : { login, __typename: type },
});
type PrOptions = {
  readonly rollup?: unknown;
  readonly labels?: readonly string[];
  readonly comments?: readonly unknown[];
  readonly older?: string;
  readonly mergeable?: string;
};
const pr = (number: number, o: PrOptions = {}) => ({
  number,
  isDraft: false,
  headRefOid: `${number}`.repeat(8).slice(0, 8) + "ffffffff",
  headRefName: `factory/T-${number}`,
  isCrossRepository: false,
  mergeable: o.mergeable ?? "MERGEABLE",
  labels: { pageInfo: { hasNextPage: false }, nodes: (o.labels ?? []).map((name) => ({ name })) },
  commits: { nodes: [{ commit: { statusCheckRollup: o.rollup === undefined ? null : o.rollup } }] },
  comments: {
    pageInfo: { hasPreviousPage: o.older !== undefined, startCursor: o.older ?? null },
    nodes: o.comments ?? [],
  },
});
const open = (nodes: readonly unknown[], more = false) =>
  ok({ data: { repository: { pullRequests: { pageInfo: page(more, "p1"), nodes } } } });
const merged = (numbers: readonly number[]) =>
  ok({
    data: {
      repository: {
        pullRequests: {
          pageInfo: page(false),
          nodes: numbers.map((number) => ({ number, headRefName: `factory/T-${number}`, isCrossRepository: false })),
        },
      },
    },
  });

describe("mergeable (#103)", () => {
  it("reads GitHub's MergeableState: CONFLICTING is a conflict; UNKNOWN, none or anything else is unknown", () => {
    expect(["MERGEABLE", "CONFLICTING", "UNKNOWN", null, undefined, "NEW"].map(mergeableOf)).toEqual([
      "clean",
      "conflict",
      "unknown",
      "unknown",
      "unknown",
      "unknown",
    ]);
  });

  it("asks for it with the open pull requests, and reports a conflicting one", async () => {
    const f = fake("github", [collaborators([]), open([pr(4, { mergeable: "CONFLICTING" })]), merged([])]);
    const result = await github(f.client, project).changes({ label: "agent::claimed" });
    expect(result).toMatchObject({ kind: "ok", value: { open: [{ number: 4, mergeable: "conflict" }] } });
    expect(f.calls[1]?.args.join(" ")).toContain("mergeable");
  });
});

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
      collaborators([
        ["chiyanram", "ADMIN"],
        ["dev2", "WRITE"],
        ["ann", "TRIAGE"],
      ]),
      open([
        pr(4, {
          rollup: { state: "PENDING" },
          labels: ["agent::claimed"],
          comments: [comment("[writer] OPEN: which port?", "2026-11-02T12:00:00Z")],
        }),
      ]),
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
            fork: false,
            head: "44444444ffffffff",
            draft: false,
            labels: ["agent::claimed"],
            pipeline: { kind: "running" },
            mergeable: "clean",
            comments: [
              { body: "[writer] OPEN: which port?", author: { name: "chiyanram" }, at: "2026-11-02T12:00:00Z" },
            ],
          },
        ],
        merged: [{ number: 9, branch: "factory/T-9", fork: false }],
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
    const older = {
      data: {
        repository: {
          pullRequest: {
            comments: {
              pageInfo: { hasPreviousPage: false, startCursor: "s0" },
              nodes: [comment("[writer] OPEN: x", "2026-11-01T10:00:00Z")],
            },
          },
        },
      },
    };
    const f = fake("github", [
      collaborators([]),
      open([pr(3, { comments: newest, older: "s1" })]),
      ok(older),
      merged([]),
    ]);
    const result = await github(f.client, project).changes({ label: "agent::claimed" });
    expect(result.kind === "ok" ? result.value.open[0]!.comments.map((c) => c.body) : []).toEqual([
      "[writer] OPEN: x",
      "thanks",
    ]);
    expect(field(f.calls[2], "before")).toBe("s1");
    expect(field(f.calls[2], "number")).toBe("3");
  });

  it("an App's comment carries its [bot] login, as REST and app-token name it", async () => {
    const f = fake("github", [
      collaborators([]),
      open([pr(5, { comments: [comment("[writer] OPEN: x", "2026-11-01T00:00:00Z", "ledger-factory", "Bot")] })]),
      merged([]),
    ]);
    const result = await github(f.client, project).changes({ label: "l" });
    expect(result.kind === "ok" ? result.value.open[0]!.comments[0]!.author : {}).toEqual({
      name: "ledger-factory[bot]",
    });
    expect(f.calls[1]!.args.join(" ")).toContain("author { login __typename }");
  });

  it("a deleted author is a person with no name", async () => {
    const f = fake("github", [
      collaborators([]),
      open([pr(5, { comments: [comment("hi", "2026-11-01T00:00:00Z", null)] })]),
      merged([]),
    ]);
    const result = await github(f.client, project).changes({ label: "l" });
    expect(result.kind === "ok" ? result.value.open[0]!.comments[0]!.author : {}).toEqual({ name: "" });
  });

  it("fails on a GraphQL error, on a missing repository, and on an answer that is not the expected shape", async () => {
    const error = fake("github", [
      ok({ data: { repository: null }, errors: [{ message: "Could not resolve to a Repository" }] }),
    ]);
    expect(await github(error.client, project).changes({ label: "l" })).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("Could not resolve"),
    });
    const missing = fake("github", [ok({ data: { repository: null } })]);
    expect(await github(missing.client, project).changes({ label: "l" })).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("no repository chiyanram/ledger"),
    });
    const odd = fake("github", [collaborators([]), open([{ ...pr(6), headRefOid: 7 }])]);
    expect(await github(odd.client, project).changes({ label: "l" })).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("headRefOid"),
    });
  });

  it("a failed later page fails the whole list, never reads as the end", async () => {
    const f = fake("github", [
      collaborators([]),
      open([pr(1)], true),
      { status: 502, body: { message: "Bad Gateway" } },
    ]);
    expect(await github(f.client, project).changes({ label: "l" })).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("HTTP 502"),
    });
  });
});

const PR = {
  merged: false,
  state: "open",
  head: { sha: "abc123", ref: "feat/x" },
  base: { ref: "main" },
  labels: [{ name: "agent::claimed" }],
  body: null,
};

describe("single calls", () => {
  it("change maps merged, open and closed, and a null body to empty", async () => {
    const f = fake("github", [ok(PR), ok({ ...PR, merged: true, state: "closed" }), ok({ ...PR, state: "closed" })]);
    const forge = github(f.client, project);
    expect(await forge.change({ number: 12 })).toEqual({
      kind: "ok",
      value: {
        number: 12,
        state: "opened",
        sha: "abc123",
        sourceBranch: "feat/x",
        targetBranch: "main",
        labels: ["agent::claimed"],
        description: "",
        anchor: { kind: "github", head: "abc123" },
      },
    });
    expect(await forge.change({ number: 12 })).toMatchObject({ value: { state: "merged" } });
    expect(await forge.change({ number: 12 })).toMatchObject({ value: { state: "closed" } });
  });

  it("addLabel fails when GitHub did not keep the label (#71)", async () => {
    const f = fake("github", [ok([{ name: "other" }])]);
    expect(await github(f.client, project).addLabel({ number: 12, label: "agent::claimed" })).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("did not keep"),
    });
    const g = fake("github", [ok([{ name: "agent::claimed" }])]);
    expect(await github(g.client, project).addLabel({ number: 12, label: "agent::claimed" })).toEqual({ kind: "ok" });
    expect(JSON.parse(g.calls[0]!.stdin)).toEqual({ labels: ["agent::claimed"] });
  });

  it("removeLabel: a 404 with the label already gone is a release; with it still there, a failure", async () => {
    const gone = fake("github", [{ status: 404, body: {} }, ok({ ...PR, labels: [] })]);
    expect(await github(gone.client, project).removeLabel({ number: 12, label: "agent::claimed" })).toEqual({
      kind: "ok",
    });
    expect(gone.calls[0]!.args[2]).toBe("repos/chiyanram/ledger/issues/12/labels/agent%3A%3Aclaimed");
    const stuck = fake("github", [{ status: 404, body: {} }, ok(PR)]);
    expect(await github(stuck.client, project).removeLabel({ number: 12, label: "agent::claimed" })).toMatchObject({
      kind: "failed",
    });
  });

  it("notes reads every page, past 100 comments (#71)", async () => {
    const hundred = Array.from({ length: 100 }, (_, i) => ({
      body: `n${i}`,
      user: { login: "a" },
      created_at: "2026-11-01T00:00:00Z",
    }));
    const f = fake("github", [ok(hundred), ok([{ body: "last", user: null, created_at: "2026-11-02T00:00:00Z" }])]);
    const notes = await github(f.client, project).notes({ number: 12 });
    expect(notes.kind === "ok" ? notes.value.length : 0).toBe(101);
    expect(notes.kind === "ok" ? notes.value[100] : {}).toEqual({
      body: "last",
      author: { name: "" },
      at: "2026-11-02T00:00:00Z",
    });
    expect(f.calls[1]!.args[2]).toContain("page=2");
  });

  it("note posts only through the template", async () => {
    const f = fake("github", [ok({ id: 1 })]);
    await github(f.client, project).note({
      number: 12,
      post: { seat: "coordinator", title: "OPEN: @all /merge", fields: [], items: [] },
    });
    expect(JSON.parse(f.calls[0]!.stdin).body).toBe("[coordinator] OPEN: @⁠all /merge");
  });

  it("lineFinding anchors at the head; when GitHub refuses the line, a plain comment names file:line after the seat prefix", async () => {
    const change: Change = {
      number: 12,
      state: "opened",
      sha: "abc123",
      sourceBranch: "x",
      targetBranch: "main",
      labels: [],
      description: "",
      anchor: { kind: "github", head: "abc123" },
    };
    const anchored = fake("github", [{ status: 201, body: { id: 1 } }]);
    expect(
      await github(anchored.client, project).lineFinding({ change, at: { file: "src/A.java", line: 40 }, post }),
    ).toEqual({ kind: "ok" });
    expect(JSON.parse(anchored.calls[0]!.stdin)).toEqual({
      body: "[reviewer] Act on F1",
      commit_id: "abc123",
      path: "src/A.java",
      line: 40,
      side: "RIGHT",
    });

    const refused: Scripted[] = [
      { status: 422, body: { message: "Validation Failed" } },
      { status: 201, body: { id: 2 } },
    ];
    const f = fake("github", refused);
    expect(
      await github(f.client, project).lineFinding({ change, at: { file: "src/A.java", line: 400 }, post }),
    ).toEqual({ kind: "ok" });
    expect(f.calls[1]!.args[2]).toBe("repos/chiyanram/ledger/issues/12/comments");
    expect(JSON.parse(f.calls[1]!.stdin).body).toBe("[reviewer] Act on F1\n\n- at: src/A.java:400");
  });

  it("me names the App hint when gh has no user", async () => {
    const f = fake("github", [{ status: 403, body: { message: "Resource not accessible by integration" } }]);
    expect(await github(f.client, project).me()).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("FACTORY_IDENTITY=app"),
    });
    const g = fake("github", [ok({ login: "chiyanram" })]);
    expect(await github(g.client, project).me()).toEqual({ kind: "ok", value: "chiyanram" });
  });

  it("claimed lists the numbers in that state", async () => {
    const f = fake("github", [merged([3, 7])]);
    expect(await github(f.client, project).claimed({ state: "opened", label: "agent::claimed" })).toEqual({
      kind: "ok",
      value: [3, 7],
    });
    expect(f.calls[0]!.args.join(" ")).toContain("states: [OPEN]");
  });

  it("status posts a commit status at the head, in GitHub's words, cut to 140 characters", async () => {
    const f = fake("github", [ok({})]);
    const sent = { sha: "a".repeat(40), ref: "factory/PROJ-1", context: "agent-factory/verify" } as const;
    expect(await github(f.client, project).status({ ...sent, state: "failed", description: "x".repeat(200) })).toEqual({
      kind: "ok",
    });
    expect(f.calls[0]?.args[2]).toBe(`repos/chiyanram/ledger/statuses/${"a".repeat(40)}`);
    expect(JSON.parse(f.calls[0]?.stdin ?? "")).toEqual({
      state: "failure",
      context: "agent-factory/verify",
      description: "x".repeat(140),
    });
  });
});

describe("openChange (#164)", () => {
  const request = {
    branch: "factory/T-7",
    base: "main",
    title: "Add the ledger row @all closes #1",
    body: { seat: "coordinator", title: "T-7", fields: [{ label: "ticket", value: "T-7" }], items: [] },
  } as const;

  it("opens a draft pull request from the branch when none is open, with cleaned words", async () => {
    const f = fake("github", [ok([]), { status: 201, body: { number: 42 } }]);
    expect(await github(f.client, project).openChange(request)).toEqual({ kind: "ok", value: 42 });
    expect(f.calls[0]?.args[2]).toBe(
      "repos/chiyanram/ledger/pulls?state=open&head=chiyanram%3Afactory%2FT-7&per_page=100",
    );
    const sent = JSON.parse(f.calls[1]?.stdin ?? "");
    expect(sent).toEqual({
      title: "Add the ledger row @⁠all closes #⁠1",
      body: "[coordinator] T-7\n\n- ticket: T-7",
      head: "factory/T-7",
      base: "main",
      draft: true,
    });
  });

  it("reuses the one pull request already open from the branch, and opens no second", async () => {
    const f = fake("github", [ok([{ number: 9 }])]);
    expect(await github(f.client, project).openChange(request)).toEqual({ kind: "ok", value: 9 });
    expect(f.calls).toHaveLength(1);
  });

  it("leaves two open pull requests to a person", async () => {
    const f = fake("github", [ok([{ number: 9 }, { number: 11 }])]);
    expect(await github(f.client, project).openChange(request)).toEqual({
      kind: "failed",
      reason: "2 changes are open from factory/T-7: #9, #11; a person decides",
    });
  });

  it("refuses a branch that is not plain before any call", async () => {
    const f = fake("github", []);
    expect((await github(f.client, project).openChange({ ...request, branch: "x&head=y:z" })).kind).toBe("failed");
    expect(f.calls).toEqual([]);
  });

  it("fails with GitHub's reason when it refuses the pull request", async () => {
    const f = fake("github", [ok([]), { status: 422, body: { message: "No commits between main and factory/T-7" } }]);
    const opened = await github(f.client, project).openChange(request);
    expect(opened).toEqual({ kind: "failed", reason: expect.stringContaining("No commits between") });
  });
});

describe("failedJobs (#171)", () => {
  const H = "aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111";
  const run = (id: number, name: string, conclusion: string, slug = "github-actions") => ({
    id,
    name,
    conclusion,
    app: { slug },
  });

  it("reads the head's failed check runs, an Actions job's log end, and a failed commit status by its description", async () => {
    const f = fake("github", [
      ok({
        check_runs: [run(11, "test", "failure"), run(12, "lint", "success"), run(13, "sonar", "failure", "sonarcloud")],
      }),
      ok({ statuses: [{ context: "agent-factory/verify", state: "failure", description: "make verify failed" }] }),
      { status: 200, body: "2026-11-08T05:21:14Z ##[error]Process completed with exit code 2.\n" },
    ]);
    const out = await github(f.client, project).failedJobs({ number: 4, head: H });
    expect(out).toEqual({
      kind: "ok",
      value: [
        {
          name: "test",
          log: { kind: "tail", text: "2026-11-08T05:21:14Z ##[error]Process completed with exit code 2." },
        },
        { name: "sonar", log: { kind: "none", why: "not a GitHub Actions job: its log is on its own site" } },
        {
          name: "agent-factory/verify",
          log: { kind: "none", why: "a commit status, with no log: make verify failed" },
        },
      ],
    });
    expect(f.calls.map((c) => c.args[2])).toEqual([
      `repos/${project.owner}/${project.name}/commits/${H}/check-runs?filter=latest&per_page=100`,
      `repos/${project.owner}/${project.name}/commits/${H}/status?per_page=100`,
      `repos/${project.owner}/${project.name}/actions/jobs/11/logs`,
    ]);
  });

  it("fails with the reason when the check runs cannot be read", async () => {
    const f = fake("github", [{ status: 404, body: { message: "Not Found" } }]);
    expect(await github(f.client, project).failedJobs({ number: 4, head: H })).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("HTTP 404"),
    });
  });
});

describe("branchExists (#227)", () => {
  it("finds the exact branch among the refs that start with its name, and refuses a name that is not plain", async () => {
    const refs = ok([{ ref: "refs/heads/factory/T-10" }, { ref: "refs/heads/factory/T-1" }]);
    const f = fake("github", [refs, ok([{ ref: "refs/heads/factory/T-10" }])]);
    const forge = github(f.client, project);
    expect(await forge.branchExists({ branch: "factory/T-1" })).toEqual({ kind: "ok", value: true });
    expect(f.calls[0]?.args.join(" ")).toContain("repos/chiyanram/ledger/git/matching-refs/heads/factory/T-1");
    expect(await forge.branchExists({ branch: "factory/T-1" })).toEqual({ kind: "ok", value: false });
    expect(await forge.branchExists({ branch: "../x" })).toMatchObject({ kind: "failed" });
    expect(f.calls).toHaveLength(2);
  });
});

describe("issueBody (#381)", () => {
  it("reads an issue's body, none as empty, and refuses a pull request's number", async () => {
    const f = fake("github", [
      ok({ number: 4, body: "# 4: a title\r\n" }),
      ok({ number: 5, body: null }),
      ok({ number: 6, body: "x", pull_request: { url: "u" } }),
      { status: 404, body: { message: "Not Found" } },
    ]);
    const forge = github(f.client, project);
    expect(await forge.issueBody({ number: 4 })).toEqual({ kind: "ok", value: "# 4: a title\r\n" });
    expect(f.calls[0]?.args.join(" ")).toContain("repos/chiyanram/ledger/issues/4");
    expect(await forge.issueBody({ number: 5 })).toEqual({ kind: "ok", value: "" });
    expect(await forge.issueBody({ number: 6 })).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("pull request"),
    });
    expect(await forge.issueBody({ number: 7 })).toMatchObject({ kind: "failed" });
  });
});
