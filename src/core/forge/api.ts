// api — one HTTP request to a forge through its own CLI: `gh api` or `glab api` (ADR-0010, ADR-0013). The CLI holds the
// login, so the package never reads a token. Every request runs with --include, so the status and the headers are read
// from the answer itself, never guessed from the exit code.
//
// A short rate limit is waited out and tried again, up to FACTORY_MAX_TRIES calls (default 4), because single calls ran
// into 429 (docs/archive/research/46 G8). A rate limit is, whatever the status (#71, #62):
//   - a 429, on either forge
//   - a GitHub 403 with Retry-After or with x-ratelimit-remaining: 0
//   - an answer whose message names a rate limit or GitHub's abuse detection: a secondary limit, the per-minute GraphQL
//     points among them, can come with no header at all
//   - a GraphQL answer with an error of type RATE_LIMITED or code graphql_rate_limit, or whose message names a rate
//     limit ("API rate limit already exceeded for user ID …" came as a 200 with neither, #62)
// The wait is Retry-After, else the time until x-ratelimit-reset when no requests are left, else a minute, doubled on
// each limit in a row. A wait past MAX_WAIT is not waited: the call ends at once, and so does the last try. Either way
// the reason says "rate limited until <time>" (rateLimitedUntil), so the orchestrator loop waits for that time instead
// of asking again (#62). Any other status fails at once and names it. Nothing here throws: every outcome is a sealed
// result. The reason may come back through a forge plugin, so rateLimitedUntil reads the time from its words.
//
// A request body goes in on stdin, so no value is ever read as a CLI field. A call with a stop runs in its own process
// group, so the stop reaches every process the CLI started.

import { execFile, spawn } from "node:child_process";
import { codeOf } from "../field.js";

export type Failed = { readonly kind: "failed"; readonly reason: string };
export type Result<T> = { readonly kind: "ok"; readonly value: T } | Failed;
export type Done = { readonly kind: "ok" } | Failed;

export type Call = {
  readonly bin: string;
  readonly args: readonly string[];
  readonly stdin: string;
  readonly env: NodeJS.ProcessEnv;
  readonly watch?: (chunk: string) => void;
  readonly keep?: Keep;
  readonly cwd?: string;
  readonly stop?: AbortSignal;
};
export type Keep = "all" | "tail";
export type Exit = { readonly code: number; readonly stdout: string; readonly stderr: string };
export type Runner = (call: Call) => Promise<Exit>;
export type Sleeper = (seconds: number) => Promise<void>;

export type Client = {
  readonly name: string;
  readonly bin: string;
  readonly env: NodeJS.ProcessEnv;
  readonly run: Runner;
  readonly sleep: Sleeper;
  readonly maxTries: number;
  readonly now: () => number;
};

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type Body = { readonly kind: "json"; readonly value: unknown } | { readonly kind: "none" };
export type RestRequest = { readonly path: string; readonly method: Method; readonly body: Body };
// gh api sends -f as a string and -F as a typed value, and reads every field but query as a GraphQL variable.
// https://cli.github.com/manual/gh_api
export type Variable =
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "int"; readonly value: number };
export type GraphqlRequest = { readonly query: string; readonly variables: Readonly<Record<string, Variable>> };

export type Answer = { readonly status: number; readonly headers: ReadonlyMap<string, string>; readonly body: string };

export type Limits = { readonly maxBuffer: number; readonly tailChars: number };
export const LIMITS: Limits = { maxBuffer: 64 * 1024 * 1024, tailChars: 64 * 1024 };

type Child = ReturnType<typeof spawn>;

function optionsOf(call: Call): { readonly env: NodeJS.ProcessEnv; readonly cwd?: string; readonly detached?: true } {
  return {
    env: call.env,
    ...(call.cwd === undefined ? {} : { cwd: call.cwd }),
    ...(call.stop === undefined ? {} : { detached: true }),
  };
}

export const KILL_GRACE_MS = 10_000;

export function signalGroup(pid: number | undefined, signal: NodeJS.Signals): string {
  if (pid === undefined) {
    return "";
  }
  try {
    process.kill(-pid, signal);
    return "";
  } catch (error: unknown) {
    return codeOf(error) === "ESRCH" ? "" : `cannot send ${signal} to process group ${pid}: ${String(error)}\n`;
  }
}

export type GroupStop = { readonly failures: () => string };

export function stopGroupOn(pid: number | undefined, stop: AbortSignal, done: Promise<unknown>): GroupStop {
  let failed = "";
  const signalled = (signal: NodeJS.Signals): void => {
    failed += signalGroup(pid, signal);
  };
  const end = (): void => {
    signalled("SIGTERM");
    setTimeout(() => signalled("SIGKILL"), KILL_GRACE_MS).unref();
  };
  if (stop.aborted) {
    end();
  } else {
    stop.addEventListener("abort", end, { once: true });
    void done.then(() => stop.removeEventListener("abort", end));
  }
  return { failures: () => failed };
}

function fed(child: Child, call: Call): void {
  const { watch } = call;
  if (watch !== undefined) {
    child.stdout?.on("data", (chunk: unknown) => watch(String(chunk)));
  }
  child.stdin?.on("error", () => undefined);
  child.stdin?.end(call.stdin);
}

function keptAll(call: Call, limits: Limits): Promise<Exit> {
  return new Promise((resolve) => {
    const child = execFile(
      call.bin,
      [...call.args],
      { ...optionsOf(call), maxBuffer: limits.maxBuffer },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof error.code === "number" ? error.code : 1;
        resolve({ code, stdout, stderr: stderr.length > 0 || error === null ? stderr : error.message });
      },
    );
    fed(child, call);
  });
}

function closedExit(
  code: number | null,
  kept: { readonly stdout: string; readonly stderr: string },
  over: boolean,
  failures: string,
): Exit {
  return over
    ? { ...kept, code: 1, stderr: `stdout maxBuffer length exceeded\n${failures}` }
    : { code: code ?? 1, stdout: kept.stdout, stderr: kept.stderr + failures };
}

const NO_STOP: GroupStop = { failures: () => "" };

function groupOf(child: Child, call: Call): GroupStop {
  if (call.stop === undefined) {
    return NO_STOP;
  }
  const closed = new Promise<void>((done) => child.once("close", () => done()));
  return stopGroupOn(child.pid, call.stop, closed);
}

function spawned(call: Call, limits: Limits, keepAll: boolean): Promise<Exit> {
  return new Promise((resolve) => {
    const child = spawn(call.bin, [...call.args], optionsOf(call));
    const kept = { stdout: "", stderr: "" };
    let over = false;
    let failed = "";
    const group = groupOf(child, call);
    const keep = (name: "stdout" | "stderr") => (chunk: unknown) => {
      const text = kept[name] + String(chunk);
      if (!keepAll) {
        kept[name] = text.slice(-limits.tailChars);
        return;
      }
      kept[name] = text.slice(0, limits.maxBuffer);
      if (text.length > limits.maxBuffer) {
        over = true;
        failed += signalGroup(child.pid, "SIGKILL");
        child.kill("SIGKILL");
      }
    };
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", keep("stdout"));
    child.stderr?.on("data", keep("stderr"));
    child.on("error", (error) => resolve({ code: 1, stdout: kept.stdout, stderr: error.message }));
    child.on("close", (code) => resolve(closedExit(code, kept, over, failed + group.failures())));
    fed(child, call);
  });
}

export function processRunner(limits: Limits = LIMITS): Runner {
  return (call) =>
    call.keep === "tail" || call.stop !== undefined
      ? spawned(call, limits, call.keep !== "tail")
      : keptAll(call, limits);
}

export const runProcess: Runner = processRunner();

export const realSleep: Sleeper = (seconds) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));

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

// GitHub names a secondary rate limit in its error message, and may send no rate-limit header with it.
// https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
const LIMIT_WORDS = /rate limit|abuse detection/i;

function limitedBody(body: string): boolean {
  return LIMIT_WORDS.test(body);
}

export function limited(answer: Answer): boolean {
  return answer.status === 429 || graphqlLimited(answer) || (answer.status === 403 && limited403(answer));
}

function limited403(answer: Answer): boolean {
  const h = answer.headers;
  return h.has("retry-after") || h.get("x-ratelimit-remaining") === "0" || limitedBody(answer.body);
}

export const MAX_WAIT = 300;

// With no Retry-After and requests left, GitHub asks for a wait of at least a minute, then an exponentially longer one.
// https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
const FIRST_WAIT = 60;

export function waitSeconds(headers: ReadonlyMap<string, string>, now: number, tries = 1): number {
  const asked = askedWait(headers, now);
  return asked === "none" ? FIRST_WAIT * 2 ** (Math.max(tries, 1) - 1) : asked;
}

function askedWait(headers: ReadonlyMap<string, string>, now: number): number | "none" {
  const after = Number.parseInt(headers.get("retry-after") ?? "", 10);
  if (after >= 0) {
    return after;
  }
  const reset = Number.parseInt(headers.get("x-ratelimit-reset") ?? "", 10);
  return headers.get("x-ratelimit-remaining") === "0" && Number.isFinite(reset) ? Math.max(reset - now, 1) : "none";
}

type GraphqlError = { readonly type?: unknown; readonly code?: unknown; readonly message?: unknown };

function objectOf(body: string): Readonly<Record<string, unknown>> {
  const parsed = parseJson(body);
  return parsed.kind === "ok" && typeof parsed.value === "object" && parsed.value !== null
    ? (parsed.value as Readonly<Record<string, unknown>>)
    : {};
}

function errorsOf(body: string): readonly GraphqlError[] {
  const { errors } = objectOf(body);
  return Array.isArray(errors) ? errors.filter((e): e is GraphqlError => typeof e === "object" && e !== null) : [];
}

function graphqlLimited(answer: Answer): boolean {
  return errorsOf(answer.body).some(
    (e) =>
      e.type === "RATE_LIMITED" ||
      (typeof e.code === "string" && /rate_limit/i.test(e.code)) ||
      (typeof e.message === "string" && LIMIT_WORDS.test(e.message)),
  );
}

function saidOf(answer: Answer): string {
  const message = errorsOf(answer.body)[0]?.message ?? objectOf(answer.body).message;
  return (typeof message === "string" ? message : answer.body).slice(0, 200);
}

const UNTIL = "rate limited until";

function isoSeconds(seconds: number): string {
  return new Date(seconds * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function rateLimitedUntil(reason: string): number | "none" {
  const found = /rate limited until (\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ)/.exec(reason);
  const at = found === null ? Number.NaN : Date.parse(found[1] ?? "");
  return Number.isFinite(at) ? at : "none";
}

function limitReason(client: Client, args: readonly string[], answer: Answer, tries: number, until: number): string {
  const said = saidOf(answer);
  const times = tries === 1 ? "1 try" : `${tries} tries`;
  return `${client.name}: ${UNTIL} ${isoSeconds(until)}: HTTP ${answer.status} after ${times} on ${args[0] ?? ""}${said === "" ? "" : `: ${said}`}`;
}

type Attempt =
  | { readonly kind: "answer"; readonly answer: Answer }
  | { readonly kind: "retry"; readonly answer: Answer }
  | Failed;

function outcome(client: Client, args: readonly string[], answer: Answer): Attempt {
  if (limited(answer)) {
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

async function send(client: Client, args: readonly string[], stdin: string): Promise<Result<Answer>> {
  for (let tries = 1; ; tries++) {
    const result = await attempt(client, args, stdin);
    if (result.kind !== "retry") {
      return result.kind === "answer" ? { kind: "ok", value: result.answer } : result;
    }
    const wait = waitSeconds(result.answer.headers, client.now(), tries);
    if (lastTry(client, tries, wait)) {
      return { kind: "failed", reason: limitReason(client, args, result.answer, tries, client.now() + wait) };
    }
    await client.sleep(wait);
  }
}

function lastTry(client: Client, tries: number, wait: number): boolean {
  return tries >= client.maxTries || wait > MAX_WAIT;
}

export async function restText(client: Client, path: string): Promise<Result<string>> {
  const sent = await send(client, [path, "-X", "GET"], "");
  return sent.kind === "ok" ? { kind: "ok", value: sent.value.body } : sent;
}

export async function rest(client: Client, request: RestRequest): Promise<Result<unknown>> {
  const input = request.body.kind === "json" ? ["--input", "-"] : [];
  const stdin = request.body.kind === "json" ? JSON.stringify(request.body.value) : "";
  const sent = await send(client, [request.path, "-X", request.method, ...input], stdin);
  return sent.kind === "ok" ? parseJson(sent.value.body) : sent;
}

function field(name: string, variable: Variable): readonly string[] {
  return variable.kind === "text" ? ["-f", `${name}=${variable.value}`] : ["-F", `${name}=${variable.value}`];
}

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
