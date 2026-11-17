import { describe, expect, it } from "vitest";
import { dataFence, fence } from "../src/core/review/fence.js";
import { blocks, fencedOnly, INJECTED, LABEL, ORDER } from "./fenced.js";

describe("dataFence: outside text a run reads, fenced under a fixed label (#705)", () => {
  it("keeps a text that closes a fence and gives an order inside its fence, under the label", () => {
    const doc = `${dataFence({ title: "finding F1", text: INJECTED })}\nThe host's own line.\n`;
    expect(doc).toContain(`### finding F1\n\n${LABEL}\n\n\`\`\`\``);
    expect(fencedOnly(doc, ORDER)).toBe(true);
    expect(blocks(doc)[0]?.body).toBe(INJECTED);
  });

  it("grows the fence past any backtick run, so the text is never rewritten", () => {
    const text = "a ````` run, and ``` alone";
    const doc = dataFence({ title: "log", text, info: "text" });
    expect(doc).toContain("``````text\n");
    expect(blocks(doc)[0]?.body).toBe(text);
  });

  it("removes terminal codes, control and invisible characters, and keeps line breaks and tabs", () => {
    const text = `red${String.fromCharCode(27)}[31m\tline‮evil​\nnext\u0007`;
    expect(blocks(dataFence({ title: "log", text }))[0]?.body).toBe("red\tlineevil\nnext");
  });

  it("leaves fence() as it was: no label, for the review pack's rubric and rulebook", () => {
    expect(fence({ title: "lens", text: "rule" })).not.toContain(LABEL);
  });
});
