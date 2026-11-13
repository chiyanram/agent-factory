// serve — the forge adapters as a plugin (#134 PR C; ADR-0014 P1). The bundled plugins/github and plugins/gitlab run
// this: `describe` names the plugin, its forge.read and forge.write, and the CLI it calls; `call` reads one request on
// stdin, runs that op of the adapter (github.ts, gitlab.ts) through the CLI on the plugin's PATH, with the CLI's own
// login, and prints one answer (ops.ts). The project comes in each request, never from the environment, so the plugin
// needs no FACTORY_* setting and no token. Nothing here throws: a request it cannot read is answered, never a crash.

import { PROTOCOL } from "../plugin/contract.js";
import { realSleep, runProcess, type Client, type Done, type Result, type Runner } from "./api.js";
import { github } from "./github.js";
import { gitlab } from "./gitlab.js";
import { FORGE_OPS, isForgeOp, type ForgeOp } from "./ops.js";
import { reader, type Reader } from "./read.js";
import { bodyPostOf, changeOf, changeRequestOf, lineFindingOf, postOf, statusOf } from "./shapes.js";
import { githubProject, gitlabProject } from "./target.js";
import type { Forge, ForgeName } from "./types.js";

export type ServeIo = {
  readonly argv: readonly string[];
  readonly stdin: () => Promise<string>;
  readonly env: NodeJS.ProcessEnv;
  readonly out: (text: string) => void;
  readonly run?: Runner;
};

type Answer = Readonly<Record<string, unknown>>;

const CLI: Readonly<Record<ForgeName, string>> = { github: "gh", gitlab: "glab" };

export function described(forge: ForgeName, version: string): Answer {
  return {
    protocol: PROTOCOL,
    name: forge,
    version,
    capabilities: [{ name: "forge.read", mandatory: true }, { name: "forge.write" }],
    writes: ["forge.write"],
    env: [],
    cli: [CLI[forge]],
  };
}

function failed(reason: string): Answer {
  return { kind: "failed", reason };
}

function value<T>(result: Result<T>): Answer {
  return result.kind === "ok" ? { kind: "ok", value: result.value } : failed(result.reason);
}

function done(result: Done): Answer {
  return result.kind === "ok" ? { kind: "done" } : failed(result.reason);
}

// withInput : the op, when its input reads; else the reason it does not
async function withInput<T>(
  input: unknown,
  read: (r: Reader, input: unknown) => T,
  act: (value: T) => Promise<Answer>,
): Promise<Answer> {
  const r = reader("the request's input");
  const checked = r.done(read(r, input));
  return checked.kind === "ok" ? act(checked.value) : failed(checked.reason);
}

const numberOf = (r: Reader, v: unknown) => ({ number: r.int(v, "number") });
const labelOf = (r: Reader, v: unknown) => ({ number: r.int(v, "number"), label: r.text(v, "label") });

type Run = (forge: Forge, input: unknown) => Promise<Answer>;

const RUN: Readonly<Record<ForgeOp, Run>> = {
  me: async (f) => value(await f.me()),
  change: (f, i) => withInput(i, numberOf, async (x) => value(await f.change(x))),
  landed: (f, i) => withInput(i, numberOf, async (x) => value(await f.landed(x))),
  defaultBranch: async (f) => value(await f.defaultBranch()),
  branchExists: (f, i) =>
    withInput(
      i,
      (r, v) => ({ branch: r.text(v, "branch") }),
      async (x) => value(await f.branchExists(x)),
    ),
  branchState: (f, i) =>
    withInput(
      i,
      (r, v) => ({ branch: r.text(v, "branch") }),
      async (x) => value(await f.branchState(x)),
    ),
  issueBody: (f, i) => withInput(i, numberOf, async (x) => value(await f.issueBody(x))),
  issueState: (f, i) => withInput(i, numberOf, async (x) => value(await f.issueState(x))),
  notes: (f, i) => withInput(i, numberOf, async (x) => value(await f.notes(x))),
  ciConfig: async (f) => value(await f.ciConfig()),
  claimed: (f, i) =>
    withInput(
      i,
      (r, v) => ({ state: r.word(v, "state", ["opened", "merged"]), label: r.text(v, "label") }),
      async (x) => value(await f.claimed(x)),
    ),
  changes: (f, i) =>
    withInput(
      i,
      (r, v) => ({ label: r.text(v, "label") }),
      async (x) => value(await f.changes(x)),
    ),
  failedJobs: (f, i) =>
    withInput(
      i,
      (r, v) => ({ number: r.int(v, "number"), head: r.text(v, "head") }),
      async (x) => value(await f.failedJobs(x)),
    ),
  addLabel: (f, i) => withInput(i, labelOf, async (x) => done(await f.addLabel(x))),
  removeLabel: (f, i) => withInput(i, labelOf, async (x) => done(await f.removeLabel(x))),
  note: (f, i) =>
    withInput(
      i,
      (r, v) => ({ number: r.int(v, "number"), post: postOf(r, r.at(v, "post")) }),
      async (x) => done(await f.note(x)),
    ),
  setBody: (f, i) =>
    withInput(
      i,
      (r, v) => ({ number: r.int(v, "number"), post: bodyPostOf(r, r.at(v, "post")) }),
      async (x) => done(await f.setBody(x)),
    ),
  lineFinding: (f, i) =>
    withInput(
      i,
      (r, v) => ({
        change: changeOf(r, r.at(v, "change")),
        at: lineFindingOf(r, r.at(v, "at")),
        post: postOf(r, r.at(v, "post")),
      }),
      async (x) => done(await f.lineFinding(x)),
    ),
  status: (f, i) => withInput(i, statusOf, async (x) => done(await f.status(x))),
  openChange: (f, i) =>
    withInput(i, changeRequestOf, async (x) => {
      const change = await f.openChange(x);
      return change.kind === "ok" ? { kind: "done", value: change.value } : failed(change.reason);
    }),
};

function client(forge: ForgeName, io: ServeIo): Client {
  return {
    name: forge,
    bin: CLI[forge],
    env: { ...io.env, GH_NO_UPDATE_NOTIFIER: "1", GH_PROMPT_DISABLED: "1", GLAB_CHECK_UPDATE: "false" },
    run: io.run ?? runProcess,
    sleep: realSleep,
    maxTries: 4,
    now: () => Math.floor(Date.now() / 1000),
  };
}

// opened : the adapter for the project the request names
function opened(forge: ForgeName, io: ServeIo, project: unknown): Result<Forge> {
  const name = typeof project === "string" ? project : "";
  if (forge === "github") {
    const where = githubProject(name);
    return where.kind === "ok" ? { kind: "ok", value: github(client(forge, io), where.value) } : where;
  }
  const where = gitlabProject(name);
  return where.kind === "ok" ? { kind: "ok", value: gitlab(client(forge, io), where.value) } : where;
}

type Request = { readonly capability: string; readonly op: string; readonly input: unknown };

function requestOf(text: string): Request | "bad" {
  try {
    const raw: unknown = JSON.parse(text);
    const r = reader("request");
    const request = { capability: r.text(raw, "capability"), op: r.text(raw, "op"), input: r.at(raw, "input") };
    return r.done(request).kind === "ok" ? request : "bad";
  } catch {
    return "bad";
  }
}

function fieldIn(input: unknown, name: string): unknown {
  return typeof input === "object" && input !== null ? Reflect.get(input, name) : undefined;
}

// answer : one request's answer: unsupported for an op it does not know, refused for an op sent under the other
// capability, so a read never writes
export async function answer(forge: ForgeName, io: ServeIo, text: string): Promise<Answer> {
  const request = requestOf(text);
  if (request === "bad") {
    return failed("the request is not one JSON object with a capability, an op and an input");
  }
  if (!isForgeOp(request.op)) {
    return { kind: "unsupported", op: request.op };
  }
  const refusal = refusalOf(forge, request.op, request);
  if (refusal !== "") {
    return { kind: "refused", reason: refusal };
  }
  const adapter = opened(forge, io, fieldIn(request.input, "project"));
  return adapter.kind === "ok" ? RUN[request.op](adapter.value, request.input) : failed(adapter.reason);
}

// refusalOf : why the plugin refuses a known op: sent under the other capability, or for another forge; "" for none
function refusalOf(forge: ForgeName, op: ForgeOp, request: Request): string {
  if (FORGE_OPS[op] !== request.capability) {
    return `${op} is ${FORGE_OPS[op]}, not ${request.capability}`;
  }
  const asked = fieldIn(request.input, "forge");
  return asked === undefined || asked === forge ? "" : `this plugin serves ${forge}, not ${JSON.stringify(asked)}`;
}

// serve : the plugin's whole run: describe or call; exit 0 with one JSON object, 64 for any other verb
export async function serve(forge: ForgeName, version: string, io: ServeIo): Promise<number> {
  const [verb] = io.argv;
  if (verb === "describe") {
    io.out(JSON.stringify(described(forge, version)));
    return 0;
  }
  if (verb !== "call") {
    return 64;
  }
  io.out(JSON.stringify(await answer(forge, io, await io.stdin())));
  return 0;
}

function stdinText(): Promise<string> {
  return new Promise((resolve) => {
    let text = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (d: string) => {
      text += d;
    });
    process.stdin.on("end", () => resolve(text));
    process.stdin.on("error", () => resolve(text));
  });
}

// main : the bundled plugin's entry: this process's words, stdin, environment and stdout
export async function main(forge: ForgeName, version: string): Promise<void> {
  process.exitCode = await serve(forge, version, {
    argv: process.argv.slice(2),
    stdin: stdinText,
    env: process.env,
    out: (text) => process.stdout.write(text),
  });
}
