// listing — the build, test and run commands a project's own files list (#235; the onboarder card's step 2). The engine
// reads them itself, from the files at the default branch and with no program run, so no command in the brief is
// guessed and no repo code runs on the host:
//
//   Makefile        its targets, each with the "## help" text on its line: the project's front door, so when there
//                   is one the brief names make targets, never the raw tool underneath
//   package.json    its "scripts", as npm run <name>
//
// A Gradle or Maven wrapper with no Makefile is named as inferred: listing its tasks (./gradlew tasks) runs the build's
// own code, which only a runner may do. Pure.

import { prop } from "../dispatch/records.js";

export type Listed = {
  readonly command: string;
  readonly help: string;
  readonly file: string;
  readonly line: number;
};

export type Commands =
  | { readonly kind: "listed"; readonly from: string; readonly commands: readonly Listed[] }
  | { readonly kind: "inferred"; readonly why: string }
  | { readonly kind: "none" };

const TARGET = /^([A-Za-z0-9][A-Za-z0-9_.-]*)\s*:(?!=)[^#]*(?:##\s*(.*))?$/;

export function makeTargets(text: string, file = "Makefile"): readonly Listed[] {
  const all = text.split("\n").flatMap((line, i) => targetAt(line, file, i + 1));
  return all.filter((t, i) => all.findIndex((u) => u.command === t.command) === i);
}

function targetAt(line: string, file: string, at: number): readonly Listed[] {
  const m = TARGET.exec(line);
  return m === null ? [] : [{ command: `make ${m[1] ?? ""}`, help: (m[2] ?? "").trim(), file, line: at }];
}

function scriptsOf(value: unknown): readonly string[] {
  const scripts = prop(value, "scripts");
  return typeof scripts === "object" && scripts !== null ? Object.keys(scripts) : [];
}

function parsed(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export function packageScripts(text: string, file = "package.json"): readonly Listed[] {
  const lines = text.split("\n");
  return scriptsOf(parsed(text)).map((name) => ({
    command: `npm run ${name}`,
    help: "",
    file,
    line: lines.findIndex((l) => l.includes(`"${name}"`)) + 1,
  }));
}

export type RootFiles = {
  readonly makefile?: string;
  readonly packageJson?: string;
  readonly wrappers: readonly string[];
};

export function commandsOf(files: RootFiles): Commands {
  if (files.makefile !== undefined) {
    return { kind: "listed", from: "Makefile", commands: makeTargets(files.makefile) };
  }
  if (files.packageJson !== undefined) {
    return { kind: "listed", from: "package.json", commands: packageScripts(files.packageJson) };
  }
  const [wrapper] = files.wrappers;
  return wrapper === undefined
    ? { kind: "none" }
    : {
        kind: "inferred",
        why: `${wrapper} is the build tool; its tasks are listed by running it, which only a runner may do`,
      };
}
