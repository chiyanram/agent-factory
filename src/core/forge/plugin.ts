// plugin — the Forge interface over a forge plugin (#134 PR C; ADR-0014 P1, P2). Each method is one call of the
// pinned plugin (callPlugin: the hash checked, the capability and the write declared); its answer is read back with the
// seam's own shapes (shapes.ts), so a plugin that answers anything else fails that call and nothing downstream sees it.
// The dispatcher, the reviewer and every other caller keep the same interface, whatever forge plugin answers.

import type { Note } from "../notes.js";
import type { PluginResult } from "../plugin/contract.js";
import { callPlugin, type Setup } from "../plugin/registry.js";
import type { Done, Result } from "./api.js";
import { FORGE_OPS, type ForgeOp } from "./ops.js";
import { reader, type Reader } from "./read.js";
import { changeOf, changesOf, ciConfigOf, notesOf, numbersOf } from "./shapes.js";
import { markOf } from "./target.js";
import type { Change, Changes, CiConfig, Forge, ForgeName } from "./types.js";

export type PluginTarget = {
  readonly setup: Setup;
  readonly plugin: string;
  readonly forge: ForgeName;
  // FACTORY_PROJECT: owner/name on GitHub, the full path on GitLab; the plugin checks it again
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

function ask(target: PluginTarget, op: ForgeOp, input: object): Promise<Result<PluginResult>> {
  return callPlugin(target.setup, {
    plugin: target.plugin,
    capability: FORGE_OPS[op],
    op,
    input: { ...input, project: target.project },
  });
}

// read : a read op's value, in the shape the Forge interface says
async function read<T>(
  target: PluginTarget,
  op: ForgeOp,
  input: object,
  shape: (r: Reader, value: unknown) => T,
): Promise<Result<T>> {
  const answer = await ask(target, op, input);
  if (answer.kind === "failed") {
    return answer;
  }
  if (answer.value.kind !== "ok") {
    return failed(reasonOf(target, op, answer.value));
  }
  const r = reader(`${target.plugin} ${op}`);
  return r.done(shape(r, answer.value.fields.value));
}

// write : a write op, done or not
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

// pluginForge : the Forge that one forge plugin serves
export function pluginForge(target: PluginTarget): Forge {
  return {
    name: target.forge,
    mark: markOf(target.forge),
    me: () => read(target, "me", {}, text),
    change: (i): Promise<Result<Change>> => read(target, "change", i, changeOf),
    defaultBranch: () => read(target, "defaultBranch", {}, text),
    addLabel: (i) => written(target, "addLabel", i),
    removeLabel: (i) => written(target, "removeLabel", i),
    note: (i) => written(target, "note", i),
    notes: (i): Promise<Result<readonly Note[]>> => read(target, "notes", i, notesOf),
    lineFinding: (i) => written(target, "lineFinding", i),
    status: (i) => written(target, "status", i),
    ciConfig: (): Promise<Result<CiConfig>> => read(target, "ciConfig", {}, ciConfigOf),
    claimed: (i) => read(target, "claimed", i, numbersOf),
    openChange: (i) => opened(target, i),
    changes: (i): Promise<Result<Changes>> => read(target, "changes", i, changesOf),
  };
}
