// claude-writer — the Claude Code adapter's writer run (ADR-0022; ADR-0012 S11): the argv the runner starts and the
// settings file it loads with --settings, both built from the role card. The box, the watch and the report stay in
// writer/run.ts.
//   argv      claude -p, no settings from the branch (--setting-sources user, #110), skip-all only inside a runner (vm
//             or srt), each plugin with --plugin-dir, the card's tools and claude's helpers, streamed output
//   settings  the deny list, one set of rules per guardrail ID the card carries (process/guardrails.ts); test-first's
//             edit scope as a PreToolUse hook (writer/scope.ts writerScope); the project's lint after each edit
// Skip-all reads no allow rule, but every deny rule and hook still holds ("Deny rules block in every mode, including
// bypassPermissions", Claude Code's permission modes). The runner is the wall; these are the second line.
//
// The writer's environment turns off update checks and telemetry, so the egress list holds api.anthropic.com alone. A
// deny rule with // is absolute, because inside the srt runner ~ is the run's private HOME, not the person's.
// https://code.claude.com/docs/en/permissions#read-and-edit

import type { BoxPlace } from "../box/types.js";
import type { GuardrailId } from "../process/guardrails.js";
import { MODEL_RUN_MARK } from "./mark.js";
import type { Argv } from "../project.js";
import type { FileText } from "../writer/clone.js";
import { pluginPaths } from "../writer/clone.js";
import { claudeLimit, type Printed, type UsageLimit } from "./usage-limit.js";

export type Claude = {
  readonly maxUsd: string;
  readonly model: string;
};

export type SettingsArg = { readonly kind: "none" } | { readonly kind: "file"; readonly path: string };

export type WriterCall = {
  readonly claude: Claude;
  readonly settings: SettingsArg;
  readonly plugins: number;
  readonly tools: readonly string[];
};

const CLAUDE_TOOLS: Readonly<Record<string, readonly string[]>> = {
  Read: ["Read"],
  Grep: ["Grep"],
  Glob: ["Glob"],
  Edit: ["Edit", "Write"],
  Bash: ["Bash"],
};
const HELPERS = ["TodoWrite", "Skill", "Task"];

export function claudeTools(tools: readonly string[]): string {
  const named = tools.flatMap((t) => CLAUDE_TOOLS[t] ?? []);
  return [...new Set([...named, ...(named.length === 0 ? [] : HELPERS)])].join(",");
}

const SKIP_ALL_IN: ReadonlySet<BoxPlace> = new Set(["vm", "srt"]);

export function skipAll(place: BoxPlace): readonly string[] {
  return SKIP_ALL_IN.has(place) ? ["--dangerously-skip-permissions"] : [];
}

export function writerBin(bin: string, place: BoxPlace): string {
  return place === "vm" ? "claude" : bin;
}

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

export const WRITER_ENV: Readonly<Record<string, string>> = {
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  DISABLE_AUTOUPDATER: "1",
  ...MODEL_RUN_MARK,
};

export const WRITER_ALLOW: readonly string[] = ["Bash", "Edit(./**)"];

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

function bashRule(name: string): readonly string[] {
  return [`Bash(${name})`, `Bash(${name} *)`];
}

const DENIES: readonly { readonly id: GuardrailId; readonly rules: (root: string) => readonly string[] }[] = [
  { id: "no-web", rules: () => ["WebFetch"] },
  { id: "no-push", rules: () => bashRule("git push") },
  { id: "no-web", rules: () => bashRule("curl") },
  { id: "no-credentials", rules: (root) => (root === "" ? [] : CREDENTIALS.map((p) => `Read(//${root}/${p})`)) },
];

export function writerDenies(guardrails: readonly GuardrailId[], home: string): readonly string[] {
  const root = home.replace(/^\/+/, "").replace(/\/+$/, "");
  return DENIES.filter((d) => guardrails.includes(d.id)).flatMap((d) => d.rules(root));
}

export function quoted(word: string): string {
  return `'${word.replaceAll("'", `'\\''`)}'`;
}

export type WriterPolicy = {
  readonly guardrails: readonly GuardrailId[];
  readonly home: string;
  readonly lint: string;
  readonly scopes: readonly (readonly string[])[];
};

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

export type ClaudeWriter = {
  readonly env: Readonly<Record<string, string>>;
  readonly bin: (place: BoxPlace) => string;
  readonly argv: (call: WriterCall, place: BoxPlace) => Argv;
  readonly settings: (policy: WriterPolicy) => FileText;
  readonly usageLimit: (printed: Printed) => UsageLimit;
};

export function claudeWriter(bin: string): ClaudeWriter {
  return {
    env: WRITER_ENV,
    bin: (place) => writerBin(bin, place),
    argv: (call, place) => writerArgv(bin, call, place),
    settings: writerSettings,
    usageLimit: claudeLimit,
  };
}
