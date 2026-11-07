// types — the forge seam (ADR-0010): one interface, a GitHub and a GitLab adapter, the same shapes from both. The
// scripts' scripts/lib/forge.sh is the bash side of the same seam; it stays until its last caller is ported (#138).

import type { Post } from "../post.js";
import type { Note } from "../notes.js";
import type { Done, Result } from "./api.js";

export type ForgeName = "github" | "gitlab";

// The pipeline of a change's head, in the factory's words. A state the forge sends that is not in the table is
// "unknown" and keeps what it said, never read as "none" (#124).
export type PipelineState = "success" | "failed" | "running" | "canceled" | "skipped" | "manual" | "none";
export type Pipeline = { readonly kind: PipelineState } | { readonly kind: "unknown"; readonly raw: string };

// Where a line finding is anchored: GitHub needs the head commit, GitLab the merge request's diff refs.
export type Anchor =
  | { readonly kind: "github"; readonly head: string }
  | { readonly kind: "gitlab"; readonly base: string; readonly start: string; readonly head: string };

export type ChangeState = "opened" | "merged" | "closed";

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

// A person's access to the project. maintainer: GitLab Maintainer or more, GitHub write access or more. developer:
// GitLab Developer. guest: any lower access. bot: a GitLab bot account (a project or group access token, a service
// account); a GitHub collaborator is always a user.
export type Level = "maintainer" | "developer" | "guest";
export type Person = { readonly name: string; readonly level: Level; readonly bot: boolean };

export type OpenChange = {
  readonly number: number;
  // the source branch: the dispatcher finds a ticket's change by it (factory/<ticket>)
  readonly branch: string;
  // the branch lives in another repository (a fork): never the factory's own change
  readonly fork: boolean;
  readonly head: string;
  readonly draft: boolean;
  readonly labels: readonly string[];
  readonly pipeline: Pipeline;
  // every comment, oldest first
  readonly comments: readonly Note[];
};

export type Changes = {
  readonly team: readonly Person[];
  readonly open: readonly OpenChange[];
  // the merged changes that still carry the claim label
  readonly merged: readonly MergedChange[];
};

export type MergedChange = { readonly number: number; readonly branch: string; readonly fork: boolean };

export type LineFinding = { readonly file: string; readonly line: number };

// The CI config file the forge runs for the project (#115): a file in this repository, or none here (GitHub reads
// .github/workflows only; a GitLab project can run a file kept in another project).
export type CiConfig =
  | { readonly kind: "file"; readonly path: string }
  | { readonly kind: "none"; readonly why: string };

// A commit status the factory posts at a head (#91): the local verifier's result, read back by poll as the pipeline.
export type StatusState = "pending" | "success" | "failed";
export type CommitStatus = {
  readonly sha: string;
  // the change's branch: GitLab ties the status to the merge request's pipeline through it
  readonly ref: string;
  readonly state: StatusState;
  // the status's name, such as agent-factory/verify
  readonly context: string;
  // one line, cut to the forge's limit
  readonly description: string;
};

// A draft change the host opens after a ticket's first push (#164). Its title and body are the factory's own words: the
// title is cleaned like any posted field, and the body goes through the posting template. The spec's text never goes
// in, because at work the spec stays local (#127).
export type ChangeRequest = {
  readonly branch: string;
  readonly base: string;
  readonly title: string;
  readonly body: Post;
};

export type Forge = {
  readonly name: ForgeName;
  // the change's prefix in every line the factory prints: ! on GitLab, # on GitHub
  readonly mark: "!" | "#";
  // the login the CLI acts as: the factory's own identity on this project
  me(): Promise<Result<string>>;
  change(input: { readonly number: number }): Promise<Result<Change>>;
  defaultBranch(): Promise<Result<string>>;
  // fails unless the forge kept the label
  addLabel(input: { readonly number: number; readonly label: string }): Promise<Done>;
  // succeeds when the label is gone afterwards, even if someone removed it first
  removeLabel(input: { readonly number: number; readonly label: string }): Promise<Done>;
  // one comment, rendered from the posting template (#126), so no free text is ever posted
  note(input: { readonly number: number; readonly post: Post }): Promise<Done>;
  // every comment, oldest first
  notes(input: { readonly number: number }): Promise<Result<readonly Note[]>>;
  // one comment at file:line on the change's head; when the forge refuses that line, an unanchored one that names it
  lineFinding(input: { readonly change: Change; readonly at: LineFinding; readonly post: Post }): Promise<Done>;
  // one commit status at a head; posting the same context again replaces it
  status(input: CommitStatus): Promise<Done>;
  // the CI config file the forge runs for this project, as the project's settings say
  ciConfig(): Promise<Result<CiConfig>>;
  // the numbers of the changes in that state that carry the label
  claimed(input: { readonly state: "opened" | "merged"; readonly label: string }): Promise<Result<readonly number[]>>;
  // the change open from this branch of the repository itself, or a new draft one; two or more fail, so a person decides
  openChange(input: ChangeRequest): Promise<Result<number>>;
  // everything poll decides on, in as few calls as paging allows
  changes(input: { readonly label: string }): Promise<Result<Changes>>;
};
