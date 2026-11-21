// check-size — fails when ROOT/AGENTS.md has 200 lines or more (ported from check-size.sh, #138). The limit is
// ADR-0003's: "AGENTS.md (root, <200 lines" (docs/adr/0003-rulebook-layout-across-tools.md:16).
//
//   node scripts/check-size.ts [ROOT]      (make lint)
//
// Runs on Node's type stripping (Node 22.18+), so it uses only erasable TypeScript.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const LIMIT = 200;

export function lineCount(text: string): number {
  if (text === "") {
    return 0;
  }
  return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
}

export function tooLong(root: string): string {
  const file = join(root, "AGENTS.md");
  const lines = existsSync(file) ? lineCount(readFileSync(file, "utf8")) : 0;
  return lines >= LIMIT ? `too long: AGENTS.md: ${lines} lines; ADR-0003 allows fewer than ${LIMIT}` : "";
}

if (process.argv[1] === import.meta.filename) {
  const why = tooLong(process.argv[2] ?? ".");
  if (why !== "") {
    console.log(why);
    process.exit(1);
  }
}
