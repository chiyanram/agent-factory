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
});
