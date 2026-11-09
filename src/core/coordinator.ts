// coordinator — the coordinator's wall as harness settings (#106; ADR-0012 S2). The coordinator talks with the person,
// reads the factory's state and posts one status line; it holds no forge login of its own, edits only spec drafts,
// and never its own settings. The rules are built here, once, for Claude Code (settings.json) and for Copilot CLI
// (flags), and `agent-factory setup coordinator` writes them where `agent-factory coordinator` starts the session.
//
//   allow   the factory's read commands, `agent-factory status`, and `agent-factory request`, which the project's
//           policy checks, caps and cleans in code (#134)
//   ask     `agent-factory confirm` (the prompt shows the exact text of a kept write; the yes sends it), and, Today,
//           the old loop commands, so none runs without a yes; they become deny once the orchestrator runs every step
//           (#113)
//   deny    `agent-factory approve`, `agent-factory start` and `agent-factory waive`: the AI never approves, never
//           STARTs a ticket (#227, P6, P8) and never waives its own test check hit (#231); a human runs them at a
//           front door. Raw git host and network clients, git push, a second
//           interpreter or shell (a Read deny does not stop a program that opens files itself), sudo and the App
//           token's wrapper; editing any .claude/ (the user's settings and each project's), the package, the START,
//           approval and waiver records, the project home, the team and user settings layers, the local rubric folders, the
//           secrets, the run records, the pending writes and the write log, and the plugin list;
//           `agent-factory plugin` and `agent-factory project`; reading the secret paths
//
// The coordinator never runs in bypass-permissions mode: the settings disable it and claudeArgv never asks for it. The
// orchestrator refuses to start while the settings it finds are looser than this wall (wallProblems, #105), and
// `make lint` runs the same check on the template (scripts/check-coordinator.ts).
//
// A deny in any settings scope cannot be loosened by another scope, and the session starts with --setting-sources
// project, so the person's own user settings add no allow rule. Bash deny rules match a command as typed; the docs say
// they are no security boundary, which is why the forge login stays out of the coordinator's reach in the target.

import type { Argv } from "./project.js";

export type CoordinatorPlaces = {
  // the installed package, absolute
  readonly pkg: string;
  // the factory's home (FACTORY_HOME), absolute
  readonly factoryHome: string;
  // the factory OS user's home on the VM, where the App's key lives
  readonly botHome: string;
};

// the commands the coordinator may run with no prompt: they read, post one templated status line, or ask for a write
// that the policy decides in code
const READS = ["poll", "spec", "approval", "status", "request", "--help", "--version"];
// Today: asked, so the person says yes to each start; once the dispatcher runs the writer, these move to DENY
const STARTS = ["claim", "release", "block", "reconcile", "review", "dispatch", "setup"];

// the commands only a human runs: the AI never approves, never STARTs (#227) and never waives a test check (#231)
export const HUMAN_ONLY = ["agent-factory approve", "agent-factory start", "agent-factory waive"];

const DENY_BASH = [
  ...HUMAN_ONLY,
  "gh",
  "glab",
  "git push",
  "git * push",
  "curl",
  "wget",
  "ssh",
  "scp",
  "nc",
  "node -e",
  "node --eval",
  "node -p",
  "node --print",
  "python",
  "python3",
  "perl",
  "ruby",
  "deno",
  "bun",
  "npx",
  "sh -c",
  "bash -c",
  "zsh -c",
  "eval",
  "sudo",
  "su",
  "agent-factory-app-token",
  "security",
  "chmod",
  "chown",
  "agent-factory ask",
  "agent-factory app-token",
  "agent-factory lint-edit",
  "agent-factory plugin",
  "agent-factory project",
];

// the secret paths of review issue 6, under the person's home
const SECRET_HOME = [
  ".ssh/**",
  ".gnupg/**",
  ".config/gh/**",
  ".config/glab-cli/**",
  ".git-credentials",
  ".netrc",
  ".aws/**",
  ".config/gcloud/**",
  ".azure/**",
  ".kube/**",
  ".docker/config.json",
  ".npmrc",
  ".m2/settings.xml",
  ".gradle/gradle.properties",
  "Library/Keychains/**",
  "Library/Application Support/Google/Chrome/**",
  "Library/Application Support/Firefox/**",
  "Library/Safari/**",
  ".config/google-chrome/**",
  ".config/chromium/**",
  ".mozilla/**",
  ".claude/.credentials.json",
  ".copilot/**",
];

// absolute : a path as a Claude Code rule path: // then the path from the root
function absolute(path: string): string {
  return `//${path.replace(/^\/+/, "")}`;
}

function bash(command: string): string {
  return `Bash(${command} *)`;
}

function exact(command: string): readonly string[] {
  return [`Bash(${command})`, bash(command)];
}

export type ClaudeSettings = {
  readonly $schema: string;
  readonly permissions: {
    readonly defaultMode: "default";
    readonly disableBypassPermissionsMode: "disable";
    readonly disableAutoMode: "disable";
    readonly additionalDirectories: readonly string[];
    readonly allow: readonly string[];
    readonly ask: readonly string[];
    readonly deny: readonly string[];
  };
};

function readDenies(p: CoordinatorPlaces): readonly string[] {
  return [
    ...SECRET_HOME.map((s) => `Read(~/${s})`),
    `Read(${absolute(p.factoryHome)}/secrets/**)`,
    `Read(${absolute(p.botHome)}/**)`,
    // a rule with no //, ~/ or / is relative to the session's folder: these must reach every project
    "Read(//**/.env*)",
  ];
}

export function editDenies(p: CoordinatorPlaces): readonly string[] {
  const home = absolute(p.factoryHome);
  return [
    "Edit(~/.claude/**)",
    "Edit(//**/.claude/**)",
    `Edit(${absolute(p.pkg)}/**)`,
    `Edit(${home}/approvals/**)`,
    `Edit(${home}/starts/**)`,
    `Edit(${home}/waivers/**)`,
    // the settings layers and rubric folders the plugin work adds (#229, #232): denied before they exist
    `Edit(${home}/settings.json)`,
    `Edit(${home}/team/**)`,
    `Edit(${home}/rubrics/**)`,
    `Edit(${home}/projects/**)`,
    `Edit(${home}/runs/**)`,
    `Edit(${home}/secrets/**)`,
    `Edit(${home}/coordinator/**)`,
    `Edit(${home}/review-runs/**)`,
    `Edit(${home}/box-runs/**)`,
    `Edit(${home}/egress/**)`,
    `Edit(${home}/plugins.json)`,
    `Edit(${home}/plugins/**)`,
    `Edit(${home}/pending/**)`,
    `Edit(${home}/writes/**)`,
  ];
}

// claudeSettings : the coordinator's .claude/settings.json
export function claudeSettings(p: CoordinatorPlaces): ClaudeSettings {
  const specs = `${absolute(p.factoryHome)}/specs`;
  return {
    $schema: "https://json.schemastore.org/claude-code-settings.json",
    permissions: {
      defaultMode: "default",
      disableBypassPermissionsMode: "disable",
      disableAutoMode: "disable",
      additionalDirectories: [`${p.factoryHome}/specs`],
      allow: [...READS.flatMap((c) => exact(`agent-factory ${c}`)), `Edit(${specs}/**)`, `Read(${specs}/**)`],
      ask: [
        ...exact("agent-factory confirm"),
        ...STARTS.flatMap((c) => exact(`agent-factory ${c}`)),
        bash(`${p.pkg}/scripts/start-writer.sh`),
      ],
      deny: [...DENY_BASH.flatMap(exact), ...editDenies(p), ...readDenies(p)],
    },
  };
}

// copilotArgs : the same wall as Copilot CLI flags; deny wins over allow there too. Copilot has no read or edit rule by
// path, so the session's folder and --add-dir are its only path scope. Today: untried against a live Copilot CLI.
export function copilotArgs(p: CoordinatorPlaces): readonly string[] {
  const allow = READS.map((c) => `shell(agent-factory ${c})`);
  // what is not allowed asks, so the old loop commands ask here as in Claude Code; approve, start and waive are denied
  const deny = DENY_BASH.map((c) => `shell(${c})`);
  return [
    "--add-dir",
    `${p.factoryHome}/specs`,
    ...allow.flatMap((a) => ["--allow-tool", a]),
    ...deny.flatMap((d) => ["--deny-tool", d]),
  ];
}

// the session's instructions: GUIDE.md is the coordinator's, from the installed package
// (an @import cannot hold a space, so a package path with one gets the sentence only)
export function claudeMd(p: CoordinatorPlaces): string {
  const guide = `${p.pkg}/GUIDE.md`;
  const importLine = /\s/.test(guide) ? "" : `\n@${guide}\n`;
  return `# Coordinator\n\nYou are the factory's coordinator. Follow ${guide}, "Run the loop", as your instructions.\n${importLine}`;
}

export function claudeArgv(): Argv {
  return ["claude", "--setting-sources", "project"];
}

// The wall's check (#105, #227): what the orchestrator refuses to start under, and what the lint holds the template to.

// commands no allow or ask rule may reach: a human's word, a raw git host or network client, a second shell
const NEVER_LET = [
  "agent-factory approve PROJ PROJ-1 0",
  "agent-factory start PROJ PROJ-1",
  "agent-factory waive PROJ PROJ-1 0",
  "gh api user",
  "glab api user",
  "curl https://example.com",
  "bash -c true",
];

function permission(settings: unknown, key: string): unknown {
  const permissions: unknown =
    typeof settings === "object" && settings !== null ? Reflect.get(settings, "permissions") : undefined;
  return typeof permissions === "object" && permissions !== null ? Reflect.get(permissions, key) : undefined;
}

function rules(settings: unknown, key: "allow" | "ask" | "deny"): readonly string[] {
  const list = permission(settings, key);
  return Array.isArray(list) ? list.filter((r): r is string => typeof r === "string") : [];
}

// bashReaches : whether a Bash rule matches the command: "Bash" and "Bash(*)" match all, "*" is any text, and the
// old "Bash(gh:*)" form is the prefix "gh"
export function bashReaches(rule: string, command: string): boolean {
  const pattern = /^Bash(?:\((.*)\))?$/.exec(rule.trim());
  if (pattern === null) {
    return false;
  }
  const body = (pattern[1] ?? "*").replace(/:\*$/, " *");
  const glob = body.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${glob.replace(/ \.\*$/, "( .*)?")}$`).test(command);
}

// editsOutside : an Edit or Write rule with no path, or a path outside the spec drafts (a ".." may climb out)
function editsOutside(rule: string, specs: string): boolean {
  const edit = /^(?:Edit|Write|MultiEdit|NotebookEdit)(?:\((.*)\))?$/.exec(rule.trim());
  const path = edit?.[1] ?? "";
  return edit !== null && (!path.startsWith(`${specs}/`) || path.includes(".."));
}

function letProblems(settings: unknown): readonly string[] {
  const lets = [...rules(settings, "allow"), ...rules(settings, "ask")];
  return NEVER_LET.flatMap((command) =>
    lets.filter((rule) => bashReaches(rule, command)).map((rule) => `${rule} lets the coordinator run ${command}`),
  );
}

function denyProblems(settings: unknown, p: CoordinatorPlaces): readonly string[] {
  const deny = new Set(rules(settings, "deny"));
  const needed = [...HUMAN_ONLY.flatMap(exact), ...editDenies(p)];
  return needed.filter((rule) => !deny.has(rule)).map((rule) => `the deny rule ${rule} is missing`);
}

function bypassProblems(settings: unknown): readonly string[] {
  return [
    ...(permission(settings, "disableBypassPermissionsMode") === "disable"
      ? []
      : ["bypass-permissions mode is not disabled (disableBypassPermissionsMode: disable)"]),
    ...(permission(settings, "defaultMode") === "bypassPermissions" ? ["the default mode is bypassPermissions"] : []),
  ];
}

// wallProblems : every way these coordinator settings are looser than the wall; none means the wall holds
export function wallProblems(settings: unknown, p: CoordinatorPlaces): readonly string[] {
  const specs = `${absolute(p.factoryHome)}/specs`;
  const edits = rules(settings, "allow")
    .filter((rule) => editsOutside(rule, specs))
    .map((rule) => `${rule} lets the coordinator edit outside the spec drafts`);
  return [...letProblems(settings), ...edits, ...denyProblems(settings, p), ...bypassProblems(settings)];
}
