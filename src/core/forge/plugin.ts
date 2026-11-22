// plugin — the Forge interface over a forge plugin (#134 PR C; ADR-0014 P1, P2). Each method is one call of the
// pinned plugin (callPlugin: the hash checked, the capability and the write declared); its answer is read back with the
// seam's own shapes (shapes.ts), so a plugin that answers anything else fails that call and nothing downstream sees it.
// The dispatcher, the reviewer and every other caller keep the same interface, whatever forge plugin answers.
// A protocol 1 plugin may leave out an open change's mergeable and answer the waiting read unsupported; asProtocolTwo
// reads that answer as unknown and as no waiting issue, and a protocol 2 answer that does either fails.
//
// A post is cleaned before it leaves for a plugin, so a plugin gets no secret and no model text that cleanBody has not
// seen.

import type { Note } from "../notes.js";
import type { PluginResult } from "../plugin/contract.js";
import { callPlugin, type Called, type Setup } from "../plugin/registry.js";
import type { Limits } from "../plugin/exec.js";
import { MAX_WAIT, type Done, type Result } from "./api.js";
import { FORGE_OPS, type ForgeOp } from "./ops.js";
import { reader, type Reader } from "./read.js";
import { changeOf, changesOf, ciConfigOf, failedJobsOf, notesOf, numbersOf, waitingOf } from "./shapes.js";
import { markOf } from "./target.js";
import type { BodyPost } from "../post.js";
import { cleanBody } from "../pr-body.js";
import { scrubSecrets } from "../scrub.js";
import type { BranchState, Change, Changes, CiConfig, FailedJob, Forge, ForgeName, Landed, Waiting } from "./types.js";

export type PluginTarget = {
  readonly setup: Setup;
  readonly plugin: string;
  readonly forge: ForgeName;
  readonly project: string;
};

function failed(reason: string): { readonly kind: "failed"; readonly reason: string } {
  return { kind: "failed", reason };
}

function reasonOf(target: PluginTarget, op: string, answer: PluginResult): string {
  const why = typeof answer.fields.reason === "string" ? `: ${answer.fields.reason}` : "";
  return answer.kind === "failed"
    ? `${target.plugin} ${op}${why}`
    : `${target.plugin} ${op} answered ${answer.kind}${why}`;
}

export const FORGE_LIMITS: Limits = { timeoutMs: (MAX_WAIT * 4 + 120) * 1000, maxBytes: 64 * 1024 * 1024 };

function ask(target: PluginTarget, op: ForgeOp, input: object): Promise<Result<Called>> {
  return callPlugin(
    { ...target.setup, limits: target.setup.limits ?? FORGE_LIMITS },
    {
      plugin: target.plugin,
      capability: FORGE_OPS[op],
      op,
      input: { ...input, project: target.project, forge: target.forge },
    },
  );
}

function withMergeable(open: unknown): unknown {
  return typeof open === "object" && open !== null && !("mergeable" in open) ? { ...open, mergeable: "unknown" } : open;
}

function openAsTwo(value: unknown): unknown {
  if (typeof value !== "object" || value === null || !("open" in value) || !Array.isArray(value.open)) {
    return value;
  }
  return { ...value, open: value.open.map(withMergeable) };
}

const PROTOCOL_ONE: Partial<Record<ForgeOp, (answer: PluginResult) => PluginResult>> = {
  waiting: (answer) => (answer.kind === "unsupported" ? { kind: "ok", fields: { value: [] } } : answer),
  changes: (answer) =>
    answer.kind === "ok" ? { ...answer, fields: { ...answer.fields, value: openAsTwo(answer.fields.value) } } : answer,
};

function asProtocolTwo(op: ForgeOp, answer: Called): PluginResult {
  const one = PROTOCOL_ONE[op];
  return answer.protocol === 1 && one !== undefined ? one(answer) : answer;
}

async function read<T>(
  target: PluginTarget,
  op: ForgeOp,
  input: object,
  shape: (r: Reader, value: unknown) => T,
): Promise<Result<T>> {
  const asked = await ask(target, op, input);
  if (asked.kind === "failed") {
    return asked;
  }
  const answer = asProtocolTwo(op, asked.value);
  if (answer.kind !== "ok") {
    return failed(reasonOf(target, op, answer));
  }
  const r = reader(`${target.plugin} ${op}`);
  return r.done(shape(r, answer.fields.value));
}

async function write(target: PluginTarget, op: ForgeOp, input: object): Promise<Result<unknown>> {
  const answer = await ask(target, op, input);
  if (answer.kind === "failed") {
    return answer;
  }
  return answer.value.kind === "done"
    ? { kind: "ok", value: answer.value.fields.value }
    : failed(reasonOf(target, op, answer.value));
}

async function written(target: PluginTarget, op: ForgeOp, input: object): Promise<Done> {
  const done = await write(target, op, input);
  return done.kind === "ok" ? { kind: "ok" } : done;
}

const text = (r: Reader, v: unknown): string => r.text(v, "");

async function opened(target: PluginTarget, input: object): Promise<Result<number>> {
  const done = await write(target, "openChange", input);
  if (done.kind === "failed") {
    return done;
  }
  const r = reader(`${target.plugin} openChange`);
  return r.done(r.int(done.value, ""));
}

export function cleanedPost<P extends BodyPost>(post: P): P {
  const scrubbed = {
    ...post,
    title: scrubSecrets(post.title),
    fields: post.fields.map((f) => ({ ...f, value: scrubSecrets(f.value) })),
    items: post.items.map(scrubSecrets),
  };
  return post.prBody === undefined
    ? scrubbed
    : {
        ...scrubbed,
        prBody: { ...post.prBody, markdown: cleanBody(post.prBody.markdown, { host: post.prBody.host }) },
      };
}

function landedOf(r: Reader, v: unknown): Landed {
  return { at: r.text(v, "at"), sha: r.text(v, "sha"), by: r.text(v, "by") };
}

function branchStateRead(r: Reader, v: unknown): BranchState {
  return r.word(v, "", ["none", "merged", "opened", "closed"]);
}

export function pluginForge(target: PluginTarget): Forge {
  return {
    name: target.forge,
    mark: markOf(target.forge),
    me: () => read(target, "me", {}, text),
    change: (i): Promise<Result<Change>> => read(target, "change", i, changeOf),
    landed: (i): Promise<Result<Landed>> => read(target, "landed", i, landedOf),
    defaultBranch: () => read(target, "defaultBranch", {}, text),
    branchExists: (i) => read(target, "branchExists", i, (r, v) => r.bool(v, "")),
    branchState: (i) => read(target, "branchState", i, branchStateRead),
    issueBody: (i) => read(target, "issueBody", i, text),
    issueState: (i) =>
      read(target, "issueState", i, (r, v) => r.word(v, "", ["open", "completed", "not_planned", "closed"])),
    addLabel: (i) => written(target, "addLabel", i),
    removeLabel: (i) => written(target, "removeLabel", i),
    note: (i) => written(target, "note", { ...i, post: cleanedPost(i.post) }),
    setBody: (i) => written(target, "setBody", { ...i, post: cleanedPost(i.post) }),
    setIssueBody: (i) => written(target, "setIssueBody", i),
    notes: (i): Promise<Result<readonly Note[]>> => read(target, "notes", i, notesOf),
    lineFinding: (i) => written(target, "lineFinding", { ...i, post: cleanedPost(i.post) }),
    status: (i) => written(target, "status", i),
    ciConfig: (): Promise<Result<CiConfig>> => read(target, "ciConfig", {}, ciConfigOf),
    claimed: (i) => read(target, "claimed", i, numbersOf),
    waiting: (i): Promise<Result<readonly Waiting[]>> => read(target, "waiting", i, waitingOf),
    openChange: (i) => opened(target, { ...i, title: scrubSecrets(i.title), body: cleanedPost(i.body) }),
    changes: (i): Promise<Result<Changes>> => read(target, "changes", i, changesOf),
    failedJobs: (i): Promise<Result<readonly FailedJob[]>> => read(target, "failedJobs", i, failedJobsOf),
  };
}
