// a spec's "Blocked by" holds the build until each blocker is merged (#494; P1)
import { describe, expect, it } from "vitest";
import { blockersView, cycleFrom, waitingWhy, withIssue } from "../src/core/dispatch/blockers.js";

describe("blockersView", () => {
  it("holds the build while a blocker is not merged, and lets it start once the last one merges", () => {
    const waiting = blockersView(
      "PROJ-3",
      ["PROJ-1", "PROJ-2"],
      [
        { ticket: "PROJ-1", state: "merged", blockedBy: [] },
        { ticket: "PROJ-2", state: "opened", blockedBy: [] },
      ],
    );
    expect(waiting).toEqual({ kind: "waiting", on: [{ ticket: "PROJ-2", state: "opened" }] });
    expect(waitingWhy(waiting.kind === "waiting" ? waiting.on : [])).toBe(
      "blocked by PROJ-2 (open, not merged): the build starts once each is merged",
    );
    const free = blockersView(
      "PROJ-3",
      ["PROJ-1", "PROJ-2"],
      [
        { ticket: "PROJ-1", state: "merged", blockedBy: [] },
        { ticket: "PROJ-2", state: "merged", blockedBy: [] },
      ],
    );
    expect(free).toEqual({ kind: "none" });
  });

  it("sends a closed-unmerged blocker, the ticket itself and a cycle to a person", () => {
    expect(blockersView("PROJ-3", ["PROJ-1"], [{ ticket: "PROJ-1", state: "closed", blockedBy: [] }])).toEqual({
      kind: "broken",
      why: "blocked by PROJ-1, closed without a merge",
    });
    expect(blockersView("PROJ-3", ["PROJ-3"], [])).toMatchObject({
      kind: "broken",
      why: expect.stringContaining("itself"),
    });
    const cycle = blockersView(
      "PROJ-3",
      ["PROJ-1"],
      [
        { ticket: "PROJ-1", state: "opened", blockedBy: ["PROJ-2"] },
        { ticket: "PROJ-2", state: "none", blockedBy: ["PROJ-3"] },
      ],
    );
    expect(cycle).toEqual({
      kind: "broken",
      why: 'the "Blocked by" sections form a cycle: PROJ-3 → PROJ-1 → PROJ-2 → PROJ-3',
    });
  });

  it("finds no cycle in a chain that ends", () => {
    const specs = new Map([
      ["A", ["B"]],
      ["B", ["C"]],
      ["C", []],
    ]);
    expect(cycleFrom("A", specs)).toEqual([]);
  });
});

// #494 AC-9: a blocker that is a git host issue counts by its issue too
describe("withIssue (AC-9)", () => {
  it("a merge on the branch stands; a closed issue decides by why; an open one leaves the branch's state", () => {
    expect(withIssue("merged", "not_planned")).toBe("merged");
    expect(withIssue("none", "completed")).toBe("merged");
    expect(withIssue("closed", "completed")).toBe("merged");
    expect(withIssue("none", "not_planned")).toBe("closed");
    expect(withIssue("opened", "closed")).toBe("unseen");
    expect(withIssue("opened", "open")).toBe("opened");
  });

  it("an issue closed with no merge seen, or not planned, goes to a person, named", () => {
    const read = (state: "closed" | "unseen") => [{ ticket: "12", state, blockedBy: [] }];
    expect(blockersView("20", ["12"], read("unseen"))).toEqual({
      kind: "broken",
      why: "blocked by 12, closed, no merge seen",
    });
    expect(blockersView("20", ["12"], read("closed"))).toEqual({
      kind: "broken",
      why: "blocked by 12, closed without a merge",
    });
  });
});

describe("cycleFrom's cost", () => {
  it("walks each ticket once: 25 layers of two tickets, each blocked by both below, take no time", () => {
    const specs = new Map<string, readonly string[]>([["T", ["L0a", "L0b"]]]);
    for (let i = 0; i < 25; i += 1) {
      const below = i === 24 ? [] : [`L${i + 1}a`, `L${i + 1}b`];
      specs.set(`L${i}a`, below);
      specs.set(`L${i}b`, below);
    }
    const started = performance.now();
    expect(cycleFrom("T", specs)).toEqual([]);
    // a walk without its visited set takes 2^25 paths here
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe("an unread blocker (#494 AC-7)", () => {
  it("is unread, naming each with the git host's reason; a broken one still goes to a person first", () => {
    const read = [
      { ticket: "A", state: "none", blockedBy: [], unread: "github: 502" },
      { ticket: "B", state: "opened", blockedBy: [] },
    ] as const;
    expect(blockersView("T", ["A", "B"], read)).toEqual({ kind: "unread", why: "A: github: 502" });
    const closed = [...read, { ticket: "C", state: "closed", blockedBy: [] }] as const;
    expect(blockersView("T", ["A", "B", "C"], closed)).toEqual({
      kind: "broken",
      why: "blocked by C, closed without a merge",
    });
  });
});
