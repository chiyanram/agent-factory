// pin-proof — the eval proof a plugin pin move needs, and the gate that checks it (ADR-0020). A proof is bound to the
// plugin's sha256, the tree hash the pin holds, never to a git commit, and names the size its own diff needed:
//
//   <home>/evals/pins/<name@marketplace>/<sha256>.json      a project's pin move (agent-factory eval pin)
//   <engine>/evals/pins/<name@marketplace>/<sha256>.json    the engine's own pin, committed in this repository
//
// The gate sizes the move's own diff (pin-size.ts) against its base: the old pin, or for a first pin of the engine's
// rules pack the engine's pinned commit, so `init` adds no size of its own. A first pin of any other plugin has no
// base, and every file counts. A move that touches the review goes ahead only when a proof for the new sha256 covers
// the review. A move that touches what no eval can prove yet (the implementer card, a path the map does not name, a card
// or file no eval tests) lists those files and goes ahead only with a reason the person types: proving by hand first.
// The pin then keeps a record: the size, the sha256 whose proof covers the whole move ("proven", empty when a reason
// stood in for an eval, and inherited from the base on a move of size none) and the reason. pinProof reads it back,
// for config check now and doctor later, and shows a pin moved on a reason as unproven until a proof covers it.
// **Today:** there is no implementer eval to prove the implementer card (#824), and no doctor command shows the check (#768);
// config check shows a pin with no proof as a warning.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Result } from "../forge/api.js";
import { changedFiles, fetchPlugin, type Fetched } from "../process/fetch.js";
import { ENGINE_MARKET, SHA256, storeDir, treeHash, type PackPin, type Pin, type Proven } from "../process/pins.js";
import { refText, type PluginRef } from "../process/plugins.js";
import { BASELINE } from "../review/rules.js";
import { attempt } from "../review/safe.js";
import { field } from "./bar.js";
import { covers, sizeOf, SIZES, type Size, type Sized } from "./pin-size.js";

export const ENGINE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const PROOFS = join("evals", "pins");

export type ReviewProof = {
  readonly cases: readonly string[];
  readonly runs: number;
  readonly cost_usd: number;
  readonly found: number;
  readonly floor: number;
  readonly clean_hits: number;
  readonly inputs: unknown;
  readonly per_case: unknown;
};

export type Proof = {
  readonly version: 1;
  readonly ref: string;
  readonly commit: string;
  readonly sha256: string;
  readonly base: { readonly commit: string; readonly sha256: string } | null;
  readonly changed: readonly string[];
  readonly baseline: readonly string[];
  readonly size: Size;
  readonly uncovered: readonly string[];
  readonly reason: string;
  readonly review: ReviewProof | null;
};

export function proofPath(dir: string, ref: PluginRef, sha256: string): string {
  return join(dir, PROOFS, refText(ref), `${sha256}.json`);
}

function strings(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) && value.every((v) => typeof v === "string") ? value : undefined;
}

function str(value: unknown, name: string): string | undefined {
  const v = field(value, name);
  return typeof v === "string" ? v : undefined;
}

function baseField(value: unknown): Proof["base"] | undefined {
  const base = field(value, "base");
  if (base === null) {
    return null;
  }
  const [commit, sha256] = [str(base, "commit"), str(base, "sha256")];
  return commit === undefined || sha256 === undefined ? undefined : { commit, sha256 };
}

type Head = Pick<Proof, "ref" | "commit" | "sha256" | "reason" | "size">;

const HEAD_KEYS = ["ref", "commit", "reason", "sha256"] as const;

function strOr(value: unknown, name: string): string {
  return str(value, name) ?? "";
}

function headTyped(value: unknown): boolean {
  return HEAD_KEYS.every((k) => str(value, k) !== undefined) && SHA256.test(strOr(value, "sha256"));
}

function head(value: unknown): Head | undefined {
  const size = SIZES.find((s) => s === field(value, "size"));
  if (!headTyped(value) || size === undefined) {
    return undefined;
  }
  return {
    ref: strOr(value, "ref"),
    commit: strOr(value, "commit"),
    reason: strOr(value, "reason"),
    sha256: strOr(value, "sha256"),
    size,
  };
}

function lists(value: unknown): Pick<Proof, "changed" | "uncovered" | "baseline" | "base"> | undefined {
  const [changed, uncovered] = [strings(field(value, "changed")), strings(field(value, "uncovered"))];
  const [baseline, base] = [strings(field(value, "baseline")), baseField(value)];
  return changed === undefined || uncovered === undefined || baseline === undefined || base === undefined
    ? undefined
    : { changed, uncovered, baseline, base };
}

function reviewOf(value: unknown): ReviewProof | null {
  const review = field(value, "review");
  const num = (name: string): number => Number(field(review, name)) || 0;
  return review === null || typeof review !== "object"
    ? null
    : {
        cases: strings(field(review, "cases")) ?? [],
        runs: num("runs"),
        cost_usd: num("cost_usd"),
        found: num("found"),
        floor: num("floor"),
        clean_hits: num("clean_hits"),
        inputs: field(review, "inputs"),
        per_case: field(review, "per_case"),
      };
}

export function proofOf(value: unknown): Proof | undefined {
  const top = head(value);
  const rest = lists(value);
  return top === undefined || rest === undefined ? undefined : { version: 1, ...top, ...rest, review: reviewOf(value) };
}

export type Found = { readonly path: string; readonly proof: Proof };

export async function findProof(places: readonly string[], ref: PluginRef, sha256: string): Promise<Found | undefined> {
  for (const place of places) {
    const path = proofPath(place, ref, sha256);
    const raw = await readFile(path, "utf8").catch(() => "");
    const proof = proofOf(parsed(raw));
    if (proof !== undefined && proof.ref === refText(ref) && proof.sha256 === sha256) {
      return { path, proof };
    }
  }
  return undefined;
}

function parsed(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export async function writeProof(place: string, ref: PluginRef, proof: Proof): Promise<Result<string>> {
  const path = proofPath(place, ref, proof.sha256);
  return attempt(async () => {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(`${path}.tmp`, `${JSON.stringify(proof, null, 2)}\n`, { mode: 0o600 });
    await rename(`${path}.tmp`, path);
    return path;
  }, `cannot write ${path}`);
}

async function ownProof(places: readonly string[], ref: PluginRef, pin: Pin): Promise<boolean> {
  const own = await findProof(places, ref, pin.sha256);
  return wholly(own, pin.proof?.size ?? "none");
}

function wholly(found: Found | undefined, need: Size): boolean {
  return found !== undefined && found.proof.uncovered.length === 0 && covers(found.proof.size, need);
}

async function provenHeld(places: readonly string[], ref: PluginRef, proven: string): Promise<boolean> {
  return proven !== "" && (await findProof(places, ref, proven)) !== undefined;
}

function unprovenWhy(places: readonly string[], ref: PluginRef, pin: Pin): string {
  const at = `${refText(ref)} at sha256:${pin.sha256.slice(0, 12)}`;
  const { proven, reason: why } = pin.proof ?? { proven: "", reason: "" };
  if (proven !== "") {
    return `${at}: the eval proof for sha256:${proven.slice(0, 12)} that its pin names is gone from ${places.map((p) => join(p, PROOFS)).join(" and ")}`;
  }
  return why === ""
    ? `${at} has no eval proof (ADR-0020): it moved before the gate, or from a pin with none`
    : `${at} has no eval proof (ADR-0020): it moved on the reason ${JSON.stringify(why)}, which stands in for an eval until one proves it`;
}

export async function pinProof(places: readonly string[], ref: PluginRef, pin: Pin): Promise<string> {
  const held = (await provenHeld(places, ref, pin.proof?.proven ?? "")) || (await ownProof(places, ref, pin));
  return held ? "" : unprovenWhy(places, ref, pin);
}

export type Base = {
  readonly commit: string;
  readonly sha256: string;
  readonly dir: string;
  readonly files: readonly string[];
  readonly proven: string;
};

const NO_BASE: Base = { commit: "", sha256: "", dir: "", files: [], proven: "" };

async function provenAt(places: readonly string[], ref: PluginRef, sha256: string, held: string): Promise<string> {
  if (held !== "") {
    return held;
  }
  return (await findProof(places, ref, sha256)) === undefined ? "" : sha256;
}

function enginesPlugin(ref: PluginRef, engine: Result<PackPin>): PackPin | undefined {
  return engine.kind === "ok" && ref.marketplace === ENGINE_MARKET && engine.value.tag.startsWith(`${ref.name}--`)
    ? engine.value
    : undefined;
}

type BaseInput = {
  readonly home: string;
  readonly env: NodeJS.ProcessEnv;
  readonly places: readonly string[];
  readonly ref: PluginRef;
  readonly before: Pin | undefined;
  readonly after: Fetched;
  readonly engine: Result<PackPin>;
};

async function oldPin(input: BaseInput, before: Pin): Promise<Base> {
  const dir = storeDir(input.home, input.ref, before.sha256);
  const hash = await treeHash(dir);
  const files = hash.kind === "ok" ? hash.value.files : [];
  const proven = await provenAt(input.places, input.ref, before.sha256, before.proof?.proven ?? "");
  return { commit: before.commit, sha256: before.sha256, dir, files, proven };
}

async function enginePin(input: BaseInput, engine: PackPin): Promise<Base> {
  const { home, env, ref, after } = input;
  const got =
    engine.commit === after.commit
      ? { kind: "ok" as const, value: after }
      : await fetchPlugin({ home, env, ref, commit: engine.commit });
  if (got.kind === "failed") {
    return NO_BASE;
  }
  const { commit, sha256, dir, files } = got.value;
  return { commit, sha256, dir, files, proven: await provenAt(input.places, ref, sha256, "") };
}

export async function baseOf(input: BaseInput): Promise<Base> {
  if (input.before !== undefined) {
    return oldPin(input, input.before);
  }
  const engine = enginesPlugin(input.ref, input.engine);
  return engine === undefined ? NO_BASE : enginePin(input, engine);
}

export type Gate = {
  readonly changed: readonly string[];
  readonly baseline: readonly string[];
  readonly sized: Sized;
  readonly problems: readonly string[];
  readonly needsProof: boolean;
  readonly record: Proven | undefined;
};

export function unprovable(s: Sized): readonly string[] {
  return [...s.writer, ...s.other, ...s.uncovered].toSorted();
}

function reasonWhy(s: Sized): string {
  const writer = s.writer.length + s.other.length > 0 ? "; there is no implementer eval yet (#824)" : "";
  return `it changes files no eval can prove yet (${unprovable(s).join(", ")})${writer}: move it with --reason "<why>", which the pin keeps, and it shows as unproven until a proof covers it`;
}

function provenAs(s: Sized, base: Base, after: Fetched, found: Found | undefined): string {
  const whole = wholly(found, s.size);
  if (s.uncovered.length > 0) {
    return "";
  }
  if (s.size === "none") {
    return whole ? after.sha256 : base.proven;
  }
  return whole ? after.sha256 : "";
}

function needsReason(s: Sized, found: Found | undefined, reason: string): boolean {
  const open = s.uncovered.length > 0 || (!wholly(found, s.size) && unprovable(s).length > 0);
  return open && reason.trim() === "";
}

function reviewUnproven(s: Sized, found: Found | undefined): boolean {
  return s.review.length > 0 && !(found !== undefined && covers(found.proof.size, "review"));
}

type GateInput = {
  readonly places: readonly string[];
  readonly ref: PluginRef;
  readonly base: Base;
  readonly after: Fetched;
  readonly reason: string;
};

export async function gateMove(input: GateInput): Promise<Gate> {
  const { base, after, ref, reason } = input;
  const changed = changedFiles(base.files, after.files);
  const baseline = BASELINE;
  const sized = sizeOf(changed, baseline);
  const found = await findProof(input.places, ref, after.sha256);
  const needsProof = reviewUnproven(sized, found);
  const problems = [
    ...(needsReason(sized, found, reason) ? [reasonWhy(sized)] : []),
    ...(needsProof
      ? [`no eval proof for sha256:${after.sha256.slice(0, 12)} covers the review size it needs (ADR-0020)`]
      : []),
  ];
  const record =
    problems.length > 0 ? undefined : { size: sized.size, proven: provenAs(sized, base, after, found), reason };
  return { changed, baseline, sized, problems, needsProof, record };
}

export function sizeLines(s: Sized): readonly string[] {
  const group = (name: string, paths: readonly string[]): readonly string[] =>
    paths.length === 0 ? [] : [`  ${name}: ${paths.join(", ")}`];
  return [
    `eval size: ${s.size}`,
    ...group("review", s.review),
    ...group("writer", s.writer),
    ...group("any skill the implementer can load (counted as both)", s.other),
    ...group("no eval covers", s.uncovered),
    ...group("no run reads", s.none),
  ];
}
