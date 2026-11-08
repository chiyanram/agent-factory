// run — one writer run in a fresh box (#113; ADR-0012 S5, S11, S13). The host has made the clone (clone.ts); this
// file runs the agent in it and reads how it ended:
//   1 the project's egress proxy, then the box, with the clone mounted and only the model login and the proxy settings
//   2 claude -p, the prompt on stdin, skip-all permissions (S11: allowed in the vm box), the rulebook as a plugin
//   3 the box stops; only then is .factory/report.json read (report.ts), and the outcome decided from it and the exit
//   4 the branch's tip, and the patch-id of everything since the start, which the dispatcher compares run to run
// Every box failure is a blocked outcome with the reason, never a guess. Nothing here throws.

import type { Argv } from "../project.js";
import type { Result } from "../forge/api.js";
import { hostGit, type GitResult } from "../git.js";
import { decide, loadReport, type Outcome, type RunEnd } from "../report.js";
import type { Ran } from "../box/index.js";
import { startBox, type BoxSetup } from "../ready/boxrun.js";
import { RULEBOOK_DIR, type Clone } from "./clone.js";

export type Claude = {
  // "" for no cap (FACTORY_MAX_USD)
  readonly maxUsd: string;
  // "" for Claude's default (FACTORY_WRITER_MODEL)
  readonly model: string;
};

// the writer's settings file in the clone, for claude --settings (tools.ts), or none
export type SettingsArg = { readonly kind: "none" } | { readonly kind: "file"; readonly path: string };

export type WriterRun = {
  readonly setup: BoxSetup;
  readonly clone: Clone;
  readonly prompt: string;
  // the model-only login (#136): CLAUDE_CODE_OAUTH_TOKEN and its scrub setting
  readonly login: Readonly<Record<string, string>>;
  readonly timeoutSeconds: number;
  readonly claude: Claude;
  readonly settings: SettingsArg;
};

export type Ended = { readonly outcome: Outcome; readonly tip: string; readonly patch: string };

// only the model API is needed: no update checks, no telemetry, so the egress list holds api.anthropic.com alone
const QUIET: Readonly<Record<string, string>> = {
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  DISABLE_AUTOUPDATER: "1",
};

// claudeArgv : the writer's command. Pure. The prompt goes on stdin; the plugin and settings paths are relative to the
// clone.
export function claudeArgv(claude: Claude, settings: SettingsArg = { kind: "none" }): Argv {
  return [
    "claude",
    "-p",
    "--dangerously-skip-permissions",
    "--plugin-dir",
    RULEBOOK_DIR,
    "--output-format",
    "json",
    ...(claude.maxUsd === "" ? [] : ["--max-budget-usd", claude.maxUsd]),
    ...(claude.model === "" ? [] : ["--model", claude.model]),
    ...(settings.kind === "file" ? ["--settings", settings.path] : []),
  ];
}

// runEnd : how the run ended, as the report reads it. Pure.
export function runEnd(ran: Ran): RunEnd {
  switch (ran.kind) {
    case "exited":
      return { kind: "exited", code: ran.code };
    case "timedOut":
      return { kind: "timedOut", seconds: ran.seconds };
    case "failed":
      return { kind: "failed", reason: ran.reason };
  }
}

// inBox : the agent's run, start to stop; the run's end, or why the box itself failed
async function inBox(run: WriterRun): Promise<RunEnd> {
  const session = await startBox(run.setup, {
    worktree: run.clone.repo,
    readOnly: run.clone.readOnly,
    env: { ...run.login, ...QUIET },
  });
  if (session.kind === "failed") {
    return { kind: "failed", reason: session.reason };
  }
  const ran = await run.setup.box.run({
    session: session.value,
    command: {
      argv: claudeArgv(run.claude, run.settings),
      stdin: { kind: "text", text: run.prompt },
      timeoutSeconds: run.timeoutSeconds,
    },
  });
  const stopped = await run.setup.box.stop(session.value);
  // a box that did not stop may still be writing: its report is never read
  return stopped.kind === "ok" ? runEnd(ran) : { kind: "failed", reason: `the box did not stop: ${stopped.reason}` };
}

function said(result: GitResult): string {
  return result.kind === "refused" ? result.reason : result.kind === "failed" ? result.stderr.trim() : "";
}

async function git(run: WriterRun, args: readonly string[], stdin = ""): Promise<Result<string>> {
  const ran = await hostGit({
    args,
    repo: { kind: "repo", path: run.clone.repo },
    env: run.setup.env,
    ownHelper: { kind: "none" },
    stdin: stdin === "" ? { kind: "none" } : { kind: "text", text: stdin },
  });
  return ran.kind === "ok"
    ? { kind: "ok", value: ran.stdout }
    : { kind: "failed", reason: `git ${args[0]}: ${said(ran)}` };
}

// patchOf : the patch-id of the run's whole change, "" when it changed nothing
async function patchOf(run: WriterRun, tip: string): Promise<Result<string>> {
  if (tip === run.clone.start) {
    return { kind: "ok", value: "" };
  }
  const diff = await git(run, ["diff", "--no-ext-diff", "--no-textconv", "--no-color", run.clone.start, tip]);
  const id = diff.kind === "ok" ? await git(run, ["patch-id", "--stable"], diff.value) : diff;
  return id.kind === "ok" ? { kind: "ok", value: id.value.split(" ")[0] ?? "" } : id;
}

// committed : the branch's tip after the run, and the patch since the start
async function committed(run: WriterRun): Promise<Result<{ readonly tip: string; readonly patch: string }>> {
  const tip = await git(run, ["rev-parse", `refs/heads/${run.clone.branch}`]);
  if (tip.kind === "failed") {
    return tip;
  }
  const sha = tip.value.trim();
  const patch = await patchOf(run, sha);
  return patch.kind === "ok" ? { kind: "ok", value: { tip: sha, patch: patch.value } } : patch;
}

// writerRun : the run, then its outcome, the branch's tip and the patch. A failure here is the host's, not the run's.
export async function writerRun(run: WriterRun): Promise<Result<Ended>> {
  const end = await inBox(run);
  const outcome = decide({
    end,
    file: end.kind === "failed" ? { kind: "missing" } : await loadReport({ worktree: run.clone.repo }),
  });
  const after = await committed(run);
  return after.kind === "ok"
    ? { kind: "ok", value: { outcome, ...after.value } }
    : { kind: "failed", reason: `cannot read what the run committed: ${after.reason}` };
}
