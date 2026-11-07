// round — one review round on a claimed change: pack → find → verify → post (#22; ported from start-reviewer.sh, #138).
//
//   1 The rounds so far come from the factory's own summary notes (history.ts). A head already reviewed is left alone.
//   2 The context pack for the head; from round 2, the interdiff since the last reviewed head (pack.ts). The same
//     patch-id as the last round reuses its verdict, with no model run; when that verdict still has Act on findings the
//     writer made no progress, and the change goes to the human (ADR-0011 D14). An empty change goes there too.
//   3 After 3 rounds the change goes to the human (#22 Q5).
//   4 FIND, then VERIFY once per kind (rule findings on one model, logic on another), each a fresh read-only run in a
//     folder that holds only the pack and the code with every rule file removed (code.ts, model.ts).
//   5 Before anything is posted, the head must still be the reviewed one; else MOVED, and nothing is posted.
//   6 One thread per Act on and Consider finding at its file:line; then the status box (status.ts) labels needs-human for
//     a protected file not listed before; then one summary note, last, since it marks the round done: a round that
//     failed halfway runs again. No verdict ever approves or undrafts, and zero findings is not a pass (#118).

import { appendFile, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Done, Result } from "../forge/api.js";
import type { Change, Forge } from "../forge/types.js";
import { hostGit } from "../git.js";
import type { Post } from "../post.js";
import { copyCode } from "./code.js";
import { history, protectedLine, type History } from "./history.js";
import { prop } from "../dispatch/records.js";
import type { Model, ModelAnswer } from "./model.js";
import { buildPack, type Pack } from "./pack.js";
import { statusBox, type Box } from "./status.js";
import {
  BUCKET_NAMES,
  counts,
  countsLine,
  FIND_SCHEMA,
  readFindings,
  readVerdicts,
  sortFindings,
  VERIFY_SCHEMA,
  type Counts,
  type Finding,
  type Sorted,
  type Verdict,
} from "./verdicts.js";

export const NEEDS_HUMAN = "needs-human";
export const MAX_ROUNDS = 3;

export type ReviewSetup = {
  readonly forge: Forge;
  readonly number: number;
  // the login the factory posts as: its notes are the rounds
  readonly factory: string;
  readonly label: string;
  readonly repo: string;
  readonly env: NodeJS.ProcessEnv;
  readonly rulebook: string;
  readonly packDir: string;
  // where each pass's answer is kept, per change and head (ADR-0011 D16)
  readonly recordsDir: string;
  readonly tmpDir: string;
  readonly prompts: { readonly find: string; readonly verify: string };
  readonly models: { readonly find: string; readonly rule: string; readonly logic: string };
  readonly maxUsd: string;
  readonly model: Model;
};

export type Outcome =
  | {
      readonly kind: "posted";
      readonly round: number;
      readonly head: string;
      readonly counts: Counts;
      readonly costUsd: number;
    }
  | { readonly kind: "reused"; readonly round: number; readonly head: string; readonly actOn: number }
  | { readonly kind: "already"; readonly head: string; readonly actOn: number }
  | { readonly kind: "no-progress"; readonly head: string; readonly why: string }
  | { readonly kind: "moved"; readonly from: string; readonly to: string };

type Ctx = { readonly setup: ReviewSetup; readonly change: Change; readonly past: History };

function failed(reason: string): { readonly kind: "failed"; readonly reason: string } {
  return { kind: "failed", reason };
}

// load : the change, open and claimed, and the rounds so far
async function load(setup: ReviewSetup): Promise<Result<Ctx>> {
  const change = await setup.forge.change({ number: setup.number });
  if (change.kind === "failed") {
    return change;
  }
  if (change.value.state !== "opened" || !change.value.labels.includes(setup.label)) {
    return failed(
      `${setup.forge.mark}${setup.number} is not an open change carrying ${setup.label}; claim it first, so it gets one run at a time`,
    );
  }
  const notes = await setup.forge.notes({ number: setup.number });
  return notes.kind === "ok"
    ? {
        kind: "ok",
        value: { setup, change: change.value, past: history({ notes: notes.value, factory: setup.factory }) },
      }
    : notes;
}

async function defaultBranch(ctx: Ctx): Promise<Result<string>> {
  return ctx.setup.forge.defaultBranch();
}

async function packFor(ctx: Ctx): Promise<Result<Pack>> {
  const branch = await defaultBranch(ctx);
  if (branch.kind === "failed") {
    return branch;
  }
  const last = ctx.past.last;
  const s = ctx.setup;
  return buildPack({
    repo: s.repo,
    env: s.env,
    change: ctx.change,
    defaultBranch: branch.value,
    rulebook: s.rulebook,
    previous: last.kind === "round" ? { kind: "head", sha: last.head } : { kind: "none" },
    dir: s.packDir,
    mark: s.forge.mark,
  });
}

type Now = { readonly kind: "same" } | { readonly kind: "moved"; readonly to: string };

// moved : whether the forge's head is still the reviewed one
async function moved(ctx: Ctx): Promise<Result<Now>> {
  const now = await ctx.setup.forge.change({ number: ctx.setup.number });
  if (now.kind === "failed") {
    return now;
  }
  return {
    kind: "ok",
    value: now.value.sha === ctx.change.sha ? { kind: "same" } : { kind: "moved", to: now.value.sha },
  };
}

function note(ctx: Ctx, title: string, items: readonly string[] = [], fields: Post["fields"] = []): Promise<Done> {
  return ctx.setup.forge.note({ number: ctx.setup.number, post: { seat: "reviewer", title, fields, items } });
}

function label(ctx: Ctx): Promise<Done> {
  return ctx.setup.forge.addLabel({ number: ctx.setup.number, label: NEEDS_HUMAN });
}

async function guarded(ctx: Ctx, act: () => Promise<Result<Outcome>>): Promise<Result<Outcome>> {
  const now = await moved(ctx);
  if (now.kind === "failed") {
    return now;
  }
  return now.value.kind === "same"
    ? act()
    : { kind: "ok", value: { kind: "moved", from: ctx.change.sha, to: now.value.to } };
}

// noProgress : an empty change goes to the human; the label goes before any note, so a failed label is retried
async function empty(ctx: Ctx): Promise<Result<Outcome>> {
  const labelled = await label(ctx);
  return labelled.kind === "ok"
    ? { kind: "ok", value: { kind: "no-progress", head: ctx.change.sha, why: "the change is empty" } }
    : labelled;
}

// reuseNote : needs-human first when Act on findings are still open, then the reuse line
async function reuseNote(ctx: Ctx, pack: Pack, round: number, actOn: number): Promise<Done> {
  const labelled = actOn > 0 ? await label(ctx) : ({ kind: "ok" } as const);
  return labelled.kind === "ok"
    ? note(ctx, `round ${round} reused · head ${pack.head} · patch-id ${pack.patchId}`)
    : labelled;
}

// reuse : the same patch as the last round; its verdict stands, and Act on findings mean no progress
async function reuse(ctx: Ctx, pack: Pack, round: number): Promise<Result<Outcome>> {
  const actOn = ctx.past.actOn.get(pack.patchId) ?? 0;
  const posted = await reuseNote(ctx, pack, round, actOn);
  if (posted.kind === "failed") {
    return posted;
  }
  return actOn > 0
    ? {
        kind: "ok",
        value: {
          kind: "no-progress",
          head: pack.head,
          why: `the patch is unchanged since round ${round} with ${actOn} Act on open`,
        },
      }
    : { kind: "ok", value: { kind: "reused", round, head: pack.head, actOn } };
}

type Pass = { readonly name: string; readonly model: string; readonly schema: string; readonly prompt: string };

async function keep(ctx: Ctx, pass: string, answer: unknown): Promise<void> {
  const dir = join(ctx.setup.recordsDir, String(ctx.setup.number), ctx.change.sha);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await appendFile(
    join(dir, `reviewer-${pass.replace(/[^a-z]+/g, "-").replace(/-$/, "")}.jsonl`),
    `${JSON.stringify(answer)}\n`,
    { mode: 0o600 },
  );
}

async function runPass(ctx: Ctx, folder: string, pass: Pass): Promise<Result<ModelAnswer>> {
  const prompt = await readFile(pass.prompt, "utf8").catch(() => "");
  if (prompt === "") {
    return failed(`the review instructions are missing: ${pass.prompt}`);
  }
  const ran = await ctx.setup.model({
    folder,
    model: pass.model,
    schema: pass.schema,
    prompt,
    name: `reviewer-${ctx.setup.number}`,
    maxUsd: ctx.setup.maxUsd,
  });
  // every answer that spent tokens is kept, a failed pass too, so the retro sees what was spent
  const spent = ran.kind === "ok" ? ran.value.answer : ran.answer;
  if (prop(spent, "usage") !== undefined) {
    await keep(ctx, pass.name, spent);
  }
  return ran.kind === "ok"
    ? ran
    : failed(`${ctx.setup.forge.mark}${ctx.setup.number}: the ${pass.name} pass failed: ${ran.reason}`);
}

type Spent = { readonly costUsd: number; readonly find: number; readonly verify: number };

type Checked = { readonly verdicts: readonly Verdict[]; readonly answer: ModelAnswer | "none" };

async function verifySubset(
  ctx: Ctx,
  folder: string,
  subset: readonly Finding[],
  kind: "rule" | "logic",
): Promise<Result<Checked>> {
  await writeFile(join(folder, "findings.json"), JSON.stringify(subset));
  const model = kind === "rule" ? ctx.setup.models.rule : ctx.setup.models.logic;
  const ran = await runPass(ctx, folder, {
    name: `verify (${kind})`,
    model,
    schema: VERIFY_SCHEMA,
    prompt: ctx.setup.prompts.verify,
  });
  if (ran.kind === "failed") {
    return ran;
  }
  const read = readVerdicts(ran.value.output);
  return read.kind === "ok" ? { kind: "ok", value: { verdicts: read.value, answer: ran.value } } : read;
}

// verifyKind : one verify pass over the findings of one kind; none when there are none
async function verifyKind(
  ctx: Ctx,
  folder: string,
  findings: readonly Finding[],
  kind: "rule" | "logic",
): Promise<Result<Checked>> {
  const subset = findings.filter((f) => f.kind === kind);
  return subset.length === 0
    ? { kind: "ok", value: { verdicts: [], answer: "none" } }
    : verifySubset(ctx, folder, subset, kind);
}

function spentOf(found: ModelAnswer, verified: readonly (ModelAnswer | "none")[]): Spent {
  const answers = verified.filter((a): a is ModelAnswer => a !== "none");
  return {
    costUsd: found.costUsd + answers.reduce((s, a) => s + a.costUsd, 0),
    find: found.tokens,
    verify: answers.reduce((s, a) => s + a.tokens, 0),
  };
}

async function verifyAll(
  ctx: Ctx,
  folder: string,
  found: ModelAnswer,
  findings: readonly Finding[],
): Promise<Result<{ readonly sorted: readonly Sorted[]; readonly spent: Spent }>> {
  const rule = await verifyKind(ctx, folder, findings, "rule");
  const logic = rule.kind === "ok" ? await verifyKind(ctx, folder, findings, "logic") : rule;
  if (rule.kind === "failed" || logic.kind === "failed") {
    return logic.kind === "failed" ? logic : failed("the verify pass failed");
  }
  return {
    kind: "ok",
    value: {
      sorted: sortFindings(findings, [...rule.value.verdicts, ...logic.value.verdicts]),
      spent: spentOf(found, [rule.value.answer, logic.value.answer]),
    },
  };
}

type Reviewed = { readonly sorted: readonly Sorted[]; readonly spent: Spent };

async function findAndVerify(ctx: Ctx, run: string, pack: Pack): Promise<Result<Reviewed>> {
  const copied = await copyCode({ repo: ctx.setup.repo, sha: pack.head, into: join(run, "code"), env: ctx.setup.env });
  if (copied.kind === "failed") {
    return copied;
  }
  await copyFile(pack.path, join(run, "pack.md"));
  const found = await runPass(ctx, run, {
    name: "find",
    model: ctx.setup.models.find,
    schema: FIND_SCHEMA,
    prompt: ctx.setup.prompts.find,
  });
  if (found.kind === "failed") {
    return found;
  }
  const findings = readFindings(found.value.output);
  return findings.kind === "ok" ? verifyAll(ctx, run, found.value, findings.value) : findings;
}

// passes : find, then verify per kind, in a fresh folder with the pack and the code at the head; the folder goes after
async function passes(ctx: Ctx, pack: Pack): Promise<Result<Reviewed>> {
  const run = await mkdtemp(join(ctx.setup.tmpDir, "factory-review-"));
  try {
    return await findAndVerify(ctx, run, pack);
  } finally {
    await rm(run, { recursive: true, force: true });
  }
}

function threadPost(f: Sorted): Post {
  return {
    seat: "reviewer",
    title: `${BUCKET_NAMES[f.bucket]} ${f.id} (${f.severity}, ${f.rule}): ${f.finding}`,
    fields: [{ label: "Fix", value: f.fix }],
    items: [],
  };
}

async function threads(ctx: Ctx, sorted: readonly Sorted[]): Promise<Done> {
  for (const f of sorted.filter((x) => x.bucket === "act_on" || x.bucket === "consider")) {
    const posted = await ctx.setup.forge.lineFinding({
      change: ctx.change,
      at: { file: f.file, line: f.line },
      post: threadPost(f),
    });
    if (posted.kind === "failed") {
      return posted;
    }
  }
  return { kind: "ok" };
}

async function show(ctx: Ctx, rev: string, path: string): Promise<string> {
  const shown = await hostGit({
    args: ["show", `${rev}:${path}`],
    repo: { kind: "repo", path: ctx.setup.repo },
    env: ctx.setup.env,
    ownHelper: { kind: "none" },
    stdin: { kind: "none" },
  });
  return shown.kind === "ok" ? shown.stdout : "";
}

async function boxFor(ctx: Ctx, pack: Pack): Promise<Result<Box>> {
  const names = await hostGit({
    args: ["diff", "--name-only", "--no-renames", "-z", pack.base, pack.head],
    repo: { kind: "repo", path: ctx.setup.repo },
    env: ctx.setup.env,
    ownHelper: { kind: "none" },
    stdin: { kind: "none" },
  });
  if (names.kind !== "ok") {
    return failed(
      `cannot list the files the change touches: ${names.kind === "refused" ? names.reason : names.stderr.trim()}`,
    );
  }
  const touched = names.stdout.split("\u0000").filter((f) => f !== "");
  return statusBox({ touched, before: (p) => show(ctx, pack.base, p), after: (p) => show(ctx, pack.head, p) });
}

function findingLines(sorted: readonly Sorted[], axis: "standards" | "spec", name: string): readonly string[] {
  const mine = sorted.filter((f) => f.axis === axis);
  return mine.length === 0
    ? [`${name} · none`]
    : mine.map(
        (f) => `${name} · ${BUCKET_NAMES[f.bucket]} ${f.id} ${f.file}:${f.line} ${f.rule}: ${f.finding} (${f.why})`,
      );
}

function boxLines(box: Box): readonly string[] {
  return [
    ...box.protected.map((p) => `Protected · ${p}`),
    ...box.build.map((p) => `Build · ${p}`),
    ...box.added.map((d) => `New dependency · ${d}`),
  ];
}

function summaryItems(sorted: readonly Sorted[], box: Box): readonly string[] {
  const zero =
    sorted.length === 0 ? ["No findings. That is not a pass: the human still reviews before merge (ADR-0012 S10)"] : [];
  return [
    ...zero,
    ...findingLines(sorted, "standards", "Standards"),
    ...findingLines(sorted, "spec", "Spec"),
    ...boxLines(box),
  ];
}

// the protected files no earlier round listed: only these label the change, so a person who cleared needs-human is not
// stopped again for the same file
function freshProtected(ctx: Ctx, box: Box): readonly string[] {
  return box.protected.filter((p) => !ctx.past.listed.has(protectedLine(p)));
}

// threadsAndLabel : the threads, then needs-human for a protected file not listed before
async function threadsAndLabel(ctx: Ctx, box: Box, sorted: readonly Sorted[]): Promise<Done> {
  const posted = await threads(ctx, sorted);
  return posted.kind === "ok" && freshProtected(ctx, box).length > 0 ? label(ctx) : posted;
}

async function post(
  ctx: Ctx,
  pack: Pack,
  result: { readonly sorted: readonly Sorted[]; readonly spent: Spent },
): Promise<Result<Outcome>> {
  const box = await boxFor(ctx, pack);
  if (box.kind === "failed") {
    return box;
  }
  const labelled = await threadsAndLabel(ctx, box.value, result.sorted);
  if (labelled.kind === "failed") {
    return labelled;
  }
  const round = ctx.past.rounds + 1;
  const c = counts(result.sorted);
  const spent = `$${result.spent.costUsd.toFixed(2)} · find ${result.spent.find} tokens · verify ${result.spent.verify} tokens`;
  const summary = await note(
    ctx,
    `round ${round} · head ${pack.head} · patch-id ${pack.patchId} · ${countsLine(c)}`,
    summaryItems(result.sorted, box.value),
    [{ label: "Spent at this head", value: spent }],
  );
  return summary.kind === "ok"
    ? { kind: "ok", value: { kind: "posted", round, head: pack.head, counts: c, costUsd: result.spent.costUsd } }
    : summary;
}

async function review(ctx: Ctx, pack: Pack): Promise<Result<Outcome>> {
  if (ctx.past.rounds >= MAX_ROUNDS) {
    return failed(
      `${ctx.setup.forge.mark}${ctx.setup.number} has had ${MAX_ROUNDS} review rounds; it goes to the human (label needs-human)`,
    );
  }
  const result = await passes(ctx, pack);
  return result.kind === "ok" ? guarded(ctx, () => post(ctx, pack, result.value)) : result;
}

// decideRound : what this round does once the pack is built
async function decideRound(ctx: Ctx, pack: Pack): Promise<Result<Outcome>> {
  const last = ctx.past.last;
  if (pack.patchId === "") {
    return guarded(ctx, () => empty(ctx));
  }
  if (last.kind === "round" && last.patchId === pack.patchId) {
    return guarded(ctx, () => reuse(ctx, pack, last.round));
  }
  return review(ctx, pack);
}

// alreadyReviewed : the head the last round reviewed, when it is the change's head now
function alreadyReviewed(ctx: Ctx): Outcome | "no" {
  const last = ctx.past.last;
  if (last.kind !== "round" || last.head !== ctx.change.sha) {
    return "no";
  }
  return { kind: "already", head: last.head, actOn: ctx.past.actOn.get(last.patchId) ?? 0 };
}

// reviewRound : one round on the change, or why none ran
export async function reviewRound(setup: ReviewSetup): Promise<Result<Outcome>> {
  const ctx = await load(setup);
  if (ctx.kind === "failed") {
    return ctx;
  }
  const done = alreadyReviewed(ctx.value);
  if (done !== "no") {
    return { kind: "ok", value: done };
  }
  const pack = await packFor(ctx.value);
  return pack.kind === "ok" ? decideRound(ctx.value, pack.value) : pack;
}
