// copilot — the GitHub Copilot CLI adapter behind the agent seam (ADR-0022): its read-only run. The run is
// `copilot -p` in the run's folder, which holds only the pack and the code copy:
//   -s                          only the final answer on stdout: the CLI has no structured-output flag, so the prompt
//                               asks for one JSON value and the adapter checks it against the run's schema
//                               (process/pack-schema.ts validate)
//   --no-auto-update            the bundled version runs, and never updates itself (ADR-0012 S7)
//   --disable-builtin-mcps      no MCP servers
//   --no-ask-user               no question tool; in -p a tool no rule allows is denied, so the run never waits
//   --no-custom-instructions    no AGENTS.md or .github/copilot-instructions.md from the code copy (S12)
//   --disallow-temp-dir         file tools held to the run's folder, as claude --restricted holds them
//   --available-tools           view, grep and glob, and nothing else; a role card may narrow them, never widen them
//   --secret-env-vars           the token masked in the JSON output and kept from tools, behind the env allowlist
//   --usage-output-file         the run's usage, kept raw in its trace
//   --max-ai-credits            caps.aiCreditsPerRun, when set
// No folder is trusted (--trust-folder, COPILOT_ALLOW_ALL), so the code copy's hooks, skills and MCP servers never
// load, and no flag that allows every tool, path or URL is ever passed (test/agent-copilot.test.ts).
//
// Each run gets a fresh, empty HOME and COPILOT_HOME, removed after it: with none, the CLI would read the person's
// own Copilot login or gh's, each a git host token (ADR-0012 S6). Its only login is COPILOT_GITHUB_TOKEN, from the
// token store, never the host env (token/rules.ts copilotLogin).
//
// A Copilot answer's cost is unknown: it is "unmeasured", never $0, and its type is not a ModelAnswer, so no caller
// that sums dollars can take it until it counts it.
//
// A schema with a keyword the adapter's checker does not run is refused before the run, because it would pass anything.
//
// **Today:** this read-only run has never run against a live Copilot CLI, and nothing starts it: a project file that
// names copilot is refused (switch.ts). #697 checks a real run, its exit code, COPILOT_GITHUB_TOKEN alone, whether
// view, grep and glob need an allow rule in -p, what the usage file holds and what --max-ai-credits does, then turns
// it on. Its trace is the final answer only, not a tool-call stream (#697). It runs the host's copilot from PATH,
// unpinned, on the host rather than a runner (#493, #674). Its run record names no CLI, version or model, since its
// -s output has no init event (agent/ran.ts); #697 records them when it turns the run on.

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Exit } from "../forge/api.js";
import { unknownKeywords, validate, type Schema } from "../process/pack-schema.js";
import type { ModelRun } from "../review/model.js";
import { settingName } from "../settings/machine.js";
import type { BoxToken } from "../token/index.js";
import { timed, type FolderRunner } from "./folder.js";
import { MODEL_RUN_MARK } from "./mark.js";
import type { EndReason } from "../end-reason.js";

const COPILOT_TOOLS: readonly (readonly [string, string])[] = [
  ["Read", "view"],
  ["Grep", "grep"],
  ["Glob", "glob"],
];

const ANSWER_LINE = "Answer with one JSON value that matches this JSON schema, and nothing else:";

export type CopilotArgsInput = {
  readonly home: string;
  readonly aiCredits: string;
};

export function copilotArgs(run: ModelRun, input: CopilotArgsInput): readonly string[] {
  const tools = COPILOT_TOOLS.filter(([card]) => run.tools === undefined || run.tools.includes(card)).map(([, t]) => t);
  return [
    "-p",
    `${run.prompt}\n\n${ANSWER_LINE}\n${run.schema}`,
    "-s",
    "--no-auto-update",
    "--disable-builtin-mcps",
    "--no-ask-user",
    "--no-custom-instructions",
    "--disallow-temp-dir",
    "--available-tools",
    tools.join(","),
    "--secret-env-vars",
    "COPILOT_GITHUB_TOKEN",
    "--usage-output-file",
    join(input.home, "usage.json"),
    ...(input.aiCredits === "" ? [] : ["--max-ai-credits", input.aiCredits]),
  ];
}

const COPILOT_ENV = new Set([
  "PATH",
  "USER",
  "LOGNAME",
  "LANG",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "NO_PROXY",
  "https_proxy",
  "http_proxy",
  "no_proxy",
  settingName("egress.caCerts"),
  "SSL_CERT_FILE",
]);

export function copilotEnv(env: NodeJS.ProcessEnv, home: string, login: BoxToken): NodeJS.ProcessEnv {
  const kept = Object.entries(env).filter(
    ([name, value]) => value !== undefined && (COPILOT_ENV.has(name) || name.startsWith("LC_")),
  );
  return {
    ...Object.fromEntries(kept),
    HOME: home,
    COPILOT_HOME: join(home, ".copilot"),
    TMPDIR: home,
    COPILOT_AUTO_UPDATE: "false",
    ...MODEL_RUN_MARK,
    ...(login.kind === "ready" ? login.env : {}),
  };
}

export type CopilotAnswer = {
  readonly output: unknown;
  readonly answer: unknown;
  readonly spend: "unmeasured";
  readonly stream: string;
};

export type CopilotResult =
  | { readonly kind: "ok"; readonly value: CopilotAnswer & { readonly seconds?: number } }
  | {
      readonly kind: "failed";
      readonly reason: string;
      readonly stream?: string;
      readonly seconds?: number;
      readonly end?: EndReason;
    };

export type CopilotModel = (run: ModelRun) => Promise<CopilotResult>;

function firstLine(text: string): string {
  return (text.trim().split("\n")[0] ?? "").slice(0, 200);
}

function jsonIn(stdout: string): { readonly value: unknown } | "none" {
  const text = stdout.trim();
  const fenced = /^```json\n([\s\S]*)\n```$/.exec(text.replaceAll("\r\n", "\n"));
  try {
    return { value: JSON.parse(fenced === null ? text : (fenced[1] ?? "")) };
  } catch {
    return "none";
  }
}

function isSchemaObject(value: unknown): value is { readonly [key: string]: unknown } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function schemaOf(text: string): Schema {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed === "boolean" || isSchemaObject(parsed)) {
    return parsed;
  }
  throw new Error("the run's schema is not a JSON schema");
}

function checkedAnswer(value: unknown, schema: string, stream: string): CopilotResult {
  const problems = validate(value, schemaOf(schema));
  return problems.length === 0
    ? { kind: "ok", value: { output: value, answer: value, spend: "unmeasured", stream } }
    : {
        kind: "failed",
        reason: `copilot's answer does not match its schema: ${problems.slice(0, 3).join("; ")}`,
        stream,
        end: "output_invalid",
      };
}

export function readCopilotAnswer(exit: Exit, schema: string): CopilotResult {
  const stream = exit.stderr === "" ? exit.stdout : `${exit.stdout}\n${exit.stderr}`;
  if (exit.code !== 0) {
    const reason = `copilot exited ${exit.code}: ${firstLine(exit.stderr) || "no output"}`;
    return { kind: "failed", reason, stream, end: "launch_failed" };
  }
  const read = jsonIn(exit.stdout);
  return read === "none"
    ? {
        kind: "failed",
        reason: `copilot's answer is not one JSON value: ${firstLine(exit.stdout)}`,
        stream,
        end: "output_invalid",
      }
    : checkedAnswer(read.value, schema, stream);
}

export type CopilotSetup = {
  readonly bin: string;
  readonly env: NodeJS.ProcessEnv;
  readonly run: FolderRunner;
  readonly minuteMs: number;
  readonly login: () => Promise<BoxToken>;
  readonly aiCredits: string;
  readonly tempRoot: string;
};

function unrunnable(run: ModelRun): string {
  if (!COPILOT_TOOLS.some(([card]) => run.tools === undefined || run.tools.includes(card))) {
    return "the role card leaves the run no read-only tool";
  }
  const schema = run.schema;
  try {
    const unknown = unknownKeywords(schemaOf(schema));
    return unknown.length === 0 ? "" : `cannot check copilot's answer: ${unknown.join("; ")}`;
  } catch {
    return "cannot check copilot's answer: the run's schema is not JSON";
  }
}

async function usageText(home: string): Promise<string> {
  try {
    return `\n${JSON.stringify({ type: "copilot-usage", raw: await readFile(join(home, "usage.json"), "utf8") })}\n`;
  } catch {
    return "";
  }
}

async function madeHome(root: string): Promise<{ readonly home: string } | { readonly reason: string }> {
  try {
    return { home: await mkdtemp(join(root, "factory-copilot-")) };
  } catch (error) {
    return { reason: `cannot make the run's private home: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function ended(
  run: ModelRun,
  ran: { readonly exit: Exit; readonly late: boolean },
  usage: string,
  seconds: number,
): CopilotResult {
  const read = readCopilotAnswer(ran.exit, run.schema);
  const stream = `${read.kind === "ok" ? read.value.stream : (read.stream ?? "")}${usage}`;
  if (read.kind === "ok") {
    return { kind: "ok", value: { ...read.value, stream, seconds } };
  }
  return ran.late
    ? {
        kind: "failed",
        reason: `stopped at its ${run.limit.minutes}-minute limit (${run.limit.setting})`,
        stream,
        seconds,
        end: "timed_out",
      }
    : { ...read, stream, seconds };
}

async function inHome(setup: CopilotSetup, run: ModelRun, login: BoxToken): Promise<CopilotResult> {
  const made = await madeHome(setup.tempRoot);
  if ("reason" in made) {
    return { kind: "failed", reason: made.reason };
  }
  const { home } = made;
  const started = Date.now();
  try {
    const call = {
      bin: setup.bin,
      args: copilotArgs(run, { home, aiCredits: setup.aiCredits }),
      env: copilotEnv(setup.env, home, login),
      cwd: run.folder,
    };
    const ran = await timed(setup.run, call, run.limit.minutes * setup.minuteMs);
    return ended(run, ran, await usageText(home), Math.round((Date.now() - started) / 1000));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

export function copilotModel(setup: CopilotSetup): CopilotModel {
  return async (run) => {
    const why = unrunnable(run);
    if (why !== "") {
      return { kind: "failed", reason: why };
    }
    const login = await setup.login();
    return login.kind === "ready" ? inHome(setup, run, login) : { kind: "failed", reason: login.reason };
  };
}
