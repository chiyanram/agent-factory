// run — one writer run in a fresh box (#113; ADR-0012 S5, S11, S13). The host has made the clone (clone.ts); this
// file runs the agent in it and reads how it ended:
//   1 the project's egress proxy, then the box, with the clone mounted and only the model login and the proxy settings
//   2 claude -p, the prompt on stdin, skip-all permissions (S11: allowed in the vm box), each plugin with --plugin-dir, and
//     no settings from the branch: --setting-sources user drops its .claude/settings.json, hooks, env and .mcp.json,
//     and the box's user home is empty (#110; checked on a real run, decision on #110, 2026-11-08). Its output is
//     streamed (stream-json, which -p takes only with --verbose): one JSON event a line, the last one the result with
//     the cost, so the host hears the run while it works. A run that prints nothing for the stall time (5 minutes) is
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
// Every box failure is a blocked outcome with the reason, never a guess. Nothing here throws.

import type { Argv } from "../project.js";
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
import { pluginPaths, type Clone } from "./clone.js";
import { NO_STREAM, streamOf, streamSpend, type Spend, type Stream } from "../dispatch/spend.js";

export type Claude = {
  // "" for no cap (FACTORY_MAX_USD)
  readonly maxUsd: string;
  // "" for Claude's default (FACTORY_WRITER_MODEL)
  readonly model: string;
};

// the completion window (#182): how often the host looks for the report while the writer runs, how long the writer may
// keep running after a valid one, and the grace past the run's timeout and past a stop after which the host waits no
// more: the box's own timeout stops counting once claude exits, and a grandchild that holds stdout open would keep
// docker exec, and the dispatcher's locked pass, waiting forever
export type Completion = { readonly pollMs: number; readonly windowMs: number; readonly graceMs: number };

export const COMPLETION: Completion = { pollMs: 5000, windowMs: 60_000, graceMs: 30_000 };

// the stall time (#228): the longest a run may print nothing, while the machine is awake; a setting can only lower it
export const STALL_MS = 5 * 60_000;

// the writer's settings file in the clone, for claude --settings (tools.ts), or none
export type SettingsArg = { readonly kind: "none" } | { readonly kind: "file"; readonly path: string };

export type WriterRun = {
  readonly setup: BoxSetup;
  readonly clone: Clone;
  readonly prompt: string;
  // the model-only login (#136): CLAUDE_CODE_OAUTH_TOKEN and its scrub setting
  readonly login: Readonly<Record<string, string>>;
  readonly timeoutSeconds: number;
  readonly claude: Claude;
  readonly settings: SettingsArg;
  // how many plugins the clone holds (clone.ts pluginPaths)
  readonly plugins: number;
  // the role card's tools (process/cards.ts): the run gets these and no others (#232)
  readonly tools: readonly string[];
  readonly completion: Completion;
  readonly stallMs: number;
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
};

// only the model API is needed: no update checks, no telemetry, so the egress list holds api.anthropic.com alone
const QUIET: Readonly<Record<string, string>> = {
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  DISABLE_AUTOUPDATER: "1",
};

// the claude tools each role card tool stands for: a card's Edit also writes a new file. With any tools, a run also
// gets claude's helpers that add no reach of their own: its task list, its skills (read like any file), and subagents,
// which get the same tools.
const CLAUDE_TOOLS: Readonly<Record<string, readonly string[]>> = {
  Read: ["Read"],
  Grep: ["Grep"],
  Glob: ["Glob"],
  Edit: ["Edit", "Write"],
  Bash: ["Bash"],
};
const HELPERS = ["TodoWrite", "Skill", "Task"];

// claudeTools : the --tools value for a card's tools, in claude's names. Pure.
export function claudeTools(tools: readonly string[]): string {
  const named = tools.flatMap((t) => CLAUDE_TOOLS[t] ?? []);
  return [...new Set([...named, ...(named.length === 0 ? [] : HELPERS)])].join(",");
}

// claudeArgv : the writer's command. Pure. The prompt goes on stdin; the plugin and settings paths are relative to the
// clone. The run gets only the role card's tools (#232).
export function claudeArgv(claude: Claude, settings: SettingsArg, plugins: number, tools: readonly string[]): Argv {
  return [
    "claude",
    "-p",
    "--setting-sources",
    "user",
    "--dangerously-skip-permissions",
    ...pluginArgs(plugins),
    "--tools",
    claudeTools(tools),
    "--output-format",
    "stream-json",
    "--verbose",
    ...(claude.maxUsd === "" ? [] : ["--max-budget-usd", claude.maxUsd]),
    ...(claude.model === "" ? [] : ["--model", claude.model]),
    ...(settings.kind === "file" ? ["--settings", settings.path] : []),
  ];
}

// pluginArgs : one --plugin-dir per plugin the clone holds, in order. Pure.
function pluginArgs(count: number): readonly string[] {
  return pluginPaths(count).flatMap((dir) => ["--plugin-dir", dir]);
}

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

// tailOf : the tail after one more piece of output. Pure.
export function tailOf(tail: Tail, chunk: string): Tail {
  const [first = "", ...rest] = chunk.split("\n");
  const current = cutLine(tail.partial + cutLine(first));
  if (rest.length === 0) {
    return { lines: tail.lines, partial: current };
  }
  const ended = [current, ...rest.slice(0, -1)].filter((l) => l.trim() !== "").map(cutLine);
  return { lines: [...tail.lines, ...ended].slice(-SHOWN_LINES), partial: cutLine(rest.at(-1) ?? "") };
}

// lastLines : the lines a person sees of a stalled run, oldest first. Pure.
export function lastLines(tail: Tail): readonly string[] {
  return [...tail.lines, tail.partial].filter((l) => l.trim() !== "").slice(-SHOWN_LINES);
}

// Heard : what the host has heard of the run so far: when it last printed (ms; 0 for never), its tail, and its
// stream-json output read for the result event (#131)
type Heard = { at: number; tail: Tail; stream: Stream };

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

// InBox : how the run ended, and what it spent
type InBox = { readonly end: RunEnd; readonly spend: Spend | "unmeasured" };

// inBox : the agent's run, start to stop; the run's end, or why the box itself failed
async function inBox(run: WriterRun): Promise<InBox> {
  const session = await startBox(run.setup, {
    worktree: run.clone.repo,
    readOnly: run.clone.readOnly,
    env: { ...run.login, ...QUIET },
  });
  if (session.kind === "failed") {
    return { end: { kind: "failed", reason: session.reason }, spend: "unmeasured" };
  }
  const heard: Heard = { at: 0, tail: NO_TAIL, stream: NO_STREAM };
  const running = run.setup.box.run({
    session: session.value,
    command: {
      argv: claudeArgv(run.claude, run.settings, run.plugins, run.tools),
      stdin: { kind: "text", text: run.prompt },
      timeoutSeconds: run.timeoutSeconds,
      // nothing reads the output after the run (the report says how it ended): keep only its end, so no cap stops it
      keep: "tail",
      watch: (chunk) => {
        heard.at = Date.now();
        heard.tail = tailOf(heard.tail, chunk);
        heard.stream = streamOf(heard.stream, chunk);
      },
    },
  });
  const end = await watched(run, running, heard);
  const stopped = await stoppedEnd(run, session.value, running, { end, heard });
  return { end: stopped, spend: streamSpend(heard.stream) };
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

// prOf : the PR body a done run wrote, read after the box stopped, as a field to spread; none when it wrote none, or
// one the host cannot read safely (a symlink, too large)
async function prOf(run: WriterRun, outcome: Outcome): Promise<{ readonly pr?: string }> {
  if (outcome.kind !== "done") {
    return {};
  }
  const file = await loadFactoryFile({ worktree: run.clone.repo, path: PR_BODY_PATH });
  return file.kind === "text" && file.text.trim() !== "" ? { pr: file.text } : {};
}

// writerRun : the run, then its outcome, the branch's tip, the patch and the PR body it wrote. A failure here is the
// host's, not the run's.
export async function writerRun(run: WriterRun): Promise<Result<Ended>> {
  const { end, spend } = await inBox(run);
  const outcome = decide({
    end,
    file: end.kind === "failed" ? { kind: "missing" } : await loadReport({ worktree: run.clone.repo }),
  });
  const pr = await prOf(run, outcome);
  const tip = await committed(run);
  return tip.kind === "ok"
    ? { kind: "ok", value: { outcome, ending: endingOf(end), spend, ...pr, ...tip.value } }
    : { kind: "failed", reason: `cannot read what the run committed: ${tip.reason}` };
}
