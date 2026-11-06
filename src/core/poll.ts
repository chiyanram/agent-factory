// poll — run scripts/poll.sh and parse each line into a typed record (#101).
// The line format is owned by scripts/poll.sh; this file only reads it. The dispatcher (#103) consumes the records.

import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export type YesNo = "yes" | "no";
export type Approval = "yes" | "no" | "stale";
// GitHub reports success, failed, running or none (scripts/lib/github.sh:168); GitLab passes its own status through,
// lower-cased (scripts/lib/gitlab.sh:128).
export type Pipeline =
  | "success" | "failed" | "running" | "none"
  | "created" | "waiting_for_resource" | "preparing" | "pending" | "canceled" | "skipped" | "manual" | "scheduled";

export type OpenChange = {
  readonly kind: "open";
  readonly number: number;
  readonly head: string;
  readonly draft: YesNo;
  readonly claimed: YesNo;
  readonly approved: Approval;
  readonly pipeline: Pipeline;
  readonly needsHuman: YesNo;
  readonly stop: YesNo;
  readonly asks: number;
};

export type MergedChange = {
  readonly kind: "merged";
  readonly number: number;
  readonly claimed: "yes";
};

export type ParseError = {
  readonly kind: "parse-error";
  readonly line: string;
  readonly reason: string;
};

export type PollLine = OpenChange | MergedChange | ParseError;

export type PollResult =
  | { readonly kind: "ok"; readonly raw: readonly string[]; readonly lines: readonly PollLine[] }
  | { readonly kind: "failed"; readonly exitCode: number; readonly stderr: string };

const YES_NO: readonly YesNo[] = ["yes", "no"];
const APPROVALS: readonly Approval[] = ["yes", "no", "stale"];
const PIPELINES: readonly Pipeline[] = [
  "success", "failed", "running", "none",
  "created", "waiting_for_resource", "preparing", "pending", "canceled", "skipped", "manual", "scheduled",
];

const OPEN_LINE =
  /^[!#](\d+) head=([0-9a-f]{1,40}) draft=(\S+) claimed=(\S+) approved=(\S+) pipeline=(\S+) needs_human=(\S+) stop=(\S+) asks=(\d+)$/;
const MERGED_LINE = /^[!#](\d+) merged claimed=yes$/;

function oneOf<T extends string>(allowed: readonly T[], value: string): T | undefined {
  return allowed.find((candidate) => candidate === value);
}

type Field = { readonly name: string; readonly value: string; readonly allowed: readonly string[] };

function firstBadField(fields: readonly Field[]): Field | undefined {
  return fields.find((field) => oneOf(field.allowed, field.value) === undefined);
}

function parseOpen(line: string, m: RegExpExecArray): OpenChange | ParseError {
  const [, number, head, draft, claimed, approved, pipeline, needsHuman, stop, asks] = m as unknown as string[];
  const fields: readonly Field[] = [
    { name: "draft", value: draft!, allowed: YES_NO },
    { name: "claimed", value: claimed!, allowed: YES_NO },
    { name: "approved", value: approved!, allowed: APPROVALS },
    { name: "pipeline", value: pipeline!, allowed: PIPELINES },
    { name: "needs_human", value: needsHuman!, allowed: YES_NO },
    { name: "stop", value: stop!, allowed: YES_NO },
  ];
  const bad = firstBadField(fields);
  if (bad !== undefined) {
    return { kind: "parse-error", line, reason: `unknown ${bad.name}=${bad.value}` };
  }
  return {
    kind: "open",
    number: Number(number),
    head: head!,
    draft: draft as YesNo,
    claimed: claimed as YesNo,
    approved: approved as Approval,
    pipeline: pipeline as Pipeline,
    needsHuman: needsHuman as YesNo,
    stop: stop as YesNo,
    asks: Number(asks),
  };
}

type Rule = { readonly pattern: RegExp; readonly build: (line: string, m: RegExpExecArray) => PollLine };

const RULES: readonly Rule[] = [
  { pattern: OPEN_LINE, build: parseOpen },
  { pattern: MERGED_LINE, build: (_line, m) => ({ kind: "merged", number: Number(m[1]), claimed: "yes" }) },
];

export function parseLine(line: string): PollLine {
  for (const rule of RULES) {
    const m = rule.pattern.exec(line);
    if (m !== null) {
      return rule.build(line, m);
    }
  }
  return { kind: "parse-error", line, reason: "line matches no known poll format" };
}

export function splitLines(stdout: string): readonly string[] {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function parseOutput(stdout: string): readonly PollLine[] {
  return splitLines(stdout).map(parseLine);
}

export function defaultPollScript(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..", "scripts", "poll.sh");
}

// Runs poll.sh with the caller's environment, so the forge settings (FACTORY_*) and the CLI logins pass through.
export function runPoll(script: string = defaultPollScript()): Promise<PollResult> {
  return new Promise((resolve) => {
    execFile(script, [], { env: process.env, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error === null) {
        resolve({ kind: "ok", raw: splitLines(stdout), lines: parseOutput(stdout) });
        return;
      }
      const exitCode = typeof error.code === "number" ? error.code : 1;
      resolve({ kind: "failed", exitCode, stderr: stderr.length > 0 ? stderr : error.message });
    });
  });
}
