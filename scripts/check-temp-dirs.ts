// check-temp-dirs — fails when a tracked .ts file under ROOT/test/ or ROOT/scripts/ calls tmpdir() itself (#222, #485).
// On macOS tmpdir() sits behind a symlink (/var is /private/var), so code that builds a path from it passes on Linux and
// fails on a Mac; test/temp.ts's tempDir() answers the real path, and it is the one file allowed to call tmpdir() bare.
// A script may call it only as realpathSync(tmpdir()), which answers the real path too.
//
//   node scripts/check-temp-dirs.ts [ROOT]     (make lint)
//
// git lists this repository's own files, not a project's, so it runs plain git, as check-links does. Runs on Node's
// type stripping (Node 22.18+), so it uses only erasable TypeScript.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const HELPER = "test/temp.ts";
const CALL = /\btmpdir\s*\(/;
// the one form a script may use: the real path of the temp folder
const REAL = /\brealpathSync\(\s*tmpdir\(\s*\)\s*\)/g;

// a "…" or '…' string literal: text in one, such as a test's sample line, calls nothing. A template literal is kept,
// since its ${…} runs code.
const QUOTED = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g;

// code : a line with its string literals emptied and the allowed realpathSync(tmpdir()) form taken out
function code(line: string): string {
  return line.replace(QUOTED, '""').replace(REAL, "");
}

// bareCalls : "file:line" for each line of the text that calls tmpdir()
export function bareCalls(file: string, text: string): readonly string[] {
  return text
    .split("\n")
    .flatMap((line, i) => (!line.trim().startsWith("//") && CALL.test(code(line)) ? [`${file}:${i + 1}`] : []));
}

function tracked(root: string): readonly string[] {
  const out = execFileSync(
    "git",
    ["-c", "core.quotePath=false", "-C", root, "ls-files", "-z", "--", "test/*.ts", "scripts/*.ts"],
    {
      encoding: "utf8",
    },
  );
  return out.split("\0").filter((f) => f !== "" && f !== HELPER);
}

if (process.argv[1] === import.meta.filename) {
  const root = process.argv[2] ?? ".";
  const found = tracked(root).flatMap((file) => bareCalls(file, readFileSync(join(root, file), "utf8")));
  for (const at of found) {
    console.log(
      `${at}: calls tmpdir itself; make the folder with tempDir() from ${HELPER}, which answers its real path`,
    );
  }
  if (found.length > 0) {
    console.log(`check-temp-dirs: ${found.length} call(s) to tmpdir in test/ or scripts/`);
    process.exit(1);
  }
}
