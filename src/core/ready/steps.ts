// steps — the ready check and the local verifier as the dispatcher's steps (#91; #138). Both run branch code, so both
// run only in a fresh box (boxrun.ts), and both read their commands from the project file, never from the branch.
//
//   ready    first the floor guard (floor.ts) reads the diff on the host: a test check hit (a deleted test or test
//            case, a skip, a removed assertion, a changed judge file) fails the check at once for a person
//            (needs-human), with its file:line, unless the ticket's waiver (waiver.ts) clears it; a suppression with no
//            reason or an empty catch fails it for the writer; no box runs on a hit. A guard that cannot read the diff
//            or the waiver fails the step, so a person looks. Then each evidence row of the
//            writer's report runs again at the head. A row whose command needs a shell, or starts with a program the
//            project file does not list, fails the check: the writer is sent back to fix it.
//   verify   the project file's one verify command runs at the head (gate "local" only), and the host posts its result
//            as the commit status agent-factory/verify, for people and branch protection. The dispatcher decides from
//            its own record of the run, never from the forge, where any other check could read as green. It posts
//            "pending" first, so a run that dies leaves no green status. A failed run keeps the end of its output with
//            the head (kept.ts), which a CI run of the writer reads (#171).

import type { Result } from "../forge/api.js";
import { keepText, recordsDirOf, tailOf } from "../kept.js";
import type { Forge, StatusState } from "../forge/types.js";
import type { RunInput, Steps } from "../dispatch/tick.js";
import type { Argv, ProjectFile } from "../project.js";
import type { Evidence } from "../report.js";
import { commandArgv } from "./command.js";
import { rowLine, runInBox, type BoxSetup, type Row } from "./boxrun.js";
import { floorGuard, forHuman, hitsLine } from "./floor.js";
import { judgeFiles } from "./judge.js";

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
type Checked = { readonly passed: boolean; readonly why: string; readonly human: boolean };

const PASSED: Checked = { passed: true, why: "", human: false };

// the head of the ticket's waiver of the test checks (waiver.ts), or "none"
export type WaiverHead = (ticket: string) => Promise<Result<string>>;

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

function verdict(evidence: readonly Evidence[], rows: readonly Row[]): Checked {
  const bad = failedRow(rows);
  if (bad === "none") {
    return PASSED;
  }
  const i = rows.indexOf(bad);
  return { passed: false, why: `row ${i + 1} (${evidence[i]?.criterion ?? ""}): ${rowLine(bad)}`, human: false };
}

type Guarding = { readonly plan: ReadyPlan; readonly forge: Forge; readonly waiver: WaiverHead };

// floor : the floor guard on the change's diff, before any box runs; none is a pass
async function floor(g: Guarding, open: Open, input: RunInput): Promise<Result<Checked>> {
  const base = await g.forge.defaultBranch();
  if (base.kind === "failed") {
    return base;
  }
  const waived = await g.waiver(input.ticket);
  const hits =
    waived.kind === "ok"
      ? await floorGuard({
          repo: g.plan.setup.repo,
          env: g.plan.setup.env,
          base: base.value,
          branch: open.branch,
          head: input.head,
          testFiles: g.plan.project.ready.testFiles,
          judgeFiles: judgeFiles(g.plan.project),
          waived: waived.value,
        })
      : waived;
  if (hits.kind === "failed") {
    return hits;
  }
  return {
    kind: "ok",
    value: hits.value.length === 0 ? PASSED : { passed: false, why: hitsLine(hits.value), human: forHuman(hits.value) },
  };
}

async function check(
  g: Guarding,
  open: Open,
  input: RunInput & { readonly evidence: readonly Evidence[] },
): Promise<Result<Checked>> {
  if (input.evidence.length === 0) {
    return { kind: "ok", value: { passed: false, why: "the writer gave no evidence rows to run again", human: false } };
  }
  const guarded = await floor(g, open, input);
  if (guarded.kind === "failed" || !guarded.value.passed) {
    return guarded;
  }
  return rerun(g.plan, open, input);
}

async function rerun(
  plan: ReadyPlan,
  open: Open,
  input: RunInput & { readonly evidence: readonly Evidence[] },
): Promise<Result<Checked>> {
  const parsed = argvs(input.evidence, plan.project.ready.programs);
  if (parsed.kind === "failed") {
    return { kind: "ok", value: { passed: false, why: parsed.reason, human: false } };
  }
  const commands = parsed.value.flatMap((a) => (a.kind === "ok" ? [a.value] : []));
  const rows = await runInBox({
    setup: plan.setup,
    ...open,
    head: input.head,
    commands,
    timeoutSeconds: plan.project.ready.timeoutSeconds,
  });
  return rows.kind === "ok" ? { kind: "ok", value: verdict(input.evidence, rows.value) } : rows;
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
        : check({ plan, forge, waiver }, open, input);
    },
  };
}

type Verifying = { readonly forge: Forge; readonly open: Open; readonly head: string };

function post(v: Verifying, state: StatusState, description: string): ReturnType<Forge["status"]> {
  return v.forge.status({ sha: v.head, ref: v.open.branch, state, context: VERIFY_CONTEXT, description });
}

export const VERIFY_FILE = "verify.txt";

function stream(name: string, text: string): readonly string[] {
  return text.trim() === ""
    ? []
    : [`${name}, its last lines:`, "", "```text", tailOf(text).replaceAll("```", "` ` `"), "```", ""];
}

// verifyOutput : what a failed verifier run printed, as the writer reads it. Pure.
export function verifyOutput(row: Row): string {
  const out =
    row.ran.kind === "exited" ? [...stream("stdout", row.ran.stdout), ...stream("stderr", row.ran.stderr)] : [];
  return [`# The local verifier failed`, "", `\`${rowLine(row)}\` at your head, in a fresh box.`, "", ...out].join(
    "\n",
  );
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
