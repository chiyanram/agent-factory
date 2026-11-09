// config — the connector fields of the project file on this machine (#134; ADR-0014 P3, P5): which connector serves
// each capability, and the write policy. Read from <home>/projects/<project>.json, never a repo file, so a branch
// cannot loosen its own policy (ADR-0012 S12). Fields this reader does not know are left alone (project.ts reads the
// rest; process/plugins.ts reads the "plugins" list).
//
//   "connectors": { "tracker.comment": "jira", "tracker.create": "jira", "notify": "discord" }
//   "policy":     { "tracker.comment": { "mode": "allow" | "confirm" | "deny", "cap": 5 }, … }
//
// "plugins" was the old name of "connectors" (#232). A "plugins" that holds a map is still read as the connectors for
// one release, and the settings layers warn about it; a "plugins" list is the plugins a project installs.
//
// A policy names only the writes the coordinator may request: tracker.comment, tracker.create and notify. forge.write
// is the dispatcher's and has no policy here. A cap counts the writes since the ticket's latest approval (writes.ts).
// What the file leaves out keeps the defaults (policy.ts); a field that is there but not valid is refused.

import type { Result } from "../forge/api.js";
import { prop } from "../dispatch/records.js";
import { isOldConnectors } from "../process/plugins.js";
import { readProjectRaw } from "../project.js";
import { isPoint, PLUGIN_NAME, type ExtensionPoint } from "./contract.js";
import {
  DEFAULT_POLICY,
  MAX_CAP,
  POLICY_POINTS,
  type Mode,
  type Policy,
  type PolicyPoint,
  type Rule,
} from "./policy.js";

export { DEFAULT_POLICY, MAX_CAP, POLICY_POINTS, type Mode, type Policy, type PolicyPoint, type Rule };

export type PluginConfig = {
  // the connector that serves each extension point, from "connectors" (or the old "plugins" map)
  readonly plugins: ReadonlyMap<ExtensionPoint, string>;
  readonly policy: Policy;
};

function failed(reason: string): { readonly kind: "failed"; readonly reason: string } {
  return { kind: "failed", reason };
}

export function isPolicyPoint(value: unknown): value is PolicyPoint {
  return typeof value === "string" && POLICY_POINTS.some((p) => p === value);
}

function isMap(value: unknown): value is object {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// a value that is not what it should be
const BAD: unique symbol = Symbol("bad");
type Bad = typeof BAD;

function pairOf([point, name]: readonly [string, unknown]): readonly [ExtensionPoint, string] | Bad {
  return isPoint(point) && typeof name === "string" && PLUGIN_NAME.test(name) ? [point, name] : BAD;
}

// the connector map's field: "connectors", or the old "plugins" map when there is no "connectors"
function connectorField(path: string, raw: object): Result<{ readonly name: string; readonly value: unknown }> {
  const [connectors, plugins] = [prop(raw, "connectors"), prop(raw, "plugins")];
  if (connectors !== undefined && isOldConnectors(plugins)) {
    return failed(`${path}: "plugins" is the old name of "connectors"; keep only "connectors"`);
  }
  return isOldConnectors(plugins) && connectors === undefined
    ? { kind: "ok", value: { name: "plugins", value: plugins } }
    : { kind: "ok", value: { name: "connectors", value: connectors } };
}

function connectorsOf(path: string, raw: object): Result<PluginConfig["plugins"]> {
  const field = connectorField(path, raw);
  return field.kind === "failed" ? field : connectorMap(path, field.value);
}

function connectorMap(
  path: string,
  { name, value }: { readonly name: string; readonly value: unknown },
): Result<PluginConfig["plugins"]> {
  if (value === undefined) {
    return { kind: "ok", value: new Map() };
  }
  const pairs = isMap(value) ? Object.entries(value).map(pairOf) : [BAD];
  return pairs.includes(BAD)
    ? failed(`${path}: "${name}" must map extension points to connector names, such as {"notify": "discord"}`)
    : { kind: "ok", value: new Map(pairs.filter((p): p is readonly [ExtensionPoint, string] => p !== BAD)) };
}

function modeOf(value: unknown): Mode | Bad {
  return value === "allow" || value === "confirm" || value === "deny" ? value : BAD;
}

function capOf(value: unknown): number | Bad {
  return Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= MAX_CAP ? Number(value) : BAD;
}

function ruleOf(value: unknown): Rule | Bad {
  const mode = modeOf(prop(value, "mode"));
  const cap = capOf(prop(value, "cap"));
  return isMap(value) && Object.keys(value).length === 2 && mode !== BAD && cap !== BAD ? { mode, cap } : BAD;
}

function entryOf(path: string, [point, value]: readonly [string, unknown]): Result<readonly [PolicyPoint, Rule]> {
  if (point === "forge.write") {
    return failed(`${path}: "policy" has no forge.write; it is the dispatcher's, never the coordinator's`);
  }
  if (!isPolicyPoint(point)) {
    return failed(`${path}: "policy" names ${JSON.stringify(point)}; only ${POLICY_POINTS.join(", ")} have a policy`);
  }
  const rule = ruleOf(value);
  return rule === BAD
    ? failed(`${path}: "policy.${point}" must be {"mode": "allow" | "confirm" | "deny", "cap": 1 to ${MAX_CAP}}`)
    : { kind: "ok", value: [point, rule] };
}

function policyOf(path: string, raw: unknown): Result<Policy> {
  if (raw !== undefined && !isMap(raw)) {
    return failed(`${path}: "policy" must be an object`);
  }
  const read = Object.entries(raw ?? {}).map((e) => entryOf(path, e));
  const bad = read.find((r) => r.kind === "failed");
  if (bad !== undefined) {
    return bad;
  }
  const rules = read.flatMap((r) => (r.kind === "ok" ? [r.value] : []));
  return { kind: "ok", value: { ...DEFAULT_POLICY, ...Object.fromEntries(rules) } };
}

// pluginConfigOf : the connector fields of one project file's JSON
export function pluginConfigOf(path: string, raw: object): Result<PluginConfig> {
  const plugins = connectorsOf(path, raw);
  if (plugins.kind === "failed") {
    return plugins;
  }
  const policy = policyOf(path, prop(raw, "policy"));
  return policy.kind === "ok" ? { kind: "ok", value: { plugins: plugins.value, policy: policy.value } } : policy;
}

// readPluginConfig : the project's connector fields; no project file is refused, since no write may go out without one
export async function readPluginConfig(input: {
  readonly home: string;
  readonly project: string;
}): Promise<Result<PluginConfig>> {
  const raw = await readProjectRaw(input, `run agent-factory project init ${input.project} first`);
  return raw.kind === "ok" ? pluginConfigOf(raw.path, raw.value) : failed(raw.reason);
}

// the file `project init` writes when no template is given: no connector and no plugin yet, and the default policy
export function initialProject(): string {
  return `${JSON.stringify({ connectors: {}, plugins: [], policy: DEFAULT_POLICY }, null, 2)}\n`;
}
