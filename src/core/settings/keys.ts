// keys — every settings key, and its class, fixed in code (#229; docs/DESIGN.md section 5 "Settings"). The class says
// how the layers combine (resolve.ts):
//
//   ladder      the strictest value wins; a lower layer may only climb      (dry run, a policy mode)
//   cap         the lowest value wins; a lower layer may only lower it      (a timeout, a policy cap)
//   allow-list  the team's entries stay; a lower layer adds only where the team marks the key open
//   deny-list   all layers add                                               (test files, one-way-door paths)
//   locked      the highest layer that sets it wins; a lower layer may only repeat it
//   preference  the lowest layer wins                                        (a model, a label)
//
// Every class but preference is a safety key: it only gets stricter in a lower layer. A key is read from the files
// (team, project, user) or, for now, from its FACTORY_* variable only (the machine layer, machine.ts): those modules
// still read their variable themselves, so a file value for one is not used yet and is reported, never applied.

import { DEFAULT_POLICY, MAX_CAP, MODES, POLICY_POINTS } from "../plugin/policy.js";
import { checkPluginList } from "../process/plugins.js";
import { TEST_FILES } from "../ready/floor.js";

export const CLASSES = ["ladder", "cap", "allow-list", "deny-list", "locked", "preference"] as const;
export type KeyClass = (typeof CLASSES)[number];

// the ready check's timeout per command, in minutes (project.ts reads it)
export const READY_MINUTES = { default: 30, most: 240 } as const;

// a check of one value from a team or user file: "" when it is good, else what it must be
export type Check = (value: unknown) => string;

type Common = {
  // the dotted name, as config show prints it
  readonly id: string;
  readonly class: KeyClass;
  // what it is, for config show and the docs
  readonly about: string;
};

// a key the files hold, at this path of the JSON object
export type FileKey = Common & {
  readonly where: "file";
  readonly path: readonly string[];
  readonly check: Check;
  // a ladder's values, from the loosest to the strictest
  readonly ladder?: readonly string[];
  // the value when no layer sets it, if there is one
  readonly fallback?: unknown;
  // the engine's own value, which no layer can change (the approval floor)
  readonly fixed?: unknown;
};

// a key read from its FACTORY_* variable only, for now
export type MachineKey = Common & {
  readonly where: "machine";
  readonly env: string;
  readonly ladder?: readonly string[];
};

export type Key = FileKey | MachineKey;

function word(value: unknown): boolean {
  return typeof value === "string" && value !== "" && !value.includes("\u0000");
}

function words(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0 && value.every(word);
}

const oneOf =
  (values: readonly string[]): Check =>
  (value) =>
    typeof value === "string" && values.includes(value) ? "" : `one of ${values.map((v) => `"${v}"`).join(", ")}`;

const wholeNumber =
  (most: number): Check =>
  (value) =>
    Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= most
      ? ""
      : `a whole number from 1 to ${most}`;

const list: Check = (value) => (words(value) ? "" : 'a list of words, such as ["make"]');

const hosts: Check = (value) =>
  Array.isArray(value) && value.every(word) ? "" : 'a list of host names, such as ["api.anthropic.com"]';

const map: Check = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value) && Object.values(value).every(word)
    ? ""
    : 'a map of names, such as {"notify": "discord"}';

function policyKeys(point: (typeof POLICY_POINTS)[number]): readonly FileKey[] {
  return [
    {
      id: `policy.${point}.mode`,
      where: "file",
      path: ["policy", point, "mode"],
      class: "ladder",
      ladder: MODES,
      check: oneOf(MODES),
      fallback: DEFAULT_POLICY[point].mode,
      about: `whether the coordinator may request ${point} (ADR-0014 P5)`,
    },
    {
      id: `policy.${point}.cap`,
      where: "file",
      path: ["policy", point, "cap"],
      class: "cap",
      check: wholeNumber(MAX_CAP),
      fallback: DEFAULT_POLICY[point].cap,
      about: `how many ${point} writes a ticket may request since its latest approval`,
    },
  ];
}

const FILE_KEYS: readonly FileKey[] = [
  {
    id: "gate",
    where: "file",
    path: ["gate"],
    class: "locked",
    check: oneOf(["forge-ci", "local"]),
    about: "where the gate's result comes from",
  },
  {
    id: "verify",
    where: "file",
    path: ["verify"],
    class: "locked",
    check: list,
    about: "the local verifier's one command, run with no shell",
  },
  {
    id: "ready.programs",
    where: "file",
    path: ["ready", "programs"],
    class: "allow-list",
    check: list,
    about: "the programs an evidence row may start with",
  },
  {
    id: "ready.timeoutMinutes",
    where: "file",
    path: ["ready", "timeoutMinutes"],
    class: "cap",
    check: wholeNumber(READY_MINUTES.most),
    fallback: READY_MINUTES.default,
    about: "the ready check's time per command",
  },
  {
    id: "ready.testFiles",
    where: "file",
    path: ["ready", "testFiles"],
    class: "deny-list",
    check: list,
    fallback: TEST_FILES,
    about: "the globs the test checks read as test files",
  },
  {
    id: "egress.allow",
    where: "file",
    path: ["egress", "allow"],
    class: "allow-list",
    check: hosts,
    fallback: [],
    about: "the hosts the project's runners may reach",
  },
  {
    id: "connectors",
    where: "file",
    path: ["connectors"],
    class: "locked",
    check: map,
    fallback: {},
    about: "the connector that serves each extension point (ADR-0014 P3)",
  },
  {
    id: "plugins",
    where: "file",
    path: ["plugins"],
    class: "locked",
    check: checkPluginList,
    fallback: [],
    about: "the plugins the project installs, each name@marketplace, in order; none runs the built-in process",
  },
  ...POLICY_POINTS.flatMap(policyKeys),
  {
    id: "lanes.oneWayDoor",
    where: "file",
    path: ["lanes", "oneWayDoor"],
    class: "deny-list",
    check: list,
    fallback: [],
    about: "the paths whose change is a one-way door (read by the lane check, #230)",
  },
  {
    id: "approval.floor",
    where: "file",
    path: ["approval", "floor"],
    class: "locked",
    check: oneOf(["tiny"]),
    fixed: "tiny",
    about: "no lane above this one starts without a human approval; no layer or plugin can change it",
  },
];

const DRY: readonly string[] = ["0", "1"];

function machine(id: string, env: string, keyClass: KeyClass, about: string): MachineKey {
  return keyClass === "ladder"
    ? { id, where: "machine", env, class: keyClass, ladder: DRY, about }
    : { id, where: "machine", env, class: keyClass, about };
}

const MACHINE_KEYS: readonly MachineKey[] = [
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
  machine("caps.usdPerRun", "FACTORY_MAX_USD", "cap", "the most one model run may spend, in US dollars"),
  machine("caps.liveRuns", "FACTORY_MAX_RUNS", "cap", "the most live runs on this machine"),
  machine("caps.gitHostTries", "FACTORY_MAX_TRIES", "cap", "the most tries of one git host call"),
  machine("implementer.minutes", "FACTORY_WRITER_MINUTES", "cap", "the implementer's time per run"),
  machine("implementer.stallMinutes", "FACTORY_WRITER_STALL_MINUTES", "cap", "silence that stops a run"),
  machine("implementer.model", "FACTORY_WRITER_MODEL", "preference", "the implementer's model"),
  machine("review.findModel", "FACTORY_FIND_MODEL", "preference", "the finder's model"),
  machine("review.ruleModel", "FACTORY_RULE_MODEL", "preference", "the rule finder's model"),
  machine("review.logicModel", "FACTORY_LOGIC_MODEL", "preference", "the logic finder's model"),
  machine("claimLabel", "FACTORY_CLAIM_LABEL", "preference", "the label a claimed PR carries"),
  machine("quietMinutes", "FACTORY_QUIET_MINUTES", "preference", "how long an open question may sit"),
];

export const KEYS: readonly Key[] = [...FILE_KEYS, ...MACHINE_KEYS];

// the keys a file layer may hold besides the settings: the project's team pin, and the team's mode per key
export const PROJECT_META = "team";
export const TEAM_META = "modes";

export function isSafety(key: Key): boolean {
  return key.class !== "preference";
}

export function fileKeys(): readonly FileKey[] {
  return FILE_KEYS;
}

export function machineKeys(): readonly MachineKey[] {
  return MACHINE_KEYS;
}

export function keyById(id: string): Key | undefined {
  return KEYS.find((k) => k.id === id);
}
