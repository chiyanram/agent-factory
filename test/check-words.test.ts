// check-words (#144 phase 3): an old word in the prose of the main docs fails; the same word as an identifier, a path,
// a link or in a fenced block does not.
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { docs, findings, prose } from "../scripts/check-words.js";
import { tempDir } from "./temp.js";

const SCRIPT = join(import.meta.dirname, "..", "scripts", "check-words.ts");

describe("findings", () => {
  it("names each old word in prose with its line and the word to use", () => {
    expect(findings("GUIDE.md", "ok\nThe dispatcher starts a writer in a box on the MR.\n")).toEqual([
      'GUIDE.md:2: "box": use runner (GLOSSARY.md, old words)',
      'GUIDE.md:2: "dispatcher": use orchestrator (GLOSSARY.md, old words)',
      'GUIDE.md:2: "writer": use implementer (GLOSSARY.md, old words)',
      'GUIDE.md:2: "MR": use PR (GLOSSARY.md, old words)',
    ]);
    expect(findings("a.md", "Every worker has a seat; the reviewer and the forge.")).toHaveLength(4);
  });

  it("leaves identifiers, paths, links, URLs and fenced blocks alone", () => {
    const text = [
      "Set `FACTORY_BOX` and run `agent-factory box build`; see [evals/reviewer/README.md](evals/reviewer/README.md).",
      "Read [ADR-0010](docs/adr/0010-one-forge-seam-two-adapters.md) and https://example.com/forge.",
      "The design-reviewer runs first. An MRI is another word.",
      "```text",
      "src/core/forge/   the git host seam",
      "```",
    ].join("\n");
    expect(findings("a.md", text)).toEqual([]);
  });

  it("strips code spans and link targets from a line", () => {
    expect(prose("a `box` and [x](y/forge.md)")).not.toContain("box");
    expect(prose("[x](y/forge.md)")).not.toContain("forge");
  });
});

describe("check-words", () => {
  it("checks the main docs and every role card", () => {
    const root = tempDir("check-words-");
    mkdirSync(join(root, "prompts", "roles"), { recursive: true });
    writeFileSync(join(root, "prompts", "roles", "implementer.md"), "x\n");
    expect(docs(root)).toContain("prompts/roles/implementer.md");
    expect(docs(root)).toContain("docs/DESIGN.md");
  });

  it("checks every how-to, reference and explanation page, and the coordinator's instructions (#378)", () => {
    const root = tempDir("check-words-");
    mkdirSync(join(root, "docs", "how-to"), { recursive: true });
    writeFileSync(join(root, "docs", "how-to", "install.md"), "x\n");
    expect(docs(root)).toContain("docs/how-to/install.md");
    expect(docs(root)).toContain("prompts/coordinator.md");
  });

  it("exits 1 with each finding, and 0 on clean docs", () => {
    const root = tempDir("check-words-");
    writeFileSync(join(root, "README.md"), "The orchestrator starts a run.\n");
    expect(spawnSync("node", [SCRIPT, root]).status).toBe(0);
    writeFileSync(join(root, "GUIDE.md"), "The writer runs.\n");
    const bad = spawnSync("node", [SCRIPT, root], { encoding: "utf8" });
    expect(bad.status).toBe(1);
    expect(bad.stdout).toContain('GUIDE.md:1: "writer": use implementer');
  });
});
