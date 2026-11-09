// home — the project's brief and glossary in the project home (#235; GLOSSARY.md "Project home"), never in the product
// repo. The onboarder stages them; they take effect only once a human accepts them, the same way an approval is
// recorded: `agent-factory onboard accept <project> <brief hash> <glossary hash>` names the hashes the human read, and
// the files must still have exactly those hashes.
//
//   <home>/projects/<project>/staged/{brief.md,glossary.md,cites.json}   what the onboarder wrote, waiting for a human
//   <home>/projects/<project>/{brief.md,glossary.md,cites.json}          what a human accepted, which every run reads
//   <home>/projects/<project>/knowledge.json                             the acceptance: both hashes, by, via, at
//
// The coordinator's settings deny any edit of the project home and both commands (coordinator.ts). A brief edited after
// its acceptance is not read: a run then goes without it and its record says why.

import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Result } from "../forge/api.js";
import { field, readRecordFile, writeRecordFile } from "../human-record.js";
import { plainName, specHash } from "../spec.js";
import type { KeptCite, Written } from "./brief.js";
import { prop } from "../dispatch/records.js";

const FILES = ["brief.md", "glossary.md", "cites.json"] as const;

export type Hashes = { readonly brief: string; readonly glossary: string };

function failed(reason: string): { readonly kind: "failed"; readonly reason: string } {
  return { kind: "failed", reason };
}

export function projectDir(home: string, project: string): Result<string> {
  return plainName(project)
    ? { kind: "ok", value: join(home, "projects", project) }
    : failed(`the project must be a plain name, got ${JSON.stringify(project)}`);
}

// stage : the onboarder's files, staged for a human; their hashes, as the human confirms them
export async function stage(input: {
  readonly home: string;
  readonly project: string;
  readonly written: Written;
}): Promise<Result<Hashes>> {
  const dir = projectDir(input.home, input.project);
  if (dir.kind === "failed") {
    return dir;
  }
  const staged = join(dir.value, "staged");
  try {
    await mkdir(staged, { recursive: true, mode: 0o700 });
    await writeFile(join(staged, "brief.md"), input.written.brief, { mode: 0o644 });
    await writeFile(join(staged, "glossary.md"), input.written.glossary, { mode: 0o644 });
    await writeFile(join(staged, "cites.json"), `${JSON.stringify(input.written.cites, null, 2)}\n`, { mode: 0o644 });
  } catch {
    return failed(`cannot write the staged brief in ${staged}`);
  }
  return { kind: "ok", value: { brief: specHash(input.written.brief), glossary: specHash(input.written.glossary) } };
}

async function hashesIn(dir: string): Promise<Hashes | "missing"> {
  const [brief, glossary] = await Promise.all(
    ["brief.md", "glossary.md"].map((f) => readFile(join(dir, f), "utf8").catch(() => undefined)),
  );
  return brief === undefined || glossary === undefined
    ? "missing"
    : { brief: specHash(brief), glossary: specHash(glossary) };
}

// accept : a human's acceptance of the staged files with exactly these hashes; they move into the project home
export async function accept(input: {
  readonly home: string;
  readonly project: string;
  readonly seen: Hashes;
  readonly by: string;
  readonly at: string;
}): Promise<Result<string>> {
  const dir = projectDir(input.home, input.project);
  if (dir.kind === "failed") {
    return dir;
  }
  const staged = join(dir.value, "staged");
  const now = await hashesIn(staged);
  if (now === "missing") {
    return failed(`nothing is staged for ${input.project}: run agent-factory onboard ${input.project} first`);
  }
  if (now.brief !== input.seen.brief || now.glossary !== input.seen.glossary) {
    return failed("the staged brief or glossary does not have the hashes you confirmed: it changed; read it again");
  }
  return moved(dir.value, staged, { ...input, hashes: now });
}

async function moved(
  dir: string,
  staged: string,
  input: { readonly project: string; readonly hashes: Hashes; readonly by: string; readonly at: string },
): Promise<Result<string>> {
  try {
    for (const f of FILES) {
      await copyFile(join(staged, f), join(dir, f));
    }
  } catch {
    return failed(`cannot move the staged brief into ${dir}`);
  }
  const record = {
    version: 1,
    kind: "knowledge",
    project: input.project,
    brief_hash: input.hashes.brief,
    glossary_hash: input.hashes.glossary,
    by: input.by,
    via: "terminal",
    at: input.at,
  };
  const written = await writeRecordFile(join(dir, "knowledge.json"), record);
  if (written.kind !== "written") {
    return failed(written.reason);
  }
  await rm(staged, { recursive: true, force: true });
  return { kind: "ok", value: dir };
}

export type Knowledge =
  | { readonly kind: "none" }
  // accepted, but a file changed since: a run goes without it
  | { readonly kind: "changed"; readonly why: string }
  | {
      readonly kind: "accepted";
      readonly brief: string;
      readonly glossary: string;
      readonly cites: readonly KeptCite[];
    };

function citesOf(text: string): readonly KeptCite[] {
  try {
    const raw = JSON.parse(text) as unknown;
    return Array.isArray(raw)
      ? raw.flatMap((c: unknown) => {
          const [file, line, t] = [prop(c, "file"), prop(c, "line"), prop(c, "text")];
          return typeof file === "string" && Number.isSafeInteger(line) && typeof t === "string"
            ? [{ file, line: Number(line), text: t }]
            : [];
        })
      : [];
  } catch {
    return [];
  }
}

// readKnowledge : the accepted brief and glossary, which every run reads; none before a human accepts one
// acceptedHashes : the hashes a human accepted, or "none" without an acceptance
async function acceptedHashes(dir: string): Promise<Hashes | "none"> {
  const record = await readRecordFile(join(dir, "knowledge.json"));
  return record.kind === "json"
    ? { brief: String(field(record.value, "brief_hash")), glossary: String(field(record.value, "glossary_hash")) }
    : "none";
}

function sameHashes(a: Hashes | "missing", b: Hashes): boolean {
  return a !== "missing" && a.brief === b.brief && a.glossary === b.glossary;
}

export async function readKnowledge(home: string, project: string): Promise<Knowledge> {
  const dir = projectDir(home, project);
  const record = dir.kind === "ok" ? await acceptedHashes(dir.value) : "none";
  if (dir.kind === "failed" || record === "none") {
    return { kind: "none" };
  }
  if (!sameHashes(await hashesIn(dir.value), record)) {
    return {
      kind: "changed",
      why: "brief.md or glossary.md changed since a human accepted it; run agent-factory onboard again",
    };
  }
  const read = (f: string) => readFile(join(dir.value, f), "utf8").catch(() => "");
  const [brief, glossary, cites] = await Promise.all([read("brief.md"), read("glossary.md"), read("cites.json")]);
  return { kind: "accepted", brief, glossary, cites: citesOf(cites) };
}
