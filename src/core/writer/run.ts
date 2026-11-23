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
import { refusedLogin } from "../agent/login.js";
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
import { RENEW } from "../token/rules.js";
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
import { DEFAULT_MODEL, runsField, type Reported, type RunNamed } from "../agent/ran.js";

export type Completion = { readonly pollMs: number; readonly windowMs: number; readonly graceMs: number };

export const COMPLETION: Completion = { pollMs: 5000, windowMs: 60_000, graceMs: 30_000 };

export const STALL_MS = 5 * 60_000;

export type WriterRun = {
  readonly setup: BoxSetup;
  readonly clone: Clone;
  readonly prompt: string;
  readonly login: Readonly<Record<string, string>>;
  readonly timeoutSeconds: number;
  readonly agent: ClaudeWriter;
  readonly call: WriterCall;
  readonly scopes: readonly EditScope[];
  readonly completion: Completion;
  readonly stallMs: number;
  readonly trace: TraceSink;
};

export type Ended = {
  readonly outcome: Outcome;
  readonly ending: Ending;
  readonly tip: string;
  readonly patch: string;
  readonly spend: Spend | "unmeasured";
  readonly runs: readonly RunNamed[];
  readonly pr?: string;
  readonly said: string;
  readonly output: readonly string[];
  readonly trace?: string;
};

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

const SHOWN_LINES = 5;
const LINE_CHARS = 300;

export type Tail = { readonly lines: readonly string[]; readonly partial: string };

export const NO_TAIL: Tail = { lines: [], partial: "" };

function cutLine(line: string): string {
  return line.length <= LINE_CHARS ? line : line.slice(0, LINE_CHARS).replace(/[\uD800-\uDBFF]$/, "");
}

export const OUTPUT_LINES = 40;

export function tailOf(tail: Tail, chunk: string): Tail {
  return tailUpTo(tail, chunk, SHOWN_LINES);
}

export function tailUpTo(tail: Tail, chunk: string, most: number): Tail {
  const [first = "", ...rest] = chunk.split("\n");
  const current = cutLine(tail.partial + cutLine(first));
  if (rest.length === 0) {
    return { lines: tail.lines, partial: current };
  }
  const ended = [current, ...rest.slice(0, -1)].filter((l) => l.trim() !== "").map(cutLine);
  return { lines: [...tail.lines, ...ended].slice(-most), partial: cutLine(rest.at(-1) ?? "") };
}

export function lastLines(tail: Tail, most: number = SHOWN_LINES): readonly string[] {
  return [...tail.lines, tail.partial].filter((l) => l.trim() !== "").slice(-most);
}

type Heard = { at: number; tail: Tail; kept: Tail; stream: Stream };

const RENEW_REFUSED = `the claude token was refused (HTTP 401); ${RENEW}`;

function resultText(stream: Stream): string {
  const result: unknown = stream.result;
  const text = typeof result === "object" && result !== null ? (Reflect.get(result, "result") as unknown) : undefined;
  const plain = typeof text === "string" ? text.trim() : "";
  return refusedLogin(result) ? `${RENEW_REFUSED}; the CLI said: ${plain}` : plain;
}

function lastPlain(lines: readonly string[]): string {
  return lines.findLast((l) => l.trim() !== "" && !l.trimStart().startsWith("{"))?.trim() ?? "";
}

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

type InBox = {
  readonly end: RunEnd;
  readonly spend: Spend | "unmeasured";
  readonly reported?: Reported;
  readonly said: string;
  readonly output: readonly string[];
  readonly limit: UsageLimit;
};

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
  return {
    end: stopped,
    spend: streamSpend(heard.stream),
    reported: heard.stream.init ?? {},
    ...lastWords(end, heard),
    limit: limitOf(run, end, heard),
  };
}

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

function lastWords(end: Watched, heard: Heard): { readonly said: string; readonly output: readonly string[] } {
  const exited = end.kind === "ran" && end.ran.kind === "exited" ? end.ran : undefined;
  if (exited === undefined) {
    return heardOf({ stdout: lastLines(heard.kept, OUTPUT_LINES), stderr: "", stream: heard.stream });
  }
  const stdout = lastLines(tailUpTo(NO_TAIL, `${exited.stdout}\n`, OUTPUT_LINES), OUTPUT_LINES);
  return heardOf({ stdout, stderr: exited.stderr, stream: heard.stream });
}

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
  await settled(running, run.completion.graceMs);
  return afterStop(run, end, watch.heard);
}

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

type On = { readonly kind: "on"; readonly quiet: number; readonly last: number };
type Polled = On | { readonly kind: "window" } | { readonly kind: "stalled" } | { readonly kind: "overdue" };

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

async function patchOf(run: WriterRun, tip: string): Promise<Result<string>> {
  if (tip === run.clone.start) {
    return { kind: "ok", value: "" };
  }
  const diff = await git(run, ["diff", "--no-ext-diff", "--no-textconv", "--no-color", run.clone.start, tip]);
  const id = diff.kind === "ok" ? await git(run, ["patch-id", "--stable"], diff.value) : diff;
  return id.kind === "ok" ? { kind: "ok", value: id.value.split(" ")[0] ?? "" } : id;
}

async function committed(run: WriterRun): Promise<Result<{ readonly tip: string; readonly patch: string }>> {
  const tip = await git(run, ["rev-parse", `refs/heads/${run.clone.branch}`]);
  if (tip.kind === "failed") {
    return tip;
  }
  const sha = tip.value.trim();
  const patch = await patchOf(run, sha);
  return patch.kind === "ok" ? { kind: "ok", value: { tip: sha, patch: patch.value } } : patch;
}

function reasonOf(a: Result<unknown>, b: Result<unknown>): string {
  return a.kind === "failed" ? a.reason : b.kind === "failed" ? b.reason : "";
}

async function changedPaths(run: WriterRun, tip: string): Promise<Result<readonly string[]>> {
  if (tip === run.clone.start || run.scopes.length === 0) {
    return { kind: "ok", value: [] };
  }
  const names = await git(run, ["diff", "--no-ext-diff", "--no-renames", "--name-only", "-z", run.clone.start, tip]);
  return names.kind === "ok" ? { kind: "ok", value: names.value.split("\0").filter((p) => p !== "") } : names;
}

async function prOf(run: WriterRun, outcome: Outcome): Promise<{ readonly pr?: string }> {
  if (outcome.kind !== "done") {
    return {};
  }
  const file = await loadFactoryFile({ worktree: run.clone.repo, path: PR_BODY_PATH });
  return file.kind === "text" && file.text.trim() !== "" ? { pr: file.text } : {};
}

async function outcomeOf(run: WriterRun, end: RunEnd, limit: UsageLimit): Promise<Outcome> {
  if (limit.kind === "limited") {
    return { kind: "parked", until: limit.until, said: limit.said };
  }
  return decide({
    end,
    file: end.kind === "failed" ? { kind: "missing" } : await loadReport({ worktree: run.clone.repo }),
  });
}

function runsOf(run: WriterRun, reported: Reported | undefined): readonly RunNamed[] {
  const asked = run.call.claude.model === "" ? DEFAULT_MODEL : run.call.claude.model;
  return reported === undefined ? [] : [{ cli: run.agent.name, asked, ...reported }];
}

export async function writerRun(run: WriterRun): Promise<Result<Ended> | FailedSpent> {
  const { end, spend, reported, said: words, output, limit } = await inBox(run);
  const runs = runsOf(run, reported);
  const outcome = await outcomeOf(run, end, limit);
  const pr = await prOf(run, outcome);
  const tip = await committed(run);
  const paths = tip.kind === "ok" ? await changedPaths(run, tip.value.tip) : tip;
  if (tip.kind === "failed" || paths.kind === "failed") {
    const failed = spentFailure(`cannot read what the run committed: ${reasonOf(tip, paths)}`, spend);
    return { ...failed, ...runsField(runs) };
  }
  const final = scoped(outcome, outsideScope(paths.value, run.scopes), run.scopes);
  return {
    kind: "ok",
    value: { outcome: final, ending: endingOf(end), spend, runs, said: words, output, ...pr, ...tip.value },
  };
}
