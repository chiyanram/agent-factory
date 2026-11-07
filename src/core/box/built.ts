// built — the project's box image, built on this host and pinned by its local ID (#113 Q1, decided on #30,
// 2026-11-07): `agent-factory box build <project>`. No registry: the image never leaves the host that runs it.
//
//   1 the base image, from the package's images/factory-box, tagged factory-box-base:<12 hex of its ID>
//   2 the project's own layer, if <home>/projects/<p>/box.Dockerfile exists: FROM ${BASE} (that tag), tagged
//     factory-box-<p>:<12 hex of its ID>; with none, the project runs the base
//   3 the image's ID, sha256:<64 hex>, written to <home>/projects/<p>/box.json; the dispatcher runs exactly that ID
//
// The base goes to the project build by tag, because BuildKit cannot build FROM sha256:<id>: it looks the ID up in the
// registry (tried on Docker 29.9, 2026-11-07). The ID still pins what runs. The tags also keep `docker image prune`
// from removing either image. Nothing here throws.

import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Result } from "../forge/api.js";
import { codeOf, prop } from "../dispatch/records.js";
import { attempt } from "../review/safe.js";
import { plainName } from "../spec.js";
import { pinImage } from "./choose.js";
import type { PinnedImage } from "./types.js";
import type { Docker } from "./vm.js";

export const BOX_FILE = "box.json";
export const PROJECT_DOCKERFILE = "box.Dockerfile";

// a read of box.json: the image, none built yet, or a file that is there but refused
export type BoxFileRead =
  | { readonly kind: "ok"; readonly image: PinnedImage }
  | { readonly kind: "missing"; readonly reason: string }
  | { readonly kind: "failed"; readonly reason: string };

export type Built = { readonly base: string; readonly image: string; readonly layer: "project" | "none" };

function projectDir(home: string, project: string): string {
  return join(home, "projects", project);
}

function parsed(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function imageOf(path: string, text: string): BoxFileRead {
  const ref = prop(parsed(text), "image");
  const pin = pinImage(typeof ref === "string" ? ref : "");
  return pin.kind === "pinned" ? { kind: "ok", image: pin } : { kind: "failed", reason: `${path}: ${pin.reason}` };
}

// readBoxFile : the image box build recorded for the project
export async function readBoxFile(input: { readonly home: string; readonly project: string }): Promise<BoxFileRead> {
  const path = join(projectDir(input.home, input.project), BOX_FILE);
  try {
    return imageOf(path, await readFile(path, "utf8"));
  } catch (error) {
    return codeOf(error) === "ENOENT"
      ? { kind: "missing", reason: `${path}: no box image yet; run agent-factory box build ${input.project}` }
      : { kind: "failed", reason: `${path}: cannot read the box file` };
  }
}

// the last FROM of a project Dockerfile must be the base, or the box would lose its engine and its agents
const FROM_BASE = /^FROM\s+\$\{?BASE\}?(\s+AS\s+\S+)?\s*$/i;

// checkLayer : a project Dockerfile builds on the base image. Pure.
export function checkLayer(text: string): Result<string> {
  const froms = text.split("\n").filter((line) => /^FROM\s/i.test(line.trim()));
  const last = froms.at(-1)?.trim() ?? "";
  return FROM_BASE.test(last)
    ? { kind: "ok", value: text }
    : { kind: "failed", reason: `its last FROM must be the base image: ARG BASE, then FROM \${BASE}` };
}

// tagOf : a tag named by the image's own ID, so it can never point at another build. Pure.
export function tagOf(name: string, id: string): string {
  return `${name}:${id.replace(/^sha256:/, "").slice(0, 12)}`;
}

// the base builds from its folder's own Dockerfile; a project layer from its file, on the base's tag
export type Source =
  | { readonly kind: "base"; readonly context: string }
  | { readonly kind: "layer"; readonly context: string; readonly dockerfile: string; readonly base: string };

function sourceArgs(source: Source): readonly string[] {
  switch (source.kind) {
    case "base":
      return [source.context];
    case "layer":
      return ["--file", source.dockerfile, "--build-arg", `BASE=${source.base}`, source.context];
  }
}

// buildArgs : one `docker build` that writes the new image's ID to `idFile`. Pure.
export function buildArgs(idFile: string, source: Source): readonly string[] {
  return ["build", "--quiet", "--iidfile", idFile, ...sourceArgs(source)];
}

type Build = { readonly docker: Docker; readonly scratch: string };

async function docker(d: Docker, args: readonly string[]): Promise<Result<string>> {
  const exit = await d.run({ bin: d.bin, args, stdin: "", env: d.env });
  return exit.code === 0
    ? { kind: "ok", value: exit.stdout }
    : { kind: "failed", reason: `docker ${args[0] ?? ""}: ${exit.stderr.trim()}` };
}

// buildOne : build, read the ID docker wrote, tag the image by it; the ID
async function buildOne(b: Build, name: string, source: Source): Promise<Result<string>> {
  const idFile = join(b.scratch, `${name}.id`);
  const built = await docker(b.docker, buildArgs(idFile, source));
  if (built.kind === "failed") {
    return built;
  }
  const id = await readFile(idFile, "utf8").then(
    (text) => pinImage(text.trim()),
    () => ({ kind: "refused", reason: "docker wrote no image ID" }) as const,
  );
  if (id.kind === "refused") {
    return { kind: "failed", reason: `docker build ${name}: ${id.reason}` };
  }
  const tagged = await docker(b.docker, ["tag", id.ref, tagOf(name, id.ref)]);
  return tagged.kind === "ok" ? { kind: "ok", value: id.ref } : tagged;
}

async function layerText(path: string): Promise<Result<string> | { readonly kind: "none" }> {
  try {
    const text = await readFile(path, "utf8");
    const checked = checkLayer(text);
    return checked.kind === "ok" ? checked : { kind: "failed", reason: `${path}: ${checked.reason}` };
  } catch (error) {
    return codeOf(error) === "ENOENT" ? { kind: "none" } : { kind: "failed", reason: `${path}: cannot read it` };
  }
}

// layered : the project's image on top of the base, or the base itself when the project has no Dockerfile
async function layered(b: Build, dir: string, project: string, base: string): Promise<Result<Built>> {
  const dockerfile = join(dir, PROJECT_DOCKERFILE);
  const text = await layerText(dockerfile);
  if (text.kind !== "ok") {
    return text.kind === "none" ? { kind: "ok", value: { base, image: base, layer: "none" } } : text;
  }
  const image = await buildOne(b, `factory-box-${project}`, {
    kind: "layer",
    context: dir,
    dockerfile,
    base: tagOf("factory-box-base", base),
  });
  return image.kind === "ok" ? { kind: "ok", value: { base, image: image.value, layer: "project" } } : image;
}

async function record(dir: string, built: Built): Promise<Result<Built>> {
  const path = join(dir, BOX_FILE);
  const text = `${JSON.stringify({ image: built.image, base: built.base }, null, 2)}\n`;
  try {
    await writeFile(`${path}.new`, text, { mode: 0o600 });
    await rename(`${path}.new`, path);
    return { kind: "ok", value: built };
  } catch {
    return { kind: "failed", reason: `cannot write ${path}` };
  }
}

async function buildAll(
  b: Build,
  input: { readonly baseDir: string; readonly dir: string; readonly project: string },
): Promise<Result<Built>> {
  const base = await buildOne(b, "factory-box-base", { kind: "base", context: input.baseDir });
  const image = base.kind === "ok" ? await layered(b, input.dir, input.project, base.value) : base;
  return image.kind === "ok" ? record(input.dir, image.value) : image;
}

// buildBox : the base, the project's layer, and box.json, in that order; the first failure stops it
export async function buildBox(input: {
  readonly docker: Docker;
  readonly home: string;
  readonly project: string;
  // the package's images/factory-box folder
  readonly baseDir: string;
}): Promise<Result<Built>> {
  if (!plainName(input.project)) {
    return { kind: "failed", reason: `${JSON.stringify(input.project)} is not a plain project name` };
  }
  const dir = projectDir(input.home, input.project);
  const scratch = await attempt(async () => {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    return mkdtemp(join(tmpdir(), "factory-box-build-"));
  }, `cannot make ${dir} or a scratch folder`);
  if (scratch.kind === "failed") {
    return scratch;
  }
  const result = await buildAll({ docker: input.docker, scratch: scratch.value }, { ...input, dir });
  await rm(scratch.value, { recursive: true, force: true }).catch(() => undefined);
  return result;
}
