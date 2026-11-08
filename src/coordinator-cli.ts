// coordinator-cli — `agent-factory setup coordinator` writes the coordinator's settings and instructions, and
// `agent-factory coordinator [copilot]` starts its session there (#106). The settings come from src/core/coordinator.ts.
//
//   <FACTORY_HOME>/coordinator/.claude/settings.json   the wall, read-only (0444)
//   <FACTORY_HOME>/coordinator/CLAUDE.md               "follow GUIDE.md", read-only
//   FACTORY_BOT_HOME                                   the factory user's home on the VM (default /home/factory)

import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Done, Result } from "./core/forge/api.js";
import { claudeArgv, claudeMd, claudeSettings, copilotArgs, type CoordinatorPlaces } from "./core/coordinator.js";
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

// readOnly : the file with this text, mode 0444; an earlier copy is made writable first, so setup can run again
async function readOnly(path: string, text: string): Promise<Done> {
  return attempt(async () => {
    await chmod(path, 0o644).catch(() => undefined);
    await writeFile(path, text, { mode: 0o444 });
    await chmod(path, 0o444);
  }, `cannot write ${path}`);
}

// installCoordinator : the settings and the instructions, in the coordinator's own folder
export async function installCoordinator(places: CoordinatorPlaces): Promise<Result<string>> {
  const dir = coordinatorDir(places.factoryHome);
  const made = await attempt(() => mkdir(join(dir, ".claude"), { recursive: true, mode: 0o755 }), `cannot make ${dir}`);
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
