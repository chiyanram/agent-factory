// lock — one process at a time on a path: the pass and the loop for a project, and a plugin write for a ticket. The
// taker writes its own file holding pid:uuid, then links it to the lock path, which fails when the path exists. A lock
// whose holder is dead, or an unreadable one older than ten minutes, is taken over only under a second lock,
// <path>.takeover, taken the same way: the taker checks again under it that the holder is dead, removes the lock and
// links its own, so of two takers that find one stale lock only one holds it. A takeover lock that a crash left is
// removed by the same dead-holder check. Release removes the lock only while it still holds the releaser's token, so a
// holder never removes a lock someone took over from it.

import { randomUUID } from "node:crypto";
import { link, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { codeOf } from "./field.js";

export type Holder =
  | { readonly kind: "alive"; readonly pid: number }
  | { readonly kind: "dead" }
  | { readonly kind: "unknown" };

export type HeldLock = { readonly kind: "held"; readonly release: () => Promise<void> };

export type Taken =
  | HeldLock
  | { readonly kind: "busy"; readonly holder: Holder }
  | { readonly kind: "failed"; readonly reason: string };

const STALE_UNREADABLE_MS = 10 * 60_000;

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return codeOf(error) === "EPERM";
  }
}

export async function holder(path: string, now: number): Promise<Holder> {
  const text = await readFile(path, "utf8").catch(() => "");
  const pid = Number(text.split(":")[0]);
  if (Number.isSafeInteger(pid) && pid > 0) {
    return alive(pid) ? { kind: "alive", pid } : { kind: "dead" };
  }
  const age = await stat(path).then(
    (st) => now - st.mtimeMs,
    () => 0,
  );
  return age > STALE_UNREADABLE_MS ? { kind: "dead" } : { kind: "unknown" };
}

async function linked(mine: string, path: string): Promise<boolean> {
  return link(mine, path).then(
    () => true,
    () => false,
  );
}

async function takeOver(path: string, mine: string): Promise<boolean> {
  const takeover = `${path}.takeover`;
  if (!(await linked(mine, takeover))) {
    if ((await holder(takeover, Date.now())).kind === "dead") {
      await rm(takeover, { force: true });
    }
    return false;
  }
  try {
    if ((await holder(path, Date.now())).kind !== "dead") {
      return false;
    }
    await rm(path, { force: true });
    return await linked(mine, path);
  } finally {
    await rm(takeover, { force: true });
  }
}

async function take(path: string, mine: string): Promise<boolean> {
  if (await linked(mine, path)) {
    return true;
  }
  return (await holder(path, Date.now())).kind === "dead" ? takeOver(path, mine) : false;
}

export async function takeLock(path: string): Promise<Taken> {
  const token = `${process.pid}:${randomUUID()}`;
  const mine = `${path}.${randomUUID()}`;
  try {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(mine, token, { mode: 0o600, flag: "wx" });
    const held = await take(path, mine);
    await rm(mine, { force: true });
    if (!held) {
      return { kind: "busy", holder: await holder(path, Date.now()) };
    }
    const release = async (): Promise<void> => {
      const now = await readFile(path, "utf8").catch(() => "");
      if (now === token) {
        await rm(path, { force: true });
      }
    };
    return { kind: "held", release };
  } catch (error: unknown) {
    await rm(mine, { force: true });
    return { kind: "failed", reason: `cannot take ${path}: ${codeOf(error) || String(error)}` };
  }
}
