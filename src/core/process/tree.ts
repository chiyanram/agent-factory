// tree — the tree hash of a folder of plain files: one line per file, its executable bit, the sha256 of its bytes and
// its path, sorted, then the sha256 of those lines. A symlink or any other kind of entry is refused, so a store copy
// can hold nothing a hash does not cover. The plugin pins (pins.ts) and the CI check of the engine's own pin
// (scripts/check-eval-proof.ts) hash a plugin the same way. A leaf with only Node's own imports, so the script loads it
// on Node's type stripping.

import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

async function fileLines(dir: string, under: string): Promise<readonly string[]> {
  const lines: string[] = [];
  for (const name of (await readdir(join(dir, under))).toSorted()) {
    lines.push(...(await entryLines(dir, under === "" ? name : `${under}/${name}`)));
  }
  return lines;
}

async function entryLines(dir: string, path: string): Promise<readonly string[]> {
  const s = await lstat(join(dir, path));
  if (s.isDirectory()) {
    return fileLines(dir, path);
  }
  if (!s.isFile()) {
    throw new Error(`${path} is not a plain file`);
  }
  const sum = createHash("sha256")
    .update(await readFile(join(dir, path)))
    .digest("hex");
  return [`${s.mode & 0o111 ? "x" : "-"} ${sum} ${path}`];
}

export async function hashTree(dir: string): Promise<{ readonly sha256: string; readonly files: readonly string[] }> {
  const files = await fileLines(dir, "");
  return { sha256: createHash("sha256").update(files.join("\n")).digest("hex"), files };
}
