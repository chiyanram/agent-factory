// srt-programs — the folders under the person's home that the srt runner allows back, read-only, inside a home it
// otherwise hides (#114): the agent CLI's install and the Node it runs on. Only what lies under the home is listed;
// anything outside it is readable anyway. Nothing here throws.
//
//   claude          the PATH folder that holds it (a link such as ~/.local/bin/claude is read there), and its real
//                   install: the npm package folder holding the real file, or the real file's own folder (the native
//                   installer's ~/.local/share/claude/versions)
//   node            the interpreter claude's first line names (#!/usr/bin/env node: the node on PATH), and the Node
//                   that runs this factory (process.execPath), which the lint hook's agent-factory runs on: each as its
//                   PATH folder and its install root (the folder above bin/), such as ~/.nvm/versions/node/v22.12.0
//   agent-factory   this package's own folder, for the lint and scope hooks (agent/claude-writer.ts)

import { access, constants, open, realpath, stat } from "node:fs/promises";
import { basename, delimiter, dirname, join, sep } from "node:path";
import type { Result } from "../forge/api.js";

export function under(path: string, dir: string): boolean {
  return path === dir || path.startsWith(dir.endsWith(sep) ? dir : `${dir}${sep}`);
}

export function installRoot(file: string): string {
  const dir = dirname(file);
  return basename(dir) === "bin" ? dirname(dir) : dir;
}

export function interpreterOf(shebang: string): string {
  if (!shebang.startsWith("#!")) {
    return "";
  }
  const words = shebang.slice(2).trim().split(/\s+/);
  const [program = "", ...rest] = words;
  if (basename(program) !== "env") {
    return program;
  }
  return rest.find((w) => !w.startsWith("-")) ?? "";
}

export function keptDirs(dirs: readonly string[], home: string): readonly string[] {
  return [...new Set(dirs.filter((d) => d !== home && under(d, home)))].toSorted();
}

async function executable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export async function which(
  name: string,
  path: string,
): Promise<{ readonly found: string; readonly real: string } | "none"> {
  if (name.startsWith("/")) {
    return (await executable(name)) ? { found: name, real: await realpath(name) } : "none";
  }
  for (const dir of path.split(delimiter).filter((d) => d.startsWith("/"))) {
    const found = join(dir, name);
    if (await executable(found)) {
      return { found, real: await realpath(found) };
    }
  }
  return "none";
}

async function headLine(file: string): Promise<string> {
  try {
    const handle = await open(file, "r");
    try {
      const buffer = Buffer.alloc(256);
      const { bytesRead } = await handle.read(buffer, 0, 256, 0);
      return buffer.subarray(0, bytesRead).toString("utf8").split("\n")[0] ?? "";
    } finally {
      await handle.close();
    }
  } catch {
    return "";
  }
}

async function packageDir(file: string, home: string): Promise<string> {
  for (let dir = dirname(file); under(dir, home) && dir !== home; dir = dirname(dir)) {
    if (await isFile(join(dir, "package.json"))) {
      return dir;
    }
  }
  return dirname(file);
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function nodeDirs(interpreter: string, path: string): Promise<readonly string[]> {
  if (interpreter === "") {
    return [];
  }
  if (interpreter.startsWith("/")) {
    const real = await realpath(interpreter).catch(() => interpreter);
    return [dirname(interpreter), installRoot(real)];
  }
  const node = await which(interpreter, path);
  return node === "none" ? [] : [dirname(node.found), installRoot(node.real)];
}

export async function locatePrograms(input: {
  readonly env: NodeJS.ProcessEnv;
  readonly home: string;
  readonly cli: string;
  readonly execPath: string;
  readonly packageDir: string;
}): Promise<Result<readonly string[]>> {
  const path = input.env.PATH ?? "";
  const home = await realpath(input.home).catch(() => input.home);
  const cli = await which(input.cli, path);
  if (cli === "none") {
    return { kind: "failed", reason: `${input.cli} is not on PATH; the srt runner runs the agent CLI from it` };
  }
  const own = await realpath(input.execPath).catch(() => input.execPath);
  const dirs = [
    dirname(cli.found),
    await packageDir(cli.real, home),
    ...(await nodeDirs(interpreterOf(await headLine(cli.real)), path)),
    dirname(input.execPath),
    installRoot(own),
    input.packageDir,
  ];
  return { kind: "ok", value: keptDirs(dirs, home) };
}
