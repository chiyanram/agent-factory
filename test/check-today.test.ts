import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { closedProblems, notesIn, openTickets, problems, staleNotes } from "../scripts/check-today.js";

const FIXTURES = join(import.meta.dirname, "..", "tests", "fixtures", "today");

describe("check-today (#482)", () => {
  it("a safety Today: note names a ticket, in a table cell or a paragraph", () => {
    const text = [
      "| guard | Enforced; **Today:** not a wall on a laptop (#493) | `x.ts` |",
      "| other | **Today:** not built | `y.ts` |",
      "",
      "- **Where state lives.** **Today:** before the PR opens, the records are only on",
      "  the machine that ran START (chiyanram/skills#12).",
      "",
      "A paragraph. **Today:** one gap. **Today:** another gap (#7).",
    ].join("\n");
    const notes = notesIn("safety.md", text);
    expect(notes.map((n) => n.line)).toEqual([1, 2, 4, 7, 7]);
    expect(problems(notes)).toEqual([
      'safety.md:2 a safety Today: note names no ticket: "not built"',
      'safety.md:7 a safety Today: note names no ticket: "one gap."',
    ]);
  });

  it("a note ends at a list item, a table row or a code fence, as check-adrs reads it", () => {
    const text = [
      "- **Today:** a listed gap.",
      "- another item (#1).",
      "A paragraph. **Today:** a gap",
      "| a | #2 |",
      "**Today:** a gap",
      "```",
      "#3",
      "```",
      "**Today:** a gap that runs",
      "on (#4).",
    ].join("\n");
    expect(notesIn("p.md", text).map((n) => n.text)).toEqual([
      "a listed gap.",
      "a gap",
      "a gap",
      "a gap that runs on (#4).",
    ]);
  });

  it("a note in a code comment ends where the comment does", () => {
    const text = ["// x : a module. **Today:** a gap", "// that runs on (#4).", "export const ref = 1; // #1"].join(
      "\n",
    );
    expect(notesIn("x.ts", text).map((n) => n.text)).toEqual(["a gap that runs on (#4)."]);
  });
});

describe("check-today: a Today: note whose tickets are all closed (#750)", () => {
  it("passes a note that names an open ticket, and fails one that names only closed ones, with file:line", () => {
    const notes = notesIn("docs/page.md", "**Today:** open (#1).\n\n**Today:** closed (#9, #10).\n\n**Today:** none.");
    expect(closedProblems(notes, new Set([1]))).toEqual([
      'docs/page.md:3 a Today: note names only closed tickets (#9, #10): "closed (#9, #10)."',
    ]);
  });

  it("does not judge another repo's ticket, but judges this repo's when its name is written out", () => {
    const notes = notesIn(
      "docs/page.md",
      "**Today:** elsewhere (chiyanram/skills#9).\n\n**Today:** here (chiyanram/agent-factory#9).",
    );
    expect(closedProblems(notes, new Set())).toEqual([
      'docs/page.md:3 a Today: note names only closed tickets (#9): "here (chiyanram/agent-factory#9)."',
    ]);
  });

  it("reads a note in a table cell to its end, past an escaped pipe", () => {
    const notes = notesIn("docs/page.md", "| x | **Today:** a \\| b gap (#9) | y (#1) |");
    expect(notes.map((n) => n.text)).toEqual(["a \\| b gap (#9)"]);
  });

  it("reads the open tickets the CI step writes", () => {
    expect([...openTickets('[{"number":1},{"number":2}]')]).toEqual([1, 2]);
    expect(() => openTickets('{"number":1}')).toThrow(/a JSON list/);
    expect(() => openTickets('[{"id":1}]')).toThrow(/a JSON list/);
    expect(() => openTickets("[]")).toThrow(/no open ticket/);
  });

  it("finds the planted stale notes in docs/, prompts/ and src/, and skips AGENTS.md", () => {
    expect(staleNotes(FIXTURES, join(FIXTURES, "open-tickets.json"))).toEqual({
      skipped: false,
      problems: [
        'docs/page.md:5 a Today: note names only closed tickets (#9): "not built yet (#9)."',
        'docs/page.md:7 a Today: note names only closed tickets (#9): "a listed gap (#9)."',
        'docs/page.md:12 a Today: note names only closed tickets (#9): "a gap in a cell (#9)"',
        'prompts/p.md:1 a Today: note names only closed tickets (#9): "a prompt\'s gap (#9)."',
        'src/x.ts:1 a Today: note names only closed tickets (#9): "a gap in a code comment (#9)."',
      ],
    });
  });

  it("is skipped, not failed, when no open-tickets file is given (local make lint has no network)", () => {
    expect(staleNotes(FIXTURES, undefined)).toEqual({ skipped: true, problems: [] });
  });
});
