// live — one run per change, and at most FACTORY_MAX_RUNS on this machine (GUIDE, Triggers). A run is live while
// `claude agents --json` lists its session (a writer: writer-<n>) or its pid file in <repo>/.claude/runs/ names a
// process that is still there (scripts/lib/runs.sh reads the same files). The reviewer writes reviewer-<n>.pid while
// it runs, so start-writer and reconcile see it, and removes it after, only when the file is still its own.

import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Result } from "../forge/api.js";
import { codeOf, prop } from "../dispatch/records.js";
import { attempt } from "./safe.js";

export type Sessions = () => Promise<Result<readonly string[]>>;

export type Held = { readonly release: () => Promise<void> };

const RUN = /^(writer|reviewer)-\d+$/;

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return codeOf(error) === "EPERM";
  }
}

// pidRuns : the runs whose pid file names a live process
async function pidRuns(dir: string): Promise<readonly string[]> {
  const names = await readdir(dir).catch(() => [] as string[]);
  const live: string[] = [];
  for (const name of names.filter((n) => n.endsWith(".pid"))) {
    const pid = Number((await readFile(join(dir, name), "utf8").catch(() => "")).trim());
    if (Number.isSafeInteger(pid) && pid > 0 && alive(pid)) {
      live.push(name.slice(0, -".pid".length));
    }
  }
  return live;
}

// sessionNames : the names in `claude agents --json`, or why it did not print a list
export function sessionNames(stdout: string): Result<readonly string[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    parsed = undefined;
  }
  if (!Array.isArray(parsed)) {
    return { kind: "failed", reason: "cannot list live runs: claude agents --json did not print a list" };
  }
  const names = parsed.map((s: unknown) => prop(s, "name")).filter((n): n is string => typeof n === "string");
  return { kind: "ok", value: names };
}

// claudeSessions : the live background sessions, through the claude CLI
export function claudeSessions(input: { readonly bin: string; readonly env: NodeJS.ProcessEnv }): Sessions {
  return () =>
    new Promise((resolve) => {
      execFile(input.bin, ["agents", "--json"], { env: input.env, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
        resolve(
          error === null
            ? sessionNames(stdout)
            : { kind: "failed", reason: "cannot list live runs: claude agents --json failed" },
        );
      });
    });
}

function refusal(runs: readonly string[], number: number, maxRuns: number): string {
  const mine = runs.find((r) => r === `writer-${number}` || r === `reviewer-${number}`);
  if (mine !== undefined) {
    return `this change already has a live run: ${mine}`;
  }
  return runs.length >= maxRuns
    ? `this machine is at its run limit: ${runs.length} live runs (FACTORY_MAX_RUNS=${maxRuns})`
    : "";
}

// liveRuns : the names of this machine's live runs (writer-<n>, reviewer-<n>); fails when claude cannot say, so a
// caller never mistakes "unknown" for "none" and releases a claim a run still holds
export async function liveRuns(input: {
  readonly repo: string;
  readonly sessions: Sessions;
}): Promise<Result<readonly string[]>> {
  const listed = await input.sessions();
  if (listed.kind === "failed") {
    return listed;
  }
  const pids = await pidRuns(join(input.repo, ".claude", "runs"));
  return { kind: "ok", value: [...new Set([...listed.value, ...pids])].filter((r) => RUN.test(r)) };
}

// holdRun : the reviewer's run on change `number`, or why it may not start now
export async function holdRun(input: {
  readonly repo: string;
  readonly number: number;
  readonly sessions: Sessions;
  readonly maxRuns: number;
}): Promise<Result<Held>> {
  const live = await liveRuns(input);
  if (live.kind === "failed") {
    return live;
  }
  const dir = join(input.repo, ".claude", "runs");
  const runs = live.value;
  const refused = refusal(runs, input.number, input.maxRuns);
  if (refused !== "") {
    return { kind: "failed", reason: refused };
  }
  const file = join(dir, `reviewer-${input.number}.pid`);
  const mine = String(process.pid);
  // the file left by a run that died goes first; "wx" then refuses a reviewer that started since the check
  const written = await attempt(async () => {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await rm(file, { force: true });
    await writeFile(file, mine, { mode: 0o600, flag: "wx" });
  }, `cannot write ${file}: another reviewer may have started on this change`);
  const release = async (): Promise<void> => {
    if ((await readFile(file, "utf8").catch(() => "")) === mine) {
      await rm(file, { force: true }).catch(() => undefined);
    }
  };
  return written.kind === "ok" ? { kind: "ok", value: { release } } : written;
}
