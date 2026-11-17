import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { openAgentCli } from "../src/core/agent/index.js";
import { writerArgv, writerDenies, writerSettings, type WriterCall } from "../src/core/agent/claude-writer.js";
import { readCard, type Role } from "../src/core/process/cards.js";
import { TEST_FILES } from "../src/core/ready/floor.js";

const HOME = "/home/op";
const CREDENTIALS = [
  ".ssh/**",
  ".gnupg/**",
  ".config/gh/**",
  ".config/glab-cli/**",
  ".git-credentials",
  ".config/git/credentials",
  ".netrc",
  ".aws/**",
  ".config/gcloud/**",
  ".azure/**",
  ".kube/**",
  ".docker/**",
  ".claude/**",
  ".claude.json",
  ".copilot/**",
];
// the deny list every writer role got before its card's guardrails were read: the floor's must stay this, byte for byte
const TODAY_DENIES = [
  "WebFetch",
  "Bash(git push)",
  "Bash(git push *)",
  "Bash(curl)",
  "Bash(curl *)",
  ...CREDENTIALS.map((p) => `Read(//home/op/${p})`),
];
const WRITER_ROLES: readonly Role[] = ["implementer", "test-first", "cleanup"];

async function card(role: Role) {
  const read = await readCard([], role);
  if (read.kind !== "ok") throw new Error(read.reason);
  return read.value;
}

function call(tools: readonly string[]): WriterCall {
  return {
    claude: { maxUsd: "", model: "" },
    settings: { kind: "file", path: ".factory/settings.json" },
    plugins: 1,
    tools,
  };
}

describe("the writer behind the agent CLI seam (#688)", () => {
  it("gives every built-in writer card the argv it had before, test-first included, in vm and in srt", async () => {
    for (const role of WRITER_ROLES) {
      const tools = (await card(role)).tools;
      for (const place of ["vm", "srt"] as const) {
        expect(writerArgv("claude", call(tools), place)).toEqual([
          "claude",
          "-p",
          "--setting-sources",
          "user",
          "--dangerously-skip-permissions",
          "--plugin-dir",
          ".factory/plugins/1",
          "--tools",
          "Read,Grep,Glob,Edit,Write,Bash,TodoWrite,Skill,Task",
          "--output-format",
          "stream-json",
          "--verbose",
          "--settings",
          ".factory/settings.json",
        ]);
      }
    }
  });

  it("runs the image's pinned claude in vm, and FACTORY_CLAUDE in srt", () => {
    const set = openAgentCli({ env: { FACTORY_CLAUDE: "/opt/claude/bin/claude" } }).writer;
    expect(set.bin("vm")).toBe("claude");
    expect(set.bin("srt")).toBe("/opt/claude/bin/claude");
    expect(set.argv(call(["Read"]), "srt")[0]).toBe("/opt/claude/bin/claude");
    expect(set.argv(call(["Read"]), "vm")[0]).toBe("claude");
    expect(openAgentCli({ env: {} }).writer.bin("srt")).toBe("claude");
  });

  it("builds the deny list from the card's guardrails, one ID at a time", () => {
    expect(writerDenies(["no-push"], HOME)).toEqual(["Bash(git push)", "Bash(git push *)"]);
    expect(writerDenies(["no-web"], HOME)).toEqual(["WebFetch", "Bash(curl)", "Bash(curl *)"]);
    expect(writerDenies(["no-credentials"], HOME)).toEqual(CREDENTIALS.map((p) => `Read(//home/op/${p})`));
    expect(writerDenies(["judge-files-locked", "edit-scope", "read-only"], HOME)).toEqual([]);
    // with no home known, the runner alone hides the credential paths
    expect(writerDenies(["no-credentials"], "")).toEqual([]);
  });

  it("keeps the implementer's and cleanup's settings as they were, and the floor's deny list byte for byte", async () => {
    for (const role of ["implementer", "cleanup"] as const) {
      const text = writerSettings({ guardrails: (await card(role)).guardrails, home: HOME, lint: "", scopes: [] });
      expect(text).toEqual({
        kind: "text",
        text: `${JSON.stringify({ permissions: { allow: ["Bash", "Edit(./**)"], deny: TODAY_DENIES } }, null, 2)}\n`,
      });
    }
  });

  it("adds test-first's scope hook with the project's test files, and none for the implementer", async () => {
    const tf = await card("test-first");
    for (const tests of [TEST_FILES, ["spec/**"]]) {
      const text = writerSettings({ guardrails: tf.guardrails, home: HOME, lint: "make lint", scopes: [tests] });
      const parsed: unknown = JSON.parse(text.kind === "text" ? text.text : "{}");
      expect(parsed).toEqual({
        permissions: { allow: ["Bash", "Edit(./**)"], deny: TODAY_DENIES },
        hooks: {
          PreToolUse: [
            {
              matcher: "Edit|MultiEdit|Write|NotebookEdit",
              hooks: [{ type: "command", command: `agent-factory writer-scope '${JSON.stringify([tests])}'` }],
            },
          ],
          PostToolUse: [
            {
              matcher: "Edit|MultiEdit|Write",
              hooks: [{ type: "command", command: "agent-factory lint-edit 'make lint'" }],
            },
          ],
        },
      });
    }
    const impl = await card("implementer");
    const text = writerSettings({ guardrails: impl.guardrails, home: HOME, lint: "", scopes: [] });
    expect(text.kind === "text" ? text.text : "").not.toContain("writer-scope");
  });

  it("reads FACTORY_CLAUDE only in src/core/agent/", () => {
    const root = join(import.meta.dirname, "..", "src");
    const files = (dir: string): readonly string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? files(path) : path.endsWith(".ts") ? [path] : [];
      });
    const readers = files(root)
      .filter((f) => readFileSync(f, "utf8").includes("FACTORY_CLAUDE"))
      .map((f) => relative(root, f));
    expect(readers.filter((f) => !f.startsWith(join("core", "agent")))).toEqual([]);
  });
});

describe("the writer kind reads a provider's usage limit (#707)", () => {
  it("reads Claude's refusal from what the run printed", () => {
    const writer = openAgentCli({ env: {} }).writer;
    const result = { type: "result", is_error: true, result: "You've hit your limit · resets 3pm (UTC)" };
    expect(writer.usageLimit({ result, stderr: "", windows: {}, endedAt: Date.parse("2026-11-17T10:00:00Z") })).toEqual(
      { kind: "limited", until: "2026-11-17T15:00:00Z", said: "You've hit your limit · resets 3pm (UTC)" },
    );
    expect(
      writer.usageLimit({ result: { type: "result", is_error: false }, stderr: "", windows: {}, endedAt: 0 }),
    ).toEqual({
      kind: "none",
    });
  });
});
