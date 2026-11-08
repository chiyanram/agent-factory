// github — the GitHub adapter of the forge seam, through `gh api` (ADR-0010). REST for single changes and writes,
// GraphQL for lists, with every list paged to its end (#71). Owner, name and label go in as GraphQL variables, never
// into the query text. Only branches in the repository itself are supported: the writer pushes there.

import type { Note } from "../notes.js";
import { graphql, rest, restText, type Client, type Done, type Result } from "./api.js";
import { reader } from "./read.js";
import {
  after,
  completeAll,
  done,
  logOf,
  nextCursor,
  nextPage,
  openOnce,
  pages,
  rendered,
  text,
  unanchored,
  withLogs,
  type Page,
  type RawOpen,
} from "./shared.js";
import type {
  Change,
  ChangeRequest,
  Changes,
  CommitStatus,
  FailedJob,
  Forge,
  Level,
  MergedChange,
  OpenChange,
  Person,
  Pipeline,
} from "./types.js";

import type { GithubProject } from "./target.js";

export type { GithubProject };

// Every check rollup state GitHub defines (StatusState). Anything else is unknown, never "none" (#124).
const ROLLUP: Readonly<Record<string, Pipeline>> = {
  SUCCESS: { kind: "success" },
  FAILURE: { kind: "failed" },
  ERROR: { kind: "failed" },
  PENDING: { kind: "running" },
  EXPECTED: { kind: "running" },
};

export function pipeline(
  rollup: { readonly kind: "none" } | { readonly kind: "state"; readonly state: string },
): Pipeline {
  if (rollup.kind === "none") {
    return { kind: "none" };
  }
  return ROLLUP[rollup.state] ?? { kind: "unknown", raw: rollup.state };
}

const GITHUB_STATES: Readonly<Record<CommitStatus["state"], string>> = {
  pending: "pending",
  success: "success",
  failed: "failure",
};

// GitHub's repository permission, in the seam's levels: write or more counts as a maintainer, as on a personal
// repository a collaborator has write access and the owner admin.
function level(permission: string): Level {
  return ["ADMIN", "MAINTAIN", "WRITE"].includes(permission) ? "maintainer" : "guest";
}

const COMMENT = "body createdAt author { login __typename }";

const COLLABORATORS = `query($owner: String!, $name: String!, $after: String) { repository(owner: $owner, name: $name) {
  collaborators(first: 100, after: $after) { pageInfo { hasNextPage endCursor } edges { permission node { login } } } } }`;

const OPEN = `query($owner: String!, $name: String!, $after: String) { repository(owner: $owner, name: $name) {
  pullRequests(states: [OPEN], first: 50, after: $after, orderBy: {field: CREATED_AT, direction: ASC}) {
    pageInfo { hasNextPage endCursor }
    nodes { number isDraft headRefOid headRefName isCrossRepository
      labels(first: 100) { pageInfo { hasNextPage } nodes { name } }
      commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
      comments(last: 100) { pageInfo { hasPreviousPage startCursor } nodes { ${COMMENT} } } } } } }`;

const EARLIER = `query($owner: String!, $name: String!, $number: Int!, $before: String) { repository(owner: $owner, name: $name) {
  pullRequest(number: $number) { comments(last: 100, before: $before) {
    pageInfo { hasPreviousPage startCursor } nodes { ${COMMENT} } } } } }`;

function byState(state: "opened" | "merged"): string {
  return `query($owner: String!, $name: String!, $label: String!, $after: String) { repository(owner: $owner, name: $name) {
  pullRequests(states: [${state === "opened" ? "OPEN" : "MERGED"}], labels: [$label], first: 100, after: $after) {
    pageInfo { hasNextPage endCursor } nodes { number headRefName isCrossRepository } } } }`;
}

// GraphQL names a GitHub App by its slug alone ("ledger-factory"); REST, git and app-token use "ledger-factory[bot]".
// The seam always gives the [bot] form, so the factory's own notes match its login whichever way they were read. A
// deleted account leaves the author null: a person who is no member and not the factory.
function author(r: ReturnType<typeof reader>, node: unknown): string {
  if (r.absent(node, "author")) {
    return "";
  }
  const login = r.text(node, "author.login");
  return r.at(node, "author.__typename") === "Bot" && !login.endsWith("[bot]") ? `${login}[bot]` : login;
}

function comment(r: ReturnType<typeof reader>, node: unknown): Note {
  return { body: r.text(node, "body"), author: { name: author(r, node) }, at: r.text(node, "createdAt") };
}

// the check-run conclusions that make the rollup red (ROLLUP above: FAILURE, ERROR)
const RED_CHECKS = new Set(["failure", "timed_out", "cancelled", "startup_failure", "action_required"]);
const RED_STATUSES = new Set(["failure", "error"]);

type RedCheck = { readonly id: number; readonly name: string; readonly actions: boolean };

// redChecks : the failed check runs at a head; only a GitHub Actions run has a job log the API gives. Pure.
export function redChecks(answer: unknown, r: ReturnType<typeof reader>): readonly RedCheck[] {
  return r
    .list(answer, "check_runs")
    .filter((c) => RED_CHECKS.has(String(r.at(c, "conclusion"))))
    .map((c) => ({ id: r.int(c, "id"), name: r.text(c, "name"), actions: r.at(c, "app.slug") === "github-actions" }));
}

// redStatuses : the failed commit statuses at a head, which carry a description and no log. Pure.
export function redStatuses(answer: unknown, r: ReturnType<typeof reader>): readonly FailedJob[] {
  return r
    .list(answer, "statuses")
    .filter((s) => RED_STATUSES.has(String(r.at(s, "state"))))
    .map((s) => ({
      name: r.text(s, "context"),
      log: {
        kind: "none",
        why: `a commit status, with no log: ${r.absent(s, "description") ? "" : r.text(s, "description")}`,
      },
    }));
}

export function github(client: Client, project: GithubProject): Forge {
  const repo = `repos/${project.owner}/${project.name}`;

  async function getJson<T>(path: string, context: string, pick: (v: unknown, r: ReturnType<typeof reader>) => T) {
    const answer = await rest(client, { path, method: "GET", body: { kind: "none" } });
    if (answer.kind === "failed") {
      return answer;
    }
    const r = reader(context);
    return r.done(pick(answer.value, r));
  }

  // failedJobs : the head's failed check runs, each Actions run with its log's end, then its failed commit statuses
  async function failedJobs(input: { readonly head: string }): Promise<Result<readonly FailedJob[]>> {
    const checks = await getJson(
      `${repo}/commits/${input.head}/check-runs?filter=latest&per_page=100`,
      "github check runs",
      redChecks,
    );
    const statuses =
      checks.kind === "ok"
        ? await getJson(`${repo}/commits/${input.head}/status?per_page=100`, "github status", redStatuses)
        : checks;
    if (checks.kind === "failed" || statuses.kind === "failed") {
      return statuses.kind === "failed" ? statuses : { kind: "failed", reason: "github: cannot read the check runs" };
    }
    const jobs = await withLogs(
      checks.value,
      (c) => c.name,
      async (c) =>
        c.actions
          ? logOf(await restText(client, `${repo}/actions/jobs/${c.id}/logs`))
          : { kind: "none", why: "not a GitHub Actions job: its log is on its own site" },
    );
    return { kind: "ok", value: [...jobs, ...statuses.value] };
  }
  const where = { owner: text(project.owner), name: text(project.name) };

  async function query<T>(
    q: string,
    vars: Record<string, ReturnType<typeof text> | { kind: "int"; value: number }>,
    read: (data: unknown, r: ReturnType<typeof reader>) => T,
  ): Promise<Result<T>> {
    const data = await graphql(client, { query: q, variables: { ...where, ...vars } });
    if (data.kind === "failed") {
      return data;
    }
    const r = reader("github");
    if (r.absent(data.value, "repository")) {
      return { kind: "failed", reason: `github: no repository ${project.owner}/${project.name}, or gh cannot see it` };
    }
    return r.done(read(data.value, r));
  }

  async function change(input: { readonly number: number }): Promise<Result<Change>> {
    const answer = await rest(client, { path: `${repo}/pulls/${input.number}`, method: "GET", body: { kind: "none" } });
    if (answer.kind === "failed") {
      return answer;
    }
    const r = reader(`github pull request ${input.number}`);
    const v = answer.value;
    const state = r.bool(v, "merged") ? "merged" : r.text(v, "state") === "open" ? "opened" : "closed";
    const sha = r.text(v, "head.sha");
    return r.done({
      number: input.number,
      state,
      sha,
      sourceBranch: r.text(v, "head.ref"),
      targetBranch: r.text(v, "base.ref"),
      labels: r.list(v, "labels").map((l) => r.text(l, "name")),
      description: r.absent(v, "body") ? "" : r.text(v, "body"),
      anchor: { kind: "github", head: sha },
    });
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
        path: `${repo}/issues/${input.number}/comments`,
        method: "POST",
        body: { kind: "json", value: { body: body.value } },
      }),
    );
  }

  async function team(): Promise<Result<readonly Person[]>> {
    return pages((cursor) =>
      query(
        COLLABORATORS,
        after(cursor),
        (data, r): Page<Person> => ({
          items: r
            .list(data, "repository.collaborators.edges")
            .map((e) => ({ name: r.text(e, "node.login"), level: level(r.text(e, "permission")), bot: false })),
          next: nextCursor(r, data, "repository.collaborators.pageInfo"),
        }),
      ),
    );
  }

  function openNode(r: ReturnType<typeof reader>, node: unknown): RawOpen {
    const rollup = r.at(node, "commits.nodes.0.commit.statusCheckRollup");
    return {
      change: {
        number: r.int(node, "number"),
        branch: r.text(node, "headRefName"),
        fork: r.bool(node, "isCrossRepository"),
        head: r.text(node, "headRefOid"),
        draft: r.bool(node, "isDraft"),
        labels: r.list(node, "labels.nodes").map((l) => r.text(l, "name")),
        pipeline: pipeline(
          rollup === null || rollup === undefined
            ? { kind: "none" }
            : { kind: "state", state: r.text(rollup, "state") },
        ),
        comments: r.list(node, "comments.nodes").map((n) => comment(r, n)),
      },
      more: r.bool(node, "comments.pageInfo.hasPreviousPage"),
      start: r.absent(node, "comments.pageInfo.startCursor") ? "" : r.text(node, "comments.pageInfo.startCursor"),
      manyLabels: r.bool(node, "labels.pageInfo.hasNextPage"),
    };
  }

  async function open(): Promise<Result<readonly OpenChange[]>> {
    const raws = await pages((cursor) =>
      query(
        OPEN,
        after(cursor),
        (data, r): Page<RawOpen> => ({
          items: r.list(data, "repository.pullRequests.nodes").map((n) => openNode(r, n)),
          next: nextCursor(r, data, "repository.pullRequests.pageInfo"),
        }),
      ),
    );
    if (raws.kind === "failed") {
      return raws;
    }
    return completeAll(raws.value, "#", ({ number, before }) =>
      query(EARLIER, { number: { kind: "int", value: number }, ...after(before, "before") }, (data, r) => ({
        notes: r.list(data, "repository.pullRequest.comments.nodes").map((n) => comment(r, n)),
        more: r.bool(data, "repository.pullRequest.comments.pageInfo.hasPreviousPage"),
        start: r.bool(data, "repository.pullRequest.comments.pageInfo.hasPreviousPage")
          ? r.text(data, "repository.pullRequest.comments.pageInfo.startCursor")
          : "",
      })),
    );
  }

  async function labelled(input: {
    readonly state: "opened" | "merged";
    readonly label: string;
  }): Promise<Result<readonly MergedChange[]>> {
    return pages((cursor) =>
      query(
        byState(input.state),
        { label: text(input.label), ...after(cursor) },
        (data, r): Page<MergedChange> => ({
          items: r.list(data, "repository.pullRequests.nodes").map((n) => ({
            number: r.int(n, "number"),
            branch: r.text(n, "headRefName"),
            fork: r.bool(n, "isCrossRepository"),
          })),
          next: nextCursor(r, data, "repository.pullRequests.pageInfo"),
        }),
      ),
    );
  }

  // the open pull requests from this branch of the repository itself: head=owner:branch leaves forks out
  async function openFrom(branch: string): Promise<Result<readonly number[]>> {
    const head = encodeURIComponent(`${project.owner}:${branch}`);
    const answer = await rest(client, {
      path: `${repo}/pulls?state=open&head=${head}&per_page=100`,
      method: "GET",
      body: { kind: "none" },
    });
    if (answer.kind === "failed") {
      return answer;
    }
    const r = reader("github pull requests");
    return r.done(r.list(answer.value, "").map((p) => r.int(p, "number")));
  }

  async function openChange(request: ChangeRequest): Promise<Result<number>> {
    return openOnce({
      mark: "#",
      request,
      find: () => openFrom(request.branch),
      create: async (words) => {
        const value = { title: words.title, body: words.body, head: request.branch, base: request.base, draft: true };
        const answer = await rest(client, { path: `${repo}/pulls`, method: "POST", body: { kind: "json", value } });
        if (answer.kind === "failed") {
          return answer;
        }
        const r = reader("github pull request");
        return r.done(r.int(answer.value, "number"));
      },
    });
  }

  return {
    name: "github",
    mark: "#",
    openChange,
    async me() {
      const answer = await rest(client, { path: "user", method: "GET", body: { kind: "none" } });
      if (answer.kind === "failed") {
        return {
          kind: "failed",
          reason: `${answer.reason} (a GitHub App token has no user: with an App, set FACTORY_IDENTITY=app)`,
        };
      }
      const r = reader("github user");
      return r.done(r.text(answer.value, "login"));
    },
    change,
    failedJobs,
    // GitHub runs .github/workflows only, which the guard always covers
    async ciConfig() {
      return { kind: "ok", value: { kind: "none", why: "GitHub runs .github/workflows" } };
    },
    async defaultBranch() {
      const answer = await rest(client, { path: repo, method: "GET", body: { kind: "none" } });
      if (answer.kind === "failed") {
        return answer;
      }
      const r = reader("github repository");
      return r.done(r.text(answer.value, "default_branch"));
    },
    async addLabel(input) {
      const answer = await rest(client, {
        path: `${repo}/issues/${input.number}/labels`,
        method: "POST",
        body: { kind: "json", value: { labels: [input.label] } },
      });
      if (answer.kind === "failed") {
        return answer;
      }
      const r = reader("github labels");
      const kept = r.list(answer.value, "").some((l) => r.text(l, "name") === input.label);
      const read = r.done(kept);
      if (read.kind === "failed") {
        return read;
      }
      return read.value
        ? { kind: "ok" }
        : { kind: "failed", reason: `github: #${input.number}: GitHub did not keep the label ${input.label}` };
    },
    // GitHub answers 404 when the label is already gone (a human removed it after the caller looked). That is a
    // release, so a failed DELETE counts only when the label is still on the pull request.
    async removeLabel(input) {
      const removed = await rest(client, {
        path: `${repo}/issues/${input.number}/labels/${encodeURIComponent(input.label)}`,
        method: "DELETE",
        body: { kind: "none" },
      });
      if (removed.kind === "ok") {
        return { kind: "ok" };
      }
      const now = await change({ number: input.number });
      if (now.kind === "failed") {
        return now;
      }
      return now.value.labels.includes(input.label)
        ? {
            kind: "failed",
            reason: `github: #${input.number}: GitHub did not remove the label ${input.label}: ${removed.reason}`,
          }
        : { kind: "ok" };
    },
    note,
    async notes(input) {
      return pages(async (cursor): Promise<Result<Page<Note>>> => {
        const page = cursor.kind === "after" ? Number(cursor.cursor) : 1;
        const answer = await rest(client, {
          path: `${repo}/issues/${input.number}/comments?per_page=100&page=${page}`,
          method: "GET",
          body: { kind: "none" },
        });
        if (answer.kind === "failed") {
          return answer;
        }
        const r = reader("github comments");
        const batch = r.list(answer.value, "").map((c) => ({
          body: r.text(c, "body"),
          author: { name: r.absent(c, "user") ? "" : r.text(c, "user.login") },
          at: r.text(c, "created_at"),
        }));
        return r.done({ items: batch, next: nextPage(batch.length === 100, page) });
      });
    },
    // a commit status: statusCheckRollup, which poll reads, counts it with the checks
    async status(input) {
      const value = {
        state: GITHUB_STATES[input.state],
        context: input.context,
        description: Array.from(input.description).slice(0, 140).join(""),
      };
      return done(
        await rest(client, { path: `${repo}/statuses/${input.sha}`, method: "POST", body: { kind: "json", value } }),
      );
    },
    // GitHub anchors a review comment only to a line in the diff; otherwise the finding goes out as a plain comment
    async lineFinding(input) {
      const body = rendered(input.post);
      if (body.kind === "failed") {
        return body;
      }
      const head = input.change.anchor.kind === "github" ? input.change.anchor.head : input.change.sha;
      const value = { body: body.value, commit_id: head, path: input.at.file, line: input.at.line, side: "RIGHT" };
      const anchored = await rest(client, {
        path: `${repo}/pulls/${input.change.number}/comments`,
        method: "POST",
        body: { kind: "json", value },
      });
      return anchored.kind === "ok"
        ? { kind: "ok" }
        : note({ number: input.change.number, post: unanchored(input.post, input.at) });
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
