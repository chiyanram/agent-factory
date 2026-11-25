// plugin-pin-cli — `agent-factory plugin update <project> <name@marketplace> [<commit>] [--reason <why>]`
// (docs/explanation/architecture.md section 5 "Plugins": updating is deliberate). It fetches the marketplace's clone
// (or takes the given commit, and fetches a full commit the clone lacks), copies the plugin into the store by its hash
// and shows what changes against the pin. Then the eval gate (core/eval/pin-proof.ts, ADR-0020) sizes that change: a
// change to the review needs a proof that covers it, or the move is refused with the cost of the eval and the command
// that runs it; a change no eval can prove yet needs the reason the person types. Last it runs config check and reads
// the process of the project's plugins with the new version in. Only when all pass does it move the pin, with the
// gate's record. The eval is not run here: `agent-factory eval pin` runs it, and spends money.

import type { Result } from "./core/forge/api.js";
import { evalCaps } from "./core/eval/harness.js";
import { baseOf, ENGINE_ROOT, gateMove, sizeLines, type Gate } from "./core/eval/pin-proof.js";
import { estimateLines, planSlice } from "./core/eval/slice.js";
import { fetchListed, folderCounts, listedRef, type Fetched } from "./core/process/fetch.js";
import { enginePackPin, readPins, writePins, type PackPin, type Pin, type Pins } from "./core/process/pins.js";
import { refText, type PluginRef } from "./core/process/plugins.js";
import { checkProblems } from "./settings-cli.js";

export type PinIo = {
  readonly env: NodeJS.ProcessEnv;
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
  readonly home: string;
};

export type PinOptions = { readonly reason?: string; readonly enginePin?: Result<PackPin> };

function fail(io: PinIo, reason: string): number {
  io.err(`agent-factory plugin update: ${reason}\n`);
  return 1;
}

function pinLine(pin: Pin | undefined): string {
  return pin === undefined
    ? "not pinned"
    : `${pin.commit.slice(0, 12)} ${pin.version || "(no version)"} sha256:${pin.sha256.slice(0, 12)}`;
}

function showChange(io: PinIo, ref: PluginRef, before: Pin | undefined, after: Fetched, gate: Gate): void {
  const lines = before === undefined ? folderCounts(after.files) : gate.changed;
  io.out(`${refText(ref)}: ${pinLine(before)} -> ${pinLine(after)}\n`);
  io.out(lines.length === 0 ? "no file changes\n" : lines.map((l) => `${l}\n`).join(""));
  io.out(
    sizeLines(gate.sized)
      .map((l) => `${l}\n`)
      .join(""),
  );
}

async function checked(io: PinIo, project: string): Promise<readonly string[]> {
  const problems = await checkProblems(io, project);
  return problems.kind === "ok"
    ? problems.value.filter((p) => p.level === "error").map((p) => p.text)
    : [problems.reason];
}

type Move = {
  readonly project: string;
  readonly ref: PluginRef;
  readonly pins: Pins;
  readonly before: Pin | undefined;
  readonly f: Fetched;
  readonly options: PinOptions;
};

async function estimate(io: PinIo): Promise<readonly string[]> {
  const caps = evalCaps(io.env);
  const planned = await planSlice({ root: ENGINE_ROOT, runUsd: caps.runUsd, judgeUsd: caps.judgeUsd });
  return planned.kind === "ok"
    ? estimateLines(planned.value.estimate)
    : [`no cost estimate here: ${planned.reason}; eval pin shows it from an agent-factory checkout`];
}

async function refused(io: PinIo, m: Move, gate: Gate): Promise<number> {
  io.err(gate.problems.map((p) => `error: ${p}\n`).join(""));
  if (gate.needsProof) {
    const lines = await estimate(io);
    const reason = m.options.reason ? ` --reason ${JSON.stringify(m.options.reason)}` : "";
    io.err(
      [...lines, `run the eval first: agent-factory eval pin ${m.project} ${refText(m.ref)} ${m.f.commit}${reason}`]
        .map((l) => `${l}\n`)
        .join(""),
    );
  }
  return fail(io, `the eval gate refused it; the pin stays at ${pinLine(m.before)}`);
}

async function gated(io: PinIo, m: Move): Promise<Gate> {
  const places = [io.home, ENGINE_ROOT];
  const engine = m.options.enginePin ?? (await enginePackPin(ENGINE_ROOT));
  const base = await baseOf({ home: io.home, env: io.env, places, ref: m.ref, before: m.before, after: m.f, engine });
  return gateMove({ places, ref: m.ref, base, after: m.f, reason: m.options.reason ?? "" });
}

async function checkedMove(io: PinIo, m: Move): Promise<number> {
  const gate = await gated(io, m);
  showChange(io, m.ref, m.before, m.f, gate);
  if (gate.record === undefined) {
    return refused(io, m, gate);
  }
  return checkedPin(io, m, { commit: m.f.commit, version: m.f.version, sha256: m.f.sha256, proof: gate.record });
}

async function checkedPin(io: PinIo, m: Move, pin: Pin): Promise<number> {
  const next: Pins = { ...m.pins, [refText(m.ref)]: pin };
  const errors = await checked(io, m.project);
  if (errors.length > 0) {
    io.err(errors.map((e) => `error: ${e}\n`).join(""));
    return fail(io, `the check failed; the pin stays at ${pinLine(m.before)}`);
  }
  const written = await writePins(io.home, m.project, next);
  return written.kind === "ok"
    ? (io.out(`pinned ${refText(m.ref)} at ${pinLine(pin)}; the next ticket uses it\n`), 0)
    : fail(io, written.reason);
}

async function moved(io: PinIo, project: string, ref: PluginRef, f: Fetched, options: PinOptions): Promise<number> {
  const pins = await readPins(io.home, project);
  if (pins.kind === "failed") {
    return fail(io, pins.reason);
  }
  const before = pins.value[refText(ref)];
  if (before?.sha256 === f.sha256 && before.commit === f.commit) {
    io.out(`${refText(ref)} is already pinned at ${pinLine(before)}\n`);
    return 0;
  }
  return checkedMove(io, { project, ref, pins: pins.value, before, f, options });
}

export async function pinUpdate(
  io: PinIo,
  project: string,
  word: string,
  commit: string | undefined,
  options: PinOptions = {},
): Promise<number> {
  const ref = await listedRef({ home: io.home, env: io.env, project, word });
  if (ref.kind === "failed") {
    return fail(io, ref.reason);
  }
  const got = await fetchListed({ home: io.home, env: io.env, ref: ref.value, commit });
  return got.kind === "failed" ? fail(io, got.reason) : moved(io, project, ref.value, got.value, options);
}
