// coordinator — the coordinator's wall as harness settings (#106; ADR-0012 S2). The coordinator talks with the person,
// reads the factory's state and posts one status line; it holds no forge login of its own, edits only spec drafts,
// and never its own settings. The rules are built here, once, for Claude Code (settings.json) and for Copilot CLI
// (flags), and `agent-factory setup coordinator` writes them where `agent-factory coordinator` starts the session.
//
//   allow   the factory's read commands and `agent-factory status`
//   ask     `agent-factory approve` (the person's yes in the harness prompt is the approval), and, Today, the start
//           commands, so nothing starts without a yes; they become deny once the dispatcher runs the writer (#113)
//   deny    raw forge and network clients, git push, a second interpreter or shell (a Read deny does not stop a program
//           that opens files itself), sudo and the App token's wrapper; editing any .claude/, the package, the
//           approvals, the project files, the secrets and the run records; reading the secret paths
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

// the commands the coordinator may run with no prompt: they read, or post one templated status line
const READS = ["poll", "spec", "approval", "status", "--help", "--version"];
// Today: asked, so the person says yes to each start; once the dispatcher runs the writer, these move to DENY
const STARTS = ["claim", "release", "block", "reconcile", "review", "dispatch", "setup"];

const DENY_BASH = [
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
    "Read(**/.env*)",
  ];
}

function editDenies(p: CoordinatorPlaces): readonly string[] {
  const home = absolute(p.factoryHome);
  return [
    "Edit(~/.claude/**)",
    "Edit(**/.claude/**)",
    `Edit(${absolute(p.pkg)}/**)`,
    `Edit(${home}/approvals/**)`,
    `Edit(${home}/projects/**)`,
    `Edit(${home}/runs/**)`,
    `Edit(${home}/secrets/**)`,
    `Edit(${home}/coordinator/**)`,
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
        ...exact("agent-factory approve"),
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
  // what is not allowed asks, so approve and the start commands ask here as in Claude Code
  const deny = DENY_BASH.map((c) => `shell(${c})`);
  return [
    "--add-dir",
    `${p.factoryHome}/specs`,
    ...allow.flatMap((a) => ["--allow-tool", a]),
    ...deny.flatMap((d) => ["--deny-tool", d]),
  ];
}

// the session's instructions: GUIDE.md is the coordinator's, from the installed package
export function claudeMd(p: CoordinatorPlaces): string {
  return `# Coordinator\n\nYou are the factory's coordinator. Follow ${p.pkg}/GUIDE.md, "Run the loop", as your instructions.\n\n@${p.pkg}/GUIDE.md\n`;
}

export function claudeArgv(): Argv {
  return ["claude", "--setting-sources", "project"];
}
