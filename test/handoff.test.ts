import { describe, expect, it } from "vitest";
import type { BoardLine } from "../src/core/dispatch/board.js";
import type { Result } from "../src/core/forge/api.js";
import { HANDOFF_MAX_CHARS, handoffNote, mapTables, type MapRead } from "../src/core/handoff.js";

const UTC = { name: "UTC" };
const AT = Date.parse("2026-11-17T15:00:00Z");

const line = (over: Partial<BoardLine>): BoardLine => ({
  ticket: "1",
  change: "none",
  lane: "factory",
  step: "build",
  waitsOn: { kind: "run", what: "the implementer" },
  since: "",
  forMs: 0,
  ...over,
});

const ok = <T>(value: T): Result<T> => ({ kind: "ok", value });

const map = (number: number, rows: number): MapRead => ({
  number,
  title: `map ${number}`,
  body: ok(
    [
      "Some prose that the note drops.",
      "",
      "| child | state |",
      "|---|---|",
      ...Array.from({ length: rows }, (_, i) => `| #${number}${i} | open, with a fairly long state text ${i} |`),
      "",
      "More prose.",
    ].join("\n"),
  ),
});

const note = (over: Partial<Parameters<typeof handoffNote>[0]> = {}) =>
  handoffNote({
    project: "aruvii",
    at: AT,
    lines: ok([
      line({ ticket: "5", lane: "factory" }),
      line({ ticket: "7", lane: "needs-you", waitsOn: { kind: "person", who: "operator", does: "answers" } }),
      line({ ticket: "6", lane: "ready-to-merge", change: 60 }),
    ]),
    maps: ok([map(654, 2)]),
    zone: UTC,
    mark: "#",
    ...over,
  });

describe("mapTables", () => {
  it("keeps a map body's table lines and drops its prose", () => {
    const body = "intro\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\ntext\n  | c |\n";
    expect(mapTables(body)).toEqual(["| a | b |", "|---|---|", "| 1 | 2 |", "", "| c |"]);
  });

  it("keeps nothing from a body with no table", () => {
    expect(mapTables("just prose\n")).toEqual([]);
  });

  it("drops a table line inside a code fence", () => {
    expect(mapTables("```\n| not | a table |\n```\n| a |\n")).toEqual(["| a |"]);
  });

  it("closes a fence only with the same character, at least as long", () => {
    expect(mapTables("````\n~~~\n| in |\n```\n| still in |\n````\n| out |\n")).toEqual(["| out |"]);
  });
});

describe("handoffNote", () => {
  it("opens with the reset marker, then waits on you, in flight, open maps and read more, in that order", () => {
    const { text, complete } = note();
    expect(complete).toBe(true);
    const lines = text.split("\n");
    expect(lines[0]).toBe(
      "factory handoff: aruvii at 2026-11-17T15:00:00Z; this note replaces the earlier conversation",
    );
    const heads = lines.filter((l) => l.startsWith("## "));
    expect(heads).toEqual(["## Waits on you", "## In flight", "## Open maps (1)", "## Read more"]);
    const waits = text.slice(text.indexOf("## Waits on you"), text.indexOf("## In flight"));
    expect(waits).toContain("  7  no PR  build");
    expect(waits).not.toContain("  5  ");
    const flight = text.slice(text.indexOf("## In flight"), text.indexOf("## Open maps"));
    expect(flight).toContain("ready to merge (1)");
    expect(flight).toContain("  6  #60  build");
    expect(flight).toContain("factory (1)");
    expect(flight).toContain("  5  no PR  build");
    const maps = text.slice(text.indexOf("## Open maps"), text.indexOf("## Read more"));
    expect(maps).toContain("### #654 map 654");
    expect(maps).toContain("| #6540 |");
    expect(maps).not.toContain("prose");
    expect(text).toContain("agent-factory board aruvii");
  });

  it("gives the same note for the same records and time: no model is called", () => {
    expect(note().text).toBe(note().text);
  });

  it("says when there is no open map", () => {
    expect(note({ maps: ok([]) }).text).toContain("## Open maps (0)\n  none open");
  });

  it("stays under the cap by clipping the maps' rows from the last map back, saying how many rows are left out", () => {
    const { text, complete } = note({ maps: ok([map(1, 400), map(2, 400)]) });
    expect(complete).toBe(true);
    expect(text.length).toBeLessThanOrEqual(HANDOFF_MAX_CHARS);
    expect(text).toMatch(/\(\d+ more table lines: read #2\)/);
    expect(text).toContain("| #10 |");
    expect(text).toContain("| #1399 |");
  });

  it("never clips what waits on the operator, even past the cap", () => {
    const many = Array.from({ length: 50 }, (_, i) =>
      line({ ticket: `T${i}`, lane: "needs-you", waitsOn: { kind: "person", who: "operator", does: "answers" } }),
    );
    const { text } = note({ lines: ok(many), maps: ok([map(1, 300)]), maxChars: 2_000 });
    for (const l of many) {
      expect(text).toContain(`  ${l.ticket}  no PR`);
    }
    expect(text).toContain("(302 more table lines: read #1)");
  });

  it("clips what is in flight only after the maps' rows are gone", () => {
    const many = Array.from({ length: 50 }, (_, i) => line({ ticket: `F${i}`, lane: "factory" }));
    const { text } = note({ lines: ok(many), maps: ok([map(1, 3)]), maxChars: 1_500 });
    expect(text.length).toBeLessThanOrEqual(1_500);
    expect(text).toContain("(5 more table lines: read #1)");
    expect(text).toMatch(/\(\d+ more tickets: run agent-factory board aruvii\)/);
    expect(text).toContain("  F0  no PR");
    expect(text).toContain("factory (50)");
    const lines = text.split("\n");
    const last = lines.findLastIndex((l) => /^ {2}F\d+ {2}/.test(l));
    expect(lines[last + 1]).toMatch(/^ {4}waits on /);
  });

  it("never leaves a table's head without its rows", () => {
    const full = note({ maps: ok([map(1, 3)]) }).text.length;
    const { text } = note({ maps: ok([map(1, 3)]), maxChars: full - 120 });
    expect(text).not.toContain("| child | state |");
    expect(text).toContain("(5 more table lines: read #1)");
  });

  it("says when an open map holds no table", () => {
    const plain: MapRead = { number: 8, title: "eight", body: ok("only prose") };
    expect(note({ maps: ok([plain]) }).text).toContain("### #8 eight\n  no table: read #8");
  });

  it("cuts many large maps in a few steps, to the cap", () => {
    const maps = Array.from({ length: 20 }, (_, i) => map(i + 1, 500));
    const { text } = note({ maps: ok(maps) });
    expect(text.length).toBeLessThanOrEqual(HANDOFF_MAX_CHARS);
    expect(text).toContain("### #20 map 20");
  });

  it("names a board it cannot read in one line, in both board sections, and is not complete", () => {
    const { text, complete } = note({ lines: { kind: "failed", reason: "records unreadable" } });
    expect(complete).toBe(false);
    expect(text.split("\n").filter((l) => l === "  could not read the board: records unreadable")).toHaveLength(2);
  });

  it("names open maps it cannot list, and a map whose body it cannot read, and is not complete", () => {
    expect(note({ maps: { kind: "failed", reason: "host down" } })).toMatchObject({ complete: false });
    expect(note({ maps: { kind: "failed", reason: "host down" } }).text).toContain(
      "  could not list the open maps: host down",
    );
    const broken: MapRead = { number: 9, title: "nine", body: { kind: "failed", reason: "gone" } };
    const read = note({ maps: ok([broken]) });
    expect(read.complete).toBe(false);
    expect(read.text).toContain("### #9 nine\n  could not read #9: gone");
  });
});
