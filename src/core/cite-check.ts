// cite-check — every file:line a review or design-review finding cites must exist at the commit that was reviewed
// (P15, #485): the file is in that commit's tree and the line is within it. A finding whose cite does not exist cannot
// stay in Act on or Consider: it settles as noted, with "cite not found" as its why, so it is shown in the round's
// summary and never posted as a finding. A finding that names no file cites nothing, and line 0 cites the whole file.
// A model's cite is data; the engine reads the commit itself, through hostGit.

import { hostGit } from "./git.js";
import type { Bucket } from "./finding.js";

type Cite = { readonly file: string; readonly line: number; readonly lineEnd?: number };
type Cited = Cite & { readonly bucket: Bucket; readonly why: string };

export const CITE_NOT_FOUND = "cite not found";

export function citeProblem(cite: Cite, lines: number | undefined): string {
  if (cite.file === "") {
    return "";
  }
  return lines === undefined ? `${cite.file} is not in the reviewed commit` : pastEnd(cite, lines);
}

function pastEnd(cite: Cite, lines: number): string {
  return reversed(cite)
    ? `${cite.file}:${cite.line}-${cite.lineEnd} is a malformed range: it ends before it starts`
    : beyond(cite, lines);
}

function reversed(cite: Cite): boolean {
  return cite.lineEnd !== undefined && cite.lineEnd < cite.line;
}

function beyond(cite: Cite, lines: number): string {
  const end = cite.lineEnd ?? cite.line;
  const shown = cite.lineEnd === undefined ? `${cite.line}` : `${cite.line}-${cite.lineEnd}`;
  const count = `${lines} line${lines === 1 ? "" : "s"}`;
  return end <= lines ? "" : `${cite.file}:${shown} is past the end of the file (${count})`;
}

export function citeChecked<F extends Cited>(f: F, lines: number | undefined): F {
  const problem = citeProblem(f, lines);
  const counts = f.bucket === "act_on" || f.bucket === "consider";
  return problem === "" || !counts ? f : { ...f, bucket: "noted", why: `${CITE_NOT_FOUND}: ${problem}` };
}

export function lineCount(text: string): number {
  if (text === "") {
    return 0;
  }
  return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
}

function plainPath(file: string): boolean {
  return file !== "" && !file.startsWith("-") && !file.startsWith("/") && !file.includes("..");
}

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

export type Checked<F> = { readonly findings: readonly F[]; readonly notFound: number };

export async function checkCites<F extends Cited>(
  at: { readonly repo: string; readonly env: NodeJS.ProcessEnv; readonly sha: string },
  findings: readonly F[],
  own: Readonly<Record<string, string>> = {},
): Promise<Checked<F>> {
  const inRepo = findings.map((f) => f.file).filter((f) => !Object.hasOwn(own, f));
  const lines = await linesAt(at, inRepo);
  const linesOf = (file: string): number | undefined =>
    Object.hasOwn(own, file) ? lineCount(own[file] ?? "") : lines.get(file);
  const checked = findings.map((f) => citeChecked(f, linesOf(f.file)));
  return { findings: checked, notFound: checked.filter((c, i) => c !== findings[i]).length };
}
