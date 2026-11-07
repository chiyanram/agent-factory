// forge — open the forge seam for one project from its settings (ADR-0010, ADR-0012 S14).
//
//   FACTORY_FORGE      gitlab (default) or github
//   FACTORY_PROJECT    the project: owner/name on GitHub, the full path on GitLab (for example aruvii/agent-platform)
//   FACTORY_GH         the gh the factory acts through (default: scripts/bin/gh, which mints the GitHub App's token,
//                      the same default as the bash scripts until #108 moves both to the developer's own login, S14).
//                      An App has no user to ask, so with it set FACTORY_LOGIN to <app-slug>[bot].
//   FACTORY_GLAB       the glab the factory acts through (default: glab)
//   FACTORY_LOGIN      the login the factory posts as, when the CLI cannot say (a GitHub App: <app-slug>[bot])
//   FACTORY_MAX_TRIES  calls per request while the forge answers with a rate limit (default: 4)
//   FACTORY_DRY_RUN    1: every write is printed instead of made; reads still go to the forge (ADR-0011 D14)
//
// No setting is guessed: a value that is set but not valid is refused, never replaced by the default.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { realSleep, runProcess, type Client, type Result, type Runner, type Sleeper } from "./api.js";
import { github } from "./github.js";
import { gitlab } from "./gitlab.js";
import type { Forge } from "./types.js";

export type { Forge } from "./types.js";

export type ForgeSetup = {
  readonly env: NodeJS.ProcessEnv;
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
  return /^[1-9]\d{0,2}$/.test(value) ? { kind: "ok", value: Number(value) } : { kind: "failed", reason: `FACTORY_MAX_TRIES must be a whole number from 1, got ${JSON.stringify(value)}` };
}

// the App's gh wrapper in this package: src/core/forge or dist/core/forge, three folders below the package root
export function appGh(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "scripts", "bin", "gh");
}

function client(setup: ForgeSetup, name: "github" | "gitlab", tries: number): Client {
  const bin = name === "github" ? setup.env.FACTORY_GH ?? appGh() : setup.env.FACTORY_GLAB ?? "glab";
  return {
    name,
    bin,
    // no update notice, no prompt: an unattended call must answer or fail
    env: { ...setup.env, GH_NO_UPDATE_NOTIFIER: "1", GH_PROMPT_DISABLED: "1", GLAB_CHECK_UPDATE: "false" },
    run: setup.run ?? runProcess,
    sleep: setup.sleep ?? realSleep,
    maxTries: tries,
    now: setup.now ?? (() => Math.floor(Date.now() / 1000)),
  };
}

function adapter(setup: ForgeSetup, tries: number): Result<Forge> {
  const project = setup.env.FACTORY_PROJECT ?? "";
  const kind = setup.env.FACTORY_FORGE ?? "gitlab";
  if (kind === "github") {
    const parts = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(project);
    return parts === null
      ? { kind: "failed", reason: `FACTORY_PROJECT must be owner/name (for example chiyanram/ledger), got ${JSON.stringify(project)}` }
      : { kind: "ok", value: github(client(setup, "github", tries), { owner: parts[1]!, name: parts[2]! }) };
  }
  if (kind === "gitlab") {
    return /^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)+$/.test(project)
      ? { kind: "ok", value: gitlab(client(setup, "gitlab", tries), project) }
      : { kind: "failed", reason: `FACTORY_PROJECT must be the project's full path (for example aruvii/agent-platform), got ${JSON.stringify(project)}` };
  }
  return { kind: "failed", reason: `FACTORY_FORGE must be gitlab or github, got ${JSON.stringify(kind)}` };
}

// withLogin : FACTORY_LOGIN, when set, answers me() without asking the forge.
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
    lineFinding: async (i) => (log(`DRY RUN: finding on ${m}${i.change.number} at ${i.at.file}:${i.at.line}`), { kind: "ok" }),
  };
}

function login(value: string | undefined): Result<string | "cli"> {
  if (value === undefined) {
    return { kind: "ok", value: "cli" };
  }
  return /^[A-Za-z0-9][A-Za-z0-9_.\-[\]]*$/.test(value) ? { kind: "ok", value } : { kind: "failed", reason: `FACTORY_LOGIN must be a login, got ${JSON.stringify(value)}` };
}

function dryRunSetting(value: string | undefined): Result<boolean> {
  const dry = value ?? "";
  return ["", "0", "1"].includes(dry) ? { kind: "ok", value: dry === "1" } : { kind: "failed", reason: `FACTORY_DRY_RUN must be 1 or 0, got ${JSON.stringify(dry)}` };
}

// settled : the adapter with FACTORY_LOGIN and FACTORY_DRY_RUN applied.
function settled(setup: ForgeSetup, forge: Forge): Result<Forge> {
  const who = login(setup.env.FACTORY_LOGIN);
  if (who.kind === "failed") {
    return who;
  }
  const dry = dryRunSetting(setup.env.FACTORY_DRY_RUN);
  if (dry.kind === "failed") {
    return dry;
  }
  const named = who.value === "cli" ? forge : withLogin(forge, who.value);
  return { kind: "ok", value: dry.value ? dryRun(named, setup.log) : named };
}

export function openForge(setup: ForgeSetup): Result<Forge> {
  const tries = maxTries(setup.env.FACTORY_MAX_TRIES);
  if (tries.kind === "failed") {
    return tries;
  }
  const opened = adapter(setup, tries.value);
  return opened.kind === "ok" ? settled(setup, opened.value) : opened;
}
