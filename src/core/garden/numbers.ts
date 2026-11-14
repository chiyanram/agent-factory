// numbers — the module numbers of a change: each touched code file measured by gardener at the merge base and at the
// head, and which of them got worse. A number counts only when the change itself moves it, so history numbers (fix
// commits, hotspot score, fix share, rework) are never read here: they move with time, and gardener compare judges
// them after a merge. Growth under the size limit is normal feature work, and a smaller number is never a finding, so a
// split is neither rewarded nor punished; whether it follows responsibilities is the design's case to make.
//
//   W1  a source file over the size limit at the head that has more lines than at the merge base
//   W2  type escapes, summed over the touched files, went up (one that only moved between them is neutral)
//   W3  lint suppressions, summed over the touched files, went up
//   W4  mocked modules or call assertions went up in a touched test file (mock-heavy tests restate the code)
//
// A leaf with no runtime imports, so a script can load it on Node's type stripping. Pure. Design: #573.

// one file's numbers at one commit, as gardener counts them
export type FileNumbers = {
  readonly test: boolean;
  readonly lines: number;
  readonly typeEscapes: number;
  readonly suppressions: number;
  readonly mockModules: number;
  readonly callAssertions: number;
};

// a file at one commit: measured, or not there (added, deleted, or a file gardener skips as generated)
export type Side = { readonly kind: "measured"; readonly numbers: FileNumbers } | { readonly kind: "absent" };

export type Row = { readonly path: string; readonly before: Side; readonly after: Side };

export type Rule = "W1" | "W2" | "W3" | "W4";

// a number that got worse: its rule, the files it is about, and the number before and after
export type Worse = {
  readonly rule: Rule;
  readonly what: string;
  readonly paths: readonly string[];
  readonly before: number;
  readonly after: number;
};

export type Read = { readonly kind: "ok"; readonly side: Side } | { readonly kind: "bad"; readonly reason: string };

const at = (value: unknown, ...keys: readonly string[]): unknown =>
  keys.reduce<unknown>((v, k) => (typeof v === "object" && v !== null ? Reflect.get(v, k) : undefined), value);

const count = (value: unknown, ...keys: readonly string[]): number | undefined => {
  const n = at(value, ...keys);
  return typeof n === "number" && Number.isInteger(n) && n >= 0 ? n : undefined;
};

// each count this module reads, and where gardener's snapshot JSON keeps it
const NAMES = [
  "sourceFiles",
  "testFiles",
  "sourceLines",
  "testLines",
  "escapesSource",
  "escapesTest",
  "suppressions",
  "mockModules",
  "callAssertions",
] as const;
type Name = (typeof NAMES)[number];
type Counts = { readonly [K in Name]: number };
const FIELDS: { readonly [K in Name]: readonly [string, string] } = {
  sourceFiles: ["files", "source"],
  testFiles: ["files", "test"],
  sourceLines: ["lines", "source"],
  testLines: ["lines", "test"],
  escapesSource: ["typeEscapes", "totalSource"],
  escapesTest: ["typeEscapes", "totalTest"],
  suppressions: ["suppressions", "total"],
  mockModules: ["tests", "mockModules"],
  callAssertions: ["tests", "callAssertions"],
};

// one file's numbers from its counts, which hold exactly one file
const numbersFrom = (f: Counts): FileNumbers =>
  f.testFiles === 1
    ? {
        test: true,
        lines: f.testLines,
        typeEscapes: f.escapesSource + f.escapesTest,
        suppressions: f.suppressions,
        mockModules: f.mockModules,
        callAssertions: f.callAssertions,
      }
    : {
        test: false,
        lines: f.sourceLines,
        typeEscapes: f.escapesSource + f.escapesTest,
        suppressions: f.suppressions,
        mockModules: 0,
        callAssertions: 0,
      };

// every count, or where the missing ones should have been
function countsOf(json: unknown): { readonly kind: "ok"; readonly counts: Counts } | Read {
  const missing = NAMES.filter((name) => count(json, ...FIELDS[name]) === undefined);
  if (missing.length > 0) {
    const where = missing.map((name) => FIELDS[name].join(".")).join(", ");
    return { kind: "bad", reason: `gardener's snapshot has no count at ${where}` };
  }
  const n = (name: Name): number => count(json, ...FIELDS[name]) ?? 0;
  return {
    kind: "ok",
    counts: {
      sourceFiles: n("sourceFiles"),
      testFiles: n("testFiles"),
      sourceLines: n("sourceLines"),
      testLines: n("testLines"),
      escapesSource: n("escapesSource"),
      escapesTest: n("escapesTest"),
      suppressions: n("suppressions"),
      mockModules: n("mockModules"),
      callAssertions: n("callAssertions"),
    },
  };
}

// fromSnapshot : one file's side from `gardener snapshot --json` run with a config whose code list is that one file.
// No file counted means the file is not there at that commit, or gardener skipped it as generated.
export function fromSnapshot(json: unknown): Read {
  const read = countsOf(json);
  if (!("counts" in read)) return read;
  const files = read.counts.sourceFiles + read.counts.testFiles;
  if (files === 0) return { kind: "ok", side: { kind: "absent" } };
  if (files > 1) return { kind: "bad", reason: `gardener's snapshot counted ${files} files, not one` };
  return { kind: "ok", side: { kind: "measured", numbers: numbersFrom(read.counts) } };
}

const ZERO: FileNumbers = {
  test: false,
  lines: 0,
  typeEscapes: 0,
  suppressions: 0,
  mockModules: 0,
  callAssertions: 0,
};
const numbersOf = (side: Side): FileNumbers => (side.kind === "measured" ? side.numbers : ZERO);

type Key = "typeEscapes" | "suppressions";

// summed over every touched file, so a number that only moved from one touched file to another is neutral
function summed(rows: readonly Row[], rule: Rule, key: Key, what: string): readonly Worse[] {
  const before = rows.reduce((n, r) => n + numbersOf(r.before)[key], 0);
  const after = rows.reduce((n, r) => n + numbersOf(r.after)[key], 0);
  if (after <= before) return [];
  const paths = rows.filter((r) => numbersOf(r.after)[key] > numbersOf(r.before)[key]).map((r) => r.path);
  return [{ rule, what, paths, before, after }];
}

// worse : the numbers this change made worse, under the merge base's size limit
export function worse(rows: readonly Row[], largeFileLines: number): readonly Worse[] {
  const big: Worse[] = rows.flatMap((r) => {
    if (r.after.kind !== "measured" || r.after.numbers.test) return [];
    const before = numbersOf(r.before).lines;
    const after = r.after.numbers.lines;
    return after > largeFileLines && after > before
      ? [{ rule: "W1" as const, what: `lines, over the limit of ${largeFileLines}`, paths: [r.path], before, after }]
      : [];
  });
  const mocks: Worse[] = rows.flatMap((r) => {
    if (r.after.kind !== "measured" || !r.after.numbers.test) return [];
    const was = numbersOf(r.before);
    const now = r.after.numbers;
    return (["mockModules", "callAssertions"] as const)
      .filter((k) => now[k] > was[k])
      .map((k) => ({
        rule: "W4" as const,
        what: k === "mockModules" ? "mocked modules" : "call assertions",
        paths: [r.path],
        before: was[k],
        after: now[k],
      }));
  });
  return [
    ...big,
    ...summed(rows, "W2", "typeEscapes", "type escapes in the touched files"),
    ...summed(rows, "W3", "suppressions", "lint suppressions in the touched files"),
    ...mocks,
  ];
}

// a side's four columns; a file not there at that commit shows a dash in each
const cells = (side: Side): string =>
  side.kind === "measured"
    ? [
        side.numbers.lines,
        side.numbers.typeEscapes,
        side.numbers.suppressions,
        side.numbers.test ? `${side.numbers.mockModules} / ${side.numbers.callAssertions}` : "",
      ].join(" | ")
    : "– | – | – | –";

// render : the rows and the worse list as Markdown, for a person (and later a CI job summary)
export function render(rows: readonly Row[], found: readonly Worse[], largeFileLines: number): string {
  const head = ["| file | lines | type escapes | suppressions | mocks / call assertions |", "|---|---|---|---|---|"];
  const body = rows.flatMap((r) => [
    `| \`${r.path}\` before | ${cells(r.before)} |`,
    `| \`${r.path}\` after | ${cells(r.after)} |`,
  ]);
  const verdict =
    found.length === 0
      ? [`No module number got worse (size limit ${largeFileLines} lines).`]
      : [
          `Worse (size limit ${largeFileLines} lines):`,
          ...found.map(
            (w) => `- ${w.rule} ${w.what}: ${w.before} → ${w.after} (${w.paths.map((p) => `\`${p}\``).join(", ")})`,
          ),
        ];
  return [...(rows.length === 0 ? ["No touched code file."] : [...head, ...body]), "", ...verdict, ""].join("\n");
}
