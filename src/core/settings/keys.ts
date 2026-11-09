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
// Every class but preference is a safety key: it only gets stricter in a lower layer. A file key is read from the
// files (team, project, user). A machine key is read from the files too, at its dotted name, and from its FACTORY_*
// variable, the lowest layer (#254); a module reads its resolved value only through machine.ts, never the variable
// (test/settings-read.test.ts fails on a direct read).

import { DEFAULT_POLICY, MAX_CAP, MODES, POLICY_POINTS } from "../plugin/policy.js";
import { checkPluginList } from "../process/plugins.js";
import { TEST_FILES } from "../ready/floor.js";
import { list, MACHINE_KEYS, oneOf, type MachineId, wholeNumber, word } from "./variables.js";

export type { MachineId } from "./variables.js";

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

type Held = Common & {
  // where the files hold it, in the JSON object
  readonly path: readonly string[];
  readonly check: Check;
  // a ladder's values, from the loosest to the strictest
  readonly ladder?: readonly string[];
  // the value when no layer sets it, if there is one
  readonly fallback?: unknown;
  // the engine's own value, which no layer can change (the approval floor)
  readonly fixed?: unknown;
  // true when no project file reader checks it, so the layers check the project's value too
  readonly checkProject?: true;
};

// a key the files hold, at its path of the JSON object
export type FileKey = Held & { readonly where: "file" };

// a key the files hold at its dotted name, with its FACTORY_* variable as the machine layer below them (#254)
export type MachineKey = Held & { readonly where: "machine"; readonly env: string };

export type Key = FileKey | MachineKey;

const hosts: Check = (value) =>
  Array.isArray(value) && value.every(word) ? "" : 'a list of host names, such as ["api.anthropic.com"]';

const flag: Check = (value) => (typeof value === "boolean" ? "" : "true or false");

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
    id: "ready.judgeFiles",
    where: "file",
    path: ["ready", "judgeFiles"],
    class: "deny-list",
    check: list,
    fallback: [],
    about: "the judge files this project adds to the built-in ones (read by ready/judge.ts judgeFiles, #231)",
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
  {
    id: "work",
    where: "file",
    path: ["work"],
    class: "ladder",
    ladder: [false, true].map(String),
    check: flag,
    fallback: false,
    checkProject: true,
    about:
      "true for a work project: nothing is ever committed to its product repo (P9); once set, no lower layer unsets it",
  },
  {
    id: "repoCommits",
    where: "file",
    path: ["repoCommits"],
    class: "ladder",
    ladder: [true, false].map(String),
    check: flag,
    fallback: false,
    checkProject: true,
    about:
      "true lets the factory commit the spec, the brief and the glossary to the product repo (P9); refused at work",
  },
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

export function machineKeys(): readonly (MachineKey & { readonly id: MachineId })[] {
  return MACHINE_KEYS;
}

export function keyById(id: string): Key | undefined {
  return KEYS.find((k) => k.id === id);
}
