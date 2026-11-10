// steps — the ready check and the local verifier as the dispatcher's steps (#91; #138). Both run branch code, so both
// run only in a fresh box (boxrun.ts), and both read their commands from the project file, never from the branch.
//
//   ready    first the floor guard (floor.ts) reads the diff on the host: a test check hit (a deleted test or test
//            case, a skip, a removed assertion, a changed judge file) fails the check at once for a person
//            (needs-human), with its file:line, unless the ticket's waiver (waiver.ts) clears it; a suppression with no
//            reason or an empty catch fails it for the writer; no box runs on a hit. A guard that cannot read the diff
//            or the waiver fails the step, so a person looks. The lane check (lane.ts, #230) reads the lane the same
//            diff needs, and the result carries it for the dispatcher to compare with the lane a human said yes to. An
//            acceptance criterion with no evidence row (AC-n) fails the check. Then each evidence row of the
//            writer's report runs again at the head. A row whose command needs a shell, or starts with a program that
//            is neither one of the read-only set (command.ts, #444) nor on the project file's list, fails the check:
//            the writer is sent back to fix it. So does a row that cannot prove its criterion (proof.ts, #444): one
//            gate command given for several criteria, before any box starts, or a result that quotes nothing its
//            command printed, after the rows ran. A failed check keeps
//            why it failed with the head (kept.ts), and a failed row's output with it, before its result is recorded:
//            the writer's rework run reads it (#199). Once the rows ran, the host posts each row's re-run beside the
//            result the writer claimed (rerun-note.ts, #430).
//   verify   the project file's one verify command runs at the head (gate "local" only), and the host posts its result
//            as the commit status agent-factory/verify, for people and branch protection. The dispatcher decides from
//            its own record of the run, never from the forge, where any other check could read as green. It posts
//            "pending" first, so a run that dies leaves no green status. A failed run keeps the end of its output with
//            the head (kept.ts), which a CI run of the writer reads (#171).

import type { Result } from "../forge/api.js";
import { keepText, recordsDirOf, tailOf } from "../kept.js";
import type { Forge, StatusState } from "../forge/types.js";
import type { ReadyFacts, RunInput, Steps } from "../dispatch/tick.js";
import type { Argv, ProjectFile } from "../project.js";
import type { Evidence } from "../report.js";
import { commandArgv, evidencePrograms, GIT_PROGRAM } from "./command.js";
import { gateReused, unquoted } from "./proof.js";
import { rowLine, runInBox, type BoxSetup, type Row } from "./boxrun.js";
import type { Lane } from "../spec.js";
import { floorGuard, forHuman, hitsLine, type FloorInput } from "./floor.js";
import { judgeFiles } from "./judge.js";
import { diffLane } from "./lane.js";
import { rerunPost } from "./rerun-note.js";

export const VERIFY_CONTEXT = "agent-factory/verify";

// what a box run needs, or why there is none
export type BoxPlan =
  | { readonly kind: "ready"; readonly setup: BoxSetup; readonly project: ProjectFile }
  | { readonly kind: "unavailable"; readonly reason: string };

type ReadyPlan = Extract<BoxPlan, { kind: "ready" }>;

type Open = { readonly number: number; readonly branch: string };

function openOf(input: RunInput): Open | "none" {
  return input.change.kind === "open" ? { number: input.change.line.number, branch: input.change.line.branch } : "none";
}

function failedRow(rows: readonly Row[]): Row | "none" {
  return rows.find((r) => r.ran.kind === "timedOut" || r.ran.code !== 0) ?? "none";
}

// human: the check stopped for a person (a test check hit), not for the writer
// lane: the lane the diff needs (#230), once the lane check has read it
type Checked = { readonly passed: boolean; readonly why: string; readonly human: boolean; readonly lane?: Lane };

type ReadyInput = RunInput & { readonly evidence: readonly Evidence[] } & ReadyFacts;

const PASSED: Checked = { passed: true, why: "", human: false };

// the head of the ticket's waiver of the test checks (waiver.ts), or "none"
export type WaiverHead = (ticket: string) => Promise<Result<string>>;

// a check's result, and the row whose output shows why it failed: "none" when no row ran to fail (the floor guard, a
// row that cannot run with no shell, no rows)
type Judged = Checked & { readonly row: Row | "none" };

function judged(checked: Checked): Judged {
  return { ...checked, row: "none" };
}

// argvs : every row's command as argv, or the first row that cannot run with no shell
function argvs(evidence: readonly Evidence[], programs: readonly string[]): Result<ReturnType<typeof commandArgv>[]> {
  const all = evidence.map((e) => commandArgv(e.command, programs));
  const bad = all.findIndex((a) => a.kind === "failed");
  const row = evidence[bad];
  const it = all[bad];
  return row !== undefined && it?.kind === "failed"
    ? {
        kind: "failed",
        reason: `row ${bad + 1} (${row.criterion}): ${JSON.stringify(row.command)} cannot run: ${it.reason}`,
      }
    : { kind: "ok", value: all };
}

function verdict(evidence: readonly Evidence[], rows: readonly Row[]): Judged {
  const bad = failedRow(rows);
  if (bad === "none") {
    return quoted(evidence, rows);
  }
  const i = rows.indexOf(bad);
  return {
    passed: false,
    why: `row ${i + 1} (${evidence[i]?.criterion ?? ""}): ${rowLine(bad)}`,
    human: false,
    row: bad,
  };
}

// quoted : rows that all ran pass when each result quotes what its command printed; the first that does not fails
// the check, with its output kept for the writer (#444)
function quoted(evidence: readonly Evidence[], rows: readonly Row[]): Judged {
  const prose = unquoted(evidence, rows.map(printedText));
  const row = prose === "none" ? undefined : rows[prose.at];
  return prose === "none" || row === undefined
    ? { ...PASSED, row: "none" }
    : { passed: false, why: prose.why, human: false, row };
}

// printedText : what a row printed, stdout then stderr. Pure.
function printedText(row: Row): string {
  return row.ran.kind === "exited" ? `${row.ran.stdout}\n${row.ran.stderr}` : "";
}

type Guarding = { readonly plan: ReadyPlan; readonly forge: Forge; readonly waiver: WaiverHead };

// floorInput : what the floor guard and the lane check read the diff with, the ticket's waiver among it
async function floorInput(g: Guarding, open: Open, input: RunInput): Promise<Result<FloorInput>> {
  const base = await g.forge.defaultBranch();
  if (base.kind === "failed") {
    return base;
  }
  const waived = await g.waiver(input.ticket);
  return waived.kind === "ok"
    ? {
        kind: "ok",
        value: {
          repo: g.plan.setup.repo,
          env: g.plan.setup.env,
          base: base.value,
          branch: open.branch,
          head: input.head,
          testFiles: g.plan.project.ready.testFiles,
          judgeFiles: judgeFiles(g.plan.project),
          waived: waived.value,
        },
      }
    : waived;
}

// floor : the floor guard on the change's diff, before any box runs; none is a pass
async function floor(at: FloorInput): Promise<Result<Checked>> {
  const hits = await floorGuard(at);
  if (hits.kind === "failed") {
    return hits;
  }
  return {
    kind: "ok",
    value: hits.value.length === 0 ? PASSED : { passed: false, why: hitsLine(hits.value), human: forHuman(hits.value) },
  };
}

// criterionId : the id of the n-th acceptance criterion, from 1. Pure.
export function criterionId(n: number): string {
  return `AC-${n}`;
}

// uncovered : the ids of the acceptance criteria no evidence row names: a row names AC-n when its criterion starts with
// that id (AC-2, AC2 or ac-2, and no digit after it). Pure.
export function uncovered(criteria: readonly string[], evidence: readonly Evidence[]): readonly string[] {
  return criteria.flatMap((_, i) => {
    const id = new RegExp(`^AC-?${i + 1}(?!\\d)`, "i");
    return evidence.some((e) => id.test(e.criterion.trim())) ? [] : [criterionId(i + 1)];
  });
}

// covered : a guarded diff whose every acceptance criterion has an evidence row runs the rows again; a missing row
// fails the check for the writer, and counts towards its tries
async function covered(
  g: Guarding,
  open: Open,
  input: ReadyInput,
  at: { readonly guarded: Checked; readonly base: string },
): Promise<Result<Judged>> {
  const { guarded } = at;
  if (!guarded.passed) {
    return { kind: "ok", value: judged(guarded) };
  }
  const missing = uncovered(input.criteria, input.evidence);
  return missing.length === 0
    ? rerun(g, open, input, at.base)
    : {
        kind: "ok",
        value: judged({
          passed: false,
          why: `no evidence row for ${missing.join(", ")}: give each acceptance criterion a row whose criterion starts with its id`,
          human: false,
        }),
      };
}

// guardedLane : the floor guard's verdict and the lane the diff needs, both read on the host before any box runs
async function guardedLane(at: FloorInput, input: ReadyInput): Promise<Result<Checked & { readonly lane: Lane }>> {
  const guarded = await floor(at);
  if (guarded.kind === "failed") {
    return guarded;
  }
  const lane = await diffLane(at, input.oneWayDoor);
  return lane.kind === "ok" ? { kind: "ok", value: { ...guarded.value, lane: lane.value.lane } } : lane;
}

// baseOf : the default branch the floor guard read, or "" when it could not be read. Pure.
function baseOf(at: Result<FloorInput>): string {
  return at.kind === "ok" ? at.value.base : "";
}

async function check(g: Guarding, open: Open, input: ReadyInput): Promise<Result<Judged>> {
  if (input.evidence.length === 0) {
    return {
      kind: "ok",
      value: judged({ passed: false, why: "the writer gave no evidence rows to run again", human: false }),
    };
  }
  const at = await floorInput(g, open, input);
  const guarded = at.kind === "ok" ? await guardedLane(at.value, input) : at;
  if (guarded.kind === "failed") {
    return guarded;
  }
  const ran = await covered(g, open, input, { guarded: guarded.value, base: baseOf(at) });
  return ran.kind === "ok" ? { kind: "ok", value: { ...ran.value, lane: guarded.value.lane } } : ran;
}

async function rerun(g: Guarding, open: Open, input: ReadyInput, base: string): Promise<Result<Judged>> {
  const { plan } = g;
  const parsed = argvs(input.evidence, plan.project.ready.programs);
  if (parsed.kind === "failed") {
    return { kind: "ok", value: judged({ passed: false, why: parsed.reason, human: false }) };
  }
  const commands = parsed.value.flatMap((a) => (a.kind === "ok" ? [a.value] : []));
  const reused = gateReused(input.evidence, commands, plan.project);
  if (reused !== "") {
    return { kind: "ok", value: judged({ passed: false, why: reused, human: false }) };
  }
  const rows = await runInBox({
    setup: plan.setup,
    ...open,
    head: input.head,
    commands,
    timeoutSeconds: plan.project.ready.timeoutSeconds,
    // a git row reads the branch's history: the box's copy gets it, with the default branch to diff against
    ...(commands.some((c) => c[0] === GIT_PROGRAM) ? { history: { base } } : {}),
  });
  return rows.kind === "ok" ? reported(g, open, input, rows.value) : rows;
}

// reported : the rows' verdict, after the note that puts each re-run beside its claim (rerun-note.ts, #430); a note
// that cannot be posted fails the step, so a person looks
async function reported(g: Guarding, open: Open, input: ReadyInput, rows: readonly Row[]): Promise<Result<Judged>> {
  const judgedRows = verdict(input.evidence, rows);
  const note = rerunPost(input.head, input.evidence, rows, judgedRows.passed);
  const noted = await g.forge.note({ number: open.number, post: note });
  return noted.kind === "ok" ? { kind: "ok", value: judgedRows } : noted;
}

// readyPrograms : every program the project's evidence rows may start with, or none without a project file (#444)
export function readyPrograms(plan: BoxPlan): readonly string[] | undefined {
  return plan.kind === "ready" ? evidencePrograms(plan.project.ready.programs) : undefined;
}

// The writer's task file is cut at 20,000 characters from its end (writer/task.ts, MAX_TASK_CHARS), so a kept file
// fits it by construction: the reason and each stream are cut from the front, where the least useful lines are, and
// the headings take the rest. A test holds the sum under the cap (#199).
const MOST_REASON_CHARS = 2_000;
const MOST_STREAM_CHARS = 8_500;

// cutNote : what cutting a text to its last `most` characters drops, as a line; none when nothing is cut. Pure.
function cutNote(text: string, most: number): readonly string[] {
  return text.length <= most ? [] : [`(…${text.length - most} earlier characters cut)`];
}

// lastChars : the end of a text, at most `most` characters, after a line saying how much went before it. Pure.
function lastChars(text: string, most: number): readonly string[] {
  return [...cutNote(text, most), text.slice(-most)];
}

// stream : one stream's last lines, plain and fenced; none when it printed nothing. Pure.
function stream(name: string, text: string): readonly string[] {
  if (text.trim() === "") {
    return [];
  }
  const plain = tailOf(text).replaceAll("```", "` ` `");
  const note = cutNote(plain, MOST_STREAM_CHARS);
  return [
    `${name}, its last lines:`,
    "",
    ...(note.length === 0 ? [] : [...note, ""]),
    "```text",
    plain.slice(-MOST_STREAM_CHARS),
    "```",
    "",
  ];
}

// printed : a row's stdout and stderr tails; none for a row that ran out of time. Pure.
function printed(row: Row): readonly string[] {
  return row.ran.kind === "exited" ? [...stream("stdout", row.ran.stdout), ...stream("stderr", row.ran.stderr)] : [];
}

export const READY_FILE = "ready.txt";

// readyOutput : why a ready check failed, and what the failed row printed, as the writer reads it. Pure.
export function readyOutput(why: string, row: Row | "none"): string {
  return [
    "# The ready check failed",
    "",
    "The host checked your head, and ran your evidence rows again there in a fresh box. It failed:",
    "",
    ...lastChars(why, MOST_REASON_CHARS),
    "",
    ...(row === "none" ? [] : printed(row)),
  ].join("\n");
}

// recorded : a failed check's output, kept with the head before the result goes to the run record; a check that cannot
// keep it fails the step, so a person looks
async function recorded(plan: ReadyPlan, open: Open, head: string, j: Judged): Promise<Result<Checked>> {
  const lane = j.lane === undefined ? {} : { lane: j.lane };
  const result = { kind: "ok", value: { passed: j.passed, why: j.why, human: j.human, ...lane } } as const;
  if (j.passed) {
    return result;
  }
  const at = { recordsDir: recordsDirOf(plan.setup.repo), change: open.number, head };
  const output = await keepText(at, READY_FILE, readyOutput(j.why, j.row));
  return output.kind === "ok" ? result : output;
}

async function readyAt(g: Guarding, open: Open, input: ReadyInput): Promise<Result<Checked>> {
  const checked = await check(g, open, input);
  return checked.kind === "ok" ? recorded(g.plan, open, input.head, checked.value) : checked;
}

// readyStep : the ready check, when there is a box and a project file; waiver reads the ticket's waiver
export function readyStep(plan: BoxPlan, forge: Forge, waiver: WaiverHead): Steps["ready"] {
  if (plan.kind === "unavailable") {
    return plan;
  }
  return {
    kind: "available",
    run: async (input) => {
      const open = openOf(input);
      return open === "none"
        ? { kind: "failed", reason: "no open change to check" }
        : readyAt({ plan, forge, waiver }, open, input);
    },
  };
}

type Verifying = { readonly forge: Forge; readonly open: Open; readonly head: string };

function post(v: Verifying, state: StatusState, description: string): ReturnType<Forge["status"]> {
  return v.forge.status({ sha: v.head, ref: v.open.branch, state, context: VERIFY_CONTEXT, description });
}

export const VERIFY_FILE = "verify.txt";

// verifyOutput : what a failed verifier run printed, as the writer reads it. Pure.
export function verifyOutput(row: Row): string {
  return [
    `# The local verifier failed`,
    "",
    `\`${rowLine(row)}\` at your head, in a fresh box.`,
    "",
    ...printed(row),
  ].join("\n");
}

// kept : a failed run's output, kept with the head before the status is posted; a run that cannot keep it posts nothing
async function kept(plan: ReadyPlan, v: Verifying, bad: Row | "none"): Promise<Result<string>> {
  if (bad === "none") {
    return { kind: "ok", value: "" };
  }
  const at = { recordsDir: recordsDirOf(plan.setup.repo), change: v.open.number, head: v.head };
  return keepText(at, VERIFY_FILE, verifyOutput(bad));
}

// report : the verifier's result as the status at the head
async function report(
  plan: ReadyPlan,
  v: Verifying,
  verify: Argv,
  rows: readonly Row[],
): Promise<Result<{ readonly passed: boolean }>> {
  const bad = failedRow(rows);
  const passed = bad === "none" && rows.length === 1;
  const output = await kept(plan, v, bad);
  const posted = output.kind === "ok" ? await post(v, passed ? "success" : "failed", described(verify, bad)) : output;
  return posted.kind === "ok" ? { kind: "ok", value: { passed } } : posted;
}

// described : the status's one line. Pure.
function described(verify: Argv, bad: Row | "none"): string {
  return bad === "none" ? `${verify.join(" ")} passed` : rowLine(bad);
}

async function verifyRun(plan: ReadyPlan, v: Verifying, verify: Argv): Promise<Result<{ readonly passed: boolean }>> {
  const pending = await post(v, "pending", `${verify.join(" ")} is running in a box`);
  if (pending.kind === "failed") {
    return pending;
  }
  const rows = await runInBox({
    setup: plan.setup,
    ...v.open,
    head: v.head,
    commands: [verify],
    timeoutSeconds: plan.project.ready.timeoutSeconds,
  });
  if (rows.kind === "failed") {
    // no verdict from a box that failed: the status stays pending, and with no record of an end a person looks
    await post(v, "pending", `the local verifier could not run; a person looks: ${rows.reason}`);
    return rows;
  }
  return report(plan, v, verify, rows.value);
}

async function verifyAt(plan: ReadyPlan, v: Verifying): Promise<Result<{ readonly passed: boolean }>> {
  const gate = plan.project.gate;
  return gate.kind === "local"
    ? verifyRun(plan, v, gate.verify)
    : { kind: "failed", reason: "the project's gate is forge-ci; the local verifier does not run" };
}

// verifyStep : the local verifier, when the project's gate is local and there is a box
export function verifyStep(plan: BoxPlan, forge: Forge): Steps["verify"] {
  if (plan.kind === "unavailable") {
    return plan;
  }
  if (plan.project.gate.kind !== "local") {
    return { kind: "unavailable", reason: "the project's gate is forge-ci" };
  }
  return {
    kind: "available",
    run: async (input) => {
      const open = openOf(input);
      return open === "none"
        ? { kind: "failed", reason: "no open change to verify" }
        : verifyAt(plan, { forge, open, head: input.head });
    },
  };
}
