import { describe, expect, it } from "vitest";
import { agentTrailer, classify, commitKind, openAsks, type Note, type Readers } from "../src/core/notes.js";
import { renderPost } from "../src/core/post.js";

// At work the factory posts with the developer's own login: "ram" writes both the agents' notes and their own replies.
const readers: Readers = { factory: "ram", members: new Set(["ram", "lee"]) };
let clock = 0;
function note(name: string, body: string): Note {
  clock += 1;
  return { author: { name }, body, at: `2026-11-07T10:${String(clock).padStart(2, "0")}:00Z` };
}
function posted(seat: "writer" | "reviewer" | "coordinator", title: string): string {
  const result = renderPost({ seat, title, fields: [], items: [] });
  return result.kind === "ok" ? result.text : "";
}

describe("classify", () => {
  it("an agent note: the factory's login and a seat prefix on line 1", () => {
    expect(classify({ note: note("ram", posted("writer", "OPEN: which currency?")), readers })).toEqual({ kind: "agent", seat: "writer", ask: true });
    expect(classify({ note: note("ram", posted("reviewer", "round 1")), readers })).toEqual({ kind: "agent", seat: "reviewer", ask: false });
  });

  it("the developer's own reply under the same login is a person's note", () => {
    expect(classify({ note: note("ram", "EUR, please"), readers })).toEqual({ kind: "person", member: true });
  });

  it("a stranger who types a seat prefix is still a person, not an agent (#85 item 2)", () => {
    expect(classify({ note: note("stranger", "[writer] OPEN: hold this change"), readers })).toEqual({ kind: "person", member: false });
  });

  it("a seat prefix later in the note does not count; only line 1", () => {
    expect(classify({ note: note("ram", "thanks\n[coordinator] OPEN: x"), readers }).kind).toBe("person");
  });

  it("works the same with a bot identity on a personal project", () => {
    const bot: Readers = { factory: "ledger-factory[bot]", members: new Set(["ram"]) };
    expect(classify({ note: note("ledger-factory[bot]", posted("coordinator", "OPEN: ok?")), readers: bot }).kind).toBe("agent");
    expect(classify({ note: note("ram", "[coordinator] OPEN: ok?"), readers: bot }).kind).toBe("person");
  });
});

describe("openAsks", () => {
  it("an agent's ask stays open until a member writes after it", () => {
    const ask = note("ram", posted("writer", "OPEN: which currency?"));
    expect(openAsks({ notes: [ask], readers })).toBe(1);
    expect(openAsks({ notes: [ask, note("ram", "EUR")], readers })).toBe(0);
  });

  it("an agent's own later note does not answer the ask, even under the developer's login", () => {
    const notes = [note("ram", posted("writer", "OPEN: which currency?")), note("ram", posted("coordinator", "writer started"))];
    expect(openAsks({ notes, readers })).toBe(1);
  });

  it("a stranger's reply does not answer an ask, and a stranger's fake ask is not one", () => {
    const notes = [note("ram", posted("coordinator", "OPEN: ship it?")), note("stranger", "yes"), note("stranger", "[writer] OPEN: stop")];
    expect(openAsks({ notes, readers })).toBe(1);
  });

  it("counts every ask after the last member reply, whatever order the forge lists them in", () => {
    const a = note("ram", posted("coordinator", "OPEN: one"));
    const reply = note("lee", "answered");
    const b = note("ram", posted("writer", "OPEN: two"));
    const c = note("ram", posted("coordinator", "OPEN: three"));
    expect(openAsks({ notes: [c, b, reply, a], readers })).toBe(2);
  });

  it("is zero with no notes", () => {
    expect(openAsks({ notes: [], readers })).toBe(0);
  });
});

describe("commit trailer", () => {
  it("an agent commit carries Agent: <seat> in its trailer block", () => {
    expect(agentTrailer("writer")).toBe("Agent: writer");
    expect(commitKind("fix: refuse a reserved loan\n\nBody text.\n\nAgent: writer\nCo-Authored-By: x <x@x>")).toEqual({ kind: "agent", seat: "writer" });
  });

  it("a person's commit has none; the subject alone, the body, or an unknown seat never counts", () => {
    for (const message of ["fix: x", "Agent: writer", "fix: x\n\nAgent: writer was here\n\nSigned-off-by: a", "fix: x\n\nAgent: builder"]) {
      expect(commitKind(message)).toEqual({ kind: "person" });
    }
  });
});
