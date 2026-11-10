// detect — what `agent-factory init` reads from the product clone before it asks anything (#369). It reads files and
// the clone's `origin` (through hostGit), and runs no program of the clone's: the build tool, the test folders, the
// migration folders, the CI files and the toolchain file are found by name. Nothing here throws.
//
//   git host     from origin: github.com is github; any other host is gitlab, and its name is gitHostName
//   build        ./gradlew, ./mvnw (or pom.xml), package.json, Makefile: ready.programs, the verify command and the
//                egress hosts its dependencies come from; api.anthropic.com always
//   tests        the built-in test globs, which hold src/integrationTest/**; added to the project file only if not
//   one-way door Flyway (db/migration) and Liquibase (db/changelog) folders under src/main/resources, at the root or
//                one module down
//   gate         forge-ci when the clone has CI files (.github/workflows, .gitlab-ci.yml), else local with verify
//   toolchain    mise.toml, .mise.toml, .tool-versions or .sdkmanrc, and the tools each declares

import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { Result } from "../forge/api.js";
import { hostGit } from "../git.js";
import { TEST_FILES } from "../ready/floor.js";

export type HostKind = "github" | "gitlab";

export type Remote = { readonly host: string; readonly path: string };

export type Build = {
  readonly name: string;
  // the file that told it
  readonly file: string;
  readonly programs: readonly string[];
  readonly verify: readonly string[];
  readonly egress: readonly string[];
};

export type Tool = { readonly name: string; readonly version: string };
export type Declared = { readonly file: string; readonly manager: string; readonly tools: readonly Tool[] };

export type Detected = {
  readonly clone: string;
  readonly name: string;
  readonly host: HostKind;
  // the git host's name when it is not the public one, else ""
  readonly hostName: string;
  readonly project: string;
  readonly builds: readonly Build[];
  readonly testFiles: readonly string[] | "default";
  // whether the clone keeps integration tests in src/integrationTest
  readonly integrationTests: boolean;
  readonly oneWayDoor: readonly { readonly glob: string; readonly tool: string }[];
  // the CI files found, relative to the clone
  readonly ci: readonly string[];
  readonly toolchain: Declared | "none";
};

// the model API: every implementer run needs it
export const MODEL_HOST = "api.anthropic.com";

const MAVEN_HOSTS = ["repo.maven.apache.org", "repo1.maven.org"];

// the build tools, in the order the first one wins the verify command
const BUILDS: readonly (Build & { readonly needs?: string })[] = [
  {
    name: "Gradle",
    file: "gradlew",
    programs: ["./gradlew"],
    verify: ["./gradlew", "check"],
    egress: [...MAVEN_HOSTS, ".gradle.org"],
  },
  { name: "Maven", file: "mvnw", programs: ["./mvnw"], verify: ["./mvnw", "verify"], egress: MAVEN_HOSTS },
  { name: "Maven", file: "pom.xml", programs: ["mvn"], verify: ["mvn", "verify"], egress: MAVEN_HOSTS, needs: "mvnw" },
  { name: "npm", file: "package.json", programs: ["npm"], verify: ["npm", "test"], egress: [".npmjs.org"] },
  { name: "make", file: "Makefile", programs: ["make"], verify: ["make", "test"], egress: [] },
];

const MIGRATIONS: readonly { readonly dir: string; readonly tool: string }[] = [
  { dir: "src/main/resources/db/migration", tool: "Flyway" },
  { dir: "src/main/resources/db/changelog", tool: "Liquibase" },
];

const TOOLCHAIN_FILES: readonly { readonly file: string; readonly manager: string }[] = [
  { file: "mise.toml", manager: "mise" },
  { file: ".mise.toml", manager: "mise" },
  { file: ".tool-versions", manager: "asdf" },
  { file: ".sdkmanrc", manager: "SDKMAN!" },
];

async function isThere(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

async function textOf(path: string): Promise<string> {
  return readFile(path, "utf8").catch(() => "");
}

// parseRemote : the host and the project path of a git remote URL: https://host/o/n(.git), ssh://git@host[:port]/o/n,
// or git@host:o/n.git; "bad" for anything else. Pure.
export function parseRemote(url: string): Remote | "bad" {
  const trimmed = url.trim();
  const found = REMOTES.map((r) => r.exec(trimmed)).find((m) => m !== null);
  if (found === undefined) {
    return "bad";
  }
  const [host, path] = [String(found[1]), String(found[2])];
  return /^[\w.-]+(\/[\w.-]+)+$/.test(path) ? { host: host.toLowerCase(), path } : "bad";
}

// a remote URL: https://host/o/n, ssh://git@host:port/o/n, and git@host:o/n, each with or without .git
const REMOTES: readonly RegExp[] = [
  /^(?:https?|ssh|git):\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/,
  /^(?:[^@/]+@)?([^/:]+):(?!\/)(.+?)(?:\.git)?\/?$/,
];

// hostOf : the git host's kind and its name when it is not the public one. Pure.
export function hostOf(host: string): { readonly kind: HostKind; readonly name: string } {
  if (host === "github.com") {
    return { kind: "github", name: "" };
  }
  return { kind: "gitlab", name: host === "gitlab.com" ? "" : host };
}

async function gitOut(clone: string, args: readonly string[], env: NodeJS.ProcessEnv): Promise<Result<string>> {
  const got = await hostGit({ args, repo: { kind: "repo", path: clone }, env, stdin: { kind: "none" } });
  if (got.kind === "ok") {
    return { kind: "ok", value: got.stdout.trim() };
  }
  return { kind: "failed", reason: got.kind === "refused" ? got.reason : got.stderr.trim() };
}

// cloneRoot : the top folder of the clone that holds `dir`
export async function cloneRoot(dir: string, env: NodeJS.ProcessEnv): Promise<Result<string>> {
  const top = await gitOut(dir, ["rev-parse", "--show-toplevel"], env);
  return top.kind === "ok" ? top : { kind: "failed", reason: `${dir} is not a git clone; run init inside the clone` };
}

async function remoteOf(clone: string, env: NodeJS.ProcessEnv): Promise<Result<Remote>> {
  const url = await gitOut(clone, ["remote", "get-url", "origin"], env);
  if (url.kind === "failed") {
    return { kind: "failed", reason: `${clone} has no origin remote; add it: git remote add origin <url>` };
  }
  const remote = parseRemote(url.value);
  return remote === "bad"
    ? {
        kind: "failed",
        reason: `origin ${JSON.stringify(url.value)} is not a git host URL of the form host/owner/name`,
      }
    : { kind: "ok", value: remote };
}

async function buildsIn(clone: string): Promise<readonly Build[]> {
  const found: Build[] = [];
  for (const b of BUILDS) {
    const skip = b.needs !== undefined && (await isThere(join(clone, b.needs)));
    if (!skip && (await isThere(join(clone, b.file)))) {
      found.push({ name: b.name, file: b.file, programs: b.programs, verify: b.verify, egress: b.egress });
    }
  }
  return found;
}

// modules : the clone's root and each folder one down, where a multi-module build keeps its own sources
async function modules(clone: string): Promise<readonly string[]> {
  const entries = await readdir(clone, { withFileTypes: true }).catch(() => []);
  const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules");
  return ["", ...dirs.map((e) => e.name)];
}

async function migrationsIn(clone: string): Promise<Detected["oneWayDoor"]> {
  const found: { glob: string; tool: string }[] = [];
  for (const mod of await modules(clone)) {
    for (const m of MIGRATIONS) {
      const rel = mod === "" ? m.dir : `${mod}/${m.dir}`;
      if (await isThere(join(clone, rel))) {
        found.push({ glob: `${rel}/**`, tool: m.tool });
      }
    }
  }
  return found;
}

async function ciIn(clone: string): Promise<readonly string[]> {
  const flows = await readdir(join(clone, ".github", "workflows")).catch(() => []);
  const github = flows.filter((f) => /\.ya?ml$/.test(f)).map((f) => `.github/workflows/${f}`);
  return (await isThere(join(clone, ".gitlab-ci.yml"))) ? [...github.toSorted(), ".gitlab-ci.yml"] : github.toSorted();
}

// the integration tests' folder; the built-in test globs already hold it, so the project file needs it only if they
// ever stop
const IT_GLOB = "**/src/integrationTest/**";

async function integrationTestsIn(clone: string): Promise<boolean> {
  return isThere(join(clone, "src", "integrationTest"));
}

async function testFilesIn(clone: string): Promise<Detected["testFiles"]> {
  return (await integrationTestsIn(clone)) && !TEST_FILES.includes(IT_GLOB) ? [...TEST_FILES, IT_GLOB] : "default";
}

// tools : what one toolchain file declares. Pure.
export function toolsOf(file: string, text: string): readonly Tool[] {
  const lines = text.split("\n").map((l) => l.replace(/#.*$/, "").trim());
  if (file === ".tool-versions") {
    return lines.flatMap((l) => {
      const [name = "", version = ""] = l.split(/\s+/);
      return name !== "" && version !== "" ? [{ name, version }] : [];
    });
  }
  if (file === ".sdkmanrc") {
    return lines.flatMap((l) => {
      const [name = "", version = ""] = l.split("=").map((p) => p.trim());
      return name !== "" && version !== "" ? [{ name, version }] : [];
    });
  }
  return miseTools(lines);
}

// miseTools : the [tools] table of a mise.toml: name = "1", name = ["1"], or name = { version = "1" }. Pure.
function miseTools(lines: readonly string[]): readonly Tool[] {
  const start = lines.indexOf("[tools]");
  if (start < 0) {
    return [];
  }
  const after = lines.slice(start + 1);
  const end = after.findIndex((l) => l.startsWith("["));
  return (end < 0 ? after : after.slice(0, end)).flatMap((l) => {
    const m = /^"?([\w:@/.-]+)"?\s*=\s*(?:\[\s*)?(?:\{[^}]*version\s*=\s*)?"([^"]+)"/.exec(l);
    return m === null ? [] : [{ name: m[1] ?? "", version: m[2] ?? "" }];
  });
}

async function toolchainIn(clone: string): Promise<Detected["toolchain"]> {
  for (const t of TOOLCHAIN_FILES) {
    const text = await textOf(join(clone, t.file));
    if (text !== "") {
      return { file: t.file, manager: t.manager, tools: toolsOf(t.file, text) };
    }
  }
  return "none";
}

// projectName : the factory's name for the project: the clone folder's name, made plain. Pure.
export function projectName(clone: string): string {
  const plain = basename(clone)
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .replace(/^[^A-Za-z0-9]+/, "");
  return plain === "" ? "project" : plain.slice(0, 100);
}

// detect : everything init reads from the clone that holds `dir`
export async function detect(dir: string, env: NodeJS.ProcessEnv): Promise<Result<Detected>> {
  const clone = await cloneRoot(dir, env);
  if (clone.kind === "failed") {
    return clone;
  }
  const remote = await remoteOf(clone.value, env);
  if (remote.kind === "failed") {
    return remote;
  }
  const host = hostOf(remote.value.host);
  return {
    kind: "ok",
    value: {
      clone: clone.value,
      name: projectName(clone.value),
      host: host.kind,
      hostName: host.name,
      project: remote.value.path,
      builds: await buildsIn(clone.value),
      testFiles: await testFilesIn(clone.value),
      integrationTests: await integrationTestsIn(clone.value),
      oneWayDoor: await migrationsIn(clone.value),
      ci: await ciIn(clone.value),
      toolchain: await toolchainIn(clone.value),
    },
  };
}
