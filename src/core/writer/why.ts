// why — what a person reads when a writer run stops short of done (#62). A run that ended blocked or asked carries its
// reason into the run record, the orchestrator loop's log and the ping, even when there is no change yet to post it
// on. A run the host blocked (a non-zero exit, no report or a malformed one, a timeout, a stall) also keeps the end of
// what it printed in a file under <home>/runs/<project>/<ticket>/, named by the time, since its clone is gone.
//
// The words come from the run and the agent CLI, so they are made safe first: anything that looks like a token or a
// key is scrubbed (scrubSecrets), the reason is one line of plain text, cut at WHY_CHARS. The record and the log are
// the operator's own files; a post on the change still goes only through post.ts's templates.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Result } from "../forge/api.js";
import { attempt } from "../review/safe.js";
import { recordPath } from "../dispatch/records.js";
import { flatText } from "../post.js";
import type { Outcome, Question } from "../report.js";
import { scrubSecrets } from "../scrub.js";

export { SCRUBBED, scrubSecrets } from "../scrub.js";

// the most characters of a reason kept in a record and a log line
export const WHY_CHARS = 500;

// whyText : a reason as a record and a log line hold it: scrubbed, one line, at most WHY_CHARS. Pure.
export function whyText(text: string): string {
  const flat = flatText(scrubSecrets(text));
  const chars = Array.from(flat);
  return chars.length <= WHY_CHARS
    ? flat
    : `${chars
        .slice(0, WHY_CHARS - 1)
        .join("")
        .trimEnd()}…`;
}

function asked(questions: readonly Question[]): string {
  return `the writer asked: ${questions.map((q) => q.question).join("; ")}`;
}

// whyOf : why a run that is not done stopped, from its outcome and what the run said last; "" for done. A reason the
// host decided (a non-zero exit, no report) gets the run's last words, so "the run exited 1" says what failed. Pure.
export function whyOf(outcome: Outcome, said: string): string {
  switch (outcome.kind) {
    case "done":
      return "";
    case "asked":
      return whyText(asked(outcome.questions));
    case "blocked":
      return whyText(withSaid(outcome.reason, outcome.by === "host" ? said : ""));
  }
}

// withSaid : a reason and what the run said last. Pure.
export function withSaid(reason: string, said: string): string {
  return said.trim() === "" ? reason : `${reason}; the run said: ${said}`;
}

// outputName : the file name for a run's kept output: the time, with no ":" so it is a plain name everywhere. Pure.
export function outputName(at: number): string {
  return `writer-${new Date(at).toISOString().replace(/[:.]/g, "-")}.log`;
}

// keepOutput : the end of a run's output, scrubbed, in <home>/runs/<project>/<ticket>/<outputName>; the file's path
export async function keepOutput(input: {
  readonly home: string;
  readonly project: string;
  readonly ticket: string;
  readonly at: number;
  readonly lines: readonly string[];
}): Promise<Result<string>> {
  const records = recordPath(input);
  if (records.kind === "failed") {
    return records;
  }
  const dir = records.value.slice(0, -".jsonl".length);
  const path = join(dir, outputName(input.at));
  const text = `${input.lines.map(scrubSecrets).join("\n")}\n`;
  const kept = await attempt(async () => {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(path, text, { mode: 0o600 });
  }, `cannot keep the run's output in ${dir}`);
  return kept.kind === "ok" ? { kind: "ok", value: path } : kept;
}
