// task — what the host hands a rework or CI run, written to .factory/task.md (#171). The
// writer has no forge login, so everything it must act on comes from the host, capped:
//   ready-failed  why the ready check failed at the head and the failed row's output, kept by the ready check
//   act-on        the factory's own Act on findings at the head (review/act-on.ts), never a forge thread
//   ci-red        the failed jobs' names and the end of each log (Forge.failedJobs)
//   verify-failed the local verifier's own output at the head, kept by the verifier (kept.ts)
// A task the host cannot read is a failure with the reason; the step hands it to a person. A cut closes a data fence it
// leaves open first, so the host's note is never read as part of the data.

import type { Task } from "../dispatch/records.js";
import type { Result } from "../forge/api.js";
import type { FailedJob } from "../forge/types.js";
import { readKept } from "../kept.js";
import { READY_FILE } from "../ready/steps.js";
import { readActOn, type ActOn } from "../review/act-on.js";
import { dataFence } from "../review/fence.js";

export const MAX_TASK_CHARS = 20_000;

export type TaskSource = {
  readonly recordsDir: string;
  readonly change: number;
};

function openFence(text: string): string {
  return text.split("\n").reduce((open, line) => (open === "" ? fenceOpener(line) : line === open ? "" : open), "");
}

function fenceOpener(line: string): string {
  return /^(`{4,})[\w-]*$/.exec(line)?.[1] ?? "";
}

export function capped(text: string): string {
  if (text.length <= MAX_TASK_CHARS) {
    return text;
  }
  const cut = text.slice(0, MAX_TASK_CHARS);
  const open = openFence(cut);
  return `${cut}${open === "" ? "" : `\n${open}`}\n\n(cut at ${MAX_TASK_CHARS} characters)\n`;
}

function finding(f: ActOn, i: number): string {
  const text = [`${f.id} · ${f.file}:${f.line} · ${f.rule} (${f.severity})`, "", f.finding, "", `Fix: ${f.fix}`];
  return dataFence({ title: `finding ${i + 1}`, text: text.join("\n") });
}

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

function job(j: FailedJob, i: number): string {
  const title = `failed job ${i + 1}: its name, then ${j.log.kind === "tail" ? "the end of its log" : "why it has no log"}`;
  const rest = j.log.kind === "tail" ? j.log.text : j.log.why;
  return dataFence({ title, text: `${j.name}\n\n${rest}`, info: "text" });
}

export function verifyText(kept: string): string {
  return capped(kept);
}

export function ciText(jobs: readonly FailedJob[]): string {
  return capped(["# CI is red", "", "These jobs failed at your head.", "", ...jobs.map(job)].join("\n"));
}

export async function taskText(
  task: Extract<Task, { readonly kind: "ready-failed" | "act-on" }>,
  source: TaskSource,
): Promise<Result<string>> {
  switch (task.kind) {
    case "ready-failed": {
      const kept = await readKept(
        { recordsDir: source.recordsDir, change: source.change, head: task.head },
        READY_FILE,
      );
      return kept.kind === "ok" ? { kind: "ok", value: capped(kept.value) } : kept;
    }
    case "act-on": {
      const found = await readActOn({ recordsDir: source.recordsDir, change: source.change, head: task.head });
      return found.kind === "ok" ? { kind: "ok", value: actOnText(found.value) } : found;
    }
  }
}
