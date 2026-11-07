// check-links — fails when a relative link in a tracked .md file under ROOT points at no file (ported from
// check-links.sh, #138). It skips http(s), mailto and pure #anchor links, and checks only the path of path#anchor
// or path?query. It skips links inside code fences and inline code, and tests/fixtures/ (bad input on purpose).
//
//   node scripts/check-links.ts [ROOT]     (make lint)
//
// git lists this repository's own files, not a project's, so it runs plain git, as check-links.sh did. Runs on
// Node's type stripping (Node 22.18+), so it uses only erasable TypeScript.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

type Link = { readonly line: number; readonly target: string };

const FENCE = /^\s*(```|~~~)/;
const INLINE = /\]\(([^)]*)\)/g;
const REFERENCE = /^\s*\[[^\]]+\]:\s+(\S+)/;
const SKIP = /^(#|https?:\/\/|mailto:)/;

// lineLinks : the link targets on one line outside inline code
function lineLinks(raw: string, line: number): readonly Link[] {
  const text = raw.replace(/`[^`]*`/g, "");
  const inline = Array.from(text.matchAll(INLINE), (m) => ({ line, target: m[1] ?? "" }));
  const ref = REFERENCE.exec(text);
  return ref === null ? inline : [...inline, { line, target: ref[1] ?? "" }];
}

// links : every link target in the text, with its line, outside fences and inline code
export function links(text: string): readonly Link[] {
  const out: Link[] = [];
  let fence = false;
  text.split("\n").forEach((raw, i) => {
    const toggles = FENCE.test(raw);
    if (!fence && !toggles) {
      out.push(...lineLinks(raw, i + 1));
    }
    fence = toggles ? !fence : fence;
  });
  return out;
}

function before(text: string, mark: string): string {
  return text.split(mark)[0] ?? "";
}

// pathOf : the file a target names, or "" for one that is not a local path
export function pathOf(target: string): string {
  const bare = before(before(target.replace(/^</, ""), ">"), " ");
  return bare === "" || SKIP.test(bare) ? "" : before(before(bare, "#"), "?").replaceAll("%20", " ");
}

function tracked(root: string): readonly string[] {
  const out = execFileSync(
    "git",
    ["-c", "core.quotePath=false", "-C", root, "ls-files", "-z", "--", "*.md", ":(exclude)tests/fixtures/"],
    { encoding: "utf8" },
  );
  return out.split("\0").filter((f) => f !== "");
}

// brokenIn : one line per link in `file` that points at no file
function brokenIn(root: string, file: string): readonly string[] {
  return links(readFileSync(join(root, file), "utf8")).flatMap((link) => {
    const path = pathOf(link.target);
    const resolved = path.startsWith("/") ? join(root, path) : join(root, dirname(file), path);
    return path !== "" && !existsSync(resolved) ? [`broken link: ${file}:${link.line}: ${link.target}`] : [];
  });
}

// broken : one line per link that points at no file
export function broken(root: string): readonly string[] {
  return tracked(root).flatMap((file) => brokenIn(root, file));
}

if (process.argv[1] === import.meta.filename) {
  const found = broken(process.argv[2] ?? ".");
  for (const line of found) {
    console.log(line);
  }
  if (found.length > 0) {
    console.log(`check-links: ${found.length} broken relative link(s)`);
    process.exit(1);
  }
}
