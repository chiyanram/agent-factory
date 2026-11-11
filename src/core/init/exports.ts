// exports — where a shell profile exports a variable the settings files now hold, so init can say which line to
// remove (#482, ledger pilot row 14). It reads the usual profiles under the person's home; a profile that is a symlink
// (a dotfiles repo) is named by the file it points to, since that is the file to edit. It reads, never writes.

import { readFile, realpath } from "node:fs/promises";
import { join } from "node:path";

// the profiles a shell reads at login or start, under the home
export const PROFILES: readonly string[] = [
  ".zshenv",
  ".zprofile",
  ".zshrc",
  ".bash_profile",
  ".bash_login",
  ".bashrc",
  ".profile",
  ".config/fish/config.fish",
];

export type Place = { readonly name: string; readonly file: string; readonly line: number };

// exportsIn : each line of a profile's text that exports one of the names, sh or fish style. Pure.
export function exportsIn(file: string, text: string, names: readonly string[]): readonly Place[] {
  return text.split("\n").flatMap((line, i) => {
    const name = exportedName(line);
    return names.includes(name) ? [{ name, file, line: i + 1 }] : [];
  });
}

// exportedName : the variable a profile line exports, sh (export NAME=) or fish (set -gx NAME); "" for none. Pure.
function exportedName(line: string): string {
  const sh = /^\s*export\s+([A-Z_][A-Z0-9_]*)=/.exec(line)?.[1];
  return sh ?? /^\s*set\s+-[a-zA-Z]*x[a-zA-Z]*\s+([A-Z_][A-Z0-9_]*)\s/.exec(line)?.[1] ?? "";
}

async function placesIn(home: string, profile: string, names: readonly string[]): Promise<readonly Place[]> {
  const real = await realpath(join(home, profile)).catch(() => "");
  const text = real === "" ? undefined : await readFile(real, "utf8").catch(() => undefined);
  return text === undefined ? [] : exportsIn(real, text, names);
}

// exportPlaces : every profile line under the home that exports one of the names; a profile reached twice through
// symlinks is read once
export async function exportPlaces(home: string, names: readonly string[]): Promise<readonly Place[]> {
  if (home === "" || names.length === 0) {
    return [];
  }
  const found = (await Promise.all(PROFILES.map((p) => placesIn(home, p, names)))).flat();
  const seen = new Set<string>();
  return found.filter((p) => {
    const key = `${p.file}:${p.line}`;
    const fresh = !seen.has(key);
    seen.add(key);
    return fresh;
  });
}

// exportsText : what init says about the exports the files now make needless: each file and line to remove, or the
// names alone when no profile under the home holds them (exported elsewhere). Pure.
export function exportsText(names: readonly string[], places: readonly Place[]): string {
  if (names.length === 0) {
    return "";
  }
  const lines = places.map((p) => `  ${p.file}:${p.line}  (${p.name})`);
  return lines.length === 0
    ? `\nThe files now hold ${names.join(", ")}: you can remove their exports from wherever your shell sets them.\n`
    : `\nThe files now hold ${names.join(", ")}: you can remove these exports:\n${lines.join("\n")}\n`;
}
