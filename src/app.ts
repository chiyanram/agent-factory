// app — the command line, as a function: runCli(argv, io) returns the exit code and writes only through io, so a test
// can run every command. src/cli.ts only binds it to the process (#101). A UI replaces only these two files.

import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, join } from "node:path";
import { homedir, userInfo } from "node:os";
import { DEFAULT_CLAIM_LABEL, format, poll as pollForge } from "./core/poll.js";
import { openProject } from "./core/forge/index.js";
import { checkSpec, readSpec, template } from "./core/spec.js";
import { approvalState, approve } from "./core/approval.js";
import { hostGit } from "./core/git.js";
import type { Runner as CliRunner } from "./core/forge/api.js";
import { chooseBox } from "./core/box/index.js";
import {
  claudeTokenStatus,
  openStore,
  saveClaudeToken,
  type Age,
  type Meta,
  type Status,
  type TokenStore,
} from "./core/token/index.js";
import { mint, readAppConfig, realHttp } from "./core/app-token.js";

const HELP = `usage: agent-factory <command>

commands:
  poll                         one line of facts per open change, read from the forge
  spec <project> <ticket>      check a ticket's local spec: its hash, or what it is missing
  spec --template <ticket>     print an empty spec to fill in
  approve <project> <ticket> <hash>
                               record the human's approval of the spec with exactly that hash (all 64 characters,
                               as spec printed it); run it only behind the harness ask prompt, never from an allow list
  approval <project> <ticket>  whether work may start: approved (0), stale (3), missing (4), refused (1)
  app-token <owner/name>       run as the factory user only, through its one sudo rule: a GitHub App token for that
                               repository, as JSON {token, login, expiresAt}
  setup claude                 store the box's model-only token: run claude setup-token first, then paste it
                               at the hidden prompt; it is never printed (#136)
  setup status                 the box chosen, its risks, and whether the claude token is valid

options:
  --help      show this help
  --version   show the package version
  --json      poll: print the parsed records as JSON

settings:
  FACTORY_HOME         where specs and approvals live (default ~/.factory): <home>/specs/<project>/<ticket>/spec.md
  FACTORY_FORGE        gitlab (default) or github
  FACTORY_PROJECT      the project: owner/name on GitHub, the full path on GitLab
  FACTORY_CLAIM_LABEL  the label a claimed change carries (default agent::claimed)
  FACTORY_GH           the gh to call (default gh); FACTORY_GLAB the glab to call (default glab)
  FACTORY_IDENTITY     own (default: your gh or glab login) or app (a GitHub App whose key the factory user holds)
`;

type Args = {
  readonly json: boolean;
  readonly template: boolean;
  readonly positionals: readonly string[];
  readonly io: Io;
};

export type Io = {
  readonly env: NodeJS.ProcessEnv;
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
  // a pasted secret, never shown: echo off on a terminal (src/core/token/prompt.ts)
  readonly readSecret: (prompt: string) => Promise<string>;
  // the machine setup stores tokens on; a test passes linux and its own uid, so it never touches a Keychain
  readonly system: { readonly platform: NodeJS.Platform; readonly uid: number; readonly run: CliRunner };
};

type Home = { readonly kind: "home"; readonly path: string } | { readonly kind: "refused"; readonly reason: string };

// factoryHome : where specs and approvals live. An empty or relative FACTORY_HOME is refused, never read as the
// current folder, which the coordinator may be able to write.
function factoryHome(env: NodeJS.ProcessEnv): Home {
  const set = env.FACTORY_HOME;
  if (set === undefined) {
    return { kind: "home", path: join(homedir(), ".factory") };
  }
  return isAbsolute(set)
    ? { kind: "home", path: set }
    : { kind: "refused", reason: `FACTORY_HOME must be an absolute path, got ${JSON.stringify(set)}` };
}

function version(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")) as { version: string };
  return pkg.version;
}

async function poll({ json, io }: Args): Promise<number> {
  const label = io.env.FACTORY_CLAIM_LABEL ?? DEFAULT_CLAIM_LABEL;
  if (label.trim() === "") {
    io.err("agent-factory poll: FACTORY_CLAIM_LABEL is set but empty\n");
    return 1;
  }
  const opened = await openProject({ env: io.env, log: (line) => io.err(`${line}\n`) });
  if (opened.kind === "failed") {
    io.err(`agent-factory poll: ${opened.reason}\n`);
    return 1;
  }
  const forge = opened.value.forge;
  const result = await pollForge({ forge, label });
  if (result.kind === "failed") {
    io.err(`agent-factory poll: ${result.reason}\n`);
    return 1;
  }
  const mark = forge.mark;
  const out = result.value.map((line) => (json ? JSON.stringify(line) : format({ line, mark })));
  io.out(out.map((line) => `${line}\n`).join(""));
  return 0;
}

// spec : one line "spec <project>/<ticket> <hash> <path>" for a spec that follows the template (exit 0); its problems
// (exit 2); or why it cannot be read (exit 1). The hash is what `approve` (#104) asks the human to confirm.
async function spec({ template: wantTemplate, positionals, io }: Args): Promise<number> {
  if (wantTemplate) {
    const [ticket] = positionals;
    if (ticket === undefined) {
      io.err("usage: agent-factory spec --template <ticket>\n");
      return 64;
    }
    io.out(template(ticket));
    return 0;
  }
  const [project, ticket] = positionals;
  if (project === undefined || ticket === undefined) {
    io.err("usage: agent-factory spec <project> <ticket>\n");
    return 64;
  }
  const home = factoryHome(io.env);
  if (home.kind === "refused") {
    io.err(`agent-factory spec: ${home.reason}\n`);
    return 1;
  }
  const read = await readSpec({ store: { kind: "local", root: join(home.path, "specs") }, project, ticket });
  switch (read.kind) {
    case "refused":
      io.err(`agent-factory spec: ${read.reason}\n`);
      return 1;
    case "missing":
      io.err(`agent-factory spec: no spec at ${read.where}; start one with: agent-factory spec --template ${ticket}\n`);
      return 1;
    case "found": {
      const checked = checkSpec(read.text);
      if (checked.kind === "invalid") {
        io.err(
          `agent-factory spec: ${read.where} is not ready:\n${checked.problems.map((p) => `  - ${p}\n`).join("")}`,
        );
        return 2;
      }
      io.out(`spec ${project}/${ticket} ${checked.spec.hash} ${read.where}\n`);
      return 0;
    }
  }
}

// whoApproves : the OS user and, when set, the operator's own git user.name. A record, not proof: the harness prompt is
// the gate.
async function whoApproves(env: NodeJS.ProcessEnv): Promise<string> {
  const name = await hostGit({
    args: ["config", "--get", "user.name"],
    repo: { kind: "none" },
    env,
    ownHelper: { kind: "none" },
    stdin: { kind: "none" },
  });
  const gitName = name.kind === "ok" ? name.stdout.trim() : "";
  return gitName.length > 0 ? `${userInfo().username} (${gitName})` : userInfo().username;
}

async function approveCommand({ positionals, io }: Args): Promise<number> {
  const [project, ticket, hash] = positionals;
  if (project === undefined || ticket === undefined || hash === undefined) {
    io.err("usage: agent-factory approve <project> <ticket> <the full spec hash that agent-factory spec printed>\n");
    return 64;
  }
  const home = factoryHome(io.env);
  if (home.kind === "refused") {
    io.err(`agent-factory approve: refused: ${home.reason}\n`);
    return 1;
  }
  const result = await approve({
    where: { home: home.path, project, ticket },
    seenHash: hash,
    by: await whoApproves(io.env),
    at: new Date().toISOString(),
  });
  if (result.kind === "refused") {
    io.err(`agent-factory approve: refused: ${result.reason}\n`);
    return 1;
  }
  const r = result.record;
  io.out(`approved ${project}/${ticket} spec ${r.spec_hash} by ${r.by} at ${r.at}\n`);
  return 0;
}

async function approvalCommand({ positionals, io }: Args): Promise<number> {
  const [project, ticket] = positionals;
  if (project === undefined || ticket === undefined) {
    io.err("usage: agent-factory approval <project> <ticket>\n");
    return 64;
  }
  const home = factoryHome(io.env);
  const state = home.kind === "home" ? await approvalState({ home: home.path, project, ticket }) : home;
  switch (state.kind) {
    case "approved":
      io.out(
        `approved ${project}/${ticket} spec ${state.record.spec_hash} by ${state.record.by} at ${state.record.at}\n`,
      );
      return 0;
    case "stale":
      io.out(
        `stale ${project}/${ticket}: approved spec ${state.approvedHash}, now ${state.currentHash}; approve again\n`,
      );
      return 3;
    case "missing":
      io.out(`missing ${project}/${ticket}: not approved\n`);
      return 4;
    case "refused":
      io.err(`agent-factory approval: refused: ${state.reason}\n`);
      return 1;
  }
}

type Command = { readonly name: string; readonly run: (args: Args) => Promise<number> };

// app-token : run as the factory user, which alone can read the App's key (#108). It prints the token on stdout for the
// developer's host process that called it through sudo; nothing else is printed there.
async function appTokenCommand({ positionals, io }: Args): Promise<number> {
  const [project] = positionals;
  if (project === undefined || positionals.length !== 1) {
    io.err("usage: agent-factory app-token <owner/name>\n");
    return 64;
  }
  const me = userInfo();
  const config = await readAppConfig({ home: me.homedir, me: { uid: me.uid } });
  const minted =
    config.kind === "ok"
      ? await mint({
          config: config.value,
          project,
          http: realHttp,
          now: Math.floor(Date.now() / 1000),
          cacheDir: join(me.homedir, ".cache", "agent-factory"),
        })
      : config;
  if (minted.kind === "failed") {
    io.err(`agent-factory app-token: ${minted.reason}\n`);
    return 1;
  }
  io.out(`${JSON.stringify(minted.value)}\n`);
  return 0;
}

type SetupStep = {
  readonly name: string;
  readonly run: (input: { readonly store: TokenStore; readonly io: Io }) => Promise<number>;
};

const PASTE = "Paste the token that `claude setup-token` printed (it stays hidden), then Enter: ";

async function setupClaude({ store, io }: { readonly store: TokenStore; readonly io: Io }): Promise<number> {
  const saved = await saveClaudeToken({ store, pasted: await io.readSecret(PASTE), now: new Date() });
  if (saved.kind === "refused") {
    io.err(`agent-factory setup claude: ${saved.reason}\n`);
    return 1;
  }
  io.out(`stored the claude token in ${saved.where}; made ${saved.meta.madeAt}, expires ${saved.meta.expiresAt}\n`);
  return 0;
}

const RENEW = "renew it: claude setup-token, then agent-factory setup claude";

function ageLine(age: Age, meta: Meta): { readonly line: string; readonly ok: boolean } {
  switch (age.kind) {
    case "valid":
      return { line: `claude token: valid, ${age.daysLeft} days left (expires ${meta.expiresAt})`, ok: true };
    case "expiring":
      return { line: `claude token: expires in ${age.daysLeft} days (${meta.expiresAt}); ${RENEW}`, ok: true };
    case "expired":
      return { line: `claude token: expired at ${age.since}; ${RENEW}`, ok: false };
    case "unknown":
      return { line: `claude token: unknown age: ${age.reason}`, ok: false };
  }
}

// tokenLine : one line on the claude token, and whether a box may start with it
function tokenLine(status: Status): { readonly line: string; readonly ok: boolean } {
  return status.kind === "none"
    ? { line: `claude token: none: ${status.reason}`, ok: false }
    : ageLine(status.age, status.meta);
}

async function setupStatus({ store, io }: { readonly store: TokenStore; readonly io: Io }): Promise<number> {
  const box = chooseBox(io.env);
  const boxLines =
    box.kind === "chosen"
      ? [`box: ${box.place}`, ...box.risks.map((r) => `  risk: ${r}`)]
      : [`box: refused: ${box.reason}`];
  const token = tokenLine(await claudeTokenStatus({ store, now: new Date() }));
  io.out([...boxLines, token.line].map((l) => `${l}\n`).join(""));
  return box.kind === "chosen" && token.ok ? 0 : 1;
}

const SETUP: readonly SetupStep[] = [
  { name: "claude", run: setupClaude },
  { name: "status", run: setupStatus },
];

// setup : make and keep the box's model-only token (#136), and say whether a box may start
async function setupCommand({ positionals, io }: Args): Promise<number> {
  const step = SETUP.find((s) => s.name === positionals[0]);
  if (step === undefined) {
    io.err("usage: agent-factory setup claude | status\n");
    return 64;
  }
  const home = factoryHome(io.env);
  const store =
    home.kind === "home"
      ? openStore({
          platform: io.system.platform,
          home: home.path,
          owner: { uid: io.system.uid },
          run: io.system.run,
          env: io.env,
        })
      : home;
  if (store.kind === "refused") {
    io.err(`agent-factory setup: ${store.reason}\n`);
    return 1;
  }
  return step.run({ store: store.store, io });
}

const COMMANDS: readonly Command[] = [
  { name: "poll", run: poll },
  { name: "spec", run: spec },
  { name: "approve", run: approveCommand },
  { name: "approval", run: approvalCommand },
  { name: "app-token", run: appTokenCommand },
  { name: "setup", run: setupCommand },
];

export async function runCli(argv: readonly string[], io: Io): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      help: { type: "boolean" },
      version: { type: "boolean" },
      json: { type: "boolean" },
      template: { type: "boolean" },
    },
  });
  if (values.version === true) {
    io.out(`${version()}\n`);
    return 0;
  }
  const command = COMMANDS.find((c) => c.name === positionals[0]);
  if (values.help === true || command === undefined) {
    io.out(HELP);
    return values.help === true ? 0 : 64;
  }
  return command.run({
    json: values.json === true,
    template: values.template === true,
    positionals: positionals.slice(1),
    io,
  });
}
