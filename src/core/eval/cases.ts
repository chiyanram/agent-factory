// cases — the golden set's cases as the eval harness runs them (#215). Only a case whose row in cases.md the operator
// set to approved counts; a draft runs only when the operator asks for drafts, and the result then says so and is not
// proof (evals/reviewer/README.md). Each case's spec, which the review reads as its contract, is made from its pr.md.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Result } from "../forge/api.js";
import { attempt } from "../review/safe.js";
import { readGolden, tableRows, type GoldenFinding, type Row } from "./golden.js";

export const CASES_DIR = join("evals", "reviewer");

export type Case = {
  readonly name: string;
  readonly kind: string;
  readonly status: string;
  readonly base: string;
  // the absolute path of change.patch
  readonly patch: string;
  readonly golden: readonly GoldenFinding[];
  // pr.md as it is, or ""
  readonly pr: string;
};

export type Chosen = { readonly run: readonly Row[]; readonly skipped: readonly Row[] };

// choose : the rows to run: approved ones, and drafts too only when asked. Pure.
export function choose(rows: readonly Row[], drafts: boolean): Chosen {
  const runs = (r: Row): boolean => r.status === "approved" || (drafts && r.status === "draft");
  return { run: rows.filter(runs), skipped: rows.filter((r) => !runs(r)) };
}

export async function readRows(root: string): Promise<Result<readonly Row[]>> {
  const table = join(root, CASES_DIR, "cases.md");
  const text = await attempt(() => readFile(table, "utf8"), `cannot read ${table}`);
  return text.kind === "ok" ? { kind: "ok", value: tableRows(text.value) } : text;
}

async function optional(path: string): Promise<string> {
  return readFile(path, "utf8").catch(() => "");
}

// readCase : one case's files; a case that is not well-formed fails with its name (make lint says more)
export async function readCase(root: string, row: Row): Promise<Result<Case>> {
  const dir = join(root, CASES_DIR, row.name);
  const files = await attempt(
    async () => ({
      sha: await readFile(join(dir, "base.sha"), "utf8"),
      golden: await readFile(join(dir, "golden.json"), "utf8"),
    }),
    `${row.name}: cannot read base.sha or golden.json`,
  );
  if (files.kind === "failed") {
    return files;
  }
  const golden = readGolden(files.value.golden);
  if (golden.kind === "failed") {
    return { kind: "failed", reason: `${row.name}: ${golden.reason}` };
  }
  const base = files.value.sha.trim();
  return /^[0-9a-f]{40}$/.test(base)
    ? {
        kind: "ok",
        value: {
          ...row,
          base,
          patch: join(dir, "change.patch"),
          golden: golden.value,
          pr: await optional(join(dir, "pr.md")),
        },
      }
    : { kind: "failed", reason: `${row.name}: base.sha is not one 40-hex commit hash` };
}

type PrText = { readonly title: string; readonly body: string };

// prText : pr.md's title (its first line, after "# ") and the rest. Pure.
export function prText(pr: string): PrText {
  const [first = "", ...rest] = pr.replace(/\r\n?/g, "\n").split("\n");
  const title = /^#\s+(.*\S)\s*$/.exec(first)?.[1] ?? "";
  return title === "" ? { title: "", body: pr.trim() } : { title, body: rest.join("\n").trim() };
}

const NO_CRITERIA = "The change does what the description above says, and breaks nothing else.";

function split(body: string): { readonly intent: string; readonly criteria: readonly string[] } {
  const at = body.search(/^## +Acceptance criteria\s*$/im);
  const intent = (at === -1 ? body : body.slice(0, at)).trim();
  const criteria =
    at === -1
      ? []
      : body
          .slice(at)
          .split("\n")
          .map((l) => /^\s*\d+[.)]\s+(.*\S)\s*$/.exec(l)?.[1] ?? "")
          .filter((l) => l !== "");
  return { intent, criteria };
}

// specOf : the spec the review reads for a case: pr.md's title, its text before "## Acceptance criteria" as the
// intent, and its numbered criteria; a case with none gets one plain criterion, so a spec is never empty. Pure.
export function specOf(c: Case): string {
  const pr = prText(c.pr);
  const { intent, criteria } = split(pr.body);
  const list = criteria.length > 0 ? criteria : [NO_CRITERIA];
  return [
    `# ${c.name}: ${pr.title || `the change of golden-set case ${c.name}`}`,
    "",
    "## Intent",
    "",
    intent || "The change as it is.",
    "",
    "## Acceptance criteria",
    "",
    ...list.map((l, i) => `${i + 1}. ${l}`),
    "",
    "## Design",
    "",
    "none",
    "",
    "## Lane",
    "",
    "feature",
    "",
  ].join("\n");
}
