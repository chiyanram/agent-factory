// started-first — a folder runner for a test whose stub must reach a point before a time limit stops it. The limit
// still fires on time, and the run is still stopped through runInFolder's own path; only the stop waits until the
// stub is ready, so a slow machine cannot stop a stub before it has run the lines the test is about.

import { existsSync, readFileSync } from "node:fs";
import { runInFolder, type FolderRunner } from "../src/core/agent/folder.js";

async function until(ready: () => boolean): Promise<void> {
  while (!ready()) {
    await new Promise((r) => setTimeout(r, 20));
  }
}

export function stopWhen(ready: () => boolean): FolderRunner {
  return (call) => {
    const held = new AbortController();
    const pass = (): void => void until(ready).then(() => held.abort());
    if (call.stop?.aborted === true) {
      pass();
    } else {
      call.stop?.addEventListener("abort", pass, { once: true });
    }
    return runInFolder({ ...call, stop: held.signal });
  };
}

export function stopOnceStarted(file: string): FolderRunner {
  return stopWhen(() => existsSync(file));
}

function ended(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
}

export function stopOnceExited(pidFile: string): FolderRunner {
  return stopWhen(() => existsSync(pidFile) && ended(Number(readFileSync(pidFile, "utf8").trim())));
}
