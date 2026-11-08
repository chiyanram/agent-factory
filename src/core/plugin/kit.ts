// kit — the contract test kit: `agent-factory plugin test <plugin>` (#134; ADR-0014). It runs the plugin as the core
// would and checks what any plugin must do, whatever it wraps:
//
//   handshake     describe prints one JSON object with a protocol this core speaks, known capabilities, declared writes
//   fixtures      each fixtures/<capability>/<case>.in.json ({op, input}) gives the result in <case>.out.json (kind and
//                 the fields it names)
//   bad input     a request that is not an object gives a failed, refused or unsupported result, never a crash
//   unknown op    an op it does not know gives unsupported (or refused or failed), never a crash
//   stdout        every answer that exits 0 is exactly one JSON object; logs go to stderr
//   env canary    each env name the plugin declares holds a canary, and no answer may print one back; a model login
//                 set in the parent never reaches it (the core's env allow-list)
//   no token out  no answer holds a token: ghp_, gho_, ghu_, ghs_, ghr_, github_pat_, glpat-, ATATT, xox?-, sk-ant-,
//                 or a JWT
//
// The caps and the timeout are the core's own (exec.ts), so every plugin has them. Write fidelity, the text sent to the
// CLI byte for byte, needs stub CLIs; it comes with the forge plugins (#134 PR C).

import { randomBytes } from "node:crypto";
import { readdir, readFile, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import { PROTOCOL, pluginEnv, readResult } from "./contract.js";
import { DEFAULT_LIMITS, runPlugin, type Ran } from "./exec.js";
import { inspect, type Entry, type Setup } from "./registry.js";

export type Check = { readonly name: string; readonly ok: boolean; readonly detail: string };

const TOKENS =
  /(ghp_|gho_|ghu_|ghs_|ghr_|github_pat_|glpat-|ATATT|xox[abeprs]-|sk-ant-)[A-Za-z0-9_-]{8,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./;
const SOFT = new Set(["failed", "refused", "unsupported"]);

type Answer = { readonly ran: Ran; readonly request: string };

function check(name: string, ok: boolean, detail: string): Check {
  return { name, ok, detail };
}

async function call(setup: Setup, entry: Entry, stdin: string): Promise<Answer> {
  const ran = await (setup.exec ?? runPlugin)({
    path: entry.path,
    args: ["call"],
    stdin,
    env: pluginEnv(setup.env, entry.env, setup.path),
    limits: setup.limits ?? DEFAULT_LIMITS,
  });
  return { ran, request: stdin };
}

function request(capability: string, op: string, input: unknown): string {
  return JSON.stringify({ protocol: PROTOCOL, capability, op, input });
}

function kindOf(answer: Answer): string {
  if (answer.ran.kind !== "exited" || answer.ran.code !== 0) {
    return `no answer (${answer.ran.kind === "exited" ? `exit ${answer.ran.code}` : answer.ran.kind})`;
  }
  const result = readResult(answer.ran.stdout);
  return result.kind === "ok" ? result.value.kind : `not one JSON object with a kind`;
}

// soft : a refusal the plugin gave, exiting 0, for every capability
function soft(name: string, answers: readonly Answer[]): Check {
  const kinds = answers.map(kindOf);
  const bad = kinds.find((k) => !SOFT.has(k));
  return check(name, bad === undefined, bad === undefined ? kinds.join(", ") : `got ${bad}`);
}

type Fixture = {
  readonly name: string;
  readonly capability: string;
  readonly input: string;
  readonly expected: string;
};

async function fixturesIn(dir: string): Promise<readonly Fixture[]> {
  const capabilities = await readdir(dir).catch(() => [] as string[]);
  const found: Fixture[] = [];
  for (const capability of capabilities.toSorted()) {
    const files = await readdir(join(dir, capability)).catch(() => [] as string[]);
    for (const file of files.filter((f) => f.endsWith(".in.json")).toSorted()) {
      const stem = file.slice(0, -".in.json".length);
      const input = await readFile(join(dir, capability, file), "utf8").catch(() => "");
      const expected = await readFile(join(dir, capability, `${stem}.out.json`), "utf8").catch(() => "");
      found.push({ name: `${capability}/${stem}`, capability, input, expected });
    }
  }
  return found;
}

function parsed(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function field(value: unknown, name: string): unknown {
  return typeof value === "object" && value !== null ? (Reflect.get(value, name) as unknown) : undefined;
}

// subset : every field the expected result names has the same JSON in the actual one
function subset(expected: unknown, actual: unknown): boolean {
  return typeof expected === "object" && expected !== null
    ? Object.entries(expected).every(([k, v]) => JSON.stringify(field(actual, k)) === JSON.stringify(v))
    : false;
}

function opOf(input: unknown): string {
  const op = field(input, "op");
  return typeof op === "string" ? op : "";
}

async function fixtureCheck(setup: Setup, entry: Entry, f: Fixture): Promise<{ check: Check; answer: Answer }> {
  const input = parsed(f.input);
  const answer = await call(setup, entry, request(f.capability, opOf(input), field(input, "input")));
  const actual = answer.ran.kind === "exited" ? parsed(answer.ran.stdout) : undefined;
  const ok = subset(parsed(f.expected), actual);
  return { check: check(`fixture ${f.name}`, ok, ok ? kindOf(answer) : `got ${kindOf(answer)}`), answer };
}

function hygiene(answers: readonly Answer[]): Check {
  const bad = answers.find(
    (a) => a.ran.kind === "exited" && a.ran.code === 0 && readResult(a.ran.stdout).kind === "failed",
  );
  return check(
    "stdout is one JSON object",
    bad === undefined,
    bad === undefined ? "every answer" : "an answer was not",
  );
}

function outputs(answers: readonly Answer[]): string {
  return answers.map((a) => (a.ran.kind === "exited" ? `${a.ran.stdout}\n${a.ran.stderr}` : "")).join("\n");
}

// canaried : the parent env with a canary in every name the plugin declares and in the model's logins
function canaried(base: Setup, names: readonly string[], canary: string): Setup {
  const marks = Object.fromEntries(
    [...names, "ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"].map((n) => [n, `${canary}-${n}`]),
  );
  return { ...base, env: { ...base.env, ...marks } };
}

function undeclared(fixtures: readonly Fixture[], caps: readonly string[]): Check {
  const stray = fixtures.find((f) => !caps.includes(f.capability));
  return check(
    "fixtures name declared capabilities",
    stray === undefined,
    stray === undefined ? `${fixtures.length} fixture(s)` : `fixtures/${stray.capability} is not declared`,
  );
}

function leakedIn(setup: Setup, text: string): boolean {
  return Object.values(setup.env).some((v) => typeof v === "string" && v.startsWith("canary-") && text.includes(v));
}

async function run(setup: Setup, entry: Entry, dir: string): Promise<readonly Check[]> {
  const caps: readonly string[] = entry.capabilities.map((c) => c.name);
  const fixtures = await fixturesIn(join(dir, "fixtures"));
  const bad = await Promise.all(caps.map((c) => call(setup, entry, `not json ${c}`)));
  const unknown = await Promise.all(caps.map((c) => call(setup, entry, request(c, "no-such-op-for-the-kit", {}))));
  const ran = await Promise.all(
    fixtures.filter((f) => caps.includes(f.capability)).map((f) => fixtureCheck(setup, entry, f)),
  );
  const answers = [...bad, ...unknown, ...ran.map((f) => f.answer)];
  const text = outputs(answers);
  const leaked = leakedIn(setup, text);
  return [
    check(
      "handshake",
      true,
      `${entry.name} ${entry.version}, protocol ${entry.protocol}: ${caps.join(", ")}; writes ${entry.writes.join(", ") || "none"}`,
    ),
    undeclared(fixtures, caps),
    ...ran.map((f) => f.check),
    soft("bad input", bad),
    soft("unknown op", unknown),
    hygiene(answers),
    check("env canary", !leaked, leaked ? "an answer printed a canary it was given" : "no canary printed"),
    check("no token out", !TOKENS.test(text), TOKENS.test(text) ? "an answer holds a token" : "none"),
  ];
}

// testPlugin : every check, in order; the handshake failing stops the rest. Fixtures sit next to the real file.
export async function testPlugin(base: Setup, path: string): Promise<readonly Check[]> {
  const first = await inspect(base, path);
  if (first.kind === "failed") {
    return [check("handshake", false, first.reason)];
  }
  const canary = `canary-${randomBytes(12).toString("hex")}`;
  const setup = canaried(base, first.value.env, canary);
  const dir = dirname(await realpath(first.value.source).catch(() => first.value.source));
  return run(setup, first.value, dir);
}
