// door/discord/door — the Discord door's three commands (ADR-0023 D4; #548 S-3), for the person its own check named
// (who.ts). The word is written only through the seam (write.ts), so the record says via discord and a model run is
// refused there too.
//
// /start writes START, and asks for a Confirm first when factory/<ticket> is on the git host, as the terminal does.
// /approve shows the lane, the full hash and the spec's text, its ## Design included (shown.ts), and binds the hash to a
// one-use nonce held in memory for ten minutes; a Confirm by the same person approves exactly that hash, so `approve`
// refuses a spec edited in between. /board is read only. Waive and merge stay off Discord. A restart drops every pending Confirm.

import type { Result } from "../../forge/api.js";
import type { Where } from "../../approval.js";
import type { Start } from "../../start.js";
import { plainName } from "../../spec.js";
import { approveAs, startAs } from "../write.js";
import type { DoorConfig } from "./files.js";
import { shown, type Shown } from "./shown.js";
import type { Attached } from "./transport.js";
import { check, parse, type Asker, type Interaction } from "./who.js";

export const CONFIRM_MS = 10 * 60 * 1000;

export type Reply = {
  readonly text: string;
  readonly files: readonly Attached[];
  readonly confirm?: string;
  readonly line: string;
};

export type DoorDeps = {
  readonly config: DoorConfig;
  readonly env: NodeJS.ProcessEnv;
  readonly now: () => number;
  readonly nonce: () => string;
  readonly scrub: (text: string) => string;
  readonly open: (project: string) => Promise<Result<ProjectDoor>>;
};

export type ProjectDoor = {
  readonly home: string;
  readonly specs: (ticket: string) => Result<Where>;
  readonly branchThere: (ticket: string) => Promise<Result<boolean>>;
  readonly board: () => Promise<Result<string>>;
  readonly after: () => Promise<void>;
};

type Pending =
  | { readonly kind: "start"; readonly project: string; readonly ticket: string; readonly user: string }
  | {
      readonly kind: "approve";
      readonly project: string;
      readonly ticket: string;
      readonly user: string;
      readonly spec: string;
    };

type Held = Pending & { readonly until: number };

type At = Asker & { readonly door: ProjectDoor };

type Said = Omit<Reply, "line">;

const CONFIRM = "confirm:";
const NONCE = /^[0-9a-f]{32}$/;

const refused = (reason: string): Said => ({ text: `refused: ${reason}`, files: [] });
const said = (text: string): Said => ({ text, files: [] });

function nonceOf(customId: string): string {
  const nonce = customId.startsWith(CONFIRM) ? customId.slice(CONFIRM.length) : "";
  return NONCE.test(nonce) ? nonce : "";
}

function approveText(project: string, ticket: string, seen: Shown): string {
  return [
    `Approve ${project}/${ticket}, lane ${seen.lane}: ${seen.title}`,
    `the hash ${seen.spec}`,
    "The spec is attached, its ## Design included. Confirm within 10 minutes approves exactly this hash; an edit to the spec before then makes Confirm refuse.",
  ].join("\n");
}

function whatOf(i: Interaction): string {
  return i.type === 3 ? "Confirm" : `/${JSON.stringify(i.command)} ${JSON.stringify(i.ticket)}`;
}

export type DiscordDoor = { readonly handle: (raw: unknown) => Promise<Reply> };

export function discordDoor(deps: DoorDeps): DiscordDoor {
  const held = new Map<string, Held>();

  const sweep = (): void => {
    for (const [nonce, h] of held) {
      if (h.until <= deps.now()) {
        held.delete(nonce);
      }
    }
  };

  const hold = (pending: Pending): string => {
    sweep();
    const nonce = deps.nonce();
    held.set(nonce, { ...pending, until: deps.now() + CONFIRM_MS });
    return `${CONFIRM}${nonce}`;
  };

  const stamp = (): string => new Date(deps.now()).toISOString();

  const asked = (at: At, ticket: string, question: string): Said => {
    const confirm = hold({ kind: "start", project: at.project, ticket, user: at.user });
    return { text: `${question}. Confirm within 10 minutes to START anyway.`, files: [], confirm };
  };

  const written = async (at: At, ticket: string, result: Start): Promise<Said> => {
    if (result.kind === "refused") {
      return refused(result.reason);
    }
    if (result.kind === "ask") {
      return asked(at, ticket, result.question);
    }
    await at.door.after();
    return said(`started ${at.project}/${ticket} by ${result.record.by} at ${result.record.at}`);
  };

  const started = async (at: At, ticket: string, there: boolean, confirmed: boolean): Promise<Said> => {
    const where = { home: at.door.home, project: at.project, ticket };
    const branch = there ? "present" : "absent";
    return written(at, ticket, await startAs(at.person, { where, at: stamp(), branch, confirmed }, deps.env));
  };

  const startCommand = async (at: At, ticket: string): Promise<Said> => {
    const there = await at.door.branchThere(ticket);
    return there.kind === "ok"
      ? started(at, ticket, there.value, false)
      : refused(`cannot tell whether factory/${ticket} is on the git host: ${there.reason}`);
  };

  const approveCommand = async (at: At, ticket: string): Promise<Said> => {
    const where = at.door.specs(ticket);
    const seen = where.kind === "ok" ? await shown(where.value, deps.scrub) : { kind: "refused", reason: where.reason };
    if ("kind" in seen) {
      return refused(seen.reason);
    }
    const { project, user } = at;
    const confirm = hold({ kind: "approve", project, ticket, user, spec: seen.spec });
    const files: Attached[] = [{ name: `${ticket}-spec.md`, text: seen.specText }];
    return { text: approveText(project, ticket, seen), files, confirm };
  };

  const approved = async (at: At, p: Extract<Pending, { kind: "approve" }>): Promise<Said> => {
    const where = at.door.specs(p.ticket);
    const request = (w: Where) => ({ where: w, seenHash: p.spec, at: stamp() });
    const result =
      where.kind === "ok"
        ? await approveAs(at.person, request(where.value), deps.env)
        : { kind: "refused" as const, reason: where.reason };
    if (result.kind === "refused") {
      return refused(result.reason);
    }
    await at.door.after();
    const r = result.record;
    return said(`approved ${p.project}/${p.ticket}, the hash ${r.spec_hash}, by ${r.by} at ${r.at}`);
  };

  const confirmed = (at: At, customId: string): Promise<Said> => {
    sweep();
    const nonce = nonceOf(customId);
    const pending = held.get(nonce);
    if (pending === undefined) {
      return Promise.resolve(refused("this Confirm is unknown or past its 10 minutes; run /approve again, or /start"));
    }
    if (pending.user !== at.user || pending.project !== at.project) {
      return Promise.resolve(refused(`only the person who ran /${pending.kind} can confirm it`));
    }
    held.delete(nonce);
    return pending.kind === "approve" ? approved(at, pending) : started(at, pending.ticket, true, true);
  };

  const board = async (at: At): Promise<Said> => {
    const text = await at.door.board();
    return text.kind === "ok" ? said(text.value) : refused(`cannot read the board: ${text.reason}`);
  };

  const TICKET_COMMANDS: Readonly<Record<string, (at: At, ticket: string) => Promise<Said>>> = {
    start: startCommand,
    approve: approveCommand,
  };

  const commanded = (at: At, command: string, ticket: string): Promise<Said> => {
    if (command === "board") {
      return board(at);
    }
    const run = Object.hasOwn(TICKET_COMMANDS, command) ? TICKET_COMMANDS[command] : undefined;
    if (run === undefined) {
      const named = JSON.stringify(command);
      return Promise.resolve(refused(`${named} is not a door command: waive and merge stay at the terminal`));
    }
    return plainName(ticket)
      ? run(at, ticket)
      : Promise.resolve(refused(`${JSON.stringify(ticket)} is not a plain ticket name`));
  };

  const answer = async (asker: Asker, i: Interaction): Promise<Said> => {
    const door = await deps.open(asker.project);
    if (door.kind === "failed") {
      return refused(`cannot open ${asker.project}: ${door.reason}`);
    }
    const at: At = { ...asker, door: door.value };
    if (i.type === 2) {
      return commanded(at, i.command, i.ticket);
    }
    return i.type === 3
      ? confirmed(at, i.customId)
      : refused("the door takes only its slash commands and their Confirm button");
  };

  const handle = async (raw: unknown): Promise<Reply> => {
    const i = parse(raw);
    const asker = check(deps.config, i);
    if ("kind" in asker) {
      return { ...refused(asker.reason), line: `refused ${whatOf(i)} from ${i.user ?? "no user"}: ${asker.reason}` };
    }
    const reply = await answer(asker, i);
    const first = reply.text.split("\n")[0] ?? "";
    return { ...reply, line: `${whatOf(i)} by ${asker.person.by} (${asker.user}) in ${asker.project}: ${first}` };
  };

  return { handle };
}
