// fake-discord — the Discord door's transport in a test (#731): one socket at a time, every REST call recorded, and
// timers that run only when the test runs them, so no test reaches Discord or waits.

import type {
  RestAnswer,
  RestCall,
  Socket,
  SocketEvents,
  Timers,
  Transport,
} from "../src/core/door/discord/transport.js";

export class FakeDiscord implements Transport {
  readonly sockets: { readonly url: string; readonly on: SocketEvents; readonly sent: string[]; closed?: number }[] =
    [];
  readonly calls: RestCall[] = [];
  readonly ticks: (() => void)[] = [];
  fail: string | undefined;
  readonly gateway: RestAnswer[] = [];

  connect(url: string, on: SocketEvents): Socket {
    const socket: (typeof this.sockets)[number] = { url, on, sent: [] };
    this.sockets.push(socket);
    return {
      send: (text) => socket.sent.push(text),
      close: (code) => {
        socket.closed = code;
      },
    };
  }

  async rest(call: RestCall): Promise<RestAnswer> {
    this.calls.push(call);
    if (this.fail !== undefined && call.path.includes("/callback")) {
      return { kind: "failed", reason: this.fail };
    }
    if (call.path !== "/gateway/bot") {
      return { kind: "ok", value: {} };
    }
    return this.gateway.shift() ?? { kind: "ok", value: { url: "wss://gateway.example" } };
  }

  tick(): void {
    for (const run of this.ticks.splice(0)) {
      run();
    }
  }

  get socket() {
    const last = this.sockets.at(-1);
    if (last === undefined) {
      throw new Error("no socket");
    }
    return last;
  }

  hello(): void {
    this.socket.on.message(JSON.stringify({ op: 10, d: { heartbeat_interval: 41250 } }));
  }

  dispatch(t: string, d: unknown): void {
    this.socket.on.message(JSON.stringify({ op: 0, s: 1, t, d }));
  }
}

export const timersOf = (fake: FakeDiscord): Timers => ({
  every: (_ms, fn) => {
    fake.ticks.push(fn);
    return () => undefined;
  },
  after: (_ms, fn) => {
    fake.ticks.push(fn);
    return () => undefined;
  },
});
