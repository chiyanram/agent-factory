// door/discord/who — the Discord door's own check of who is at it (ADR-0023 D2, D4). It names a person only from
// people.json: a Discord user id mapped there, in the door's guild, in a channel (or a thread of one) mapped to a
// project. It refuses a bot, an unmapped id, a direct message, an unknown guild and any other channel, and makes the
// person through vouch, so the records say via discord.

import { field } from "../../human-record.js";
import type { Refused } from "../../spec.js";
import { vouch, type Person } from "../person.js";
import type { DoorConfig } from "./files.js";

export type Interaction = {
  // 2 a slash command, 3 a button
  // https://docs.discord.com/developers/interactions/receiving-and-responding
  readonly type: number;
  readonly guild: string | undefined;
  readonly channel: string | undefined;
  readonly parent: string | undefined;
  readonly user: string | undefined;
  readonly bot: boolean;
  readonly command: string;
  readonly ticket: string;
  readonly customId: string;
};

export type Asker = { readonly person: Person; readonly user: string; readonly project: string };

// Discord's thread channel types: announcement, public and private threads
// https://docs.discord.com/developers/resources/channel
const THREAD_TYPES: ReadonlySet<unknown> = new Set([10, 11, 12]);

function text(value: unknown, ...path: readonly string[]): string | undefined {
  const found = path.reduce((at, name) => field(at, name), value);
  return typeof found === "string" ? found : undefined;
}

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

function mapped(map: Readonly<Record<string, string>>, key: string | undefined): string | undefined {
  return key !== undefined && Object.hasOwn(map, key) ? map[key] : undefined;
}

function askerOf(project: string | undefined, name: string | undefined, user: string | undefined): Asker | Refused {
  if (project === undefined || name === undefined || user === undefined) {
    return { kind: "refused", reason: "your Discord id is not mapped to a person in people.json" };
  }
  const person = vouch("discord", name);
  return person.kind === "person" ? { person, user, project } : person;
}

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
