// status — the box every review posts, made by code and never by a model (ADR-0012 S10; #117; rulebook crq CR3):
//   protected  CI config, code owners and agent instruction files: they change how the change is judged, so the
//              change goes to the human before the gate (needs-human)
//   build      build files and dependency manifests: listed for the human, no label (CR3 lets a patch bump through)
//   new        each dependency the change adds to a manifest it can read (package.json, pom.xml, Gradle, a version
//              catalog, requirements*.txt, go.mod)
// Zero findings is not green: the box goes on every review, and no verdict ever undrafts or approves (#118).

import type { Result } from "../forge/api.js";

export type Box = {
  readonly protected: readonly string[];
  readonly build: readonly string[];
  readonly added: readonly string[];
};

const PROTECTED =
  /^\.github\/workflows\/|^\.github\/actions\/|^\.gitlab-ci\.yml$|(^|\/)CODEOWNERS$|(^|\/)(AGENTS|CLAUDE|CLAUDE\.local)\.md$|(^|\/)\.claude\/|(^|\/)\.agents\//;
const BUILD =
  /(^|\/)(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|pom\.xml|build\.gradle(\.kts)?|settings\.gradle(\.kts)?|gradle\.properties|libs\.versions\.toml|gradle-wrapper\.properties|requirements[^/]*\.txt|pyproject\.toml|go\.mod|go\.sum|Cargo\.toml|Cargo\.lock|Gemfile(\.lock)?|Makefile|Dockerfile)$/;

type Reader = (path: string) => Promise<string>;

function jsonDeps(text: string): readonly string[] {
  try {
    const raw = JSON.parse(text) as unknown;
    return ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"].flatMap((k) => {
      const deps = typeof raw === "object" && raw !== null ? (Reflect.get(raw, k) as unknown) : undefined;
      return typeof deps === "object" && deps !== null ? Object.keys(deps) : [];
    });
  } catch {
    return [];
  }
}

function matches(text: string, pattern: RegExp, group = 1): readonly string[] {
  return Array.from(text.matchAll(pattern), (m) => m[group] ?? "").filter((s) => s !== "");
}

function pomDeps(text: string): readonly string[] {
  return Array.from(
    text.matchAll(
      /<dependency>[\s\S]*?<groupId>\s*([^<\s]+)\s*<\/groupId>[\s\S]*?<artifactId>\s*([^<\s]+)\s*<\/artifactId>/g,
    ),
    (m) => `${m[1] ?? ""}:${m[2] ?? ""}`,
  );
}

const GRADLE =
  /\b(?:implementation|api|compileOnly|runtimeOnly|testImplementation|testRuntimeOnly|annotationProcessor|kapt|ksp)\s*\(?\s*["']([^:"']+:[^:"']+)(?::[^"']*)?["']/g;

// the dependencies one manifest names, by the kind of file it is
const PARSERS: readonly { readonly file: RegExp; readonly read: (text: string) => readonly string[] }[] = [
  { file: /(^|\/)package\.json$/, read: jsonDeps },
  { file: /(^|\/)pom\.xml$/, read: pomDeps },
  { file: /(^|\/)build\.gradle(\.kts)?$/, read: (t) => matches(t, GRADLE) },
  {
    file: /(^|\/)libs\.versions\.toml$/,
    read: (t) => [...matches(t, /module\s*=\s*"([^"]+)"/g), ...matches(t, /=\s*"([^":\s]+:[^":\s]+):[^"]*"/g)],
  },
  { file: /(^|\/)requirements[^/]*\.txt$/, read: (t) => matches(t, /^\s*([A-Za-z0-9_.-]+)/gm) },
  { file: /(^|\/)go\.mod$/, read: (t) => matches(t, /^\s*(?:require\s+)?([a-z0-9.-]+\.[a-z]+\/[^\s]+)\s+v/gm) },
];

async function newIn(path: string, before: Reader, after: Reader): Promise<readonly string[]> {
  const parser = PARSERS.find((p) => p.file.test(path));
  if (parser === undefined) {
    return [];
  }
  const old = new Set(parser.read(await before(path)));
  return [...new Set(parser.read(await after(path)))].filter((d) => !old.has(d)).map((d) => `${d} (${path})`);
}

// statusBox : the box for the files a change touches; `before` and `after` read a file at the merge-base and the head
// ("" when it is not there)
export async function statusBox(input: {
  readonly touched: readonly string[];
  readonly before: Reader;
  readonly after: Reader;
}): Promise<Result<Box>> {
  const build = input.touched.filter((f) => BUILD.test(f));
  const added: string[] = [];
  for (const file of build) {
    added.push(...(await newIn(file, input.before, input.after)));
  }
  return { kind: "ok", value: { protected: input.touched.filter((f) => PROTECTED.test(f)), build, added } };
}
