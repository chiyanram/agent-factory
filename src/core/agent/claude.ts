// claude — the Claude Code adapter behind the agent seam (ADR-0022): its read-only run and its sessions list. The
// read-only run is `claude -p` in a folder that holds only the pack and the code copy:
//   --restricted            no command or web tools, no settings files, file tools held to this folder
//   --strict-mcp-config     no MCP servers
//   --tools Read,Grep,Glob  and nothing else; a role card may narrow them (process/cards.ts), never widen them
//   --max-budget-usd        FACTORY_MAX_USD, when set (ADR-0011 D14)
//   --json-schema           the answer is structured output, checked by the CLI
//   --output-format stream-json --verbose
//                           one JSON event a line: the tool calls, then the result event with the answer; the whole
//                           stream is the run's trace, and the answer is the last result event, since a summary
//                           event can follow it
// Never resumed, never continued: every pass is a new session. The host keeps the run's time: past its limit the CLI
// and everything it started are stopped, and the run answers failed with the reason (ADR-0012 S7).
//
// The CLI gets only the environment it needs (CLAUDE_ENV): no git host token, no FACTORY_* (ADR-0012 S2, S6).

import { prop } from "../dispatch/records.js";
import { NO_STREAM, spendOf, streamOf } from "../dispatch/spend.js";
import type { Result } from "../forge/api.js";
import type { Sessions } from "../review/live.js";
import type { Model, ModelResult, ModelRun } from "../review/model.js";
import { settingName } from "../settings/machine.js";
import { timed, type FolderRunner } from "./folder.js";

const READ_ONLY = ["Read", "Grep", "Glob"];

export function claudeArgs(run: ModelRun): readonly string[] {
  const cap = run.maxUsd === "" ? [] : ["--max-budget-usd", run.maxUsd];
  return [
    "-p",
    "-n",
    run.name,
    "--model",
    run.model,
    "--restricted",
    "--strict-mcp-config",
    "--tools",
    READ_ONLY.filter((t) => run.tools === undefined || run.tools.includes(t)).join(","),
    ...cap,
    "--output-format",
    "stream-json",
    "--verbose",
    "--json-schema",
    run.schema,
    run.prompt,
  ];
}

function failure(answer: unknown, stderr: string): string {
  const said = [prop(answer, "subtype"), prop(answer, "result")].filter((s) => typeof s === "string").join(": ");
  return (said || stderr.trim().split("\n")[0] || "no answer").slice(0, 200);
}

// lastResult : the last result event of the stream; a stream with none, or output that is no stream, has none
function lastResult(stdout: string): unknown {
  return streamOf(NO_STREAM, `${stdout}\n`).result;
}

// readAnswer : the structured output of one run, or why there is none
export function readAnswer(input: {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}): ModelResult {
  const answer = lastResult(input.stdout);
  const output = prop(answer, "structured_output");
  const stream = input.stdout;
  const ok = input.code === 0 && prop(answer, "is_error") === false && output !== undefined;
  if (!ok) {
    return { kind: "failed", reason: failure(answer, input.stderr), answer, stream };
  }
  const spent = spendOf(answer);
  return { kind: "ok", value: { output, answer, costUsd: spent.usd, tokens: spent.tokens, stream } };
}

// stopped : a run the limit stopped: failed, with what it streamed before the stop kept as its trace and spend
function stopped(run: ModelRun, stdout: string): ModelResult {
  return {
    kind: "failed",
    reason: `stopped at its ${run.limit.minutes}-minute limit (${run.limit.setting})`,
    answer: lastResult(stdout),
    stream: stdout,
  };
}

const CLAUDE_ENV = new Set([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "LANG",
  "TMPDIR",
  "CLAUDE_CONFIG_DIR",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "NO_PROXY",
  "https_proxy",
  "http_proxy",
  "no_proxy",
  // the company CA (egress.caCerts)
  settingName("egress.caCerts"),
  "SSL_CERT_FILE",
]);

// claudeEnv : the environment the claude CLI gets: what it needs to run and sign in, and nothing else
export function claudeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env).filter(
      ([name, value]) =>
        value !== undefined && (CLAUDE_ENV.has(name) || name.startsWith("LC_") || name.startsWith("ANTHROPIC_")),
    ),
  );
}

export type ClaudeSetup = {
  readonly bin: string;
  readonly env: NodeJS.ProcessEnv;
  readonly run: FolderRunner;
  // how long a minute of a run's limit is; a test makes it short
  readonly minuteMs: number;
  // how long the sessions list may take
  readonly sessionsMs: number;
};

// claudeModel : the read-only run, through the claude CLI, stopped at its limit
export function claudeModel(setup: ClaudeSetup): Model {
  return async (run) => {
    const call = { bin: setup.bin, args: claudeArgs(run), env: setup.env, cwd: run.folder };
    const { exit, late } = await timed(setup.run, call, run.limit.minutes * setup.minuteMs);
    // a CLI that answered and exited stands, even when a process it left held its output open past the limit
    const read = readAnswer(exit);
    return late && read.kind === "failed" ? stopped(run, exit.stdout) : read;
  };
}

// sessionNames : the names in `claude agents --json`, or why it did not print a list
export function sessionNames(stdout: string): Result<readonly string[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    parsed = undefined;
  }
  if (!Array.isArray(parsed)) {
    return { kind: "failed", reason: "cannot list live runs: claude agents --json did not print a list" };
  }
  const names = parsed.map((s: unknown) => prop(s, "name")).filter((n): n is string => typeof n === "string");
  return { kind: "ok", value: names };
}

// claudeSessions : the live background sessions, through `claude agents --json`; a list that does not come in time
// fails, so a caller never mistakes "unknown" for "none"
export function claudeSessions(setup: ClaudeSetup): Sessions {
  return async (): Promise<Result<readonly string[]>> => {
    const call = { bin: setup.bin, args: ["agents", "--json"], env: setup.env };
    const { exit, late } = await timed(setup.run, call, setup.sessionsMs);
    if (late) {
      return { kind: "failed", reason: "cannot list live runs: claude agents --json did not answer within its limit" };
    }
    return exit.code === 0
      ? sessionNames(exit.stdout)
      : { kind: "failed", reason: "cannot list live runs: claude agents --json failed" };
  };
}
