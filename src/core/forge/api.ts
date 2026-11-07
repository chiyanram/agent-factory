// api — one HTTP request to a forge through its own CLI: `gh api` or `glab api` (ADR-0010, ADR-0013). The CLI holds the
// login, so the package never reads a token. Every request runs with --include, so the status and the headers are read
// from the answer itself, never guessed from the exit code.
//
// A rate limit is waited out and tried again, up to FACTORY_MAX_TRIES calls (default 4), because single calls ran into
// 429 (docs/archive/research/46 G8). A rate limit is:
//   - a 429, on either forge
//   - a GitHub 403 with Retry-After, with x-ratelimit-remaining: 0, or whose message names a rate limit (a secondary
//     limit can come with no header at all, #71)
//   - a GraphQL answer of 200 with an error of type RATE_LIMITED (#71)
// The wait is Retry-After, else the time until x-ratelimit-reset when no requests are left, else 60 seconds, and never
// more than 5 minutes. Any other status fails at once and
// names it. Nothing here throws: every outcome is a sealed result.

import { execFile } from "node:child_process";

export type Failed = { readonly kind: "failed"; readonly reason: string };
export type Result<T> = { readonly kind: "ok"; readonly value: T } | Failed;
export type Done = { readonly kind: "ok" } | Failed;

export type Call = {
  readonly bin: string;
  readonly args: readonly string[];
  readonly stdin: string;
  readonly env: NodeJS.ProcessEnv;
};
export type Exit = { readonly code: number; readonly stdout: string; readonly stderr: string };
// Runs one CLI call. The real one is runProcess; a test passes its own.
export type Runner = (call: Call) => Promise<Exit>;
export type Sleeper = (seconds: number) => Promise<void>;

export type Client = {
  // the name every message starts with: github or gitlab
  readonly name: string;
  readonly bin: string;
  readonly env: NodeJS.ProcessEnv;
  readonly run: Runner;
  readonly sleep: Sleeper;
  readonly maxTries: number;
  // seconds since the epoch
  readonly now: () => number;
};

export type Method = "GET" | "POST" | "PUT" | "DELETE";
export type Body = { readonly kind: "json"; readonly value: unknown } | { readonly kind: "none" };
export type RestRequest = { readonly path: string; readonly method: Method; readonly body: Body };
// GraphQL variables go in as -f (text) or -F (whole numbers) fields, never into the query text.
export type Variable =
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "int"; readonly value: number };
export type GraphqlRequest = { readonly query: string; readonly variables: Readonly<Record<string, Variable>> };

export type Answer = { readonly status: number; readonly headers: ReadonlyMap<string, string>; readonly body: string };

export const runProcess: Runner = (call) =>
  new Promise((resolve) => {
    const child = execFile(
      call.bin,
      [...call.args],
      { env: call.env, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof error.code === "number" ? error.code : 1;
        resolve({ code, stdout, stderr: stderr.length > 0 || error === null ? stderr : error.message });
      },
    );
    // a CLI that exits without reading its input closes the pipe; its exit already says what happened
    child.stdin?.on("error", () => undefined);
    child.stdin?.end(call.stdin);
  });

export const realSleep: Sleeper = (seconds) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));

// readAnswer : the status, headers and body of one --include answer.
export function readAnswer(stdout: string): Result<Answer> {
  const text = stdout.replace(/\r\n/g, "\n");
  const status = /^HTTP\/[\d.]+ (\d{3})/.exec(text);
  if (status === null) {
    return { kind: "failed", reason: "no HTTP status" };
  }
  const split = text.indexOf("\n\n");
  const head = split < 0 ? text : text.slice(0, split);
  const headers = new Map<string, string>();
  for (const line of head.split("\n").slice(1)) {
    const colon = line.indexOf(":");
    if (colon > 0) {
      headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
    }
  }
  return { kind: "ok", value: { status: Number(status[1]), headers, body: split < 0 ? "" : text.slice(split + 2) } };
}

// parseJson : the body as JSON; an empty body is the empty text.
export function parseJson(body: string): Result<unknown> {
  if (body.trim().length === 0) {
    return { kind: "ok", value: "" };
  }
  try {
    return { kind: "ok", value: JSON.parse(body) as unknown };
  } catch {
    return { kind: "failed", reason: `the answer is not JSON: ${body.slice(0, 200)}` };
  }
}

function limitedBody(body: string): boolean {
  return /rate limit/i.test(body);
}

// limited : whether this answer is a rate limit (see the header).
export function limited(answer: Answer): boolean {
  if (answer.status === 429) {
    return true;
  }
  const h = answer.headers;
  return (
    answer.status === 403 &&
    (h.has("retry-after") || h.get("x-ratelimit-remaining") === "0" || limitedBody(answer.body))
  );
}

// The longest one wait may be: a poll that waits longer is better failing loudly after its tries.
export const MAX_WAIT = 300;

// waitSeconds : Retry-After wins; else, when no requests are left, the time until x-ratelimit-reset; else 60 (GitHub
// sends x-ratelimit-reset on every answer, and a secondary limit asks for at least a minute). Never above MAX_WAIT.
export function waitSeconds(headers: ReadonlyMap<string, string>, now: number): number {
  const after = Number.parseInt(headers.get("retry-after") ?? "", 10);
  const reset = Number.parseInt(headers.get("x-ratelimit-reset") ?? "", 10);
  const empty = headers.get("x-ratelimit-remaining") === "0" && Number.isFinite(reset);
  const wait = Number.isFinite(after) && after >= 0 ? after : empty ? Math.max(reset - now, 1) : 60;
  return Math.min(wait, MAX_WAIT);
}

// graphqlLimited : a 200 whose errors say RATE_LIMITED.
function graphqlLimited(answer: Answer): boolean {
  const parsed = parseJson(answer.body);
  if (parsed.kind !== "ok" || typeof parsed.value !== "object" || parsed.value === null) {
    return false;
  }
  const errors = (parsed.value as { errors?: unknown }).errors;
  return (
    Array.isArray(errors) &&
    errors.some((e) => typeof e === "object" && e !== null && (e as { type?: unknown }).type === "RATE_LIMITED")
  );
}

type Attempt =
  | { readonly kind: "answer"; readonly answer: Answer }
  | { readonly kind: "retry"; readonly answer: Answer }
  | Failed;

function outcome(client: Client, args: readonly string[], answer: Answer): Attempt {
  if (limited(answer) || (answer.status === 200 && graphqlLimited(answer))) {
    return { kind: "retry", answer };
  }
  if (answer.status < 200 || answer.status > 299) {
    return {
      kind: "failed",
      reason: `${client.name}: HTTP ${answer.status} on ${args[0] ?? ""}: ${answer.body.slice(0, 200)}`,
    };
  }
  return { kind: "answer", answer };
}

async function attempt(client: Client, args: readonly string[], stdin: string): Promise<Attempt> {
  const exit = await client.run({ bin: client.bin, args: ["api", "--include", ...args], stdin, env: client.env });
  const read = readAnswer(exit.stdout);
  if (read.kind === "failed") {
    const said = (exit.stderr.split("\n")[0] ?? "").trim() || (exit.stdout.split("\n")[0] ?? "").trim();
    return { kind: "failed", reason: `${client.name}: no HTTP status from ${client.bin}: ${said}` };
  }
  return outcome(client, args, read.value);
}

// send : one request, retried while the forge answers with a rate limit.
async function send(client: Client, args: readonly string[], stdin: string): Promise<Result<Answer>> {
  for (let tries = 1; ; tries++) {
    const result = await attempt(client, args, stdin);
    if (result.kind !== "retry") {
      return result.kind === "answer" ? { kind: "ok", value: result.answer } : result;
    }
    if (tries >= client.maxTries) {
      return {
        kind: "failed",
        reason: `${client.name}: HTTP ${result.answer.status} after ${client.maxTries} tries, rate limited: ${args[0] ?? ""}`,
      };
    }
    await client.sleep(waitSeconds(result.answer.headers, client.now()));
  }
}

// rest : one REST request; the body goes in on stdin, so no value is ever read as a CLI field.
export async function rest(client: Client, request: RestRequest): Promise<Result<unknown>> {
  const input = request.body.kind === "json" ? ["--input", "-"] : [];
  const stdin = request.body.kind === "json" ? JSON.stringify(request.body.value) : "";
  const sent = await send(client, [request.path, "-X", request.method, ...input], stdin);
  return sent.kind === "ok" ? parseJson(sent.value.body) : sent;
}

function field(name: string, variable: Variable): readonly string[] {
  return variable.kind === "text" ? ["-f", `${name}=${variable.value}`] : ["-F", `${name}=${variable.value}`];
}

// graphql : the data of one GraphQL query, or the first error it names.
export async function graphql(client: Client, request: GraphqlRequest): Promise<Result<unknown>> {
  const fields = Object.entries(request.variables).flatMap(([name, variable]) => field(name, variable));
  const sent = await send(client, ["graphql", "-f", `query=${request.query}`, ...fields], "");
  if (sent.kind === "failed") {
    return sent;
  }
  const parsed = parseJson(sent.value.body);
  if (parsed.kind === "failed") {
    return parsed;
  }
  const answer = parsed.value as { data?: unknown; errors?: readonly { message?: unknown }[] };
  const problem = Array.isArray(answer.errors) ? answer.errors[0]?.message : undefined;
  if (problem !== undefined) {
    return { kind: "failed", reason: `${client.name}: GraphQL: ${String(problem)}` };
  }
  return { kind: "ok", value: answer.data };
}
