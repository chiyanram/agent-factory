// lenses — which finders a review round runs, and how their findings become one list (#237; docs/DESIGN.md sections 3
// and 5; decided on #30, v4 D-F5 = A). Pure: the round reads the settings, the lane and the diff, and passes them in.
//
//   pickLenses     the blast radius. A lens applies when its `lanes` hold the change's lane and its `paths` match a
//                  touched file (an empty list matches all). A file under a one-way-door path, or a lane whose lens
//                  count is "all", runs every applicable lens on the strongest model; otherwise the lane's count
//                  (tiny 1, bug and feature about 3) takes the first ones in the settings' order. The test-integrity
//                  lens runs whenever an existing test file changed, on top of the count, and never otherwise. The diff
//                  size reaches the pick through the lane, which the ready check sets from the real diff.
//   mergeFindings  one finder run per lens; the same file:line with the same rule is one finding, kept at its first
//                  report and naming every lens that reported it, then renumbered F1…Fn for the one verify pass.
//   uniqueByLens   per lens, the verified findings no other lens reported, so a lens that adds none after 20 PRs can be
//                  retired (DESIGN.md section 6). Dismissed findings do not count.
//
// Not yet here (#237, after #232): the lenses settings key, a finder run per lens from the finder role card, the
// lens and grade fields on a finding, and the per-lens count in the run record.

import { isTestFile } from "../ready/floor.js";
import { matches } from "../lane.js";

// the lens that reviews every edit to an existing test (DESIGN.md section 5; its rubric: chiyanram/skills#235)
export const TEST_INTEGRITY = "test-integrity";

// where a lens's rubric comes from: a skill in an enabled plugin, or a file in the repo on the default branch
export type Rubric =
  | { readonly kind: "skill"; readonly plugin: string; readonly skill: string }
  | { readonly kind: "file"; readonly path: string };

export type Lens = {
  readonly name: string;
  readonly rubric: Rubric;
  // globs; empty for every file
  readonly paths: readonly string[];
  // lane names; empty for every lane
  readonly lanes: readonly string[];
};

// a file the change touches, and whether it was there before the change
export type Touched = { readonly path: string; readonly existed: boolean };

// how many lenses a lane runs: its lens count, or every lens
export type LensCount = number | "all";

export type Pick = {
  readonly lenses: readonly Lens[];
  // every lens on the strongest model: a one-way door, by its lane or by a path it touches
  readonly strongest: boolean;
};

function applies(lens: Lens, lane: string, touched: readonly Touched[]): boolean {
  const inLane = lens.lanes.length === 0 || lens.lanes.includes(lane);
  return inLane && (lens.paths.length === 0 || touched.some((t) => matches(t.path, lens.paths)));
}

// editsTest : an existing test file changed, as the ready check names test files. Pure.
export function editsTest(touched: readonly Touched[], testFiles: readonly string[]): boolean {
  return touched.some((t) => t.existed && isTestFile(t.path, testFiles));
}

// pickLenses : the lenses a round runs; at least one when any lens applies. Pure.
export function pickLenses(input: {
  readonly lenses: readonly Lens[];
  readonly lane: string;
  readonly count: LensCount;
  readonly touched: readonly Touched[];
  readonly oneWayDoor: readonly string[];
  readonly testFiles: readonly string[];
}): Pick {
  const tests = editsTest(input.touched, input.testFiles);
  const integrity = input.lenses.filter((l) => l.name === TEST_INTEGRITY && tests);
  const others = input.lenses.filter((l) => l.name !== TEST_INTEGRITY && applies(l, input.lane, input.touched));
  const cap = input.count === "all" ? others.length : input.count;
  const strongest = input.count === "all" || input.touched.some((t) => matches(t.path, input.oneWayDoor));
  const counted = strongest ? others : others.slice(0, Math.max(1, cap));
  return { lenses: [...counted, ...integrity], strongest };
}

// a finding as a finder reports it, with the lens that ran it
type Reported = { readonly id: string; readonly file: string; readonly line: number; readonly rule: string };

export type Merged<F extends Reported> = F & { readonly lenses: readonly string[] };

type Kept<F> = { readonly finding: F; readonly lenses: string[] };

// keepOne : one report into the findings kept so far, by file, line and rule
function keepOne<F extends Reported>(kept: Map<string, Kept<F>>, lens: string, f: F): void {
  const key = JSON.stringify([f.file, f.line, f.rule]);
  const seen = kept.get(key);
  if (seen === undefined) {
    kept.set(key, { finding: f, lenses: [lens] });
  } else if (!seen.lenses.includes(lens)) {
    seen.lenses.push(lens);
  }
}

// mergeFindings : every lens's findings, in the lenses' order, as one list for the verify pass. Pure.
export function mergeFindings<F extends Reported>(
  byLens: readonly { readonly lens: string; readonly findings: readonly F[] }[],
): readonly Merged<F>[] {
  const kept = new Map<string, Kept<F>>();
  for (const { lens, findings } of byLens) {
    for (const f of findings) {
      keepOne(kept, lens, f);
    }
  }
  const merged: Merged<F>[] = [];
  for (const k of kept.values()) {
    merged.push({ ...k.finding, id: `F${merged.length + 1}`, lenses: k.lenses });
  }
  return merged;
}

// uniqueByLens : per lens that ran, its verified findings that no other lens reported. Pure.
export function uniqueByLens(
  ran: readonly string[],
  sorted: readonly { readonly lenses: readonly string[]; readonly bucket: string }[],
): Readonly<Record<string, number>> {
  const verified = sorted.filter((f) => f.bucket !== "dismissed" && f.lenses.length === 1);
  return Object.fromEntries(ran.map((lens) => [lens, verified.filter((f) => f.lenses[0] === lens).length]));
}
