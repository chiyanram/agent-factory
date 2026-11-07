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
// GitLab Developer. guest: any lower access.
export type Level = "maintainer" | "developer" | "guest";
export type Person = { readonly name: string; readonly level: Level };

export type OpenChange = {
  readonly number: number;
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
  readonly merged: readonly number[];
};

export type LineFinding = { readonly file: string; readonly line: number };

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
  // the numbers of the changes in that state that carry the label
  claimed(input: { readonly state: "opened" | "merged"; readonly label: string }): Promise<Result<readonly number[]>>;
  // everything poll decides on, in as few calls as paging allows
  changes(input: { readonly label: string }): Promise<Result<Changes>>;
};
