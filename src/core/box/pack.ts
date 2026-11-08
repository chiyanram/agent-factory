// pack — this package as a tarball, for the base box image (#171 Q3, decided on #30, 2026-11-08): the box runs the
// host's own agent-factory, the version that wrote the writer's settings, and no registry pull. `npm pack` runs with
// --ignore-scripts, so packing never builds: a checkout with no dist/cli.js is refused with what to run.

import { join } from "node:path";
import { prop } from "../dispatch/records.js";
import type { Result, Runner } from "../forge/api.js";
import type { Packer } from "./built.js";

const CLI = "dist/cli.js";

function parsed(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

// packedOf : the tarball npm wrote, from its --json answer, when it holds the CLI. Pure.
export function packedOf(stdout: string, dest: string): Result<string> {
  const all = parsed(stdout);
  const first: unknown = Array.isArray(all) ? all[0] : undefined;
  const filename = prop(first, "filename");
  const files = prop(first, "files");
  const paths = Array.isArray(files) ? files.map((f) => prop(f, "path")) : [];
  if (typeof filename !== "string") {
    return { kind: "failed", reason: "npm pack named no tarball" };
  }
  return paths.includes(CLI)
    ? { kind: "ok", value: join(dest, filename) }
    : { kind: "failed", reason: `the package has no ${CLI}: run npm run build in it first` };
}

// npmPacker : `npm pack` of the package folder, through the host's npm
export function npmPacker(input: {
  readonly run: Runner;
  readonly env: NodeJS.ProcessEnv;
  readonly pkg: string;
}): Packer {
  return async (dest) => {
    const exit = await input.run({
      bin: "npm",
      args: ["pack", "--ignore-scripts", "--json", "--pack-destination", dest, input.pkg],
      stdin: "",
      env: input.env,
    });
    return exit.code === 0
      ? packedOf(exit.stdout, dest)
      : { kind: "failed", reason: `npm pack: ${exit.stderr.trim().split("\n").at(-1) ?? ""}` };
  };
}
