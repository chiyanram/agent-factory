// app — the command line, as a function: runCli(argv, io) returns the exit code and writes only through io, so a test
// can run every command. src/cli.ts only binds it to the process (#101). A UI replaces only these two files.

import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, join } from "node:path";
import { homedir, userInfo } from "node:os";
import { DEFAULT_CLAIM_LABEL, format, poll as pollForge } from "./core/poll.js";
import { openProject, openProjectForge } from "./core/forge/index.js";
import type { Forge } from "./core/forge/types.js";
import { checkSpec, designHash, plainName, readSpec, template } from "./core/spec.js";
import { approvalState, approve } from "./core/approval.js";
import { start } from "./core/start.js";
import { readWaiver, waive } from "./core/waiver.js";
import { hostGit } from "./core/git.js";
import type { Runner as CliRunner, Result } from "./core/forge/api.js";
import { buildBox, chooseBox, hostDocker, vmBox, type Built } from "./core/box/index.js";
import { npmPacker } from "./core/box/pack.js";
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
import { STEPS_TODAY, tick, type Steps } from "./core/dispatch/tick.js";
import type { Gate } from "./core/dispatch/table.js";
import { reviewRound, type Outcome } from "./core/review/round.js";
import { paths, reviewSetup, type Paths } from "./core/review/settings.js";
import { reviewStep } from "./core/review/step.js";
import { boxPlan } from "./core/ready/plan.js";
import type { Identity } from "./core/identity.js";
import { writerSetup } from "./core/writer/setup.js";
import { hostPush } from "./core/push.js";
import { writerStep } from "./core/writer/step.js";
import { readyStep, verifyStep } from "./core/ready/steps.js";
import { countsLine } from "./core/review/verdicts.js";
import { LOOP_COMMANDS, LOOP_HELP } from "./loop-cli.js";
import { pluginCommand, pluginSetup } from "./plugin-cli.js";
import { dryNotify, NO_NOTIFY, notifyPluginOf, pluginNotify, webhookSecrets, type Notify } from "./core/notify.js";
import { REQUEST_COMMANDS, REQUEST_HELP } from "./request-cli.js";
import { EVAL_HELP, evalCommand } from "./eval-cli.js";
import type { CoordinatorPlaces } from "./core/coordinator.js";
import { checkWall, installCoordinator, startCoordinator, type Interactive } from "./coordinator-cli.js";
import { configCommand, teamCommand, type SettingsIo } from "./settings-cli.js";

const HELP = `usage: agent-factory <command>

commands:
  poll                         one line of facts per open change, read from the forge
  spec <project> <ticket>      check a ticket's local spec: its hash, or what it is missing
  spec --template <ticket>     print an empty spec to fill in
  start <project> <ticket> [--yes]
                               a human's START: open the ticket (in the tiny lane it also lets the build begin); asks
                               first, exit 3, when factory/<ticket> is already on the git host; --yes is the answer.
                               A human runs it; the coordinator's settings deny it
  approve <project> <ticket> <hash> [<design hash>]
                               record the human's approval of the spec and the design with exactly those hashes (all 64
                               characters, as spec printed them; no design hash is none). A human runs it; the
                               coordinator's settings deny it
  waive <project> <ticket> <head>
                               record the human's waiver of the test checks at that head (the full commit id the
                               hits were listed at): the ready check clears them, and flags a cleared file again only
                               if a later head changes it. A human runs it; the coordinator's settings deny it
  approval <project> <ticket>  whether work may start: approved (0), stale (3), missing (4), refused (1)
  review <project> <number>    one review round on a claimed change: pack, find, verify, threads, status box, summary;
                               the contract is the approved spec of the ticket its factory/<ticket> branch names;
                               exit 0 posted or reused, 3 when the head moved, 1 otherwise
  dispatch <project> --once    one pass of the orchestrator over the project's started and approved tickets and their
                               PRs: decides each with the table and acts (--dry-run: decides and acts on none); it
                               refuses to start while the coordinator's settings are looser than its wall
  app-token <owner/name>       run as the factory user only, through its one sudo rule: a GitHub App token for that
                               repository, as JSON {token, login, expiresAt}
  setup claude                 store the box's model-only token: run claude setup-token first, then paste it
                               at the hidden prompt; it is never printed (#136)
  setup discord                store the Discord webhook the dispatcher pings through, at a hidden prompt (#119)
  setup status                 the box chosen, its risks, and whether the claude token is valid
  setup coordinator            write the coordinator's settings (its wall, read-only) and instructions into
                               <home>/coordinator
  coordinator [copilot]        start the coordinator's session there, with only those settings (#106)
  plugin add <path|name>       register a plugin: run its describe, record its absolute path and sha256 (#134)
  plugin update <name> [<sha>] test a new version and show its hash and new writes; record it with that hash
  plugin test <path|name>      the contract test kit: handshake, fixtures, bad input, unknown op, stdout, env, tokens
  plugin list                  the registered plugins
  config show <project>        every settings key: its value, layer, file:line and class (--json: as JSON)
  config check <project>       resolve the team, project, user and machine layers and check them: exit 0 or 1 (#229)
  team update <project> [<commit>]
                               show what the team's new commit changes, check it, then move the project's pin
${REQUEST_HELP}  box build <project>          build the box image on this host (the base, then <home>/projects/<project>/box.Dockerfile
                               if there is one) and pin its ID in <home>/projects/<project>/box.json; run it again
                               after an upgrade
${LOOP_HELP}${EVAL_HELP}
options:
  --help      show this help
  --version   show the package version
  --json      poll: print the parsed records as JSON

settings:
  FACTORY_QUIET_MINUTES  dispatch: how long an open question may sit before the claim is released (default 30)
  FACTORY_HOME         where specs and approvals live (default ~/.factory): <home>/specs/<project>/<ticket>/spec.md
  FACTORY_FORGE        gitlab (default) or github
  FACTORY_PROJECT      the project: owner/name on GitHub, the full path on GitLab
  FACTORY_CLAIM_LABEL  the label a claimed change carries (default agent::claimed)
  FACTORY_GH           the gh to call (default gh); FACTORY_GLAB the glab to call (default glab)
  FACTORY_IDENTITY     own (default: your gh or glab login) or app (a GitHub App whose key the factory user holds)
  FACTORY_BOX          where a box runs: vm (Docker with Sysbox on this host)
  FACTORY_REPO         dispatch: the project's clone on this host, an absolute path
  FACTORY_EGRESS_IMAGE   the egress proxy's Squid image, name@sha256:<digest> (default: a pinned ubuntu/squid)
  FACTORY_UPSTREAM_PROXY at work: the corporate proxy, host:port, every box request leaves through
`;

type Args = {
  readonly json: boolean;
  readonly template: boolean;
  readonly once: boolean;
  readonly dryRun: boolean;
  readonly yes: boolean;
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
  // the machine setup stores tokens on; a test passes linux and its own uid, so it never touches a Keychain
  readonly system: {
    readonly platform: NodeJS.Platform;
    readonly uid: number;
    readonly gid: number;
    readonly run: CliRunner;
    // a program on this terminal, for the coordinator's session
    readonly interactive: Interactive;
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
    case "found":
      return specFound(io, { home: home.path, project, ticket }, read);
  }
}

// specFound : the spec's hash and its design's (#227), or what the spec is missing
async function specFound(
  io: Io,
  at: { readonly home: string; readonly project: string; readonly ticket: string },
  read: { readonly text: string; readonly where: string },
): Promise<number> {
  const checked = checkSpec(read.text);
  if (checked.kind === "invalid") {
    io.err(`agent-factory spec: ${read.where} is not ready:\n${checked.problems.map((p) => `  - ${p}\n`).join("")}`);
    return 2;
  }
  const design = await designHash({ store: { kind: "local", root: join(at.home, "specs") }, ...at });
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
    ownHelper: { kind: "none" },
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
async function startCommand({ positionals, yes, io }: Args): Promise<number> {
  const target = startTarget(positionals);
  if (target === "bad") {
    io.err("usage: agent-factory start <project> <ticket> [--yes]\n");
    return 64;
  }
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

async function approveCommand({ positionals, io }: Args): Promise<number> {
  const args = approveArgs(positionals);
  if (args === "bad") {
    io.err(
      "usage: agent-factory approve <project> <ticket> <the full spec hash> [<the design hash>], as agent-factory spec printed them\n",
    );
    return 64;
  }
  const home = factoryHome(io.env);
  if (home.kind === "refused") {
    io.err(`agent-factory approve: refused: ${home.reason}\n`);
    return 1;
  }
  const { project, ticket } = args;
  const result = await approve({
    where: { home: home.path, project, ticket },
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
  return 0;
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
  const home = factoryHome(io.env);
  const state = home.kind === "home" ? await approvalState({ home: home.path, project, ticket }) : home;
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

function quietMinutes(env: NodeJS.ProcessEnv): number | "bad" {
  const raw = env.FACTORY_QUIET_MINUTES ?? "30";
  return /^[1-9]\d{0,5}$/.test(raw) ? Number(raw) : "bad";
}

type DispatchSettings =
  | { readonly home: string; readonly quiet: number }
  | { readonly kind: "refused"; readonly reason: string };

function dispatchSettings(env: NodeJS.ProcessEnv): DispatchSettings {
  const home = factoryHome(env);
  const quiet = quietMinutes(env);
  if (home.kind === "refused") {
    return home;
  }
  return quiet === "bad"
    ? { kind: "refused", reason: "FACTORY_QUIET_MINUTES must be a whole number of minutes" }
    : { home: home.path, quiet };
}

type Planned = { readonly gate: Gate; readonly steps: Steps };

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

// stepsFor : the gate and every step for one pass; a project file that is there but refused stops the pass
async function stepsFor(io: Io, opened: Project, home: string, project: string): Promise<Result<Planned>> {
  const { forge, identity } = opened;
  const docker = hostDocker(io.env, io.system.run);
  const planned = await boxPlan({
    env: io.env,
    home,
    project,
    // the laptop box comes with #129
    boxesFor: (image) => [vmBox({ docker, image: image.ref, owner: { uid: io.system.uid, gid: io.system.gid } })],
    openEgress: (o) => openEgress({ ...o, dir: join(home, "egress"), docker }),
  });
  if (planned.kind === "failed") {
    return planned;
  }
  const { gate, plan } = planned.value;
  const label = io.env.FACTORY_CLAIM_LABEL ?? DEFAULT_CLAIM_LABEL;
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
    review: await reviewStepFor(io.env, forge, project),
    verify: verifyStep(plan, forge),
  };
  return { kind: "ok", value: { gate, steps } };
}

type PassSettings = { readonly home: string; readonly quiet: number };

// pass : the steps, then one locked pass with them
async function pass(
  project: string,
  dryRun: boolean,
  io: Io,
  settings: PassSettings,
  opened: Project,
): Promise<ReturnType<typeof tick>> {
  const { forge } = opened;
  const planned = await stepsFor(io, opened, settings.home, project);
  if (planned.kind === "failed") {
    return planned;
  }
  const notify = await notifierFor(io, settings.home, project, forge.mark);
  if (notify.kind === "failed") {
    return notify;
  }
  return tick({
    home: settings.home,
    project,
    forge,
    label: io.env.FACTORY_CLAIM_LABEL ?? DEFAULT_CLAIM_LABEL,
    ...planned.value,
    now: () => Date.now(),
    quietMinutes: settings.quiet,
    dryRun,
    log: (line) => io.out(`${line}\n`),
    notify: notify.value,
  });
}

// notifierFor : the pings of a pass (#119): through the notify plugin the project file maps, with the webhook from the
// token store; none when it maps none; printed instead of sent under FACTORY_DRY_RUN=1
async function notifierFor(io: Io, home: string, project: string, mark: string): Promise<Result<Notify>> {
  const plugin = await notifyPluginOf({ home, project });
  if (plugin.kind === "failed" || plugin.value === "") {
    return plugin.kind === "failed" ? plugin : { kind: "ok", value: NO_NOTIFY };
  }
  if (io.env.FACTORY_DRY_RUN === "1") {
    return { kind: "ok", value: dryNotify((line) => io.err(`${line}\n`)) };
  }
  const setup = await pluginSetup(home, io.env, webhookSecrets(tokenStore(io, home), BUNDLED_DISCORD));
  return { kind: "ok", value: pluginNotify({ setup, plugin: plugin.value, project, mark }) };
}

async function onePass(project: string, dryRun: boolean, io: Io, settings: PassSettings): Promise<number> {
  // the project file may map the forge to a plugin (#134); then every forge call of the pass goes through it
  const opened = await openProjectForge(
    { env: io.env, log: (line) => io.err(`${line}\n`) },
    { home: settings.home, project, plugins: await pluginSetup(settings.home, io.env) },
  );
  const passed = opened.kind === "ok" ? await pass(project, dryRun, io, settings, opened.value) : opened;
  if (passed.kind === "failed") {
    io.err(`agent-factory dispatch: ${passed.reason}\n`);
    return 1;
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

// dispatch : one pass (#103). Only --once: launchd or cron runs it every few minutes, and a lock keeps passes apart.
async function dispatchCommand({ positionals, once, dryRun, io }: Args): Promise<number> {
  const [project] = positionals;
  if (project === undefined || positionals.length !== 1 || !once) {
    io.err("usage: agent-factory dispatch <project> --once [--dry-run]\n");
    return 64;
  }
  const settings = await dispatchReady(io);
  if ("kind" in settings) {
    io.err(`agent-factory dispatch: ${settings.reason}\n`);
    return 1;
  }
  return onePass(project, dryRun, io, settings);
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
): Promise<ReturnType<typeof reviewStep>> {
  const factory = await factoryLogin(forge);
  return factory.kind === "ok"
    ? reviewStep({ env, forge, factory: factory.value, project })
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
  return env.FACTORY_DRY_RUN === "1"
    ? {
        kind: "failed",
        reason: "FACTORY_DRY_RUN is set, and a reviewer spends on model runs; run it without the dry run",
      }
    : paths(env);
}

async function runReview(target: Target, io: Io, p: Paths): Promise<number> {
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
      ? await reviewRound(reviewSetup({ env: io.env, forge, factory: factory.value, project, number: n, paths: p }))
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
  const p = reviewPaths(io.env);
  if (p.kind === "failed") {
    io.err(`agent-factory review: ${p.reason}\n`);
    return 1;
  }
  return runReview(target, io, p.value);
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

function runnerOf(positionals: readonly string[]): "claude" | "copilot" | "bad" {
  const [runner = "claude"] = positionals;
  const known = runner === "claude" || runner === "copilot" ? runner : "bad";
  return positionals.length > 1 ? "bad" : known;
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

// coordinator : the coordinator's session, in its own folder with its own settings (#106)
async function coordinatorCommand({ positionals, io }: Args): Promise<number> {
  const runner = runnerOf(positionals);
  if (runner === "bad") {
    io.err("usage: agent-factory coordinator [copilot]\n");
    return 64;
  }
  const places = placesOf(io);
  if (places.kind === "failed") {
    io.err(`agent-factory coordinator: ${places.reason}\n`);
    return 1;
  }
  return startCoordinator(places.value, runner, { ...io, interactive: io.system.interactive });
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
  return step.run({ store: store.store, io });
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
  { name: "setup", run: setupCommand },
  { name: "coordinator", run: coordinatorCommand },
  { name: "plugin", run: pluginCli },
  { name: "box", run: boxCommand },
  { name: "config", run: configCli },
  { name: "team", run: teamCli },
  ...Object.entries(LOOP_COMMANDS).map(([name, run]) => ({
    name,
    run: ({ positionals, io }: Args) => Promise.resolve(run(positionals, io)),
  })),
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
    positionals: positionals.slice(1),
    io,
  });
}
