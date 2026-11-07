// A fake gh or glab for the forge tests: each call gets the next scripted answer, and every call is recorded, so no
// test needs the network or a login.

import type { Call, Client, Runner } from "../src/core/forge/api.js";

export type Scripted = { readonly status: number; readonly body: unknown; readonly headers?: Readonly<Record<string, string>> } | { readonly raw: Exit };
type Exit = { readonly code: number; readonly stdout: string; readonly stderr: string };

export type Fake = { readonly calls: Call[]; readonly slept: number[]; readonly client: Client };

function answer(s: Scripted): Exit {
  if ("raw" in s) {
    return s.raw;
  }
  const headers = Object.entries(s.headers ?? {}).map(([k, v]) => `${k}: ${v}\r\n`).join("");
  const body = typeof s.body === "string" ? s.body : JSON.stringify(s.body);
  return { code: s.status >= 400 ? 1 : 0, stdout: `HTTP/2.0 ${s.status} X\r\n${headers}\r\n${body}`, stderr: "" };
}

export function fake(name: "github" | "gitlab", script: readonly Scripted[], maxTries = 4): Fake {
  const calls: Call[] = [];
  const slept: number[] = [];
  const run: Runner = async (call) => {
    calls.push(call);
    const next = script[calls.length - 1];
    return next === undefined ? { code: 3, stdout: "", stderr: `fake: no answer for call ${calls.length}: ${call.args.join(" ")}` } : answer(next);
  };
  const client: Client = {
    name,
    bin: name === "github" ? "gh" : "glab",
    env: {},
    run,
    sleep: async (s) => {
      slept.push(s);
    },
    maxTries,
    now: () => 1_000_000,
  };
  return { calls, slept, client };
}

// the value of a -f or -F field in one recorded GraphQL call
export function field(call: Call | undefined, name: string): string {
  const args = call?.args ?? [];
  const found = args.find((a, i) => (args[i - 1] === "-f" || args[i - 1] === "-F") && a.startsWith(`${name}=`));
  return found === undefined ? "" : found.slice(name.length + 1);
}

export function ok(body: unknown): Scripted {
  return { status: 200, body };
}
