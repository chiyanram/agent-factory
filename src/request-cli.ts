// request-cli — `agent-factory request | confirm | project init` (#134; ADR-0014 P3, P5, P6). The coordinator may run
// `request` with no prompt; `confirm` sits in its ask list, so the person's yes in the harness prompt, which shows the
// text, is what lets a confirm write out; `project` is denied to it, since the project file holds the write policy.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import { parseArgs } from "node:util";
import type { Result } from "./core/forge/api.js";
import { codeOf } from "./core/dispatch/records.js";
import { initialProject, pluginConfigOf } from "./core/plugin/config.js";
import { confirm, request, type Confirmed, type Requested } from "./core/plugin/request.js";
import { projectPath } from "./core/project.js";
import { attempt } from "./core/review/safe.js";
import { plainName } from "./core/spec.js";
import { pluginSetup, type PluginIo } from "./plugin-cli.js";

type Io = Omit<PluginIo, "pkg">;

function refused(reason: string): { readonly kind: "failed"; readonly reason: string } {
  return { kind: "failed", reason };
}

function fail(io: Io, what: string, reason: string): number {
  io.err(`agent-factory ${what}: ${reason}\n`);
  return 1;
}

function options(argv: readonly string[], strings: readonly string[]): ReturnType<typeof parseArgs> | "bad" {
  try {
    return parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: Object.fromEntries(strings.map((name) => [name, { type: "string" }])),
    });
  } catch {
    return "bad";
  }
}

function stringOption(parsed: ReturnType<typeof parseArgs>, name: string): string | undefined {
  const value = parsed.values[name];
  return typeof value === "string" ? value : undefined;
}

type Said = Exclude<Requested, { kind: "failed" }>;

const LINES: { readonly [K in Said["kind"]]: (r: Extract<Said, { kind: K }>) => string } = {
  done: (r) => `done (${r.count} of ${r.cap} since the approval)${r.url === "" ? "" : ` ${JSON.stringify(r.url)}`}\n`,
  pending: (r) =>
    `waiting for the person's confirm; it goes out only when they say yes to this command:\n${r.command}\n`,
};

function lineAs<K extends Said["kind"]>(kind: K, r: Extract<Said, { kind: K }>): string {
  return LINES[kind](r);
}

function said(io: Io, what: string, r: Requested | Confirmed): number {
  if (r.kind === "failed") {
    return fail(io, what, r.reason);
  }
  io.out(`${what}: ${lineAs(r.kind, r)}`);
  return r.kind === "done" ? 0 : 3;
}

const REQUEST_USAGE = "usage: agent-factory request <tracker.comment|tracker.create|notify> --file <draft.json>\n";

// request <capability> --file draft.json : exit 0 done, 3 waiting for confirm, 1 refused
async function requestCommand(argv: readonly string[], io: Io): Promise<number> {
  const words = requestWords(argv);
  if (words === "bad") {
    io.err(REQUEST_USAGE);
    return 64;
  }
  const draft = await attempt(() => readFile(words.file, "utf8"), `cannot read ${words.file}`);
  if (draft.kind === "failed") {
    return fail(io, "request", draft.reason);
  }
  return said(io, "request", await request(await pluginSetup(io.home, io.env), words.capability, draft.value));
}

function requestWords(argv: readonly string[]): { readonly capability: string; readonly file: string } | "bad" {
  const parsed = options(argv, ["file"]);
  if (parsed === "bad") {
    return "bad";
  }
  const file = stringOption(parsed, "file");
  const [capability, ...rest] = parsed.positionals;
  return file === undefined || capability === undefined || rest.length > 0 ? "bad" : { capability, file };
}

// confirm <id> <text> : exit 0 done, 1 refused
async function confirmCommand(argv: readonly string[], io: Io): Promise<number> {
  const parsed = options(argv, []);
  if (parsed === "bad" || parsed.positionals.length !== 2) {
    io.err("usage: agent-factory confirm <id> '<the text request printed>'\n");
    return 64;
  }
  const [id = "", text = ""] = parsed.positionals;
  return said(io, "confirm", await confirm(await pluginSetup(io.home, io.env), id, text));
}

async function templateText(template: string | undefined): Promise<Result<string>> {
  if (template === undefined) {
    return { kind: "ok", value: initialProject() };
  }
  if (!isAbsolute(template)) {
    return { kind: "failed", reason: `a template is named by its absolute path, got ${JSON.stringify(template)}` };
  }
  const text = await attempt(() => readFile(template, "utf8"), `cannot read ${template}`);
  return text.kind === "ok" ? checkedTemplate(template, text.value) : text;
}

function parsedObject(text: string): object | "bad" {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value : "bad";
  } catch {
    return "bad";
  }
}

// checkedTemplate : a team's template, copied only when its plugin fields read; the core never reads it again
function checkedTemplate(path: string, text: string): Result<string> {
  const raw = parsedObject(text);
  if (raw === "bad") {
    return { kind: "failed", reason: `${path} is not a JSON object` };
  }
  const config = pluginConfigOf(path, raw);
  return config.kind === "ok" ? { kind: "ok", value: text } : config;
}

async function written(path: string, text: string): Promise<Result<string>> {
  try {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, text, { flag: "wx", mode: 0o600 });
    return { kind: "ok", value: path };
  } catch (error) {
    return {
      kind: "failed",
      reason: codeOf(error) === "EEXIST" ? `${path} is there already; edit it yourself` : `cannot write ${path}`,
    };
  }
}

function projectWords(
  argv: readonly string[],
): { readonly project: string; readonly template: string | undefined } | "bad" {
  const parsed = options(argv, ["template"]);
  if (parsed === "bad") {
    return "bad";
  }
  const [verb, project, ...rest] = parsed.positionals;
  return verb === "init" && project !== undefined && rest.length === 0
    ? { project, template: stringOption(parsed, "template") }
    : "bad";
}

// project init <project> [--template <file>] : the project file, from a team's template or the defaults; an existing
// file is never replaced
async function projectCommand(argv: readonly string[], io: Io): Promise<number> {
  const words = projectWords(argv);
  if (words === "bad") {
    io.err("usage: agent-factory project init <project> [--template <file>]\n");
    return 64;
  }
  const text = plainName(words.project)
    ? await templateText(words.template)
    : refused(`${JSON.stringify(words.project)} is not a plain project name`);
  const done = text.kind === "ok" ? await written(projectPath(io.home, words.project), text.value) : text;
  if (done.kind === "failed") {
    return fail(io, "project init", done.reason);
  }
  io.out(
    `wrote ${done.value}: map each capability to a plugin under "plugins"; add gate and ready.programs before the ready check runs\n`,
  );
  return 0;
}

// the commands that read their own options: their words are not the main command line's
export const REQUEST_COMMANDS: Readonly<Record<string, (argv: readonly string[], io: Io) => Promise<number>>> = {
  request: requestCommand,
  confirm: confirmCommand,
  project: projectCommand,
};

export const REQUEST_HELP = `  request <capability> --file <draft.json>
                               ask for a tracker.comment, tracker.create or notify write on an approved ticket; the
                               project's policy allows it at once (0), keeps it for confirm (3) or refuses it (1)
  confirm <id> '<text>'        perform a kept write, when the text is the one request printed; run it only behind
                               the harness ask prompt
  project init <project> [--template <file>]
                               write <home>/projects/<project>.json from a team's template, or the default policy
`;
