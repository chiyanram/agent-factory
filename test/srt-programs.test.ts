// The folders the srt runner allows back inside the hidden home (#114, the operator's choice A): the agent CLI's install
// and the Node it runs on, found from PATH and the CLI's first line, on a planted home. No srt and no real install needed.

import { chmodSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { installRoot, interpreterOf, keptDirs, locatePrograms } from "../src/core/box/srt-programs.js";
import { tempDir } from "./temp.js";

const ROOT = tempDir("srt-programs-");
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

function program(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  chmodSync(path, 0o755);
}

describe("srt programs: the pure parts", () => {
  it("reads a script's interpreter, a program's install root, and keeps only folders inside the home", () => {
    expect(interpreterOf("#!/usr/bin/env node")).toBe("node");
    expect(interpreterOf("#!/usr/bin/env -S node --no-warnings")).toBe("node");
    expect(interpreterOf("#!/opt/node/bin/node")).toBe("/opt/node/bin/node");
    expect(interpreterOf("\u007fELF")).toBe("");
    expect(installRoot("/h/.nvm/versions/node/v22/bin/node")).toBe("/h/.nvm/versions/node/v22");
    expect(installRoot("/h/.local/share/claude/versions/2.0.0")).toBe("/h/.local/share/claude/versions");
    // the home itself, a folder above it, and one outside it are never allowed back
    expect(keptDirs(["/h", "/", "/usr/bin", "/h/.local/bin", "/h/.local/bin", "/hx/bin"], "/h")).toEqual([
      "/h/.local/bin",
    ]);
  });
});

describe("srt programs: an install under the home", () => {
  it("finds the native claude, its link's folder, and the Node on PATH that its first line names", async () => {
    const home = join(ROOT, "native");
    const real = join(home, ".local/share/claude/versions/2.0.0");
    program(real, "#!/usr/bin/env node\n");
    mkdirSync(join(home, ".local/bin"), { recursive: true });
    symlinkSync(real, join(home, ".local/bin/claude"));
    const node = join(home, ".nvm/versions/node/v22.12.0/bin/node");
    program(node, "binary\n");
    const found = await locatePrograms({
      env: { PATH: [join(home, ".local/bin"), dirname(node), "/usr/bin"].join(":") },
      home,
      cli: "claude",
      execPath: "/usr/bin/node",
      packageDir: "/opt/agent-factory",
    });
    expect(found).toEqual({
      kind: "ok",
      value: [
        join(home, ".local/bin"),
        join(home, ".local/share/claude/versions"),
        join(home, ".nvm/versions/node/v22.12.0"),
        join(home, ".nvm/versions/node/v22.12.0/bin"),
      ],
    });
  });

  it("finds an npm-installed claude's package folder, and the factory's own Node and package under the home", async () => {
    const home = join(ROOT, "npm");
    const pkg = join(home, ".npm-global/lib/node_modules/@anthropic-ai/claude-code");
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, "package.json"), "{}\n");
    program(join(pkg, "cli.js"), "#!/usr/bin/env node\n");
    mkdirSync(join(home, ".npm-global/bin"), { recursive: true });
    symlinkSync(join(pkg, "cli.js"), join(home, ".npm-global/bin/claude"));
    const own = join(home, ".volta/tools/node/22/bin/node");
    program(own, "binary\n");
    const found = await locatePrograms({
      env: { PATH: [join(home, ".npm-global/bin"), "/usr/bin"].join(":") },
      home,
      cli: "claude",
      execPath: own,
      packageDir: join(home, "src/agent-factory"),
    });
    expect(found).toMatchObject({
      kind: "ok",
      value: expect.arrayContaining([
        join(home, ".npm-global/bin"),
        pkg,
        join(home, ".volta/tools/node/22"),
        join(home, "src/agent-factory"),
      ]),
    });
  });

  it("refuses when the agent CLI is not on PATH", async () => {
    const found = await locatePrograms({
      env: { PATH: join(ROOT, "empty") },
      home: ROOT,
      cli: "claude",
      execPath: "/usr/bin/node",
      packageDir: "/opt/agent-factory",
    });
    expect(found).toEqual({
      kind: "failed",
      reason: "claude is not on PATH; the srt runner runs the agent CLI from it",
    });
  });
});
