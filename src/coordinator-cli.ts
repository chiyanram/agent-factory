// coordinator-cli — `agent-factory setup coordinator` writes the coordinator's settings and instructions, and
// `agent-factory coordinator [<project>] [copilot]` starts its session there, or with --discord in the
// project's Discord channel after checking the plugin's state folder (core/coordinator-discord.ts). The settings come
// from src/core/coordinator.ts. The launch reads only the coordinator's own model token from its OS user's store
// (setup claude --seat coordinator), never the runs' token, and puts it in the env, never argv.
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
  copilotArgs,
  wallProblems,
  type CoordinatorPlaces,
} from "./core/coordinator.js";
import { attempt } from "./core/review/safe.js";
import { checkDiscord, discordArgv, discordEnv, discordStateDir } from "./core/coordinator-discord.js";
import type { BoxToken } from "./core/token/index.js";

export type Interactive = (input: {
  readonly bin: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
}) => Promise<number>;

export type CoordinatorIo = {
  readonly env: NodeJS.ProcessEnv;
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
  readonly interactive: Interactive;
  // the coordinator seat's own model login; it never reads the runs' token
  readonly seat: () => Promise<SeatLogin>;
};

export type SeatLogin = BoxToken | { readonly kind: "missing"; readonly reason: string };

// how the session starts: plain (the Claude app's or a terminal's chat), or in the project's Discord channel, with the
// session user's home and uid for the plugin's state folder and its checks
export type Launch =
  | { readonly kind: "plain"; readonly runner: "claude" | "copilot" }
  | { readonly kind: "discord"; readonly project: string; readonly home: string; readonly uid: number };

export function coordinatorDir(factoryHome: string): string {
  return join(factoryHome, "coordinator");
}

async function isLink(path: string): Promise<boolean> {
  return lstat(path).then(
    (s) => s.isSymbolicLink(),
    () => false,
  );
}

// noLinks : refuses when any of these paths is a symlink, so setup never writes through one to another place
async function noLinks(paths: readonly string[]): Promise<Done> {
  for (const path of paths) {
    if (await isLink(path)) {
      return { kind: "failed", reason: `${path} is a symlink; remove it, then run setup again` };
    }
  }
  return { kind: "ok" };
}

// readOnly : the file with this text, mode 0444, written beside it and renamed over it, so a link put in its place is
// replaced, never followed
async function readOnly(path: string, text: string): Promise<Done> {
  return attempt(async () => {
    const next = `${path}.new`;
    await writeFile(next, text, { mode: 0o444 });
    await chmod(next, 0o444);
    await rename(next, path);
  }, `cannot write ${path}`);
}

// installCoordinator : the settings and the instructions, in the coordinator's own folder
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

// missingSeat : no seat token: the session uses its own claude login, which a Discord session says
function missingSeat(env: Env, reason: string, launch: Launch, io: CoordinatorIo): Result<Env> {
  if (launch.kind === "discord") {
    io.err(`agent-factory coordinator: no seat token of its own, so the chat shares the runs' limit: ${reason}\n`);
  }
  return { kind: "ok", value: env };
}

// readySeat : the seat's token in the env, never argv; an API key or auth token in the caller's env is dropped, since
// Claude Code would use it before the seat's token
function readySeat(env: Env, seat: Extract<SeatLogin, { kind: "ready" }>, io: CoordinatorIo): Result<Env> {
  if (seat.notice.kind === "warn") {
    io.err(`agent-factory coordinator: ${seat.notice.text} --seat coordinator\n`);
  }
  const { ANTHROPIC_API_KEY: _key, ANTHROPIC_AUTH_TOKEN: _auth, ...rest } = env;
  return { kind: "ok", value: { ...rest, ...seat.env } };
}

// refusedSeat : a seat token that cannot be used refuses the Discord launch, which must not share the runs' limit
// unawares; a plain launch says why and starts on its own login, as it did before the seat had a token
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

// withSeat : the env with the seat's login, or why the session may not start; Copilot takes no claude token
async function withSeat(env: Env, launch: Launch, io: CoordinatorIo): Promise<Result<Env>> {
  if (launch.kind === "plain" && launch.runner === "copilot") {
    return { kind: "ok", value: env };
  }
  return seatEnv(env, await io.seat(), launch, io);
}

// launchOf : the argv and env for the launch, after the Discord files' checks
async function launchOf(
  places: CoordinatorPlaces,
  launch: Launch,
  io: CoordinatorIo,
): Promise<Result<{ readonly argv: readonly string[]; readonly env: NodeJS.ProcessEnv }>> {
  if (launch.kind === "plain") {
    const argv = launch.runner === "claude" ? claudeArgv() : ["copilot", ...copilotArgs(places)];
    return { kind: "ok", value: { argv, env: io.env } };
  }
  // Today: the plugin-enabled check (#555's pluginState for DISCORD_PLUGIN) is not built yet, so a plugin that is off
  // is not refused here and the session starts deaf
  const dir = discordStateDir(launch.home, launch.project);
  const checked = await checkDiscord(dir, launch.uid);
  if (checked.kind === "failed") {
    return checked;
  }
  for (const warning of checked.value) {
    io.err(`agent-factory coordinator: ${warning}\n`);
  }
  return { kind: "ok", value: { argv: discordArgv(), env: discordEnv(io.env, dir) } };
}

// prepared : the argv and the env, the Discord files checked and the seat's login in place
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

// startCoordinator : the session in its folder, with only the folder's settings (Claude Code) or the same rules as
// flags (Copilot CLI), and its seat's own login; refused when setup has not written them, or when the Discord files
// are looser than the wall
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
  const ready = await prepared(places, launch, io);
  if (ready.kind === "failed") {
    io.err(`agent-factory coordinator: ${ready.reason}\n`);
    return 1;
  }
  const [bin, ...args] = ready.value.argv;
  return io.interactive({ bin: bin ?? "claude", args, cwd: dir, env: ready.value.env });
}
function parsedSettings(text: string, path: string): Result<unknown> {
  try {
    return { kind: "ok", value: JSON.parse(text) as unknown };
  } catch {
    return { kind: "failed", reason: `${path} is not valid JSON` };
  }
}

// checkWall : ok only while the coordinator's settings are in place and hold the whole wall
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
