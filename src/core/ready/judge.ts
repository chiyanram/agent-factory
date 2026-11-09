// judge — the judge files of a change (#231; GLOSSARY "Judge files"; test check S4): the files that judge the work, so a
// change to one is a change to how the change is judged. The floor guard (floor.ts) stops a change that touches one.
//
//   build        the build files and dependency manifests (review/status.ts BUILD_FILES)
//   verify       the files the project's verify command names: each word that is a path, and the files its program
//                reads (make: the makefiles; npm: package.json; gradlew: the wrapper; and the like)
//   test config  jest, vitest and playwright config, junit-platform.properties, pytest.ini, conftest.py
//   the project  the project file's "ready.judgeFiles": more globs, added to the list, never in place of it
//
// The list is a deny-list settings key: every layer adds, none removes. judgeFiles is the one place it is read, so the
// settings layers (#229) can resolve "ready.judgeFiles" and hand it here.

import type { Argv, ProjectFile } from "../project.js";
import { BUILD_FILES } from "../review/status.js";

export const TEST_CONFIG: readonly string[] = [
  "**/jest.config.*",
  "**/vitest.config.*",
  "**/vitest.workspace.*",
  "**/playwright.config.*",
  "**/junit-platform.properties",
  "**/pytest.ini",
  "**/conftest.py",
];

// the files a verify program reads on its own, at the root of the repo
const PROGRAM_FILES: Readonly<Record<string, readonly string[]>> = {
  make: ["Makefile", "makefile", "GNUmakefile"],
  gmake: ["Makefile", "makefile", "GNUmakefile"],
  npm: ["package.json"],
  pnpm: ["package.json"],
  yarn: ["package.json"],
  gradlew: ["gradlew", "gradle/wrapper/**"],
  gradle: ["build.gradle", "build.gradle.kts"],
  mvnw: ["mvnw", ".mvn/**"],
  mvn: ["pom.xml", ".mvn/**"],
  tox: ["tox.ini"],
  pytest: ["pytest.ini", "setup.cfg", "pyproject.toml", "tox.ini"],
  just: ["justfile", "Justfile"],
  task: ["Taskfile.yml", "Taskfile.yaml"],
};

// a word that names a file: it has a folder or an extension, and is not an option
const PATHLIKE = /^[^-].*(?:\/|\.[A-Za-z0-9]+$)/;

// plain : a word as a glob from the repo's root: no leading ./, and a folder as everything in it
function plain(word: string): string {
  const path = word.replace(/^(?:\.\/)+/, "");
  return path.endsWith("/") ? `${path}**` : path;
}

// verifyFiles : the files the verify command names. Pure.
export function verifyFiles(verify: Argv): readonly string[] {
  const [program, ...rest] = verify;
  const name = plain(program).split("/").at(-1) ?? "";
  const own = Object.hasOwn(PROGRAM_FILES, name) ? (PROGRAM_FILES[name] ?? []) : [];
  const named = [program, ...rest].filter((w) => PATHLIKE.test(w) || w.startsWith("./")).map(plain);
  return [...new Set([...own, ...named])].filter((w) => w !== "" && !w.includes(".."));
}

// judgeFiles : the judge files' globs for a project: the built-in ones, the verify command's files, and the project's
// own additions. Pure.
export function judgeFiles(project: ProjectFile): readonly string[] {
  const verify = project.gate.kind === "local" ? verifyFiles(project.gate.verify) : [];
  return [...new Set([...BUILD_FILES, ...TEST_CONFIG, ...verify, ...project.ready.judgeFiles])];
}
