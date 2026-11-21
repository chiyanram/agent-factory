// coordinator-cli — `agent-factory setup coordinator` writes the coordinator's settings and instructions, and
// `agent-factory coordinator [<project>] [copilot]` starts its session there, or with --discord in the
// project's Discord channel after checking that its plugin is on (core/agent/claude-plugins.ts) and its state
// folder (core/coordinator-discord.ts). The settings come
// from src/core/coordinator.ts. The launch reads only the coordinator's own model token from its OS user's store
// (setup claude --seat coordinator), never the runs' token, and puts it in the env, never argv.
// A Discord launch with no usable seat token is refused, so it never shares the runs' limit. Setup
// refuses a symlink and writes each file beside its target and renames it over, so it never writes through a link.
//
//   <FACTORY_HOME>/coordinator/.claude/settings.json   the wall, read-only (0444)
//   <FACTORY_HOME>/coordinator/CLAUDE.md               "follow prompts/coordinator.md", read-only
//   FACTORY_BOT_HOME                                   the factory user's home on the VM (default /home/factory)
//
// checkWall is what the orchestrator runs before each pass (#105, #227): it refuses to start while the coordinator's
// settings are missing or looser than the wall coordinator.ts builds.

import { chmod, lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Done, Result } from "./core/forge/api.js";
import {
  claudeArgv,
  claudeMd,
  claudeSettings,
  coordinatorDir,
  copilotArgs,
  wallProblems,
  type CoordinatorPlaces,
} from "./core/coordinator.js";
import { attempt } from "./core/review/safe.js";
import { pluginProblem, pluginState } from "./core/agent/claude-plugins.js";
import { checkDiscord, DISCORD_PLUGIN, discordArgv, discordEnv, discordStateDir } from "./core/coordinator-discord.js";
import { clearReset, resetWanted } from "./core/coordinator-turns.js";
import type { BoxToken } from "./core/token/index.js";

export type Interactive = (input: {
  readonly bin: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly signal?: AbortSignal;
}) => Promise<number>;

export type CoordinatorIo = {
  readonly env: NodeJS.ProcessEnv;
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
  readonly interactive: Interactive;
  readonly seat: () => Promise<SeatLogin>;
  readonly pollMs?: number;
};

export type SeatLogin = BoxToken | { readonly kind: "missing"; readonly reason: string };

export type Launch =
  | { readonly kind: "plain"; readonly runner: "claude" | "copilot" }
  | { readonly kind: "discord"; readonly project: string; readonly home: string; readonly uid: number };

export { coordinatorDir };

async function isLink(path: string): Promise<boolean> {
  return lstat(path).then(
    (s) => s.isSymbolicLink(),
    () => false,
  );
}

async function noLinks(paths: readonly string[]): Promise<Done> {
  for (const path of paths) {
    if (await isLink(path)) {
      return { kind: "failed", reason: `${path} is a symlink; remove it, then run setup again` };
    }
  }
  return { kind: "ok" };
}

async function readOnly(path: string, text: string): Promise<Done> {
  return attempt(async () => {
    const next = `${path}.new`;
    await writeFile(next, text, { mode: 0o444 });
    await chmod(next, 0o444);
    await rename(next, path);
  }, `cannot write ${path}`);
}

export async function installCoordinator(places: CoordinatorPlaces): Promise<Result<string>> {
  const dir = coordinatorDir(places.factoryHome);
  const links = await noLinks([dir, join(dir, ".claude")]);
  const made =
    links.kind === "ok"
      ? await attempt(() => mkdir(join(dir, ".claude"), { recursive: true, mode: 0o755 }), `cannot make ${dir}`)
      : links;
  if (made.kind === "failed") {
    return made;
  }
  const settings = await readOnly(
    join(dir, ".claude", "settings.json"),
    `${JSON.stringify(claudeSettings(places), null, 2)}\n`,
  );
  const md = settings.kind === "ok" ? await readOnly(join(dir, "CLAUDE.md"), claudeMd(places)) : settings;
  return md.kind === "ok" ? { kind: "ok", value: dir } : md;
}

type Env = NodeJS.ProcessEnv;

function missingSeat(env: Env, reason: string, launch: Launch, io: CoordinatorIo): Result<Env> {
  if (launch.kind === "discord") {
    io.err(`agent-factory coordinator: no seat token of its own, so the chat shares the runs' limit: ${reason}\n`);
  }
  return { kind: "ok", value: env };
}

// An API key or auth token in the caller's env is dropped: Claude Code uses either before the seat's OAuth token.
// https://code.claude.com/docs/en/iam#authentication-precedence
function readySeat(env: Env, seat: Extract<SeatLogin, { kind: "ready" }>, io: CoordinatorIo): Result<Env> {
  if (seat.notice.kind === "warn") {
    io.err(`agent-factory coordinator: ${seat.notice.text} --seat coordinator\n`);
  }
  const { ANTHROPIC_API_KEY: _key, ANTHROPIC_AUTH_TOKEN: _auth, ...rest } = env;
  return { kind: "ok", value: { ...rest, ...seat.env } };
}

function refusedSeat(env: Env, reason: string, launch: Launch, io: CoordinatorIo): Result<Env> {
  if (launch.kind === "discord") {
    return { kind: "failed", reason };
  }
  io.err(`agent-factory coordinator: starting on its own claude login: ${reason}\n`);
  return { kind: "ok", value: env };
}

function seatEnv(env: Env, seat: SeatLogin, launch: Launch, io: CoordinatorIo): Result<Env> {
  switch (seat.kind) {
    case "refused":
      return refusedSeat(env, seat.reason, launch, io);
    case "missing":
      return missingSeat(env, seat.reason, launch, io);
    case "ready":
      return readySeat(env, seat, io);
  }
}

async function withSeat(env: Env, launch: Launch, io: CoordinatorIo): Promise<Result<Env>> {
  if (launch.kind === "plain" && launch.runner === "copilot") {
    return { kind: "ok", value: env };
  }
  return seatEnv(env, await io.seat(), launch, io);
}

async function launchOf(
  places: CoordinatorPlaces,
  launch: Launch,
  io: CoordinatorIo,
): Promise<Result<{ readonly argv: readonly string[]; readonly env: NodeJS.ProcessEnv }>> {
  if (launch.kind === "plain") {
    const argv = launch.runner === "claude" ? claudeArgv() : ["copilot", ...copilotArgs(places)];
    return { kind: "ok", value: { argv, env: io.env } };
  }
  return discordLaunch(places, launch, io);
}

async function pluginOff(places: CoordinatorPlaces, home: string, env: Env): Promise<string> {
  const state = await pluginState(DISCORD_PLUGIN, {
    env: { ...env, HOME: home },
    folders: [coordinatorDir(places.factoryHome)],
  });
  return pluginProblem(DISCORD_PLUGIN, state);
}

async function discordLaunch(
  places: CoordinatorPlaces,
  launch: Extract<Launch, { kind: "discord" }>,
  io: CoordinatorIo,
): Promise<Result<{ readonly argv: readonly string[]; readonly env: Env }>> {
  const dir = discordStateDir(launch.home, launch.project);
  const checked = await checkDiscord(dir, launch.uid);
  if (checked.kind === "failed") {
    return checked;
  }
  const off = await pluginOff(places, launch.home, io.env);
  if (off !== "") {
    return { kind: "failed", reason: off };
  }
  for (const warning of checked.value) {
    io.err(`agent-factory coordinator: ${warning}\n`);
  }
  return { kind: "ok", value: { argv: discordArgv(), env: discordEnv(io.env, dir) } };
}

async function prepared(
  places: CoordinatorPlaces,
  launch: Launch,
  io: CoordinatorIo,
): Promise<Result<{ readonly argv: readonly string[]; readonly env: Env }>> {
  const built = await launchOf(places, launch, io);
  if (built.kind === "failed") {
    return built;
  }
  const env = await withSeat(built.value.env, launch, io);
  return env.kind === "failed" ? env : { kind: "ok", value: { argv: built.value.argv, env: env.value } };
}

export async function startCoordinator(places: CoordinatorPlaces, launch: Launch, io: CoordinatorIo): Promise<number> {
  const dir = coordinatorDir(places.factoryHome);
  const there = await readFile(join(dir, ".claude", "settings.json"), "utf8").then(
    () => true,
    () => false,
  );
  if (!there) {
    io.err(`agent-factory coordinator: no settings in ${dir}; run agent-factory setup coordinator first\n`);
    return 1;
  }
  return launch.kind === "plain" ? startOnce(places, launch, io, dir) : supervised(places, launch, io, dir);
}

async function startOnce(
  places: CoordinatorPlaces,
  launch: Launch,
  io: CoordinatorIo,
  dir: string,
  signal?: AbortSignal,
): Promise<number> {
  const ready = await prepared(places, launch, io);
  if (ready.kind === "failed") {
    io.err(`agent-factory coordinator: ${ready.reason}\n`);
    return 1;
  }
  const [bin, ...args] = ready.value.argv;
  return io.interactive({ bin: bin ?? "claude", args, cwd: dir, env: ready.value.env, ...(signal ? { signal } : {}) });
}

async function supervised(
  places: CoordinatorPlaces,
  launch: Extract<Launch, { kind: "discord" }>,
  io: CoordinatorIo,
  dir: string,
): Promise<number> {
  await clearReset(launch.home, launch.project);
  const control = new AbortController();
  const watch = setInterval(() => {
    void resetWanted(launch.home, launch.project).then((wanted) => wanted && control.abort());
  }, io.pollMs ?? 2000);
  const code = await startOnce(places, launch, io, dir, control.signal).finally(() => clearInterval(watch));
  if (!control.signal.aborted) {
    return code;
  }
  io.err(
    "agent-factory coordinator: the context reached its reset size; starting a fresh session from the handoff note\n",
  );
  return supervised(places, launch, io, dir);
}

function parsedSettings(text: string, path: string): Result<unknown> {
  try {
    return { kind: "ok", value: JSON.parse(text) as unknown };
  } catch {
    return { kind: "failed", reason: `${path} is not valid JSON` };
  }
}

export async function checkWall(places: CoordinatorPlaces): Promise<Done> {
  const path = join(coordinatorDir(places.factoryHome), ".claude", "settings.json");
  const text = await readFile(path, "utf8").catch(() => "");
  const settings: Result<unknown> =
    text === ""
      ? { kind: "failed", reason: `no coordinator settings at ${path}; run agent-factory setup coordinator` }
      : parsedSettings(text, path);
  if (settings.kind === "failed") {
    return settings;
  }
  const problems = wallProblems(settings.value, places);
  return problems.length === 0
    ? { kind: "ok" }
    : {
        kind: "failed",
        reason: `the coordinator's settings in ${path} are looser than its wall; run agent-factory setup coordinator again:\n${problems.map((p) => `  - ${p}`).join("\n")}`,
      };
}
