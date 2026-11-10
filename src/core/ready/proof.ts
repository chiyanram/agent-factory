// proof — whether an evidence row can prove its criterion at all (#444). Running a row again shows the command still
// exits 0; it does not show the command says anything about the criterion. Two rows are refused, with the reason the
// writer reads in its rework:
//   a gate run for many   the same gate command (the local gate's verify command, or a listed build program run with
//                         only gate tasks such as `./gradlew check` or `make test`) given verbatim for more than one
//                         criterion: a build passing is never the evidence for what a file says. Read before any box
//                         starts.
//   prose                 a row whose command printed something, and whose result quotes none of it: a description
//                         of the output, not the output. Read after the rows ran, from what each printed at the head.
// Both are checks of the row, never of the code: the floor guard and the rows' exit codes judge the code.

import type { Argv, ProjectFile } from "../project.js";
import type { Evidence } from "../report.js";
import { READ_ONLY_PROGRAMS } from "./command.js";

// the words a gate command runs: the build's own tasks, never a filter that picks a test
const GATE_TASKS: ReadonlySet<string> = new Set(["check", "test", "build", "verify", "lint", "clean", "all", "ci"]);

// isGateRun : argv runs the project's gate: its verify command, or a listed build program with only gate tasks and
// options. Pure.
export function isGateRun(argv: Argv, project: ProjectFile): boolean {
  const verify = project.gate.kind === "local" ? project.gate.verify.join(" ") : "";
  return argv.join(" ") === verify || buildTasks(argv, project);
}

// buildTasks : a listed build program, never a read-only one, run with gate tasks and options alone. Pure.
function buildTasks(argv: Argv, project: ProjectFile): boolean {
  const [program, ...rest] = argv;
  const build = project.ready.programs.includes(program) && !READ_ONLY_PROGRAMS.includes(program);
  return build && rest.some((w) => GATE_TASKS.has(w)) && rest.every((w) => GATE_TASKS.has(w) || w.startsWith("-"));
}

// gateReused : why the rows give one gate command for more than one criterion, or "" when none does. Pure.
export function gateReused(evidence: readonly Evidence[], argvs: readonly Argv[], project: ProjectFile): string {
  const seen = new Map<string, number[]>();
  argvs.forEach((argv, i) => {
    if (isGateRun(argv, project)) {
      const key = argv.join(" ");
      seen.set(key, [...(seen.get(key) ?? []), i]);
    }
  });
  const [command, rows] = [...seen].find(([, at]) => at.length > 1) ?? ["", []];
  if (rows.length === 0) {
    return "";
  }
  const named = rows.map((i) => `${i + 1} (${evidence[i]?.criterion ?? ""})`).join(", ");
  return `rows ${named} all give ${JSON.stringify(command)}: a gate run is never the evidence for more than one criterion, and never for what a file says. Give each criterion a command that shows it, such as grep or git diff for a file's content`;
}

// words : the words of a text that carry meaning: four letters or more, lower case. Pure.
function words(text: string): ReadonlySet<string> {
  return new Set(text.toLowerCase().match(/[a-z][a-z0-9_]{3,}/g) ?? []);
}

// plain : a line with its blanks collapsed, lower case. Pure.
function plain(line: string): string {
  return line.replace(/\s+/g, " ").trim().toLowerCase();
}

function linesOf(text: string): readonly string[] {
  return text
    .split("\n")
    .map(plain)
    .filter((l) => /[a-z0-9]/.test(l));
}

// quotes : the result quotes the printed output: it holds a whole printed line, a line of it is in the output (a
// fragment such as BUILD SUCCESSFUL, without its time), or it shares two meaningful words with it. Pure.
export function quotes(result: string, printed: string): boolean {
  const said = plain(result);
  const out = linesOf(printed);
  const all = out.join("\n");
  if (out.some((l) => said.includes(l)) || linesOf(result).some((l) => l.length >= 3 && all.includes(l))) {
    return true;
  }
  const outWords = words(printed);
  return [...words(result)].filter((w) => outWords.has(w)).length >= 2;
}

// unquoted : the first row whose result is prose, not what its command printed, and why; "none" when each quotes it.
// A command that printed nothing answers with its exit code alone, so any result stands. Pure.
export function unquoted(
  evidence: readonly Evidence[],
  printed: readonly string[],
): { readonly at: number; readonly why: string } | "none" {
  const bad = printed.findIndex((out, i) => out.trim() !== "" && !quotes(evidence[i]?.result ?? "", out));
  const row = evidence[bad];
  return row === undefined
    ? "none"
    : {
        at: bad,
        why: `row ${bad + 1} (${row.criterion}): its result does not quote what ${JSON.stringify(row.command)} printed: copy a line of the command's own output into the result, never a description of it`,
      };
}
