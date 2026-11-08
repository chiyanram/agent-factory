// ci-files — the host push refuses a change to CI config (#115; ADR-0012 S9, Q5a). An agent never changes CI: a CI
// file runs with the project's secrets, and `rules:` is no gate, since GitLab runs the branch's own copy of the CI
// file. A person makes such a change in their own commit.
//
// The CI files are:
//   .github/workflows/** and .github/actions/**
//   .gitlab-ci.yml, or the file the project's settings name instead (Forge.ciConfig)
//   every file those include in this repository (`local:` or a bare path), at any depth, child pipelines too
//     (`trigger: include:`), followed into each included file; a glob follows GitLab's rules (** crosses folders)
//
// The trees are compared, not the commits (protected.ts): a CI file must be the lease's version or the default
// branch's, so a merge or rebase onto the default branch, which only brings its CI, passes. A CI file that does not
// parse, an include it cannot read, or one that names a variable is refused: when in doubt, a person looks.

import { parse } from "yaml";
import type { Result } from "./forge/api.js";
import type { CiConfig } from "./forge/types.js";
import type { Guard } from "./push.js";
import {
  failed,
  git,
  protectedFiles,
  treesOf,
  why,
  type Found,
  type Heads,
  type ProtectedSetup,
  type Tree,
} from "./protected.js";

export const GITLAB_CI = ".gitlab-ci.yml";
const FIXED_DIRS = [".github/workflows/", ".github/actions/"];
const OUTSIDE_KEYS = ["project", "remote", "template", "component"];
// the most CI files followed, so a loop of includes ends; past it, the push is refused
const MAX_FILES = 200;

export type CiSetup = ProtectedSetup & { readonly config: CiConfig };

// --- GitLab includes ---------------------------------------------------------------------------------------------

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringEntry(value: string): Found {
  return /^[a-z]+:\/\//i.test(value) ? { kind: "ok", value: [] } : { kind: "ok", value: [value] };
}

function mapEntry(value: Readonly<Record<string, unknown>>): Found {
  if (typeof value.local === "string") {
    return { kind: "ok", value: [value.local] };
  }
  return OUTSIDE_KEYS.some((k) => k in value)
    ? { kind: "ok", value: [] }
    : failed(`an include it cannot read: ${JSON.stringify(value)}`);
}

// one include entry: a path, a map with local:, or a map that names a file elsewhere
function entryPaths(value: unknown): Found {
  if (typeof value === "string") {
    return stringEntry(value);
  }
  return isRecord(value) ? mapEntry(value) : failed(`an include it cannot read: ${JSON.stringify(value)}`);
}

function all(results: readonly Found[]): Found {
  const bad = results.find((r) => r.kind === "failed");
  return bad ?? { kind: "ok", value: results.flatMap((r) => (r.kind === "ok" ? r.value : [])) };
}

// includeValue : the paths one `include:` value names, as a list or one entry
function includeValue(value: unknown): Found {
  return all((Array.isArray(value) ? value : [value]).map(entryPaths));
}

// walk : every include, at any depth: the top, a job's trigger:, anything
function walk(node: unknown): Found {
  if (Array.isArray(node)) {
    return all(node.map(walk));
  }
  if (!isRecord(node)) {
    return { kind: "ok", value: [] };
  }
  return all(Object.entries(node).map(([key, value]) => (key === "include" ? includeValue(value) : walk(value))));
}

function parsed(text: string): Result<unknown> {
  try {
    return { kind: "ok", value: parse(text, { merge: true, maxAliasCount: 1000 }) as unknown };
  } catch (error) {
    return failed(error instanceof Error ? (error.message.split("\n")[0] ?? "") : "not YAML");
  }
}

// gitlabIncludes : the repository paths a GitLab CI file includes, any depth, without a leading /; a glob stays a glob
export function gitlabIncludes(text: string): Found {
  const doc = parsed(text);
  const paths = doc.kind === "ok" ? walk(doc.value) : doc;
  if (paths.kind === "failed") {
    return paths;
  }
  const variable = paths.value.find((p) => p.includes("$"));
  return variable === undefined
    ? { kind: "ok", value: [...new Set(paths.value.map((p) => p.trim().replace(/^\/+/, "")))] }
    : failed(`an include names a variable, so its file cannot be known: ${variable}`);
}

// --- globs, as GitLab reads them -----------------------------------------------------------------------------------

const GLOB = /[*?[{]/;

// globRegex : ** crosses folders, * and ? stay within one, {a,b} is a choice; everything else is literal
export function globRegex(glob: string): RegExp {
  const parts = glob.split(/(\*\*|\*|\?|\{[^}]*\})/).map((part) => {
    if (part === "**") {
      return ".*";
    }
    if (part === "*") {
      return "[^/]*";
    }
    if (part === "?") {
      return "[^/]";
    }
    return part.startsWith("{") ? `(${part.slice(1, -1).split(",").map(literal).join("|")})` : literal(part);
  });
  return new RegExp(`^${parts.join("")}$`);
}

function literal(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// expand : the files a path names in the tree: itself, or every file its glob matches
function expand(path: string, tree: Tree): readonly string[] {
  if (!GLOB.test(path)) {
    return [path];
  }
  const re = globRegex(path);
  return [...tree.keys()].filter((p) => re.test(p));
}

// --- the CI files of one tree --------------------------------------------------------------------------------------

type Reader = (blob: string) => Promise<Result<string>>;

function blobOf(tree: Tree, path: string): string {
  return (tree.get(path) ?? "").split(" ")[1] ?? "";
}

async function includesOf(tree: Tree, path: string, read: Reader): Promise<Found> {
  const blob = blobOf(tree, path);
  if (blob === "") {
    return { kind: "ok", value: [] };
  }
  const text = await read(blob);
  const found = text.kind === "ok" ? gitlabIncludes(text.value) : text;
  return found.kind === "ok" ? found : failed(`${path}: ${found.reason}`);
}

// followAll : the config file and every file it includes, followed through each included file
async function followAll(tree: Tree, start: readonly string[], read: Reader): Promise<Found> {
  const seen = new Set<string>();
  const queue = [...start];
  for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
    if (seen.size >= MAX_FILES) {
      return failed(`more than ${MAX_FILES} CI files; a person looks`);
    }
    const more = seen.has(path) ? ({ kind: "ok", value: [] } as const) : await includesOf(tree, path, read);
    if (more.kind === "failed") {
      return more;
    }
    seen.add(path);
    queue.push(...more.value.flatMap((p) => expand(p, tree)));
  }
  return { kind: "ok", value: [...seen] };
}

// ciFilesIn : every CI file of one tree
export async function ciFilesIn(tree: Tree, config: CiConfig, read: Reader): Promise<Found> {
  const fixed = [...tree.keys()].filter((p) => FIXED_DIRS.some((d) => p.startsWith(d)));
  const roots = config.kind === "file" ? [GITLAB_CI, config.path] : [GITLAB_CI];
  const followed = await followAll(tree, [...new Set(roots)], read);
  return followed.kind === "ok" ? { kind: "ok", value: [...fixed, ...followed.value] } : followed;
}

// --- the guard -----------------------------------------------------------------------------------------------------

function readerFor(setup: CiSetup, repo: string): Reader {
  return async (blob) => {
    const shown = await git(setup.env, repo, ["cat-file", "blob", blob]);
    return shown.kind === "ok" ? { kind: "ok", value: shown.stdout } : failed(`cannot read a CI file: ${why(shown)}`);
  };
}

async function ciFilesOfAll(setup: CiSetup, h: Heads, repo: string): Promise<Found> {
  const read = readerFor(setup, repo);
  return all(await Promise.all(treesOf(h).map((t) => ciFilesIn(t, setup.config, read))));
}

// noCiFiles : refuses a push that changes a CI file; the work is then blocked with the files named
export function noCiFiles(setup: CiSetup): Guard {
  return protectedFiles(setup, {
    name: "ci",
    what: "the CI files",
    filesIn: (h, repo) => ciFilesOfAll(setup, h, repo),
    refusal: (changed) =>
      `touches CI config (${changed.join(", ")}): an agent never changes CI; a person makes that change in their own commit`,
  });
}
