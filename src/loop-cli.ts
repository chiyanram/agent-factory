// loop-cli — the coordinator's forge commands and the writer's lint hook on the command line (#138): claim, release,
// status, ask, block, reconcile (core/loop.ts) and lint-edit (core/lint-edit.ts). Each prints one line per action;
// with FACTORY_DRY_RUN=1 the seam prints each write on stderr instead, and the line ends in "(dry run)".

import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { headed } from "./core/dispatch/last-poll.js";
import type { Result } from "./core/forge/api.js";
import { forgeHost, openProject } from "./core/forge/index.js";
import type { Identity } from "./core/identity.js";
import { hostPush } from "./core/push.js";
import type { PushTarget } from "./core/writer/step.js";
import type { Forge } from "./core/forge/types.js";
import { lintEdit } from "./core/lint-edit.js";
import { ask, block, claim, reconcile, release, status, type AtHead } from "./core/loop.js";
import { DEFAULT_CLAIM_LABEL } from "./core/poll.js";
import { claudeSessions } from "./core/review/live.js";
import { runInFolder } from "./core/review/model.js";
import { claudeEnv } from "./core/review/settings.js";
import { settingOf } from "./core/settings/machine.js";

export type LoopIo = {
  readonly env: NodeJS.ProcessEnv;
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
  readonly readStdin: () => Promise<string>;
};

type Act = (forge: Forge, label: string, identity: Identity) => Promise<Result<string | readonly string[]>>;

const USAGE: Readonly<Record<string, string>> = {
  claim: "claim <number>",
  release: "release <number>",
  status: 'status <number> <sha> "<line>"',
  ask: 'ask <number> <sha> "<question>"',
  block: 'block <number> "<reason>" [<log>]',
  reconcile: "reconcile",
  "lint-edit": "lint-edit '<lint command>'",
};

function usage(name: string, io: LoopIo): number {
  io.err(`usage: agent-factory ${USAGE[name] ?? name}\n`);
  return 64;
}

function word(positionals: readonly string[], i: number): string {
  return positionals[i] ?? "";
}

function numberOf(value: string | undefined): number | "bad" {
  return value !== undefined && /^[1-9]\d{0,9}$/.test(value) ? Number(value) : "bad";
}

function lines(value: string | readonly string[], dry: string): string {
  return (typeof value === "string" ? [value] : value).map((l) => `${l}${dry}\n`).join("");
}

// forgeOf : the project's forge and its claim label
async function forgeOf(
  io: LoopIo,
): Promise<Result<{ readonly forge: Forge; readonly label: string; readonly identity: Identity }>> {
  const label = settingOf(io.env, "claimLabel") ?? DEFAULT_CLAIM_LABEL;
  if (label.trim() === "") {
    return { kind: "failed", reason: "FACTORY_CLAIM_LABEL is set but empty" };
  }
  const opened = await openProject({ env: io.env, log: (line) => io.err(`${line}\n`) });
  return opened.kind === "ok" ? { kind: "ok", value: { ...opened.value, label } } : opened;
}

// onForge : the action on the project's forge; its lines on stdout, or why it failed on stderr
async function onForge(name: string, io: LoopIo, act: Act): Promise<number> {
  const opened = await forgeOf(io);
  const done = opened.kind === "ok" ? await act(opened.value.forge, opened.value.label, opened.value.identity) : opened;
  if (done.kind === "failed") {
    io.err(`agent-factory ${name}: ${done.reason}\n`);
    return 1;
  }
  io.out(lines(done.value, settingOf(io.env, "dryRun") === "1" ? " (dry run)" : ""));
  return 0;
}

function claimed(name: "claim" | "release", positionals: readonly string[], io: LoopIo): Promise<number> | number {
  const number = numberOf(positionals[0]);
  if (number === "bad" || positionals.length !== 1) {
    return usage(name, io);
  }
  const act = name === "claim" ? claim : release;
  return onForge(name, io, (forge, label) => act({ forge, number, label }));
}

function atHead(name: "status" | "ask", positionals: readonly string[], io: LoopIo): Promise<number> | number {
  const number = numberOf(positionals[0]);
  if (number === "bad" || positionals.length !== 3) {
    return usage(name, io);
  }
  const [sha, text] = [word(positionals, 1), word(positionals, 2)];
  return name === "status"
    ? onForge(name, io, (forge, label) => withLiveness(io, forge, label, status({ forge, number, sha, text })))
    : onForge(name, io, (forge) => ask({ forge, number, sha, text } satisfies AtHead));
}

// homeOf : the factory's home, as dispatch reads it; a relative FACTORY_HOME is refused
function homeOf(env: NodeJS.ProcessEnv): Result<string> {
  const home = env.FACTORY_HOME ?? join(homedir(), ".factory");
  return isAbsolute(home)
    ? { kind: "ok", value: home }
    : { kind: "failed", reason: `FACTORY_HOME must be an absolute path, got ${JSON.stringify(home)}` };
}

// withLiveness : status's line, headed by when the orchestrator last ran and whether its loop runs (#103, #305)
async function withLiveness(
  io: LoopIo,
  forge: Forge,
  label: string,
  posted: Promise<Result<string>>,
): Promise<Result<string>> {
  const done = await posted;
  return done.kind === "ok"
    ? {
        kind: "ok",
        value: await headed({
          home: homeOf(io.env),
          forge,
          label,
          repo: settingOf(io.env, "gitHostProject") ?? "",
          now: Date.now(),
          line: done.value,
        }),
      }
    : done;
}

function blocked(positionals: readonly string[], io: LoopIo): Promise<number> | number {
  const [n, reason, log] = positionals;
  const number = numberOf(n);
  if (number === "bad" || reason === undefined || positionals.length > 3) {
    return usage("block", io);
  }
  return onForge("block", io, (forge, label) => block({ forge, number, label, reason, log: log ?? "" }));
}

function reconciled(positionals: readonly string[], io: LoopIo): Promise<number> | number {
  const repo = settingOf(io.env, "clone") ?? "";
  if (positionals.length !== 0) {
    return usage("reconcile", io);
  }
  if (!isAbsolute(repo)) {
    io.err(`agent-factory reconcile: FACTORY_REPO must be an absolute path, got ${JSON.stringify(repo)}\n`);
    return 1;
  }
  const sessions = claudeSessions({ bin: io.env.FACTORY_CLAUDE ?? "claude", env: claudeEnv(io.env) });
  return onForge("reconcile", io, (forge, label, identity) =>
    reconcile({
      forge,
      label,
      repo,
      env: io.env,
      sessions,
      dryRun: settingOf(io.env, "dryRun") === "1",
      landing: { target: landingTarget(io.env, forge, identity), pusher: hostPush },
    }),
  );
}

// landingTarget : where a dead writer's unlanded commits go: the project on its forge's host, as its identity
function landingTarget(env: NodeJS.ProcessEnv, forge: Forge, identity: Identity): Result<PushTarget> {
  const host = forgeHost(env, forge.name);
  const project = settingOf(env, "gitHostProject") ?? "";
  if (host.kind === "failed") {
    return host;
  }
  return project === ""
    ? { kind: "failed", reason: "FACTORY_PROJECT is not set" }
    : { kind: "ok", value: { forge: forge.name, host: host.value, project, identity, env } };
}

async function linted(positionals: readonly string[], io: LoopIo): Promise<number> {
  const [command] = positionals;
  if (command === undefined || positionals.length !== 1) {
    return usage("lint-edit", io);
  }
  const root = io.env.CLAUDE_PROJECT_DIR ?? io.env.PWD ?? "";
  const hooked = await lintEdit({ command, stdin: await io.readStdin(), root, env: io.env, run: runInFolder });
  io.err(hooked.err);
  return hooked.code;
}

type LoopCommand = (positionals: readonly string[], io: LoopIo) => Promise<number> | number;

export const LOOP_COMMANDS: Readonly<Record<string, LoopCommand>> = {
  claim: (p, io) => claimed("claim", p, io),
  release: (p, io) => claimed("release", p, io),
  status: (p, io) => atHead("status", p, io),
  ask: (p, io) => atHead("ask", p, io),
  block: blocked,
  reconcile: reconciled,
  "lint-edit": linted,
};

export const LOOP_HELP = `  claim <number>               add the claim label to an open change that has none: one run at a time
  release <number>             remove the claim label; a change with no claim is not an error
  status <number> <sha> "<line>"
                               post one [coordinator] note; refused when the head is no longer <sha>; its line starts
                               with when the orchestrator last ran, LATE after 3 poll intervals while a change is claimed
                               and a loop is meant to be running; with no loop, that none runs
  ask <number> <sha> "<question>"
                               post one [writer] OPEN: note, an open ask until a person answers; the same head rule
  block <number> "<reason>" [<log>]
                               label needs-human, post one [coordinator] blocked: note, then release the claim
  reconcile                    release each claim with no live run or on a merged change; remove each run's worktree
                               with no live run (FACTORY_REPO), but keep a writer's that holds unlanded work: push its
                               commits on top of the change's branch and label the change needs-human
  lint-edit '<lint command>'   the writer's PostToolUse hook: lint the file an Edit or Write changed, no shell
`;
