// gitlab — the GitLab adapter of the forge seam, through `glab api` (ADR-0009, ADR-0010). REST for single merge
// requests and writes, GraphQL for poll's lists, every list paged to its end. The project path and the label go in as
// GraphQL variables, never into the query text.
//
// GitLab lists its own activity ("added ~label", "changed the description") as notes too, authored by whoever acted.
// Under the developer's login such a note would read as their reply and close an ask (#128), so the seam returns
// comments only: system notes are left out everywhere.

import type { Note } from "../notes.js";
import { graphql, rest, type Client, type Done, type Result } from "./api.js";
import { reader, type Reader } from "./read.js";
import { after, completeAll, done, nextCursor, nextPage, pages, rendered, text, unanchored, type Page, type RawOpen } from "./shared.js";
import type { Change, ChangeState, Changes, Forge, Level, OpenChange, Person, Pipeline } from "./types.js";

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
  return head.kind === "none" ? { kind: "none" } : (STATUS[head.status.toUpperCase()] ?? { kind: "unknown", raw: head.status });
}

// GitLab's access levels: 40 Maintainer, 50 Owner; 30 Developer; lower is a guest or less.
function level(access: number): Level {
  return access >= 40 ? "maintainer" : access >= 30 ? "developer" : "guest";
}

const STATES: Readonly<Record<string, ChangeState>> = { opened: "opened", locked: "opened", merged: "merged", closed: "closed" };

const COMMENT = "body createdAt author { username }";

const MEMBERS = `query($project: ID!, $after: String) { project(fullPath: $project) {
  projectMembers(relations: [DIRECT, INHERITED, INVITED_GROUPS, SHARED_INTO_ANCESTORS], first: 100, after: $after) {
    pageInfo { hasNextPage endCursor } nodes { user { username bot } accessLevel { integerValue } } } } }`;

const OPEN = `query($project: ID!, $after: String) { project(fullPath: $project) {
  mergeRequests(state: opened, first: 50, after: $after, sort: CREATED_ASC) {
    pageInfo { hasNextPage endCursor }
    nodes { iid draft diffHeadSha
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
  return label.includes(",") ? { kind: "failed", reason: `gitlab: a label must not contain a comma, got ${JSON.stringify(label)}` } : { kind: "ok" };
}

export function gitlab(client: Client, project: string): Forge {
  const base = `projects/${encodeURIComponent(project)}`;
  const none = { kind: "none" } as const;

  async function query<T>(q: string, vars: Readonly<Record<string, ReturnType<typeof text>>>, read: (data: unknown, r: Reader) => T): Promise<Result<T>> {
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

  async function get(path: string, context: string, read: (value: unknown, r: Reader) => unknown): Promise<Result<unknown>> {
    const answer = await rest(client, { path, method: "GET", body: none });
    if (answer.kind === "failed") {
      return answer;
    }
    const r = reader(context);
    return r.done(read(answer.value, r));
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
      anchor: { kind: "gitlab", base: r.text(v, "diff_refs.base_sha"), start: r.text(v, "diff_refs.start_sha"), head: r.text(v, "diff_refs.head_sha") },
    });
  }

  async function discussion(number: number, value: unknown): Promise<Result<unknown>> {
    return rest(client, { path: `${base}/merge_requests/${number}/discussions`, method: "POST", body: { kind: "json", value } });
  }

  async function labels(input: { readonly number: number; readonly label: string }, key: "add_labels" | "remove_labels"): Promise<Result<readonly string[]>> {
    const one = oneLabel(input.label);
    if (one.kind === "failed") {
      return one;
    }
    const answer = await rest(client, { path: `${base}/merge_requests/${input.number}`, method: "PUT", body: { kind: "json", value: { [key]: input.label } } });
    if (answer.kind === "failed") {
      return answer;
    }
    const r = reader("gitlab labels");
    return r.done(r.list(answer.value, "labels").map((l) => r.text(l, "")));
  }

  async function team(): Promise<Result<readonly Person[]>> {
    const all = await pages((cursor) =>
      query(MEMBERS, after(cursor), (data, r): Page<Person | "none"> => ({
        items: r.list(data, "project.projectMembers.nodes").map((n) =>
          r.absent(n, "user") ? "none" : { name: r.text(n, "user.username"), level: level(r.int(n, "accessLevel.integerValue")), bot: r.at(n, "user.bot") === true },
        ),
        next: nextCursor(r, data, "project.projectMembers.pageInfo"),
      })),
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
        head,
        draft: r.bool(node, "draft"),
        labels: r.list(node, "labels.nodes").map((l) => r.text(l, "title")),
        pipeline: pipeline(headPipeline),
        comments: r.list(node, "notes.nodes").map((n) => comment(r, n)),
      },
      more: r.bool(node, "notes.pageInfo.hasPreviousPage"),
      start: r.absent(node, "notes.pageInfo.startCursor") ? "" : r.text(node, "notes.pageInfo.startCursor"),
      manyLabels: r.bool(node, "labels.pageInfo.hasNextPage"),
    };
  }

  async function open(): Promise<Result<readonly OpenChange[]>> {
    const raws = await pages((cursor) =>
      query(OPEN, after(cursor), (data, r): Page<RawOpen> => ({
        items: r.list(data, "project.mergeRequests.nodes").map((n) => openNode(r, n)),
        next: nextCursor(r, data, "project.mergeRequests.pageInfo"),
      })),
    );
    if (raws.kind === "failed") {
      return raws;
    }
    return completeAll(raws.value, "!", ({ number, before }) =>
      query(EARLIER, { iid: text(String(number)), ...after(before, "before") }, (data, r) => ({
        notes: r.list(data, "project.mergeRequest.notes.nodes").map((n) => comment(r, n)),
        more: r.bool(data, "project.mergeRequest.notes.pageInfo.hasPreviousPage"),
        start: r.bool(data, "project.mergeRequest.notes.pageInfo.hasPreviousPage") ? r.text(data, "project.mergeRequest.notes.pageInfo.startCursor") : "",
      })),
    );
  }

  async function note(input: { readonly number: number; readonly post: Parameters<Forge["note"]>[0]["post"] }): Promise<Done> {
    const body = rendered(input.post);
    if (body.kind === "failed") {
      return body;
    }
    return done(await rest(client, { path: `${base}/merge_requests/${input.number}/notes`, method: "POST", body: { kind: "json", value: { body: body.value } } }));
  }

  async function claimed(input: { readonly state: "opened" | "merged"; readonly label: string }): Promise<Result<readonly number[]>> {
    const one = oneLabel(input.label);
    if (one.kind === "failed") {
      return one;
    }
    return pages(async (cursor): Promise<Result<Page<number>>> => {
      const page = cursor.kind === "after" ? Number(cursor.cursor) : 1;
      const path = `${base}/merge_requests?state=${input.state}&labels=${encodeURIComponent(input.label)}&per_page=100&page=${page}`;
      const answer = await rest(client, { path, method: "GET", body: none });
      if (answer.kind === "failed") {
        return answer;
      }
      const r = reader("gitlab merge requests");
      const batch = r.list(answer.value, "").map((m) => r.int(m, "iid"));
      return r.done({ items: batch, next: nextPage(batch.length === 100, page) });
    });
  }

  return {
    name: "gitlab",
    mark: "!",
    async me() {
      const login = await get("user", "gitlab user", (v, r) => r.text(v, "username"));
      return login.kind === "ok" ? { kind: "ok", value: String(login.value) } : login;
    },
    change,
    async defaultBranch() {
      const branch = await get(base, "gitlab project", (v, r) => r.text(v, "default_branch"));
      return branch.kind === "ok" ? { kind: "ok", value: String(branch.value) } : branch;
    },
    async addLabel(input) {
      const after = await labels(input, "add_labels");
      if (after.kind === "failed") {
        return after;
      }
      return after.value.includes(input.label) ? { kind: "ok" } : { kind: "failed", reason: `gitlab: !${input.number}: GitLab did not keep the label ${input.label}` };
    },
    async removeLabel(input) {
      const after = await labels(input, "remove_labels");
      if (after.kind === "failed") {
        return after;
      }
      return after.value.includes(input.label) ? { kind: "failed", reason: `gitlab: !${input.number}: GitLab did not remove the label ${input.label}` } : { kind: "ok" };
    },
    note,
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
          .map((n) => ({ body: r.text(n, "body"), author: { name: r.absent(n, "author") ? "" : r.text(n, "author.username") }, at: r.text(n, "created_at") }));
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
      const position = { position_type: "text", base_sha: a.base, start_sha: a.start, head_sha: a.head, new_path: input.at.file, new_line: input.at.line };
      const anchored = await discussion(input.change.number, { body: body.value, position });
      if (anchored.kind === "ok") {
        return { kind: "ok" };
      }
      const plain = rendered(unanchored(input.post, input.at));
      return plain.kind === "ok" ? done(await discussion(input.change.number, { body: plain.value })) : plain;
    },
    claimed,
    async changes(input): Promise<Result<Changes>> {
      const people = await team();
      if (people.kind === "failed") {
        return people;
      }
      const opened = await open();
      if (opened.kind === "failed") {
        return opened;
      }
      const merged = await claimed({ state: "merged", label: input.label });
      return merged.kind === "ok" ? { kind: "ok", value: { team: people.value, open: opened.value, merged: merged.value } } : merged;
    },
  };
}
