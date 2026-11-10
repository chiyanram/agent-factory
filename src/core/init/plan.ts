// plan — what `agent-factory init` asks and what it writes (#369): the round's questions, built from what detect found
// and what the files already hold, and the settings each answer becomes, compared with the files key by key. A key
// the files already set is not asked again. A list key only grows: the file's own entries stay. A value that would
// replace one the file holds is a change the person sees as a diff and says yes to first. Pure.

import { settingName } from "../settings/machine.js";
import { canonical } from "../settings/resolve.js";
import { MODEL_HOST, type Detected } from "./detect.js";
import { valueOf, type Question } from "./round.js";

// the process plugin init recommends, and the marketplace it comes from (GUIDE "The project file")
export const DEFAULT_PLUGIN = "rulebook@chiyanram";

export type Entry = { readonly path: readonly string[]; readonly value: unknown };

export type Change =
  | { readonly kind: "add"; readonly entry: Entry }
  | { readonly kind: "same"; readonly entry: Entry }
  | { readonly kind: "replace"; readonly entry: Entry; readonly was: unknown };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// at : the value at a path of a JSON object, or undefined
export function at(value: unknown, path: readonly string[]): unknown {
  let here: unknown = value;
  for (const part of path) {
    if (!isObject(here) || !Object.hasOwn(here, part)) {
      return undefined;
    }
    here = here[part];
  }
  return here;
}

type Existing = { readonly project: object; readonly user: object; readonly env: NodeJS.ProcessEnv };

function isSet(existing: object, path: readonly string[]): boolean {
  return at(existing, path) !== undefined;
}

function projectQuestion(d: Detected): Question {
  const where = d.hostName === "" ? d.host : `${d.host} at ${d.hostName}`;
  return {
    id: "gitHostProject",
    text: "Which project on the git host is this clone? (from its origin)",
    choices: [
      { label: `${where}: ${d.project}`, value: d.project },
      { label: "neither: stop here and write nothing (fix origin first)", value: "stop" },
    ],
    recommended: 0,
  };
}

function runnerQuestion(env: NodeJS.ProcessEnv): Question {
  const vm = env[settingName("runner")] === "vm";
  return {
    id: "runner",
    text: "Where do runs run on this machine? (saved in your user.json, for every project)",
    choices: [
      {
        label: "srt: Anthropic's sandbox runtime on this laptop; no Docker in a run, container tests run on CI",
        value: "srt",
      },
      { label: "vm: a container with its own Docker under Sysbox, on a VM", value: "vm" },
    ],
    recommended: vm ? 1 : 0,
  };
}

function verifyOf(d: Detected): readonly string[] {
  return d.builds[0]?.verify ?? ["make", "test"];
}

function gateQuestion(d: Detected): Question {
  const ci = d.ci.length > 0;
  return {
    id: "gate",
    text: "What is the gate, the full test run before you are pinged?",
    choices: [
      {
        label: ci
          ? `forge-ci: the git host's CI (${d.ci.join(", ")}); it runs the tests a run cannot, such as Testcontainers`
          : "forge-ci: the git host's CI (none found in the clone)",
        value: "forge-ci",
      },
      { label: `local: the factory runs \`${verifyOf(d).join(" ")}\` in a runner at each head`, value: "local" },
    ],
    recommended: ci ? 0 : 1,
  };
}

function pluginsQuestion(): Question {
  return {
    id: "plugins",
    text: "Which plugins does the project install?",
    choices: [
      { label: `${DEFAULT_PLUGIN}: the rulebook, the process and the review references`, value: [DEFAULT_PLUGIN] },
      { label: "none: the engine's built-in process only (the automated review cannot run)", value: [] },
    ],
    recommended: 0,
  };
}

function doorsQuestion(d: Detected): Question {
  const globs = d.oneWayDoor.map((o) => o.glob);
  const tools = [...new Set(d.oneWayDoor.map((o) => o.tool))].join(" and ");
  return {
    id: "lanes.oneWayDoor",
    text: `Are the ${tools} migrations one-way doors? (a change to them needs the one-way-door lane)`,
    choices: [
      { label: `yes: ${globs.join(", ")}`, value: globs },
      { label: "no", value: [] },
    ],
    recommended: 0,
  };
}

// atWork : the project or the user file marks it work (the work key, a ladder: true in either holds)
function atWork(existing: Existing): boolean {
  return at(existing.project, ["work"]) === true || at(existing.user, ["work"]) === true;
}

// specStoreQuestion : where the specs live (#381). A personal project on github.com or gitlab.com keeps its spec on the
// issue; one on a company's own git host is likely work, so local is recommended there. A work project is not asked:
// the spec stays local, and the settings refuse the issue store.
function specStoreQuestion(d: Detected): Question {
  const personal = d.hostName === "";
  return {
    id: "specStore",
    text: "Where do the ticket specs live?",
    choices: [
      {
        label: `issue: the ${d.host === "github" ? "GitHub" : "GitLab"} issue's body is the spec, and the ticket is the issue number; for a personal project`,
        value: "issue",
      },
      {
        label: "local: <factory home>/specs/<project>/<ticket>/spec.md, never on the git host; the rule at work",
        value: "local",
      },
    ],
    recommended: personal ? 0 : 1,
  };
}

// questionsFor : the round, without the questions whose key the files already set
export function questionsFor(d: Detected, existing: Existing): readonly Question[] {
  const all: readonly (readonly [Question, object, readonly string[]])[] = [
    [projectQuestion(d), existing.project, ["gitHostProject"]],
    [runnerQuestion(existing.env), existing.user, ["runner"]],
    [gateQuestion(d), existing.project, ["gate"]],
    [pluginsQuestion(), existing.project, ["plugins"]],
    ...(d.oneWayDoor.length > 0 ? [[doorsQuestion(d), existing.project, ["lanes", "oneWayDoor"]] as const] : []),
    ...(atWork(existing) ? [] : [[specStoreQuestion(d), existing.project, ["specStore"]] as const]),
  ];
  return all.filter(([, file, path]) => !isSet(file, path)).map(([q]) => q);
}

function union(lists: readonly (readonly string[])[]): readonly string[] {
  return [...new Set(lists.flat())];
}

// asked : a question's answer, else what the file already holds
function asked(questions: readonly Question[], picks: readonly number[], id: string, held: unknown): unknown {
  return valueOf(questions, picks, id) ?? held;
}

// only : the entry when the condition holds, else none
function only(holds: boolean, entry: Entry): readonly Entry[] {
  return holds ? [entry] : [];
}

function programsOf(d: Detected): readonly string[] {
  const programs = union(d.builds.map((b) => b.programs));
  return programs.length > 0 ? programs : ["make"];
}

function nonEmpty(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

// projectEntries : the project file's settings from the clone and the answers
export function projectEntries(
  d: Detected,
  answered: { readonly questions: readonly Question[]; readonly picks: readonly number[]; readonly project: object },
): readonly Entry[] {
  const pick = (id: string, path: readonly string[]): unknown =>
    asked(answered.questions, answered.picks, id, at(answered.project, path));
  const gate = pick("gate", ["gate"]);
  const doors = pick("lanes.oneWayDoor", ["lanes", "oneWayDoor"]);
  const specs = pick("specStore", ["specStore"]);
  return [
    { path: ["gitHost"], value: d.host },
    ...only(d.hostName !== "", { path: ["gitHostName"], value: d.hostName }),
    { path: ["gitHostProject"], value: asked(answered.questions, answered.picks, "gitHostProject", d.project) },
    { path: ["clone"], value: d.clone },
    { path: ["gate"], value: gate },
    ...only(gate === "local", { path: ["verify"], value: verifyOf(d) }),
    { path: ["ready", "programs"], value: programsOf(d) },
    ...only(d.testFiles !== "default", { path: ["ready", "testFiles"], value: d.testFiles }),
    { path: ["egress", "allow"], value: union([[MODEL_HOST], ...d.builds.map((b) => b.egress)]) },
    ...only(nonEmpty(doors), { path: ["lanes", "oneWayDoor"], value: doors }),
    { path: ["plugins"], value: pick("plugins", ["plugins"]) },
    ...only(specs !== undefined, { path: ["specStore"], value: specs }),
  ];
}

function strings(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) && value.every((v) => typeof v === "string") ? value : undefined;
}

// listsOf : the file's list and the wanted one, when both are lists of words and the key is not plugins
function listsOf(entry: Entry, was: unknown): readonly [readonly string[], readonly string[]] | undefined {
  const [held, wanted] = [strings(was), strings(entry.value)];
  return held === undefined || wanted === undefined || entry.path[0] === "plugins" ? undefined : [held, wanted];
}

// grown : a list key's change: the same when the file's entries cover the wanted ones, else the file's own entries
// with the missing ones after them
function grown(entry: Entry, was: unknown, held: readonly string[], wanted: readonly string[]): Change {
  const missing = wanted.filter((w) => !held.includes(w));
  return missing.length === 0
    ? { kind: "same", entry: { ...entry, value: was } }
    : { kind: "replace", entry: { ...entry, value: [...held, ...missing] }, was };
}

// changeOf : one entry against the file: new, the same, or a replacement; a list grows by the entries it lacks and
// keeps its own, but for plugins, whose order and members are the person's choice
export function changeOf(file: object, entry: Entry): Change {
  const was = at(file, entry.path);
  if (was === undefined) {
    return { kind: "add", entry };
  }
  const lists = listsOf(entry, was);
  if (lists !== undefined) {
    return grown(entry, was, lists[0], lists[1]);
  }
  return canonical(was) === canonical(entry.value) ? { kind: "same", entry } : { kind: "replace", entry, was };
}

// diffLines : the changes as config show names the keys: + new, ~ replaced
export function diffLines(changes: readonly Change[]): readonly string[] {
  return changes.flatMap((c) => {
    const key = c.entry.path.join(".");
    if (c.kind === "add") {
      return [`  + ${key}: ${JSON.stringify(c.entry.value)}`];
    }
    return c.kind === "replace" ? [`  ~ ${key}: ${JSON.stringify(c.was)} -> ${JSON.stringify(c.entry.value)}`] : [];
  });
}

function setAt(target: Record<string, unknown>, path: readonly string[], value: unknown): void {
  const [head, ...rest] = path;
  if (head === undefined) {
    return;
  }
  if (rest.length === 0) {
    target[head] = value;
    return;
  }
  const next = isObject(target[head]) ? target[head] : {};
  target[head] = next;
  setAt(next, rest, value);
}

// applied : the file with each change it takes in place; `replace` false keeps every value it holds
export function applied(file: object, changes: readonly Change[], replace: boolean): object {
  const out: Record<string, unknown> = structuredClone({ ...file });
  for (const c of changes) {
    if (c.kind === "add" || (c.kind === "replace" && replace)) {
      setAt(out, c.entry.path, c.entry.value);
    }
  }
  return out;
}
