// cite-check — every file:line a review or design-review finding cites must exist at the commit that was reviewed
// (P15, #485): the file is in that commit's tree and the line is within it. A finding whose cite does not exist cannot
// stay in Act on or Consider: it settles as noted, with "cite not found" as its why, so it is shown in the round's
// summary and never posted as a finding. A finding that names no file cites nothing, and line 0 cites the whole file.
// A model's cite is data; the engine reads the commit itself, through hostGit.

import { hostGit } from "./git.js";
import type { Bucket } from "./finding.js";

type Cited = { readonly file: string; readonly line: number; readonly bucket: Bucket; readonly why: string };

// the start of the why a finding with a missing cite settles with; a person and a test read it
export const CITE_NOT_FOUND = "cite not found";

// citeProblem : why a cite does not exist, given the file's line count at the commit (undefined: no such file); "" when
// it exists or the finding cites no file. Pure.
export function citeProblem(cite: { readonly file: string; readonly line: number }, lines: number | undefined): string {
  if (cite.file === "") {
    return "";
  }
  if (lines === undefined) {
    return `${cite.file} is not in the reviewed commit`;
  }
  return cite.line <= lines
    ? ""
    : `${cite.file}:${cite.line} is past the end of the file (${lines} line${lines === 1 ? "" : "s"})`;
}

// citeChecked : a settled finding, moved out of Act on or Consider to noted when its cite does not exist. Pure.
export function citeChecked<F extends Cited>(f: F, lines: number | undefined): F {
  const problem = citeProblem(f, lines);
  const counts = f.bucket === "act_on" || f.bucket === "consider";
  return problem === "" || !counts ? f : { ...f, bucket: "noted", why: `${CITE_NOT_FOUND}: ${problem}` };
}

// lineCount : the lines of text a file holds; a last line with no newline still counts. Pure.
export function lineCount(text: string): number {
  if (text === "") {
    return 0;
  }
  return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
}

// plainPath : a path git reads as a path, never as an option, a revision range or a path outside the tree. Pure.
function plainPath(file: string): boolean {
  return file !== "" && !file.startsWith("-") && !file.startsWith("/") && !file.includes("..");
}

// linesIn : one file's line count at the commit, undefined for a file the commit's tree does not hold
async function linesIn(
  at: { readonly repo: string; readonly env: NodeJS.ProcessEnv; readonly sha: string },
  file: string,
): Promise<number | undefined> {
  if (!plainPath(file)) {
    return undefined;
  }
  const shown = await hostGit({
    args: ["show", `${at.sha}:${file}`],
    repo: { kind: "repo", path: at.repo },
    env: at.env,
    stdin: { kind: "none" },
  });
  return shown.kind === "ok" ? lineCount(shown.stdout) : undefined;
}

// linesAt : each cited file's line count at the commit
async function linesAt(
  at: { readonly repo: string; readonly env: NodeJS.ProcessEnv; readonly sha: string },
  files: readonly string[],
): Promise<ReadonlyMap<string, number | undefined>> {
  const out = new Map<string, number | undefined>();
  for (const file of new Set(files.filter((f) => f !== ""))) {
    out.set(file, await linesIn(at, file));
  }
  return out;
}

// checkCites : every finding, each cite checked at the reviewed commit
export async function checkCites<F extends Cited>(
  at: { readonly repo: string; readonly env: NodeJS.ProcessEnv; readonly sha: string },
  findings: readonly F[],
): Promise<readonly F[]> {
  const lines = await linesAt(
    at,
    findings.map((f) => f.file),
  );
  return findings.map((f) => citeChecked(f, lines.get(f.file)));
}
