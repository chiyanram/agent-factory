import { describe, expect, it } from "vitest";
import { earlierOf, headerOf, inPlace, namedBack, type Adr } from "../scripts/check-adrs.js";

const OLD: Adr = {
  number: "0002",
  file: "docs/adr/0002-old.md",
  text: "# 0002 · Old\n\nStatus: accepted.\n\n## Decision\n\nThe MR is the record.\n",
};
const NEW: Adr = {
  number: "0019",
  file: "docs/adr/0019-new.md",
  text: "# 0019 · New\n\nStatus: accepted. Refines [ADR-0002](0002-old.md).\n\n## Decision\n\nBefore the PR, the machine.\n",
};

describe("check-adrs (#482)", () => {
  it("reads which earlier ADRs a status changes, from its header only", () => {
    expect(earlierOf(NEW)).toEqual(["0002"]);
    const amends: Adr = { ...NEW, text: "# x\n\nStatus: accepted. Amends ADR-0001, 0005,\n0010 and 0011.\n\n## D\n" };
    expect(earlierOf(amends)).toEqual(["0001", "0005", "0010", "0011"]);
    expect(earlierOf({ ...NEW, text: "# x\n\nStatus: accepted 2026-11-10.\n\n## D\n\nAmends ADR-0003.\n" })).toEqual(
      [],
    );
  });

  it("an earlier ADR must name the later one in its header", () => {
    expect(namedBack([OLD, NEW])).toEqual(["docs/adr/0002-old.md: ADR-0019 changes it; its header must name ADR-0019"]);
    const told = { ...OLD, text: OLD.text.replace("Status: accepted.", "Status: accepted.\n\nRefined by ADR-0019.") };
    expect(headerOf(told.text)).toContain("ADR-0019");
    expect(namedBack([told, NEW])).toEqual([]);
  });

  it("refuses a decision changed in place; the header and a Today: note may change", () => {
    const today = `${OLD.text}\n**Today:** not built (#1).\n`;
    expect(
      inPlace(OLD.file, OLD.text, OLD.text.replace("Status: accepted.", "Status: accepted. Refined by ADR-0019.")),
    ).toBe("");
    expect(inPlace(OLD.file, today, today.replace("(#1)", "(#2)"))).toBe("");
    expect(inPlace(OLD.file, OLD.text, OLD.text.replace("the record", "one record"))).toContain(
      "its decision changed in place",
    );
  });

  describe("a Today: note runs from its marker to the end of its paragraph (#605)", () => {
    const adr = (body: string) => `# 0021 · X\n\nStatus: accepted.\n\n## Decision\n\n${body}\n`;
    const changed = (before: string, after: string) => inPlace("docs/adr/0021-x.md", adr(before), adr(after));
    const NOTE = "The bar is bar.ts. **Today:** the check still applies\nthe old bar, until the next slice (#488).";

    it("lets a wrapped note change or go, its second line included", () => {
      expect(changed(NOTE, NOTE.replace("the old bar, until", "the old bar, from"))).toBe("");
      expect(changed(NOTE, "The bar is bar.ts.")).toBe("");
      // a note that is a whole paragraph goes with its blank line
      const alone = `The decision.\n\n**Today:** not built\nyet (#1).\n\nMore decision.`;
      expect(changed(alone, "The decision.\n\nMore decision.")).toBe("");
    });

    it("keeps the text before the marker on the note's first line frozen", () => {
      expect(changed(NOTE, NOTE.replace("bar.ts.", "lib.ts."))).toContain("its decision changed in place");
    });

    it.each(["", "## Next", "| a | b |", "- an item", "* an item", "1. an item", "```"])(
      "ends a note at %j: the decision after it stays frozen",
      (end) => {
        const body = `${NOTE}\n${end}\nThe decision.`;
        expect(changed(body, body.replace("The decision.", "Another decision."))).toContain(
          "its decision changed in place",
        );
      },
    );

    it.each(["## Next", "| a | b |", "- an item", "1. an item", "```"])(
      "keeps the line %j that ends a note frozen",
      (end) => {
        const body = `${NOTE}\n${end}\nThe decision.`;
        expect(changed(body, body.replace(end, `${end} x`))).toContain("its decision changed in place");
      },
    );

    it("in a table row covers only its cell: the cells before and after it stay frozen", () => {
      const row = "| N8 | **Held out.** **Today:** not built (#599). | #488 Q6 |";
      expect(changed(row, row.replace("not built (#599)", "built (#599)"))).toBe("");
      expect(changed(row, "| N8 | **Held out.** | #488 Q6 |")).toBe("");
      expect(changed(row, row.replace("| N8 |", "| N9 |"))).toContain("its decision changed in place");
      expect(changed(row, row.replace("#488 Q6", "#488 Q7"))).toContain("its decision changed in place");
      // the row ends the note: the next row stays frozen
      const rows = `${row}\n| N9 | the next decision | x |`;
      expect(changed(rows, rows.replace("the next decision", "another"))).toContain("its decision changed in place");
    });

    it("does not end a cell at an escaped pipe inside the note", () => {
      const row = "| N8 | **Today:** a \\| b (#599). | #488 Q6 |";
      expect(changed(row, row.replace("a \\| b", "a \\| c"))).toBe("");
      expect(changed(row, row.replace("#488 Q6", "#488 Q7"))).toContain("its decision changed in place");
    });
  });
});
