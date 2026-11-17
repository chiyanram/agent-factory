// door/discord/who — the Discord door's own check of who is at it (ADR-0023 D2, D4). It names a person only from
// people.json: a Discord user id mapped there, in the door's guild, in a channel (or a thread of one) mapped to a
// project. It refuses a bot, an unmapped id, a direct message, an unknown guild and any other channel, and makes the
// person through vouch, so the records say via discord.

import { field } from "../../human-record.js";
import type { Refused } from "../../spec.js";
import { vouch, type Person } from "../person.js";
import type { DoorConfig } from "./files.js";

// the fields the door reads from an INTERACTION_CREATE; anything else in it is ignored
export type Interaction = {
  // 2 a slash command, 3 a button
  readonly type: number;
  readonly guild: string | undefined;
  readonly channel: string | undefined;
  // a thread's parent channel; undefined for a channel
  readonly parent: string | undefined;
  readonly user: string | undefined;
  readonly bot: boolean;
  // "" when the interaction carries none
  readonly command: string;
  readonly ticket: string;
  readonly customId: string;
};

// who gave the word, from where, as the door's check found them
export type Asker = { readonly person: Person; readonly user: string; readonly project: string };

// Discord's thread channel types: announcement, public and private threads
const THREAD_TYPES: ReadonlySet<unknown> = new Set([10, 11, 12]);

// text : the string at that path in a value, or undefined. Pure.
function text(value: unknown, ...path: readonly string[]): string | undefined {
  const found = path.reduce((at, name) => field(at, name), value);
  return typeof found === "string" ? found : undefined;
}

// userOf : the user who acted: a guild member's, else a direct message's
function userOf(raw: unknown): unknown {
  return field(field(raw, "member"), "user") ?? field(raw, "user");
}

function parentOf(raw: unknown): string | undefined {
  const channel = field(raw, "channel");
  return THREAD_TYPES.has(field(channel, "type")) ? text(channel, "parent_id") : undefined;
}

function ticketOption(raw: unknown): string | undefined {
  const options = field(field(raw, "data"), "options");
  const list: readonly unknown[] = Array.isArray(options) ? options : [];
  return text(
    list.find((o) => field(o, "name") === "ticket"),
    "value",
  );
}

function typeOf(raw: unknown): number {
  const type = field(raw, "type");
  return typeof type === "number" ? type : 0;
}

// parse : the fields the door reads. Pure.
export function parse(raw: unknown): Interaction {
  const user = userOf(raw);
  return {
    type: typeOf(raw),
    guild: text(raw, "guild_id"),
    channel: text(raw, "channel", "id") ?? text(raw, "channel_id"),
    parent: parentOf(raw),
    user: text(user, "id"),
    bot: field(user, "bot") === true,
    command: text(raw, "data", "name") ?? "",
    ticket: ticketOption(raw) ?? "",
    customId: text(raw, "data", "custom_id") ?? "",
  };
}

// mapped : the value under an own key of the map, or undefined. Pure.
function mapped(map: Readonly<Record<string, string>>, key: string | undefined): string | undefined {
  return key !== undefined && Object.hasOwn(map, key) ? map[key] : undefined;
}

// askerOf : the vouched person, when the project, the name and the user id are all known
function askerOf(project: string | undefined, name: string | undefined, user: string | undefined): Asker | Refused {
  if (project === undefined || name === undefined || user === undefined) {
    return { kind: "refused", reason: "your Discord id is not mapped to a person in people.json" };
  }
  const person = vouch("discord", name);
  return person.kind === "person" ? { person, user, project } : person;
}

// check : the person behind an interaction, or why the door will not name one. The first rule that fails is the
// reason.
export function check(config: DoorConfig, at: Interaction): Asker | Refused {
  const project = mapped(config.channels, at.parent ?? at.channel);
  const rules: readonly (readonly [boolean, string])[] = [
    [at.bot, "a bot cannot give a person's word"],
    [at.guild !== config.guild, "this door answers only in its own server, never in a direct message"],
    [project === undefined, "this channel is not mapped to a project in people.json"],
  ];
  const broken = rules.find(([fails]) => fails);
  return broken === undefined
    ? askerOf(project, mapped(config.people, at.user), at.user)
    : { kind: "refused", reason: broken[1] };
}
