// door/discord/files — what the Discord door reads at boot, under <factory home>/door/discord (#731): its bot token
// and people.json, the allowlist that maps a Discord user id to a named person and a channel id to a project. Both,
// and the folders above them, must belong to the user that runs the door (on the VM, the `factory` OS user). The
// door refuses a token file that group or others can read, and a people.json or a folder that group or others can
// write, since anyone who could change people.json could name themselves.

import type { Stats } from "node:fs";
import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Result } from "../../forge/api.js";
import { field } from "../../human-record.js";
import { plainName } from "../../spec.js";

export type DoorConfig = {
  // the one server the door answers in; its commands are registered there
  readonly guild: string;
  // channel id → project; a thread maps through its parent channel
  readonly channels: Readonly<Record<string, string>>;
  // user id → the person's name, as the records' `by`
  readonly people: Readonly<Record<string, string>>;
};

// a Discord id (a snowflake)
const SNOWFLAKE = /^\d{17,20}$/;
// a bot token as Discord gives one: three dot-separated parts of URL-safe base64
const TOKEN = /^[\w-]{20,}\.[\w-]{4,}\.[\w-]{20,}$/;

export function doorDir(home: string): string {
  return join(home, "door", "discord");
}

const failed = (reason: string): Result<never> => ({ kind: "failed", reason });

// statOf : the file's own stat (a link is not followed), or why there is none
async function statOf(path: string): Promise<Stats | "missing" | "unreadable"> {
  try {
    return await lstat(path);
  } catch (error: unknown) {
    return field(error, "code") === "ENOENT" ? "missing" : "unreadable";
  }
}

// ownedByMe : whether the door's own OS user (on the VM, `factory`) owns it; true where the OS has no uids
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

// entryProblem : why the entry is not safe for the door, or undefined. Pure.
function entryProblem(stat: Stats, e: Entry): string | undefined {
  const mode = (stat.mode & 0o777).toString(8);
  const rules: readonly (readonly [boolean, string])[] = [
    [e.kind === "file" ? !stat.isFile() : !stat.isDirectory(), `${e.path} is not a plain ${e.kind}`],
    [!ownedByMe(stat), `${e.path} belongs to another user: the user that runs the door must own it`],
    [(stat.mode & e.forbidden) !== 0, `${e.path} is ${e.what} by group or others (mode ${mode})`],
  ];
  return rules.find(([bad]) => bad)?.[1];
}

// safeEntry : the entry is there, of its kind, the door's user's own, and its mode keeps the forbidden bits clear
async function safeEntry(e: Entry): Promise<Result<true>> {
  const stat = await statOf(e.path);
  if (typeof stat === "string") {
    return failed(stat === "missing" ? `${e.path} is missing` : `cannot read ${e.path}`);
  }
  const problem = entryProblem(stat, e);
  return problem === undefined ? { kind: "ok", value: true } : failed(problem);
}

// safeFile : the file, and the two folders above it (<home>/door and <home>/door/discord), each safe: a folder that
// another user could write would let them swap the file
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

// readDoorToken : the bot token; a missing file names the setup step, and a file group or others can read is refused.
// No failure carries the file's text.
export async function readDoorToken(home: string): Promise<Result<string>> {
  const path = join(doorDir(home), "token");
  const safe = await safeFile(home, { path, forbidden: 0o077, what: "readable" });
  if (safe.kind === "failed") {
    return failed(`${safe.reason}; store the door's token with agent-factory setup door-discord (it is chmod 600)`);
  }
  const text = (await readFile(path, "utf8").catch(() => "")).trim();
  return TOKEN.test(text) ? { kind: "ok", value: text } : failed(`${path} does not hold a Discord bot token`);
}

// storeDoorToken : the pasted token, at 0600 in a 0700 folder, through a temp file and a rename; text that is not a
// bot token is refused and never echoed
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
    // a folder made earlier keeps its mode through mkdir
    await chmod(dir, 0o700);
    await writeFile(temp, `${token}\n`, { mode: 0o600, flag: "wx" });
    await rename(temp, path);
    return { kind: "ok", value: path };
  } catch (error: unknown) {
    await rm(temp, { force: true }).catch(() => undefined); // best effort: the temp may never have been made
    return failed(`cannot store the token in ${dir}: ${error instanceof Error ? error.name : "the write failed"}`);
  }
}

// idMap : an object of Discord id → a valid string, or the first entry that is not one
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

// configOf : people.json checked: a guild id, channel ids to plain project names, user ids to non-blank names
function configOf(value: unknown, path: string): Result<DoorConfig> {
  const guild = field(value, "guild");
  if (typeof guild !== "string" || !SNOWFLAKE.test(guild)) {
    return failed(`${path}: guild must be the server's id`);
  }
  const channels = idMap(field(value, "channels"), `${path}: channels`, plainName);
  const people = idMap(field(value, "people"), `${path}: people`, (name) => name.trim() !== "");
  if (channels.kind === "failed") {
    return channels;
  }
  return people.kind === "failed"
    ? people
    : { kind: "ok", value: { guild, channels: channels.value, people: people.value } };
}

// readDoorConfig : people.json, refused when group or others can write it
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
