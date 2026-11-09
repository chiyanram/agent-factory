// model — one fresh, read-only model run of the reviewer (#22 Q3; ADR-0001). The real run is `claude -p` in a folder
// that holds only the pack and the code copy:
//   --restricted            no command or web tools, no settings files, file tools held to this folder
//   --strict-mcp-config     no MCP servers
//   --tools Read,Grep,Glob  and nothing else
//   --max-budget-usd        FACTORY_MAX_USD, when set (ADR-0011 D14)
//   --json-schema           the answer is structured output, checked by the CLI
// Never resumed, never continued: every pass is a new session. A test passes its own Model.

import { execFile } from "node:child_process";
import type { Exit } from "../forge/api.js";
import { prop } from "../dispatch/records.js";
import { spendOf } from "../dispatch/spend.js";

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
};

export type ModelAnswer = {
  readonly output: unknown;
  // the CLI's whole answer, kept with the head for the retro (ADR-0011 D16)
  readonly answer: unknown;
  readonly costUsd: number;
  readonly tokens: number;
};

// A failed run still gives back what the CLI answered, so a pass that failed for its budget is kept and counted.
export type ModelResult =
  | { readonly kind: "ok"; readonly value: ModelAnswer }
  | { readonly kind: "failed"; readonly reason: string; readonly answer: unknown };

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
    "Read,Grep,Glob",
    ...cap,
    "--output-format",
    "json",
    "--json-schema",
    run.schema,
    run.prompt,
  ];
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
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
  const answer = parse(input.stdout);
  const output = prop(answer, "structured_output");
  const ok = input.code === 0 && prop(answer, "is_error") === false && output !== undefined;
  if (!ok) {
    return { kind: "failed", reason: failure(answer, input.stderr), answer };
  }
  const spent = spendOf(answer);
  return { kind: "ok", value: { output, answer, costUsd: spent.usd, tokens: spent.tokens } };
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

export const runInFolder: FolderRunner = (call) =>
  new Promise((resolve) => {
    execFile(
      call.bin,
      [...call.args],
      { cwd: call.cwd, env: call.env, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve({ code: exitCode(error), stdout, stderr: startFailure(error, call.bin) || stderr });
      },
    );
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
