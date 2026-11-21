// folder — one CLI call in a folder, its stdin closed at once, that a stop can end with everything it started. The
// agent seam runs its CLI through it; lint-edit.ts runs a project's linter through it.
//
// A call with a stop runs in its own process group, so the stop reaches the whole tree. Such a group is outside this
// process's foreground group, so on exit, SIGINT or SIGTERM this process kills every live group first. A program that
// cannot start answers 127, as a shell does, so a caller can tell it from a failure.

import { execFile, spawn } from "node:child_process";
import { signalGroup, stopGroupOn, type Exit } from "../forge/api.js";

export type FolderCall = {
  readonly bin: string;
  readonly args: readonly string[];
  readonly env: NodeJS.ProcessEnv;
  readonly cwd?: string;
  readonly stop?: AbortSignal;
};
export type FolderRunner = (call: FolderCall) => Promise<Exit>;

export const CANNOT_START = 127;

function exitCode(error: { readonly code?: unknown } | null): number {
  if (error === null) {
    return 0;
  }
  return typeof error.code === "number" ? error.code : typeof error.code === "string" ? CANNOT_START : 1;
}

function startFailure(error: { readonly code?: unknown } | null, bin: string): string {
  return error !== null && typeof error.code === "string" ? `cannot start ${bin}: ${error.code}\n` : "";
}

const MAX_BUFFER = 64 * 1024 * 1024;

function cwdOf(call: FolderCall): { readonly cwd?: string } {
  return call.cwd === undefined ? {} : { cwd: call.cwd };
}

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

function grouped(call: FolderCall, stop: AbortSignal): Promise<Exit> {
  const child = spawn(call.bin, [...call.args], { env: call.env, ...cwdOf(call), detached: true });
  const closed = new Promise<void>((end) => child.once("close", () => end()));
  const group = stopGroupOn(child.pid, stop, closed);
  const done = new Promise<Exit>((resolve) => {
    const kept = { stdout: "", stderr: "" };
    let over = false;
    let failed = "";
    const keep = (name: "stdout" | "stderr") => (chunk: string) => {
      if (over) {
        return;
      }
      kept[name] = (kept[name] + chunk).slice(0, MAX_BUFFER + 1);
      if (kept[name].length > MAX_BUFFER) {
        over = true;
        failed += signalGroup(child.pid, "SIGKILL");
      }
    };
    child.stdout?.setEncoding("utf8").on("data", keep("stdout"));
    child.stderr?.setEncoding("utf8").on("data", keep("stderr"));
    child.on("error", (error: NodeJS.ErrnoException) =>
      resolve({ code: exitCode(error), stdout: "", stderr: startFailure(error, call.bin) }),
    );
    child.on("close", (code) => {
      const failures = failed + group.failures();
      resolve(
        over
          ? { ...kept, code: 1, stderr: `${call.bin}: output over the cap\n${failures}` }
          : { code: code ?? 1, stdout: kept.stdout, stderr: kept.stderr + failures },
      );
    });
  });
  child.stdin?.on("error", () => undefined);
  child.stdin?.end();
  held(child.pid, done);
  return done;
}

const live = new Set<number>();

export function endLive(): void {
  const failures = [...live].map((pid) => signalGroup(pid, "SIGKILL")).join("");
  if (failures !== "") {
    process.stderr.write(failures);
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

function release(pid: number): void {
  live.delete(pid);
  if (live.size === 0) {
    unwatch();
  }
}

export const runInFolder: FolderRunner = (call) =>
  call.stop === undefined ? unstoppable(call) : grouped(call, call.stop);

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
