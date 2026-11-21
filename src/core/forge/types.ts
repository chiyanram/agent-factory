// types — the forge seam (ADR-0010): one interface, a GitHub and a GitLab adapter, the same shapes from both.
//
// A state the git host sends that is not in a table is "unknown", never "none". An issue method given a pull or merge
// request number fails, so nothing is written to it. removeLabel succeeds when the label is gone afterwards, even if a
// person removed it first. Every post goes through the posting template, so no free text is posted.

import type { BodyPost, Post } from "../post.js";
import type { Note } from "../notes.js";
import type { Done, Result } from "./api.js";

export type ForgeName = "github" | "gitlab";

export type PipelineState = "success" | "failed" | "running" | "canceled" | "skipped" | "manual" | "none";
export type Pipeline = { readonly kind: PipelineState } | { readonly kind: "unknown"; readonly raw: string };

export type Anchor =
  | { readonly kind: "github"; readonly head: string }
  | { readonly kind: "gitlab"; readonly base: string; readonly start: string; readonly head: string };

export type ChangeState = "opened" | "merged" | "closed";

export type BranchState = ChangeState | "none";

export type IssueState = "open" | "completed" | "not_planned" | "closed";

export type Mergeable = "clean" | "conflict" | "unknown";

export type Change = {
  readonly number: number;
  readonly state: ChangeState;
  readonly sha: string;
  readonly sourceBranch: string;
  readonly targetBranch: string;
  readonly labels: readonly string[];
  readonly description: string;
  readonly anchor: Anchor;
};

export type Level = "maintainer" | "developer" | "guest";
export type Person = { readonly name: string; readonly level: Level; readonly bot: boolean };

export type OpenChange = {
  readonly number: number;
  readonly branch: string;
  readonly fork: boolean;
  readonly head: string;
  readonly draft: boolean;
  readonly labels: readonly string[];
  readonly pipeline: Pipeline;
  readonly mergeable: Mergeable;
  readonly comments: readonly Note[];
};

export type Changes = {
  readonly team: readonly Person[];
  readonly open: readonly OpenChange[];
  readonly merged: readonly MergedChange[];
};

export type MergedChange = { readonly number: number; readonly branch: string; readonly fork: boolean };
export type Landed = { readonly at: string; readonly sha: string; readonly by: string };

export type Waiting = { readonly number: number; readonly title: string; readonly since: string };

export type LineFinding = { readonly file: string; readonly line: number };

export type CiConfig =
  | { readonly kind: "file"; readonly path: string }
  | { readonly kind: "none"; readonly why: string };

export type StatusState = "pending" | "success" | "failed";
export type JobLog = { readonly kind: "tail"; readonly text: string } | { readonly kind: "none"; readonly why: string };
export type FailedJob = { readonly name: string; readonly log: JobLog };

export type CommitStatus = {
  readonly sha: string;
  readonly ref: string;
  readonly state: StatusState;
  readonly context: string;
  readonly description: string;
};

export type ChangeRequest = {
  readonly branch: string;
  readonly base: string;
  readonly title: string;
  readonly body: BodyPost;
};

export type Forge = {
  readonly name: ForgeName;
  readonly mark: "!" | "#";
  me(): Promise<Result<string>>;
  change(input: { readonly number: number }): Promise<Result<Change>>;
  landed(input: { readonly number: number }): Promise<Result<Landed>>;
  defaultBranch(): Promise<Result<string>>;
  branchExists(input: { readonly branch: string }): Promise<Result<boolean>>;
  branchState(input: { readonly branch: string }): Promise<Result<BranchState>>;
  issueBody(input: { readonly number: number }): Promise<Result<string>>;
  issueState(input: { readonly number: number }): Promise<Result<IssueState>>;
  setIssueBody(input: { readonly number: number; readonly text: string }): Promise<Done>;
  addLabel(input: { readonly number: number; readonly label: string }): Promise<Done>;
  removeLabel(input: { readonly number: number; readonly label: string }): Promise<Done>;
  note(input: { readonly number: number; readonly post: Post }): Promise<Done>;
  setBody(input: { readonly number: number; readonly post: BodyPost }): Promise<Done>;
  notes(input: { readonly number: number }): Promise<Result<readonly Note[]>>;
  lineFinding(input: { readonly change: Change; readonly at: LineFinding; readonly post: Post }): Promise<Done>;
  status(input: CommitStatus): Promise<Done>;
  ciConfig(): Promise<Result<CiConfig>>;
  claimed(input: { readonly state: "opened" | "merged"; readonly label: string }): Promise<Result<readonly number[]>>;
  waiting(input: { readonly label: string }): Promise<Result<readonly Waiting[]>>;
  openChange(input: ChangeRequest): Promise<Result<number>>;
  changes(input: { readonly label: string }): Promise<Result<Changes>>;
  failedJobs(input: { readonly number: number; readonly head: string }): Promise<Result<readonly FailedJob[]>>;
};
