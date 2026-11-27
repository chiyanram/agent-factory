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
// The CLI gets only the environment it needs (CLAUDE_ENV): no git host token, no FACTORY_* (ADR-0012 S2, S6). Every
// run it starts has DISABLE_AUTOUPDATER=1, so no run updates its CLI mid-run and the version its record names holds.
//
// A CLI that answered and exited stands, even when a process it left holds its output open past the limit. A sessions
// list that does not come in time fails, so a caller never reads "unknown" as "none".

import { NO_STREAM, spendOf, streamOf } from "../dispatch/spend.js";
import type { Result } from "../forge/api.js";
import type { Sessions } from "../review/live.js";
import type { Model, ModelResult, ModelRun } from "../review/model.js";
import { settingName } from "../settings/machine.js";
import { timed, type FolderRunner } from "./folder.js";
import { refusedLogin, SIGN_IN } from "./login.js";
import { MODEL_RUN_MARK } from "./mark.js";
import { prop } from "../field.js";

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

const REFUSED = `the claude login was refused (HTTP 401); ${SIGN_IN}; `;

function failure(answer: unknown, stderr: string): string {
  const said = [prop(answer, "subtype"), prop(answer, "result")].filter((s) => typeof s === "string").join(": ");
  const fix = refusedLogin(answer) ? REFUSED : "";
  return fix + (said || stderr.trim().split("\n")[0] || "no answer").slice(0, 200);
}

function lastResult(stdout: string): unknown {
  return streamOf(NO_STREAM, `${stdout}\n`).result;
}

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
    const end = answer === undefined ? "launch_failed" : "output_invalid";
    return { kind: "failed", reason: failure(answer, input.stderr), answer, stream, end };
  }
  const spent = spendOf(answer);
  return { kind: "ok", value: { output, answer, costUsd: spent.usd, tokens: spent.tokens, stream } };
}

function stopped(run: ModelRun, stdout: string): ModelResult {
  return {
    kind: "failed",
    reason: `stopped at its ${run.limit.minutes}-minute limit (${run.limit.setting})`,
    answer: lastResult(stdout),
    stream: stdout,
    end: "timed_out",
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
  settingName("egress.caCerts"),
  "SSL_CERT_FILE",
]);

export function claudeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const kept = Object.entries(env).filter(
    ([name, value]) =>
      value !== undefined && (CLAUDE_ENV.has(name) || name.startsWith("LC_") || name.startsWith("ANTHROPIC_")),
  );
  return { ...Object.fromEntries(kept), ...MODEL_RUN_MARK, DISABLE_AUTOUPDATER: "1" };
}

export type ClaudeSetup = {
  readonly bin: string;
  readonly env: NodeJS.ProcessEnv;
  readonly run: FolderRunner;
  readonly minuteMs: number;
  readonly sessionsMs: number;
};

export function claudeModel(setup: ClaudeSetup): Model {
  return async (run) => {
    const call = { bin: setup.bin, args: claudeArgs(run), env: setup.env, cwd: run.folder };
    const { exit, late } = await timed(setup.run, call, run.limit.minutes * setup.minuteMs);
    const read = readAnswer(exit);
    return late && read.kind === "failed" ? stopped(run, exit.stdout) : read;
  };
}

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
