// forge — open the forge seam for one project from its settings (ADR-0010, ADR-0012 S14).
//
//   FACTORY_FORGE      gitlab (default) or github
//   FACTORY_PROJECT    the project: owner/name on GitHub, the full path on GitLab (for example aruvii/agent-platform)
//   FACTORY_GH         the gh the factory acts through (default: gh)
//   FACTORY_GLAB       the glab the factory acts through (default: glab)
//   FACTORY_IDENTITY   who it acts as: own (default) or app (src/core/identity.ts)
//   FACTORY_MAX_TRIES  calls per request while the forge answers with a rate limit (default: 4)
//   FACTORY_DRY_RUN    1: every write is printed instead of made; reads still go to the forge (ADR-0011 D14)
//
// A project whose file maps forge.read and forge.write to a plugin is served by that plugin (openProjectForge, #134).
//
// No setting is guessed: a value that is set but not valid is refused, never replaced by the default.

import { identitySetting, resolveIdentity, type Identity, type IdentitySetting } from "../identity.js";
import { realSleep, runProcess, type Client, type Done, type Result, type Runner, type Sleeper } from "./api.js";
import { github } from "./github.js";
import { gitlab } from "./gitlab.js";
import { pluginConfigOf } from "../plugin/config.js";
import type { Setup } from "../plugin/registry.js";
import { readProjectRaw } from "../project.js";
import { settingName, settingOf } from "../settings/machine.js";
import { pluginForge, type PluginTarget } from "./plugin.js";
import { forgeName, githubProject, gitlabProject } from "./target.js";
import type { Forge, ForgeName } from "./types.js";

export type { Forge } from "./types.js";
export { forgeName };

export type ForgeSetup = {
  readonly env: NodeJS.ProcessEnv;
  // who the forge calls act as; resolve it with openProject, or pass { kind: "own" }
  readonly identity: Identity;
  // where a dry run reports each write it did not make
  readonly log: (line: string) => void;
  readonly run?: Runner;
  readonly sleep?: Sleeper;
  readonly now?: () => number;
};

function maxTries(value: string | undefined): Result<number> {
  if (value === undefined) {
    return { kind: "ok", value: 4 };
  }
  return /^[1-9]\d{0,2}$/.test(value)
    ? { kind: "ok", value: Number(value) }
    : { kind: "failed", reason: `FACTORY_MAX_TRIES must be a whole number from 1, got ${JSON.stringify(value)}` };
}

// The environment of every CLI call this forge makes: no update notice and no prompt, since an unattended call must
// answer or fail. With an App identity, each gh call gets the App's token in its own environment.
function cliEnv(setup: ForgeSetup): NodeJS.ProcessEnv {
  const quiet = { ...setup.env, GH_NO_UPDATE_NOTIFIER: "1", GH_PROMPT_DISABLED: "1", GLAB_CHECK_UPDATE: "false" };
  return setup.identity.kind === "app" ? { ...quiet, GH_TOKEN: setup.identity.token } : quiet;
}

function client(setup: ForgeSetup, name: "github" | "gitlab", tries: number): Client {
  const bin = name === "github" ? (setup.env.FACTORY_GH ?? "gh") : (setup.env.FACTORY_GLAB ?? "glab");
  return {
    name,
    bin,
    env: cliEnv(setup),
    run: setup.run ?? runProcess,
    sleep: setup.sleep ?? realSleep,
    maxTries: tries,
    now: setup.now ?? (() => Math.floor(Date.now() / 1000)),
  };
}

function adapter(setup: ForgeSetup, tries: number): Result<Forge> {
  const project = setup.env.FACTORY_PROJECT ?? "";
  const kind = forgeName(setup.env);
  if (kind.kind === "failed") {
    return kind;
  }
  return kind.value === "github" ? githubAdapter(setup, tries, project) : gitlabAdapter(setup, tries, project);
}

function githubAdapter(setup: ForgeSetup, tries: number, project: string): Result<Forge> {
  const where = githubProject(project);
  return where.kind === "ok" ? { kind: "ok", value: github(client(setup, "github", tries), where.value) } : where;
}

function gitlabAdapter(setup: ForgeSetup, tries: number, project: string): Result<Forge> {
  const where = gitlabProject(project);
  return where.kind === "ok" ? { kind: "ok", value: gitlab(client(setup, "gitlab", tries), where.value) } : where;
}

// withLogin : an App has no user to ask; its login came with its token.
function withLogin(forge: Forge, name: string): Forge {
  return { ...forge, me: async () => ({ kind: "ok", value: name }) };
}

// dryRun : every write printed instead of made (ADR-0011 D14).
function dryRun(forge: Forge, log: (line: string) => void): Forge {
  const m = forge.mark;
  return {
    ...forge,
    addLabel: async (i) => (log(`DRY RUN: add the label ${i.label} to ${m}${i.number}`), { kind: "ok" }),
    removeLabel: async (i) => (log(`DRY RUN: remove the label ${i.label} from ${m}${i.number}`), { kind: "ok" }),
    note: async (i) => (log(`DRY RUN: note on ${m}${i.number}: [${i.post.seat}] ${i.post.title}`), { kind: "ok" }),
    setBody: async (i) => (
      log(`DRY RUN: set the body of ${m}${i.number}: [${i.post.seat}] ${i.post.title}`), { kind: "ok" }
    ),
    status: async (i) => (log(`DRY RUN: status ${i.context} ${i.state} at ${i.sha.slice(0, 8)}`), { kind: "ok" }),
    // a dry run opens no change, so there is no number to give back: the caller stops there
    openChange: async (i) => (
      log(`DRY RUN: open a draft change from ${i.branch} into ${i.base}`),
      { kind: "failed", reason: "a dry run opens no change" }
    ),
    lineFinding: async (i) => (
      log(`DRY RUN: finding on ${m}${i.change.number} at ${i.at.file}:${i.at.line}`), { kind: "ok" }
    ),
  };
}

function dryRunSetting(value: string | undefined): Result<boolean> {
  const dry = value ?? "";
  return ["", "0", "1"].includes(dry)
    ? { kind: "ok", value: dry === "1" }
    : { kind: "failed", reason: `FACTORY_DRY_RUN must be 1 or 0, got ${JSON.stringify(dry)}` };
}

// settled : the adapter with the identity's login and FACTORY_DRY_RUN applied.
function settled(setup: ForgeSetup, forge: Forge): Result<Forge> {
  const dry = dryRunSetting(settingOf(setup.env, "dryRun"));
  if (dry.kind === "failed") {
    return dry;
  }
  const named = setup.identity.kind === "app" ? withLogin(forge, setup.identity.login) : forge;
  return { kind: "ok", value: dry.value ? dryRun(named, setup.log) : named };
}

export function openForge(setup: ForgeSetup): Result<Forge> {
  const tries = maxTries(settingOf(setup.env, "caps.gitHostTries"));
  if (tries.kind === "failed") {
    return tries;
  }
  const opened = adapter(setup, tries.value);
  return opened.kind === "ok" ? settled(setup, opened.value) : opened;
}

const DEFAULT_HOST: Readonly<Record<ForgeName, string>> = { github: "github.com", gitlab: "gitlab.com" };

// forgeHost : the forge's host, FACTORY_FORGE_HOST, checked: github.com and gitlab.com unless set. The host push sends a
// branch only to a URL on this host.
export function forgeHost(env: NodeJS.ProcessEnv, forge: "github" | "gitlab"): Result<string> {
  const host = settingOf(env, "gitHostName") ?? DEFAULT_HOST[forge];
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host)
    ? { kind: "ok", value: host }
    : { kind: "failed", reason: `FACTORY_FORGE_HOST must be a host name, got ${JSON.stringify(host)}` };
}

// openProject : the forge for the project in the settings, acting as the project's identity. With an App, this asks the
// factory user for a token once (src/core/identity.ts).
export async function openProject(
  setup: Omit<ForgeSetup, "identity">,
): Promise<Result<{ readonly forge: Forge; readonly identity: Identity }>> {
  const name = forgeName(setup.env);
  const setting = name.kind === "ok" ? identitySetting({ env: setup.env, forge: name.value }) : name;
  if (setting.kind === "failed") {
    return setting;
  }
  const now = setup.now ?? (() => Math.floor(Date.now() / 1000));
  const identity = await resolveIdentity({
    setting: setting.value,
    project: setup.env.FACTORY_PROJECT ?? "",
    run: setup.run ?? runProcess,
    env: setup.env,
    now: now(),
  });
  if (identity.kind === "failed") {
    return identity;
  }
  const forge = openForge({ ...setup, identity: identity.value });
  return forge.kind === "ok" ? { kind: "ok", value: { forge: forge.value, identity: identity.value } } : forge;
}

// the plugin a project file maps the forge to, or none: forge.read and forge.write must name the same one, since one
// Forge serves both
async function forgePluginOf(files: { readonly home: string; readonly project: string }): Promise<Result<string>> {
  const raw = await readProjectRaw(files, "");
  if (raw.kind !== "ok") {
    return raw.kind === "missing" ? { kind: "ok", value: "" } : raw;
  }
  const config = pluginConfigOf(raw.path, raw.value);
  return config.kind === "ok" ? oneForgePlugin(raw.path, config.value.plugins) : config;
}

function oneForgePlugin(path: string, plugins: ReadonlyMap<string, string>): Result<string> {
  const [read, write] = ["forge.read", "forge.write"].map((p) => plugins.get(p) ?? "");
  return read === write
    ? { kind: "ok", value: read ?? "" }
    : { kind: "failed", reason: `${path}: "connectors" must map forge.read and forge.write to the same connector` };
}

// pluginTarget : the forge plugin's target, under the own identity only: the App's token never reaches a plugin
// (ADR-0014 P11)
function pluginTarget(env: NodeJS.ProcessEnv, plugin: string, setup: Setup): Result<PluginTarget> {
  const name = forgeName(env);
  if (name.kind === "failed") {
    return name;
  }
  const setting = identitySetting({ env, forge: name.value });
  const own = setting.kind === "ok" ? ownOnly(setting.value, plugin) : setting;
  const plain = own.kind === "ok" ? plainSettings(env, name.value, plugin) : own;
  return plain.kind === "ok" ? targetFor(name.value, env, plugin, setup) : plain;
}

function ownOnly(setting: IdentitySetting, plugin: string): Done {
  return setting.kind === "app"
    ? {
        kind: "failed",
        reason: `the project maps the forge to the plugin ${plugin}, but FACTORY_IDENTITY=app gives gh the App's token, which no plugin may hold; use FACTORY_IDENTITY=own or unmap forge.read and forge.write`,
      }
    : { kind: "ok" };
}

// settings a forge plugin cannot honour, since it runs with only PATH, HOME and LANG: another CLI, a token, a host
const DROPPED = [
  "FACTORY_GH",
  "FACTORY_GLAB",
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "GH_ENTERPRISE_TOKEN",
  "GH_HOST",
  "GITLAB_TOKEN",
  "GITLAB_HOST",
];

function droppedSetting(env: NodeJS.ProcessEnv, forge: ForgeName): string | undefined {
  const set = DROPPED.find((name) => (env[name] ?? "") !== "");
  const host = settingOf(env, "gitHostName") ?? DEFAULT_HOST[forge];
  return set ?? (host === DEFAULT_HOST[forge] ? undefined : settingName("gitHostName"));
}

// plainSettings : the plugin serves the forge it is named for, on its default host, as the CLI's own login; a setting
// it would drop without a word is refused, so a write never goes to another forge, host or account
function plainSettings(env: NodeJS.ProcessEnv, forge: ForgeName, plugin: string): Done {
  if (plugin !== forge) {
    return {
      kind: "failed",
      reason: `FACTORY_FORGE is ${forge}, but the project maps the forge to the plugin ${plugin}`,
    };
  }
  const set = droppedSetting(env, forge);
  return set === undefined
    ? { kind: "ok" }
    : {
        kind: "failed",
        reason: `${set} is set, which the forge plugin cannot honour (it runs ${forge === "github" ? "gh" : "glab"} with its own login on ${DEFAULT_HOST[forge]}); unset it or unmap forge.read and forge.write`,
      };
}

function targetFor(forge: ForgeName, env: NodeJS.ProcessEnv, plugin: string, setup: Setup): Result<PluginTarget> {
  const project = env.FACTORY_PROJECT ?? "";
  const where = forge === "github" ? githubProject(project) : gitlabProject(project);
  return where.kind === "ok" ? { kind: "ok", value: { setup, plugin, forge, project } } : where;
}

export type ProjectFiles = {
  readonly home: string;
  // the factory's name for the project: its file is <home>/projects/<project>.json
  readonly project: string;
  // what a plugin runs with (the trusted PATH)
  readonly plugins: Setup;
};

// openProjectForge : the project's forge: the forge plugin its project file maps forge.read and forge.write to, or the
// built-in adapter when it maps none (#134 PR C), with FACTORY_DRY_RUN applied either way
export async function openProjectForge(
  setup: Omit<ForgeSetup, "identity">,
  files: ProjectFiles,
): Promise<Result<{ readonly forge: Forge; readonly identity: Identity }>> {
  const plugin = await forgePluginOf(files);
  if (plugin.kind === "failed") {
    return plugin;
  }
  return plugin.value === "" ? openProject(setup) : servedBy(setup, plugin.value, files.plugins);
}

function servedBy(
  setup: Omit<ForgeSetup, "identity">,
  plugin: string,
  plugins: Setup,
): Result<{ readonly forge: Forge; readonly identity: Identity }> {
  const target = pluginTarget(setup.env, plugin, plugins);
  const identity: Identity = { kind: "own" };
  const forge = target.kind === "ok" ? settled({ ...setup, identity }, pluginForge(target.value)) : target;
  return forge.kind === "ok" ? { kind: "ok", value: { forge: forge.value, identity } } : forge;
}
