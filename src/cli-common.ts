// cli-common — the helpers that command wrappers in src/app.ts share: the Io a command writes through, the factory
// home, the package version and folder, the settings-resolved run, the token store, the coordinator's places and who
// approves. They sit apart from app.ts so a command module can use them without importing app.ts (#574, #592).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, join } from "node:path";
import { homedir, userInfo } from "node:os";
import { hostGit } from "./core/git.js";
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
  // a pasted secret, never shown: echo off on a terminal (src/core/token/prompt.ts)
  readonly readSecret: (prompt: string) => Promise<string>;
  // all of stdin, for the lint-edit hook
  readonly readStdin: () => Promise<string>;
  // one line the person types at a terminal, for init's questions (#369); none off a terminal
  readonly readLine?: (prompt: string) => Promise<string>;
  // the latest release's version, for init and setup status (#482); none in a test, so no test reaches the network
  readonly latestRelease?: () => Promise<Result<string>>;
  // the machine setup stores tokens on; a test passes linux and its own uid, so it never touches a Keychain
  readonly system: {
    readonly platform: NodeJS.Platform;
    readonly uid: number;
    readonly gid: number;
    readonly run: CliRunner;
    // a program on this terminal, for the coordinator's session
    readonly interactive: Interactive;
    // this command line, run again in the background with these words, its output appended to log; it outlives this
    // command and gives its pid (the orchestrator loop, #305). A test passes a fake that starts nothing.
    readonly background: (call: { readonly args: readonly string[]; readonly log: string }) => Promise<Result<number>>;
  };
};

type Home = { readonly kind: "home"; readonly path: string } | { readonly kind: "refused"; readonly reason: string };

// factoryHome : where specs and approvals live. An empty or relative FACTORY_HOME is refused, never read as the
// current folder, which the coordinator may be able to write.
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
  // a package.json with no version string is a broken install: say so, never print a made-up version
  if (typeof pkg !== "object" || pkg === null || !("version" in pkg) || typeof pkg.version !== "string") {
    throw new Error(`no version string in ${file}`);
  }
  return pkg.version;
}

// whoApproves : the OS user and, when set, the operator's own git user.name. A record, not proof: the harness prompt is
// the gate.
export async function whoApproves(env: NodeJS.ProcessEnv): Promise<string> {
  const name = await hostGit({
    args: ["config", "--get", "user.name"],
    repo: { kind: "none" },
    env,
    stdin: { kind: "none" },
  });
  const gitName = name.kind === "ok" ? name.stdout.trim() : "";
  return gitName.length > 0 ? `${userInfo().username} (${gitName})` : userInfo().username;
}

// tokenStore : where the box's model login is kept (#136), as a result
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

// resolvedRun : the run with the project's settings layers resolved once on this host (#254): its modules read the
// resolved values, and the warnings (an unknown key) are printed; a layer that loosens a safety key refuses it
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

// projectRun : resolvedRun for a command that may name no project (#382): the project it names, the coordinator's, the
// variables alone when FACTORY_PROJECT is exported, or the one in the factory home (core/which-project.ts)
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

// placesOf : where the coordinator's rules point: this package, the factory home, the factory user's home
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

// the package's own folder, and its bundled discord plugin: the only plugin the Discord webhook is ever handed to (#119)
export const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");
export const BUNDLED_DISCORD = join(PKG, "plugins", "discord", "plugin");
