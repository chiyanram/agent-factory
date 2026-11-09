// shapes — the forge seam's values read back from JSON (#134 PR C). A forge plugin and the core speak these over the
// plugin protocol: the plugin reads its inputs with them, and the core reads the plugin's answers with them, so a value
// that is not what the Forge interface says never reaches the dispatcher. Each reader takes a Reader (read.ts), which
// keeps the first value out of place; the caller checks it once with r.done.

import type { Note } from "../notes.js";
import type { BodyPost, Post, PostField, Seat } from "../post.js";
import type { Reader } from "./read.js";
import type {
  Anchor,
  Change,
  ChangeRequest,
  Changes,
  CiConfig,
  CommitStatus,
  FailedJob,
  LineFinding,
  Mergeable,
  MergedChange,
  OpenChange,
  Person,
  Pipeline,
  PipelineState,
} from "./types.js";

const SEATS: readonly [Seat, ...Seat[]] = ["writer", "reviewer", "coordinator"];
const STATES: readonly [PipelineState, ...PipelineState[]] = [
  "none",
  "success",
  "failed",
  "running",
  "canceled",
  "skipped",
  "manual",
];

function texts(r: Reader, value: unknown, path: string): readonly string[] {
  return r.list(value, path).map((t) => r.text(t, ""));
}

export function noteOf(r: Reader, value: unknown): Note {
  return { body: r.text(value, "body"), author: { name: r.text(value, "author.name") }, at: r.text(value, "at") };
}

export function notesOf(r: Reader, value: unknown): readonly Note[] {
  return r.list(value, "").map((n) => noteOf(r, n));
}

function fieldOf(r: Reader, value: unknown): PostField {
  return { label: r.text(value, "label"), value: r.text(value, "value") };
}

export function postOf(r: Reader, value: unknown): Post {
  return {
    seat: r.word(value, "seat", SEATS),
    title: r.text(value, "title"),
    fields: r.list(value, "fields").map((f) => fieldOf(r, f)),
    items: texts(r, value, "items"),
  };
}

// bodyPostOf : a PR body: a post, and the implementer's Markdown with the git host when it has them (#335). The adapter
// that posts it cleans the Markdown again (renderBody), whatever cleaned it before.
export function bodyPostOf(r: Reader, value: unknown): BodyPost {
  const post = postOf(r, value);
  return r.absent(value, "prBody")
    ? post
    : { ...post, prBody: { markdown: r.text(value, "prBody.markdown"), host: r.text(value, "prBody.host") } };
}

export function anchorOf(r: Reader, value: unknown): Anchor {
  const kind = r.word(value, "kind", ["github", "gitlab"]);
  return kind === "github"
    ? { kind, head: r.text(value, "head") }
    : { kind, base: r.text(value, "base"), start: r.text(value, "start"), head: r.text(value, "head") };
}

export function changeOf(r: Reader, value: unknown): Change {
  return {
    number: r.int(value, "number"),
    state: r.word(value, "state", ["opened", "merged", "closed"]),
    sha: r.text(value, "sha"),
    sourceBranch: r.text(value, "sourceBranch"),
    targetBranch: r.text(value, "targetBranch"),
    labels: texts(r, value, "labels"),
    description: r.text(value, "description"),
    anchor: anchorOf(r, r.at(value, "anchor")),
  };
}

export function pipelineOf(r: Reader, value: unknown): Pipeline {
  return r.at(value, "kind") === "unknown"
    ? { kind: "unknown", raw: r.text(value, "raw") }
    : { kind: r.word(value, "kind", STATES) };
}

function personOf(r: Reader, value: unknown): Person {
  return {
    name: r.text(value, "name"),
    level: r.word(value, "level", ["maintainer", "developer", "guest"]),
    bot: r.bool(value, "bot"),
  };
}

const MERGEABLE: readonly [Mergeable, ...Mergeable[]] = ["unknown", "clean", "conflict"];

// mergeableOf : a plugin built before mergeability was on the seam (#103) sends none, which is unknown
function mergeableOf(r: Reader, value: unknown): Mergeable {
  return r.absent(value, "mergeable") ? "unknown" : r.word(value, "mergeable", MERGEABLE);
}

function openOf(r: Reader, value: unknown): OpenChange {
  return {
    number: r.int(value, "number"),
    branch: r.text(value, "branch"),
    fork: r.bool(value, "fork"),
    head: r.text(value, "head"),
    draft: r.bool(value, "draft"),
    labels: texts(r, value, "labels"),
    pipeline: pipelineOf(r, r.at(value, "pipeline")),
    mergeable: mergeableOf(r, value),
    comments: notesOf(r, r.at(value, "comments")),
  };
}

function mergedOf(r: Reader, value: unknown): MergedChange {
  return { number: r.int(value, "number"), branch: r.text(value, "branch"), fork: r.bool(value, "fork") };
}

export function changesOf(r: Reader, value: unknown): Changes {
  return {
    team: r.list(value, "team").map((p) => personOf(r, p)),
    open: r.list(value, "open").map((o) => openOf(r, o)),
    merged: r.list(value, "merged").map((m) => mergedOf(r, m)),
  };
}

export function ciConfigOf(r: Reader, value: unknown): CiConfig {
  return r.word(value, "kind", ["file", "none"]) === "file"
    ? { kind: "file", path: r.text(value, "path") }
    : { kind: "none", why: r.text(value, "why") };
}

export function statusOf(r: Reader, value: unknown): CommitStatus {
  return {
    sha: r.text(value, "sha"),
    ref: r.text(value, "ref"),
    state: r.word(value, "state", ["pending", "success", "failed"]),
    context: r.text(value, "context"),
    description: r.text(value, "description"),
  };
}

export function changeRequestOf(r: Reader, value: unknown): ChangeRequest {
  return {
    branch: r.text(value, "branch"),
    base: r.text(value, "base"),
    title: r.text(value, "title"),
    body: bodyPostOf(r, r.at(value, "body")),
  };
}

export function lineFindingOf(r: Reader, value: unknown): LineFinding {
  return { file: r.text(value, "file"), line: r.int(value, "line") };
}

// failedJobsOf : the failed jobs at a head (#171); task.ts caps what reaches the writer, whatever the plugin sends
export function failedJobsOf(r: Reader, value: unknown): readonly FailedJob[] {
  return r.list(value, "").map((j) => ({
    name: r.text(j, "name"),
    log:
      r.word(j, "log.kind", ["tail", "none"]) === "tail"
        ? { kind: "tail", text: r.text(j, "log.text") }
        : { kind: "none", why: r.text(j, "log.why") },
  }));
}

export function numbersOf(r: Reader, value: unknown): readonly number[] {
  return r.list(value, "").map((n) => r.int(n, ""));
}
