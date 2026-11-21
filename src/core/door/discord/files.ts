// door/discord/files — what the Discord door reads at boot, under <factory home>/door/discord (#731): its bot token
// and people.json, the allowlist that maps a Discord user id to a named person and a channel id to a project. Both,
// and the folders above them, must belong to the user that runs the door (on the VM, the `factory` OS user). The
// door refuses a token file that group or others can read, and a people.json or a folder that group or others can
// write, since anyone who could change people.json could name themselves. No failure carries the token file's text,
// and a pasted text that is not a bot token is never echoed.

import type { Stats } from "node:fs";
import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Result } from "../../forge/api.js";
import { plainName } from "../../spec.js";
import { prop } from "../../field.js";

export type DoorConfig = {
  readonly guild: string;
  readonly channels: Readonly<Record<string, string>>;
  readonly people: Readonly<Record<string, string>>;
};

export const SNOWFLAKE = /^\d{17,20}$/;
const TOKEN = /^[\w-]{20,}\.[\w-]{4,}\.[\w-]{20,}$/;

export function doorDir(home: string): string {
  return join(home, "door", "discord");
}

const failed = (reason: string): Result<never> => ({ kind: "failed", reason });

async function statOf(path: string): Promise<Stats | "missing" | "unreadable"> {
  try {
    return await lstat(path);
  } catch (error: unknown) {
    return prop(error, "code") === "ENOENT" ? "missing" : "unreadable";
  }
}

function ownedByMe(stat: Stats): boolean {
  const me = process.getuid?.();
  return me === undefined || stat.uid === me;
}

type Entry = {
  readonly path: string;
  readonly kind: "file" | "folder";
  readonly forbidden: number;
  readonly what: string;
};

function entryProblem(stat: Stats, e: Entry): string | undefined {
  const mode = (stat.mode & 0o777).toString(8);
  const rules: readonly (readonly [boolean, string])[] = [
    [e.kind === "file" ? !stat.isFile() : !stat.isDirectory(), `${e.path} is not a plain ${e.kind}`],
    [!ownedByMe(stat), `${e.path} belongs to another user: the user that runs the door must own it`],
    [(stat.mode & e.forbidden) !== 0, `${e.path} is ${e.what} by group or others (mode ${mode})`],
  ];
  return rules.find(([bad]) => bad)?.[1];
}

async function safeEntry(e: Entry): Promise<Result<true>> {
  const stat = await statOf(e.path);
  if (typeof stat === "string") {
    return failed(stat === "missing" ? `${e.path} is missing` : `cannot read ${e.path}`);
  }
  const problem = entryProblem(stat, e);
  return problem === undefined ? { kind: "ok", value: true } : failed(problem);
}

async function safeFile(home: string, file: Omit<Entry, "kind">): Promise<Result<true>> {
  const folders = [join(home, "door"), doorDir(home)].map(
    (path): Entry => ({ path, kind: "folder", forbidden: 0o022, what: "writable" }),
  );
  for (const e of [...folders, { ...file, kind: "file" as const }]) {
    const safe = await safeEntry(e);
    if (safe.kind === "failed") {
      return safe;
    }
  }
  return { kind: "ok", value: true };
}

export async function readDoorToken(home: string): Promise<Result<string>> {
  const path = join(doorDir(home), "token");
  const safe = await safeFile(home, { path, forbidden: 0o077, what: "readable" });
  if (safe.kind === "failed") {
    return failed(`${safe.reason}; store the door's token with agent-factory setup door-discord (it is chmod 600)`);
  }
  const text = (await readFile(path, "utf8").catch(() => "")).trim();
  return TOKEN.test(text) ? { kind: "ok", value: text } : failed(`${path} does not hold a Discord bot token`);
}

export async function storeDoorToken(home: string, pasted: string): Promise<Result<string>> {
  const token = pasted.trim();
  if (!TOKEN.test(token)) {
    return failed("that is not a Discord bot token: copy it from the Bot tab of the Developer Portal");
  }
  const dir = doorDir(home);
  const path = join(dir, "token");
  const temp = `${path}.${process.pid}.tmp`;
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await chmod(dir, 0o700);
    await writeFile(temp, `${token}\n`, { mode: 0o600, flag: "wx" });
    await rename(temp, path);
    return { kind: "ok", value: path };
  } catch (error: unknown) {
    const left = await rm(temp, { force: true }).then(
      () => "",
      (removing: unknown) => `; ${temp} is left: ${removing instanceof Error ? removing.name : "it cannot be removed"}`,
    );
    return failed(
      `cannot store the token in ${dir}: ${error instanceof Error ? error.name : "the write failed"}${left}`,
    );
  }
}

function idMap(value: unknown, what: string, valid: (v: string) => boolean): Result<Record<string, string>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return failed(`${what} must be an object of id → name`);
  }
  const all: readonly (readonly [string, unknown])[] = Object.entries(value);
  const good = all.flatMap(([id, v]) => (typeof v === "string" && SNOWFLAKE.test(id) && valid(v) ? [[id, v]] : []));
  const bad = all.find(([id]) => !good.some(([g]) => g === id));
  return bad === undefined
    ? { kind: "ok", value: Object.fromEntries(good) }
    : failed(`${what} holds a bad entry for ${JSON.stringify(bad[0])}`);
}

function configOf(value: unknown, path: string): Result<DoorConfig> {
  const guild = prop(value, "guild");
  if (typeof guild !== "string" || !SNOWFLAKE.test(guild)) {
    return failed(`${path}: guild must be the server's id`);
  }
  const channels = idMap(prop(value, "channels"), `${path}: channels`, plainName);
  const people = idMap(prop(value, "people"), `${path}: people`, (name) => name.trim() !== "");
  if (channels.kind === "failed") {
    return channels;
  }
  return people.kind === "failed"
    ? people
    : { kind: "ok", value: { guild, channels: channels.value, people: people.value } };
}

export async function readDoorConfig(home: string): Promise<Result<DoorConfig>> {
  const path = join(doorDir(home), "people.json");
  const safe = await safeFile(home, { path, forbidden: 0o022, what: "writable" });
  if (safe.kind === "failed") {
    return safe;
  }
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    return configOf(parsed, path);
  } catch {
    return failed(`${path} is not valid JSON`);
  }
}
