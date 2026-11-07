// lint-ratchet — runs oxlint (type-aware) and holds the code to scripts/lint-baseline.json, which only shrinks (#148).
// Adapted from mattpocock/sandcastle's scripts/lint-ratchet.ts.
//
// The baseline counts the findings that were already in the code when the rules landed, per file and rule. A count
// above its baseline fails: new code meets every rule. A count below its baseline also fails until the baseline is
// shrunk with --shrink, so a fixed finding can never come back. Never write a disable comment; fix the code.
//
//   node scripts/lint-ratchet.ts            check (make lint)
//   node scripts/lint-ratchet.ts --shrink   write the lower counts into the baseline; never raises one
//
// Runs on Node's type stripping (Node 22.18+), so it uses only erasable TypeScript.

import { execFile } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Diagnostic = { readonly code: string; readonly filename: string; readonly message: string; readonly line: number };
type Counts = Readonly<Record<string, number>>;
type Verdict =
  | { readonly kind: "clean" }
  | { readonly kind: "over"; readonly keys: readonly string[] }
  | { readonly kind: "shrinkable"; readonly keys: readonly string[] };

const ROOT = join(import.meta.dirname, "..");
const BASELINE = join(ROOT, "scripts", "lint-baseline.json");

function key(d: Diagnostic): string {
  return `${d.filename} ${d.code}`;
}

function count(diagnostics: readonly Diagnostic[]): Counts {
  const counts: Record<string, number> = {};
  for (const d of diagnostics) {
    counts[key(d)] = (counts[key(d)] ?? 0) + 1;
  }
  return counts;
}

// judge : pure. New findings first, then the ones fixed but still in the baseline.
function judge(now: Counts, base: Counts): Verdict {
  const over = Object.keys(now).filter((k) => (now[k] ?? 0) > (base[k] ?? 0));
  if (over.length > 0) {
    return { kind: "over", keys: over };
  }
  const under = Object.keys(base).filter((k) => (now[k] ?? 0) < (base[k] ?? 0));
  return under.length > 0 ? { kind: "shrinkable", keys: under } : { kind: "clean" };
}

// shrink : each count lowered to what is there now; a key with nothing left is dropped; nothing is ever raised
function shrink(now: Counts, base: Counts): Counts {
  const kept = Object.keys(base)
    .map((k) => [k, Math.min(now[k] ?? 0, base[k] ?? 0)] as const)
    .filter(([, n]) => n > 0)
    .toSorted(([a], [b]) => a.localeCompare(b));
  return Object.fromEntries(kept);
}

// field : one property of a parsed JSON value, or undefined; no type assertion on the way
function field(value: unknown, name: string): unknown {
  return typeof value === "object" && value !== null ? (Reflect.get(value, name) as unknown) : undefined;
}

function toDiagnostic(d: unknown): Diagnostic {
  const labels = field(d, "labels");
  const first: unknown = Array.isArray(labels) ? labels[0] : undefined;
  return {
    code: String(field(d, "code")),
    filename: String(field(d, "filename")),
    message: String(field(d, "message")),
    line: Number(field(field(first, "span"), "line")) || 0,
  };
}

function runOxlint(): Promise<{ readonly stdout: string; readonly stderr: string }> {
  const bin = join(ROOT, "node_modules", ".bin", "oxlint");
  return new Promise((resolve) => {
    execFile(
      bin,
      ["--type-aware", "-f", "json"],
      { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 },
      (_error, stdout, stderr) => {
        resolve({ stdout, stderr });
      },
    );
  });
}

// oxlint : every finding; output that is not oxlint's JSON throws, so a broken run never reads as clean
async function oxlint(): Promise<readonly Diagnostic[]> {
  const { stdout, stderr } = await runOxlint();
  const list = field(JSON.parse(stdout === "" ? "null" : stdout) as unknown, "diagnostics");
  if (!Array.isArray(list)) {
    throw new Error(`oxlint gave no findings list: ${stderr.trim() || stdout.slice(0, 500)}`);
  }
  return list.map(toDiagnostic);
}

// readBaseline : a baseline that does not parse counts nothing, so every finding fails: it fails closed
function readBaseline(): Counts {
  const value = JSON.parse(readFileSync(BASELINE, "utf8")) as unknown;
  return typeof value === "object" && value !== null
    ? Object.fromEntries(Object.entries(value).filter(([, n]) => typeof n === "number"))
    : {};
}

function report(verdict: Verdict, diagnostics: readonly Diagnostic[]): number {
  switch (verdict.kind) {
    case "clean":
      return 0;
    case "over": {
      const shown = diagnostics.filter((d) => verdict.keys.includes(key(d)));
      process.stderr.write(
        `lint: new findings; fix the code (no disable comments, no baseline raise):\n${shown.map((d) => `  ${d.filename}:${d.line} ${d.code} ${d.message}\n`).join("")}`,
      );
      return 1;
    }
    case "shrinkable":
      process.stderr.write(
        `lint: fixed findings are still in the baseline; run: node scripts/lint-ratchet.ts --shrink\n${verdict.keys.map((k) => `  ${k}\n`).join("")}`,
      );
      return 1;
  }
}

async function main(): Promise<number> {
  const diagnostics = await oxlint();
  const now = count(diagnostics);
  if (process.argv.includes("--shrink")) {
    writeFileSync(BASELINE, `${JSON.stringify(shrink(now, readBaseline()), null, 2)}\n`);
    return 0;
  }
  return report(judge(now, readBaseline()), diagnostics);
}

try {
  process.exitCode = await main();
} catch (error) {
  process.stderr.write(`lint-ratchet: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
}
