// variables — the machine keys, each with the FACTORY_* variable that is its lowest layer (#254), and the checks of a
// file value. A leaf: machine.ts reads it, and the bundled git host plugins hold machine.ts, so it imports no module
// at run time (scripts/build-plugins.mjs).

import { HOURS_HINT, hoursOf, within } from "../dispatch/hours.js";
import type { Check, KeyClass, MachineKey } from "./keys.js";

export function word(value: unknown): boolean {
  return typeof value === "string" && value !== "" && !value.includes("\u0000");
}

function words(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0 && value.every(word);
}

export const oneOf =
  (values: readonly string[]): Check =>
  (value) =>
    typeof value === "string" && values.includes(value) ? "" : `one of ${values.map((v) => `"${v}"`).join(", ")}`;

export const wholeNumber =
  (most: number): Check =>
  (value) =>
    Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= most
      ? ""
      : `a whole number from 1 to ${most}`;

export const list: Check = (value) => (words(value) ? "" : 'a list of words, such as ["make"]');

const text: Check = (value) => (word(value) ? "" : "a word");

// listText : a list key's variable as a list: a JSON list of words, as runEnv writes it, or words split on ":", as a
// person writes PATH; "bad" for anything else. Pure.
export function listText(value: string): readonly string[] | "bad" {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[")) {
    return trimmed.split(":").filter((w) => w !== "");
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return Array.isArray(parsed) && parsed.every(word) ? parsed : "bad";
  } catch {
    return "bad";
  }
}

// what a folder list must hold, for its refusal
export const FOLDERS_HINT = 'a list of folders under your home, such as ["~/.cargo"]';

const folders: Check = (value) => (words(value) ? "" : FOLDERS_HINT);

// pinnedModel : true for a model's full id, one that names its version, such as "claude-sonnet-5-5"; false for an
// alias ("sonnet", "opus", "sonnet[1m]", "...-latest"), which the agent CLI moves to a new model with no PR here
// (ADR-0015 E9, #213). Pure.
export function pinnedModel(value: unknown): boolean {
  return typeof value === "string" && /^[A-Za-z][\w.:@/-]*\d[\w.:@/-]*(\[1m\])?$/.test(value) && !/latest/i.test(value);
}

// what a pinned model key must hold, for its refusal
export const PINNED_HINT = 'a full model id, such as "claude-sonnet-5-5", never an alias such as "sonnet"';

const pinned: Check = (value) => (pinnedModel(value) ? "" : PINNED_HINT);

const dollars: Check = (value) =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? "" : "a dollar amount above 0, such as 2 or 0.5";

const runHours: Check = (value) => (hoursOf(value) === "bad" ? HOURS_HINT : "");

const DRY: readonly string[] = ["0", "1"];

// the runner kinds, from the loosest to the strictest (#114): none runs no runner, so no run starts; srt is Anthropic's
// sandbox runtime on a laptop; vm is a container with its own Docker under Sysbox. A lower layer may only climb.
export const RUNNERS = ["none", "srt", "vm"] as const;

// a file path a value names: absolute, so it means the same file wherever the factory runs. Pure.
const absolutePath: Check = (value) =>
  typeof value === "string" && value.startsWith("/") && !value.includes("\u0000") ? "" : "an absolute file path";

// where a project's specs live (#381), from the loosest to the strictest: issue, the git host issue's body, for a
// personal project; local, <home>/specs, the work rule and the default. A ladder: a team or user file that says local
// holds every project to it, and no lower layer may move a spec onto the git host.
export const SPEC_STORES = ["issue", "local"] as const;
export type SpecStoreKind = (typeof SPEC_STORES)[number];

// how a run's questions are asked: all at once, as one numbered round of choices (the default), or one at a time
// (#320)
export const QUESTIONS = ["round", "one-at-a-time"] as const;
export type Questions = (typeof QUESTIONS)[number];

// the most tokens a token cap may hold
const MOST_TOKENS = 1_000_000_000_000;

const MACHINE_CHECK: Readonly<Record<KeyClass, Check>> = {
  ladder: oneOf(DRY),
  cap: wholeNumber(999),
  "allow-list": list,
  "deny-list": list,
  locked: text,
  preference: text,
};

// a project on the git host: owner/name on GitHub, the full path on GitLab; forge/target.ts checks it in full. Pure.
const hostProject: Check = (value) =>
  typeof value === "string" && /^[\w.-]+(\/[\w.-]+)+$/.test(value)
    ? ""
    : 'the project on the git host, such as "chiyanram/ledger"';

function machine<const I extends string>(
  id: I,
  env: string,
  keyClass: KeyClass,
  about: string,
  check: Check = MACHINE_CHECK[keyClass],
  ladder: readonly string[] = DRY,
): MachineKey & { readonly id: I } {
  const common = { id, where: "machine", env, class: keyClass, path: id.split("."), check, about } as const;
  return keyClass === "ladder" ? { ...common, ladder } : common;
}

export const MACHINE_KEYS = [
  machine("dryRun", "FACTORY_DRY_RUN", "ladder", "1 shows each write on the git host and makes none"),
  machine("gitHost", "FACTORY_FORGE", "locked", "the git host's kind: gitlab or github"),
  machine("gitHostName", "FACTORY_FORGE_HOST", "locked", "the git host's name, when it is not the public one"),
  {
    ...machine(
      "gitHostProject",
      "FACTORY_PROJECT",
      "preference",
      "the project on the git host: owner/name on GitHub, the full path on GitLab; the project file only (#369)",
      hostProject,
    ),
    projectOnly: true,
  },
  {
    ...machine(
      "clone",
      "FACTORY_REPO",
      "preference",
      "the project's clone on this machine, an absolute path; the project file only (#369)",
      absolutePath,
    ),
    projectOnly: true,
  },
  machine(
    "specStore",
    "FACTORY_SPEC_STORE",
    "ladder",
    "where the specs live: local, <home>/specs (the default, the work rule), or issue, the git host issue's body, for a personal project; local wins (#381)",
    oneOf(SPEC_STORES),
    SPEC_STORES,
  ),
  machine("identity", "FACTORY_IDENTITY", "locked", "own (your gh or glab login) or app (a GitHub App)"),
  machine(
    "runner",
    "FACTORY_BOX",
    "ladder",
    "the runner kind: none < srt < vm, the strictest wins; none starts no run (#114)",
    oneOf(RUNNERS),
    RUNNERS,
  ),
  machine(
    "srt.readOnly",
    "FACTORY_SRT_READ_ONLY",
    "allow-list",
    "the srt runner: more folders under your home it allows back read-only, such as a toolchain no known manager holds (#371)",
    folders,
  ),
  machine("egress.image", "FACTORY_EGRESS_IMAGE", "locked", "the egress proxy's image, pinned by digest"),
  machine("egress.upstreamProxy", "FACTORY_UPSTREAM_PROXY", "preference", "at work: the company proxy, host:port"),
  machine(
    "egress.caCerts",
    "NODE_EXTRA_CA_CERTS",
    "preference",
    "at work: the company CA's PEM file, which the srt runner and its agent trust besides the usual roots (#114)",
    absolutePath,
  ),
  machine("rulebook", "FACTORY_RULEBOOK", "locked", "the rulebook plugin's folder"),
  machine("review.findPrompt", "FACTORY_REVIEW_FIND", "locked", "the automated review's find instructions"),
  machine("review.verifyPrompt", "FACTORY_REVIEW_VERIFY", "locked", "the automated review's verify instructions"),
  machine("caps.usdPerRun", "FACTORY_MAX_USD", "cap", "the most one model run may spend, in US dollars", dollars),
  machine(
    "review.maxFinders",
    "FACTORY_MAX_FINDERS",
    "cap",
    "the most finder runs one review round runs at once; the round counts as one run (default 4)",
    wholeNumber(16),
  ),
  machine(
    "caps.liveRuns",
    "FACTORY_MAX_RUNS",
    "cap",
    "runs at once: the most runs one dispatch pass starts, and the most live runs a review allows (default 1)",
  ),
  {
    ...machine(
      "runHours",
      "FACTORY_RUN_HOURS",
      "cap",
      'the hours, in UTC, in which dispatch may start a run, such as "22-06"; a lower layer may only narrow them',
      runHours,
    ),
    within,
  },
  machine(
    "caps.usdPerTicket",
    "FACTORY_MAX_USD_TICKET",
    "cap",
    "the most a ticket's runs may spend since its approval, in US dollars; then needs-human",
    dollars,
  ),
  machine(
    "caps.tokensPerTicket",
    "FACTORY_MAX_TOKENS_TICKET",
    "cap",
    "the most tokens a ticket's runs may spend since its approval; then needs-human",
    wholeNumber(MOST_TOKENS),
  ),
  machine(
    "caps.usdPerProjectDay",
    "FACTORY_MAX_USD_DAY",
    "cap",
    "the most a project's runs may spend in a UTC day, in US dollars; then no new run that day",
    dollars,
  ),
  machine(
    "caps.tokensPerProjectDay",
    "FACTORY_MAX_TOKENS_DAY",
    "cap",
    "the most tokens a project's runs may spend in a UTC day; then no new run that day",
    wholeNumber(MOST_TOKENS),
  ),
  machine(
    "caps.windowTokens",
    "FACTORY_WINDOW_TOKENS",
    "cap",
    "the project's share of a subscription window, in tokens: the stop line; then no new run until the window has room",
    wholeNumber(MOST_TOKENS),
  ),
  machine(
    "caps.machineWindowTokens",
    "FACTORY_MACHINE_WINDOW_TOKENS",
    "cap",
    "every project's share of a subscription window on this machine, in tokens: the machine's stop line",
    wholeNumber(MOST_TOKENS),
  ),
  machine(
    "eval.judgeUsdPerRun",
    "FACTORY_JUDGE_MAX_USD",
    "cap",
    "the most one judge run of the eval may spend, in US dollars",
    dollars,
  ),
  machine(
    "eval.judgeModel",
    "FACTORY_JUDGE_MODEL",
    "preference",
    "the eval judge's model: a full model id, never an alias",
    pinned,
  ),
  machine(
    "window.hours",
    "FACTORY_WINDOW_HOURS",
    "preference",
    "the length of the subscription's usage window, in hours, for usage (default 5)",
    wholeNumber(24),
  ),
  machine("caps.gitHostTries", "FACTORY_MAX_TRIES", "cap", "the most tries of one git host call"),
  machine("implementer.minutes", "FACTORY_WRITER_MINUTES", "cap", "the implementer's time per run", wholeNumber(240)),
  machine(
    "implementer.stallMinutes",
    "FACTORY_WRITER_STALL_MINUTES",
    "cap",
    "silence that stops a run",
    wholeNumber(5),
  ),
  machine("implementer.model", "FACTORY_WRITER_MODEL", "preference", "the implementer's model"),
  machine(
    "review.findModel",
    "FACTORY_FIND_MODEL",
    "preference",
    "the finder's model: a full model id, never an alias",
    pinned,
  ),
  machine(
    "review.ruleModel",
    "FACTORY_RULE_MODEL",
    "preference",
    "the rule finder's model: a full model id, never an alias",
    pinned,
  ),
  machine(
    "review.logicModel",
    "FACTORY_LOGIC_MODEL",
    "preference",
    "the logic finder's model: a full model id, never an alias",
    pinned,
  ),
  machine("claimLabel", "FACTORY_CLAIM_LABEL", "preference", "the label a claimed PR carries"),
  machine(
    "poll.minutes",
    "FACTORY_POLL_MINUTES",
    "preference",
    "how often the git host is polled (default 5)",
    wholeNumber(60),
  ),
  machine(
    "questions",
    "FACTORY_QUESTIONS",
    "preference",
    "how a run asks: round, every open question at once with choices and a recommendation (default), or one-at-a-time",
    oneOf(QUESTIONS),
  ),
  machine(
    "quietMinutes",
    "FACTORY_QUIET_MINUTES",
    "preference",
    "how long an open question may sit",
    wholeNumber(999_999),
  ),
] as const;

// the name of a machine key, for machine.ts settingOf
export type MachineId = (typeof MACHINE_KEYS)[number]["id"];
