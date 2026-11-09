// temp — the one way a test makes a temp folder (#222). On macOS tmpdir() sits behind a symlink (/var is
// /private/var), so a path built from it differs from the real path that git, realpath or a child process reports.
// tempDir answers the real path, so a test that compares paths passes on macOS as on Linux. make lint fails on any
// other tmpdir() in test/ (scripts/check-temp-dirs.ts).

import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// tempDir : a fresh, empty folder under the system temp folder, by its real path
export function tempDir(prefix: string): string {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}
