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
// result.

import { execFile, spawn } from "node:child_process";

export type Failed = { readonly kind: "failed"; readonly reason: string };
export type Result<T> = { readonly kind: "ok"; readonly value: T } | Failed;
export type Done = { readonly kind: "ok" } | Failed;

export type Call = {
  readonly bin: string;
  readonly args: readonly string[];
  readonly stdin: string;
  readonly env: NodeJS.ProcessEnv;
  // each piece of stdout as it comes, before the call ends (#228)
  readonly watch?: (chunk: string) => void;
  // "all" (the default): the Exit holds all of stdout, and a call that prints past the cap is stopped. "tail": the Exit
  // holds only stdout's and stderr's ends, and no cap applies, for a long run whose output only a watcher reads (#228)
  readonly keep?: Keep;
  // the folder the program starts in; unset: this process's own (#114: the srt runner starts in the run's clone)
  readonly cwd?: string;
  // aborts the call: the program and every process it started get SIGTERM, then SIGKILL after a grace. A call with a
  // stop runs in its own process group, so the stop reaches the whole tree (#114)
  readonly stop?: AbortSignal;
};
export type Keep = "all" | "tail";
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

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type Body = { readonly kind: "json"; readonly value: unknown } | { readonly kind: "none" };
export type RestRequest = { readonly path: string; readonly method: Method; readonly body: Body };
// GraphQL variables go in as -f (text) or -F (whole numbers) fields, never into the query text.
export type Variable =
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "int"; readonly value: number };
export type GraphqlRequest = { readonly query: string; readonly variables: Readonly<Record<string, Variable>> };

export type Answer = { readonly status: number; readonly headers: ReadonlyMap<string, string>; readonly body: string };

// the most output a call keeps: all of it up to the cap, or only its end
export type Limits = { readonly maxBuffer: number; readonly tailChars: number };
export const LIMITS: Limits = { maxBuffer: 64 * 1024 * 1024, tailChars: 64 * 1024 };

type Child = ReturnType<typeof spawn>;

// how long a stopped call's processes get after SIGTERM before SIGKILL
const KILL_GRACE_MS = 10_000;

// optionsOf : the child's environment, its folder when the call names one, and its own process group when the call
// can be stopped. Pure.
function optionsOf(call: Call): { readonly env: NodeJS.ProcessEnv; readonly cwd?: string; readonly detached?: true } {
  return {
    env: call.env,
    ...(call.cwd === undefined ? {} : { cwd: call.cwd }),
    ...(call.stop === undefined ? {} : { detached: true }),
  };
}

// signalGroup : a signal to the child's whole process group; false when there is none left
function signalGroup(child: Child, signal: NodeJS.Signals): boolean {
  if (child.pid === undefined) {
    return false;
  }
  try {
    return process.kill(-child.pid, signal);
  } catch {
    return false;
  }
}

// stoppable : the call's stop, wired to the child's process group: SIGTERM, then SIGKILL after the grace
function stoppable(child: Child, call: Call): void {
  const { stop } = call;
  if (stop === undefined) {
    return;
  }
  const end = (): void => {
    signalGroup(child, "SIGTERM");
    setTimeout(() => signalGroup(child, "SIGKILL"), KILL_GRACE_MS).unref();
  };
  if (stop.aborted) {
    end();
    return;
  }
  stop.addEventListener("abort", end, { once: true });
  child.once("close", () => stop.removeEventListener("abort", end));
}

// fed : the child's input given, and its stdout handed to the watcher as it comes
function fed(child: Child, call: Call): void {
  const { watch } = call;
  if (watch !== undefined) {
    child.stdout?.on("data", (chunk: unknown) => watch(String(chunk)));
  }
  // a CLI that exits without reading its input closes the pipe; its exit already says what happened
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

// spawned : the call over spawn, which can run it in its own process group (execFile cannot): each output's end only
// ("tail"), or all of it up to the cap ("all"), past which the call is stopped as execFile would stop it
function spawned(call: Call, limits: Limits, keepAll: boolean): Promise<Exit> {
  return new Promise((resolve) => {
    const child = spawn(call.bin, [...call.args], optionsOf(call));
    const kept = { stdout: "", stderr: "" };
    // past the cap the call fails, even when it ended before the kill reached it, as execFile's maxBuffer does
    let over = false;
    const keep = (name: "stdout" | "stderr") => (chunk: unknown) => {
      const text = kept[name] + String(chunk);
      if (!keepAll) {
        kept[name] = text.slice(-limits.tailChars);
        return;
      }
      kept[name] = text.slice(0, limits.maxBuffer);
      if (text.length > limits.maxBuffer) {
        over = true;
        signalGroup(child, "SIGKILL");
        child.kill("SIGKILL");
      }
    };
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", keep("stdout"));
    child.stderr?.on("data", keep("stderr"));
    // a program that cannot start: 'close' may follow, and the first answer stands
    child.on("error", (error) => resolve({ code: 1, stdout: kept.stdout, stderr: error.message }));
    child.on("close", (code) =>
      resolve(over ? { ...kept, code: 1, stderr: "stdout maxBuffer length exceeded" } : { code: code ?? 1, ...kept }),
    );
    fed(child, call);
    stoppable(child, call);
  });
}

// processRunner : a Runner over real processes, within these limits; a test passes smaller ones. A call that can be
// stopped runs over spawn, in its own process group.
export function processRunner(limits: Limits = LIMITS): Runner {
  return (call) =>
    call.keep === "tail" || call.stop !== undefined
      ? spawned(call, limits, call.keep !== "tail")
      : keptAll(call, limits);
}

export const runProcess: Runner = processRunner();

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

// a rate limit's words: GitHub's primary and secondary limits, the per-minute GraphQL points, and its older abuse
// detection; GitLab's "Retry later" comes as a 429
const LIMIT_WORDS = /rate limit|abuse detection/i;

function limitedBody(body: string): boolean {
  return LIMIT_WORDS.test(body);
}

// limited : whether this REST or GraphQL answer is a rate limit (see the header).
export function limited(answer: Answer): boolean {
  return answer.status === 429 || graphqlLimited(answer) || (answer.status === 403 && limited403(answer));
}

// limited403 : a GitHub 403 that is a rate limit: one that asks for a wait, has no requests left, or names a limit
function limited403(answer: Answer): boolean {
  const h = answer.headers;
  return h.has("retry-after") || h.get("x-ratelimit-remaining") === "0" || limitedBody(answer.body);
}

// The longest one wait may be: a call that would wait longer ends at once and names the reset time.
export const MAX_WAIT = 300;

// the first wait of a limit that names no time; doubled on each limit in a row, as GitHub asks for a secondary limit
const FIRST_WAIT = 60;

// waitSeconds : Retry-After wins; else, when no requests are left, the time until x-ratelimit-reset; else a minute for
// the first limit in a row, doubled for each after it (GitHub sends x-ratelimit-reset on every answer, and a secondary
// limit asks for at least a minute). Not capped: send ends the call when this is past MAX_WAIT. Pure.
export function waitSeconds(headers: ReadonlyMap<string, string>, now: number, tries = 1): number {
  const asked = askedWait(headers, now);
  return asked === "none" ? FIRST_WAIT * 2 ** (Math.max(tries, 1) - 1) : asked;
}

// askedWait : the wait the answer's headers ask for: its Retry-After, else the time to the reset when no requests are
// left; "none" when they ask for none. Pure.
function askedWait(headers: ReadonlyMap<string, string>, now: number): number | "none" {
  const after = Number.parseInt(headers.get("retry-after") ?? "", 10);
  if (after >= 0) {
    return after;
  }
  const reset = Number.parseInt(headers.get("x-ratelimit-reset") ?? "", 10);
  return headers.get("x-ratelimit-remaining") === "0" && Number.isFinite(reset) ? Math.max(reset - now, 1) : "none";
}

type GraphqlError = { readonly type?: unknown; readonly code?: unknown; readonly message?: unknown };

// objectOf : the answer's body as a JSON object; {} for any other body. Pure.
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

// graphqlLimited : an answer whose GraphQL errors say a rate limit: by type, by code, or in their message.
function graphqlLimited(answer: Answer): boolean {
  return errorsOf(answer.body).some(
    (e) =>
      e.type === "RATE_LIMITED" ||
      (typeof e.code === "string" && /rate_limit/i.test(e.code)) ||
      (typeof e.message === "string" && LIMIT_WORDS.test(e.message)),
  );
}

// what a rate limit said, for its reason: the GraphQL error's message, else the REST message, else the body's start
function saidOf(answer: Answer): string {
  const message = errorsOf(answer.body)[0]?.message ?? objectOf(answer.body).message;
  return (typeof message === "string" ? message : answer.body).slice(0, 200);
}

// the words a rate-limited reason carries before its time, which rateLimitedUntil reads back
const UNTIL = "rate limited until";

// isoSeconds : a time in seconds since the epoch, in ISO 8601 UTC to the second. Pure.
function isoSeconds(seconds: number): string {
  return new Date(seconds * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

// rateLimitedUntil : the time, in milliseconds since the epoch, that a failure's reason says a rate limit lasts until;
// "none" for any other failure. The reason may come back through a forge plugin, so it is read from the words. Pure.
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

// send : one request, tried again while the forge answers with a rate limit whose wait is short; a long wait, or the
// last try, ends it with the time the limit lasts until, so nothing asks again before then (#62).
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

// lastTry : whether a rate-limited call ends here: its tries are used up, or its wait is too long to wait. Pure.
function lastTry(client: Client, tries: number, wait: number): boolean {
  return tries >= client.maxTries || wait > MAX_WAIT;
}

// restText : one GET whose answer is plain text, such as a CI job's log; a redirect is followed by the CLI.
export async function restText(client: Client, path: string): Promise<Result<string>> {
  const sent = await send(client, [path, "-X", "GET"], "");
  return sent.kind === "ok" ? { kind: "ok", value: sent.value.body } : sent;
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
