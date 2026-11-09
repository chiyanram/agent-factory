// judge — matches the automated review's Act on findings with a case's seeds (ADR-0015 E4, #215). A finding matches a
// seed when it is in the same file, within 5 lines of it (the location gate), and the judge, one fresh model run with
// prompts/eval-judge.md, says it is the "same underlying issue" with confidence 0.7 or more (Martian's judge, MIT). No
// embedding similarity: it cannot tell the same bug from a similar bug elsewhere. Each finding matches one seed at
// most, and only the nearest few findings at a seed are judged, so the judge's spend has a bound (budget.ts).

import { prop } from "../dispatch/records.js";
import type { Result } from "../forge/api.js";
import type { ActOn } from "../review/act-on.js";
import { fence } from "../review/fence.js";
import type { Model } from "../review/model.js";
import type { GoldenFinding } from "./golden.js";

export const LINE_WINDOW = 5;
export const MIN_CONFIDENCE = 0.7;
// the findings judged at one seed, nearest first: the bound on judge runs per seed
export const MAX_JUDGED = 3;

export type Judgment = { readonly same: boolean; readonly confidence: number; readonly why: string };
export type Judge = (seed: GoldenFinding, finding: ActOn) => Promise<Result<Judgment>>;

export const JUDGE_SCHEMA = JSON.stringify({
  type: "object",
  required: ["same", "confidence", "why"],
  properties: {
    same: { type: "boolean" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    why: { type: "string" },
  },
});

// judgePrompt : the instructions, then the seed and the finding, each fenced as data. Pure.
export function judgePrompt(instructions: string, seed: GoldenFinding, finding: ActOn): string {
  const s = `${seed.file}:${seed.line}\n${seed.issue}`;
  const f = `${finding.file}:${finding.line} (${finding.rule})\n${finding.finding}\nFix: ${finding.fix}`;
  return `${instructions}\n${fence({ title: "seed", text: s })}${fence({ title: "finding", text: f })}`;
}

function isConfidence(value: unknown): value is number {
  return typeof value === "number" && value >= 0 && value <= 1;
}

// readJudgment : the judge's structured output, checked. Pure.
export function readJudgment(output: unknown): Result<Judgment> {
  const same = prop(output, "same");
  const confidence = prop(output, "confidence");
  const said = prop(output, "why");
  const why = typeof said === "string" ? said : "";
  return typeof same === "boolean" && isConfidence(confidence)
    ? { kind: "ok", value: { same, confidence, why } }
    : { kind: "failed", reason: "the judge gave an answer that is not well formed" };
}

// isMatch : the judge said same, sure enough. Pure.
export function isMatch(j: Judgment): boolean {
  return j.same && j.confidence >= MIN_CONFIDENCE;
}

// modelJudge : the judge as one fresh model run per pair, in a folder that holds nothing
export function modelJudge(input: {
  readonly model: Model;
  readonly modelId: string;
  readonly instructions: string;
  readonly folder: string;
  readonly maxUsd: string;
}): Judge {
  return async (seed, finding) => {
    const ran = await input.model({
      folder: input.folder,
      model: input.modelId,
      schema: JUDGE_SCHEMA,
      prompt: judgePrompt(input.instructions, seed, finding),
      name: "eval-judge",
      maxUsd: input.maxUsd,
    });
    return ran.kind === "ok" ? readJudgment(ran.value.output) : { kind: "failed", reason: ran.reason };
  };
}

// nearby : the findings that pass the location gate at a seed and are not taken yet, nearest first, at most
// MAX_JUDGED. Pure.
export function nearby(seed: GoldenFinding, findings: readonly ActOn[], taken: ReadonlySet<string>): readonly ActOn[] {
  const distance = (f: ActOn): number => Math.abs(f.line - seed.line);
  return findings
    .filter((f) => f.file === seed.file && distance(f) <= LINE_WINDOW && !taken.has(f.id))
    .toSorted((a, b) => distance(a) - distance(b))
    .slice(0, MAX_JUDGED);
}

export type SeedResult = {
  // the seed's place in golden.json, from 0
  readonly seed: number;
  readonly matched: boolean;
  // the finding that matched it, or ""
  readonly by: string;
  readonly confidence: number;
  // why the judge could not answer, or ""
  readonly error: string;
};

type Tried = { readonly result: SeedResult; readonly taken: ReadonlySet<string> };

async function trySeed(
  index: number,
  seed: GoldenFinding,
  findings: readonly ActOn[],
  judge: Judge,
  taken: ReadonlySet<string>,
): Promise<Tried> {
  const none: SeedResult = { seed: index, matched: false, by: "", confidence: 0, error: "" };
  let top = 0;
  for (const f of nearby(seed, findings, taken)) {
    const j = await judge(seed, f);
    if (j.kind === "failed") {
      return { result: { ...none, confidence: top, error: j.reason }, taken };
    }
    if (isMatch(j.value)) {
      return {
        result: { seed: index, matched: true, by: f.id, confidence: j.value.confidence, error: "" },
        taken: new Set(taken).add(f.id),
      };
    }
    top = Math.max(top, j.value.same ? j.value.confidence : 0);
  }
  return { result: { ...none, confidence: top }, taken };
}

// matchRun : each seed of a case, matched or not, against one run's Act on findings; a judge that fails stops the run's
// matching, and the seeds left are recorded unmatched with the reason
export async function matchRun(
  seeds: readonly GoldenFinding[],
  findings: readonly ActOn[],
  judge: Judge,
): Promise<readonly SeedResult[]> {
  const out: SeedResult[] = [];
  let taken: ReadonlySet<string> = new Set();
  let stopped = "";
  for (const [i, seed] of seeds.entries()) {
    if (stopped !== "") {
      out.push({ seed: i, matched: false, by: "", confidence: 0, error: stopped });
      continue;
    }
    const tried = await trySeed(i, seed, findings, judge, taken);
    out.push(tried.result);
    taken = tried.taken;
    stopped = tried.result.error;
  }
  return out;
}
