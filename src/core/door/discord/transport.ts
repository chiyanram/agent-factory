// door/discord/transport — the Discord door's one way out (ADR-0023 D4): a socket to the Gateway and one REST call at
// a time, over Node's own WebSocket and fetch, so the door adds no dependency. The bot only connects out, and opens no
// port. Tests pass a fake, so no test reaches Discord. A failure names the route and the status, never the URL, since
// an interaction's path holds its token.

import { prop } from "../../field.js";

export type SocketEvents = {
  readonly message: (text: string) => void;
  // 1006 when the connection closed abnormally, with no close frame
  // https://www.rfc-editor.org/rfc/rfc6455#section-7.4.1
  readonly closed: (code: number) => void;
};

export type Socket = {
  readonly send: (text: string) => void;
  readonly close: (code: number) => void;
};

export type Attached = { readonly name: string; readonly text: string };

export type RestCall = {
  readonly method: "GET" | "POST" | "PUT" | "PATCH";
  readonly path: string;
  readonly route: string;
  readonly json?: unknown;
  readonly files?: readonly Attached[];
};

export type RestAnswer =
  | { readonly kind: "ok"; readonly value: unknown }
  | { readonly kind: "failed"; readonly reason: string; readonly status?: number };

export type Transport = {
  readonly connect: (url: string, on: SocketEvents) => Socket;
  readonly rest: (call: RestCall) => Promise<RestAnswer>;
};

export type Timers = {
  readonly every: (ms: number, run: () => void) => () => void;
  readonly after: (ms: number, run: () => void) => () => void;
};

export const REAL_TIMERS: Timers = {
  every: (ms, run) => {
    const id = setInterval(run, ms);
    return () => clearInterval(id);
  },
  after: (ms, run) => {
    const id = setTimeout(run, ms);
    return () => clearTimeout(id);
  },
};

const API = "https://discord.com/api/v10";
const TRIES = 3;

// Discord takes files as multipart/form-data, with the JSON in payload_json
// https://docs.discord.com/developers/reference
function bodyOf(call: RestCall): { readonly body?: string | FormData; readonly type?: string } {
  if (call.files === undefined || call.files.length === 0) {
    return call.json === undefined ? {} : { body: JSON.stringify(call.json), type: "application/json" };
  }
  const form = new FormData();
  form.append("payload_json", JSON.stringify(call.json ?? {}));
  call.files.forEach((file, i) => {
    form.append(`files[${i}]`, new Blob([file.text], { type: "text/markdown" }), file.name);
  });
  return { body: form };
}

// a 429 answer carries retry_after, the seconds to wait
// https://docs.discord.com/developers/topics/rate-limits
async function waitAsked(response: Response): Promise<number> {
  const asked: unknown = await response.json().catch(() => undefined);
  const seconds = prop(asked, "retry_after");
  return typeof seconds === "number" && seconds > 0 ? Math.min(seconds, 30) : 1;
}

async function once(token: string, agent: string, call: RestCall): Promise<Response> {
  const { body, type } = bodyOf(call);
  return fetch(`${API}${call.path}`, {
    method: call.method,
    headers: {
      Authorization: `Bot ${token}`,
      "User-Agent": agent,
      ...(type === undefined ? {} : { "Content-Type": type }),
    },
    ...(body === undefined ? {} : { body }),
  });
}

async function answerOf(response: Response, route: string): Promise<RestAnswer> {
  if (!response.ok) {
    return { kind: "failed", reason: `${route}: Discord answered HTTP ${response.status}`, status: response.status };
  }
  return response.status === 204 ? { kind: "ok", value: {} } : { kind: "ok", value: await response.json() };
}

async function tried(token: string, agent: string, call: RestCall, left: number): Promise<RestAnswer> {
  const response = await once(token, agent, call);
  if (response.status !== 429 || left <= 1) {
    return answerOf(response, call.route);
  }
  const seconds = await waitAsked(response);
  await new Promise((done) => setTimeout(done, seconds * 1000));
  return tried(token, agent, call, left - 1);
}

function whyFailed(error: unknown): string {
  const code = prop(prop(error, "cause"), "code");
  return typeof code === "string" ? code : "the call failed";
}

async function rest(token: string, agent: string, call: RestCall): Promise<RestAnswer> {
  try {
    return await tried(token, agent, call, TRIES);
  } catch (error: unknown) {
    return { kind: "failed", reason: `${call.route}: ${whyFailed(error)}` };
  }
}

function connect(url: string, on: SocketEvents): Socket {
  const ws = new WebSocket(url);
  ws.addEventListener("message", (event) => on.message(typeof event.data === "string" ? event.data : ""));
  ws.addEventListener("close", (event) => on.closed(event.code));
  return {
    send: (text) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(text);
      }
    },
    close: (code) => ws.close(code),
  };
}

// Discord asks for a User-Agent of the form DiscordBot ($url, $versionNumber)
// https://docs.discord.com/developers/reference
export function realTransport(token: string, version: string): Transport {
  const agent = `DiscordBot (agent-factory, ${version})`;
  return { connect, rest: (call) => rest(token, agent, call) };
}
