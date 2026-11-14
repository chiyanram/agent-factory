// garden-pr — the module numbers of a change, by hand: each code file the change touches, measured by gardener at the
// merge base and at the head, and the numbers that got worse (src/core/garden/numbers.ts says which count). It is a
// measure for a person, not a gate: it exits 0 whatever it finds, and 2 only when it cannot measure.
//
//   node scripts/garden-pr.ts [--base REV] [--head REV] [--json]     (make garden-pr; base origin/main, head HEAD)
//
// gardener's definitions (the size limit, the patterns, what is code and what is ignored) come from the merge base's
// gardener.config.json, never the head's, so a change cannot loosen the measure it is judged by. Each file is measured
// on its own: gardener's code setting replaces its default list, so a config whose code list is one path counts just
// that file, by gardener's own rules. A renamed file is measured at its old path before and its new path after.
//
// It deep-imports repo-gardener's src/config.mjs (resolveConfig, classifiers), which the package does not export as a
// public interface. That holds under the exact pin in package.json; a gardener upgrade must recheck this import and the
// snapshot JSON that numbers.ts reads.
//
// git reads this repository's own history, not a project's clone, so it runs plain git, as check-links does. Runs on
// Node's type stripping, so it uses only erasable TypeScript.

import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs as parse } from "node:util";
import { type Config, classifiers, resolveConfig } from "repo-gardener/src/config.mjs";
import type * as Numbers from "../src/core/garden/numbers.js";

// the rules live in src/ (a leaf), loaded on Node's type stripping
const numbers: typeof Numbers = await import(new URL("../src/core/garden/numbers.ts", import.meta.url).href);

const GARDENER = fileURLToPath(import.meta.resolve("repo-gardener/src/cli.mjs"));

// one touched file: its path at the merge base and at the head (the same unless it was renamed)
export type Touched = { readonly before: string; readonly after: string };

export type Args = { readonly base: string; readonly head: string; readonly json: boolean };

type Ran = { readonly kind: "ok"; readonly stdout: string } | { readonly kind: "failed"; readonly reason: string };

// parseArgs : the options, or why they are not understood
export function parseArgs(argv: readonly string[]): Args | string {
  try {
    const { values } = parse({
      args: [...argv],
      options: {
        base: { type: "string", default: "origin/main" },
        head: { type: "string", default: "HEAD" },
        json: { type: "boolean", default: false },
      },
      strict: true,
      allowPositionals: false,
    });
    return { base: values.base, head: values.head, json: values.json };
  } catch (e) {
    return `garden-pr: ${e instanceof Error ? e.message : String(e)}; use --base REV --head REV [--json]`;
  }
}

// how many fields one entry of `git diff --name-status -z` takes: a rename or a copy names two paths
const width = (status: string | undefined): number => (/^[RC]/.test(status ?? "") ? 3 : 2);

// one entry: a copy is measured as a new file, a rename at its old path before and its new path after
const entry = ([status = "", first = "", second = first]: readonly string[]): Touched =>
  status.startsWith("C") ? { before: second, after: second } : { before: first, after: second };

// touchedOf : the files of `git diff --name-status -z -M`, a rename paired with its old path
export function touchedOf(nameStatus: string): readonly Touched[] {
  const parts = nameStatus.split("\0").filter((p) => p !== "");
  const out: Touched[] = [];
  for (let i = 0; i < parts.length; i += width(parts[i])) out.push(entry(parts.slice(i, i + width(parts[i]))));
  return out;
}

function run(cwd: string, program: string, args: readonly string[]): Ran {
  const r = spawnSync(program, args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status === 0) return { kind: "ok", stdout: r.stdout };
  return { kind: "failed", reason: `${[program, ...args].join(" ")}: ${(r.stderr || r.error?.message || "").trim()}` };
}

// a config file's text as a JSON object, or why it is not one
function parseConfig(text: string): Record<string, unknown> | string {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? { ...value }
      : "gardener.config.json at the merge base is not a JSON object";
  } catch (e) {
    return `gardener.config.json at the merge base is not JSON: ${String(e)}`;
  }
}

// the merge base's gardener.config.json as JSON, or {} when it has none
function baseConfig(cwd: string, mergeBase: string): Record<string, unknown> | string {
  const listed = run(cwd, "git", ["ls-tree", "--name-only", mergeBase, "--", "gardener.config.json"]);
  if (listed.kind === "failed") return listed.reason;
  if (listed.stdout.trim() === "") return {};
  const shown = run(cwd, "git", ["show", `${mergeBase}:gardener.config.json`]);
  return shown.kind === "failed" ? shown.reason : parseConfig(shown.stdout);
}

// one file at one commit, measured by gardener with a config whose code list is that file
function measure(cwd: string, dir: string, user: Record<string, unknown>, rev: string, path: string): Numbers.Read {
  const config = join(dir, "gardener.config.json");
  writeFileSync(config, JSON.stringify({ ...user, code: [path] }));
  const ran = run(cwd, process.execPath, [GARDENER, "snapshot", rev, "--json", "--no-cache", "--config", config]);
  if (ran.kind === "failed") return { kind: "bad", reason: ran.reason };
  try {
    return numbers.fromSnapshot(JSON.parse(ran.stdout));
  } catch (e) {
    return { kind: "bad", reason: `gardener's snapshot is not JSON: ${String(e)}` };
  }
}

export type Report = {
  readonly base: string;
  readonly head: string;
  readonly largeFileLines: number;
  readonly rows: readonly Numbers.Row[];
  readonly worse: readonly Numbers.Worse[];
};

type Revs = { readonly head: string; readonly mergeBase: string };

function sha(cwd: string, args: readonly string[]): string | { readonly reason: string } {
  const r = run(cwd, "git", args);
  return r.kind === "ok" ? r.stdout.trim() : { reason: r.reason };
}

// the head and its merge base with the base, as full SHAs
function revs(cwd: string, args: Args): Revs | string {
  const head = sha(cwd, ["rev-parse", "--verify", `${args.head}^{commit}`]);
  if (typeof head !== "string") return head.reason;
  const mergeBase = sha(cwd, ["merge-base", args.base, head]);
  return typeof mergeBase === "string" ? { head, mergeBase } : mergeBase.reason;
}

// the code files the change touches, by the merge base's definition of code
function touchedCode(cwd: string, at: Revs, config: Config): readonly Touched[] | string {
  const diff = run(cwd, "git", ["diff", "--name-status", "-z", "-M", at.mergeBase, at.head]);
  if (diff.kind === "failed") return diff.reason;
  const is = classifiers(config);
  return touchedOf(diff.stdout).filter((t) => is.isCode(t.before) || is.isCode(t.after));
}

// each touched file measured at the merge base and at the head, or the first file that could not be
function rowsFor(
  cwd: string,
  user: Record<string, unknown>,
  at: Revs,
  touched: readonly Touched[],
): Numbers.Row[] | string {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), "garden-pr-"));
  try {
    const rows: Numbers.Row[] = [];
    for (const t of touched) {
      const before = measure(cwd, dir, user, at.mergeBase, t.before);
      if (before.kind === "bad") return `${t.before} at ${at.mergeBase}: ${before.reason}`;
      const after = measure(cwd, dir, user, at.head, t.after);
      if (after.kind === "bad") return `${t.after} at ${at.head}: ${after.reason}`;
      rows.push({ path: t.after, before: before.side, after: after.side });
    }
    return rows;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// report : the module numbers of the change from base to head in the repository at cwd, or why it cannot measure
export function report(cwd: string, args: Args): Report | string {
  const at = revs(cwd, args);
  if (typeof at === "string") return at;
  const user = baseConfig(cwd, at.mergeBase);
  if (typeof user === "string") return user;
  const config = resolveConfig(user);
  const touched = touchedCode(cwd, at, config);
  if (typeof touched === "string") return touched;
  const rows = rowsFor(cwd, user, at, touched);
  if (typeof rows === "string") return rows;
  const limit = config.largeFileLines;
  return { base: at.mergeBase, head: at.head, largeFileLines: limit, rows, worse: numbers.worse(rows, limit) };
}

if (process.argv[1] === import.meta.filename) {
  const args = parseArgs(process.argv.slice(2));
  const out = typeof args === "string" ? args : report(process.cwd(), args);
  if (typeof out === "string") {
    console.error(`garden-pr: cannot measure: ${out}`);
    process.exit(2);
  }
  const json = typeof args !== "string" && args.json;
  console.log(
    json
      ? JSON.stringify(out, null, 2)
      : `Merge base ${out.base.slice(0, 10)}, head ${out.head.slice(0, 10)}\n\n${numbers.render(out.rows, out.worse, out.largeFileLines)}`,
  );
}
