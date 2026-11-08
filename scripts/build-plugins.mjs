// build-plugins — the bundled forge plugins, made from the compiled package (#134 PR C). A plugin is pinned as the
// folder its file sits in (src/core/plugin/pin.ts), so it cannot import the package from outside that folder: this
// copies the compiled modules the forge plugin runs (dist/core/forge/serve.js and every module it imports, by relative
// path) into plugins/<name>/lib/, keeping their layout, and writes lib/version.js. A module that imports a package by
// name stops the build, since the pinned folder would not hold it. `npm run build` runs it after tsc.

import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const DIST = join(ROOT, "dist");
const PLUGINS = ["github", "gitlab"];
const ENTRY = join(DIST, "core", "forge", "serve.js");
const IMPORT = /(?:^|[\s;])(?:import|export)\s[^"']*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;

// imported : the modules one file imports by relative path; a package imported by name stops the build
function imported(file) {
  const specs = [...readFileSync(file, "utf8").matchAll(IMPORT)].map((m) => m[1] ?? m[2]);
  const named = specs.find((s) => !s.startsWith(".") && !s.startsWith("node:"));
  if (named !== undefined) {
    throw new Error(`${relative(ROOT, file)} imports ${named}; a bundled plugin holds only the package's own modules`);
  }
  return specs.filter((s) => s.startsWith(".")).map((s) => resolve(dirname(file), s));
}

// closure : every compiled module the entry needs, by its path under dist
function closure(entry) {
  const seen = new Set();
  const todo = [entry];
  while (todo.length > 0) {
    const file = todo.pop();
    if (!seen.has(file)) {
      seen.add(file);
      todo.push(...imported(file));
    }
  }
  return [...seen].toSorted((a, b) => a.localeCompare(b));
}

const version = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
const files = closure(ENTRY);
for (const name of PLUGINS) {
  const lib = join(ROOT, "plugins", name, "lib");
  rmSync(lib, { recursive: true, force: true });
  for (const file of files) {
    const target = join(lib, relative(DIST, file));
    mkdirSync(dirname(target), { recursive: true });
    cpSync(file, target);
  }
  writeFileSync(join(lib, "version.js"), `export const VERSION = ${JSON.stringify(version)};\n`);
}
process.stdout.write(`build-plugins: ${files.length} modules into ${PLUGINS.map((p) => `plugins/${p}/lib`).join(", ")}\n`);
