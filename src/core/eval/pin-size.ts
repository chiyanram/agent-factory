// pin-size — which eval a plugin pin move needs, from the paths it changes (ADR-0020). The engine holds the map, and
// it fails closed: a path it does not name counts as both sizes, because the implementer can load any skill by name.
//
//   none      only files no run reads: README*, CHANGELOG*, LICENSE* at the plugin's root, and docs/, evals/, tests/,
//             .github/; config check alone proves the move
//   review    a skill reference the review baseline points to, the review.json that points to them, or the finder
//             and verify-pass cards; a targeted review pass proves it (slice.ts)
//   writer    the implementer card; the implementer eval proves it
//   both      review and writer paths, or any other path
//
// Some files a run reads are tested by no eval: the test-first, cleanup, design-reviewer, onboarder and retro cards,
// and the files no eval can test, the plugin's manifest (.claude-plugin/plugin.json) and the process files config
// check reads (lanes, schema, glossary). They add no size; the move names each and goes ahead only with a reason the
// person types, which the pin keeps (pin-proof.ts). **Today:** no eval covers those five cards; the M5 evals add them
// (#852).
//
// A changed path comes as changedFiles (fetch.ts) writes it: "+ ", "- " or "~ " and the path. A leaf with no runtime
// import, so scripts/check-eval-proof.ts loads it on Node's type stripping. Pure.

import type { Pointer } from "../review/rules.js";

export type Size = "none" | "review" | "writer" | "both";
export const SIZES: readonly Size[] = ["none", "review", "writer", "both"];

export type Sized = {
  readonly size: Size;
  readonly review: readonly string[];
  readonly writer: readonly string[];
  readonly other: readonly string[];
  readonly uncovered: readonly string[];
  readonly none: readonly string[];
};

const NONE = [/^(?:README|CHANGELOG|LICENSE)[^/]*$/, /^(?:docs|evals|tests|\.github)\//];
const CARD = /^skills\/[^/]+\/process\/roles\/([^/]+)\.md$/;
const REVIEW_CARDS = new Set(["finder", "verify-pass"]);
const WRITER_CARDS = new Set(["implementer"]);
const UNCOVERED_CARDS = new Set(["test-first", "cleanup", "design-reviewer", "onboarder", "retro"]);
const REVIEW_JSON = /^skills\/[^/]+\/process\/review\.json$/;
const UNTESTED = [
  /^\.claude-plugin\/plugin\.json$/,
  /^skills\/[^/]+\/process\/(?:lanes[^/]*\.json|glossary\.md|schema\/.+)$/,
];

export function referencePath(p: Pointer): string {
  return `skills/${p.domain}/references/${p.reference}.md`;
}

type Kind = Exclude<keyof Sized, "size">;

type Rule = readonly [Kind, (path: string, card: string, references: ReadonlySet<string>) => boolean];

const RULES: readonly Rule[] = [
  ["none", (path) => NONE.some((r) => r.test(path))],
  ["review", (path, card, refs) => refs.has(path) || REVIEW_JSON.test(path) || REVIEW_CARDS.has(card)],
  ["writer", (_path, card) => WRITER_CARDS.has(card)],
  ["uncovered", (path, card) => UNCOVERED_CARDS.has(card) || UNTESTED.some((r) => r.test(path))],
];

function kindOf(path: string, references: ReadonlySet<string>): Kind {
  const card = CARD.exec(path)?.[1] ?? "";
  return RULES.find(([, applies]) => applies(path, card, references))?.[0] ?? "other";
}

const SIZE_OF: Readonly<Record<string, Size>> = {
  "000": "none",
  "100": "review",
  "010": "writer",
};

function sizeFrom(review: boolean, writer: boolean, other: boolean): Size {
  return SIZE_OF[[review, writer, other].map((b) => (b ? "1" : "0")).join("")] ?? "both";
}

export function changedPath(line: string): string {
  return /^[+~-] /.test(line) ? line.slice(2) : line;
}

export function sizeOf(changed: readonly string[], baseline: readonly Pointer[]): Sized {
  const references = new Set(baseline.map(referencePath));
  const paths = [...new Set(changed.map(changedPath))].toSorted();
  const of = (k: Kind): readonly string[] => paths.filter((p) => kindOf(p, references) === k);
  const sized = { review: of("review"), writer: of("writer"), other: of("other"), uncovered: of("uncovered") };
  return {
    size: sizeFrom(sized.review.length > 0, sized.writer.length > 0, sized.other.length > 0),
    ...sized,
    none: of("none"),
  };
}

export function covers(have: Size, need: Size): boolean {
  return need === "none" || have === "both" || have === need;
}
