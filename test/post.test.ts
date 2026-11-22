import { describe, expect, it } from "vitest";
import { cleanField, renderPost, type Post } from "../src/core/post.js";
import { fakeToken } from "./planted.js";

function text(post: Post): string {
  const result = renderPost(post);
  switch (result.kind) {
    case "ok":
      return result.text;
    case "refused":
      throw new Error(`unexpected refusal: ${result.reason}`);
    default: {
      const unreachable: never = result;
      return unreachable;
    }
  }
}

const J = "\u2060";

const MENTION = /(^|[^\w])@[A-Za-z0-9_]/;
const REFERENCE = /(#|!|\bGH-)\d/i;
// GitHub's www. autolink also starts after "*", "_", "~" or "("
// https://github.github.com/gfm/#autolinks-extension-
const LINK = /(:\/\/|www\.)/i;
const SPAN_OR_LINK = /(^|[^\\])[`[\]{}|]/;
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
  it("drops every invisible format character: bidi isolates, tags, the soft hyphen, variation selectors", () => {
    const hidden = "pay \u2066evil\u2069 \u{e0041}\u{e0042} so\u00adft x\ufe0f \u200d\u061c\u180e\u{e0100}end";
    expect(cleanField(hidden)).toBe("pay evil so ft x end");
  });

  it("puts a multi-line field on one line", () => {
    expect(cleanField("first\nsecond\r\n\tthird")).toBe("first second third");
  });

  it("never lets a field start with / (a GitLab quick action)", () => {
    expect(cleanField("/merge")).toBe("\\/merge");
    expect(cleanField("  /approve")).toBe("\\/approve");
    expect(cleanField("done\n/merge\n/label ~shipped").split("\n")).toHaveLength(1);
  });

  it("breaks every mention, wherever it stands", () => {
    for (const text of [
      "@alice",
      "ask @alice",
      "@group/team",
      "@all",
      "fixes #1@octocat",
      "@a.@octocat",
      "x(@bob)",
      "\\@octocat",
    ]) {
      inert(cleanField(text));
    }
    expect(cleanField("ask @alice")).toBe(`ask @${J}alice`);
  });

  it("breaks every issue and merge-request reference, so no closing keyword closes anything", () => {
    for (const text of [
      "fixes #12",
      "Fix: #1",
      "closing #1",
      "fixing #1",
      "resolving #1",
      "implementing #1",
      "Closes issue #1",
      "Closes otherproject#1",
      "closes #1, #2",
      "Closes #1 and #2",
      "Closes owner/repo#1",
      "see !42",
      "resolves https://github.com/o/r/issues/1",
      "\\fixes #1",
      "Fixes GH-12",
      "see gh-7",
    ]) {
      inert(cleanField(text));
    }
  });

  it("breaks every link: any scheme, www., and an e-mail address", () => {
    for (const text of [
      "see https://evil.example/x?a=1",
      "ftp://evil.example/x",
      "www.evil.example/p",
      "_www.evil.example/p",
      "*WWW.evil.example/p",
      "a@b.example",
      "\\https://evil.example/x",
    ]) {
      inert(cleanField(text));
    }
  });

  it("escapes HTML and every Markdown and Jira link, image, macro and code-span character", () => {
    const out = cleanField("<img src=x> ![a](//evil) [b](x) [link|http://x] !image.png! {html} `@x`");
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
    expect(text({ seat: "writer", title: "OPEN: which currency?", fields: [], items: [] })).toBe(
      "[writer] OPEN: which currency?",
    );
  });

  it("writes each field and item as a list line, cleaned", () => {
    const out = text({
      seat: "reviewer",
      title: "round 1",
      fields: [{ label: "Act on", value: "F1 fixes #2\n/merge" }],
      items: ["see @bob"],
    });
    expect(out).toBe(`[reviewer] round 1\n\n- Act on: F1 fixes #${J}2 /merge\n- see @${J}bob`);
  });

  it("never lets an injected line start a line, or forge a second seat line", () => {
    const out = text({
      seat: "coordinator",
      title: "/approve\n/merge",
      fields: [{ label: "reason", value: "x\n/label ~ok\n[coordinator] approved" }],
      items: ["\n/close", "@all fixes #1 https://evil.example"],
    });
    inert(out.replace(/^\[coordinator\] /, ""));
    expect(out.split("\n").filter((l) => l.startsWith("[coordinator]"))).toHaveLength(1);
  });

  it("refuses a label that is not the factory's own plain words, as a result, never by throwing", () => {
    for (const label of ["@all", "a\nb", "[x](y)", "fixes #1", "/merge"]) {
      const result = renderPost({ seat: "writer", title: "t", fields: [{ label, value: "v" }], items: [] });
      expect(result).toMatchObject({ kind: "refused" });
      expect(result.kind === "refused" ? result.reason : "").toMatch(/label/);
    }
    expect(text({ seat: "writer", title: "t", fields: [{ label: "Act on (F1)", value: "v" }], items: [] })).toBe(
      "[writer] t\n\n- Act on (F1): v",
    );
  });
});

describe("renderPost: no secret in posted text (#678; ADR-0012 S13, P4)", () => {
  const TOKEN = fakeToken("github-classic");
  const KEY = fakeToken("anthropic-key");
  const PEM = ["-----BEGIN RSA PRIVATE KEY-----", "MIIEowIBAAKCAQEA", "q2Vb7Y+ZkL", "-----END RSA PRIVATE KEY-----"];

  it("scrubs a token in the title, in a field and in an item, before it makes them inert", () => {
    const out = text({
      seat: "writer",
      title: `BLOCKED: ${TOKEN} was refused`,
      fields: [{ label: "blocker", value: `push to https://bot:${TOKEN}@github.com/o/r failed` }],
      items: [`FACTORY_API_KEY=${KEY} in .env`, `ask with ${KEY}`],
    });
    for (const secret of [TOKEN, KEY, "bot:"]) {
      expect(out).not.toContain(secret);
    }
    expect(out).toBe(
      [
        "[writer] BLOCKED: \\[scrubbed\\] was refused",
        "",
        `- blocker: push to https:${J}//\\[scrubbed\\]@${J}github.com/o/r failed`,
        "- FACTORY_API_KEY=\\[scrubbed\\] in .env",
        "- ask with \\[scrubbed\\]",
      ].join("\n"),
    );
  });

  it("scrubs a whole PEM key, though a field puts its lines on one", () => {
    expect(cleanField(`key:\n${PEM.join("\n")}\nafter`)).toBe("key: \\[scrubbed\\] after");
  });

  it("scrubs a token that a hidden character splits, which would show as two words a reader joins", () => {
    const split = `${TOKEN.slice(0, 6)}${String.fromCharCode(0x200b)}${TOKEN.slice(6)}`;
    expect(cleanField(`use ${split} now`)).toBe("use \\[scrubbed\\] now");
  });

  it("leaves the engine's own words as they were when they hold no secret", () => {
    const words = "spec 3f2a9c approved locally by ram at 2026-11-16T05:00:00Z";
    expect(cleanField(words)).toBe(words);
  });
});
