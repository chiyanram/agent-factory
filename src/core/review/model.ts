// model — one fresh, read-only model run of the reviewer (#22 Q3; ADR-0001). The real run is `claude -p` in a folder
// that holds only the pack and the code copy:
//   --restricted            no command or web tools, no settings files, file tools held to this folder
//   --strict-mcp-config     no MCP servers
//   --tools Read,Grep,Glob  and nothing else; a role card may narrow them (process/cards.ts), never widen them
//   --max-budget-usd        FACTORY_MAX_USD, when set (ADR-0011 D14)
//   --json-schema           the answer is structured output, checked by the CLI
//   --output-format stream-json --verbose
//                           one JSON event a line: the tool calls, then the result event with the answer; the whole
//                           stream is the run's trace (#487), and the answer is the last result event, since a summary
//                           event can follow it
// Never resumed, never continued: every pass is a new session. A test passes its own Model.

import { execFile } from "node:child_process";
import type { Exit } from "../forge/api.js";
import { prop } from "../dispatch/records.js";
import { NO_STREAM, spendOf, streamOf, type RoundPart } from "../dispatch/spend.js";

export type ModelRun = {
  // the folder the run reads: ./pack.md, ./code/, and for verify ./findings.json
  readonly folder: string;
  readonly model: string;
  readonly schema: string;
  readonly prompt: string;
  // the session's display name, such as reviewer-12
  readonly name: string;
  // "" for no cap
  readonly maxUsd: string;
  // a role card's tools, each one of READ_ONLY; none given is all of READ_ONLY
  readonly tools?: readonly string[];
  // which run of an automated review round this is, so its spend is metered per run (#337); none outside a round
  readonly part?: RoundPart;
};

const READ_ONLY = ["Read", "Grep", "Glob"];

export type ModelAnswer = {
  readonly output: unknown;
  // the CLI's whole answer, its result event, kept with the head for the retro (ADR-0011 D16)
  readonly answer: unknown;
  readonly costUsd: number;
  readonly tokens: number;
  // the run's whole stream-json output, raw, for its trace (#487); the trace scrubs it. None from a model that streams
  // nothing, such as a test's
  readonly stream?: string;
};

// A failed run still gives back what the CLI answered, so a pass that failed for its budget is kept and counted.
export type ModelResult =
  | { readonly kind: "ok"; readonly value: ModelAnswer }
  | { readonly kind: "failed"; readonly reason: string; readonly answer: unknown; readonly stream?: string };

export type Model = (run: ModelRun) => Promise<ModelResult>;

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

// readAnswer : the structured output of one run, or why there is none
export function readAnswer(input: {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}): ModelResult {
  // the last result event of the stream; a stream with none, or output that is no stream, has no answer
  const answer = streamOf(NO_STREAM, `${input.stdout}\n`).result;
  const output = prop(answer, "structured_output");
  const stream = input.stdout;
  const ok = input.code === 0 && prop(answer, "is_error") === false && output !== undefined;
  if (!ok) {
    return { kind: "failed", reason: failure(answer, input.stderr), answer, stream };
  }
  const spent = spendOf(answer);
  return { kind: "ok", value: { output, answer, costUsd: spent.usd, tokens: spent.tokens, stream } };
}

// One CLI call in a folder: claude's file tools are held to the folder it starts in.
export type FolderCall = {
  readonly bin: string;
  readonly args: readonly string[];
  readonly env: NodeJS.ProcessEnv;
  readonly cwd: string;
};
export type FolderRunner = (call: FolderCall) => Promise<Exit>;

// a program that cannot start (ENOENT, EACCES) answers 127, as a shell does, so a caller can tell it from a failure
export const CANNOT_START = 127;

function exitCode(error: { readonly code?: unknown } | null): number {
  if (error === null) {
    return 0;
  }
  return typeof error.code === "number" ? error.code : typeof error.code === "string" ? CANNOT_START : 1;
}

function startFailure(error: { readonly code?: unknown } | null, bin: string): string {
  return error !== null && typeof error.code === "string" ? `cannot start ${bin}: ${error.code}\n` : "";
}

// runInFolder : one call, its stdin closed at once: the CLI waits 3 s for input on an open stdin (#487)
export const runInFolder: FolderRunner = (call) =>
  new Promise((resolve) => {
    const child = execFile(
      call.bin,
      [...call.args],
      { cwd: call.cwd, env: call.env, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve({ code: exitCode(error), stdout, stderr: startFailure(error, call.bin) || stderr });
      },
    );
    child.stdin?.end();
  });

// claudeModel : the real model run, through the claude CLI
export function claudeModel(input: {
  readonly bin: string;
  readonly env: NodeJS.ProcessEnv;
  readonly run: FolderRunner;
}): Model {
  return async (run) =>
    readAnswer(await input.run({ bin: input.bin, args: claudeArgs(run), env: input.env, cwd: run.folder }));
}
