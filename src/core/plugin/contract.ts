// contract — what a plugin is and says (#134; ADR-0014 P1, P8, P11). A plugin is an executable:
//
//   <exe> describe   prints one JSON object: { protocol, name, version, capabilities: [{ name, mandatory? }],
//                    writes: [capability…], env: [NAME…] }
//   <exe> call       reads one JSON request on stdin: { protocol, capability, op, input }, and prints one JSON result
//                    on stdout: { kind, … }, a sealed case of that capability; logs go to stderr
//
// The core runs it with no shell, a timeout and an output cap (exec.ts). This file only reads and checks what a plugin
// says; it runs nothing and throws nothing.

import type { Result } from "../forge/api.js";

// The protocol major this core speaks. It accepts N and N−1; minors only add optional fields (Terraform's rule).
export const PROTOCOL = 1;
export const SUPPORTED: readonly number[] = [PROTOCOL, PROTOCOL - 1].filter((p) => p >= 1);

export const EXTENSION_POINTS = [
  "context.read",
  "tracker.comment",
  "tracker.create",
  "forge.read",
  "forge.write",
  "notify",
  "runner",
  "box",
] as const;
export type ExtensionPoint = (typeof EXTENSION_POINTS)[number];

// the extension points that change something outside: a plugin may only perform the ones it declares
export const WRITE_POINTS: readonly ExtensionPoint[] = ["tracker.comment", "tracker.create", "forge.write", "notify"];

// Names a plugin may never ask for: the model's login and the factory's own push token (ADR-0012 S6).
const FORBIDDEN_ENV = /^(ANTHROPIC_|CLAUDE_CODE_|CLAUDE_|COPILOT_|GITHUB_COPILOT|FACTORY_PUSH_TOKEN$|OPENAI_)/;
const ENV_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;
const PLUGIN_NAME = /^[a-z][a-z0-9-]{0,62}$/;

export type Capability = { readonly name: ExtensionPoint; readonly mandatory: boolean };

export type Described = {
  readonly protocol: number;
  readonly name: string;
  readonly version: string;
  readonly capabilities: readonly Capability[];
  readonly writes: readonly ExtensionPoint[];
  readonly env: readonly string[];
};

export type Request = {
  readonly protocol: number;
  readonly capability: ExtensionPoint;
  readonly op: string;
  readonly input: unknown;
};

// a result: a sealed case named by kind, and its fields as the plugin gave them
export type PluginResult = { readonly kind: string; readonly fields: Readonly<Record<string, unknown>> };

function failed(reason: string): { readonly kind: "failed"; readonly reason: string } {
  return { kind: "failed", reason };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isPoint(value: unknown): value is ExtensionPoint {
  return typeof value === "string" && EXTENSION_POINTS.some((p) => p === value);
}

// oneObject : stdout that is exactly one JSON object, or why not
export function oneObject(stdout: string): Result<Readonly<Record<string, unknown>>> {
  let value: unknown;
  try {
    value = JSON.parse(stdout) as unknown;
  } catch {
    return failed("stdout is not one JSON object");
  }
  return isRecord(value) ? { kind: "ok", value } : failed("stdout is not one JSON object");
}

// a value that is not what it should be
const BAD: unique symbol = Symbol("bad");
type Bad = typeof BAD;

function capabilityOf(value: unknown): Capability | Bad {
  if (!isRecord(value) || !isPoint(value.name)) {
    return BAD;
  }
  const mandatory = value.mandatory ?? false;
  return typeof mandatory === "boolean" ? { name: value.name, mandatory } : BAD;
}

function listOf<T>(value: unknown, each: (v: unknown) => T | Bad): readonly T[] | Bad {
  if (!Array.isArray(value)) {
    return BAD;
  }
  const read = value.map(each);
  return read.includes(BAD) ? BAD : read.filter((r): r is T => r !== BAD);
}

function envName(value: unknown): string | Bad {
  return typeof value === "string" && ENV_NAME.test(value) && !FORBIDDEN_ENV.test(value) ? value : BAD;
}

function writeOf(value: unknown): ExtensionPoint | Bad {
  return isPoint(value) && WRITE_POINTS.includes(value) ? value : BAD;
}

type Parts = {
  readonly capabilities: readonly Capability[];
  readonly writes: readonly ExtensionPoint[];
  readonly env: readonly string[];
};

const SHAPE =
  "describe must list capabilities [{name, mandatory?}] of the known extension points, writes among them, and env names that are not a model login";

function listsOf(raw: Readonly<Record<string, unknown>>): Parts | Bad {
  const capabilities = listOf(raw.capabilities, capabilityOf);
  const writes = listOf(raw.writes, writeOf);
  const env = listOf(raw.env ?? [], envName);
  return capabilities === BAD || writes === BAD || env === BAD ? BAD : { capabilities, writes, env };
}

function partsOf(raw: Readonly<Record<string, unknown>>): Result<Parts> {
  const parts = listsOf(raw);
  if (parts === BAD) {
    return failed(SHAPE);
  }
  const undeclared = parts.writes.find((w) => !parts.capabilities.some((c) => c.name === w));
  return undeclared === undefined
    ? { kind: "ok", value: parts }
    : failed(`describe declares the write ${undeclared}, which is not one of its capabilities`);
}

type Header = { readonly protocol: number; readonly name: string; readonly version: string };

function protocolOf(value: unknown): number | Bad {
  return typeof value === "number" && SUPPORTED.includes(value) ? value : BAD;
}

function nameOf(value: unknown): string | Bad {
  return typeof value === "string" && PLUGIN_NAME.test(value) ? value : BAD;
}

function versionOf(value: unknown): string | Bad {
  return typeof value === "string" && value !== "" ? value : BAD;
}

function headerOf(raw: Readonly<Record<string, unknown>>): Result<Header> {
  const protocol = protocolOf(raw.protocol);
  const name = nameOf(raw.name);
  const version = versionOf(raw.version);
  if (protocol === BAD) {
    return failed(`protocol ${JSON.stringify(raw.protocol)} is not one this core speaks (${SUPPORTED.join(", ")})`);
  }
  if (name === BAD) {
    return failed(`name ${JSON.stringify(raw.name)} must be lower-case letters, digits and dashes`);
  }
  return version === BAD ? failed("describe must give a version") : { kind: "ok", value: { protocol, name, version } };
}

function describedOf(raw: Readonly<Record<string, unknown>>): Result<Described> {
  const header = headerOf(raw);
  if (header.kind === "failed") {
    return header;
  }
  const parts = partsOf(raw);
  return parts.kind === "ok" ? { kind: "ok", value: { ...header.value, ...parts.value } } : parts;
}

// readDescribe : what `<exe> describe` printed, checked field by field
export function readDescribe(stdout: string): Result<Described> {
  const raw = oneObject(stdout);
  const described = raw.kind === "ok" ? describedOf(raw.value) : raw;
  return described.kind === "ok" ? described : failed(`describe: ${described.reason}`);
}

// readResult : what `<exe> call` printed: one object with a kind
export function readResult(stdout: string): Result<PluginResult> {
  const raw = oneObject(stdout);
  if (raw.kind === "failed") {
    return raw;
  }
  const { kind, ...fields } = raw.value;
  return typeof kind === "string" && kind !== ""
    ? { kind: "ok", value: { kind, fields } }
    : failed("the result has no kind");
}

// pluginEnv : the environment a plugin runs with: the trusted PATH, HOME and LANG, and the names it declared
export function pluginEnv(parent: NodeJS.ProcessEnv, declared: readonly string[], path: string): NodeJS.ProcessEnv {
  const named = [...declared, "HOME", "LANG"].filter((n) => !FORBIDDEN_ENV.test(n));
  const picked = Object.fromEntries(named.flatMap((n) => (parent[n] === undefined ? [] : [[n, parent[n]]])));
  return { ...picked, PATH: path };
}
