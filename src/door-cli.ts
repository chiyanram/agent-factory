// door-cli — agent-factory door discord and agent-factory setup door-discord (#731; ADR-0023 D1, D4): the Discord door
// as a long-running engine command, run as the `factory` OS user. It reads its token and people.json once at boot,
// refusing a token file that group or others can read, connects out to the Gateway, and answers /start, /approve and
// /board through the door seam (src/core/door/discord/). Every line it prints passes through the scrub with its token
// cut out. app.ts hands in what the terminal's own start, approve and board already use, so both doors act alike.

import { randomBytes } from "node:crypto";
import type { Result } from "./core/forge/api.js";
import type { Where } from "./core/approval.js";
import { runSettings } from "./core/project.js";
import { discordDoor, type ProjectDoor } from "./core/door/discord/door.js";
import { readDoorConfig, readDoorToken, storeDoorToken, type DoorConfig } from "./core/door/discord/files.js";
import { openGateway, scrubberOf } from "./core/door/discord/gateway.js";
import { REAL_TIMERS, realTransport, type Timers, type Transport } from "./core/door/discord/transport.js";
import { factoryHome, type Io, version } from "./cli-common.js";

export const DOOR_HELP = `  door discord                 the Discord door: a long-running, code-only bot, run as the factory OS user, that
                               answers /start, /approve (with a Confirm bound to the hashes it showed, for 10
                               minutes) and a read-only /board from the people and channels in
                               <factory home>/door/discord/people.json; waive and merge stay at the terminal
`;

// what the door does through the terminal's own code, for one project, with that project's settings resolved
export type DoorWiring = {
  readonly where: (io: Io, project: string, ticket: string) => Result<Where>;
  readonly branchThere: (io: Io, project: string, ticket: string) => Promise<Result<boolean>>;
  readonly board: (io: Io, project: string) => Promise<Result<string>>;
  readonly after: (io: Io, project: string) => Promise<void>;
};

// the transport and timers; a test passes fakes, so no test reaches Discord
export type DoorReach = {
  readonly transport: (token: string) => Transport;
  readonly timers: Timers;
};

const REAL_REACH: DoorReach = { transport: (token) => realTransport(token, version()), timers: REAL_TIMERS };

// opener : the project, its settings layers resolved once per interaction as resolvedRun resolves them for a terminal
// command, with their warnings printed, then bound to the terminal's own code
function opener(io: Io, home: string, wiring: DoorWiring): (project: string) => Promise<Result<ProjectDoor>> {
  return async (project) => {
    const settings = await runSettings({ home, project, env: io.env });
    if (settings.kind === "failed") {
      return settings;
    }
    for (const warning of settings.value.warnings) {
      io.err(`agent-factory door discord: ${project}: warning: ${warning}\n`);
    }
    const p: Io = { ...io, env: settings.value.env };
    return {
      kind: "ok",
      value: {
        home,
        specs: (ticket) => wiring.where(p, project, ticket),
        branchThere: (ticket) => wiring.branchThere(p, project, ticket),
        board: () => wiring.board(p, project),
        after: () => wiring.after(p, project),
      },
    };
  };
}

type Boot = { readonly home: string; readonly token: string; readonly config: DoorConfig };

// boot : the factory home, the door's token and people.json, each refused as the files module says
async function boot(env: NodeJS.ProcessEnv): Promise<Result<Boot>> {
  const home = factoryHome(env);
  if (home.kind === "refused") {
    return { kind: "failed", reason: home.reason };
  }
  const token = await readDoorToken(home.path);
  if (token.kind === "failed") {
    return token;
  }
  const config = await readDoorConfig(home.path);
  return config.kind === "ok"
    ? { kind: "ok", value: { home: home.path, token: token.value, config: config.value } }
    : config;
}

// doorCommand : agent-factory door discord; it returns only when Discord refuses the token or an intent
export async function doorCommand(
  positionals: readonly string[],
  io: Io,
  wiring: DoorWiring,
  reach: DoorReach = REAL_REACH,
): Promise<number> {
  if (positionals.length !== 1 || positionals[0] !== "discord") {
    io.err("usage: agent-factory door discord\n");
    return 64;
  }
  const booted = await boot(io.env);
  if (booted.kind === "failed") {
    io.err(`agent-factory door discord: refused: ${booted.reason}\n`);
    return 1;
  }
  return runDoor(io, wiring, reach, booted.value);
}

// runDoor : the door on the Gateway, every line it prints scrubbed with its token cut out
async function runDoor(io: Io, wiring: DoorWiring, reach: DoorReach, { home, token, config }: Boot): Promise<number> {
  const scrub = scrubberOf(token);
  const quiet: Io = { ...io, out: (text) => io.out(scrub(text)), err: (text) => io.err(scrub(text)) };
  const door = discordDoor({
    config,
    env: io.env,
    now: Date.now,
    nonce: () => randomBytes(16).toString("hex"),
    scrub,
    open: opener(quiet, home, wiring),
  });
  const gateway = openGateway({
    transport: reach.transport(token),
    token,
    guild: config.guild,
    handle: door.handle,
    log: (line) => quiet.out(`${line}\n`),
    timers: reach.timers,
  });
  quiet.out(`agent-factory door discord: connecting for guild ${config.guild}\n`);
  const ended = await gateway.ended;
  quiet.err(`agent-factory door discord: ${ended.reason}\n`);
  return 1;
}

// setupDoorDiscord : the door's bot token, pasted at a hidden prompt and stored at 0600; never printed
export async function setupDoorDiscord(io: Io): Promise<number> {
  const home = factoryHome(io.env);
  if (home.kind === "refused") {
    io.err(`agent-factory setup door-discord: ${home.reason}\n`);
    return 1;
  }
  const pasted = await io.readSecret("Paste the door bot's token (it is not shown, and never printed): ");
  const stored = await storeDoorToken(home.path, pasted);
  if (stored.kind === "failed") {
    io.err(`agent-factory setup door-discord: ${stored.reason}\n`);
    return 1;
  }
  io.out(
    `stored the door bot's token in ${stored.value} (mode 600); map people and channels in people.json beside it\n`,
  );
  return 0;
}
