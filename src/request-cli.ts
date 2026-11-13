// request-cli — `agent-factory request | confirm | project init` (#134; ADR-0014 P3, P5, P6). The coordinator may run
// `request` with no prompt; `confirm` sits in its ask list, so the person's yes in the harness prompt, which shows the
// text, is what lets a confirm write out; `project` is denied to it, since the project file holds the write policy.

import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, sep } from "node:path";
import { parseArgs } from "node:util";
import type { Result } from "./core/forge/api.js";
import { codeOf } from "./core/dispatch/records.js";
import { initialProject, pluginConfigOf } from "./core/plugin/config.js";
import { parseId } from "./core/plugin/pending.js";
import { confirm, request, type Confirmed, type Requested, type RequestSetup } from "./core/plugin/request.js";
import {
  confirmSpecBody,
  requestSpecBody,
  SPEC_BODY,
  specBodyOf,
  type SpecBodySetup,
} from "./core/plugin/spec-body.js";
import { projectPath, readyFieldsOf, runSettings } from "./core/project.js";
import { openProjectForge } from "./core/forge/index.js";
import { openOnce, specStoreOf } from "./core/spec-store.js";
import { attempt } from "./core/review/safe.js";
import { plainName, type SpecStore } from "./core/spec.js";
import type { Forge } from "./core/forge/types.js";
import { pluginSetup, type PluginIo } from "./plugin-cli.js";
import type { Secrets } from "./core/plugin/registry.js";

// the plugin io, and the secrets a call carries (the Discord webhook for a notify request, #119)
type Io = Omit<PluginIo, "pkg"> & { readonly secrets: Secrets };

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
  done: (r) =>
    `done (${r.count} of ${r.cap} since the approval)${r.url === "" ? "" : ` ${JSON.stringify(r.url)}`}${r.note === undefined ? "" : `; ${r.note}`}\n`,
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

const REQUEST_USAGE =
  "usage: agent-factory request <tracker.comment|tracker.create|notify> --file <draft.json>\n" +
  "       agent-factory request spec.body --file <home>/specs/<project>/<ticket>/spec.md\n";

// request <capability> --file draft.json : exit 0 done, 3 waiting for confirm, 1 refused
async function requestCommand(argv: readonly string[], io: Io): Promise<number> {
  const words = requestWords(argv);
  if (words === "bad") {
    io.err(REQUEST_USAGE);
    return 64;
  }
  const draft = await draftText(io.home, words.file);
  if (draft.kind === "failed") {
    return fail(io, "request", draft.reason);
  }
  if (words.capability === SPEC_BODY) {
    const body = specBodyOf({ home: io.home, specs: draft.value.specs, file: draft.value.file }, draft.value.text);
    return said(io, "request", body.kind === "ok" ? await requestSpecBody(specBodySetup(io), body.value) : body);
  }
  return said(io, "request", await request(await requestSetup(io), words.capability, draft.value.text));
}

// specBodySetup : the project's spec store and its forge, for a spec change sent as the issue's body (#542)
function specBodySetup(io: Io): SpecBodySetup {
  return { home: io.home, specs: (project) => specsOf(io, project), issues: (project) => forgeOf(io, project) };
}

// requestSetup : the plugin setup, and the spec store of a draft's project from its resolved settings (#381): the
// approval a write counts against is checked against the issue's body when the project keeps its specs there
async function requestSetup(io: Io): Promise<RequestSetup> {
  const setup = await pluginSetup(io.home, io.env, io.secrets);
  return { ...setup, specs: (project) => specsOf(io, project) };
}

async function specsOf(io: Io, project: string): Promise<Result<SpecStore>> {
  const settings = await runSettings({ home: io.home, project, env: io.env });
  if (settings.kind === "failed") {
    return settings;
  }
  const env = settings.value.env;
  return specStoreOf({ env, home: io.home, open: openOnce(() => openedForge(io, project, env)) });
}

// forgeOf : the project's forge, from its resolved settings
async function forgeOf(io: Io, project: string): Promise<Result<Forge>> {
  const settings = await runSettings({ home: io.home, project, env: io.env });
  return settings.kind === "ok" ? openedForge(io, project, settings.value.env) : settings;
}

async function openedForge(io: Io, project: string, env: NodeJS.ProcessEnv): Promise<Result<Forge>> {
  const opened = await openProjectForge(
    { env, log: (line) => io.err(`${line}\n`) },
    { home: io.home, project, plugins: await pluginSetup(io.home, env) },
  );
  return opened.kind === "ok" ? { kind: "ok", value: opened.value.forge } : opened;
}

type DraftFile = { readonly specs: string; readonly file: string; readonly text: string };

// draftText : a draft from the spec drafts folder only, where the coordinator writes, so request reads no other file;
// with the folder's and the file's real paths
async function draftText(home: string, file: string): Promise<Result<DraftFile>> {
  const specs = await realpath(join(home, "specs")).catch(() => "");
  const real = await realpath(file).catch(() => "");
  if (specs === "" || !real.startsWith(`${specs}${sep}`)) {
    return refused(`a draft is read only from ${join(home, "specs")}, got ${JSON.stringify(file)}`);
  }
  const text = await attempt(() => readFile(real, "utf8"), `cannot read ${file}`);
  return text.kind === "ok" ? { kind: "ok", value: { specs, file: real, text: text.value } } : text;
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
  return said(io, "confirm", await confirmed(io, id, text));
}

// confirmed : a kept spec change goes to the issue (spec-body.ts); any other kept write to its connector
async function confirmed(io: Io, id: string, text: string): Promise<Confirmed> {
  const spec = parseId(io.home, id);
  return spec.kind === "ok" && spec.value.capability === SPEC_BODY
    ? confirmSpecBody(specBodySetup(io), spec.value, { id, text })
    : confirm(await requestSetup(io), id, text);
}

async function templateText(template: string | undefined, env: NodeJS.ProcessEnv): Promise<Result<string>> {
  if (template === undefined) {
    return { kind: "ok", value: initialProject() };
  }
  if (!isAbsolute(template)) {
    return { kind: "failed", reason: `a template is named by its absolute path, got ${JSON.stringify(template)}` };
  }
  const text = await attempt(() => readFile(template, "utf8"), `cannot read ${template}`);
  return text.kind === "ok" ? checkedTemplate(template, text.value, env) : text;
}

function parsedObject(text: string): object | "bad" {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value : "bad";
  } catch {
    return "bad";
  }
}

// checkedTemplate : a team's template, copied only when its plugin fields and its ready fields read, so the file it
// becomes never stops a dispatcher pass; the core never reads the template again
function checkedTemplate(path: string, text: string, env: NodeJS.ProcessEnv): Result<string> {
  const raw = parsedObject(text);
  if (raw === "bad") {
    return refused(`${path} is not a JSON object`);
  }
  const config = pluginConfigOf(path, raw);
  const ready = config.kind === "ok" ? readyFieldsOf(path, raw, env) : config;
  return ready.kind === "failed" ? ready : { kind: "ok", value: text };
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
    ? await templateText(words.template, io.env)
    : refused(`${JSON.stringify(words.project)} is not a plain project name`);
  const done = text.kind === "ok" ? await written(projectPath(io.home, words.project), text.value) : text;
  if (done.kind === "failed") {
    return fail(io, "project init", done.reason);
  }
  io.out(
    `wrote ${done.value}: map each capability to a connector under "connectors"; add gate and ready.programs before the ready check runs\n`,
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
  request spec.body --file <home>/specs/<project>/<ticket>/spec.md
                               keep a spec change, the issue's whole new body, for confirm (3) or refuse it (1); with
                               "specStore": "issue" only (#542)
  confirm <id> '<text>'        perform a kept write, when the text is the one request printed; run it only behind
                               the harness ask prompt
  project init <project> [--template <file>]
                               write <home>/projects/<project>.json from a team's template, or the default policy
`;
