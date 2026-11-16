// folder — one CLI call in a folder, its stdin closed at once, that a stop can end with everything it started. The
// agent seam runs its CLI through it; lint-edit.ts runs a project's linter through it.

import { execFile, spawn } from "node:child_process";
import type { Exit } from "../forge/api.js";

export type FolderCall = {
  readonly bin: string;
  readonly args: readonly string[];
  readonly env: NodeJS.ProcessEnv;
  // the folder it starts in: claude's file tools are held to it; unset: this process's own
  readonly cwd?: string;
  // ends the call: the program and every process it started get SIGTERM, then SIGKILL after a grace. A call with a
  // stop runs in its own process group, so the stop reaches the whole tree, as forge/api.ts and box/srt.ts do
  readonly stop?: AbortSignal;
};
export type FolderRunner = (call: FolderCall) => Promise<Exit>;

// a program that cannot start (ENOENT, EACCES) answers 127, as a shell does, so a caller can tell it from a failure
export const CANNOT_START = 127;

// how long a stopped call's processes get after SIGTERM before SIGKILL
export const KILL_GRACE_MS = 10_000;

function exitCode(error: { readonly code?: unknown } | null): number {
  if (error === null) {
    return 0;
  }
  return typeof error.code === "number" ? error.code : typeof error.code === "string" ? CANNOT_START : 1;
}

function startFailure(error: { readonly code?: unknown } | null, bin: string): string {
  return error !== null && typeof error.code === "string" ? `cannot start ${bin}: ${error.code}\n` : "";
}

// signalGroup : a signal to the process group led by pid; nothing when there is none left
function signalGroup(pid: number | undefined, signal: NodeJS.Signals): void {
  if (pid === undefined) {
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch {
    // the group is gone already
  }
}

// stoppable : the call's stop, wired to the child's process group: SIGTERM, then SIGKILL after the grace
function stoppable(pid: number | undefined, stop: AbortSignal, done: Promise<unknown>): void {
  const end = (): void => {
    signalGroup(pid, "SIGTERM");
    setTimeout(() => signalGroup(pid, "SIGKILL"), KILL_GRACE_MS).unref();
  };
  if (stop.aborted) {
    end();
    return;
  }
  stop.addEventListener("abort", end, { once: true });
  void done.then(() => stop.removeEventListener("abort", end));
}

const MAX_BUFFER = 64 * 1024 * 1024;

function cwdOf(call: FolderCall): { readonly cwd?: string } {
  return call.cwd === undefined ? {} : { cwd: call.cwd };
}

// unstoppable : the call over execFile, in this process's group
function unstoppable(call: FolderCall): Promise<Exit> {
  return new Promise((resolve) => {
    const child = execFile(
      call.bin,
      [...call.args],
      { env: call.env, maxBuffer: MAX_BUFFER, ...cwdOf(call) },
      (error, stdout, stderr) => {
        resolve({ code: exitCode(error), stdout, stderr: startFailure(error, call.bin) || stderr });
      },
    );
    child.stdin?.end();
  });
}

// grouped : the call over spawn, in its own process group (execFile cannot start one), its output kept up to the cap,
// past which it is stopped as execFile would stop it
function grouped(call: FolderCall, stop: AbortSignal): Promise<Exit> {
  const child = spawn(call.bin, [...call.args], { env: call.env, ...cwdOf(call), detached: true });
  const done = new Promise<Exit>((resolve) => {
    const kept = { stdout: "", stderr: "" };
    let over = false;
    const keep = (name: "stdout" | "stderr") => (chunk: string) => {
      if (over) {
        return;
      }
      kept[name] = (kept[name] + chunk).slice(0, MAX_BUFFER + 1);
      if (kept[name].length > MAX_BUFFER) {
        over = true;
        signalGroup(child.pid, "SIGKILL");
      }
    };
    child.stdout?.setEncoding("utf8").on("data", keep("stdout"));
    child.stderr?.setEncoding("utf8").on("data", keep("stderr"));
    // a program that cannot start: 'close' may follow, and the first answer stands
    child.on("error", (error: NodeJS.ErrnoException) =>
      resolve({ code: exitCode(error), stdout: "", stderr: startFailure(error, call.bin) }),
    );
    child.on("close", (code) =>
      resolve(over ? { ...kept, code: 1, stderr: `${call.bin}: output over the cap` } : { ...kept, code: code ?? 1 }),
    );
  });
  child.stdin?.on("error", () => undefined);
  child.stdin?.end();
  stoppable(child.pid, stop, done);
  held(child.pid, done);
  return done;
}

// The groups started here and not yet ended. A group is no longer in this process's foreground group, so a Ctrl-C or
// a SIGTERM to this process would leave it running with no one keeping its time: while any is live, this process
// ends them first, on exit and on SIGINT or SIGTERM, then lets the signal do what it would have done.
const live = new Set<number>();

// endLive : SIGKILL to every live group
export function endLive(): void {
  for (const pid of live) {
    signalGroup(pid, "SIGKILL");
  }
}

function onSignal(signal: NodeJS.Signals): void {
  endLive();
  unwatch();
  process.kill(process.pid, signal);
}

const onInt = (): void => onSignal("SIGINT");
const onTerm = (): void => onSignal("SIGTERM");

function watch(): void {
  process.on("exit", endLive);
  process.on("SIGINT", onInt);
  process.on("SIGTERM", onTerm);
}

function unwatch(): void {
  process.off("exit", endLive);
  process.off("SIGINT", onInt);
  process.off("SIGTERM", onTerm);
}

// held : the group counted live until its call ends
function held(pid: number | undefined, done: Promise<unknown>): void {
  if (pid === undefined) {
    return;
  }
  if (live.size === 0) {
    watch();
  }
  live.add(pid);
  void done.then(() => release(pid));
}

// release : the group no longer counted live; with none left, this process stops watching
function release(pid: number): void {
  live.delete(pid);
  if (live.size === 0) {
    unwatch();
  }
}

// runInFolder : one call, its stdin closed at once: the CLI waits 3 s for input on an open stdin
export const runInFolder: FolderRunner = (call) =>
  call.stop === undefined ? unstoppable(call) : grouped(call, call.stop);

// timed : the call, stopped when it outlives `ms`; late says the limit stopped it
export async function timed(
  run: FolderRunner,
  call: FolderCall,
  ms: number,
): Promise<{ readonly exit: Exit; readonly late: boolean }> {
  const stop = new AbortController();
  let late = false;
  const timer = setTimeout(() => {
    late = true;
    stop.abort();
  }, ms);
  const exit = await run({ ...call, stop: stop.signal });
  clearTimeout(timer);
  return { exit, late };
}
