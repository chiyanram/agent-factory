import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { keepStreams } from "../src/core/eval/streams.js";
import type { Model, ModelResult, ModelRun } from "../src/core/review/model.js";
import { fakeToken } from "./planted.js";
import { tempDir } from "./temp.js";

let root = "";
beforeEach(() => {
  root = tempDir("factory-streams-");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const call = (part: NonNullable<ModelRun["part"]>): ModelRun => ({
  folder: root,
  model: "m",
  schema: "{}",
  prompt: "p",
  name: "reviewer-1",
  maxUsd: "2",
  limit: { minutes: 1, setting: "X" },
  part,
});

function answering(results: readonly ModelResult[]): Model {
  let i = 0;
  return async () => results[i++] ?? { kind: "failed", reason: "none left", answer: undefined };
}

const ok = (stream: string): ModelResult => ({
  kind: "ok",
  value: { output: { findings: [] }, answer: { usage: {} }, costUsd: 0.1, tokens: 1, stream },
});

describe("keepStreams: each eval review run's stream, kept for a read count (#920)", () => {
  it("writes each run's stream, scrubbed, named by run, order and part, and passes the answer on unchanged", async () => {
    const token = fakeToken("github-classic");
    const read = '{"type":"tool_use","name":"Read","input":{"file_path":"skills/crq/SKILL.md"}}\n';
    const first = ok(`${read}{"key":"${token}"}\n`);
    const second = ok('{"type":"result"}\n');
    const model = keepStreams(answering([first, second]), join(root, "case-a"), 2);
    expect(await model(call({ kind: "finder", lens: "baseline" }))).toBe(first);
    expect(await model(call({ kind: "verify pass" }))).toBe(second);
    const dir = join(root, "case-a");
    expect(readdirSync(dir).toSorted()).toEqual(["run2-01-finder-baseline.jsonl", "run2-02-verify.jsonl"]);
    const kept = readFileSync(join(dir, "run2-01-finder-baseline.jsonl"), "utf8");
    expect(kept).toContain("skills/crq/SKILL.md");
    expect(kept).not.toContain(token);
  });

  it("keeps nothing for a failed run, and still answers it", async () => {
    const failed: ModelResult = { kind: "failed", reason: "budget", answer: undefined };
    const model = keepStreams(answering([failed]), join(root, "case-b"), 1);
    expect(await model(call({ kind: "verify pass" }))).toBe(failed);
    expect(existsSync(join(root, "case-b"))).toBe(false);
  });
});
