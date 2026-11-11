// app — the command line, as a function: runCli(argv, io) returns the exit code and writes only through io, so a test
// can run every command. src/cli.ts only binds it to the process (#101). A UI replaces only these two files.

import { parseArgs } from "node:util";
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, join } from "node:path";
import { homedir, userInfo } from "node:os";
import { DEFAULT_CLAIM_LABEL, format, poll as pollForge } from "./core/poll.js";
import { openProject, openProjectForge } from "./core/forge/index.js";
import type { Forge } from "./core/forge/types.js";
import { checkSpec, designHash, plainName, readSpec, template, type Refused, type SpecStore } from "./core/spec.js";
import { issuesFrom, openOnce, specStoreOf } from "./core/spec-store.js";
import { approvalState, approve } from "./core/approval.js";
import { start } from "./core/start.js";
import { readWaiver, waive } from "./core/waiver.js";
import { hostGit } from "./core/git.js";
import type { Runner as CliRunner, Result } from "./core/forge/api.js";
import { buildBox, chooseBox, hostDocker, srtBox, vmBox, type BoxChoice, type Built } from "./core/box/index.js";
import { npmPacker } from "./core/box/pack.js";
import { locatePrograms } from "./core/box/srt-programs.js";
import { locateToolchains, toolchainLines } from "./core/box/srt-toolchains.js";
import { openEgress } from "./core/egress/index.js";
import {
  claudeTokenStatus,
  openStore,
  saveClaudeToken,
  saveDiscordWebhook,
  type Age,
  type Meta,
  type Status,
  type TokenStore,
} from "./core/token/index.js";
import { mint, readAppConfig, realHttp } from "./core/app-token.js";
import { runHoursEnd, STEPS_TODAY, tick, type Steps, type TickSetup } from "./core/dispatch/tick.js";
import { loopFile, loopRunning, orchestratorLoop } from "./core/dispatch/orchestrator-loop.js";
import type { Gate } from "./core/dispatch/table.js";
import { DEFAULT_POLL_MINUTES } from "./core/dispatch/last-poll.js";
import { reviewRound, type Outcome } from "./core/review/round.js";
import { paths, reviewSetup, type Paths } from "./core/review/settings.js";
import { reviewStep } from "./core/review/step.js";
import { boxPlan, type PlanRead } from "./core/ready/plan.js";
import type { Identity } from "./core/identity.js";
import { writerSetup } from "./core/writer/setup.js";
import { hostPush } from "./core/push.js";
import { writerStep } from "./core/writer/step.js";
import { hashesOf, runPlugins, type PluginHash } from "./core/process/use.js";
import { readProcess, type PluginDir } from "./core/process/read.js";
import type { LaneProps } from "./core/lane.js";
import { readyPrograms, readyStep, verifyStep, type BoxPlan } from "./core/ready/steps.js";
import { designSteps } from "./core/design/step.js";
import { designSetup } from "./core/design/settings.js";
import { countsLine } from "./core/review/verdicts.js";
import { LOOP_COMMANDS, LOOP_HELP, lintEditCommand, loopUsage, projectForm, projectWord } from "./loop-cli.js";
import { chosenProject, DEFAULT_PROJECT, projectNames } from "./core/which-project.js";
import { pluginCommand, pluginSetup } from "./plugin-cli.js";
import { dryNotify, NO_NOTIFY, notifyPluginOf, pluginNotify, webhookSecrets, type Notify } from "./core/notify.js";
import { REQUEST_COMMANDS, REQUEST_HELP } from "./request-cli.js";
import { EVAL_HELP, evalCommand } from "./eval-cli.js";
import { EGRESS_HELP, egressCommand } from "./egress-cli.js";
import type { CoordinatorPlaces } from "./core/coordinator.js";
import { checkWall, installCoordinator, startCoordinator, type Interactive } from "./coordinator-cli.js";
import { configCommand, teamCommand, type SettingsIo } from "./settings-cli.js";
import { runSettings } from "./core/project.js";
import { settingName, settingOf } from "./core/settings/machine.js";
import type { MachineId } from "./core/settings/keys.js";
import { USAGE_HELP, usageCommand } from "./usage-cli.js";
import { INIT_HELP, initCommand, KNOWN_MARKETS } from "./init-cli.js";
import type { Probes } from "./core/init/checks.js";
import { which } from "./core/box/srt-programs.js";
import { ONBOARD_HELP, onboardCommand } from "./onboard-cli.js";
import { onboardSetup } from "./core/onboard/settings.js";
import { versionCheck } from "./core/init/latest.js";
import { capsOf, type Caps } from "./core/dispatch/caps.js";

const HELP = `usage: agent-factory <command>

commands:
  poll                         one line of facts per open change, read from the forge
  spec <project> <ticket>      check a ticket's local spec: its hash, or what it is missing
  spec --template <ticket>     print an empty spec to fill in
  start <project> <ticket> [--yes] [--no-loop]
                               a human's START: open the ticket (in the tiny lane it also lets the build begin); asks
                               first, exit 3, when factory/<ticket> is already on the git host; --yes is the answer.
                               It starts the orchestrator loop in the background when none runs (--no-loop: not).
                               A human runs it; the coordinator's settings deny it
  approve <project> <ticket> <hash> [<design hash>] [--no-loop]
                               record the human's approval of the spec and the design with exactly those hashes (all 64
                               characters, as spec printed them; no design hash is none), and start the orchestrator
                               loop in the background when none runs (--no-loop: not). A human runs it; the
                               coordinator's settings deny it
  waive <project> <ticket> <head>
                               record the human's waiver of the test checks at that head (the full commit id the
                               hits were listed at): the ready check clears them, and flags a cleared file again only
                               if a later head changes it. A human runs it; the coordinator's settings deny it
  approval <project> <ticket>  whether work may start: approved (0), stale (3), missing (4), refused (1)
  review <project> <number>    one review round on a claimed change: pack, find, verify, threads, status box, summary;
                               the contract is the approved spec of the ticket its factory/<ticket> branch names;
                               exit 0 posted or reused, 3 when the head moved, 1 otherwise
  dispatch <project> [--once]  the orchestrator loop over the project's started and approved tickets and their PRs:
                               a pass decides each with the table and acts, then waits FACTORY_POLL_MINUTES while a
                               ticket is in flight, and ends by itself when none is, or when a cap or a step not set
                               up holds every run back (it says why and when to run it again); --once: one pass
                               (--dry-run: one pass that decides and acts on none). It refuses to start while the
                               coordinator's settings are looser than its wall, and while another loop runs for the
                               project
  app-token <owner/name>       run as the factory user only, through its one sudo rule: a GitHub App token for that
                               repository, as JSON {token, login, expiresAt}
  setup claude                 store the box's model-only token: run claude setup-token first, then paste it
                               at the hidden prompt; it is never printed (#136)
  setup discord                store the Discord webhook the dispatcher pings through, at a hidden prompt (#119)
  setup status                 the box chosen, its risks, and whether the claude token is valid
  setup coordinator            write the coordinator's settings (its wall, read-only) and instructions into
                               <home>/coordinator
  coordinator [<project>] [copilot]
                               start the coordinator's session there, with only those settings (#106), for the
                               project named, else the one in <home>/projects: its commands act on it when they name
                               none, so it needs no FACTORY_* export (#382)
  plugin add <path|name>       register a plugin: run its describe, record its absolute path and sha256 (#134)
  plugin update <name> [<sha>] test a new version and show its hash and new writes; record it with that hash
  plugin update <project> <name@marketplace> [<commit>]
                               fetch a listed plugin, show the change, run config check, then move its pin (#232)
  plugin test <path|name>      the contract test kit: handshake, fixtures, bad input, unknown op, stdout, env, tokens
  plugin list                  the registered plugins
  config show <project>        every settings key: its value, layer, file:line and class (--json: as JSON)
  config check <project>       resolve the team, project, user and machine layers and check them: exit 0 or 1 (#229)
  team update <project> [<commit>]
                               show what the team's new commit changes, check it, then move the project's pin
${USAGE_HELP}${ONBOARD_HELP}${REQUEST_HELP}  box build <project>          build the box image on this host (the base, then <home>/projects/<project>/box.Dockerfile
                               if there is one) and pin its ID in <home>/projects/<project>/box.json; run it again
                               after an upgrade
${INIT_HELP}${LOOP_HELP}${EVAL_HELP}${EGRESS_HELP}
options:
  --help      show this help
  --version   show the package version
  --json      poll: print the parsed records as JSON

settings:
  FACTORY_QUIET_MINUTES  dispatch: how long an open question may sit before the claim is released (default 30)
  FACTORY_QUESTIONS    dispatch: round asks every open question at once, with choices (default); or one-at-a-time
  FACTORY_POLL_MINUTES   dispatch: the wait between the loop's passes; status flags a loop late after 3 (default 5)
  FACTORY_HOME         where specs and approvals live (default ~/.factory): <home>/specs/<project>/<ticket>/spec.md
  FACTORY_FORGE        gitlab (default) or github; the project file's gitHost
  FACTORY_PROJECT      the project: owner/name on GitHub, the full path on GitLab; the project file's gitHostProject
  FACTORY_CLAIM_LABEL  the label a claimed change carries (default agent::claimed)
  FACTORY_GH           the gh to call (default gh); FACTORY_GLAB the glab to call (default glab)
  FACTORY_IDENTITY     own (default: your gh or glab login) or app (a GitHub App whose key the factory user holds)
  FACTORY_BOX          where a box runs: vm (Docker with Sysbox on this host)
  FACTORY_REPO         the project's clone on this host, an absolute path; the project file's clone
  FACTORY_DEFAULT_PROJECT  the project a command that names none acts on; agent-factory coordinator sets it (#382)
  FACTORY_EGRESS_IMAGE   the egress proxy's Squid image, name@sha256:<digest> (default: a pinned ubuntu/squid)
  FACTORY_UPSTREAM_PROXY at work: the corporate proxy, host:port, every box request leaves through
`;

type Args = {
  readonly json: boolean;
  readonly template: boolean;
  readonly once: boolean;
  readonly dryRun: boolean;
  readonly yes: boolean;
  readonly noLoop: boolean;
  // init: the product clone to read (default: the current folder)
  readonly repo: string | undefined;
  readonly positionals: readonly string[];
  readonly io: Io;
};

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

// usage : the spend table (#131), with the project's settings layers resolved when it names one
function usage({ positionals, io }: Args): Promise<number> {
  const [project] = positionals;
  return resolvedRun("usage", project, io, (resolved) => {
    const home = factoryHome(resolved.env);
    if (home.kind === "refused") {
      io.err(`agent-factory usage: ${home.reason}\n`);
      return Promise.resolve(1);
    }
    return usageCommand(positionals, { ...resolved, home: home.path, now: Date.now });
  });
}

// onboard : the onboarder's run, or a human's acceptance of what it staged (#235), with the project's settings resolved
function onboardCli({ positionals, io }: Args): Promise<number> {
  const project = positionals[0] === "accept" ? positionals[1] : positionals[0];
  return resolvedRun("onboard", project, io, (resolved) => {
    const home = factoryHome(resolved.env);
    if (home.kind === "refused") {
      io.err(`agent-factory onboard: ${home.reason}\n`);
      return Promise.resolve(1);
    }
    return onboardCommand(positionals, {
      home: home.path,
      out: io.out,
      err: io.err,
      now: Date.now,
      by: () => whoApproves(resolved.env),
      setup: async (name) => {
        const opened = await openProjectForge(
          { env: resolved.env, log: (line) => io.err(`${line}\n`) },
          { home: home.path, project: name, plugins: await pluginSetup(home.path, resolved.env) },
        );
        if (opened.kind === "failed") {
          return opened;
        }
        const used = await runPlugins({ home: home.path, project: name, env: resolved.env });
        if (used.kind === "failed") {
          return used;
        }
        io.err(used.value.warnings.map((w) => `warning: ${w}\n`).join(""));
        return onboardSetup({
          env: resolved.env,
          forge: opened.value.forge,
          home: home.path,
          project: name,
          now: Date.now,
          plugins: used.value.plugins,
        });
      },
    });
  });
}

// poll [<project>] : the project's changes; with no project named, the one in the factory home (#382)
function poll(args: Args): Promise<number> {
  if (args.positionals.length > 1) {
    args.io.err("usage: agent-factory poll [<project>] [--json]\n");
    return Promise.resolve(64);
  }
  return projectRun("poll", args.positionals[0], args.io, "agent-factory poll <project>", (io) =>
    pollResolved({ ...args, io }),
  );
}

async function pollResolved({ json, io }: Args): Promise<number> {
  const label = settingOf(io.env, "claimLabel") ?? DEFAULT_CLAIM_LABEL;
  if (label.trim() === "") {
    io.err(`agent-factory poll: ${settingName("claimLabel")} is set but empty\n`);
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
  return wantTemplate ? specTemplate(positionals, io) : specOf(positionals, io);
}

function specTemplate(positionals: readonly string[], io: Io): Promise<number> {
  const [ticket] = positionals;
  if (ticket === undefined) {
    io.err("usage: agent-factory spec --template <ticket>\n");
    return Promise.resolve(64);
  }
  io.out(template(ticket));
  return Promise.resolve(0);
}

async function specOf(positionals: readonly string[], io: Io): Promise<number> {
  const [project, ticket] = positionals;
  if (project === undefined || ticket === undefined) {
    io.err("usage: agent-factory spec <project> <ticket>\n");
    return 64;
  }
  if (!plainName(project) || !plainName(ticket)) {
    io.err(
      `agent-factory spec: a project and a ticket must be plain names, got ${JSON.stringify(project)} ${JSON.stringify(ticket)}\n`,
    );
    return 1;
  }
  return resolvedRun("spec", project, io, (resolved) => specResolved(resolved, project, ticket));
}

async function specResolved(io: Io, project: string, ticket: string): Promise<number> {
  const at = specsAt(io, project, ticket);
  if (at.kind === "refused") {
    io.err(`agent-factory spec: ${at.reason}\n`);
    return 1;
  }
  const read = await readSpec(at.where);
  switch (read.kind) {
    case "refused":
      io.err(`agent-factory spec: ${read.reason}\n`);
      return 1;
    case "missing":
      io.err(`agent-factory spec: no spec at ${read.where}; ${startOne(at.where.store, ticket)}\n`);
      return 1;
    case "found":
      return specFound(io, at.where, read);
  }
}

function startOne(store: SpecStore, ticket: string): string {
  return store.kind === "local"
    ? `start one with: agent-factory spec --template ${ticket}`
    : `write the spec in the issue's body; agent-factory spec --template ${ticket} prints the template`;
}

type SpecWhere = {
  readonly home: string;
  readonly store: SpecStore;
  readonly project: string;
  readonly ticket: string;
};

// specsAt : where the ticket's spec is read: the project's spec store from its resolved settings (#381); the git host
// is opened only when the issue store reads an issue
function specsAt(
  io: Io,
  project: string,
  ticket: string,
): { readonly kind: "at"; readonly where: SpecWhere } | Refused {
  const home = factoryHome(io.env);
  if (home.kind === "refused") {
    return home;
  }
  const store = specStoreOf({ env: io.env, home: home.path, open: openOnce(() => issuesOf(io, home.path, project)) });
  return store.kind === "ok"
    ? { kind: "at", where: { home: home.path, store: store.value, project, ticket } }
    : { kind: "refused", reason: store.reason };
}

// issuesOf : the project's forge, for the issue store
async function issuesOf(io: Io, home: string, project: string): Promise<Result<Forge>> {
  const opened = await openProjectForge(
    { env: io.env, log: (line) => io.err(`${line}\n`) },
    { home, project, plugins: await pluginSetup(home, io.env) },
  );
  return opened.kind === "ok" ? { kind: "ok", value: opened.value.forge } : opened;
}

// specFound : the spec's hash and its design's (#227), or what the spec is missing
async function specFound(
  io: Io,
  at: SpecWhere,
  read: { readonly text: string; readonly where: string },
): Promise<number> {
  const checked = checkSpec(read.text);
  if (checked.kind === "invalid") {
    io.err(`agent-factory spec: ${read.where} is not ready:\n${checked.problems.map((p) => `  - ${p}\n`).join("")}`);
    return 2;
  }
  const design = await designHash(at);
  if (design.kind === "refused") {
    io.err(`agent-factory spec: ${design.reason}\n`);
    return 1;
  }
  io.out(`spec ${at.project}/${at.ticket} ${checked.spec.hash} ${read.where}\ndesign ${design.hash}\n`);
  return 0;
}

// whoApproves : the OS user and, when set, the operator's own git user.name. A record, not proof: the harness prompt is
// the gate.
async function whoApproves(env: NodeJS.ProcessEnv): Promise<string> {
  const name = await hostGit({
    args: ["config", "--get", "user.name"],
    repo: { kind: "none" },
    env,
    stdin: { kind: "none" },
  });
  const gitName = name.kind === "ok" ? name.stdout.trim() : "";
  return gitName.length > 0 ? `${userInfo().username} (${gitName})` : userInfo().username;
}

// branchOnHost : whether factory/<ticket> is already on the git host, through the project's forge seam
async function branchOnHost(io: Io, home: string, project: string, ticket: string): Promise<Result<boolean>> {
  const opened = await openProjectForge(
    { env: io.env, log: (line) => io.err(`${line}\n`) },
    { home, project, plugins: await pluginSetup(home, io.env) },
  );
  return opened.kind === "ok" ? opened.value.forge.branchExists({ branch: `factory/${ticket}` }) : opened;
}

type TicketArgs = { readonly project: string; readonly ticket: string };

function startTarget(positionals: readonly string[]): TicketArgs | "bad" {
  const [project, ticket] = positionals.length === 2 ? positionals : [];
  return [project, ticket].every((n) => n !== undefined && plainName(n))
    ? { project: String(project), ticket: String(ticket) }
    : "bad";
}

// branchAt : whether factory/<ticket> is on the git host, with the factory home it was asked from
async function branchAt(
  io: Io,
  target: TicketArgs,
): Promise<Result<{ readonly home: string; readonly there: boolean }>> {
  const home = factoryHome(io.env);
  if (home.kind === "refused") {
    return { kind: "failed", reason: home.reason };
  }
  const there = await branchOnHost(io, home.path, target.project, target.ticket);
  return there.kind === "ok" ? { kind: "ok", value: { home: home.path, there: there.value } } : there;
}

// start : a human's START at the terminal (#227). It asks first, exit 3, when the ticket's branch is on the git host.
async function startCommand({ positionals, yes, noLoop, io }: Args): Promise<number> {
  const target = startTarget(positionals);
  if (target === "bad") {
    io.err("usage: agent-factory start <project> <ticket> [--yes] [--no-loop]\n");
    return 64;
  }
  return resolvedRun("start", target.project, io, async (resolved) => {
    const code = await startResolved(target, yes, resolved);
    return code === 0 && !noLoop ? withLoop("start", io, target.project) : code;
  });
}

// withLoop : the orchestrator loop for the project, started in the background when none runs (#305), after a human's
// START or approval. The record is kept either way: a loop that cannot start is printed, and the exit stays 0.
async function withLoop(name: string, io: Io, project: string): Promise<number> {
  const home = factoryHome(io.env);
  if (home.kind === "refused") {
    return 0;
  }
  const running = await loopRunning({ home: home.path, project });
  if (running !== "none") {
    io.out(`the orchestrator loop for ${project} is already running (pid ${running})\n`);
    return 0;
  }
  const log = join(dirname(loopFile(home.path, project)), "loop.log");
  const started = await io.system.background({ args: ["dispatch", project], log });
  if (started.kind === "failed") {
    io.err(
      `agent-factory ${name}: the orchestrator loop did not start: ${started.reason}; run agent-factory dispatch ${project}\n`,
    );
    return 0;
  }
  io.out(
    `started the orchestrator loop for ${project} (pid ${started.value}); it ends when no ticket is in flight; log ${log}\n`,
  );
  return 0;
}

async function startResolved(target: TicketArgs, yes: boolean, io: Io): Promise<number> {
  const branch = await branchAt(io, target);
  if (branch.kind === "failed") {
    io.err(`agent-factory start: refused: ${branch.reason}\n`);
    return 1;
  }
  const result = await start({
    where: { home: branch.value.home, ...target },
    by: await whoApproves(io.env),
    via: "terminal",
    at: new Date().toISOString(),
    branch: branch.value.there ? "present" : "absent",
    confirmed: yes,
  });
  return startOutcome(io, result);
}

function startOutcome(io: Io, result: Awaited<ReturnType<typeof start>>): number {
  switch (result.kind) {
    case "started":
      io.out(
        `started ${result.record.project}/${result.record.ticket} by ${result.record.by} at ${result.record.at}\n`,
      );
      return 0;
    case "ask":
      io.err(`agent-factory start: ${result.question}; run it again with --yes to START anyway\n`);
      return 3;
    case "refused":
      io.err(`agent-factory start: refused: ${result.reason}\n`);
      return 1;
  }
}

type ApproveArgs = TicketArgs & { readonly hash: string; readonly design: string };

// approveArgs : the project, the ticket, the spec hash and the design hash ("none" when not given)
function approveArgs(positionals: readonly string[]): ApproveArgs | "bad" {
  const [project, ticket, hash, design] = [...positionals, "none"];
  const given = positionals.length >= 3 && positionals.length <= 4;
  return given ? { project, ticket: String(ticket), hash: String(hash), design: String(design) } : "bad";
}

async function approveCommand({ positionals, noLoop, io }: Args): Promise<number> {
  const args = approveArgs(positionals);
  if (args === "bad") {
    io.err(
      "usage: agent-factory approve <project> <ticket> <the full spec hash> [<the design hash>] [--no-loop], as agent-factory spec printed them\n",
    );
    return 64;
  }
  if (!plainName(args.project)) {
    io.err(`agent-factory approve: refused: ${JSON.stringify(args.project)} is not a plain project name\n`);
    return 1;
  }
  return resolvedRun("approve", args.project, io, (resolved) => approveResolved(args, noLoop, resolved));
}

async function approveResolved(args: ApproveArgs, noLoop: boolean, io: Io): Promise<number> {
  const { project, ticket } = args;
  const at = specsAt(io, project, ticket);
  if (at.kind === "refused") {
    io.err(`agent-factory approve: refused: ${at.reason}\n`);
    return 1;
  }
  const result = await approve({
    where: at.where,
    seenHash: args.hash,
    seenDesign: args.design,
    by: await whoApproves(io.env),
    via: "terminal",
    at: new Date().toISOString(),
  });
  if (result.kind === "refused") {
    io.err(`agent-factory approve: refused: ${result.reason}\n`);
    return 1;
  }
  const r = result.record;
  io.out(`approved ${project}/${ticket} spec ${r.spec_hash} design ${r.design_hash} by ${r.by} at ${r.at}\n`);
  return noLoop ? 0 : withLoop("approve", io, project);
}

// waive : a human's waiver of the test checks at one head, at the terminal (#231)
async function waiveCommand({ positionals, io }: Args): Promise<number> {
  const [project, ticket, head] = positionals;
  const target = startTarget([project, ticket].flatMap((n) => (n === undefined ? [] : [n])));
  if (positionals.length !== 3 || target === "bad") {
    io.err("usage: agent-factory waive <project> <ticket> <the full commit id of the head>\n");
    return 64;
  }
  const result = await waiveAt(io, target, String(head));
  if (result.kind === "refused") {
    io.err(`agent-factory waive: refused: ${result.reason}\n`);
    return 1;
  }
  const r = result.record;
  io.out(`waived the test checks of ${r.project}/${r.ticket} at ${r.head} by ${r.by} at ${r.at}\n`);
  return 0;
}

async function waiveAt(io: Io, target: TicketArgs, head: string): ReturnType<typeof waive> {
  const home = factoryHome(io.env);
  return home.kind === "home"
    ? waive({
        where: { home: home.path, ...target },
        head,
        by: await whoApproves(io.env),
        via: "terminal",
        at: new Date().toISOString(),
      })
    : home;
}

async function approvalCommand({ positionals, io }: Args): Promise<number> {
  const [project, ticket] = positionals;
  if (project === undefined || ticket === undefined) {
    io.err("usage: agent-factory approval <project> <ticket>\n");
    return 64;
  }
  if (!plainName(project)) {
    io.err(`agent-factory approval: refused: ${JSON.stringify(project)} is not a plain project name\n`);
    return 1;
  }
  return resolvedRun("approval", project, io, (resolved) => approvalResolved(resolved, project, ticket));
}

async function approvalAt(io: Io, project: string, ticket: string): ReturnType<typeof approvalState> {
  const at = specsAt(io, project, ticket);
  return at.kind === "at" ? approvalState(at.where) : at;
}

async function approvalResolved(io: Io, project: string, ticket: string): Promise<number> {
  const state = await approvalAt(io, project, ticket);
  switch (state.kind) {
    case "approved":
      io.out(
        `approved ${project}/${ticket} spec ${state.record.spec_hash} design ${state.record.design_hash} by ${state.record.by} at ${state.record.at}\n`,
      );
      return 0;
    case "stale":
      io.out(
        `stale ${project}/${ticket}: approved ${state.part} ${state.approvedHash}, now ${state.currentHash}; approve again\n`,
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

function minutesOf(env: NodeJS.ProcessEnv, id: MachineId, fallback: number): number | "bad" {
  const raw = settingOf(env, id) ?? String(fallback);
  return /^[1-9]\d{0,5}$/.test(raw) ? Number(raw) : "bad";
}

type DispatchSettings = PassSettings | { readonly kind: "refused"; readonly reason: string };

function dispatchSettings(env: NodeJS.ProcessEnv): DispatchSettings {
  const home = factoryHome(env);
  const quiet = minutesOf(env, "quietMinutes", 30);
  const every = minutesOf(env, "poll.minutes", DEFAULT_POLL_MINUTES);
  if (home.kind === "refused") {
    return home;
  }
  if (every === "bad") {
    return { kind: "refused", reason: `${settingName("poll.minutes")} must be a whole number of minutes` };
  }
  const caps = capsOf(env);
  if (caps.kind === "failed") {
    return { kind: "refused", reason: caps.reason };
  }
  return quiet === "bad"
    ? { kind: "refused", reason: `${settingName("quietMinutes")} must be a whole number of minutes` }
    : { home: home.path, quiet, poll: every, caps: caps.value };
}

type Planned = {
  readonly gate: Gate;
  readonly readyPrograms?: readonly string[];
  readonly steps: Steps;
  readonly plugins: readonly PluginHash[];
  readonly lanes: readonly LaneProps[];
};

type Project = { readonly forge: Forge; readonly identity: Identity };

// tokenStore : where the box's model login is kept (#136), as a result
function tokenStore(io: Io, home: string): Result<TokenStore> {
  const opened = openStore({
    platform: io.system.platform,
    home,
    owner: { uid: io.system.uid },
    run: io.system.run,
    env: io.env,
  });
  return opened.kind === "store" ? { kind: "ok", value: opened.store } : { kind: "failed", reason: opened.reason };
}

// hostBoxPlan : the project's box plan on this host: the vm box and the project's egress proxy, through its docker, or
// the srt runner with its own proxy (#114)
function hostBoxPlan(io: Io, home: string, project: string): Promise<PlanRead> {
  const docker = hostDocker(io.env, io.system.run);
  return boxPlan({
    env: io.env,
    home,
    project,
    boxesFor: (image) => [vmBox({ docker, image: image.ref, owner: { uid: io.system.uid, gid: io.system.gid } })],
    openEgress: (o) => openEgress({ ...o, dir: join(home, "egress"), docker }),
    srtFor: async (egress) =>
      srtBox({
        run: io.system.run,
        bin: "srt",
        env: io.env,
        host: {
          platform: io.system.platform,
          home: homedir(),
          factoryHome: home,
          programs: await locatePrograms({
            env: io.env,
            home: homedir(),
            cli: "claude",
            execPath: process.execPath,
            packageDir: packageDir(),
          }),
          toolchains: await locateToolchains({ env: io.env, home: homedir(), factoryHome: home }),
        },
        egress,
        caName: settingName("egress.caCerts"),
        runsDir: join(home, "srt-runs"),
      }),
  });
}

// egressCli : `egress check <project>` with the project's resolved settings (egress-cli.ts)
function egressCli(argv: readonly string[], io: Io): Promise<number> {
  return egressCommand(argv, {
    out: io.out,
    err: io.err,
    resolved: (project, go) =>
      resolvedRun("egress", project, io, (resolved) => {
        const home = factoryHome(resolved.env);
        return home.kind === "home"
          ? go({
              docker: hostDocker(resolved.env, resolved.system.run),
              plan: () => hostBoxPlan(resolved, home.path, project),
            })
          : Promise.resolve(1);
      }),
  });
}

// stepsFor : the gate and every step for one pass; a project file that is there but refused stops the pass
async function stepsFor(io: Io, opened: Project, home: string, project: string): Promise<Result<Planned>> {
  const { forge, identity } = opened;
  const planned = await hostBoxPlan(io, home, project);
  if (planned.kind === "failed") {
    return planned;
  }
  const { gate, plan } = planned.value;
  const used = await runPlugins({ home, project, env: io.env });
  if (used.kind === "failed") {
    return used;
  }
  io.err(used.value.warnings.map((w) => `warning: ${w}\n`).join(""));
  const own = await readProcess(used.value.plugins);
  if (own.kind === "failed") {
    return own;
  }
  const label = settingOf(io.env, "claimLabel") ?? DEFAULT_CLAIM_LABEL;
  const writer = await writerSetup({
    env: io.env,
    home,
    project,
    label,
    plan,
    forge,
    identity,
    store: tokenStore(io, home),
    pusher: hostPush,
    plugins: used.value.plugins,
    lanes: own.value.lanes,
  });
  const steps: Steps = {
    ...STEPS_TODAY,
    writer: writerStep(writer),
    ready: readyStep(plan, forge, async (ticket) => {
      const stored = await readWaiver({ home, project, ticket });
      if (stored.kind === "refused") {
        return { kind: "failed", reason: stored.reason };
      }
      return { kind: "ok", value: stored.kind === "record" ? stored.record.head : "none" };
    }),
    review: await reviewStepFor(io.env, forge, project, used.value.plugins),
    verify: verifyStep(plan, forge),
    ...designSteps(designSetup({ env: io.env, forge, home, project, plugins: used.value.plugins })),
  };
  return {
    kind: "ok",
    value: {
      gate,
      steps,
      plugins: hashesOf(used.value.plugins),
      lanes: own.value.lanes,
      ...programsOf(plan),
    },
  };
}

// programsOf : the programs the project's evidence rows may start with, as a field to spread (#444)
function programsOf(plan: BoxPlan): { readonly readyPrograms?: readonly string[] } {
  const programs = readyPrograms(plan);
  return programs === undefined ? {} : { readyPrograms: programs };
}

type PassSettings = { readonly home: string; readonly quiet: number; readonly poll: number; readonly caps: Caps };

// passSetup : the steps, and every setting of one pass with them
async function passSetup(
  project: string,
  dryRun: boolean,
  io: Io,
  settings: PassSettings,
  opened: Project,
): Promise<Result<TickSetup>> {
  const { forge } = opened;
  const planned = await stepsFor(io, opened, settings.home, project);
  if (planned.kind === "failed") {
    return planned;
  }
  const around = await aroundPass(io, settings.home, project, forge);
  if (around.kind === "failed") {
    return around;
  }
  return {
    kind: "ok",
    value: {
      home: settings.home,
      project,
      forge,
      label: settingOf(io.env, "claimLabel") ?? DEFAULT_CLAIM_LABEL,
      ...planned.value,
      now: () => Date.now(),
      quietMinutes: settings.quiet,
      pollMinutes: settings.poll,
      caps: settings.caps,
      repo: settingOf(io.env, "gitHostProject") ?? "",
      dryRun,
      log: (line) => io.out(`${line}\n`),
      ...around.value,
    },
  };
}

// aroundPass : the pass's pings (#119) and the project's spec store (#381)
async function aroundPass(
  io: Io,
  home: string,
  project: string,
  forge: Forge,
): Promise<Result<{ readonly notify: Notify; readonly specs: SpecStore }>> {
  const notify = await notifierFor(io, home, project, forge.mark);
  const specs = specStoreOf({ env: io.env, home, open: issuesFrom(forge) });
  if (notify.kind === "failed") {
    return notify;
  }
  return specs.kind === "ok" ? { kind: "ok", value: { notify: notify.value, specs: specs.value } } : specs;
}

// notifierFor : the pings of a pass (#119): through the notify plugin the project file maps, with the webhook from the
// token store; none when it maps none; printed instead of sent under FACTORY_DRY_RUN=1
async function notifierFor(io: Io, home: string, project: string, mark: string): Promise<Result<Notify>> {
  const plugin = await notifyPluginOf({ home, project });
  if (plugin.kind === "failed" || plugin.value === "") {
    return plugin.kind === "failed" ? plugin : { kind: "ok", value: NO_NOTIFY };
  }
  if (settingOf(io.env, "dryRun") === "1") {
    return { kind: "ok", value: dryNotify((line) => io.err(`${line}\n`)) };
  }
  const setup = await pluginSetup(home, io.env, webhookSecrets(tokenStore(io, home), BUNDLED_DISCORD));
  return { kind: "ok", value: pluginNotify({ setup, plugin: plugin.value, project, mark }) };
}

// setupNow : one pass's settings, the project's git host opened afresh. The project file may map the forge to a plugin
// (#134); then every forge call of the pass goes through it.
async function setupNow(project: string, dryRun: boolean, io: Io, settings: PassSettings): Promise<Result<TickSetup>> {
  const opened = await openProjectForge(
    { env: io.env, log: (line) => io.err(`${line}\n`) },
    { home: settings.home, project, plugins: await pluginSetup(settings.home, io.env) },
  );
  return opened.kind === "ok" ? passSetup(project, dryRun, io, settings, opened.value) : opened;
}

async function onePass(project: string, dryRun: boolean, io: Io, settings: PassSettings): Promise<number> {
  const setup = await setupNow(project, dryRun, io, settings);
  const passed = setup.kind === "ok" ? await tick(setup.value) : setup;
  if (passed.kind === "failed") {
    io.err(`agent-factory dispatch: ${passed.reason}\n`);
    return 1;
  }
  const closed = runHoursEnd({ project, caps: settings.caps }, passed.value);
  if (closed !== "none") {
    io.err(`agent-factory dispatch: ${closed}\n`);
  }
  return passed.value.some((r) => r.result.kind === "failed") ? 2 : 0;
}

// dispatchReady : the pass's settings; refused while the coordinator could approve, START or reach the git host
// itself (#105, #227)
async function dispatchReady(io: Io): Promise<DispatchSettings> {
  const settings = dispatchSettings(io.env);
  const places = placesOf(io);
  const wall = places.kind === "ok" ? await checkWall(places.value) : places;
  return wall.kind === "failed" && !("kind" in settings)
    ? { kind: "refused", reason: `refused: ${wall.reason}` }
    : settings;
}

// resolvedRun : the run with the project's settings layers resolved once on this host (#254): its modules read the
// resolved values, and the warnings (an unknown key) are printed; a layer that loosens a safety key refuses it
async function resolvedRun(
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
async function projectRun(
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

// loopWords : a forge command's words checked, with its project word, if any, taken off first
function loopWords(name: string, positionals: readonly string[]) {
  const words = projectWord(name, positionals);
  const command = LOOP_COMMANDS[name];
  const plain = words.project === undefined || plainName(words.project);
  return { project: words.project, parsed: plain && command !== undefined ? command(words.rest) : "usage" } as const;
}

// loopCommand : a forge command of loop-cli: its words checked first, then run on the chosen project's settings
function loopCommand(name: string, { positionals, io }: Args): Promise<number> {
  const words = loopWords(name, positionals);
  const parsed = words.parsed;
  return parsed === "usage"
    ? Promise.resolve(loopUsage(name, io))
    : projectRun(name, words.project, io, projectForm(name), (resolved) => Promise.resolve(parsed(resolved)));
}

// dispatch : the orchestrator loop (#305), or with --once one pass (#103). A human's command starts it; no cron or
// launchd job does. A lock keeps passes apart, and another keeps a second loop out. A dry run is one pass: it acts on
// nothing, so a loop of them would never end.
async function dispatchCommand({ positionals, once, dryRun, io }: Args): Promise<number> {
  const [project] = positionals;
  if (project === undefined || positionals.length !== 1) {
    io.err("usage: agent-factory dispatch <project> [--once] [--dry-run]\n");
    return 64;
  }
  return resolvedRun("dispatch", project, io, (resolved) =>
    dispatchResolved(project, once || dryRun, dryRun, resolved),
  );
}

async function dispatchResolved(project: string, once: boolean, dryRun: boolean, io: Io): Promise<number> {
  const settings = await dispatchReady(io);
  if ("kind" in settings) {
    io.err(`agent-factory dispatch: ${settings.reason}\n`);
    return 1;
  }
  return once ? onePass(project, dryRun, io, settings) : loopPasses(project, io, settings);
}

// loopPasses : passes until no ticket is in flight; exit 0, 1 when it cannot run or stopped on failed passes, 2 when an
// action failed
async function loopPasses(project: string, io: Io, settings: PassSettings): Promise<number> {
  const ended = await orchestratorLoop({
    home: settings.home,
    project,
    pollMinutes: settings.poll,
    setup: () => setupNow(project, false, io, settings),
    sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
    log: (line) => io.out(`${line}\n`),
    now: Date.now,
  });
  if (ended.kind === "failed") {
    io.err(`agent-factory dispatch: ${ended.reason}\n`);
    return 1;
  }
  return ended.value.failedActions ? 2 : 0;
}

// the login the factory posts as, or "" when the forge cannot say (the reviewer then counts no earlier round)
// factoryLogin : the login the factory posts as; its notes are the review rounds, so an unknown login is refused,
// never read as "no rounds"
async function factoryLogin(forge: Forge): Promise<Result<string>> {
  const me = await forge.me();
  return me.kind === "ok"
    ? me
    : { kind: "failed", reason: `cannot tell which login the factory posts as: ${me.reason}` };
}

async function reviewStepFor(
  env: NodeJS.ProcessEnv,
  forge: Forge,
  project: string,
  plugins: readonly PluginDir[],
): Promise<ReturnType<typeof reviewStep>> {
  const factory = await factoryLogin(forge);
  return factory.kind === "ok"
    ? reviewStep({ env, forge, factory: factory.value, project, plugins })
    : { kind: "unavailable", reason: factory.reason };
}

type OutcomeMap = { readonly [O in Outcome as O["kind"]]: O };
type Lines = { readonly [K in keyof OutcomeMap]: (where: string, o: OutcomeMap[K]) => string };

const LINES: Lines = {
  posted: (w, o) =>
    `review ${w} round ${o.round} at ${o.head.slice(0, 8)}: ${countsLine(o.counts)} ($${o.costUsd.toFixed(2)})`,
  reused: (w, o) => `review ${w} at ${o.head.slice(0, 8)}: verdict of round ${o.round} reused`,
  already: (w, o) => `${w} was already reviewed at ${o.head.slice(0, 8)}; nothing to do`,
  "no-progress": (w, o) => `review ${w} at ${o.head.slice(0, 8)}: no progress, ${o.why}; labelled needs-human`,
  moved: (w, o) =>
    `MOVED: ${w} moved from ${o.from.slice(0, 8)} to ${o.to.slice(0, 8)} during the review; nothing posted`,
};

function lineAs<K extends keyof OutcomeMap>(kind: K, where: string, o: OutcomeMap[K]): string {
  return LINES[kind](where, o);
}

function outcomeLine(mark: string, n: number, o: Outcome): string {
  return lineAs(o.kind, `${mark}${n}`, o);
}

type Target = { readonly project: string; readonly number: number };

function changeNumber(n: string | undefined): number | "bad" {
  return n !== undefined && /^[1-9]\d{0,9}$/.test(n) ? Number(n) : "bad";
}

function reviewTarget(positionals: readonly string[]): Target | "bad" {
  const [project = "", n] = positionals;
  const number = changeNumber(n);
  return positionals.length === 2 && plainName(project) && number !== "bad" ? { project, number } : "bad";
}

function reviewPaths(env: NodeJS.ProcessEnv): ReturnType<typeof paths> {
  return settingOf(env, "dryRun") === "1"
    ? {
        kind: "failed",
        reason: `${settingName("dryRun")} is set, and a reviewer spends on model runs; run it without the dry run`,
      }
    : paths(env);
}

async function runReview(target: Target, io: Io, p: Paths, plugins: readonly PluginDir[]): Promise<number> {
  const { project, number: n } = target;
  const opened = await openProject({ env: io.env, log: (line) => io.err(`${line}\n`) });
  if (opened.kind === "failed") {
    io.err(`agent-factory review: ${opened.reason}\n`);
    return 1;
  }
  const forge = opened.value.forge;
  const factory = await factoryLogin(forge);
  const round =
    factory.kind === "ok"
      ? await reviewRound(
          reviewSetup({ env: io.env, forge, factory: factory.value, project, number: n, paths: p, plugins }),
        )
      : factory;
  if (round.kind === "failed") {
    io.err(`agent-factory review: ${round.reason}\n`);
    return 1;
  }
  io.out(`${outcomeLine(forge.mark, n, round.value)}\n`);
  return round.value.kind === "moved" ? 3 : 0;
}

// review : one round (#138). A reviewer spends on model runs, so a dry run refuses it.
async function reviewCommand({ positionals, io }: Args): Promise<number> {
  const target = reviewTarget(positionals);
  if (target === "bad") {
    io.err("usage: agent-factory review <project> <number>\n");
    return 64;
  }
  return resolvedRun("review", target.project, io, (resolved) => reviewResolved(target, resolved));
}

async function reviewResolved(target: Target, io: Io): Promise<number> {
  const p = reviewPaths(io.env);
  const used = p.kind === "ok" ? await runPlugins({ home: p.value.home, project: target.project, env: io.env }) : p;
  if (used.kind === "failed" || p.kind === "failed") {
    io.err(`agent-factory review: ${used.kind === "failed" ? used.reason : ""}\n`);
    return 1;
  }
  io.err(used.value.warnings.map((w) => `warning: ${w}\n`).join(""));
  return runReview(target, io, p.value, used.value.plugins);
}

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

async function setupDiscord({ store, io }: { readonly store: TokenStore; readonly io: Io }): Promise<number> {
  const pasted = await io.readSecret("Paste the Discord webhook URL (it is not shown, and never printed): ");
  const saved = await saveDiscordWebhook({ store, pasted, now: new Date() });
  if (saved.kind === "refused") {
    io.err(`agent-factory setup discord: ${saved.reason}\n`);
    return 1;
  }
  io.out(`stored the Discord webhook in ${saved.where}; map notify to the discord plugin in the project file\n`);
  return 0;
}

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

// srtLines : the srt runner's toolchain folders as setup status prints them (#371), and whether none was refused
async function srtLines(io: Io, box: BoxChoice): Promise<{ readonly lines: readonly string[]; readonly ok: boolean }> {
  const home = factoryHome(io.env);
  if (box.kind !== "chosen" || box.place !== "srt" || home.kind === "refused") {
    return { lines: [], ok: true };
  }
  const toolchains = await locateToolchains({ env: io.env, home: homedir(), factoryHome: home.path });
  return { lines: toolchainLines(toolchains, homedir()), ok: toolchains.refused.length === 0 };
}

// latestLines : the installed version against the latest release (#482); none when this run cannot read it
async function latestLines(io: Io): Promise<readonly string[]> {
  return io.latestRelease === undefined ? [] : [versionCheck(version(), await io.latestRelease()).line];
}

async function setupStatus({ store, io }: { readonly store: TokenStore; readonly io: Io }): Promise<number> {
  const box = chooseBox(io.env);
  const srt = await srtLines(io, box);
  const boxLines =
    box.kind === "chosen"
      ? [`box: ${box.place}`, ...box.risks.map((r) => `  risk: ${r}`), ...srt.lines.map((l) => `  ${l}`)]
      : [`box: refused: ${box.reason}`];
  const token = tokenLine(await claudeTokenStatus({ store, now: new Date() }));
  io.out([...boxLines, token.line, ...(await latestLines(io))].map((l) => `${l}\n`).join(""));
  return box.kind === "chosen" && srt.ok && token.ok ? 0 : 1;
}

// this package's folder: next to dist/ (or src/ in a test)
function packageDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..");
}

// the package's own box image: images/factory-box
function baseDir(): string {
  return join(packageDir(), "images", "factory-box");
}

function builtLine(project: string, b: Built): string {
  return b.layer === "project"
    ? `box ${project}: ${b.image} (base ${b.base}, with box.Dockerfile)`
    : `box ${project}: ${b.image} (the base; no box.Dockerfile)`;
}

// box build : the project's box image, built here and pinned by its ID (#113 Q1)
type BoxArgs = { readonly kind: "build"; readonly project: string } | { readonly kind: "usage" };

function boxArgs(positionals: readonly string[]): BoxArgs {
  const [sub, project] = positionals;
  return sub === "build" && project !== undefined && positionals.length === 2
    ? { kind: "build", project }
    : { kind: "usage" };
}

async function boxCommand({ positionals, io }: Args): Promise<number> {
  const parsed = boxArgs(positionals);
  if (parsed.kind === "usage") {
    io.err("usage: agent-factory box build <project>\n");
    return 64;
  }
  const home = factoryHome(io.env);
  if (home.kind === "refused") {
    io.err(`agent-factory box: ${home.reason}\n`);
    return 1;
  }
  io.err("building the box image; the first build takes some minutes\n");
  const { project } = parsed;
  const built = await buildBox({
    docker: hostDocker(io.env, io.system.run),
    home: home.path,
    project,
    baseDir: baseDir(),
    pack: npmPacker({ run: io.system.run, env: io.env, pkg: packageDir() }),
  });
  if (built.kind === "failed") {
    io.err(`agent-factory box: ${built.reason}\n`);
    return 1;
  }
  io.out(`${builtLine(project, built.value)}\n`);
  return 0;
}

// placesOf : where the coordinator's rules point: this package, the factory home, the factory user's home
function placesOf(io: Io): Result<CoordinatorPlaces> {
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

async function setupCoordinator({ io }: { readonly io: Io }): Promise<number> {
  const places = placesOf(io);
  const dir = places.kind === "ok" ? await installCoordinator(places.value) : places;
  if (dir.kind === "failed") {
    io.err(`agent-factory setup coordinator: ${dir.reason}\n`);
    return 1;
  }
  io.out(`coordinator settings in ${dir.value}; start the session with agent-factory coordinator\n`);
  return 0;
}

const SETUP: readonly SetupStep[] = [
  { name: "claude", run: setupClaude },
  { name: "discord", run: setupDiscord },
  { name: "status", run: setupStatus },
];

type CoordinatorArgs = { readonly project: string | undefined; readonly runner: "claude" | "copilot" } | "bad";

const RUNNERS: ReadonlySet<string> = new Set(["claude", "copilot"]);

// coordinatorArgs : [<project>] [claude | copilot]
function coordinatorArgs(positionals: readonly string[]): CoordinatorArgs {
  const last = String(positionals.at(-1));
  const rest = RUNNERS.has(last) ? positionals.slice(0, -1) : positionals;
  const runner = last === "copilot" ? "copilot" : "claude";
  return rest.length > 1 || !rest.every(plainName) ? "bad" : { project: rest[0], runner };
}

// the package's own folder, and its bundled discord plugin: the only plugin the Discord webhook is ever handed to (#119)
const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");
const BUNDLED_DISCORD = join(PKG, "plugins", "discord", "plugin");

// plugin : register, update, test and list plugins (#134)
async function pluginCli({ positionals, io }: Args): Promise<number> {
  const home = factoryHome(io.env);
  if (home.kind === "refused") {
    io.err(`agent-factory plugin: ${home.reason}\n`);
    return 1;
  }
  return pluginCommand(positionals, { env: io.env, out: io.out, err: io.err, home: home.path, pkg: PKG });
}

// settingsIo : what config and team run with: the factory home, never the product repo (#229)
function settingsIo(io: Io, json: boolean, name: string): SettingsIo | undefined {
  const home = factoryHome(io.env);
  if (home.kind === "refused") {
    io.err(`agent-factory ${name}: ${home.reason}\n`);
    return undefined;
  }
  return { env: io.env, out: io.out, err: io.err, home: home.path, json };
}

async function configCli({ positionals, json, io }: Args): Promise<number> {
  const sio = settingsIo(io, json, "config");
  return sio === undefined ? 1 : configCommand(positionals, sio);
}

async function teamCli({ positionals, json, io }: Args): Promise<number> {
  const sio = settingsIo(io, json, "team");
  return sio === undefined ? 1 : teamCommand(positionals, sio);
}

// initProbes : what init's checks ask this machine: programs on PATH, srt's version, the git host login for the project
// (through the Forge seam, with the project's settings resolved from the files init just wrote) and the coordinator's
// settings
function initProbes(io: Io, home: string): Probes {
  return {
    run: io.system.run,
    env: io.env,
    which: (name) => which(name, io.env.PATH ?? ""),
    execPath: realExecPath(),
    home: homedir(),
    platform: io.system.platform,
    now: new Date(),
    version: version(),
    ...(io.latestRelease === undefined ? {} : { latest: io.latestRelease }),
    gitHost: async (project) => {
      const settings = await runSettings({ home, project, env: io.env });
      const opened =
        settings.kind === "ok"
          ? await openProjectForge(
              { env: settings.value.env, log: (line) => io.err(`${line}\n`), run: io.system.run },
              { home, project, plugins: await pluginSetup(home, settings.value.env) },
            )
          : settings;
      return opened.kind === "ok" ? opened.value.forge.defaultBranch() : opened;
    },
    wall: async () => {
      const places = placesOf(io);
      const wall = places.kind === "ok" ? await checkWall(places.value) : places;
      return wall.kind === "ok" ? { kind: "ok", value: "" } : wall;
    },
  };
}

function realExecPath(): string {
  try {
    return realpathSync(process.execPath);
  } catch {
    return process.execPath;
  }
}

// initDir : the clone init reads: --repo, an absolute path, else the current folder
function initDir(repo: string | undefined): string | undefined {
  const dir = repo ?? process.cwd();
  return isAbsolute(dir) ? dir : undefined;
}

// init : the guided setup of this laptop and one project (#369); the coordinator's settings deny it
async function initCli({ positionals, yes, repo, io }: Args): Promise<number> {
  const home = factoryHome(io.env);
  const dir = initDir(repo);
  if (positionals.length > 1 || dir === undefined) {
    io.err("usage: agent-factory init [<project>] [--repo <absolute path>] [--yes]\n");
    return 64;
  }
  if (home.kind === "refused") {
    io.err(`agent-factory init: ${home.reason}\n`);
    return 1;
  }
  return initCommand(
    { project: positionals[0], dir, yes },
    {
      env: io.env,
      out: io.out,
      err: io.err,
      home: home.path,
      ...(io.readLine === undefined ? {} : { readLine: io.readLine }),
      probes: initProbes(io, home.path),
      markets: KNOWN_MARKETS,
    },
  );
}

// coordinatorProject : the project the session's commands act on when they name none (#382): the one named, else the
// one in the factory home; with none or several and none named, the session starts with no default and its commands
// name their project
async function coordinatorProject(home: string, project: string | undefined, io: Io): Promise<Result<string>> {
  if (project === undefined) {
    const known = await projectNames(home);
    return { kind: "ok", value: known.length === 1 ? known.join("") : "" };
  }
  const chosen = await chosenProject({ home, project, env: io.env, usage: "" });
  return chosen.kind === "ok" ? { kind: "ok", value: project } : chosen;
}

// coordinator : the coordinator's session, in its own folder with its own settings (#106), for one project (#382)
async function coordinatorCommand({ positionals, io }: Args): Promise<number> {
  const args = coordinatorArgs(positionals);
  if (args === "bad") {
    io.err("usage: agent-factory coordinator [<project>] [copilot]\n");
    return 64;
  }
  const session = await coordinatorSession(io, args.project);
  if (session.kind === "failed") {
    io.err(`agent-factory coordinator: ${session.reason}\n`);
    return 1;
  }
  const { places, project } = session.value;
  return startCoordinator(places, args.runner, {
    ...io,
    env: sessionEnv(io, project),
    interactive: io.system.interactive,
  });
}

// coordinatorSession : where the session's rules point, and its project ("" for none)
async function coordinatorSession(
  io: Io,
  named: string | undefined,
): Promise<Result<{ readonly places: CoordinatorPlaces; readonly project: string }>> {
  const places = placesOf(io);
  if (places.kind === "failed") {
    return places;
  }
  const project = await coordinatorProject(places.value.factoryHome, named, io);
  return project.kind === "ok" ? { kind: "ok", value: { places: places.value, project: project.value } } : project;
}

// sessionEnv : the coordinator session's env, with its project as the default of the commands it runs (#382)
function sessionEnv(io: Io, project: string): NodeJS.ProcessEnv {
  if (project === "") {
    return io.env;
  }
  io.err(`agent-factory coordinator: for ${project}; its commands act on it when they name no project\n`);
  return { ...io.env, [DEFAULT_PROJECT]: project };
}

// setup : make and keep the box's model-only token (#136), and say whether a box may start
async function setupCommand({ positionals, io }: Args): Promise<number> {
  return positionals[0] === "coordinator" && positionals.length === 1
    ? // the coordinator's settings need no token store
      setupCoordinator({ io })
    : setupStep({ positionals, io });
}

async function setupStep({
  positionals,
  io,
}: {
  readonly positionals: readonly string[];
  readonly io: Io;
}): Promise<number> {
  const step = SETUP.find((s) => s.name === positionals[0]);
  if (step === undefined) {
    io.err("usage: agent-factory setup claude | discord | status | coordinator\n");
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
  // status reads the user and machine layers, so a user file's srt.readOnly shows (#371)
  return step.name === "status"
    ? resolvedRun("setup status", undefined, io, (resolved) => step.run({ store: store.store, io: resolved }))
    : step.run({ store: store.store, io });
}

const COMMANDS: readonly Command[] = [
  { name: "poll", run: poll },
  { name: "spec", run: spec },
  { name: "start", run: startCommand },
  { name: "approve", run: approveCommand },
  { name: "waive", run: waiveCommand },
  { name: "approval", run: approvalCommand },
  { name: "app-token", run: appTokenCommand },
  { name: "dispatch", run: dispatchCommand },
  { name: "review", run: reviewCommand },
  { name: "usage", run: usage },
  { name: "onboard", run: onboardCli },
  { name: "setup", run: setupCommand },
  { name: "coordinator", run: coordinatorCommand },
  { name: "plugin", run: pluginCli },
  { name: "box", run: boxCommand },
  { name: "config", run: configCli },
  { name: "team", run: teamCli },
  { name: "init", run: initCli },
  ...Object.keys(LOOP_COMMANDS).map((name) => ({ name, run: (args: Args) => loopCommand(name, args) })),
  // the writer's lint hook reads no setting, and prints only the lint's own output
  { name: "lint-edit", run: ({ positionals, io }: Args) => lintEditCommand(positionals, io) },
];

// COMMAND_NAMES : every command the CLI takes, the ones that read their own options too; test/cli-doc.test.ts checks
// that docs/reference/cli.md lists each one (#482)
export const COMMAND_NAMES: readonly string[] = [
  ...COMMANDS.map((c) => c.name),
  ...Object.keys(REQUEST_COMMANDS),
  "eval",
  "egress",
];

// ownOptions : request, confirm and project read their own options (--file, --template <file>, a text that is one
// word), so the main command line never parses their words
function ownOptions(argv: readonly string[], io: Io): Promise<number> | undefined {
  const [name = ""] = argv;
  const run = Object.hasOwn(REQUEST_COMMANDS, name) ? REQUEST_COMMANDS[name] : undefined;
  if (run === undefined) {
    return undefined;
  }
  const home = factoryHome(io.env);
  if (home.kind === "refused") {
    io.err(`agent-factory ${name}: ${home.reason}\n`);
    return Promise.resolve(1);
  }
  return run(argv.slice(1), {
    env: io.env,
    out: io.out,
    err: io.err,
    home: home.path,
    secrets: webhookSecrets(tokenStore(io, home.path), BUNDLED_DISCORD),
  });
}

export function runCli(argv: readonly string[], io: Io): Promise<number> {
  // eval reads its own options (--drafts, --allow-partial)
  if (argv[0] === "eval") {
    return evalCommand(argv.slice(1), io);
  }
  // egress reads its own options (--port, --model-host, --pull)
  if (argv[0] === "egress") {
    return egressCli(argv.slice(1), io);
  }
  return ownOptions(argv, io) ?? mainCli(argv, io);
}

async function mainCli(argv: readonly string[], io: Io): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      help: { type: "boolean" },
      version: { type: "boolean" },
      json: { type: "boolean" },
      once: { type: "boolean" },
      "dry-run": { type: "boolean" },
      template: { type: "boolean" },
      yes: { type: "boolean" },
      "no-loop": { type: "boolean" },
      repo: { type: "string" },
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
    once: values.once === true,
    dryRun: values["dry-run"] === true,
    yes: values.yes === true,
    noLoop: values["no-loop"] === true,
    repo: values.repo,
    positionals: positionals.slice(1),
    io,
  });
}
