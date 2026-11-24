// eval-pin-cli — `agent-factory eval pin <project> <name@marketplace> [<commit>]` (ADR-0020): the eval a plugin pin
// move needs, sized by what the move changes (core/eval/pin-size.ts). It fetches the version into the store, as plugin
// update does, sizes its diff against the pin, prints the size, the cases and the cost, and asks before it spends:
//
//   none            nothing a run reads changed: no eval, no proof; plugin update moves the pin on config check. With
//                   --commit-proof it still writes a proof with no pass, since CI checks every move of the engine's pin
//   review          a targeted review pass on the store copy (core/eval/slice.ts); when it holds, the proof goes to
//                   <home>/evals/pins/, or with --commit-proof to evals/pins/ in this checkout, for the engine's own pin
//   writer, both    the review part, if any, as for review; the rest no eval can prove yet, so it needs --reason, as
//                   a change to a card no eval tests does, and the proof keeps it. **Today:** there is no writer
//                   eval yet (#824)
// It runs on the host from an agent-factory
// checkout (--repo, default .), never in CI: it reads the golden set and spends on model runs, and plugin update only
// checks the proof it writes.

import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { factoryHome } from "./cli-common.js";
import type { Result } from "./core/forge/api.js";
import { openAgentCli } from "./core/agent/index.js";
import { evalReviewer, evalSettings, type EvalInput, type EvalSettings, type Written } from "./core/eval/harness.js";
import {
  baseOf,
  gateMove,
  sizeLines,
  unprovable,
  writeProof,
  type Base,
  type Gate,
  type Proof,
} from "./core/eval/pin-proof.js";
import { estimateLines, planSlice, SLICE_RUNS, sliceProblems, type Planned } from "./core/eval/slice.js";
import { field } from "./core/eval/bar.js";
import { fetchListed, listedRef, type Fetched } from "./core/process/fetch.js";
import { enginePackPin, readPins, type Pins } from "./core/process/pins.js";
import { refText, type PluginRef } from "./core/process/plugins.js";
import { refusal, workDir, type EvalIo } from "./eval-host.js";

export const EVAL_PIN_HELP = `  eval pin <project> <name@marketplace> [<commit>] [--repo <path>] [--reason <why>] [--commit-proof]
                               the eval a plugin pin move needs (ADR-0020): fetches that version, sizes what it
                               changes against the pin, shows the cases and the cost, asks [y/N], then runs a
                               targeted review pass on it and writes the proof plugin update checks, in
                               <home>/evals/pins/ (--commit-proof: evals/pins/ in this checkout, for the engine's
                               own pin). Nothing a run reads changed: no eval. --reason: it changed what no eval
                               can prove yet (the implementer card, an unknown path, a card no eval tests). Host
                               only. Exit 0 proven or nothing to run, 1 refused, not run or not held
`;

const USAGE =
  "usage: agent-factory eval pin <project> <name@marketplace> [<commit>] [--repo <path>] [--reason <why>] [--commit-proof]\n";

export type PassRunner = (input: EvalInput) => Promise<Result<Written>>;

type Parsed = {
  readonly project: string;
  readonly word: string;
  readonly commit: string | undefined;
  readonly root: string;
  readonly reason: string;
  readonly commitProof: boolean;
};

const OPTIONS = {
  repo: { type: "string", default: "." },
  reason: { type: "string", default: "" },
  "commit-proof": { type: "boolean", default: false },
} as const;

function shapeOk(project: string, word: string, rest: readonly string[]): boolean {
  return project !== "" && word.includes("@") && rest.length === 0;
}

function parsed(argv: readonly string[]): Parsed | "usage" {
  try {
    const { values, positionals } = parseArgs({ args: [...argv], allowPositionals: true, options: OPTIONS });
    const [project = "", word = "", commit, ...rest] = positionals;
    const flags = { root: resolve(values.repo), reason: values.reason, commitProof: values["commit-proof"] };
    return shapeOk(project, word, rest) ? { project, word, commit, ...flags } : "usage";
  } catch {
    return "usage";
  }
}

type Target = {
  readonly home: string;
  readonly ref: PluginRef;
  readonly f: Fetched;
  readonly base: Base;
  readonly gate: Gate;
};

type Fetch = { readonly home: string; readonly ref: PluginRef; readonly f: Fetched; readonly pins: Pins };

async function fetchedFor(p: Parsed, env: NodeJS.ProcessEnv, home: string): Promise<Result<Fetch>> {
  const ref = await listedRef({ home, env, project: p.project, word: p.word });
  if (ref.kind === "failed") {
    return ref;
  }
  const f = await fetchListed({ home, env, ref: ref.value, commit: p.commit });
  const pins = await readPins(home, p.project);
  if (f.kind === "failed") {
    return f;
  }
  return pins.kind === "failed" ? pins : { kind: "ok", value: { home, ref: ref.value, f: f.value, pins: pins.value } };
}

async function gated(p: Parsed, env: NodeJS.ProcessEnv, { home, ref, f, pins }: Fetch): Promise<Target> {
  const places = [home, p.root];
  const engine = await enginePackPin(p.root);
  const before = pins[refText(ref)];
  const base = await baseOf({ home, env, places, ref, before, after: f, engine });
  const gate = await gateMove({ places, ref, base, after: f, reason: p.reason });
  return { home, ref, f, base, gate };
}

async function target(p: Parsed, env: NodeJS.ProcessEnv): Promise<Result<Target>> {
  const home = factoryHome(env);
  if (home.kind === "refused") {
    return { kind: "failed", reason: home.reason };
  }
  const got = await fetchedFor(p, env, home.path);
  return got.kind === "failed" ? got : { kind: "ok", value: await gated(p, env, got.value) };
}

function shown(io: EvalIo, t: Target): void {
  const from = t.base.commit === "" ? "no base (every file counts)" : t.base.commit.slice(0, 12);
  io.out(`${refText(t.ref)}: ${from} -> ${t.f.commit.slice(0, 12)} sha256:${t.f.sha256.slice(0, 12)}\n`);
  io.out(
    sizeLines(t.gate.sized)
      .map((l) => `${l}\n`)
      .join(""),
  );
}

type Stop = "run" | "refused" | "covered" | "nothing";

function stopOf(t: Target): Stop {
  if (t.gate.problems.some((x) => !x.startsWith("no eval proof"))) {
    return "refused";
  }
  if (t.gate.needsProof) {
    return "run";
  }
  return t.gate.record?.proven === t.f.sha256 ? "covered" : "nothing";
}

function nothingLine(t: Target): string {
  return t.gate.sized.size === "none" && t.gate.sized.uncovered.length === 0
    ? "nothing a run reads changed: no eval is needed, and plugin update moves the pin on config check\n"
    : "no eval can prove this move yet: plugin update moves it with the same --reason, and it shows as unproven\n";
}

async function notRun(io: EvalIo, p: Parsed, t: Target, stop: Stop): Promise<number> {
  if (stop === "refused") {
    const why = t.gate.problems.filter((x) => !x.startsWith("no eval proof"));
    io.err(why.map((x) => `agent-factory eval pin: ${x}\n`).join(""));
    return 1;
  }
  if (stop === "covered") {
    io.out(`an eval proof already covers sha256:${t.f.sha256.slice(0, 12)}; nothing to run\n`);
    return 0;
  }
  io.out(nothingLine(t));
  return p.commitProof ? writtenProof(io, p, t, bareProof(p, t)) : 0;
}

async function asked(io: EvalIo): Promise<boolean> {
  const answer = io.readLine === undefined ? "" : await io.readLine("Run it? [y/N] ");
  return /^y(es)?$/i.test(answer.trim());
}

function bareProof(p: Parsed, t: Target): Proof {
  return {
    version: 1,
    ref: refText(t.ref),
    commit: t.f.commit,
    sha256: t.f.sha256,
    base: t.base.sha256 === "" ? null : { commit: t.base.commit, sha256: t.base.sha256 },
    changed: t.gate.changed,
    baseline: t.gate.baseline,
    size: "none",
    uncovered: unprovable(t.gate.sized),
    reason: p.reason,
    review: null,
  };
}

function proofOf(p: Parsed, t: Target, plan: Planned, pass: unknown): Proof {
  const overall = field(field(pass, "recall_at_act_on"), "overall");
  return {
    ...bareProof(p, t),
    size: "review",
    review: {
      cases: plan.estimate.cases,
      runs: SLICE_RUNS,
      cost_usd: Number(field(pass, "cost_usd")) || 0,
      found: Number(field(overall, "found")) || 0,
      floor: plan.floor,
      clean_hits: Number(field(field(pass, "clean_floor"), "hits")) || 0,
      inputs: field(pass, "inputs"),
      per_case: field(pass, "per_case"),
    },
  };
}

type Run = { readonly p: Parsed; readonly t: Target; readonly plan: Planned; readonly settings: EvalSettings };

function parsedPass(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

async function ranPass(io: EvalIo, r: Run, runPass: PassRunner): Promise<Result<unknown>> {
  const work = await workDir(io.env);
  if (work.kind === "failed") {
    return work;
  }
  const out = await mkdtemp(join(r.t.home, "eval-pin-"));
  try {
    const written = await runPass({
      root: r.p.root,
      env: io.env,
      work: work.value,
      rulebook: r.t.f.dir,
      model: openAgentCli({ env: io.env }).readOnly,
      settings: r.settings,
      now: new Date(),
      log: (line) => io.err(`${line}\n`),
      only: r.plan.estimate.cases,
      runs: SLICE_RUNS,
      rulebookCommit: r.t.f.commit,
      resultsDir: out,
    });
    if (written.kind === "failed") {
      return written;
    }
    const text = await readFile(written.value.path, "utf8").catch(() => "");
    return { kind: "ok", value: parsedPass(text) };
  } finally {
    await rm(out, { recursive: true, force: true });
  }
}

async function proven(io: EvalIo, r: Run, runPass: PassRunner): Promise<number> {
  const pass = await ranPass(io, r, runPass);
  if (pass.kind === "failed") {
    io.err(`agent-factory eval pin: ${pass.reason}\n`);
    return 1;
  }
  const problems = sliceProblems(pass.value, r.plan.floor);
  if (problems.length > 0) {
    io.err(problems.map((x) => `agent-factory eval pin: the pass does not hold: ${x}\n`).join(""));
    io.err("agent-factory eval pin: no proof written; the pin cannot move to this version\n");
    return 1;
  }
  return writtenProof(io, r.p, r.t, proofOf(r.p, r.t, r.plan, pass.value));
}

async function writtenProof(io: EvalIo, p: Parsed, t: Target, proof: Proof): Promise<number> {
  const place = p.commitProof ? p.root : t.home;
  await mkdir(place, { recursive: true });
  const wrote = await writeProof(place, t.ref, proof);
  if (wrote.kind === "failed") {
    io.err(`agent-factory eval pin: ${wrote.reason}\n`);
    return 1;
  }
  io.out(`${wrote.value}\nnext: agent-factory plugin update ${p.project} ${refText(t.ref)} ${t.f.commit}\n`);
  return 0;
}

function fail(io: EvalIo, reason: string): number {
  io.err(`agent-factory eval pin: ${reason}\n`);
  return 1;
}

function startProblem(env: NodeJS.ProcessEnv): Result<EvalSettings> {
  const refused = refusal(env, { rulebook: false });
  return refused === "" ? evalSettings(env, { drafts: false, aim: "none" }) : { kind: "failed", reason: refused };
}

async function planned(io: EvalIo, r: Omit<Run, "plan">, runPass: PassRunner): Promise<number> {
  const s = r.settings;
  const plan = await planSlice({ root: r.p.root, runUsd: s.runUsd, judgeUsd: s.judgeUsd });
  if (plan.kind === "failed") {
    return fail(io, plan.reason);
  }
  io.out(
    estimateLines(plan.value.estimate)
      .map((l) => `${l}\n`)
      .join(""),
  );
  if (!(await asked(io))) {
    io.out("not run; no proof written\n");
    return 1;
  }
  return proven(io, { ...r, plan: plan.value }, runPass);
}

export async function evalPinCommand(
  argv: readonly string[],
  io: EvalIo,
  runPass: PassRunner = evalReviewer,
): Promise<number> {
  const p = parsed(argv);
  if (p === "usage") {
    io.err(USAGE);
    return 64;
  }
  const settings = startProblem(io.env);
  return settings.kind === "failed" ? fail(io, settings.reason) : targeted(io, p, settings.value, runPass);
}

async function targeted(io: EvalIo, p: Parsed, settings: EvalSettings, runPass: PassRunner): Promise<number> {
  const t = await target(p, io.env);
  if (t.kind === "failed") {
    return fail(io, t.reason);
  }
  shown(io, t.value);
  const stop = stopOf(t.value);
  return stop === "run" ? planned(io, { p, t: t.value, settings }, runPass) : notRun(io, p, t.value, stop);
}
