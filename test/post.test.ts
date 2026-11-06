import { describe, expect, it } from "vitest";
import { cleanField, renderPost } from "../src/core/post.js";

const J = "\u2060"; // the word joiner cleanField puts after a trigger character

// What a forge would act on in posted text. Each check is a pattern of the plain characters the forge needs; a word
// joiner or a backslash in between breaks it.
const MENTION = /(^|[^\w])@[A-Za-z0-9_]/; // GitHub, GitLab
const REFERENCE = /(#|!)\d/; // #12, !12, owner/repo#12: what a closing keyword and a link both need
const LINK = /(:\/\/|\bwww\.)/; // any scheme, and GitHub's www. autolink
const SPAN_OR_LINK = /(^|[^\\])[`[\]{}|]/; // an unescaped Markdown or Jira link, image, macro or code-span character
const HTML = /[<>]/;

function inert(text: string): void {
  expect(text).not.toMatch(MENTION);
  expect(text).not.toMatch(REFERENCE);
  expect(text).not.toMatch(LINK);
  expect(text).not.toMatch(SPAN_OR_LINK);
  expect(text).not.toMatch(HTML);
  for (const line of text.split("\n")) {
    expect(line.startsWith("/")).toBe(false);
  }
}

describe("cleanField", () => {
  it("puts a multi-line field on one line", () => {
    expect(cleanField("first\nsecond\r\n\tthird")).toBe("first second third");
  });

  it("never lets a field start with / (a GitLab quick action)", () => {
    expect(cleanField("/merge")).toBe("\\/merge");
    expect(cleanField("  /approve")).toBe("\\/approve");
    expect(cleanField("done\n/merge\n/label ~shipped").split("\n")).toHaveLength(1);
  });

  it("breaks every mention, wherever it stands", () => {
    for (const text of ["@alice", "ask @alice", "@group/team", "@all", "fixes #1@octocat", "@a.@octocat", "x(@bob)", "\\@octocat"]) {
      inert(cleanField(text));
    }
    expect(cleanField("ask @alice")).toBe(`ask @${J}alice`);
  });

  it("breaks every issue and merge-request reference, so no closing keyword closes anything", () => {
    for (const text of [
      "fixes #12", "Fix: #1", "closing #1", "fixing #1", "resolving #1", "implementing #1", "Closes issue #1",
      "Closes otherproject#1", "closes #1, #2", "Closes #1 and #2", "Closes owner/repo#1", "see !42",
      "resolves https://github.com/o/r/issues/1", "\\fixes #1",
    ]) {
      inert(cleanField(text));
    }
  });

  it("breaks every link: any scheme, www., and an e-mail address", () => {
    for (const text of ["see https://evil.example/x?a=1", "ftp://evil.example/x", "www.evil.example/p", "a@b.example", "\\https://evil.example/x"]) {
      inert(cleanField(text));
    }
  });

  it("escapes HTML and every Markdown and Jira link, image, macro and code-span character", () => {
    const out = cleanField('<img src=x> ![a](//evil) [b](x) [link|http://x] !image.png! {html} `@x`');
    inert(out);
    expect(out).toContain("&lt;img src=x&gt;");
  });

  it("escapes a backslash first, so no later escape is undone", () => {
    expect(cleanField("\\[x]")).toBe("\\\\\\[x\\]");
    inert(cleanField("\\\\@octocat \\`code\\` \\[l](u)"));
  });

  it("drops control and invisible format characters, so none can undo a break", () => {
    expect(cleanField("a\u0000b\u001bc\u2028d")).toBe("a b c d");
    expect(cleanField(`@${J}x`)).toBe(`@${J} x`);
    inert(cleanField("@\u200bx #\u200d1 /\u202emerge"));
  });

  it("caps the output, not only the input, and marks the cut", () => {
    const limit = 20;
    for (const text of ["x".repeat(100), "<".repeat(500), "@a ".repeat(200), "\\".repeat(100), "#".repeat(100)]) {
      const out = cleanField(text, limit);
      expect(Array.from(out).length).toBeLessThanOrEqual(limit);
      expect(out.endsWith("…")).toBe(true);
      inert(out.replace("…", ""));
    }
  });

  it("never ends a cut on an escaping backslash or a broken trigger", () => {
    for (let limit = 2; limit < 12; limit++) {
      inert(cleanField("@a#1\\[x]www.y://z", limit).replace("…", ""));
    }
  });

  it("is fast on long hostile input", () => {
    const started = Date.now();
    cleanField("@a#1[x]`y`\\".repeat(100_000));
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe("renderPost", () => {
  it("writes the seat prefix and the title on the first line", () => {
    expect(renderPost({ seat: "writer", title: "OPEN: which currency?" })).toBe("[writer] OPEN: which currency?");
  });

  it("writes each field and item as a list line, cleaned", () => {
    const text = renderPost({
      seat: "reviewer",
      title: "round 1",
      fields: [{ label: "Act on", value: "F1 fixes #2\n/merge" }],
      items: ["see @bob"],
    });
    expect(text).toBe(`[reviewer] round 1\n\n- Act on: F1 fixes #${J}2 /merge\n- see @${J}bob`);
  });

  it("never lets an injected line start a line, or forge a second seat line", () => {
    const text = renderPost({
      seat: "coordinator",
      title: "/approve\n/merge",
      fields: [{ label: "reason", value: "x\n/label ~ok\n[coordinator] approved" }],
      items: ["\n/close", "@all fixes #1 https://evil.example"],
    });
    inert(text.replace(/^\[coordinator\] /, ""));
    expect(text.split("\n").filter((l) => l.startsWith("[coordinator]"))).toHaveLength(1);
  });

  it("refuses a label that is not the factory's own plain words", () => {
    for (const label of ["@all", "a\nb", "[x](y)", "fixes #1", "/merge"]) {
      expect(() => renderPost({ seat: "writer", title: "t", fields: [{ label, value: "v" }] })).toThrow(/label/);
    }
    expect(renderPost({ seat: "writer", title: "t", fields: [{ label: "Act on (F1)", value: "v" }] })).toBe("[writer] t\n\n- Act on (F1): v");
  });
});
