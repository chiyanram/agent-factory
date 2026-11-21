// coordinator-discord — `agent-factory coordinator <project> --discord`: the coordinator in its project's Discord
// channel, through Claude Code's official Discord channel plugin (#548 S-1, S-2). One bot and one state folder per
// project; the operator makes a thread per ticket by hand, and the one coordinator session sees the channel and all
// its threads. This module builds the launch and checks the plugin's two files before it; it writes neither.
//
//   <home>/.claude/channels/discord-<project>/.env          the channel bot's token, the session user's own, 0600
//   <home>/.claude/channels/discord-<project>/access.json   the static allowlist: root-owned and read-only on the VM
//
// The plugin reads access.json once at boot in static mode, so the check runs on every start: a file loosened while
// the session ran is refused at the next one.
//
// The launch keeps the person's user settings out with --setting-sources project, so --settings enables this one
// plugin. dontAsk refuses anything that would prompt, so no permission prompt reaches the plugin's relay. Every start
// is fresh from the handoff note, never --continue or --resume.
//
// Today: the project channel's groups.<id>.allowFrom must equal the DM allowFrom because #548 read the plugin's
// server.ts as gating the relay's text path (`yes <id>`) by the channel's list alone; #729's hand test confirms it.

import type { Stats } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Result } from "./forge/api.js";
import type { Argv } from "./project.js";
import { SNOWFLAKE } from "./door/discord/files.js";
import { AUTOCOMPACT } from "./coordinator-turns.js";
import { DISCORD_PLUGIN } from "./agent/claude-plugins.js";
import { prop } from "./field.js";

export { DISCORD_PLUGIN };

// Today: the relay stays off until the hand test #729 shows its text path is safe.
export function discordArgv(): Argv {
  return [
    "claude",
    "--setting-sources",
    "project",
    "--settings",
    JSON.stringify({ enabledPlugins: { [DISCORD_PLUGIN]: true } }),
    "--channels",
    `plugin:${DISCORD_PLUGIN}`,
    "--permission-mode",
    "dontAsk",
    "--autocompact",
    AUTOCOMPACT,
  ];
}

export function discordStateDir(home: string, project: string): string {
  return join(home, ".claude", "channels", `discord-${project}`);
}

export function discordEnv(env: NodeJS.ProcessEnv, stateDir: string): NodeJS.ProcessEnv {
  const { DISCORD_BOT_TOKEN: _dropped, ...rest } = env;
  return { ...rest, DISCORD_ACCESS_MODE: "static", DISCORD_STATE_DIR: stateDir };
}

function snowflakes(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) && value.every((v) => typeof v === "string" && SNOWFLAKE.test(v))
    ? (value as readonly string[])
    : undefined;
}

function samePeople(channel: readonly string[], people: readonly string[] | undefined): boolean {
  const left = new Set(channel);
  const right = new Set(people ?? channel);
  return left.size === right.size && [...left].every((id) => right.has(id));
}

function objectOf(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : undefined;
}

function channelProblems(id: string, group: unknown, people: readonly string[] | undefined): readonly string[] {
  if (!SNOWFLAKE.test(id)) {
    return [`groups holds ${JSON.stringify(id)}, which is not a channel id`];
  }
  const allowed = snowflakes(prop(group, "allowFrom")) ?? [];
  if (allowed.length === 0) {
    return [`groups.${id}.allowFrom must list the mapped people: empty, anyone in the channel can allow a tool call`];
  }
  return samePeople(allowed, people)
    ? []
    : [`groups.${id}.allowFrom must be the same people as allowFrom, the mapped people`];
}

function groupProblems(groups: unknown, people: readonly string[] | undefined): readonly string[] {
  const entries = Object.entries(objectOf(groups) ?? {});
  const only = entries.length === 1 ? entries[0] : undefined;
  return only === undefined
    ? [`groups must hold exactly one channel, the project's (it holds ${entries.length})`]
    : channelProblems(only[0], only[1], people);
}

function policyProblems(access: unknown): readonly string[] {
  const people = snowflakes(prop(access, "allowFrom")) ?? [];
  return [
    ...(prop(access, "dmPolicy") === "allowlist" ? [] : ["dmPolicy must be allowlist"]),
    ...(people.length === 0 ? ["allowFrom must list the mapped people's user ids"] : []),
  ];
}

function pendingProblems(pending: unknown): readonly string[] {
  const codes = pending === undefined ? {} : objectOf(pending);
  return codes !== undefined && Object.keys(codes).length === 0
    ? []
    : ["pending must be empty: a pairing code would add a person outside the list"];
}

export function accessProblems(access: unknown): readonly string[] {
  if (objectOf(access) === undefined) {
    return ["it is not a JSON object"];
  }
  return [
    ...policyProblems(access),
    ...groupProblems(prop(access, "groups"), snowflakes(prop(access, "allowFrom"))),
    ...pendingProblems(prop(access, "pending")),
  ];
}

export type Entry = Pick<Stats, "mode" | "uid"> & {
  readonly link: boolean;
  readonly file: boolean;
  readonly folder: boolean;
};

type Rule = readonly [boolean, string];

const firstBroken = (rules: readonly Rule[]): string | undefined => rules.find(([bad]) => bad)?.[1];
const modeOf = (e: Entry): string => (e.mode & 0o777).toString(8);
const plainAs = (e: Entry, kind: "file" | "folder"): boolean => !e.link && (kind === "file" ? e.file : e.folder);

// The Discord plugin chmods its .env to 0600 at boot and skips the file when that fails.
// https://github.com/anthropics/claude-plugins-official/blob/668a0c6542d1da594f2d49ddab382198abbddbb2/external_plugins/discord/server.ts
export function tokenFileProblem(path: string, e: Entry | undefined, uid: number): string | undefined {
  if (e === undefined) {
    return `${path} is missing`;
  }
  return firstBroken([
    [!plainAs(e, "file"), `${path} is not a plain file`],
    [e.uid !== uid, `${path} belongs to another user: the coordinator's own user must own it`],
    [(e.mode & 0o077) !== 0, `${path} is readable by group or others (mode ${modeOf(e)})`],
  ]);
}

export function accessFileProblem(path: string, e: Entry | undefined, kind: "file" | "folder"): string | undefined {
  if (e === undefined) {
    return `${path} is missing`;
  }
  return firstBroken([
    [!plainAs(e, kind), `${path} is not a plain ${kind}`],
    [(e.mode & 0o022) !== 0, `${path} is writable by group or others (mode ${modeOf(e)})`],
  ]);
}

export function stateFolderProblem(path: string, e: Entry | undefined, uid: number): string | undefined {
  return (
    accessFileProblem(path, e, "folder") ??
    (e?.uid === uid ? undefined : `${path} belongs to another user: the coordinator's own user must own it`)
  );
}

export function ownWarning(path: string, e: Entry | undefined, uid: number): string | undefined {
  return e?.uid === uid
    ? `${path} belongs to the coordinator's own user, which can rewrite it; on the VM make it root's, mode 444`
    : undefined;
}

async function entryOf(path: string): Promise<Entry | undefined> {
  try {
    const s = await lstat(path);
    return { mode: s.mode, uid: s.uid, link: s.isSymbolicLink(), file: s.isFile(), folder: s.isDirectory() };
  } catch {
    return undefined;
  }
}

function parsed(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

const fix = (dir: string): string => `; see docs/how-to/set-up-coordinator-discord.md (the state folder is ${dir})`;

async function filesProblem(dir: string, uid: number): Promise<string | undefined> {
  const env = join(dir, ".env");
  const access = join(dir, "access.json");
  return (
    stateFolderProblem(dir, await entryOf(dir), uid) ??
    tokenFileProblem(env, await entryOf(env), uid) ??
    accessFileProblem(access, await entryOf(access), "file")
  );
}

function contentProblems(text: string): readonly string[] {
  const value = parsed(text);
  return value === undefined ? ["it is not valid JSON"] : accessProblems(value);
}

export async function checkDiscord(dir: string, uid: number): Promise<Result<readonly string[]>> {
  const problem = await filesProblem(dir, uid);
  if (problem !== undefined) {
    return { kind: "failed", reason: `${problem}${fix(dir)}` };
  }
  const path = join(dir, "access.json");
  const loose = contentProblems(await readFile(path, "utf8").catch(() => ""));
  if (loose.length > 0) {
    return { kind: "failed", reason: `${path} is looser than the wall:\n${loose.map((p) => `  - ${p}`).join("\n")}` };
  }
  const warning = ownWarning(path, await entryOf(path), uid);
  return { kind: "ok", value: warning === undefined ? [] : [warning] };
}
