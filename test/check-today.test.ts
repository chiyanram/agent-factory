import { describe, expect, it } from "vitest";
import { notesIn, problems } from "../scripts/check-today.js";

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
});
