// ran — which CLI, version and model a model run used, as its run record names them (#902). The started line names the
// CLI and the model the run asked for (asks); the end line names each run's CLI, the model it asked for, and the
// version and model the CLI's own init event reported (runs). A run whose stream has no init event, or one without
// those fields, keeps neither: the record reads that as unreported, never as a guess. On read, an asks or runs value
// of the wrong shape is dropped, not failed, since no count, cap or decision reads them. A leaf: it imports only
// field.ts, so the records parser and the stream reader can both use it.

import { prop } from "../field.js";

export type Asks = Readonly<Record<string, string>>;

export type Reported = { readonly version?: string; readonly model?: string };

export type RunNamed = {
  readonly part?: string;
  readonly cli: string;
  readonly asked: string;
} & Reported;

export type Named = { readonly cli: string; readonly asks: Asks };

export const DEFAULT_MODEL = "default";

function text(value: unknown, name: string): Readonly<Record<string, string>> {
  return typeof value === "string" ? { [name]: value } : {};
}

export function initOf(event: unknown): Reported | undefined {
  if (prop(event, "type") !== "system" || prop(event, "subtype") !== "init") {
    return undefined;
  }
  return { ...text(prop(event, "claude_code_version"), "version"), ...text(prop(event, "model"), "model") };
}

function parsed(line: string): unknown {
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return undefined;
  }
}

export function initIn(line: string): Reported | undefined {
  return line.includes('"init"') ? initOf(parsed(line)) : undefined;
}

export function namedIn(stdout: string | undefined): Reported {
  for (const line of (stdout ?? "").split("\n")) {
    const init = initIn(line);
    if (init !== undefined) {
      return init;
    }
  }
  return {};
}

function runOf(raw: unknown): RunNamed | undefined {
  const [part, cli, asked, version, model] = ["part", "cli", "asked", "version", "model"].map((k) => prop(raw, k));
  const optional = [part, version, model].every((v) => v === undefined || typeof v === "string");
  if (typeof cli !== "string" || typeof asked !== "string" || !optional) {
    return undefined;
  }
  return { ...text(part, "part"), cli, asked, ...text(version, "version"), ...text(model, "model") };
}

export function runsOf(raw: unknown): readonly RunNamed[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const runs = raw.map(runOf);
  return runs.every((r): r is RunNamed => r !== undefined) ? runs : undefined;
}

export function asksOf(raw: unknown): Asks | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return undefined;
  }
  const entries = Object.entries(raw);
  return entries.every(([, v]) => typeof v === "string") ? Object.fromEntries(entries) : undefined;
}

export function namedField(named: Named | undefined): { readonly cli?: string; readonly asks?: Asks } {
  return named === undefined ? {} : { cli: named.cli, asks: named.asks };
}

export function runsField(runs: readonly RunNamed[] | undefined): { readonly runs?: readonly RunNamed[] } {
  return runs === undefined || runs.length === 0 ? {} : { runs };
}
