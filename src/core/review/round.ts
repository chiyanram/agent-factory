// round — one review round on a claimed change: pack → find → verify → post (#22; ported from start-reviewer.sh, #138).
//
//   1 The rounds so far come from the factory's own summary notes (history.ts). A head already reviewed is left alone.
//   2 The context pack for the head; from round 2, the interdiff since the last reviewed head (pack.ts). Its contract
//     is the approved spec of the ticket the change's factory/<ticket> branch names, read from the local spec store
//     with the ticket's approval record (#224); a change on another branch names no spec and is refused. The same
//     patch-id as the last round reuses its verdict, with no model run; when that verdict still has Act on findings the
//     writer made no progress, and the change goes to the human (ADR-0011 D14). An empty change goes there too.
//   3 After 3 rounds the change goes to the human (#22 Q5).
//   4 FIND, one fresh finder run per lens the blast radius picks, in parallel (lenses.ts, finders.ts): the lane's lens
//     count from the process, every lens on the strongest model (the logic model) for a one-way door, and the
//     test-integrity lens when an existing test changed. Their findings merge by file:line and rule, then VERIFY once
//     per kind (rule findings on one model, logic on another). Each is a fresh read-only run in a folder that holds
//     only its pack and the code with every rule file removed (code.ts, model.ts). Each lens's unique verified
//     findings are kept with the head and posted in the summary, so a lens that adds none can be retired (#237).
//   5 Before anything is posted, the head must still be the reviewed one; else MOVED, and nothing is posted.
//   6 One thread per Act on and Consider finding at its file:line; then the status box (status.ts) labels needs-human for
//     a protected file not listed before; then one summary note, last, since it marks the round done: a round that
//     failed halfway runs again. No verdict ever approves or undrafts, and zero findings is not a pass (#118).
//
// The run folders go in a private folder (0700), never /tmp, where anyone can plant a CLAUDE.md above them. Every
// rubric and the pack are read before any run, so a missing one spends nothing. A failed finder fails the round only
// after all finders end, so each run's spend is metered. Each verify pass rules only on findings of its own kind, so
// one pass cannot overrule the other. The Act on findings are kept before anything is posted, because a rework run
// reads them. A protected file labels the change once, so a person who cleared needs-human is not stopped again.

import type { LaneProps } from "../lane.js";
import { withFloor } from "./never.js";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readBound } from "../approval.js";
import { goAhead } from "../start.js";
import { BRANCH_PREFIX } from "../dispatch/steps.js";
import type { Done, Result } from "../forge/api.js";
import type { Change, Forge } from "../forge/types.js";
import { checkCites } from "../cite-check.js";
import { scrubbedJson } from "../scrub.js";
import { hostGit } from "../git.js";
import type { Post } from "../post.js";
import { keepActOn } from "./act-on.js";
import { actedSince, foundOf, keepTracked, type Acted, type FoundByRule } from "./acted-on.js";
import { copyCode } from "./code.js";
import { history, protectedLine, type History } from "./history.js";
import { BASELINE, lensPack, lensSetupOf, roundLenses, rubricText, touchedOf, type LensSetup } from "./finders.js";
import {
  mergeFindings,
  pickLenses,
  uniqueByLens,
  type Lens,
  type LensCount,
  type Merged,
  type Touched,
} from "./lenses.js";
import { holdRun, type Sessions } from "./live.js";
import type { Model, ModelAnswer, RunLimit } from "./model.js";
import type { RunLimits } from "./settings.js";
import type { RoundPart } from "../dispatch/spend.js";
import { deviationNotes } from "./deviations.js";
import { buildPack, type Approval, type Pack, type SpecSource } from "./pack.js";
import { ENGINE_PROCESS, type PluginDir, type Process } from "../process/read.js";
import { baselineSkills, copySkills, type Skills } from "./skills.js";
import { attempt } from "./safe.js";
import { plainName, type SpecStore } from "../spec.js";
import { issuesFrom, specStoreOf } from "../spec-store.js";
import { statusBox, type Box } from "./status.js";
import {
  BUCKET_NAMES,
  counts,
  countsLine,
  FIND_SCHEMA,
  quoteOf,
  readFindings,
  readVerdicts,
  sortFindings,
  VERIFY_SCHEMA,
  type Counts,
  type Finding,
  type Sorted,
  type Verdict,
} from "./verdicts.js";
import { prop } from "../field.js";

export const NEEDS_HUMAN = "needs-human";
export const MAX_ROUNDS = 3;
export const VERIFY_PASSES = 2;

export type ReviewSetup = {
  readonly forge: Forge;
  readonly number: number;
  readonly factory: string;
  readonly label: string;
  readonly repo: string;
  readonly env: NodeJS.ProcessEnv;
  readonly home: string;
  readonly project: string;
  readonly plugins: readonly PluginDir[];
  readonly packDir: string;
  readonly recordsDir: string;
  readonly runsDir: string;
  readonly prompts: { readonly find: string; readonly verify: string };
  readonly models: { readonly find: string; readonly rule: string; readonly logic: string };
  readonly maxUsd: string;
  readonly limits: RunLimits;
  readonly model: Model;
  readonly sessions: Sessions;
  readonly maxRuns: number;
  readonly maxFinders: number;
};

export type Outcome =
  | {
      readonly kind: "posted";
      readonly round: number;
      readonly head: string;
      readonly counts: Counts;
      readonly costUsd: number;
      readonly tokens: number;
      readonly acted: Acted | "none";
      readonly lenses: Readonly<Record<string, number>>;
      readonly citesNotFound: number;
      readonly found: FoundByRule;
      readonly skillsMissing: readonly string[];
    }
  | { readonly kind: "reused"; readonly round: number; readonly head: string; readonly actOn: number }
  | { readonly kind: "already"; readonly head: string; readonly actOn: number }
  | { readonly kind: "no-progress"; readonly head: string; readonly why: string }
  | { readonly kind: "moved"; readonly from: string; readonly to: string };

type Ctx = {
  readonly setup: ReviewSetup;
  readonly change: Change;
  readonly past: History;
  readonly deviations: readonly string[];
  readonly skills: Skills;
};

function failed(reason: string): { readonly kind: "failed"; readonly reason: string } {
  return { kind: "failed", reason };
}

async function load(setup: ReviewSetup): Promise<Result<Omit<Ctx, "skills">>> {
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
        value: {
          setup,
          change: change.value,
          past: history({ notes: notes.value, factory: setup.factory }),
          deviations: deviationNotes(notes.value, setup.factory),
        },
      }
    : notes;
}

async function defaultBranch(ctx: Ctx): Promise<Result<string>> {
  return ctx.setup.forge.defaultBranch();
}

async function specFor(ctx: Ctx, lanes: readonly LaneProps[]): Promise<Result<SpecSource>> {
  const s = ctx.setup;
  const branch = ctx.change.sourceBranch;
  const ticket = branch.startsWith(BRANCH_PREFIX) ? branch.slice(BRANCH_PREFIX.length) : "";
  if (!plainName(ticket)) {
    return failed(
      `${s.forge.mark}${s.number} is on ${branch}, not ${BRANCH_PREFIX}<ticket>, so it names no spec to review against; a person reviews it`,
    );
  }
  const store = specStoreOf({ env: s.env, home: s.home, open: issuesFrom(s.forge) });
  if (store.kind === "failed") {
    return store;
  }
  const approval = await approvalFor({ home: s.home, project: s.project, ticket, lanes, store: store.value });
  return approval.kind === "failed"
    ? approval
    : {
        kind: "ok",
        value: {
          store: store.value,
          project: s.project,
          ticket,
          approval: approval.value,
        },
      };
}

async function approvalFor(where: {
  readonly home: string;
  readonly project: string;
  readonly ticket: string;
  readonly lanes: readonly LaneProps[];
  readonly store: SpecStore;
}): Promise<Result<Approval>> {
  const stored = await readBound(where);
  if (stored.kind !== "missing") {
    return stored.kind === "refused"
      ? failed(stored.reason)
      : {
          kind: "ok",
          value: { kind: "approved", hash: stored.record.spec_hash, by: stored.record.by, at: stored.record.at },
        };
  }
  const go = await goAhead(where);
  return go.kind === "go" && go.said === "started"
    ? { kind: "ok", value: { kind: "approved", hash: go.spec.hash, by: go.by, at: go.at } }
    : { kind: "ok", value: { kind: "none" } };
}

async function reviewSkills(plugins: readonly PluginDir[]): Promise<Result<Skills>> {
  const skills = await baselineSkills(plugins, ENGINE_PROCESS.baseline);
  return skills.present.length === 0
    ? failed(
        `the review baseline has no skill left: no listed plugin has skills/<name>/SKILL.md for ${skills.missing.join(", ")}; list one in the project's "plugins" and pin it`,
      )
    : { kind: "ok", value: skills };
}

async function packFor(ctx: Ctx): Promise<Result<Pack>> {
  const branch = await defaultBranch(ctx);
  if (branch.kind === "failed") {
    return branch;
  }
  const s = ctx.setup;
  const spec = await specFor(ctx, ENGINE_PROCESS.lanes);
  if (spec.kind === "failed") {
    return spec;
  }
  const last = ctx.past.last;
  return buildPack({
    repo: s.repo,
    env: s.env,
    change: ctx.change,
    defaultBranch: branch.value,
    plugins: s.plugins,
    baseline: ctx.skills.present,
    previous: last.kind === "round" ? { kind: "head", sha: last.head } : { kind: "none" },
    spec: spec.value,
    deviations: ctx.deviations,
    dir: s.packDir,
    mark: s.forge.mark,
  });
}

type Now = { readonly kind: "same" } | { readonly kind: "moved"; readonly to: string };

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

async function empty(ctx: Ctx): Promise<Result<Outcome>> {
  const labelled = await label(ctx);
  return labelled.kind === "ok"
    ? { kind: "ok", value: { kind: "no-progress", head: ctx.change.sha, why: "the change is empty" } }
    : labelled;
}

async function reuseNote(ctx: Ctx, pack: Pack, round: number, actOn: number): Promise<Done> {
  const labelled = actOn > 0 ? await label(ctx) : ({ kind: "ok" } as const);
  return labelled.kind === "ok"
    ? note(ctx, `round ${round} reused · head ${pack.head} · patch-id ${pack.patchId}`)
    : labelled;
}

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

type Pass = {
  readonly name: string;
  readonly model: string;
  readonly schema: string;
  readonly prompt: string;
  readonly part: RoundPart;
};

async function keep(ctx: Ctx, pass: string, answer: unknown): Promise<void> {
  const dir = join(ctx.setup.recordsDir, String(ctx.setup.number), ctx.change.sha);
  await attempt(async () => {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await appendFile(
      join(
        dir,
        `reviewer-${pass
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/-$/, "")}.jsonl`,
      ),
      `${scrubbedJson(answer)}\n`,
      { mode: 0o600 },
    );
  }, "cannot keep the pass's answer");
}

function limitFor(limits: RunLimits, part: RoundPart): RunLimit {
  return part.kind === "finder" ? limits.finder : limits.verify;
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
    prompt: withFloor(prompt),
    name: `reviewer-${ctx.setup.number}`,
    maxUsd: ctx.setup.maxUsd,
    limit: limitFor(ctx.setup.limits, pass.part),
    part: pass.part,
  });
  const spent = ran.kind === "ok" ? ran.value.answer : ran.answer;
  if (prop(spent, "usage") !== undefined) {
    await keep(ctx, pass.name, spent);
  }
  return ran.kind === "ok"
    ? ran
    : failed(`${ctx.setup.forge.mark}${ctx.setup.number}: the ${pass.name} pass failed: ${ran.reason}`);
}

type Spent = { readonly costUsd: number; readonly find: number; readonly verify: number };

type Found = Merged<Finding>;
type FoundSorted = Found & { readonly bucket: Sorted["bucket"]; readonly why: string };

type Checked = { readonly verdicts: readonly Verdict[]; readonly answer: ModelAnswer | "none" };

async function verifySubset(
  ctx: Ctx,
  folder: string,
  subset: readonly Found[],
  kind: "rule" | "logic",
): Promise<Result<Checked>> {
  const wrote = await attempt(
    () => writeFile(join(folder, "findings.json"), JSON.stringify(subset)),
    "cannot write findings.json",
  );
  if (wrote.kind === "failed") {
    return wrote;
  }
  const model = kind === "rule" ? ctx.setup.models.rule : ctx.setup.models.logic;
  const ran = await runPass(ctx, folder, {
    name: `verify (${kind})`,
    model,
    schema: VERIFY_SCHEMA,
    prompt: ctx.setup.prompts.verify,
    part: { kind: "verify pass" },
  });
  if (ran.kind === "failed") {
    return ran;
  }
  return checked(subset, ran.value);
}

function checked(subset: readonly Found[], answer: ModelAnswer): Result<Checked> {
  const read = readVerdicts(answer.output);
  if (read.kind === "failed") {
    return read;
  }
  const ids = new Set(subset.map((f) => f.id));
  return { kind: "ok", value: { verdicts: read.value.filter((v) => ids.has(v.id)), answer } };
}

async function verifyKind(
  ctx: Ctx,
  folder: string,
  findings: readonly Found[],
  kind: "rule" | "logic",
): Promise<Result<Checked>> {
  const subset = findings.filter((f) => f.kind === kind);
  return subset.length === 0
    ? { kind: "ok", value: { verdicts: [], answer: "none" } }
    : verifySubset(ctx, folder, subset, kind);
}

function spentOf(found: readonly ModelAnswer[], verified: readonly (ModelAnswer | "none")[]): Spent {
  const answers = verified.filter((a): a is ModelAnswer => a !== "none");
  const sum = (list: readonly ModelAnswer[], of: (a: ModelAnswer) => number) => list.reduce((s, a) => s + of(a), 0);
  return {
    costUsd: sum(found, (a) => a.costUsd) + sum(answers, (a) => a.costUsd),
    find: sum(found, (a) => a.tokens),
    verify: sum(answers, (a) => a.tokens),
  };
}

type Plan = { readonly lenses: readonly Lens[]; readonly strongest: boolean };

type Reviewed = {
  readonly sorted: readonly FoundSorted[];
  readonly spent: Spent;
  readonly lenses: Readonly<Record<string, number>>;
};

async function verifyAll(
  ctx: Ctx,
  folder: string,
  found: readonly ModelAnswer[],
  findings: readonly Found[],
): Promise<Result<{ readonly sorted: readonly FoundSorted[]; readonly spent: Spent }>> {
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

async function runFolder(ctx: Ctx): Promise<Result<string>> {
  const dir = ctx.setup.runsDir;
  return attempt(async () => {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    return mkdtemp(join(dir, "review-"));
  }, `cannot make a run folder in ${dir}`);
}

async function placed(ctx: Ctx, folder: string, pack: Pack, text: string): Promise<Result<void>> {
  const copied = await copyCode({
    repo: ctx.setup.repo,
    sha: pack.head,
    into: join(folder, "code"),
    env: ctx.setup.env,
    prune: "rules",
  });
  const skills = copied.kind === "ok" ? await copySkills(ctx.skills.present, folder) : copied;
  return skills.kind === "failed"
    ? skills
    : attempt(() => writeFile(join(folder, "pack.md"), text), `cannot write the pack into ${folder}`);
}

type Finder = { readonly lens: string; readonly findings: readonly Finding[]; readonly answer: ModelAnswer };

async function findIn(ctx: Ctx, folder: string, lens: Lens, model: string): Promise<Result<Finder>> {
  const found = await runPass(ctx, folder, {
    name: lens.name === BASELINE.name ? "find" : `find (${lens.name})`,
    model,
    schema: FIND_SCHEMA,
    prompt: ctx.setup.prompts.find,
    part: { kind: "finder", lens: lens.name },
  });
  if (found.kind === "failed") {
    return found;
  }
  const findings = readFindings(found.value.output, lens.name);
  return findings.kind === "ok"
    ? { kind: "ok", value: { lens: lens.name, findings: findings.value, answer: found.value } }
    : findings;
}

type Shared = { readonly pack: Pack; readonly text: string; readonly model: string };

async function findLens(ctx: Ctx, lens: Lens, rubric: string, shared: Shared): Promise<Result<Finder>> {
  const folder = await runFolder(ctx);
  if (folder.kind === "failed") {
    return folder;
  }
  try {
    const ready = await placed(ctx, folder.value, shared.pack, lensPack(shared.text, lens, rubric));
    return ready.kind === "ok" ? await findIn(ctx, folder.value, lens, shared.model) : ready;
  } finally {
    await rm(folder.value, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function rubrics(ctx: Ctx, plan: Plan, pack: Pack): Promise<Result<readonly string[]>> {
  const read = await Promise.all(plan.lenses.map((lens) => rubricText(lens, { ...ctx.setup, master: pack.master })));
  const bad = read.find((r) => r.kind === "failed");
  return bad?.kind === "failed" ? bad : { kind: "ok", value: read.map((r) => (r.kind === "ok" ? r.value : "")) };
}

async function findAll(
  ctx: Ctx,
  plan: Plan,
  read: readonly string[],
  shared: Shared,
): Promise<Result<readonly Finder[]>> {
  const most = Math.max(1, ctx.setup.maxFinders);
  const ran: Result<Finder>[] = [];
  for (let at = 0; at < plan.lenses.length; at += most) {
    const batch = plan.lenses.slice(at, at + most);
    ran.push(...(await Promise.all(batch.map((lens, i) => findLens(ctx, lens, read[at + i] ?? "", shared)))));
  }
  const bad = ran.find((r) => r.kind === "failed");
  return bad?.kind === "failed" ? bad : { kind: "ok", value: ran.flatMap((r) => (r.kind === "ok" ? [r.value] : [])) };
}

type Inputs = { readonly text: string; readonly rubrics: readonly string[] };

async function inputs(ctx: Ctx, pack: Pack, plan: Plan): Promise<Result<Inputs>> {
  const text = await readFile(pack.path, "utf8").catch(() => undefined);
  const read = text === undefined ? failed(`cannot read the pack ${pack.path}`) : await rubrics(ctx, plan, pack);
  return read.kind === "ok" ? { kind: "ok", value: { text: text ?? "", rubrics: read.value } } : read;
}

async function throughVerify(ctx: Ctx, run: string, plan: Plan, finders: readonly Finder[]): Promise<Result<Reviewed>> {
  const sorted = await verifyAll(
    ctx,
    run,
    finders.map((f) => f.answer),
    mergeFindings(finders),
  );
  if (sorted.kind === "failed") {
    return sorted;
  }
  const lenses = uniqueByLens(
    plan.lenses.map((l) => l.name),
    sorted.value.sorted,
  );
  return { kind: "ok", value: { ...sorted.value, lenses } };
}

async function findAndVerify(ctx: Ctx, run: string, pack: Pack, plan: Plan): Promise<Result<Reviewed>> {
  const given = await inputs(ctx, pack, plan);
  if (given.kind === "failed") {
    return given;
  }
  const ready = await placed(ctx, run, pack, given.value.text);
  if (ready.kind === "failed") {
    return ready;
  }
  const model = plan.strongest ? ctx.setup.models.logic : ctx.setup.models.find;
  const finders = await findAll(ctx, plan, given.value.rubrics, { pack, text: given.value.text, model });
  return finders.kind === "ok" ? throughVerify(ctx, run, plan, finders.value) : finders;
}

async function lensInputs(ctx: Ctx): Promise<Result<{ readonly setup: LensSetup; readonly own: Process }>> {
  const setup = await lensSetupOf(ctx.setup);
  if (setup.kind === "failed") {
    return setup;
  }
  return { kind: "ok", value: { setup: setup.value, own: ENGINE_PROCESS } };
}

async function touchedFiles(ctx: Ctx, pack: Pack): Promise<Result<readonly Touched[]>> {
  const status = await hostGit({
    args: ["diff", "--name-status", "--no-renames", "-z", pack.base, pack.head],
    repo: { kind: "repo", path: ctx.setup.repo },
    env: ctx.setup.env,
    stdin: { kind: "none" },
  });
  return status.kind === "ok"
    ? { kind: "ok", value: touchedOf(status.stdout) }
    : failed("cannot list the files the change touches, to pick its lenses");
}

function countOf(own: Process, lane: Pack["lane"]): LensCount {
  return own.lanes.find((l) => l.name === lane)?.lenses ?? "all";
}

async function planFor(ctx: Ctx, pack: Pack): Promise<Result<Plan>> {
  const given = await lensInputs(ctx);
  if (given.kind === "failed") {
    return given;
  }
  const files = await touchedFiles(ctx, pack);
  if (files.kind === "failed") {
    return files;
  }
  const { setup, own } = given.value;
  const pick = pickLenses({
    lenses: roundLenses(setup.lenses),
    lane: pack.lane,
    count: countOf(own, pack.lane),
    touched: files.value,
    oneWayDoor: setup.oneWayDoor,
    testFiles: setup.testFiles,
  });
  return { kind: "ok", value: pick.lenses.length === 0 ? { ...pick, lenses: [BASELINE] } : pick };
}

async function passes(ctx: Ctx, pack: Pack): Promise<Result<Reviewed>> {
  const plan = await planFor(ctx, pack);
  if (plan.kind === "failed") {
    return plan;
  }
  const run = await runFolder(ctx);
  if (run.kind === "failed") {
    return run;
  }
  try {
    const reviewed = await findAndVerify(ctx, run.value, pack, plan.value);
    if (reviewed.kind === "ok") {
      await keep(ctx, "lenses", { lane: pack.lane, strongest: plan.value.strongest, unique: reviewed.value.lenses });
    }
    return reviewed;
  } finally {
    await rm(run.value, { recursive: true, force: true }).catch(() => undefined);
  }
}

function threadPost(f: Sorted, criteria: readonly string[]): Post {
  const quote = quoteOf(f, criteria);
  return {
    seat: "reviewer",
    title: `${BUCKET_NAMES[f.bucket]} ${f.id} (${f.severity}, ${f.category}, ${f.rule}): ${f.finding}`,
    fields: [
      ...(quote === "" ? [] : [{ label: "Criterion", value: quote }]),
      { label: "Fix", value: f.fix },
      { label: "Evidence", value: `${f.grade} · ${f.evidence}` },
    ],
    items: [],
  };
}

async function threads(ctx: Ctx, sorted: readonly Sorted[], criteria: readonly string[]): Promise<Done> {
  for (const f of sorted.filter((x) => x.bucket === "act_on" || x.bucket === "consider")) {
    const posted = await ctx.setup.forge.lineFinding({
      change: ctx.change,
      at: { file: f.file, line: f.line },
      post: threadPost(f, criteria),
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
    stdin: { kind: "none" },
  });
  return shown.kind === "ok" ? shown.stdout : "";
}

async function boxFor(ctx: Ctx, pack: Pack): Promise<Result<Box>> {
  const names = await hostGit({
    args: ["diff", "--name-only", "--no-renames", "-z", pack.base, pack.head],
    repo: { kind: "repo", path: ctx.setup.repo },
    env: ctx.setup.env,
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

function findingLine(f: Sorted, name: string, criteria: readonly string[]): string {
  const quote = quoteOf(f, criteria);
  const line = `${name} · ${BUCKET_NAMES[f.bucket]} ${f.id} ${f.file}:${f.line} ${f.rule} (${f.category}): ${f.finding} (${f.why})`;
  return quote === "" ? line : `${line} · criterion ${quote}`;
}

function findingLines(
  sorted: readonly Sorted[],
  axis: "standards" | "spec",
  name: string,
  criteria: readonly string[],
): readonly string[] {
  const mine = sorted.filter((f) => f.axis === axis);
  return mine.length === 0 ? [`${name} · none`] : mine.map((f) => findingLine(f, name, criteria));
}

function boxLines(box: Box): readonly string[] {
  return [
    ...box.protected.map((p) => `Protected · ${p}`),
    ...box.build.map((p) => `Build · ${p}`),
    ...box.added.map((d) => `New dependency · ${d}`),
  ];
}

function summaryItems(sorted: readonly Sorted[], box: Box, criteria: readonly string[]): readonly string[] {
  const zero =
    sorted.length === 0 ? ["No findings. That is not a pass: the human still reviews before merge (ADR-0012 S10)"] : [];
  return [
    ...zero,
    ...findingLines(sorted, "standards", "Standards", criteria),
    ...findingLines(sorted, "spec", "Spec", criteria),
    ...boxLines(box),
  ];
}

function freshProtected(ctx: Ctx, box: Box): readonly string[] {
  return box.protected.filter((p) => !ctx.past.listed.has(protectedLine(p)));
}

async function threadsAndLabel(
  ctx: Ctx,
  box: Box,
  sorted: readonly Sorted[],
  criteria: readonly string[],
): Promise<Done> {
  const posted = await threads(ctx, sorted, criteria);
  return posted.kind === "ok" && freshProtected(ctx, box).length > 0 ? label(ctx) : posted;
}

async function actedOf(ctx: Ctx, head: string, sorted: readonly Sorted[]): Promise<Acted | "none"> {
  const at = { recordsDir: ctx.setup.recordsDir, change: ctx.setup.number, head };
  await keepTracked(at, sorted);
  const last = ctx.past.last;
  return last.kind === "round"
    ? actedSince({ ...at, repo: ctx.setup.repo, env: ctx.setup.env, since: last.head })
    : "none";
}

function missingLines(skills: Skills): readonly string[] {
  return skills.missing.length === 0 ? [] : [`Skills missing · ${skills.missing.join(", ")}`];
}

function lensesLine(lenses: Readonly<Record<string, number>>): string {
  return Object.entries(lenses)
    .map(([lens, n]) => `${lens} ${n}`)
    .join(" · ");
}

async function post(
  ctx: Ctx,
  pack: Pack,
  result: Reviewed & { readonly citesNotFound: number },
): Promise<Result<Outcome>> {
  const box = await boxFor(ctx, pack);
  if (box.kind === "failed") {
    return box;
  }
  const kept = await keepActOn({
    recordsDir: ctx.setup.recordsDir,
    change: ctx.setup.number,
    head: pack.head,
    sorted: result.sorted,
  });
  if (kept.kind === "failed") {
    return kept;
  }
  const acted = await actedOf(ctx, pack.head, result.sorted);
  const labelled = await threadsAndLabel(ctx, box.value, result.sorted, pack.criteria);
  if (labelled.kind === "failed") {
    return labelled;
  }
  const round = ctx.past.rounds + 1;
  const c = counts(result.sorted);
  const spent = `$${result.spent.costUsd.toFixed(2)} · find ${result.spent.find} tokens · verify ${result.spent.verify} tokens`;
  const summary = await note(
    ctx,
    `round ${round} · head ${pack.head} · patch-id ${pack.patchId} · ${countsLine(c)}`,
    [...summaryItems(result.sorted, box.value, pack.criteria), ...missingLines(ctx.skills)],
    [
      { label: "Spent at this head", value: spent },
      { label: "Unique findings per lens", value: lensesLine(result.lenses) },
    ],
  );
  return summary.kind === "ok"
    ? {
        kind: "ok",
        value: {
          kind: "posted",
          round,
          head: pack.head,
          counts: c,
          costUsd: result.spent.costUsd,
          tokens: result.spent.find + result.spent.verify,
          acted,
          lenses: result.lenses,
          citesNotFound: result.citesNotFound,
          found: foundOf(result.sorted),
          skillsMissing: ctx.skills.missing,
        },
      }
    : summary;
}

async function review(ctx: Ctx, pack: Pack): Promise<Result<Outcome>> {
  if (ctx.past.rounds >= MAX_ROUNDS) {
    return failed(
      `${ctx.setup.forge.mark}${ctx.setup.number} has had ${MAX_ROUNDS} review rounds; it goes to the human (label needs-human)`,
    );
  }
  const result = await passes(ctx, pack);
  if (result.kind === "failed") {
    return result;
  }
  const cited = await checkCites({ repo: ctx.setup.repo, env: ctx.setup.env, sha: pack.head }, result.value.sorted);
  return guarded(ctx, () =>
    post(ctx, pack, { ...result.value, sorted: cited.findings, citesNotFound: cited.notFound }),
  );
}

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

function alreadyReviewed(ctx: Pick<Ctx, "past" | "change">): Outcome | "no" {
  const last = ctx.past.last;
  if (last.kind !== "round" || last.head !== ctx.change.sha) {
    return "no";
  }
  return { kind: "already", head: last.head, actOn: ctx.past.actOn.get(last.patchId) ?? 0 };
}

export async function reviewRound(setup: ReviewSetup): Promise<Result<Outcome>> {
  const held = await holdRun({
    repo: setup.repo,
    number: setup.number,
    sessions: setup.sessions,
    maxRuns: setup.maxRuns,
  });
  if (held.kind === "failed") {
    return failed(`${setup.forge.mark}${setup.number}: ${held.reason}`);
  }
  try {
    return await heldRound(setup);
  } finally {
    await held.value.release();
  }
}

async function heldRound(setup: ReviewSetup): Promise<Result<Outcome>> {
  const ctx = await load(setup);
  if (ctx.kind === "failed") {
    return ctx;
  }
  const done = alreadyReviewed(ctx.value);
  if (done !== "no") {
    return { kind: "ok", value: done };
  }
  const skills = await reviewSkills(setup.plugins);
  if (skills.kind === "failed") {
    return skills;
  }
  const withSkills = { ...ctx.value, skills: skills.value };
  const pack = await packFor(withSkills);
  return pack.kind === "ok" ? decideRound(withSkills, pack.value) : pack;
}
