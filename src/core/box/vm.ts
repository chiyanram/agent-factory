// vm — the vm box (#113): a Box over the docker CLI on the VM, one container per run, under Sysbox. vm-plan.ts decides
// every argument and reads every answer; this file only runs docker and keeps the boxes it started. Nothing here
// throws.
//
// A box this Box did not start, or has stopped, gets no docker call: a run or a copy is refused, and a stop has nothing
// to do. So a stale session never runs a command in, or removes, someone else's container.

import { randomUUID } from "node:crypto";
import type { Exit, Runner } from "../forge/api.js";
import type { Box, BoxSpec, Copy, Done, Probe, Ran, Session, Started } from "./types.js";
import {
  checkSpec,
  execArgs,
  imageArgs,
  insideWorktree,
  readProbe,
  readRan,
  readRemoved,
  runArgs,
  RUNTIMES_ARGS,
  setupArgs,
  WORKDIR,
  type Owner,
} from "./vm-plan.js";

export type Docker = { readonly run: Runner; readonly bin: string; readonly env: NodeJS.ProcessEnv };

export type VmBoxSetup = {
  readonly docker: Docker;
  // the image the probe looks for; each start runs BoxSpec.image
  readonly image: string;
  readonly owner: Owner;
  // a new container name; a test passes its own
  readonly newName?: () => string;
  // milliseconds; a test passes its own
  readonly now?: () => number;
};

type Failed = { readonly kind: "failed"; readonly reason: string };

export function vmBox(setup: VmBoxSetup): Box {
  const { docker, owner } = setup;
  const newName = setup.newName ?? (() => `factory-box-${randomUUID()}`);
  const now = setup.now ?? Date.now;
  // the boxes this Box started and has not stopped, with the variables each run sees
  const live = new Map<string, BoxSpec>();

  const call = (args: readonly string[], env: NodeJS.ProcessEnv = docker.env, stdin = ""): Promise<Exit> =>
    docker.run({ bin: docker.bin, args, stdin, env });

  const step = async (args: readonly string[]): Promise<Done> => {
    const exit = await call(args);
    return exit.code === 0
      ? { kind: "ok" }
      : { kind: "failed", reason: `docker ${args.slice(0, 2).join(" ")}: ${exit.stderr.trim()}` };
  };

  const remove = async (name: string): Promise<Done> => {
    live.delete(name);
    const removed = readRemoved(await call(["rm", "--force", "--volumes", name]));
    return removed.kind === "ok" ? removed : { kind: "failed", reason: removed.reason };
  };

  // the steps after `docker run`; the first that fails removes the box
  const prepare = async (name: string): Promise<Done> => {
    for (const args of setupArgs(name, owner)) {
      const done = await step(args);
      if (done.kind === "failed") {
        await remove(name);
        return done;
      }
    }
    return { kind: "ok" };
  };

  const unknown = (session: Session): Failed => ({
    kind: "failed",
    reason: `box ${session.id} is not running in this vm box`,
  });

  const copy = async (c: Copy, args: (inBox: string) => readonly string[]): Promise<Done> => {
    if (!live.has(c.session.id)) {
      return unknown(c.session);
    }
    return insideWorktree(c.box)
      ? step(args(`${c.session.id}:${WORKDIR}/${c.box}`))
      : { kind: "failed", reason: `box path ${JSON.stringify(c.box)} is not inside the worktree` };
  };

  return {
    place: "vm",

    probe: async (): Promise<Probe> =>
      readProbe({
        owner,
        runtimes: await call(RUNTIMES_ARGS),
        image: await call(imageArgs(setup.image)),
        ref: setup.image,
      }),

    start: async (spec): Promise<Started> => {
      const checked = checkSpec(spec);
      if (checked.kind === "refused") {
        return { kind: "failed", reason: checked.reason };
      }
      const name = newName();
      const ran = await step(runArgs({ name, spec }));
      const ready = ran.kind === "ok" ? await prepare(name) : ran;
      if (ready.kind === "failed") {
        return ready;
      }
      live.set(name, spec);
      return { kind: "started", session: { id: name, place: "vm" } };
    },

    run: async ({ session, command }): Promise<Ran> => {
      const spec = live.get(session.id);
      if (spec === undefined) {
        return unknown(session);
      }
      const began = now();
      const exit = await call(
        execArgs({ name: session.id, command, envNames: Object.keys(spec.env) }),
        { ...docker.env, ...spec.env },
        command.stdin.kind === "text" ? command.stdin.text : "",
      );
      return readRan({ exit, timeoutSeconds: command.timeoutSeconds, elapsedSeconds: (now() - began) / 1000 });
    },

    copyIn: (c) => copy(c, (inBox) => ["cp", "--archive", c.host, inBox]),
    copyOut: (c) => copy(c, (inBox) => ["cp", inBox, c.host]),

    // a box this Box never started, or already stopped, is not its to remove
    stop: async (session): Promise<Done> => (live.has(session.id) ? remove(session.id) : { kind: "ok" }),
  };
}
