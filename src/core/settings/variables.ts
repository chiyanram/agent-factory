// variables — the machine keys, each with the FACTORY_* variable that is its lowest layer (#254), and the checks of a
// file value. A leaf: machine.ts reads it, and the bundled git host plugins hold machine.ts, so it imports no module
// at run time (scripts/build-plugins.mjs).

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

const dollars: Check = (value) =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? "" : "a dollar amount above 0, such as 2 or 0.5";

const DRY: readonly string[] = ["0", "1"];

const MACHINE_CHECK: Readonly<Record<KeyClass, Check>> = {
  ladder: oneOf(DRY),
  cap: wholeNumber(999),
  "allow-list": list,
  "deny-list": list,
  locked: text,
  preference: text,
};

function machine<const I extends string>(
  id: I,
  env: string,
  keyClass: KeyClass,
  about: string,
  check: Check = MACHINE_CHECK[keyClass],
): MachineKey & { readonly id: I } {
  const common = { id, where: "machine", env, class: keyClass, path: id.split("."), check, about } as const;
  return keyClass === "ladder" ? { ...common, ladder: DRY } : common;
}

export const MACHINE_KEYS = [
  machine("dryRun", "FACTORY_DRY_RUN", "ladder", "1 shows each write on the git host and makes none"),
  machine("gitHost", "FACTORY_FORGE", "locked", "the git host's kind: gitlab or github"),
  machine("gitHostName", "FACTORY_FORGE_HOST", "locked", "the git host's name, when it is not the public one"),
  machine("identity", "FACTORY_IDENTITY", "locked", "own (your gh or glab login) or app (a GitHub App)"),
  machine("runner", "FACTORY_BOX", "locked", "where a runner runs: vm"),
  machine("egress.image", "FACTORY_EGRESS_IMAGE", "locked", "the egress proxy's image, pinned by digest"),
  machine("egress.upstreamProxy", "FACTORY_UPSTREAM_PROXY", "preference", "at work: the company proxy, host:port"),
  machine("rulebook", "FACTORY_RULEBOOK", "locked", "the rulebook plugin's folder"),
  machine("review.findPrompt", "FACTORY_REVIEW_FIND", "locked", "the automated review's find instructions"),
  machine("review.verifyPrompt", "FACTORY_REVIEW_VERIFY", "locked", "the automated review's verify instructions"),
  machine("caps.usdPerRun", "FACTORY_MAX_USD", "cap", "the most one model run may spend, in US dollars", dollars),
  machine("caps.liveRuns", "FACTORY_MAX_RUNS", "cap", "the most live runs on this machine"),
  machine(
    "eval.judgeUsdPerRun",
    "FACTORY_JUDGE_MAX_USD",
    "cap",
    "the most one judge run of the eval may spend, in US dollars",
    dollars,
  ),
  machine("eval.judgeModel", "FACTORY_JUDGE_MODEL", "preference", "the eval judge's model"),
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
  machine("review.findModel", "FACTORY_FIND_MODEL", "preference", "the finder's model"),
  machine("review.ruleModel", "FACTORY_RULE_MODEL", "preference", "the rule finder's model"),
  machine("review.logicModel", "FACTORY_LOGIC_MODEL", "preference", "the logic finder's model"),
  machine("claimLabel", "FACTORY_CLAIM_LABEL", "preference", "the label a claimed PR carries"),
  machine(
    "poll.minutes",
    "FACTORY_POLL_MINUTES",
    "preference",
    "how often the git host is polled (default 5)",
    wholeNumber(60),
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
