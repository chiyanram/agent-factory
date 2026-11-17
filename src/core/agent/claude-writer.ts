// claude-writer — the Claude Code adapter's writer run (ADR-0022; ADR-0012 S11): the argv the runner starts and the
// settings file it loads with --settings, both built from the role card. The box, the watch and the report stay in
// writer/run.ts.
//   argv      claude -p, no settings from the branch (--setting-sources user, #110), skip-all only inside a runner (vm
//             or srt), each plugin with --plugin-dir, the card's tools and claude's helpers, streamed output
//   settings  the deny list, one set of rules per guardrail ID the card carries (process/guardrails.ts); test-first's
//             edit scope as a PreToolUse hook (writer/scope.ts writerScope); the project's lint after each edit
// Skip-all reads no allow rule, but every deny rule and hook still holds ("Deny rules block in every mode, including
// bypassPermissions", Claude Code's permission modes). The runner is the wall; these are the second line.

import type { BoxPlace } from "../box/types.js";
import type { GuardrailId } from "../process/guardrails.js";
import type { Argv } from "../project.js";
import type { FileText } from "../writer/clone.js";
import { pluginPaths } from "../writer/clone.js";
import { claudeLimit, type Printed, type UsageLimit } from "./usage-limit.js";

export type Claude = {
  // "" for no cap (FACTORY_MAX_USD)
  readonly maxUsd: string;
  // "" for Claude's default (FACTORY_WRITER_MODEL)
  readonly model: string;
};

// the writer's settings file in the clone, for claude --settings, or none
export type SettingsArg = { readonly kind: "none" } | { readonly kind: "file"; readonly path: string };

// what one writer run asks of the CLI; the place is known only once the box starts
export type WriterCall = {
  readonly claude: Claude;
  readonly settings: SettingsArg;
  // how many plugins the clone holds (writer/clone.ts pluginPaths)
  readonly plugins: number;
  // the role card's tools (process/cards.ts): the run gets these and no others
  readonly tools: readonly string[];
};

// the claude tools each role card tool stands for: a card's Edit also writes a new file. With any tools, a run also
// gets claude's helpers that add no reach of their own: its task list, its skills (read like any file), and subagents,
// which get the same tools and the same deny list and hooks.
const CLAUDE_TOOLS: Readonly<Record<string, readonly string[]>> = {
  Read: ["Read"],
  Grep: ["Grep"],
  Glob: ["Glob"],
  Edit: ["Edit", "Write"],
  Bash: ["Bash"],
};
const HELPERS = ["TodoWrite", "Skill", "Task"];

// claudeTools : the --tools value for a card's tools, in claude's names. Pure.
export function claudeTools(tools: readonly string[]): string {
  const named = tools.flatMap((t) => CLAUDE_TOOLS[t] ?? []);
  return [...new Set([...named, ...(named.length === 0 ? [] : HELPERS)])].join(",");
}

// the runners skip-all is allowed in (ADR-0012 S11): a sandbox around the whole process. A run anywhere else
// gets no skip flag, so with -p every tool call that would ask is denied.
const SKIP_ALL_IN: ReadonlySet<BoxPlace> = new Set(["vm", "srt"]);

// skipAll : the skip-all flag, inside a runner only. Pure.
export function skipAll(place: BoxPlace): readonly string[] {
  return SKIP_ALL_IN.has(place) ? ["--dangerously-skip-permissions"] : [];
}

// writerBin : the claude the runner at `place` starts: the vm image's own, which the image pins (S7), and `bin`
// (FACTORY_CLAUDE) in srt, which runs the host's programs. Pure.
export function writerBin(bin: string, place: BoxPlace): string {
  return place === "vm" ? "claude" : bin;
}

// writerArgv : the writer's command in the runner at `place`. Pure. The prompt goes on stdin; the plugin and settings
// paths are relative to the clone.
export function writerArgv(bin: string, call: WriterCall, place: BoxPlace): Argv {
  return [
    writerBin(bin, place),
    "-p",
    "--setting-sources",
    "user",
    ...skipAll(place),
    ...pluginPaths(call.plugins).flatMap((dir) => ["--plugin-dir", dir]),
    "--tools",
    claudeTools(call.tools),
    "--output-format",
    "stream-json",
    "--verbose",
    ...(call.claude.maxUsd === "" ? [] : ["--max-budget-usd", call.claude.maxUsd]),
    ...(call.claude.model === "" ? [] : ["--model", call.claude.model]),
    ...(call.settings.kind === "file" ? ["--settings", call.settings.path] : []),
  ];
}

// the writer's environment besides its login: only the model API is needed, with no update checks and no telemetry,
// so the egress list holds api.anthropic.com alone, and the CLI never updates itself during a run
export const WRITER_ENV: Readonly<Record<string, string>> = {
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  DISABLE_AUTOUPDATER: "1",
};

// what the writer may do without asking, outside skip-all: Bash inside the runner's sandbox, edits in the clone
export const WRITER_ALLOW: readonly string[] = ["Bash", "Edit(./**)"];

// the credential paths a writer never reads, under the person's home
const CREDENTIALS: readonly string[] = [
  ".ssh/**",
  ".gnupg/**",
  ".config/gh/**",
  ".config/glab-cli/**",
  ".git-credentials",
  ".config/git/credentials",
  ".netrc",
  ".aws/**",
  ".config/gcloud/**",
  ".azure/**",
  ".kube/**",
  ".docker/**",
  ".claude/**",
  ".claude.json",
  ".copilot/**",
];

// both spellings of one command: alone, and with arguments
function bashRule(name: string): readonly string[] {
  return [`Bash(${name})`, `Bash(${name} *)`];
}

// the deny rules each guardrail ID adds, in the list's order; an ID enforced elsewhere (read-only by the tools,
// judge-files-locked by the ready check, edit-scope by the hook and the host) adds none. A rule with // is absolute:
// inside the srt runner ~ is the run's private HOME, not the person's.
const DENIES: readonly { readonly id: GuardrailId; readonly rules: (root: string) => readonly string[] }[] = [
  { id: "no-web", rules: () => ["WebFetch"] },
  { id: "no-push", rules: () => bashRule("git push") },
  { id: "no-web", rules: () => bashRule("curl") },
  { id: "no-credentials", rules: (root) => (root === "" ? [] : CREDENTIALS.map((p) => `Read(//${root}/${p})`)) },
];

// writerDenies : the deny list for the card's guardrails, with the credential paths under `home`, the person's real
// home ("" when unknown, and then only the runner hides them). Pure.
export function writerDenies(guardrails: readonly GuardrailId[], home: string): readonly string[] {
  const root = home.replace(/^\/+/, "").replace(/\/+$/, "");
  return DENIES.filter((d) => guardrails.includes(d.id)).flatMap((d) => d.rules(root));
}

// quoted : one shell word, as a hook's command line needs. Pure.
export function quoted(word: string): string {
  return `'${word.replaceAll("'", `'\\''`)}'`;
}

export type WriterPolicy = {
  // the guardrails that apply to the run (process/cards.ts Card.guardrails)
  readonly guardrails: readonly GuardrailId[];
  // the person's real home, for the credential paths
  readonly home: string;
  // the project's lint command for each edited file (writer/tools.ts), "" for none
  readonly lint: string;
  // the glob lists an edit must match, each one (writer/scope.ts scopesOf); none is anywhere in the clone
  readonly scopes: readonly (readonly string[])[];
};

// writerSettings : the writer's settings file: its allow and deny lists, the scope hook before each edit when the run
// has a scope, and the lint hook after each edit when the project names a lint. Pure.
export function writerSettings(policy: WriterPolicy): FileText {
  const permissions = { allow: WRITER_ALLOW, deny: writerDenies(policy.guardrails, policy.home) };
  const command = (line: string) => ({ type: "command", command: line });
  const scope =
    policy.scopes.length === 0
      ? {}
      : {
          PreToolUse: [
            {
              matcher: "Edit|MultiEdit|Write|NotebookEdit",
              hooks: [command(`agent-factory writer-scope ${quoted(JSON.stringify(policy.scopes))}`)],
            },
          ],
        };
  const lint =
    policy.lint === ""
      ? {}
      : {
          PostToolUse: [
            { matcher: "Edit|MultiEdit|Write", hooks: [command(`agent-factory lint-edit ${quoted(policy.lint)}`)] },
          ],
        };
  const hooks = { ...scope, ...lint };
  return {
    kind: "text",
    text: `${JSON.stringify({ permissions, ...(Object.keys(hooks).length === 0 ? {} : { hooks }) }, null, 2)}\n`,
  };
}

// the writer kind of the adapter, with its CLI resolved
export type ClaudeWriter = {
  readonly env: Readonly<Record<string, string>>;
  readonly bin: (place: BoxPlace) => string;
  readonly argv: (call: WriterCall, place: BoxPlace) => Argv;
  readonly settings: (policy: WriterPolicy) => FileText;
  // the provider's usage limit the run hit, from what it printed (usage-limit.ts)
  readonly usageLimit: (printed: Printed) => UsageLimit;
};

// claudeWriter : the writer kind for the claude CLI at `bin`
export function claudeWriter(bin: string): ClaudeWriter {
  return {
    env: WRITER_ENV,
    bin: (place) => writerBin(bin, place),
    argv: (call, place) => writerArgv(bin, call, place),
    settings: writerSettings,
    usageLimit: claudeLimit,
  };
}
