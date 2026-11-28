// host-post — the host's push and post once a writer run ends (ADR-0012 S3, S13). On an open change it pushes on top
// (finish.ts) and shows the run's PR body, or a cleanup run's deferred items, on the change; on a first run it pushes,
// opens the draft change, claims it and keeps the PR body under the change's records. A run that added no
// commit pushes nothing. It also turns what the run ended with into what the step hands the dispatcher (outOf), and
// hands a task the host cannot read to a person on the open change (handOver).

import { finishFirst, finishRun, fastForwardOnly, seatOnEvery, type Next } from "../finish.js";
import type { Done, Result } from "../forge/api.js";
import type { PushRequest } from "../push.js";
import { CLEAN, type Outcome } from "../report.js";
import type { BodyPost, PrBody } from "../post.js";
import { keepText, readKept, recordsDirOf } from "../kept.js";
import type { Clone } from "./clone.js";
import type { FailedSpent, Spend } from "../dispatch/spend.js";
import type { WriterRan } from "../dispatch/steps.js";
import type { BlockedReason, EndReason } from "../end-reason.js";
import type { Ended } from "./run.js";
import { whyOf, whyText, withSaid } from "./why.js";
import { ROLE_OF, type RunMode } from "./prompt.js";
import type { Input, Prepared, WriterOut, WriterSetup } from "./types.js";

type Notes = Pick<WriterOut, "deferred" | "approach" | "open">;

function notesOf(outcome: Outcome): Notes {
  if (outcome.kind !== "done") {
    return {};
  }
  const { deferred, approach, open } = outcome;
  return {
    ...(deferred === undefined ? {} : { deferred }),
    ...(approach === undefined ? {} : { approach }),
    ...(open === undefined ? {} : { open }),
  };
}

function whyField(why: string): { readonly why?: string } {
  return why === "" ? {} : { why };
}

function nextWhy(ended: Ended, next: Extract<Next, { kind: "needs-human" }>): string {
  const host = ended.outcome.kind !== "blocked" || ended.outcome.by === "host";
  return whyText(withSaid(next.reason, host && ended.outcome.kind !== "done" ? ended.said : ""));
}

function spendField(spend: Spend | "unmeasured"): { readonly spend?: Spend } {
  return spend === "unmeasured" ? {} : { spend };
}

function traceField(trace: string | undefined): { readonly trace?: string } {
  return trace === undefined ? {} : { trace };
}

export function outOf(ended: Ended, next: Next): WriterOut {
  const base = {
    head: ended.tip,
    patch: ended.patch,
    hung: ended.ending.kind === "hung",
    ...spendField(ended.spend),
    ...notesOf(ended.outcome),
    ...traceField(ended.trace),
  };
  switch (next.kind) {
    case "ready-check":
      return { ...base, outcome: "done", reason: "done", evidence: next.evidence };
    case "wait-for-answer":
      return { ...base, ...ASKED, evidence: [], ...whyField(whyOf(ended.outcome, ended.said)) };
    case "needs-human":
      return { ...base, ...blockedEnd(ended.reason), evidence: [], ...whyField(nextWhy(ended, next)) };
    case "parked":
      return { ...base, head: next.head, ...ranOf(ended.outcome, ended.reason), evidence: [] };
  }
}

const ASKED = { outcome: "asked", reason: "asked" } as const;

function blockedEnd(reason: EndReason): { readonly outcome: "blocked"; readonly reason: BlockedReason } {
  return { outcome: "blocked", reason: reason === "usage_limit" ? "unknown" : reason };
}

function ranOf(outcome: Outcome, reason: EndReason): WriterRan {
  switch (outcome.kind) {
    case "done":
      return { outcome: "done", reason: "done" };
    case "asked":
      return ASKED;
    case "blocked":
      return blockedEnd(reason);
    case "parked":
      return { outcome: "parked", reason: "usage_limit", ...parkedField(outcome) };
  }
}

function parkedField(outcome: Outcome): { readonly parked?: { readonly until: string; readonly said: string } } {
  return outcome.kind === "parked" ? { parked: { until: outcome.until, said: whyText(outcome.said) } } : {};
}

function pushOf(setup: WriterSetup, p: Prepared, clone: Clone, tip: string): PushRequest {
  return {
    ...setup.push,
    repo: clone.repo,
    branch: clone.branch,
    commit: tip,
    lease: p.start.kind === "branch" ? { kind: "sha", sha: clone.start } : { kind: "absent" },
    protectedBranches: [p.base],
    guards: [fastForwardOnly(setup.push.env), seatOnEvery(setup.push.env, { since: clone.start, seat: "writer" })],
  };
}

export function bodyOf(
  p: Pick<Prepared, "spec" | "approver">,
  deferred: readonly string[] = [],
  prBody?: PrBody,
): BodyPost {
  return {
    ...(prBody === undefined ? {} : { prBody }),
    seat: "coordinator",
    title: p.spec.title,
    fields: [
      { label: "spec", value: p.spec.hash },
      { label: p.approver.said ?? "approved", value: `locally by ${p.approver.by} at ${p.approver.at}` },
    ],
    items: deferred.map((d) => `deferred by the cleanup run: ${d}`),
  };
}

function openFor(
  setup: WriterSetup,
  p: Prepared,
  branch: string,
  prBody: PrBody | undefined,
): () => Promise<Result<number>> {
  return async () => {
    const { title } = p.spec;
    const opened = await setup.forge.openChange({ branch, base: p.base, title, body: bodyOf(p, [], prBody) });
    if (opened.kind === "failed") {
      return opened;
    }
    const claimed = await setup.forge.addLabel({ number: opened.value, label: setup.label });
    return claimed.kind === "ok" ? opened : claimed;
  };
}

async function onChange(
  setup: WriterSetup,
  input: Input,
  p: Prepared,
  run: { readonly push: PushRequest; readonly ended: Ended; readonly number: number; readonly mode: RunMode },
): Promise<Result<WriterOut>> {
  const { ended, number } = run;
  const next = await finishRun({
    outcome: ended.outcome,
    ending: ended.ending,
    change: number,
    forge: setup.forge,
    push: run.push,
    pusher: setup.pusher,
    questions: setup.settings.questions,
  });
  if (next.kind === "failed") {
    return next;
  }
  const shown =
    run.mode === "cleanup"
      ? await deferredShown(setup, input, p, number, ended.outcome)
      : await prBodyShown(setup, p, { number, mode: run.mode, ended });
  return shown.kind === "ok" ? { kind: "ok", value: outOf(ended, next.value) } : shown;
}

export async function finished(
  setup: WriterSetup,
  input: Input,
  p: Prepared,
  run: { readonly clone: Clone; readonly ended: Ended; readonly mode: RunMode },
): Promise<Result<WriterOut>> {
  const { clone, ended, mode } = run;
  const push = pushOf(setup, p, clone, ended.tip);
  const { outcome } = ended;
  if (input.change.kind === "open") {
    return onChange(setup, input, p, { push, ended, number: input.change.line.number, mode });
  }
  if (ended.tip === clone.start) {
    return {
      kind: "ok",
      value: {
        head: ended.tip,
        ...ranOf(outcome, ended.reason),
        patch: "",
        evidence: [],
        hung: ended.ending.kind === "hung",
        ...spendField(ended.spend),
        ...whyField(whyOf(outcome, ended.said)),
        ...traceField(ended.trace),
      },
    };
  }
  const first = await finishFirst({
    outcome,
    ending: ended.ending,
    forge: setup.forge,
    push,
    pusher: setup.pusher,
    questions: setup.settings.questions,
    open: openFor(setup, p, clone.branch, prBodyOf(setup, mode, ended)),
  });
  if (first.kind === "failed") {
    return first;
  }
  const kept = await prBodyKept(setup, { number: first.value.change, mode, ended });
  return kept.kind === "ok" ? { kind: "ok", value: outOf(ended, first.value.next) } : kept;
}

export const PR_BODY_KEPT = "pr.md";

function prBodyOf(setup: WriterSetup, mode: RunMode, ended: Ended): PrBody | undefined {
  return ROLE_OF[mode] === "implementer" && ended.pr !== undefined
    ? { markdown: ended.pr, host: setup.push.host }
    : undefined;
}

type Wrote = { readonly number: number; readonly mode: RunMode; readonly ended: Ended };

async function prBodyKept(setup: WriterSetup, run: Wrote): Promise<Done> {
  const body = prBodyOf(setup, run.mode, run.ended);
  if (body === undefined) {
    return { kind: "ok" };
  }
  const at = { recordsDir: recordsDirOf(setup.box.repo), change: run.number, head: run.ended.tip };
  const kept = await keepText(at, PR_BODY_KEPT, body.markdown);
  return kept.kind === "ok" ? { kind: "ok" } : kept;
}

async function prBodyShown(setup: WriterSetup, p: Prepared, run: Wrote): Promise<Done> {
  const body = prBodyOf(setup, run.mode, run.ended);
  if (body === undefined) {
    return { kind: "ok" };
  }
  const set = await setup.forge.setBody({ number: run.number, post: bodyOf(p, [], body) });
  return set.kind === "ok"
    ? prBodyKept(setup, run)
    : { kind: "failed", reason: `the PR body was not set: ${set.reason}` };
}

async function keptPrBody(setup: WriterSetup, number: number, head: string): Promise<PrBody | undefined> {
  const kept = await readKept({ recordsDir: recordsDirOf(setup.box.repo), change: number, head }, PR_BODY_KEPT);
  return kept.kind === "ok" ? { markdown: kept.value, host: setup.push.host } : undefined;
}

async function deferredShown(
  setup: WriterSetup,
  input: Input,
  p: Prepared,
  number: number,
  outcome: Outcome,
): Promise<Done> {
  if (input.task.kind !== "cleanup" || outcome.kind !== "done") {
    return { kind: "ok" };
  }
  const kept = await keptPrBody(setup, number, input.task.head);
  const set = await setup.forge.setBody({ number, post: bodyOf(p, outcome.deferred, kept) });
  return set.kind === "ok" ? set : { kind: "failed", reason: `the PR body was not set: ${set.reason}` };
}

export async function handOver(
  setup: WriterSetup,
  input: Input,
  reason: string,
): Promise<Result<WriterOut> | FailedSpent> {
  if (input.change.kind !== "open") {
    return beforeBox({ kind: "failed", reason: `${reason}; and there is no open change to say so on` });
  }
  const outcome: Outcome = { kind: "blocked", reason, by: "host" };
  const head = input.change.line.head;
  const next = await finishRun({
    outcome,
    ending: CLEAN,
    change: input.change.line.number,
    forge: setup.forge,
    push: {
      ...setup.push,
      repo: setup.box.repo,
      branch: input.change.line.branch,
      commit: head,
      lease: { kind: "sha", sha: head },
      protectedBranches: [],
      guards: [],
    },
  });
  return next.kind === "ok"
    ? { kind: "ok", value: { head, outcome: "blocked", patch: "", evidence: [], hung: false, reason: "setup_refused" } }
    : beforeBox(next);
}

export function beforeBox(failed: { readonly kind: "failed"; readonly reason: string }): FailedSpent {
  return { kind: "failed", reason: failed.reason, end: "setup_refused" };
}
