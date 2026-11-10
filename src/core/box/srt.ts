// srt — the srt runner (#114): a Box over Anthropic's sandbox runtime on this host, one srt process per command, one
// generated policy and one private HOME per started runner. srt-plan.ts decides the policy, the arguments and how each
// answer reads; this file writes the policy, runs srt and keeps the runners it started. Nothing here throws.
//
// A started runner is a folder of its own, outside the clone: policy.json (0600, which the run cannot write) and home/
// (0700, the run's HOME). stop removes it. A command that outlives its timeout, or a stop, gets SIGTERM and then
// SIGKILL, sent to srt's whole process group, so the sandboxed agent and everything it started go with it.

import { randomUUID } from "node:crypto";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Call, Exit, Runner } from "../forge/api.js";
import { attempt } from "../review/safe.js";
import {
  checkEnv,
  insideClone,
  readSrtProbe,
  srtArgs,
  srtEnv,
  srtPolicy,
  VERSION_ARGS,
  type SrtEgress,
  type SrtHost,
} from "./srt-plan.js";
import type { Box, BoxSpec, Command, Copy, Done, Probe, Ran, Session } from "./types.js";

export type SrtBoxSetup = {
  readonly run: Runner;
  // the srt binary, found on the host's PATH
  readonly bin: string;
  // the host's environment: only PATH and the locale reach a run (srt-plan.ts srtEnv)
  readonly env: NodeJS.ProcessEnv;
  readonly host: SrtHost;
  readonly egress: SrtEgress;
  // the variable the company CA goes in (settingName("egress.caCerts"))
  readonly caName: string;
  // a private folder (0700) each started runner's own folder goes in
  readonly runsDir: string;
  // a new runner name; a test passes its own
  readonly newName?: () => string;
};

type Failed = { readonly kind: "failed"; readonly reason: string };

// one started runner: its spec, its folder, the variables its commands see, and the stops of its running commands
type Live = {
  readonly spec: BoxSpec;
  readonly dir: string;
  readonly policy: string;
  readonly env: Readonly<Record<string, string>>;
  readonly running: Set<AbortController>;
};

type Output = Pick<Call, "watch" | "keep">;

function outputOf(command: Command): Output {
  return {
    ...(command.watch === undefined ? {} : { watch: command.watch }),
    ...(command.keep === undefined ? {} : { keep: command.keep }),
  };
}

// timed : the command's exit, or its timeout: at the time limit the stop fires, and the command is read as timed out
async function timed(exit: Promise<Exit>, stop: AbortController, seconds: number): Promise<Ran> {
  let late = false;
  const timer = setTimeout(() => {
    late = true;
    stop.abort();
  }, seconds * 1000);
  timer.unref();
  const ended = await exit;
  clearTimeout(timer);
  return late
    ? { kind: "timedOut", seconds }
    : { kind: "exited", code: ended.code, stdout: ended.stdout, stderr: ended.stderr };
}

export function srtBox(setup: SrtBoxSetup): Box {
  const newName = setup.newName ?? (() => `factory-srt-${randomUUID()}`);
  const live = new Map<string, Live>();

  const unknown = (session: Session): Failed => ({
    kind: "failed",
    reason: `runner ${session.id} is not running in this srt runner`,
  });

  // prepare : the runner's folder, its private HOME and its policy
  const prepare = async (name: string, spec: BoxSpec): Promise<Live | Failed> => {
    const dir = join(setup.runsDir, name);
    const home = join(dir, "home");
    const policy = join(dir, "policy.json");
    const text = `${JSON.stringify(
      srtPolicy({
        host: setup.host,
        egress: setup.egress,
        run: { worktree: spec.worktree, readOnly: spec.readOnly, home },
      }),
      null,
      2,
    )}\n`;
    const made = await attempt(async () => {
      await mkdir(home, { recursive: true, mode: 0o700 });
      await writeFile(policy, text, { mode: 0o600 });
    }, `cannot prepare the srt runner in ${dir}`);
    if (made.kind === "failed") {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      return made;
    }
    const env = srtEnv({
      host: setup.env,
      home,
      ca: { name: setup.caName, file: setup.egress.caCerts },
      spec: spec.env,
    });
    return { spec, dir, policy, env, running: new Set() };
  };

  const remove = async (name: string, runner: Live): Promise<Done> => {
    for (const stop of runner.running) {
      stop.abort();
    }
    live.delete(name);
    const removed = await attempt(
      () => rm(runner.dir, { recursive: true, force: true }),
      `cannot remove ${runner.dir}`,
    );
    return removed.kind === "ok" ? { kind: "ok" } : removed;
  };

  const copy = async (c: Copy, from: (inClone: string) => readonly [string, string]): Promise<Done> => {
    const runner = live.get(c.session.id);
    if (runner === undefined) {
      return unknown(c.session);
    }
    if (!insideClone(c.box)) {
      return { kind: "failed", reason: `runner path ${JSON.stringify(c.box)} is not inside the worktree` };
    }
    const [src, dst] = from(join(runner.spec.worktree, c.box));
    const done = await attempt(() => cp(src, dst, { recursive: true, verbatimSymlinks: true }), `cannot copy ${src}`);
    return done.kind === "ok" ? { kind: "ok" } : done;
  };

  return {
    place: "srt",

    probe: async (): Promise<Probe> =>
      readSrtProbe({
        platform: setup.host.platform,
        programs: setup.host.programs,
        refused: setup.host.toolchains.refused,
        version: await setup.run({ bin: setup.bin, args: VERSION_ARGS, stdin: "", env: setup.env }),
      }),

    start: async (spec) => {
      if (!spec.worktree.startsWith("/")) {
        return { kind: "failed", reason: `worktree ${JSON.stringify(spec.worktree)} must be an absolute path` };
      }
      const bad = spec.readOnly.find((p) => !insideClone(p));
      if (bad !== undefined) {
        return { kind: "failed", reason: `read-only path ${JSON.stringify(bad)} is not inside the worktree` };
      }
      const envProblem = checkEnv(spec.env);
      if (envProblem !== "") {
        return { kind: "failed", reason: envProblem };
      }
      const name = newName();
      const runner = await prepare(name, spec);
      if ("kind" in runner) {
        return runner;
      }
      live.set(name, runner);
      return { kind: "started", session: { id: name, place: "srt" } };
    },

    run: async ({ session, command }): Promise<Ran> => {
      const runner = live.get(session.id);
      if (runner === undefined) {
        return unknown(session);
      }
      const stop = new AbortController();
      runner.running.add(stop);
      const exit = setup.run({
        bin: setup.bin,
        args: srtArgs(runner.policy, command),
        stdin: command.stdin.kind === "text" ? command.stdin.text : "",
        env: runner.env,
        cwd: runner.spec.worktree,
        stop: stop.signal,
        ...outputOf(command),
      });
      const ran = await timed(exit, stop, command.timeoutSeconds);
      runner.running.delete(stop);
      return ran;
    },

    copyIn: (c) => copy(c, (inClone) => [c.host, inClone]),
    copyOut: (c) => copy(c, (inClone) => [inClone, c.host]),

    // a runner this Box never started, or already stopped, is not its to remove
    stop: async (session): Promise<Done> => {
      const runner = live.get(session.id);
      return runner === undefined ? { kind: "ok" } : remove(session.id, runner);
    },
  };
}
