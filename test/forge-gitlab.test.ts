import { describe, expect, it } from "vitest";
import { gitlab, mergeableOf, pipeline } from "../src/core/forge/gitlab.js";
import type { Change } from "../src/core/forge/types.js";
import type { Post } from "../src/core/post.js";
import { fake, field, ok } from "./fake-forge.js";

const project = "aruvii/agent-platform";
const base = "projects/aruvii%2Fagent-platform";
const post: Post = { seat: "reviewer", title: "Act on F1", fields: [], items: [] };

const page = (hasNextPage: boolean, endCursor = "c1") => ({ hasNextPage, endCursor: hasNextPage ? endCursor : null });
const members = (nodes: readonly [string | null, number, boolean?][], more = false) =>
  ok({
    data: {
      project: {
        projectMembers: {
          pageInfo: page(more),
          nodes: nodes.map(([u, a, bot]) => ({
            user: u === null ? null : { username: u, bot: bot === true },
            accessLevel: { integerValue: a },
          })),
        },
      },
    },
  });
const note = (body: string, at: string, username = "ram") => ({ body, createdAt: at, author: { username } });
type MrOptions = {
  readonly pipeline?: unknown;
  readonly labels?: readonly string[];
  readonly notes?: readonly unknown[];
  readonly older?: string;
  readonly conflicts?: boolean;
  readonly mergeStatus?: string;
};
const mr = (iid: number, o: MrOptions = {}) => ({
  iid: String(iid),
  draft: true,
  diffHeadSha: "aaaa1111aaaa1111",
  sourceBranch: `factory/T-${iid}`,
  sourceProjectId: 1,
  targetProjectId: 1,
  conflicts: o.conflicts ?? false,
  mergeStatusEnum: o.mergeStatus ?? "CAN_BE_MERGED",
  labels: { pageInfo: { hasNextPage: false }, nodes: (o.labels ?? []).map((title) => ({ title })) },
  headPipeline: o.pipeline === undefined ? null : o.pipeline,
  notes: { pageInfo: { hasPreviousPage: o.older !== undefined, startCursor: o.older ?? null }, nodes: o.notes ?? [] },
});
const open = (nodes: readonly unknown[], more = false) =>
  ok({ data: { project: { mergeRequests: { pageInfo: page(more, "m1"), nodes } } } });

describe("mergeable (#103)", () => {
  it("reads conflicts first; CAN_BE_MERGED is clean; a status GitLab has not checked yet is unknown", () => {
    expect(mergeableOf(true, "CAN_BE_MERGED")).toBe("conflict");
    expect(mergeableOf(true, "UNCHECKED")).toBe("conflict");
    expect(mergeableOf(false, "CAN_BE_MERGED")).toBe("clean");
    for (const status of ["UNCHECKED", "CHECKING", "CANNOT_BE_MERGED_RECHECK", null, undefined]) {
      expect(mergeableOf(false, status)).toBe("unknown");
    }
  });

  it("asks for it with the open merge requests", async () => {
    const f = fake("gitlab", [
      members([]),
      open([mr(4, { conflicts: true, mergeStatus: "CANNOT_BE_MERGED" })]),
      ok([]),
    ]);
    const result = await gitlab(f.client, project).changes({ label: "agent::claimed" });
    expect(result).toMatchObject({ kind: "ok", value: { open: [{ number: 4, mergeable: "conflict" }] } });
    expect(f.calls[1]?.args.join(" ")).toContain("conflicts mergeStatusEnum");
  });
});

describe("pipeline (#124)", () => {
  it("maps every GitLab status, in any case", () => {
    const at = (status: string) => pipeline({ kind: "pipeline", status }).kind;
    for (const s of [
      "CREATED",
      "WAITING_FOR_RESOURCE",
      "PREPARING",
      "WAITING_FOR_CALLBACK",
      "PENDING",
      "RUNNING",
      "SCHEDULED",
    ]) {
      expect(at(s)).toBe("running");
    }
    expect(at("success")).toBe("success");
    expect(at("FAILED")).toBe("failed");
    expect(at("CANCELED")).toBe("canceled");
    expect(at("CANCELING")).toBe("canceled");
    expect(at("SKIPPED")).toBe("skipped");
    expect(at("MANUAL")).toBe("manual");
  });

  it("no pipeline is none; an unknown status is unknown, never none", () => {
    expect(pipeline({ kind: "none" })).toEqual({ kind: "none" });
    expect(pipeline({ kind: "pipeline", status: "WAITING" })).toEqual({ kind: "unknown", raw: "WAITING" });
  });
});

describe("changes", () => {
  it("reads members by access level, open merge requests and merged claims", async () => {
    const f = fake("gitlab", [
      members([
        ["ann", 50],
        ["dev", 30],
        ["rep", 20],
        [null, 40],
        ["project_1_bot", 40, true],
      ]),
      open([
        mr(4, {
          pipeline: { status: "RUNNING" },
          labels: ["agent::claimed"],
          notes: [note("[writer] OPEN: which port?", "2026-11-02T12:00:00Z")],
        }),
      ]),
      ok([{ iid: 9, source_branch: "factory/T-9", source_project_id: 1, target_project_id: 1 }]),
    ]);
    const result = await gitlab(f.client, project).changes({ label: "agent::claimed" });
    expect(result).toEqual({
      kind: "ok",
      value: {
        team: [
          { name: "ann", level: "maintainer", bot: false },
          { name: "dev", level: "developer", bot: false },
          { name: "rep", level: "guest", bot: false },
          { name: "project_1_bot", level: "maintainer", bot: true },
        ],
        open: [
          {
            number: 4,
            branch: "factory/T-4",
            fork: false,
            head: "aaaa1111aaaa1111",
            draft: true,
            labels: ["agent::claimed"],
            pipeline: { kind: "running" },
            mergeable: "clean",
            comments: [{ body: "[writer] OPEN: which port?", author: { name: "ram" }, at: "2026-11-02T12:00:00Z" }],
          },
        ],
        merged: [{ number: 9, branch: "factory/T-9", fork: false }],
      },
    });
    expect(field(f.calls[0], "project")).toBe(project);
    expect(f.calls[0]!.args.join(" ")).toContain(
      "relations: [DIRECT, INHERITED, INVITED_GROUPS, SHARED_INTO_ANCESTORS]",
    );
    expect(f.calls[1]!.args.join(" ")).toContain("filter: ONLY_COMMENTS");
    expect(f.calls[2]!.args[2]).toBe(
      `${base}/merge_requests?state=merged&labels=agent%3A%3Aclaimed&per_page=100&page=1`,
    );
  });

  it("pages members and merge requests to the end, and reads notes before the newest 100", async () => {
    const older = {
      data: {
        project: {
          mergeRequest: {
            notes: {
              pageInfo: { hasPreviousPage: false, startCursor: "s0" },
              nodes: [note("[coordinator] OPEN: ok?", "2026-11-01T00:00:00Z")],
            },
          },
        },
      },
    };
    const f = fake("gitlab", [
      members([["ann", 40]], true),
      members([["late", 30]]),
      open([mr(1)], true),
      open([mr(2, { notes: [note("hi", "2026-11-02T00:00:00Z")], older: "s1" })]),
      ok(older),
      ok([]),
    ]);
    const result = await gitlab(f.client, project).changes({ label: "agent::claimed" });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.value.team.map((p) => p.name)).toEqual(["ann", "late"]);
      expect(result.value.open.map((c) => c.number)).toEqual([1, 2]);
      expect(result.value.open[1]!.comments.map((c) => c.body)).toEqual(["[coordinator] OPEN: ok?", "hi"]);
    }
    expect(field(f.calls[1], "after")).toBe("c1");
    expect(field(f.calls[3], "after")).toBe("m1");
    expect(field(f.calls[4], "iid")).toBe("2");
    expect(field(f.calls[4], "before")).toBe("s1");
  });

  it("fails on a missing project and on a GraphQL error", async () => {
    const missing = fake("gitlab", [ok({ data: { project: null } })]);
    expect(await gitlab(missing.client, project).changes({ label: "l" })).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("no project aruvii/agent-platform"),
    });
    const error = fake("gitlab", [ok({ errors: [{ message: "Field must have selections" }] })]);
    expect(await gitlab(error.client, project).changes({ label: "l" })).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("GraphQL: Field must have selections"),
    });
  });
});

const MR = {
  state: "opened",
  sha: "h1",
  source_branch: "feat/x",
  target_branch: "main",
  labels: ["agent::claimed"],
  description: null,
  diff_refs: { base_sha: "b", start_sha: "s", head_sha: "h1" },
};

describe("single calls", () => {
  it("change maps its fields; locked reads as opened; an unknown state fails", async () => {
    const f = fake("gitlab", [ok(MR), ok({ ...MR, state: "locked" }), ok({ ...MR, state: "archived" })]);
    const forge = gitlab(f.client, project);
    expect(await forge.change({ number: 12 })).toEqual({
      kind: "ok",
      value: {
        number: 12,
        state: "opened",
        sha: "h1",
        sourceBranch: "feat/x",
        targetBranch: "main",
        labels: ["agent::claimed"],
        description: "",
        anchor: { kind: "gitlab", base: "b", start: "s", head: "h1" },
      },
    });
    expect(await forge.change({ number: 12 })).toMatchObject({ value: { state: "opened" } });
    expect(await forge.change({ number: 12 })).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("archived"),
    });
  });

  it("addLabel and removeLabel check what GitLab kept, and refuse a label with a comma", async () => {
    const f = fake("gitlab", [ok({ ...MR, labels: [] }), ok(MR), ok(MR)]);
    const forge = gitlab(f.client, project);
    expect(await forge.addLabel({ number: 12, label: "agent::claimed" })).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("did not keep"),
    });
    expect(await forge.addLabel({ number: 12, label: "agent::claimed" })).toEqual({ kind: "ok" });
    expect(JSON.parse(f.calls[1]!.stdin)).toEqual({ add_labels: "agent::claimed" });
    expect(await forge.removeLabel({ number: 12, label: "agent::claimed" })).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("did not remove"),
    });
    expect(await forge.addLabel({ number: 12, label: "a,b" })).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("comma"),
    });
    expect(f.calls).toHaveLength(3);
  });

  it("notes reads every page and leaves out GitLab's system notes, which would read as the developer's reply (#128)", async () => {
    const hundred = Array.from({ length: 100 }, (_, i) => ({
      body: `n${i}`,
      author: { username: "a" },
      created_at: "2026-11-01T00:00:00Z",
      system: i === 0,
    }));
    const f = fake("gitlab", [
      ok(hundred),
      ok([
        {
          body: "added ~agent::claimed label",
          author: { username: "ram" },
          created_at: "2026-11-02T00:00:00Z",
          system: true,
        },
      ]),
    ]);
    const notes = await gitlab(f.client, project).notes({ number: 12 });
    expect(notes.kind === "ok" ? notes.value.length : 0).toBe(99);
    expect(f.calls[1]!.args[2]).toBe(
      `${base}/merge_requests/12/notes?sort=asc&order_by=created_at&per_page=100&page=2`,
    );
  });

  it("lineFinding anchors to the diff refs; when GitLab refuses the line, an unanchored thread names file:line after the seat prefix", async () => {
    const change: Change = {
      number: 12,
      state: "opened",
      sha: "h1",
      sourceBranch: "x",
      targetBranch: "main",
      labels: [],
      description: "",
      anchor: { kind: "gitlab", base: "b", start: "s", head: "h1" },
    };
    const f = fake("gitlab", [
      { status: 400, body: { message: "line_code can not be blank" } },
      { status: 201, body: { id: "d2" } },
    ]);
    expect(
      await gitlab(f.client, project).lineFinding({ change, at: { file: "src/A.java", line: 400 }, post }),
    ).toEqual({ kind: "ok" });
    expect(JSON.parse(f.calls[0]!.stdin)).toEqual({
      body: "[reviewer] Act on F1",
      position: {
        position_type: "text",
        base_sha: "b",
        start_sha: "s",
        head_sha: "h1",
        new_path: "src/A.java",
        new_line: 400,
      },
    });
    expect(JSON.parse(f.calls[1]!.stdin)).toEqual({ body: "[reviewer] Act on F1\n\n- at: src/A.java:400" });
  });

  it("me is the CLI's username", async () => {
    const f = fake("gitlab", [ok({ username: "ram", bot: false })]);
    expect(await gitlab(f.client, project).me()).toEqual({ kind: "ok", value: "ram" });
  });

  it("status posts a commit status at the head with the branch as ref, so the merge request's pipeline shows it", async () => {
    const f = fake("gitlab", [ok({})]);
    const forge = gitlab(f.client, project);
    expect(
      await forge.status({
        sha: "b".repeat(40),
        ref: "factory/PROJ-1",
        state: "success",
        context: "agent-factory/verify",
        description: "make verify passed",
      }),
    ).toEqual({ kind: "ok" });
    expect((f.calls[0]?.args ?? []).join(" ")).toContain(`projects/aruvii%2Fagent-platform/statuses/${"b".repeat(40)}`);
    expect(JSON.parse(f.calls[0]?.stdin ?? "")).toEqual({
      state: "success",
      name: "agent-factory/verify",
      ref: "factory/PROJ-1",
      description: "make verify passed",
    });
  });
});

describe("openChange (#164)", () => {
  const request = {
    branch: "factory/T-7",
    base: "main",
    title: "/merge the ledger row",
    body: { seat: "coordinator", title: "T-7", fields: [], items: [] },
  } as const;
  const listed = (iid: number, source = 5, target = 5) => ({
    iid,
    source_project_id: source,
    target_project_id: target,
  });

  it("opens a draft merge request when none is open from the branch", async () => {
    const f = fake("gitlab", [ok([]), { status: 201, body: { iid: 81 } }]);
    expect(await gitlab(f.client, project).openChange(request)).toEqual({ kind: "ok", value: 81 });
    expect(f.calls[0]?.args[2]).toBe(`${base}/merge_requests?state=opened&source_branch=factory%2FT-7&per_page=100`);
    expect(JSON.parse(f.calls[1]?.stdin ?? "")).toEqual({
      source_branch: "factory/T-7",
      target_branch: "main",
      title: "Draft: \\/merge the ledger row",
      description: "[coordinator] T-7",
    });
  });

  it("reuses the merge request already open from the branch, and leaves a fork's out", async () => {
    const f = fake("gitlab", [ok([listed(12), listed(13, 99, 5)])]);
    expect(await gitlab(f.client, project).openChange(request)).toEqual({ kind: "ok", value: 12 });
    expect(f.calls).toHaveLength(1);
  });

  it("leaves two open merge requests to a person", async () => {
    const f = fake("gitlab", [ok([listed(12), listed(14)])]);
    expect(await gitlab(f.client, project).openChange(request)).toEqual({
      kind: "failed",
      reason: "2 changes are open from factory/T-7: !12, !14; a person decides",
    });
  });

  it("ciConfig reads the project's CI config path: empty is .gitlab-ci.yml, another project's file is not ours", async () => {
    const empty = fake("gitlab", [ok({ default_branch: "main", ci_config_path: null })]);
    expect(await gitlab(empty.client, project).ciConfig()).toEqual({
      kind: "ok",
      value: { kind: "file", path: ".gitlab-ci.yml" },
    });
    const custom = fake("gitlab", [ok({ ci_config_path: "ci/pipeline.yml" })]);
    expect(await gitlab(custom.client, project).ciConfig()).toEqual({
      kind: "ok",
      value: { kind: "file", path: "ci/pipeline.yml" },
    });
    const elsewhere = fake("gitlab", [ok({ ci_config_path: ".gitlab-ci.yml@group/ci" })]);
    expect(await gitlab(elsewhere.client, project).ciConfig()).toMatchObject({ value: { kind: "none" } });
  });
});

describe("failedJobs (#171)", () => {
  it("reads the merge request's head pipeline, its failed jobs, and the end of each trace, plain", async () => {
    const trace = `${Array.from({ length: 250 }, (_, i) => `line ${i + 1}`).join("\n")}\n\u001b[31;1mERROR: Job failed\u001b[0m\n`;
    const f = fake("gitlab", [
      ok({ iid: 7, head_pipeline: { id: 900 } }),
      ok([{ id: 51, name: "test" }]),
      { status: 200, body: trace },
    ]);
    const out = await gitlab(f.client, project).failedJobs({ number: 7, head: "aaaa1111" });
    // 251 lines in all: the last 200 start at line 52, with the colour codes gone
    expect(out).toEqual({
      kind: "ok",
      value: [
        {
          name: "test",
          log: { kind: "tail", text: expect.stringMatching(/^line 52\n[\s\S]*\nline 250\nERROR: Job failed$/) },
        },
      ],
    });
    expect(JSON.stringify(out).split("\\n")).toHaveLength(200);
    expect(f.calls.map((c) => c.args[2])).toEqual([
      `${base}/merge_requests/7`,
      `${base}/pipelines/900/jobs?scope[]=failed&per_page=100`,
      `${base}/jobs/51/trace`,
    ]);
  });

  it("reads at most 3 traces, and names every failed job", async () => {
    const jobs = [1, 2, 3, 4].map((id) => ({ id, name: `job-${id}` }));
    const f = fake("gitlab", [ok({ head_pipeline: { id: 9 } }), ok(jobs), ok("a"), ok("b"), ok("c")]);
    const out = await gitlab(f.client, project).failedJobs({ number: 7, head: "aaaa1111" });
    expect(out).toMatchObject({
      kind: "ok",
      value: [
        { name: "job-1", log: { kind: "tail" } },
        { name: "job-2", log: { kind: "tail" } },
        { name: "job-3", log: { kind: "tail" } },
        { name: "job-4", log: { kind: "none", why: "only the first 3 logs are read" } },
      ],
    });
    expect(f.calls).toHaveLength(5);
  });

  it("gives no jobs when the merge request has no pipeline, and a trace it cannot read as no log with the reason", async () => {
    const none = fake("gitlab", [ok({ head_pipeline: null })]);
    expect(await gitlab(none.client, project).failedJobs({ number: 7, head: "a" })).toEqual({ kind: "ok", value: [] });
    const gone = fake("gitlab", [
      ok({ head_pipeline: { id: 9 } }),
      ok([{ id: 5, name: "lint" }]),
      { status: 404, body: "" },
    ]);
    expect(await gitlab(gone.client, project).failedJobs({ number: 7, head: "a" })).toMatchObject({
      kind: "ok",
      value: [{ name: "lint", log: { kind: "none", why: expect.stringContaining("HTTP 404") } }],
    });
  });
});

describe("branchExists (#227)", () => {
  it("searches the whole name and checks the list for it exactly", async () => {
    const f = fake("gitlab", [ok([{ name: "factory/T-1" }]), ok([])]);
    const forge = gitlab(f.client, project);
    expect(await forge.branchExists({ branch: "factory/T-1" })).toEqual({ kind: "ok", value: true });
    expect(f.calls[0]?.args.join(" ")).toContain("repository/branches?search=%5Efactory%2FT-1%24");
    expect(await forge.branchExists({ branch: "factory/T-1" })).toEqual({ kind: "ok", value: false });
    expect(await forge.branchExists({ branch: "a b" })).toMatchObject({ kind: "failed" });
  });
});

describe("issueState (#494)", () => {
  it("is open while opened; a closed issue is completed only when a merged merge request closes or mentions it", async () => {
    const f = fake("gitlab", [
      ok({ iid: 4, state: "opened" }),
      // closed by a merge request that merged
      ok({ iid: 5, state: "closed" }),
      ok([{ iid: 9, state: "merged" }]),
      // closed by hand; a merged merge request mentions it
      ok({ iid: 6, state: "closed" }),
      ok([]),
      ok([{ iid: 10, state: "merged" }]),
    ]);
    const forge = gitlab(f.client, project);
    expect(await forge.issueState({ number: 4 })).toEqual({ kind: "ok", value: "open" });
    expect(f.calls[0]?.args.join(" ")).toContain("/issues/4");
    expect(await forge.issueState({ number: 5 })).toEqual({ kind: "ok", value: "completed" });
    expect(f.calls[2]?.args.join(" ")).toContain("/issues/5/closed_by");
    expect(await forge.issueState({ number: 6 })).toEqual({ kind: "ok", value: "completed" });
    expect(f.calls[5]?.args.join(" ")).toContain("/issues/6/related_merge_requests");
  });

  it("is closed with no merge seen when no merged merge request closes or mentions it: GitLab keeps no close reason", async () => {
    const f = fake("gitlab", [
      ok({ iid: 7, state: "closed" }),
      ok([{ iid: 11, state: "closed" }]),
      ok([{ iid: 12, state: "opened" }]),
      ok({ iid: 8, state: "closed" }),
      { status: 500, body: { message: "boom" } },
    ]);
    const forge = gitlab(f.client, project);
    expect(await forge.issueState({ number: 7 })).toEqual({ kind: "ok", value: "closed" });
    // a failed read is a failure, never a guess
    expect(await forge.issueState({ number: 8 })).toMatchObject({ kind: "failed" });
  });
});

describe("branchState (#494)", () => {
  it("reads the project's own merge requests from the branch, in any state; a fork's is left out", async () => {
    const own = { source_project_id: 1, target_project_id: 1 };
    const f = fake("gitlab", [
      ok([
        { ...own, state: "closed" },
        { ...own, state: "merged" },
      ]),
      ok([{ source_project_id: 2, target_project_id: 1, state: "merged" }]),
    ]);
    const forge = gitlab(f.client, project);
    expect(await forge.branchState({ branch: "factory/T-1" })).toEqual({ kind: "ok", value: "merged" });
    expect(f.calls[0]?.args.join(" ")).toContain("merge_requests?state=all&source_branch=factory%2FT-1");
    expect(await forge.branchState({ branch: "factory/T-1" })).toEqual({ kind: "ok", value: "none" });
  });
});

describe("issueBody (#381)", () => {
  it("reads an issue's description, none as empty", async () => {
    const f = fake("gitlab", [ok({ iid: 2, description: "# 2: a title\n" }), ok({ iid: 3, description: null })]);
    const forge = gitlab(f.client, project);
    expect(await forge.issueBody({ number: 2 })).toEqual({ kind: "ok", value: "# 2: a title\n" });
    expect(f.calls[0]?.args.join(" ")).toContain(`${base}/issues/2`);
    expect(await forge.issueBody({ number: 3 })).toEqual({ kind: "ok", value: "" });
  });
});
