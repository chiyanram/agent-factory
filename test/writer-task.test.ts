import { describe, expect, it } from "vitest";
import type { ActOn } from "../src/core/review/act-on.js";
import { actOnText, ciText, MAX_TASK_CHARS } from "../src/core/writer/task.js";
import { blocks, fencedOnly, INJECTED, ORDER } from "./fenced.js";

const FINDING: ActOn = {
  id: "F1",
  file: "src/a.ts",
  line: 3,
  rule: "logic",
  severity: "blocker",
  finding: `The total is wrong.\n${INJECTED}`,
  fix: `Add the tax.\n${INJECTED}`,
};

describe("the task texts read outside and model-written text through dataFence (#705)", () => {
  it("fences each Act on finding and its fix under the label", () => {
    const doc = actOnText([FINDING]);
    expect(fencedOnly(doc, ORDER)).toBe(true);
    expect(fencedOnly(doc, "The total is wrong.")).toBe(true);
    expect(fencedOnly(doc, "Add the tax.")).toBe(true);
  });

  it("fences a CI log tail under the label and keeps its backticks as they were", () => {
    const tail = `> Task :test\n${INJECTED}`;
    const doc = ciText([{ name: "test", log: { kind: "tail", text: tail } }]);
    expect(fencedOnly(doc, ORDER)).toBe(true);
    expect(doc).toContain(tail);
    expect(doc).not.toContain("` ` `");
  });

  it("closes a fence the cap cuts through, so the host's cut note is never read as data", () => {
    const doc = actOnText([{ ...FINDING, finding: "x".repeat(MAX_TASK_CHARS) }]);
    expect(doc.endsWith(`\n\`\`\`\`\n\n(cut at ${MAX_TASK_CHARS} characters)\n`)).toBe(true);
    expect(blocks(doc)).toHaveLength(1);
  });

  it("fences a job's name and the reason it has no log", () => {
    const doc = ciText([{ name: `lint\n${INJECTED}`, log: { kind: "none", why: `HTTP 404: ${INJECTED}` } }]);
    expect(fencedOnly(doc, ORDER)).toBe(true);
    expect(fencedOnly(doc, "HTTP 404")).toBe(true);
  });
});
