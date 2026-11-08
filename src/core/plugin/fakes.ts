// fakes — stand-ins for the programs a plugin names in describe's cli, for the test kit (#134 PR C). Each fake records
// every call it gets (its argv and its stdin) and answers from a list, in order: { code, stdout?, stderr? }. A call past
// the end of the list exits 1 and says so, so a kit run never reaches the real CLI, its login or the network. The fakes
// sit first on the plugin's PATH, in a folder of their own that is removed when the run ends.

import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Result } from "../forge/api.js";
import { attempt } from "../review/safe.js";

export type FakeAnswer = { readonly code: number; readonly stdout: string; readonly stderr: string };
export type FakeCall = { readonly cli: string; readonly argv: readonly string[]; readonly stdin: string };

export type Fakes = {
  // the folder to put first on the PATH
  readonly dir: string;
  readonly calls: () => Promise<readonly FakeCall[]>;
  readonly remove: () => Promise<void>;
};

function script(cli: string, state: string): string {
  return `#!${process.execPath}
const fs = require("node:fs");
const state = ${JSON.stringify(state)};
let input = "";
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  const log = state + "/calls.jsonl";
  fs.appendFileSync(log, JSON.stringify({ cli: ${JSON.stringify(cli)}, argv: process.argv.slice(2), stdin: input }) + "\\n");
  const n = fs.readFileSync(log, "utf8").trim().split("\\n").length - 1;
  const answers = JSON.parse(fs.readFileSync(state + "/answers.json", "utf8"));
  const a = answers[n] || { code: 1, stderr: "the kit's fake ${cli} has no answer for call " + (n + 1) };
  process.stdout.write(a.stdout || "");
  process.stderr.write(a.stderr || "");
  process.exitCode = a.code;
});
`;
}

function wordsOf(argv: unknown): readonly string[] | "bad" {
  return Array.isArray(argv) && argv.every((a) => typeof a === "string") ? argv.map(String) : "bad";
}

function callOf(line: string): FakeCall | "bad" {
  const raw = Object(parsedOr(line));
  const cli: unknown = Reflect.get(raw, "cli");
  const stdin: unknown = Reflect.get(raw, "stdin");
  const argv = wordsOf(Reflect.get(raw, "argv"));
  return typeof cli === "string" && typeof stdin === "string" && argv !== "bad" ? { cli, argv, stdin } : "bad";
}

async function callsIn(state: string): Promise<readonly FakeCall[]> {
  const text = await readFile(join(state, "calls.jsonl"), "utf8").catch(() => "");
  return text
    .split("\n")
    .filter((l) => l !== "")
    .map(callOf)
    .filter((c): c is FakeCall => c !== "bad");
}

// makeFakes : one fake for each program, answering from `answers`
export async function makeFakes(clis: readonly string[], answers: readonly FakeAnswer[]): Promise<Result<Fakes>> {
  return attempt(async () => {
    const state = await mkdtemp(join(tmpdir(), "factory-kit-"));
    const dir = join(state, "bin");
    await writeFile(join(state, "answers.json"), JSON.stringify(answers));
    await mkdir(dir);
    for (const cli of clis) {
      await writeFile(join(dir, cli), script(cli, state));
      await chmod(join(dir, cli), 0o755);
    }
    return { dir, calls: () => callsIn(state), remove: () => rm(state, { recursive: true, force: true }) };
  }, "cannot make the kit's fake CLIs");
}

// stringsIn : every text a call carried: each argv word, stdin, and every string inside either one that is JSON
export function stringsIn(call: FakeCall): readonly string[] {
  const words = [...call.argv, call.stdin];
  return [...words, ...words.flatMap((w) => leaves(parsedOr(w)))];
}

function parsedOr(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function leaves(value: unknown): readonly string[] {
  if (typeof value === "string") {
    return [value];
  }
  return typeof value === "object" && value !== null ? Object.values(value).flatMap(leaves) : [];
}
