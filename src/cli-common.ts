// cli-common — the helpers that command wrappers in src/app.ts share: the Io a command writes through, the factory
// home, the package version and folder, the settings-resolved run, the token store, the coordinator's places and who
// approves. They sit apart from app.ts so a command module can use them without importing app.ts (#574, #592).
//
// An empty or relative FACTORY_HOME is refused, never read as the current folder, because the coordinator may be able
// to write there.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, join } from "node:path";
import { homedir } from "node:os";
import type { FolderRunner } from "./core/agent/folder.js";
import type { Runner as CliRunner, Result } from "./core/forge/api.js";
import { openStore, type TokenStore } from "./core/token/index.js";
import { chosenProject } from "./core/which-project.js";
import type { CoordinatorPlaces } from "./core/coordinator.js";
import type { Interactive } from "./coordinator-cli.js";
import { runSettings } from "./core/project.js";

export type Io = {
  readonly env: NodeJS.ProcessEnv;
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
  readonly readSecret: (prompt: string) => Promise<string>;
  readonly readStdin: () => Promise<string>;
  readonly readLine?: (prompt: string) => Promise<string>;
  readonly latestRelease?: () => Promise<Result<string>>;
  readonly system: {
    readonly platform: NodeJS.Platform;
    readonly uid: number;
    readonly gid: number;
    readonly run: CliRunner;
    readonly interactive: Interactive;
    readonly background: (call: { readonly args: readonly string[]; readonly log: string }) => Promise<Result<number>>;
    readonly agent: FolderRunner;
  };
};

type Home = { readonly kind: "home"; readonly path: string } | { readonly kind: "refused"; readonly reason: string };

export function factoryHome(env: NodeJS.ProcessEnv): Home {
  const set = env.FACTORY_HOME;
  if (set === undefined) {
    return { kind: "home", path: join(homedir(), ".factory") };
  }
  return isAbsolute(set)
    ? { kind: "home", path: set }
    : { kind: "refused", reason: `FACTORY_HOME must be an absolute path, got ${JSON.stringify(set)}` };
}

export function version(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const file = join(here, "..", "package.json");
  const pkg: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (typeof pkg !== "object" || pkg === null || !("version" in pkg) || typeof pkg.version !== "string") {
    throw new Error(`no version string in ${file}`);
  }
  return pkg.version;
}

export function tokenStore(io: Io, home: string): Result<TokenStore> {
  const opened = openStore({
    platform: io.system.platform,
    home,
    owner: { uid: io.system.uid },
    run: io.system.run,
    env: io.env,
  });
  return opened.kind === "store" ? { kind: "ok", value: opened.store } : { kind: "failed", reason: opened.reason };
}

export async function resolvedRun(
  name: string,
  project: string | undefined,
  io: Io,
  run: (resolved: Io) => Promise<number>,
): Promise<number> {
  const home = factoryHome(io.env);
  const settings =
    home.kind === "home"
      ? await runSettings({ home: home.path, project, env: io.env })
      : { kind: "failed" as const, reason: home.reason };
  if (settings.kind === "failed") {
    io.err(`agent-factory ${name}: ${settings.reason}\n`);
    return 1;
  }
  for (const warning of settings.value.warnings) {
    io.err(`agent-factory ${name}: warning: ${warning}\n`);
  }
  return run({ ...io, env: settings.value.env });
}

export async function projectRun(
  name: string,
  project: string | undefined,
  io: Io,
  form: string,
  run: (resolved: Io) => Promise<number>,
): Promise<number> {
  const home = factoryHome(io.env);
  const chosen =
    home.kind === "home"
      ? await chosenProject({ home: home.path, project, env: io.env, usage: form })
      : { kind: "failed" as const, reason: home.reason };
  if (chosen.kind === "failed") {
    io.err(`agent-factory ${name}: ${chosen.reason}\n`);
    return 1;
  }
  return resolvedRun(name, chosen.value, io, run);
}

export function placesOf(io: Io): Result<CoordinatorPlaces> {
  const home = factoryHome(io.env);
  const bot = io.env.FACTORY_BOT_HOME ?? "/home/factory";
  if (home.kind === "refused") {
    return { kind: "failed", reason: home.reason };
  }
  return isAbsolute(bot)
    ? {
        kind: "ok",
        value: { pkg: join(dirname(fileURLToPath(import.meta.url)), ".."), factoryHome: home.path, botHome: bot },
      }
    : { kind: "failed", reason: `FACTORY_BOT_HOME must be an absolute path, got ${JSON.stringify(bot)}` };
}

export const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");
export const BUNDLED_DISCORD = join(PKG, "plugins", "discord", "plugin");
