// door/discord/gateway — the Discord door's connection (#731): the Gateway's HELLO, heartbeat and IDENTIFY, with the
// Guilds intent only, so no message text ever reaches the door; its dispatch table takes READY (register the guild's
// slash commands) and INTERACTION_CREATE (answer one), and drops every other event, MESSAGE_CREATE included. Every
// answer is deferred, ephemeral, then edited in place, so a slow spec read never misses Discord's three seconds. Every
// log line and every reply leaves through the scrub, with the door's own token cut out literally as well. A refused
// token or intent ends the door; any other close, or a failed look-up of the Gateway, reconnects with a fresh
// IDENTIFY after a backoff. A throw in any of it is logged and answered, never left to end the process.

import { field } from "../../human-record.js";
import { SCRUBBED, scrubSecrets } from "../../scrub.js";
import type { Reply } from "./door.js";
import type { RestAnswer, RestCall, Socket, Timers, Transport } from "./transport.js";

// GUILDS (1 << 0) alone: no GUILD_MESSAGES, no DIRECT_MESSAGES, no MESSAGE_CONTENT
export const INTENTS = 1;

const EPHEMERAL = 64;
// interaction callback types: a deferred ephemeral answer to a command, and a deferred update of a button's message
const DEFER_ANSWER = 5;
const DEFER_UPDATE = 6;
// close codes after which a reconnect cannot help: a refused token, sharding, the API version, the intents
const FATAL: ReadonlySet<number> = new Set([4004, 4010, 4011, 4012, 4013, 4014]);
// the interaction types the door answers: a slash command and a button
const ANSWERED: ReadonlySet<unknown> = new Set([2, 3]);
const RECONNECT_MS = 5000;
// Discord's limit on a message's text
const MAX_TEXT = 2000;
const SNOWFLAKE = /^\d{17,20}$/;
const INTERACTION_TOKEN = /^[\w.-]{1,500}$/;

export const COMMANDS = [
  {
    name: "start",
    description: "START a ticket, as agent-factory start does at the terminal",
    type: 1,
    options: [{ type: 3, name: "ticket", description: "the ticket", required: true }],
  },
  {
    name: "approve",
    description: "See a ticket's spec and design with their hashes, then Confirm to approve exactly those",
    type: 1,
    options: [{ type: 3, name: "ticket", description: "the ticket", required: true }],
  },
  { name: "board", description: "The project's board, read only", type: 1 },
] as const;

export type GatewaySetup = {
  readonly transport: Transport;
  readonly token: string;
  readonly guild: string;
  readonly handle: (raw: unknown) => Promise<Reply>;
  // a log line, already scrubbed
  readonly log: (line: string) => void;
  readonly timers: Timers;
};

export type Gateway = {
  // a refused token or intent: the reason the door stopped
  readonly ended: Promise<{ readonly kind: "failed"; readonly reason: string }>;
  // every answer under way, finished
  readonly drain: () => Promise<void>;
  readonly stop: () => Promise<void>;
};

// scrubberOf : the scrub, with this token cut out whatever its shape. Pure.
export function scrubberOf(token: string): (text: string) => string {
  return (text) => scrubSecrets(text).split(token).join(SCRUBBED);
}

// textMatching : the value when it is a string the pattern matches, else undefined. Pure.
function textMatching(value: unknown, pattern: RegExp): string | undefined {
  return typeof value === "string" && pattern.test(value) ? value : undefined;
}

// where an interaction's answers go: its id and token, the application's id, and whether it is a button
type Route = { readonly id: string; readonly token: string; readonly app: string; readonly button: boolean };

// routeOf : the route of a slash command or a button, checked before any of it becomes part of a path. Pure.
function routeOf(raw: unknown): Route | undefined {
  const id = textMatching(field(raw, "id"), SNOWFLAKE);
  const app = textMatching(field(raw, "application_id"), SNOWFLAKE);
  const token = textMatching(field(raw, "token"), INTERACTION_TOKEN);
  const type = field(raw, "type");
  return id !== undefined && app !== undefined && token !== undefined && ANSWERED.has(type)
    ? { id, token, app, button: type === 3 }
    : undefined;
}

// frameOf : one Gateway frame, or undefined when it is not JSON. Pure.
function frameOf(text: string): unknown {
  try {
    const frame: unknown = JSON.parse(text);
    return frame;
  } catch {
    return undefined;
  }
}

// gatewayUrl : the wss:// address /gateway/bot answered, or undefined. Pure.
function gatewayUrl(found: RestAnswer): string | undefined {
  const url = found.kind === "ok" ? field(found.value, "url") : undefined;
  return typeof url === "string" && url.startsWith("wss://") ? url : undefined;
}

// intervalOf : HELLO's heartbeat interval, or Discord's usual one. Pure.
function intervalOf(d: unknown): number {
  const every = field(d, "heartbeat_interval");
  return typeof every === "number" && every > 0 ? every : 41250;
}

// payloadOf : the reply as Discord's message edit: its text cut to the limit, and the Confirm button or none. Pure.
function payloadOf(reply: Reply, scrub: (text: string) => string): Pick<RestCall, "json" | "files"> {
  const text = scrub(reply.text);
  const content = text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text;
  const button = { type: 2, style: 3, label: "Confirm", custom_id: reply.confirm };
  const components = reply.confirm === undefined ? [] : [{ type: 1, components: [button] }];
  const files = reply.files.map((f) => ({ name: f.name, text: scrub(f.text) }));
  return {
    json: {
      content,
      flags: EPHEMERAL,
      components,
      attachments: files.map((f, id) => ({ id, filename: f.name })),
      allowed_mentions: { parse: [] },
    },
    ...(files.length === 0 ? {} : { files }),
  };
}

type Session = {
  seq: number | null;
  acked: boolean;
  stopBeat: () => void;
  // cancels a reconnect that is waiting its turn
  stopRetry: () => void;
  socket: Socket | undefined;
};

// oneLine : the text with every control character written out, so no input can start a forged log line. Pure.
export function oneLine(text: string): string {
  const control = (c: string): boolean => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f;
  return Array.from(text, (c) => (control(c) ? JSON.stringify(c).slice(1, -1) : c)).join("");
}

// failure : what a throw says, for the log; the log line is scrubbed. Pure.
function failure(error: unknown): string {
  return error instanceof Error ? error.message : "an unknown error";
}

// the answer when the door itself fails on an interaction: the person is told, and the door keeps running
function broken(error: unknown): Reply {
  return {
    text: "refused: the door could not answer; nothing was written, try again",
    files: [],
    line: `the door could not answer: ${failure(error)}`,
  };
}

export function openGateway(setup: GatewaySetup): Gateway {
  const scrub = scrubberOf(setup.token);
  const log = (line: string): void => setup.log(oneLine(scrub(`door discord: ${line}`)));
  const busy = new Set<Promise<void>>();
  const session: Session = {
    seq: null,
    acked: true,
    stopBeat: () => undefined,
    stopRetry: () => undefined,
    socket: undefined,
  };
  let stopped = false;
  type Ended = { readonly kind: "failed"; readonly reason: string };
  let end: (result: Ended) => void = () => undefined;
  const ended = new Promise<Ended>((done) => {
    end = done;
  });

  const call = async (c: RestCall): Promise<RestAnswer> => {
    const answer = await setup.transport.rest(c);
    if (answer.kind === "failed") {
      log(`${c.route} failed: ${answer.reason}`);
    }
    return answer;
  };

  // track : work under way, kept for drain; a throw in it is logged, never left to end the process
  const track = (started: Promise<void>): void => {
    const work = started.catch((error: unknown) => log(`failed: ${failure(error)}`));
    busy.add(work);
    void work.finally(() => busy.delete(work));
  };

  const send = (op: number, d: unknown): void => session.socket?.send(JSON.stringify({ op, d }));

  const register = async (d: unknown): Promise<void> => {
    const app = textMatching(field(field(d, "application"), "id"), SNOWFLAKE);
    if (app === undefined) {
      log("READY carried no application id; the slash commands were not registered");
      return;
    }
    const path = `/applications/${app}/guilds/${setup.guild}/commands`;
    const done = await call({ method: "PUT", path, route: "register the slash commands", json: COMMANDS });
    if (done.kind === "ok") {
      log(`ready: /start, /approve and /board registered in guild ${setup.guild}`);
    }
  };

  const answer = async (raw: unknown): Promise<void> => {
    const route = routeOf(raw);
    if (route === undefined) {
      return;
    }
    const deferred = await call({
      method: "POST",
      path: `/interactions/${route.id}/${route.token}/callback`,
      route: "answer the interaction",
      json: { type: route.button ? DEFER_UPDATE : DEFER_ANSWER, data: { flags: EPHEMERAL } },
    });
    const reply = await setup.handle(raw).catch(broken);
    log(reply.line);
    if (deferred.kind === "ok") {
      const path = `/webhooks/${route.app}/${route.token}/messages/@original`;
      await call({ method: "PATCH", path, route: "edit the answer", ...payloadOf(reply, scrub) });
    }
  };

  // DISPATCH : the only events the door acts on
  const DISPATCH: Readonly<Record<string, (d: unknown) => Promise<void>>> = {
    READY: register,
    INTERACTION_CREATE: answer,
  };

  const beat = (): void => {
    if (!session.acked) {
      log("no heartbeat ack: reconnecting");
      session.socket?.close(4000);
      return;
    }
    session.acked = false;
    send(1, session.seq);
  };

  const hello = (d: unknown): void => {
    session.stopBeat();
    session.acked = true;
    session.stopBeat = setup.timers.every(intervalOf(d), beat);
    send(2, {
      token: setup.token,
      intents: INTENTS,
      properties: { os: process.platform, browser: "agent-factory", device: "agent-factory" },
    });
  };

  // dispatched : an event in the table, run and tracked; any other event is dropped
  const dispatched = (t: unknown, d: unknown): void => {
    const run = typeof t === "string" && Object.hasOwn(DISPATCH, t) ? DISPATCH[t] : undefined;
    if (run !== undefined) {
      track(run(d));
    }
  };

  // OPS : what each Gateway opcode does: a dispatch, a heartbeat asked for, a reconnect asked for, an invalid
  // session, HELLO, and a heartbeat's ack
  const OPS: Readonly<Record<number, (frame: unknown) => void>> = {
    0: (frame) => dispatched(field(frame, "t"), field(frame, "d")),
    1: () => send(1, session.seq),
    7: () => session.socket?.close(4000),
    9: () => session.socket?.close(4000),
    10: (frame) => hello(field(frame, "d")),
    11: () => {
      session.acked = true;
    },
  };

  const message = (text: string): void => {
    const frame = frameOf(text);
    const seq = field(frame, "s");
    if (typeof seq === "number") {
      session.seq = seq;
    }
    const op = field(frame, "op");
    const run = typeof op === "number" && Object.hasOwn(OPS, op) ? OPS[op] : undefined;
    run?.(frame);
  };

  // retry : connect again after the backoff, unless the door has stopped
  const retry = (): void => {
    if (!stopped) {
      session.stopRetry = setup.timers.after(RECONNECT_MS, () => track(connect()));
    }
  };

  // connect : find the Gateway and open a socket to it; only a refused token ends the door, and any other failure,
  // a network blip or a 5xx, is tried again
  const connect = async (): Promise<void> => {
    const found = await call({ method: "GET", path: "/gateway/bot", route: "find the gateway" });
    if (found.kind === "failed" && found.status === 401) {
      end({
        kind: "failed",
        reason: "Discord refused the token: store it again with agent-factory setup door-discord",
      });
      return;
    }
    const url = gatewayUrl(found);
    if (url === undefined || stopped) {
      retry();
      return;
    }
    session.seq = null;
    session.socket = setup.transport.connect(`${url}/?v=10&encoding=json`, { message, closed });
  };

  function closed(code: number): void {
    session.stopBeat();
    session.socket = undefined;
    if (stopped) {
      return;
    }
    if (FATAL.has(code)) {
      end({ kind: "failed", reason: `Discord closed the gateway with ${code}: a refused token or intent` });
      return;
    }
    log(`the gateway closed (${code}); reconnecting`);
    retry();
  }

  const halt = (): void => {
    stopped = true;
    session.stopBeat();
    session.stopRetry();
  };
  void ended.then(halt);
  track(connect());

  const drain = async (): Promise<void> => {
    while (busy.size > 0) {
      await Promise.all(busy);
    }
  };

  return {
    ended,
    drain,
    stop: async () => {
      halt();
      session.socket?.close(1000);
      await drain();
    },
  };
}
