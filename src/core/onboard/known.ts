// known — the project's accepted brief and glossary as a run's input (#235): every run reads them, and every cite in
// them is checked again against the default branch first. A stale cite is reported in the run record for the retro;
// the run still gets the brief, since one moved line does not make the rest wrong. A brief edited after its acceptance
// is not handed to the run at all, and that is reported the same way.

import { hostGit } from "../git.js";
import { staleCites } from "./cites.js";
import { readKnowledge } from "./home.js";

export type Known = {
  // the accepted brief and glossary, or none
  readonly files:
    | { readonly kind: "none" }
    | { readonly kind: "text"; readonly brief: string; readonly glossary: string };
  // each stale cite, or why the brief was not handed over
  readonly stale: readonly string[];
};

export const NOTHING_KNOWN: Known = { files: { kind: "none" }, stale: [] };

// knownFor : the accepted brief and glossary, with each cite checked at `ref` (the default branch, fetched into the
// project's clone)
export async function knownFor(input: {
  readonly home: string;
  readonly project: string;
  readonly repo: string;
  readonly env: NodeJS.ProcessEnv;
  readonly ref: string;
}): Promise<Known> {
  const knowledge = await readKnowledge(input.home, input.project);
  if (knowledge.kind !== "accepted") {
    return knowledge.kind === "none" ? NOTHING_KNOWN : { files: { kind: "none" }, stale: [knowledge.why] };
  }
  const lines = new Map<string, readonly string[] | undefined>();
  for (const file of new Set(knowledge.cites.map((c) => c.file))) {
    const shown = await hostGit({
      args: ["show", `${input.ref}:${file}`],
      repo: { kind: "repo", path: input.repo },
      env: input.env,
      ownHelper: { kind: "none" },
      stdin: { kind: "none" },
    });
    lines.set(file, shown.kind === "ok" ? shown.stdout.replace(/\n$/, "").split("\n") : undefined);
  }
  return {
    files: { kind: "text", brief: knowledge.brief, glossary: knowledge.glossary },
    stale: staleCites(knowledge.cites, (path) => lines.get(path)),
  };
}
