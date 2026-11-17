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
// **Today:** this read-only run has never run against a live Copilot CLI, and nothing starts it: a project file that
// names copilot is refused (switch.ts). #697 checks a real run, its exit code, COPILOT_GITHUB_TOKEN alone, whether
// view, grep and glob need an allow rule in -p, what the usage file holds and what --max-ai-credits does, then turns
// it on. Its trace is the final answer only, not a tool-call stream (#697). It runs the host's copilot from PATH,
// unpinned, on the host rather than a runner (#493, #674).

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Exit } from "../forge/api.js";
import { unknownKeywords, validate, type Schema } from "../process/pack-schema.js";
import type { ModelRun } from "../review/model.js";
import { settingName } from "../settings/machine.js";
import type { BoxToken } from "../token/index.js";
import { timed, type FolderRunner } from "./folder.js";
import { MODEL_RUN_MARK } from "./mark.js";

// the copilot tools each read-only card tool stands for
const COPILOT_TOOLS: readonly (readonly [string, string])[] = [
  ["Read", "view"],
  ["Grep", "grep"],
  ["Glob", "glob"],
];

const ANSWER_LINE = "Answer with one JSON value that matches this JSON schema, and nothing else:";

export type CopilotArgsInput = {
  // the run's private home: the usage file goes there
  readonly home: string;
  // caps.aiCreditsPerRun, "" for none
  readonly aiCredits: string;
};

// copilotArgs : the read-only run's argv after the binary. Pure.
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

// what the copilot CLI keeps from the host env: what it needs to run and reach the model through the proxy
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
  // the company CA (egress.caCerts)
  settingName("egress.caCerts"),
  "SSL_CERT_FILE",
]);

// copilotEnv : the environment the copilot CLI gets: the allowlist, its private home, and the stored token; no git
// host token, no host login, no COPILOT_* from the host. Pure.
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
  // the value the run answered, as it answered it
  readonly answer: unknown;
  // never measured until the usage file is read: never $0
  readonly spend: "unmeasured";
  // what the run printed, and its usage file, raw, for its trace
  readonly stream: string;
};

export type CopilotResult =
  | { readonly kind: "ok"; readonly value: CopilotAnswer & { readonly seconds?: number } }
  | { readonly kind: "failed"; readonly reason: string; readonly stream?: string; readonly seconds?: number };

// one read-only Copilot run; not a Model: its answer has no dollar figure
export type CopilotModel = (run: ModelRun) => Promise<CopilotResult>;

function firstLine(text: string): string {
  return (text.trim().split("\n")[0] ?? "").slice(0, 200);
}

// jsonIn : the one JSON value stdout holds, alone or in one json fence, or "none". Pure.
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

// schemaOf : the run's schema text as a schema; text that is no schema throws, as JSON.parse does. Pure.
function schemaOf(text: string): Schema {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed === "boolean" || isSchemaObject(parsed)) {
    return parsed;
  }
  throw new Error("the run's schema is not a JSON schema");
}

// checkedAnswer : one JSON value the run answered, against its schema. Pure.
function checkedAnswer(value: unknown, schema: string, stream: string): CopilotResult {
  const problems = validate(value, schemaOf(schema));
  return problems.length === 0
    ? { kind: "ok", value: { output: value, answer: value, spend: "unmeasured", stream } }
    : {
        kind: "failed",
        reason: `copilot's answer does not match its schema: ${problems.slice(0, 3).join("; ")}`,
        stream,
      };
}

// readCopilotAnswer : the run's answer, checked against its schema, or why there is none; its stream is stdout, then
// stderr. Pure.
export function readCopilotAnswer(exit: Exit, schema: string): CopilotResult {
  const stream = exit.stderr === "" ? exit.stdout : `${exit.stdout}\n${exit.stderr}`;
  if (exit.code !== 0) {
    return { kind: "failed", reason: `copilot exited ${exit.code}: ${firstLine(exit.stderr) || "no output"}`, stream };
  }
  const read = jsonIn(exit.stdout);
  return read === "none"
    ? { kind: "failed", reason: `copilot's answer is not one JSON value: ${firstLine(exit.stdout)}`, stream }
    : checkedAnswer(read.value, schema, stream);
}

export type CopilotSetup = {
  // FACTORY_COPILOT
  readonly bin: string;
  // the host env, which copilotEnv filters
  readonly env: NodeJS.ProcessEnv;
  readonly run: FolderRunner;
  // how long a minute of a run's limit is; a test makes it short
  readonly minuteMs: number;
  // the run's login, read before each run (token/index.ts copilotLoginFrom)
  readonly login: () => Promise<BoxToken>;
  // caps.aiCreditsPerRun, "" for none
  readonly aiCredits: string;
  // where each run's private home is made (os.tmpdir()); a test passes its own
  readonly tempRoot: string;
};

// unrunnable : why the run cannot start, or "" when it can: a card that leaves no read-only tool (an empty
// --available-tools is untried and may mean none are held back), or a schema with a keyword the checker does not run,
// which would pass anything. Pure.
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

// madeHome : a fresh private home (mode 0700) under root, or why none could be made
async function madeHome(root: string): Promise<{ readonly home: string } | { readonly reason: string }> {
  try {
    return { home: await mkdtemp(join(root, "factory-copilot-")) };
  } catch (error) {
    return { reason: `cannot make the run's private home: ${error instanceof Error ? error.message : String(error)}` };
  }
}

// ended : how one run ended: its answer, or the limit that stopped it, with its usage file after its output
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
  const reason = ran.late ? `stopped at its ${run.limit.minutes}-minute limit (${run.limit.setting})` : read.reason;
  return { kind: "failed", reason, stream, seconds };
}

// inHome : one run in a fresh private home, removed after it, however it ended
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

// copilotModel : the read-only run, through the copilot CLI, stopped at its limit; nothing starts without a valid
// copilot token or with a schema the adapter cannot check
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
