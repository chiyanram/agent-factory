// coordinator-cli — `agent-factory setup coordinator` writes the coordinator's settings and instructions, and
// `agent-factory coordinator [copilot]` starts its session there (#106). The settings come from src/core/coordinator.ts.
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
};

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

// startCoordinator : the session in its folder, with only the folder's settings (Claude Code) or the same rules as
// flags (Copilot CLI); refused when setup has not written them
export async function startCoordinator(
  places: CoordinatorPlaces,
  runner: "claude" | "copilot",
  io: CoordinatorIo,
): Promise<number> {
  const dir = coordinatorDir(places.factoryHome);
  const there = await readFile(join(dir, ".claude", "settings.json"), "utf8").then(
    () => true,
    () => false,
  );
  if (!there) {
    io.err(`agent-factory coordinator: no settings in ${dir}; run agent-factory setup coordinator first\n`);
    return 1;
  }
  const [bin, ...args] = runner === "claude" ? claudeArgv() : ["copilot", ...copilotArgs(places)];
  return io.interactive({ bin, args, cwd: dir, env: io.env });
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
