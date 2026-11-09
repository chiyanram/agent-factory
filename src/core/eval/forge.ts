// forge — the fake git host one eval run reviews against (ADR-0015 E7, #215), as test/writer.test.ts fakes one: it
// serves the case's change and keeps what the review posts in memory, so nothing reaches a real git host. A fresh one
// per run, so every run is round 1.

import type { Done, Result } from "../forge/api.js";
import type { Change, Forge } from "../forge/types.js";
import type { Note } from "../notes.js";
import { renderPost } from "../post.js";

export function evalChange(input: {
  readonly number: number;
  readonly head: string;
  readonly branch: string;
  readonly label: string;
  readonly description: string;
}): Change {
  return {
    number: input.number,
    state: "opened",
    sha: input.head,
    sourceBranch: input.branch,
    targetBranch: "main",
    labels: [input.label],
    description: input.description,
    anchor: { kind: "github", head: input.head },
  };
}

// evalForge : the fake git host for one run; `login` is the factory's own
export function evalForge(change: Change, login: string): Forge {
  const notes: Note[] = [];
  const ok = async (): Promise<Done> => ({ kind: "ok" });
  const unused = async (what: string): Promise<{ readonly kind: "failed"; readonly reason: string }> => ({
    kind: "failed",
    reason: `an eval run does not call ${what}`,
  });
  return {
    name: "github",
    mark: "#",
    me: async (): Promise<Result<string>> => ({ kind: "ok", value: login }),
    change: async () => ({ kind: "ok", value: change }),
    defaultBranch: async () => ({ kind: "ok", value: "main" }),
    branchExists: async () => ({ kind: "ok", value: true }),
    addLabel: ok,
    removeLabel: ok,
    note: async ({ post }) => {
      const r = renderPost(post);
      const body = r.kind === "ok" ? r.text : r.reason;
      notes.push({ body, author: { name: login }, at: new Date(0).toISOString() });
      return { kind: "ok" };
    },
    notes: async () => ({ kind: "ok", value: [...notes] }),
    lineFinding: ok,
    status: async () => unused("status"),
    ciConfig: async () => unused("ciConfig"),
    claimed: async () => unused("claimed"),
    openChange: async () => unused("openChange"),
    setBody: async () => unused("setBody"),
    changes: async () => unused("changes"),
    failedJobs: async () => unused("failedJobs"),
  };
}
