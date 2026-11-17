// run — one writer run in a fresh box (#113; ADR-0012 S5, S11, S13). The host has made the clone (clone.ts); this
// file runs the agent in it and reads how it ended:
//   1 the project's egress proxy, then the box, with the clone mounted and only the model login and the proxy settings
//   2 the agent CLI's writer command, which the adapter builds from the role card (agent/claude-writer.ts): the prompt
//     on stdin, skip-all only inside a runner, the card's deny list and hooks in .factory/settings.json, and no
//     settings from the branch; the box's user home is empty. Its output is streamed (stream-json): one JSON
//     event a line, the last one the result with the cost, so the host hears the run while it works. A run that prints nothing for the stall time (5 minutes) is
//     stopped and blocked, its last lines shown (#228). Only awake time counts: each poll adds at most two polls'
//     worth, so an hour the machine slept between two polls adds ten seconds, not an hour.
//   3 the box stops; only then is .factory/report.json read (report.ts), and the outcome decided from it and the exit.
//     While the writer runs, the host polls the clone for a report the schema accepts. Once one is there, the writer
//     has a 60 s completion window: an agent whose child (gh, an MCP server) keeps stdout open never exits on its own,
//     so at the window's end the host stops the box and the run ends hungAfterReport, decided from the report read
//     again after the stop (#182; ADR-0012 S13). A run with no valid report is stopped by the host at its timeout and
//     a grace, and is blocked.
//   4 the branch's tip, and the patch-id of everything since the start, which the dispatcher compares run to run
//   5 the run's tokens and cost, from the result event of its stream-json output (#131); a run stopped before it
//     printed one is unmeasured
//   6 what the run said last and the end of its output (#62): the result event's text, or its stderr's last line, and
//     up to OUTPUT_LINES lines of its stdout and stderr, so a run the host blocks can say why (step.ts keeps them)
//   7 its whole stdout, line by line, to the run's trace as it comes (dispatch/trace.ts, #487); step.ts opens and
//     closes it
//   8 a run that exited is read for the provider's usage limit by the agent CLI's own reader
//     (agent/usage-limit.ts): one that hit it ends parked, decided from what the CLI printed, never from its report
// Every box failure is a blocked outcome with the reason, never a guess. Nothing here throws.

import type { ClaudeWriter, WriterCall } from "../agent/claude-writer.js";
import { NO_LIMIT, type UsageLimit } from "../agent/usage-limit.js";
import type { Result } from "../forge/api.js";
import { hostGit, type GitResult } from "../git.js";
import {
  decide,
  endingOf,
  loadFactoryFile,
  loadReport,
  validReport,
  type Ending,
  type Outcome,
  type RunEnd,
} from "../report.js";
import { PR_BODY_PATH } from "../pr-body.js";
import type { Ran, Session } from "../box/index.js";
import { startBox, type BoxSetup } from "../ready/boxrun.js";
import type { Clone } from "./clone.js";
import { outsideScope, scoped, type EditScope } from "./scope.js";
import {
  NO_STREAM,
  spentFailure,
  streamOf,
  streamSpend,
  type FailedSpent,
  type Spend,
  type Stream,
} from "../dispatch/spend.js";
import type { TraceSink } from "../dispatch/trace.js";

// the completion window (#182): how often the host looks for the report while the writer runs, how long the writer may
// keep running after a valid one, and the grace past the run's timeout and past a stop after which the host waits no
// more: the box's own timeout stops counting once claude exits, and a grandchild that holds stdout open would keep
// docker exec, and the dispatcher's locked pass, waiting forever
export type Completion = { readonly pollMs: number; readonly windowMs: number; readonly graceMs: number };

export const COMPLETION: Completion = { pollMs: 5000, windowMs: 60_000, graceMs: 30_000 };

// the stall time (#228): the longest a run may print nothing, while the machine is awake; a setting can only lower it
export const STALL_MS = 5 * 60_000;

export type WriterRun = {
  readonly setup: BoxSetup;
  readonly clone: Clone;
  readonly prompt: string;
  // the model-only login (#136): CLAUDE_CODE_OAUTH_TOKEN and its scrub setting
  readonly login: Readonly<Record<string, string>>;
  readonly timeoutSeconds: number;
  // the agent CLI's writer kind, and what this run asks of it: the box starts its argv for the place it runs at, with
  // its environment besides the login (agent/claude-writer.ts)
  readonly agent: ClaudeWriter;
  readonly call: WriterCall;
  // where the run may edit (scope.ts scopesOf): a path must match each; none is anywhere in the clone
  readonly scopes: readonly EditScope[];
  readonly completion: Completion;
  readonly stallMs: number;
  // where the run's whole output goes as it comes, scrubbed (dispatch/trace.ts, #487)
  readonly trace: TraceSink;
};

export type Ended = {
  readonly outcome: Outcome;
  readonly ending: Ending;
  readonly tip: string;
  readonly patch: string;
  // what the run spent, as its result event reported it (#131)
  readonly spend: Spend | "unmeasured";
  // the PR body the run wrote in .factory/pr.md, as it wrote it, when it ended done (#335); the host cleans it before
  // it posts it (renderBody)
  readonly pr?: string;
  // what the run said last (#62): its result event's text, else its stderr's last line, else its last plain stdout
  // line; "" when it said nothing. Raw: the host scrubs and cuts it before it records or shows it (why.ts)
  readonly said: string;
  // the end of what the run printed (#62): its stdout's last lines, then its stderr's; raw, as said
  readonly output: readonly string[];
  // the run's trace, once step.ts has closed it (#487); none when none was kept
  readonly trace?: string;
};

// runEnd : how the run ended, as the report reads it. Pure.
export function runEnd(ran: Ran): RunEnd {
  switch (ran.kind) {
    case "exited":
      return { kind: "exited", code: ran.code };
    case "timedOut":
      return { kind: "timedOut", seconds: ran.seconds };
    case "failed":
      return { kind: "failed", reason: ran.reason };
  }
}

// the most lines a stalled run shows, and the most characters kept of each: an event can be a whole file
const SHOWN_LINES = 5;
const LINE_CHARS = 300;

// Tail : the last lines the run printed, and the line it is still printing
export type Tail = { readonly lines: readonly string[]; readonly partial: string };

export const NO_TAIL: Tail = { lines: [], partial: "" };

function cutLine(line: string): string {
  // never end on half of a surrogate pair
  return line.length <= LINE_CHARS ? line : line.slice(0, LINE_CHARS).replace(/[\uD800-\uDBFF]$/, "");
}

// the most lines of a run's output the host keeps for a person (#62)
export const OUTPUT_LINES = 40;

// tailOf : the tail after one more piece of output, the lines a stalled run shows. Pure.
export function tailOf(tail: Tail, chunk: string): Tail {
  return tailUpTo(tail, chunk, SHOWN_LINES);
}

// tailUpTo : the tail after one more piece of output, at most `most` lines. Pure.
export function tailUpTo(tail: Tail, chunk: string, most: number): Tail {
  const [first = "", ...rest] = chunk.split("\n");
  const current = cutLine(tail.partial + cutLine(first));
  if (rest.length === 0) {
    return { lines: tail.lines, partial: current };
  }
  const ended = [current, ...rest.slice(0, -1)].filter((l) => l.trim() !== "").map(cutLine);
  return { lines: [...tail.lines, ...ended].slice(-most), partial: cutLine(rest.at(-1) ?? "") };
}

// lastLines : the lines a person sees of a stalled run, oldest first. Pure.
export function lastLines(tail: Tail, most: number = SHOWN_LINES): readonly string[] {
  return [...tail.lines, tail.partial].filter((l) => l.trim() !== "").slice(-most);
}

// Heard : what the host has heard of the run so far: when it last printed (ms; 0 for never), its tail, the longer
// tail kept for a person (#62), and its stream-json output read for the result event (#131)
type Heard = { at: number; tail: Tail; kept: Tail; stream: Stream };

// resultText : the text of the run's result event: its last message, or the CLI's error ("Invalid API key", a budget
// hit); "" with none. Pure.
function resultText(stream: Stream): string {
  const result: unknown = stream.result;
  const text = typeof result === "object" && result !== null ? (Reflect.get(result, "result") as unknown) : undefined;
  return typeof text === "string" ? text.trim() : "";
}

// lastPlain : the last line that is not a stream-json event, "" for none. Pure.
function lastPlain(lines: readonly string[]): string {
  return lines.findLast((l) => l.trim() !== "" && !l.trimStart().startsWith("{"))?.trim() ?? "";
}

// heardOf : what the run said last, and the end of its output: stdout's lines, then stderr's. Pure.
export function heardOf(input: {
  readonly stdout: readonly string[];
  readonly stderr: string;
  readonly stream: Stream;
}): {
  readonly said: string;
  readonly output: readonly string[];
} {
  const err = lastLines(tailUpTo(NO_TAIL, `${input.stderr}\n`, OUTPUT_LINES), OUTPUT_LINES);
  const last = resultText(input.stream) || lastPlain(err) || lastPlain(input.stdout);
  return { said: last, output: err.length === 0 ? input.stdout : [...input.stdout, "--- stderr ---", ...err] };
}

// quietAfter : how long the run has printed nothing, in awake time, after one more poll. Each poll adds the time since
// the last poll, or since the last output if that came later, but never more than two polls: a poll that took longer
// waited out a sleeping machine (or a clock that jumped), and that time does not count (#228). Pure.
export function quietAfter(input: {
  readonly quiet: number;
  readonly last: number;
  readonly heard: number;
  readonly now: number;
  readonly pollMs: number;
}): number {
  const most = 2 * input.pollMs;
  return input.heard > input.last
    ? Math.min(input.now - input.heard, most)
    : input.quiet + Math.min(input.now - input.last, most);
}

// InBox : how the run ended, what it spent, what it said last and the end of its output
type InBox = {
  readonly end: RunEnd;
  readonly spend: Spend | "unmeasured";
  readonly said: string;
  readonly output: readonly string[];
  // the provider's usage limit the run hit, read only from a run that exited
  readonly limit: UsageLimit;
};

// inBox : the agent's run, start to stop; the run's end, or why the box itself failed
async function inBox(run: WriterRun): Promise<InBox> {
  const session = await startBox(run.setup, {
    worktree: run.clone.repo,
    readOnly: run.clone.readOnly,
    env: { ...run.login, ...run.agent.env },
  });
  if (session.kind === "failed") {
    return {
      end: { kind: "failed", reason: session.reason },
      spend: "unmeasured",
      said: "",
      output: [],
      limit: NO_LIMIT,
    };
  }
  const heard: Heard = { at: 0, tail: NO_TAIL, kept: NO_TAIL, stream: NO_STREAM };
  const running = run.setup.box.run({
    session: session.value,
    command: {
      argv: run.agent.argv(run.call, session.value.place),
      stdin: { kind: "text", text: run.prompt },
      timeoutSeconds: run.timeoutSeconds,
      // nothing reads the output after the run (the report says how it ended): keep only its end, so no cap stops it;
      // the whole output goes to the run's trace as it comes (#487)
      keep: "tail",
      watch: (chunk) => {
        heard.at = Date.now();
        heard.tail = tailOf(heard.tail, chunk);
        heard.kept = tailUpTo(heard.kept, chunk, OUTPUT_LINES);
        heard.stream = streamOf(heard.stream, chunk);
        run.trace.write(chunk);
      },
    },
  });
  const end = await watched(run, running, heard);
  const stopped = await stoppedEnd(run, session.value, running, { end, heard });
  return { end: stopped, spend: streamSpend(heard.stream), ...lastWords(end, heard), limit: limitOf(run, end, heard) };
}

// limitOf : the provider's usage limit a run that exited hit, read by the agent CLI from what it printed: a refusal is
// an error result, so a run that finished its work never reads as one
function limitOf(run: WriterRun, end: Watched, heard: Heard): UsageLimit {
  const exited = end.kind === "ran" && end.ran.kind === "exited" ? end.ran : undefined;
  return exited === undefined
    ? NO_LIMIT
    : run.agent.usageLimit({
        result: heard.stream.result,
        stderr: exited.stderr,
        windows: heard.stream.windows,
        endedAt: Date.now(),
      });
}

// lastWords : what the run said last and the end of its output. An exit hands back its own output's end; a run the
// host stopped has only what the watcher heard. Pure.
function lastWords(end: Watched, heard: Heard): { readonly said: string; readonly output: readonly string[] } {
  const exited = end.kind === "ran" && end.ran.kind === "exited" ? end.ran : undefined;
  if (exited === undefined) {
    return heardOf({ stdout: lastLines(heard.kept, OUTPUT_LINES), stderr: "", stream: heard.stream });
  }
  const stdout = lastLines(tailUpTo(NO_TAIL, `${exited.stdout}\n`, OUTPUT_LINES), OUTPUT_LINES);
  return heardOf({ stdout, stderr: exited.stderr, stream: heard.stream });
}

// afterStop : the end of a run the host stopped. Pure.
function afterStop(run: WriterRun, end: Exclude<Watched, { kind: "ran" }>, heard: Heard): RunEnd {
  switch (end.kind) {
    case "hung":
      return { kind: "hungAfterReport", windowSeconds: Math.round(run.completion.windowMs / 1000) };
    case "stalled":
      return { kind: "stalled", seconds: Math.round(run.stallMs / 1000), last: lastLines(heard.tail) };
    case "overdue":
      return { kind: "timedOut", seconds: run.timeoutSeconds };
  }
}

// stoppedEnd : the box stopped, then the run's end; a box that did not stop may still be writing: its report is never
// read
async function stoppedEnd(
  run: WriterRun,
  session: Session,
  running: Promise<Ran>,
  watch: { readonly end: Watched; readonly heard: Heard },
): Promise<RunEnd> {
  const { end } = watch;
  const stopped = await run.setup.box.stop(session);
  if (stopped.kind === "failed") {
    return { kind: "failed", reason: `the box did not stop: ${stopped.reason}` };
  }
  if (end.kind === "ran") {
    return runEnd(end.ran);
  }
  // the stop ends the command; its own end says nothing more, and the host waits for it only so long
  await settled(running, run.completion.graceMs);
  return afterStop(run, end, watch.heard);
}

// Watched : the run's own end; "hung", still running after a valid report and its window; "stalled", silent for the
// stall time with no valid report; or "overdue", still running past its timeout and the grace with no valid report
type Watched =
  | { readonly kind: "ran"; readonly ran: Ran }
  | { readonly kind: "hung" }
  | { readonly kind: "stalled" }
  | { readonly kind: "overdue" };

const TICK: unique symbol = Symbol("tick");

function after(ms: number): Promise<typeof TICK> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(TICK), Math.max(0, ms)).unref();
  });
}

async function settled(running: Promise<Ran>, ms: number): Promise<Ran | typeof TICK> {
  return Promise.race([running, after(ms)]);
}

// watched : the run, watched until it ends, a valid report's window closes, it is silent for the stall time, or the
// host's deadline passes. A poll only starts the window: the run is decided from the report read after the box
// stopped. A valid report wins over a stall: a writer that wrote one and went quiet gets its window.
async function watched(run: WriterRun, running: Promise<Ran>, heard: Heard): Promise<Watched> {
  const deadline = Date.now() + run.timeoutSeconds * 1000 + run.completion.graceMs;
  let on: On = { kind: "on", quiet: 0, last: Date.now() };
  for (;;) {
    const ran = await settled(running, Math.min(run.completion.pollMs, deadline - Date.now()));
    if (ran !== TICK) {
      return { kind: "ran", ran };
    }
    const next = await polled(run, heard, on, deadline);
    if (next.kind === "window") {
      return inWindow(run, running);
    }
    if (next.kind !== "on") {
      return next;
    }
    on = next;
  }
}

// On : a run still going after a poll, with its quiet time so far and when that poll was
type On = { readonly kind: "on"; readonly quiet: number; readonly last: number };
type Polled = On | { readonly kind: "window" } | { readonly kind: "stalled" } | { readonly kind: "overdue" };

// polled : one poll of a run still going: past the deadline, a valid report there, silent too long, or on
async function polled(run: WriterRun, heard: Heard, on: On, deadline: number): Promise<Polled> {
  const now = Date.now();
  if (now >= deadline) {
    return { kind: "overdue" };
  }
  if (validReport(await loadReport({ worktree: run.clone.repo }))) {
    return { kind: "window" };
  }
  const quiet = quietAfter({ quiet: on.quiet, last: on.last, heard: heard.at, now, pollMs: run.completion.pollMs });
  return quiet >= run.stallMs ? { kind: "stalled" } : { kind: "on", quiet, last: now };
}

// inWindow : the window after a valid report; the box's own timeout firing in it is a hang after that report too, so
// the outcome never depends on when in the run the report came
async function inWindow(run: WriterRun, running: Promise<Ran>): Promise<Watched> {
  const ran = await settled(running, run.completion.windowMs);
  return ran === TICK || ran.kind === "timedOut" ? { kind: "hung" } : { kind: "ran", ran };
}

function said(result: GitResult): string {
  return result.kind === "refused" ? result.reason : result.kind === "failed" ? result.stderr.trim() : "";
}

async function git(run: WriterRun, args: readonly string[], stdin = ""): Promise<Result<string>> {
  const ran = await hostGit({
    args,
    repo: { kind: "repo", path: run.clone.repo },
    env: run.setup.env,
    stdin: stdin === "" ? { kind: "none" } : { kind: "text", text: stdin },
  });
  return ran.kind === "ok"
    ? { kind: "ok", value: ran.stdout }
    : { kind: "failed", reason: `git ${args[0]}: ${said(ran)}` };
}

// patchOf : the patch-id of the run's whole change, "" when it changed nothing
async function patchOf(run: WriterRun, tip: string): Promise<Result<string>> {
  if (tip === run.clone.start) {
    return { kind: "ok", value: "" };
  }
  const diff = await git(run, ["diff", "--no-ext-diff", "--no-textconv", "--no-color", run.clone.start, tip]);
  const id = diff.kind === "ok" ? await git(run, ["patch-id", "--stable"], diff.value) : diff;
  return id.kind === "ok" ? { kind: "ok", value: id.value.split(" ")[0] ?? "" } : id;
}

// committed : the branch's tip after the run, and the patch since the start
async function committed(run: WriterRun): Promise<Result<{ readonly tip: string; readonly patch: string }>> {
  const tip = await git(run, ["rev-parse", `refs/heads/${run.clone.branch}`]);
  if (tip.kind === "failed") {
    return tip;
  }
  const sha = tip.value.trim();
  const patch = await patchOf(run, sha);
  return patch.kind === "ok" ? { kind: "ok", value: { tip: sha, patch: patch.value } } : patch;
}

// reasonOf : the first of two results' reasons; "" when both are ok. Pure.
function reasonOf(a: Result<unknown>, b: Result<unknown>): string {
  return a.kind === "failed" ? a.reason : b.kind === "failed" ? b.reason : "";
}

// changedPaths : every path the run's commits touch, a rename as both its paths; none when it changed nothing
async function changedPaths(run: WriterRun, tip: string): Promise<Result<readonly string[]>> {
  if (tip === run.clone.start || run.scopes.length === 0) {
    return { kind: "ok", value: [] };
  }
  const names = await git(run, ["diff", "--no-ext-diff", "--no-renames", "--name-only", "-z", run.clone.start, tip]);
  return names.kind === "ok" ? { kind: "ok", value: names.value.split("\0").filter((p) => p !== "") } : names;
}

// prOf : the PR body a done run wrote, read after the box stopped, as a field to spread; none when it wrote none, or
// one the host cannot read safely (a symlink, too large)
async function prOf(run: WriterRun, outcome: Outcome): Promise<{ readonly pr?: string }> {
  if (outcome.kind !== "done") {
    return {};
  }
  const file = await loadFactoryFile({ worktree: run.clone.repo, path: PR_BODY_PATH });
  return file.kind === "text" && file.text.trim() !== "" ? { pr: file.text } : {};
}

// outcomeOf : the run's outcome: parked when the provider's usage limit refused it, decided from what the CLI printed;
// else decided from its end and its report, read after the box stopped
async function outcomeOf(run: WriterRun, end: RunEnd, limit: UsageLimit): Promise<Outcome> {
  if (limit.kind === "limited") {
    return { kind: "parked", until: limit.until, said: limit.said };
  }
  return decide({
    end,
    file: end.kind === "failed" ? { kind: "missing" } : await loadReport({ worktree: run.clone.repo }),
  });
}

// writerRun : the run, then its outcome, the branch's tip, the patch and the PR body it wrote. A failure here is the
// host's, not the run's, and still says what the run spent.
export async function writerRun(run: WriterRun): Promise<Result<Ended> | FailedSpent> {
  const { end, spend, said: words, output, limit } = await inBox(run);
  const outcome = await outcomeOf(run, end, limit);
  const pr = await prOf(run, outcome);
  const tip = await committed(run);
  const paths = tip.kind === "ok" ? await changedPaths(run, tip.value.tip) : tip;
  if (tip.kind === "failed" || paths.kind === "failed") {
    return spentFailure(`cannot read what the run committed: ${reasonOf(tip, paths)}`, spend);
  }
  const final = scoped(outcome, outsideScope(paths.value, run.scopes), run.scopes);
  return {
    kind: "ok",
    value: { outcome: final, ending: endingOf(end), spend, said: words, output, ...pr, ...tip.value },
  };
}
