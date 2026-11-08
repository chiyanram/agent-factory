// task — what the host hands a rework or CI run, written to .factory/task.md (#171; decided on #30, 2026-11-08). The
// writer has no forge login, so everything it must act on comes from the host, capped:
//   ready-failed  the first evidence row that failed at the head, from the run record
//   act-on        the factory's own Act on findings at the head (review/act-on.ts), never a forge thread
//   ci-red        the failed jobs' names and the end of each log (Forge.failedJobs)
//   verify-failed the local verifier's own output at the head, kept by the verifier (kept.ts)
// A task the host cannot read is a failure with the reason; the step hands it to a person.

import type { Task } from "../dispatch/records.js";
import type { Result } from "../forge/api.js";
import type { FailedJob } from "../forge/types.js";
import { readActOn, type ActOn } from "../review/act-on.js";

// the whole file at most, so one long log or finding list cannot fill the writer's context
export const MAX_TASK_CHARS = 20_000;

export type TaskSource = {
  // where the review keeps its rounds: <FACTORY_REPO>/.claude/runs
  readonly recordsDir: string;
  readonly change: number;
};

// capped : the text cut at the cap, saying so. Pure.
export function capped(text: string): string {
  return text.length <= MAX_TASK_CHARS
    ? text
    : `${text.slice(0, MAX_TASK_CHARS)}\n\n(cut at ${MAX_TASK_CHARS} characters)\n`;
}

function finding(f: ActOn): string {
  return [`## ${f.id} · ${f.file}:${f.line} · ${f.rule} (${f.severity})`, "", f.finding, "", `Fix: ${f.fix}`, ""].join(
    "\n",
  );
}

// actOnText : the Act on findings as the writer reads them. Pure.
export function actOnText(findings: readonly ActOn[]): string {
  return capped(
    [
      "# Act on findings",
      "",
      "The factory's review found these at the head. Fix each one, or say in your report why it is wrong.",
      "",
      ...findings.map(finding),
    ].join("\n"),
  );
}

// readyText : the failed evidence row as the writer reads it. Pure.
export function readyText(why: string): string {
  return capped(
    [
      "# The ready check failed",
      "",
      "The host ran your evidence rows again at the head, in a fresh box. This one failed:",
      "",
      why,
      "",
    ].join("\n"),
  );
}

function job(j: FailedJob): string {
  switch (j.log.kind) {
    case "tail":
      return [
        `## ${j.name}`,
        "",
        "The end of its log:",
        "",
        "```text",
        j.log.text.replaceAll("```", "` ` `"),
        "```",
        "",
      ].join("\n");
    case "none":
      return [`## ${j.name}`, "", `No log: ${j.log.why}`, ""].join("\n");
  }
}

// verifyText : the local verifier's kept output, as the writer reads it. Pure.
export function verifyText(kept: string): string {
  return capped(kept);
}

// ciText : the failed CI jobs as the writer reads them. Pure.
export function ciText(jobs: readonly FailedJob[]): string {
  return capped(["# CI is red", "", "These jobs failed at your head.", "", ...jobs.map(job)].join("\n"));
}

// taskText : the text of .factory/task.md for a rework run
export async function taskText(
  task: Extract<Task, { readonly kind: "ready-failed" | "act-on" }>,
  source: TaskSource,
): Promise<Result<string>> {
  switch (task.kind) {
    case "ready-failed":
      return { kind: "ok", value: readyText(task.why) };
    case "act-on": {
      const found = await readActOn({ recordsDir: source.recordsDir, change: source.change, head: task.head });
      return found.kind === "ok" ? { kind: "ok", value: actOnText(found.value) } : found;
    }
  }
}
