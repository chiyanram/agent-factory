// types — the shapes the writer step (step.ts) and the host's push and post (host-post.ts) both use: the step's setup,
// one run's input, what the run hands the dispatcher, and what the host prepared before the run. They live apart from
// both files, so neither imports the other.

import type { Pusher } from "../finish.js";
import type { Forge, ForgeName } from "../forge/types.js";
import type { Identity } from "../identity.js";
import type { LaneProps } from "../lane.js";
import type { Task } from "../dispatch/records.js";
import type { RunInput, WriterRan } from "../dispatch/steps.js";
import type { Spend } from "../dispatch/spend.js";
import type { BoxToken } from "../token/rules.js";
import type { Evidence } from "../report.js";
import type { Approver, Spec, SpecStore } from "../spec.js";
import type { BoxSetup } from "../ready/boxrun.js";
import type { ClaudeWriter } from "../agent/claude-writer.js";
import type { RunNamed } from "../agent/ran.js";
import type { Start } from "./clone.js";
import type { WriterSettings } from "./settings.js";

export type PushTarget = {
  readonly forge: ForgeName;
  readonly host: string;
  readonly project: string;
  readonly identity: Identity;
  readonly env: NodeJS.ProcessEnv;
};

export type WriterSetup = {
  readonly box: BoxSetup;
  readonly settings: WriterSettings;
  readonly forge: Forge;
  readonly push: PushTarget;
  readonly home: string;
  readonly project: string;
  readonly label: string;
  readonly login: () => Promise<BoxToken>;
  readonly pusher: Pusher;
  readonly programs: readonly string[];
  readonly testFiles: readonly string[];
  readonly agent: ClaudeWriter;
  readonly lanes?: readonly LaneProps[];
  readonly specs?: SpecStore;
  readonly cards?: string;
};

export type Input = RunInput & { readonly task: Task; readonly folder: string };
export type WriterOut = {
  readonly head: string;
  readonly patch: string;
  readonly evidence: readonly Evidence[];
  readonly hung: boolean;
  readonly spend?: Spend;
  readonly card?: string;
  readonly deferred?: readonly string[];
  readonly approach?: string;
  readonly open?: readonly string[];
  readonly stale?: readonly string[];
  readonly why?: string;
  readonly output?: string;
  readonly trace?: string;
  readonly runs?: readonly RunNamed[];
} & WriterRan;

export type Prepared = {
  readonly spec: Spec;
  readonly approver: Approver;
  readonly start: Start;
  readonly base: string;
  readonly login: Readonly<Record<string, string>>;
};
