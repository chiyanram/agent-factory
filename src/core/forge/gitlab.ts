// gitlab — the GitLab adapter of the forge seam, through `glab api` (ADR-0009, ADR-0010). REST for single merge
// requests and writes, GraphQL for poll's lists, every list paged to its end. The project path and the label go in as
// GraphQL variables, never into the query text.
//
// GitLab lists its own activity ("added ~label", "changed the description") as notes too, authored by whoever acted.
// Under the developer's login such a note would read as their reply and close an ask (#128), so the seam returns
// comments only: system notes are left out everywhere.

import { plainBranch } from "../branch.js";
import type { Note } from "../notes.js";
import { graphql, rest, restText, type Client, type Done, type Result } from "./api.js";
import { reader, type Reader } from "./read.js";
import {
  after,
  branchStateOf,
  completeAll,
  done,
  logOf,
  nextCursor,
  nextPage,
  openOnce,
  pages,
  rendered,
  renderedBody,
  text,
  unanchored,
  withLogs,
  type Page,
  type RawOpen,
} from "./shared.js";
import type {
  CiConfig,
  CommitStatus,
  Change,
  ChangeRequest,
  ChangeState,
  Changes,
  FailedJob,
  Forge,
  Level,
  Mergeable,
  IssueState,
  Landed,
  MergedChange,
  OpenChange,
  Person,
  Pipeline,
} from "./types.js";

// Every pipeline status GitLab defines (PipelineStatusEnum). Anything else is unknown, never "none" (#124).
const STATUS: Readonly<Record<string, Pipeline>> = {
  CREATED: { kind: "running" },
  WAITING_FOR_RESOURCE: { kind: "running" },
  PREPARING: { kind: "running" },
  WAITING_FOR_CALLBACK: { kind: "running" },
  PENDING: { kind: "running" },
  RUNNING: { kind: "running" },
  SCHEDULED: { kind: "running" },
  SUCCESS: { kind: "success" },
  FAILED: { kind: "failed" },
  CANCELED: { kind: "canceled" },
  CANCELING: { kind: "canceled" },
  SKIPPED: { kind: "skipped" },
  MANUAL: { kind: "manual" },
};

export type HeadPipeline = { readonly kind: "none" } | { readonly kind: "pipeline"; readonly status: string };

// pipeline : the status of the head pipeline. GitLab already gives only a pipeline for the diff head: its sha is the
// head, or for a merged-results or merge-train pipeline the merge ref with the head as source_sha.
export function pipeline(head: HeadPipeline): Pipeline {
  return head.kind === "none"
    ? { kind: "none" }
    : (STATUS[head.status.toUpperCase()] ?? { kind: "unknown", raw: head.status });
}

// mergeableOf : conflicts says the merge request cannot merge; CAN_BE_MERGED that it can. Any other merge status
// (UNCHECKED, CHECKING, CANNOT_BE_MERGED_RECHECK) is unknown until GitLab has checked it. Pure.
export function mergeableOf(conflicts: unknown, status: unknown): Mergeable {
  if (conflicts === true) {
    return "conflict";
  }
  return status === "CAN_BE_MERGED" ? "clean" : "unknown";
}

// GitLab's access levels: 40 Maintainer, 50 Owner; 30 Developer; lower is a guest or less.
function level(access: number): Level {
  return access >= 40 ? "maintainer" : access >= 30 ? "developer" : "guest";
}

const STATES: Readonly<Record<string, ChangeState>> = {
  opened: "opened",
  locked: "opened",
  merged: "merged",
  closed: "closed",
};

const COMMENT = "body createdAt author { username }";

const MEMBERS = `query($project: ID!, $after: String) { project(fullPath: $project) {
  projectMembers(relations: [DIRECT, INHERITED, INVITED_GROUPS, SHARED_INTO_ANCESTORS], first: 100, after: $after) {
    pageInfo { hasNextPage endCursor } nodes { user { username bot } accessLevel { integerValue } } } } }`;

const OPEN = `query($project: ID!, $after: String) { project(fullPath: $project) {
  mergeRequests(state: opened, first: 50, after: $after, sort: CREATED_ASC) {
    pageInfo { hasNextPage endCursor }
    nodes { iid draft diffHeadSha sourceBranch sourceProjectId targetProjectId conflicts mergeStatusEnum
      labels(first: 100) { pageInfo { hasNextPage } nodes { title } }
      headPipeline { status }
      notes(filter: ONLY_COMMENTS, last: 100) { pageInfo { hasPreviousPage startCursor } nodes { ${COMMENT} } } } } } }`;

const EARLIER = `query($project: ID!, $iid: String!, $before: String) { project(fullPath: $project) {
  mergeRequest(iid: $iid) { notes(filter: ONLY_COMMENTS, last: 100, before: $before) {
    pageInfo { hasPreviousPage startCursor } nodes { ${COMMENT} } } } } }`;

function comment(r: Reader, node: unknown): Note {
  // a deleted account leaves author null: a person who is no member and not the factory
  const name = r.absent(node, "author") ? "" : r.text(node, "author.username");
  return { body: r.text(node, "body"), author: { name }, at: r.text(node, "createdAt") };
}

// GitLab's add_labels and remove_labels split on commas, so a label with a comma would touch two labels.
function oneLabel(label: string): Done {
  return label.includes(",")
    ? { kind: "failed", reason: `gitlab: a label must not contain a comma, got ${JSON.stringify(label)}` }
    : { kind: "ok" };
}

// ciConfigOf : the CI file a GitLab project runs, from its ci_config_path setting
export function ciConfigOf(setting: string): CiConfig {
  const path = setting.trim().replace(/^\/+/, "");
  if (path === "") {
    return { kind: "file", path: ".gitlab-ci.yml" };
  }
  return path.includes("@") || /^[a-z]+:\/\//i.test(path)
    ? { kind: "none", why: `the CI config is kept outside this repository (${path})` }
    : { kind: "file", path };
}

export function gitlab(client: Client, project: string): Forge {
  const base = `projects/${encodeURIComponent(project)}`;
  const none = { kind: "none" } as const;

  async function query<T>(
    q: string,
    vars: Readonly<Record<string, ReturnType<typeof text>>>,
    read: (data: unknown, r: Reader) => T,
  ): Promise<Result<T>> {
    const data = await graphql(client, { query: q, variables: { project: text(project), ...vars } });
    if (data.kind === "failed") {
      return data;
    }
    const r = reader("gitlab");
    if (r.absent(data.value, "project")) {
      return { kind: "failed", reason: `gitlab: no project ${project}, or glab cannot see it` };
    }
    return r.done(read(data.value, r));
  }

  async function get(
    path: string,
    context: string,
    read: (value: unknown, r: Reader) => unknown,
  ): Promise<Result<unknown>> {
    const answer = await rest(client, { path, method: "GET", body: none });
    if (answer.kind === "failed") {
      return answer;
    }
    const r = reader(context);
    return r.done(read(answer.value, r));
  }

  // mergedFor : whether a merged merge request of this project is among an issue's list at `which`
  async function mergedFor(issue: number, which: "closed_by" | "related_merge_requests"): Promise<Result<boolean>> {
    const found = await get(`${base}/issues/${issue}/${which}?per_page=100`, `gitlab issue ${which}`, (v, r) =>
      r.list(v, "").some((m) => r.text(m, "state") === "merged"),
    );
    return found.kind === "ok" ? { kind: "ok", value: found.value === true } : found;
  }

  // closedState : a closed issue is completed when a merged merge request closes it, else when one mentions it; else
  // it is closed with no merge seen (#494)
  async function closedState(issue: number): Promise<Result<IssueState>> {
    for (const which of ["closed_by", "related_merge_requests"] as const) {
      const merged = await mergedFor(issue, which);
      if (merged.kind === "failed" || merged.value) {
        return merged.kind === "failed" ? merged : { kind: "ok", value: "completed" };
      }
    }
    return { kind: "ok", value: "closed" };
  }

  async function change(input: { readonly number: number }): Promise<Result<Change>> {
    const answer = await rest(client, { path: `${base}/merge_requests/${input.number}`, method: "GET", body: none });
    if (answer.kind === "failed") {
      return answer;
    }
    const r = reader(`gitlab merge request ${input.number}`);
    const v = answer.value;
    const raw = r.text(v, "state");
    const state = STATES[raw];
    if (state === undefined) {
      return { kind: "failed", reason: `gitlab: !${input.number} is in a state the seam does not know: ${raw}` };
    }
    return r.done({
      number: input.number,
      state,
      sha: r.text(v, "sha"),
      sourceBranch: r.text(v, "source_branch"),
      targetBranch: r.text(v, "target_branch"),
      labels: r.list(v, "labels").map((l) => r.text(l, "")),
      description: r.absent(v, "description") ? "" : r.text(v, "description"),
      anchor: {
        kind: "gitlab",
        base: r.text(v, "diff_refs.base_sha"),
        start: r.text(v, "diff_refs.start_sha"),
        head: r.text(v, "diff_refs.head_sha"),
      },
    });
  }

  // landedOf : when, as which commit and by whom a merge request was merged: the merge commit, else the squash commit,
  // else the head itself when it was fast-forwarded onto the target
  async function landedOf(input: { readonly number: number }): Promise<Result<Landed>> {
    const answer = await rest(client, { path: `${base}/merge_requests/${input.number}`, method: "GET", body: none });
    if (answer.kind === "failed") {
      return answer;
    }
    const r = reader(`gitlab merge request ${input.number}`);
    const v = answer.value;
    if (r.text(v, "state") !== "merged") {
      return { kind: "failed", reason: `gitlab: !${input.number} is not merged` };
    }
    const commit = ["merge_commit_sha", "squash_commit_sha", "sha"].find((k) => !r.absent(v, k)) ?? "sha";
    return r.done({
      at: r.text(v, "merged_at"),
      sha: r.text(v, commit),
      by: r.absent(v, "merge_user") ? "" : r.text(v, "merge_user.username"),
    });
  }

  async function discussion(number: number, value: unknown): Promise<Result<unknown>> {
    return rest(client, {
      path: `${base}/merge_requests/${number}/discussions`,
      method: "POST",
      body: { kind: "json", value },
    });
  }

  async function labels(
    input: { readonly number: number; readonly label: string },
    key: "add_labels" | "remove_labels",
  ): Promise<Result<readonly string[]>> {
    const one = oneLabel(input.label);
    if (one.kind === "failed") {
      return one;
    }
    const answer = await rest(client, {
      path: `${base}/merge_requests/${input.number}`,
      method: "PUT",
      body: { kind: "json", value: { [key]: input.label } },
    });
    if (answer.kind === "failed") {
      return answer;
    }
    const r = reader("gitlab labels");
    return r.done(r.list(answer.value, "labels").map((l) => r.text(l, "")));
  }

  async function team(): Promise<Result<readonly Person[]>> {
    const all = await pages((cursor) =>
      query(
        MEMBERS,
        after(cursor),
        (data, r): Page<Person | "none"> => ({
          items: r.list(data, "project.projectMembers.nodes").map((n) =>
            r.absent(n, "user")
              ? "none"
              : {
                  name: r.text(n, "user.username"),
                  level: level(r.int(n, "accessLevel.integerValue")),
                  bot: r.at(n, "user.bot") === true,
                },
          ),
          next: nextCursor(r, data, "project.projectMembers.pageInfo"),
        }),
      ),
    );
    return all.kind === "ok" ? { kind: "ok", value: all.value.filter((p): p is Person => p !== "none") } : all;
  }

  function openNode(r: Reader, node: unknown): RawOpen {
    const head = r.text(node, "diffHeadSha");
    const headPipeline: HeadPipeline = r.absent(node, "headPipeline")
      ? { kind: "none" }
      : { kind: "pipeline", status: r.text(node, "headPipeline.status") };
    return {
      change: {
        number: r.int(node, "iid"),
        branch: r.text(node, "sourceBranch"),
        fork: r.at(node, "sourceProjectId") !== r.at(node, "targetProjectId"),
        head,
        draft: r.bool(node, "draft"),
        labels: r.list(node, "labels.nodes").map((l) => r.text(l, "title")),
        pipeline: pipeline(headPipeline),
        mergeable: mergeableOf(r.at(node, "conflicts"), r.at(node, "mergeStatusEnum")),
        comments: r.list(node, "notes.nodes").map((n) => comment(r, n)),
      },
      more: r.bool(node, "notes.pageInfo.hasPreviousPage"),
      start: r.absent(node, "notes.pageInfo.startCursor") ? "" : r.text(node, "notes.pageInfo.startCursor"),
      manyLabels: r.bool(node, "labels.pageInfo.hasNextPage"),
    };
  }

  async function open(): Promise<Result<readonly OpenChange[]>> {
    const raws = await pages((cursor) =>
      query(
        OPEN,
        after(cursor),
        (data, r): Page<RawOpen> => ({
          items: r.list(data, "project.mergeRequests.nodes").map((n) => openNode(r, n)),
          next: nextCursor(r, data, "project.mergeRequests.pageInfo"),
        }),
      ),
    );
    if (raws.kind === "failed") {
      return raws;
    }
    return completeAll(raws.value, "!", ({ number, before }) =>
      query(EARLIER, { iid: text(String(number)), ...after(before, "before") }, (data, r) => ({
        notes: r.list(data, "project.mergeRequest.notes.nodes").map((n) => comment(r, n)),
        more: r.bool(data, "project.mergeRequest.notes.pageInfo.hasPreviousPage"),
        start: r.bool(data, "project.mergeRequest.notes.pageInfo.hasPreviousPage")
          ? r.text(data, "project.mergeRequest.notes.pageInfo.startCursor")
          : "",
      })),
    );
  }

  async function note(input: {
    readonly number: number;
    readonly post: Parameters<Forge["note"]>[0]["post"];
  }): Promise<Done> {
    const body = rendered(input.post);
    if (body.kind === "failed") {
      return body;
    }
    return done(
      await rest(client, {
        path: `${base}/merge_requests/${input.number}/notes`,
        method: "POST",
        body: { kind: "json", value: { body: body.value } },
      }),
    );
  }

  async function setBody(input: {
    readonly number: number;
    readonly post: Parameters<Forge["setBody"]>[0]["post"];
  }): Promise<Done> {
    const body = renderedBody(input.post);
    if (body.kind === "failed") {
      return body;
    }
    return done(
      await rest(client, {
        path: `${base}/merge_requests/${input.number}`,
        method: "PUT",
        body: { kind: "json", value: { description: body.value } },
      }),
    );
  }

  async function labelled(input: {
    readonly state: "opened" | "merged";
    readonly label: string;
  }): Promise<Result<readonly MergedChange[]>> {
    const one = oneLabel(input.label);
    if (one.kind === "failed") {
      return one;
    }
    return pages(async (cursor): Promise<Result<Page<MergedChange>>> => {
      const page = cursor.kind === "after" ? Number(cursor.cursor) : 1;
      const path = `${base}/merge_requests?state=${input.state}&labels=${encodeURIComponent(input.label)}&per_page=100&page=${page}`;
      const answer = await rest(client, { path, method: "GET", body: none });
      if (answer.kind === "failed") {
        return answer;
      }
      const r = reader("gitlab merge requests");
      const batch = r.list(answer.value, "").map((m) => ({
        number: r.int(m, "iid"),
        branch: r.text(m, "source_branch"),
        fork: r.at(m, "source_project_id") !== r.at(m, "target_project_id"),
      }));
      return r.done({ items: batch, next: nextPage(batch.length === 100, page) });
    });
  }

  // the open merge requests from this branch of the project itself: one from a fork has another source project
  async function openFrom(branch: string): Promise<Result<readonly number[]>> {
    const path = `${base}/merge_requests?state=opened&source_branch=${encodeURIComponent(branch)}&per_page=100`;
    const answer = await rest(client, { path, method: "GET", body: none });
    if (answer.kind === "failed") {
      return answer;
    }
    const r = reader("gitlab merge requests");
    const ours = r.list(answer.value, "").filter((m) => r.at(m, "source_project_id") === r.at(m, "target_project_id"));
    return r.done(ours.map((m) => r.int(m, "iid")));
  }

  // GitLab marks a draft by the title's "Draft: " prefix
  async function openChange(request: ChangeRequest): Promise<Result<number>> {
    return openOnce({
      mark: "!",
      request,
      find: () => openFrom(request.branch),
      create: async (words) => {
        const value = {
          source_branch: request.branch,
          target_branch: request.base,
          title: `Draft: ${words.title}`,
          description: words.body,
        };
        const answer = await rest(client, {
          path: `${base}/merge_requests`,
          method: "POST",
          body: { kind: "json", value },
        });
        if (answer.kind === "failed") {
          return answer;
        }
        const r = reader("gitlab merge request");
        return r.done(r.int(answer.value, "iid"));
      },
    });
  }

  type Job = { readonly id: number; readonly name: string };

  // failedOf : the failed jobs of one pipeline (a retried job counts once, as its latest try)
  async function failedOf(id: number): Promise<Result<readonly Job[]>> {
    const path = `${base}/pipelines/${id}/jobs?scope[]=failed&per_page=100`;
    const answer = await rest(client, { path, method: "GET", body: none });
    if (answer.kind === "failed") {
      return answer;
    }
    const r = reader("gitlab jobs");
    return r.done(r.list(answer.value, "").map((j): Job => ({ id: r.int(j, "id"), name: r.text(j, "name") })));
  }

  // failedJobs : the failed jobs of the merge request's head pipeline, each with its trace's end; none with no pipeline
  async function failedJobs(input: { readonly number: number }): Promise<Result<readonly FailedJob[]>> {
    const headId = await get(`${base}/merge_requests/${input.number}`, "gitlab merge request", (v, r) =>
      r.absent(v, "head_pipeline") ? 0 : r.int(v, "head_pipeline.id"),
    );
    if (headId.kind === "failed" || headId.value === 0) {
      return headId.kind === "failed" ? headId : { kind: "ok", value: [] };
    }
    const jobs = await failedOf(Number(headId.value));
    if (jobs.kind === "failed") {
      return jobs;
    }
    const traced = await withLogs(
      jobs.value,
      (j) => j.name,
      async (j) => logOf(await restText(client, `${base}/jobs/${j.id}/trace`)),
    );
    return { kind: "ok", value: traced };
  }

  return {
    name: "gitlab",
    mark: "!",
    openChange,
    async me() {
      const login = await get("user", "gitlab user", (v, r) => r.text(v, "username"));
      return login.kind === "ok" ? { kind: "ok", value: String(login.value) } : login;
    },
    change,
    landed: landedOf,
    failedJobs,
    // ci_config_path: empty for .gitlab-ci.yml; "path@group/project" or a URL for a file kept outside this repository
    async ciConfig() {
      const set = await get(base, "gitlab project", (v, r) =>
        r.absent(v, "ci_config_path") ? "" : r.text(v, "ci_config_path"),
      );
      return set.kind === "ok" ? { kind: "ok", value: ciConfigOf(String(set.value)) } : set;
    },
    async defaultBranch() {
      const branch = await get(base, "gitlab project", (v, r) => r.text(v, "default_branch"));
      return branch.kind === "ok" ? { kind: "ok", value: String(branch.value) } : branch;
    },
    // search with ^ and $ matches the whole name, and the list is still checked for it exactly
    async branchExists(input) {
      if (!plainBranch(input.branch)) {
        return { kind: "failed", reason: `gitlab: not a plain branch name: ${JSON.stringify(input.branch)}` };
      }
      const search = encodeURIComponent(`^${input.branch}$`);
      const found = await get(`${base}/repository/branches?search=${search}&per_page=100`, "gitlab branches", (v, r) =>
        r.list(v, "").some((b) => r.text(b, "name") === input.branch),
      );
      return found.kind === "ok" ? { kind: "ok", value: found.value === true } : found;
    },
    // every merge request from this branch of the project itself, in any state: one from a fork has another source
    // project (#494)
    async branchState(input) {
      if (!plainBranch(input.branch)) {
        return { kind: "failed", reason: `gitlab: not a plain branch name: ${JSON.stringify(input.branch)}` };
      }
      const path = `${base}/merge_requests?state=all&source_branch=${encodeURIComponent(input.branch)}&per_page=100`;
      const found = await get(path, "gitlab merge requests", (v, r) =>
        branchStateOf(
          r
            .list(v, "")
            .filter((m) => r.at(m, "source_project_id") === r.at(m, "target_project_id"))
            .map((m) => r.text(m, "state")),
        ),
      );
      return found.kind === "ok" ? { kind: "ok", value: branchStateOf([String(found.value)]) } : found;
    },
    // an issue's state (#494). GitLab records no reason for a close, so a closed issue is completed only when a merged
    // merge request closes it or mentions it; else it is closed with no merge seen, which a person looks at
    async issueState(input) {
      const state = await get(`${base}/issues/${input.number}`, "gitlab issue", (v, r) => r.text(v, "state"));
      if (state.kind === "failed") {
        return state;
      }
      return state.value === "opened" ? { kind: "ok", value: "open" } : closedState(input.number);
    },
    // an issue's description; GitLab numbers issues and merge requests apart, so an iid here is always an issue
    async issueBody(input) {
      const body = await get(`${base}/issues/${input.number}`, "gitlab issue", (v, r) =>
        r.absent(v, "description") ? "" : r.text(v, "description"),
      );
      return body.kind === "ok" ? { kind: "ok", value: String(body.value) } : body;
    },
    // a commit status with the branch as ref: GitLab adds it to an external pipeline for that head, which the merge
    // request shows as its head pipeline
    async status(input: CommitStatus) {
      const value = {
        state: input.state,
        name: input.context,
        ref: input.ref,
        description: Array.from(input.description).slice(0, 140).join(""),
      };
      return done(
        await rest(client, { path: `${base}/statuses/${input.sha}`, method: "POST", body: { kind: "json", value } }),
      );
    },
    async addLabel(input) {
      const after = await labels(input, "add_labels");
      if (after.kind === "failed") {
        return after;
      }
      return after.value.includes(input.label)
        ? { kind: "ok" }
        : { kind: "failed", reason: `gitlab: !${input.number}: GitLab did not keep the label ${input.label}` };
    },
    async removeLabel(input) {
      const after = await labels(input, "remove_labels");
      if (after.kind === "failed") {
        return after;
      }
      return after.value.includes(input.label)
        ? { kind: "failed", reason: `gitlab: !${input.number}: GitLab did not remove the label ${input.label}` }
        : { kind: "ok" };
    },
    note,
    setBody,
    // an issue's description replaced (#542); GitLab numbers issues and merge requests apart, so an iid here is
    // always an issue
    async setIssueBody(input) {
      return done(
        await rest(client, {
          path: `${base}/issues/${input.number}`,
          method: "PUT",
          body: { kind: "json", value: { description: input.text } },
        }),
      );
    },
    // every comment, oldest first, every page: an MR with many notes must not push the reviewer's rounds out of view
    async notes(input) {
      return pages(async (cursor): Promise<Result<Page<Note>>> => {
        const page = cursor.kind === "after" ? Number(cursor.cursor) : 1;
        const path = `${base}/merge_requests/${input.number}/notes?sort=asc&order_by=created_at&per_page=100&page=${page}`;
        const answer = await rest(client, { path, method: "GET", body: none });
        if (answer.kind === "failed") {
          return answer;
        }
        const r = reader("gitlab notes");
        const batch = r.list(answer.value, "");
        const notes = batch
          .filter((n) => r.at(n, "system") !== true)
          .map((n) => ({
            body: r.text(n, "body"),
            author: { name: r.absent(n, "author") ? "" : r.text(n, "author.username") },
            at: r.text(n, "created_at"),
          }));
        return r.done({ items: notes, next: nextPage(batch.length === 100, page) });
      });
    },
    // GitLab anchors a thread only to a line in the diff; otherwise it opens an unanchored one that names file:line
    async lineFinding(input) {
      const body = rendered(input.post);
      if (body.kind === "failed") {
        return body;
      }
      const a = input.change.anchor;
      if (a.kind !== "gitlab") {
        return { kind: "failed", reason: "gitlab: the change was not read from GitLab, so it has no diff refs" };
      }
      const position = {
        position_type: "text",
        base_sha: a.base,
        start_sha: a.start,
        head_sha: a.head,
        new_path: input.at.file,
        new_line: input.at.line,
      };
      const anchored = await discussion(input.change.number, { body: body.value, position });
      if (anchored.kind === "ok") {
        return { kind: "ok" };
      }
      const plain = rendered(unanchored(input.post, input.at));
      return plain.kind === "ok" ? done(await discussion(input.change.number, { body: plain.value })) : plain;
    },
    async claimed(input) {
      const found = await labelled(input);
      return found.kind === "ok" ? { kind: "ok", value: found.value.map((c) => c.number) } : found;
    },
    async changes(input): Promise<Result<Changes>> {
      const people = await team();
      if (people.kind === "failed") {
        return people;
      }
      const opened = await open();
      if (opened.kind === "failed") {
        return opened;
      }
      const merged = await labelled({ state: "merged", label: input.label });
      return merged.kind === "ok"
        ? { kind: "ok", value: { team: people.value, open: opened.value, merged: merged.value } }
        : merged;
    },
  };
}
