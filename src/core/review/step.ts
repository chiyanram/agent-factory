// step — the reviewer as the dispatcher's review step (#103, #138). The table needs only the Act on count; every other
// outcome maps onto it, with what the round spent (#131): every model answer of the round, a failed pass's too, is
// metered, so a round that fails still hands the orchestrator its spend; and each by its run, each finder's by its lens
// and the verify pass's, for usage by run kind (#337). The outcomes:
//   posted, reused, already   their Act on count; a posted round also rates the last full round's findings (#220),
//                             and names each lens's unique verified findings (#237)
//   no-progress               needs-human is on the change, which the table reads first next pass
//   moved                     a person pushed during the review: a failure, so the run's start is left and a person looks
// Each pass's stream is kept as its trace beside the ticket's records (dispatch/trace.ts, #487), and the round's line
// names them. A trace that cannot be kept loses the trace, never the pass.
// A round that fails names how: the first of its model runs that failed, by that run's end, else unknown.
// Each model run is also named, by its part (a finder's lens or verify), the model it asked for and what its CLI's
// init event reported (agent/ran.ts).

import type { PluginDir } from "../process/read.js";
import type { Result } from "../forge/api.js";
import type { Forge } from "../forge/types.js";
import type { Steps } from "../dispatch/steps.js";
import type { Sessions } from "./live.js";
import type { Model, ModelResult } from "./model.js";
import type { EndReason } from "../end-reason.js";
import type { Acted, FoundByRule } from "./acted-on.js";
import { lensSetupOf, roundLenses } from "./finders.js";
import { reviewRound, VERIFY_PASSES, type Outcome } from "./round.js";
import type { Where } from "../dispatch/records.js";
import { keepTrace, type TraceAt } from "../dispatch/trace.js";
import { paths, reviewModels, reviewSetup } from "./settings.js";
import { namedIn, runsField, type RunNamed } from "../agent/ran.js";
import { openAgentCli } from "../agent/index.js";
import {
  addRoundSpend,
  addSpend,
  NO_ROUND_SPEND,
  NO_SPEND,
  spendOf,
  type RoundPart,
  type RoundSpend,
  type Spend,
} from "../dispatch/spend.js";

type OutcomeMap = { readonly [O in Outcome as O["kind"]]: O };
type ActOn = Result<{
  readonly actOn: number;
  readonly acted?: Acted;
  readonly lenses?: Readonly<Record<string, number>>;
  readonly citesNotFound?: number;
  readonly found?: FoundByRule;
  readonly skillsMissing?: readonly string[];
}>;
type Mappers = { readonly [K in keyof OutcomeMap]: (o: OutcomeMap[K]) => ActOn };

const MAP: Mappers = {
  posted: (o) => {
    const base = {
      actOn: o.counts.act_on,
      lenses: o.lenses,
      citesNotFound: o.citesNotFound,
      found: o.found,
      ...(o.skillsMissing.length === 0 ? {} : { skillsMissing: o.skillsMissing }),
    };
    return { kind: "ok", value: o.acted === "none" ? base : { ...base, acted: o.acted } };
  },
  reused: (o) => ({ kind: "ok", value: { actOn: o.actOn } }),
  already: (o) => ({ kind: "ok", value: { actOn: o.actOn } }),
  "no-progress": () => ({ kind: "ok", value: { actOn: 1 } }),
  moved: (o) => ({
    kind: "failed",
    reason: `the head moved from ${o.from.slice(0, 8)} to ${o.to.slice(0, 8)} during the review`,
  }),
};

function mapAs<K extends keyof OutcomeMap>(kind: K, o: OutcomeMap[K]): ActOn {
  return MAP[kind](o);
}

function actOnOf(outcome: Outcome): ActOn {
  return mapAs(outcome.kind, outcome);
}

type Meter = {
  spend: Spend;
  split: RoundSpend;
  readonly cli: string;
  readonly runs: RunNamed[];
  end: EndReason | "none";
};

function partName(part: RoundPart | undefined): { readonly part?: string } {
  if (part === undefined) {
    return {};
  }
  return { part: part.kind === "finder" ? part.lens : "verify" };
}

function metered(model: Model, meter: Meter): Model {
  return async (run) => {
    const ran: ModelResult = await model(run);
    const spent = ran.kind === "ok" ? { usd: ran.value.costUsd, tokens: ran.value.tokens } : spendOf(ran.answer);
    meter.spend = addSpend(meter.spend, spent);
    meter.split = run.part === undefined ? meter.split : addRoundSpend(meter.split, run.part, spent);
    const stream = ran.kind === "ok" ? ran.value.stream : ran.stream;
    meter.runs.push({ ...partName(run.part), cli: meter.cli, asked: run.model, ...namedIn(stream) });
    meter.end = firstEnd(meter.end, ran);
    return ran;
  };
}

function firstEnd(before: EndReason | "none", ran: ModelResult): EndReason | "none" {
  if (before !== "none" || ran.kind === "ok") {
    return before;
  }
  return ran.end ?? "unknown";
}

type Traced = { readonly where: Where; readonly names: string[]; last: number };

function traceAt(into: Traced, part: RoundPart | undefined): TraceAt | undefined {
  if (part === undefined) {
    return undefined;
  }
  into.last = Math.max(Date.now(), into.last + 1);
  const kind = part.kind === "finder" ? { kind: "finder" as const, lens: part.lens } : { kind: "verify" as const };
  return { ...into.where, ...kind, at: into.last };
}

async function keptFor(into: Traced, part: RoundPart | undefined, stream: string | undefined): Promise<void> {
  const at = traceAt(into, part);
  const kept = stream === undefined || at === undefined ? undefined : await keepTrace(at, stream);
  if (kept?.kind === "ok") {
    into.names.push(kept.value.name);
  }
}

function traced(model: Model, into: Traced): Model {
  return async (run) => {
    const ran: ModelResult = await model(run);
    await keptFor(into, run.part, ran.kind === "ok" ? ran.value.stream : ran.stream);
    return ran;
  };
}

function tracesOf(into: Traced): { readonly traces?: readonly string[] } {
  return into.names.length === 0 ? {} : { traces: [...into.names] };
}

export function worstCase(finders: number, maxUsd: string): number | "unbounded" {
  return maxUsd === "" ? "unbounded" : (finders + VERIFY_PASSES) * Number(maxUsd);
}

async function worstUsd(input: {
  readonly home: string;
  readonly project: string;
  readonly maxUsd: string;
}): Promise<Result<number | "unbounded">> {
  const setup = await lensSetupOf(input);
  return setup.kind === "ok"
    ? { kind: "ok", value: worstCase(roundLenses(setup.value.lenses).length, input.maxUsd) }
    : setup;
}

function splitOf(meter: Meter): { readonly split?: RoundSpend } {
  return meter.spend.usd === 0 && meter.spend.tokens === 0 ? {} : { split: meter.split };
}

export function reviewStep(input: {
  readonly env: NodeJS.ProcessEnv;
  readonly forge: Forge;
  readonly factory: string;
  readonly project: string;
  readonly plugins: readonly PluginDir[];
  readonly model?: Model;
  readonly sessions?: Sessions;
}): Steps["review"] {
  const p = paths(input.env);
  if (p.kind === "failed") {
    return { kind: "unavailable", reason: `the reviewer is not set up: ${p.reason}` };
  }
  const { home, maxUsd } = p.value;
  const cli = openAgentCli({ env: input.env }).name;
  return {
    kind: "available",
    named: { cli, asks: reviewModels(input.env) },
    worstUsd: () => worstUsd({ home, project: input.project, maxUsd }),
    run: async (run) => {
      if (run.change.kind !== "open") {
        return { kind: "failed", reason: "no open change to review" };
      }
      const setup = reviewSetup({ ...input, number: run.change.line.number, paths: p.value });
      const meter: Meter = { spend: NO_SPEND, split: NO_ROUND_SPEND, cli, runs: [], end: "none" };
      const into: Traced = { where: { home, project: input.project, ticket: run.ticket }, names: [], last: 0 };
      const round = await reviewRound({ ...setup, model: traced(metered(setup.model, meter), into) });
      const mapped = round.kind === "ok" ? actOnOf(round.value) : round;
      const spent = { spend: meter.spend, ...splitOf(meter), ...tracesOf(into), ...runsField(meter.runs) };
      return mapped.kind === "ok"
        ? { kind: "ok", value: { ...mapped.value, ...spent } }
        : { ...mapped, ...spent, ...(meter.end === "none" ? {} : { end: meter.end }) };
    },
  };
}
