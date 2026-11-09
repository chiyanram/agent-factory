import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Call, Exit, Runner } from "../src/core/forge/api.js";
import { buildBox, checkLayer, PACKAGE_FILE, readBoxFile, type Packer } from "../src/core/box/built.js";
import { packedOf } from "../src/core/box/pack.js";
import { hostDocker } from "../src/core/box/docker.js";
import { tempDir } from "./temp.js";

const BASE_ID = `sha256:${"a".repeat(64)}`;
const LAYER_ID = `sha256:${"b".repeat(64)}`;
const OK: Exit = { code: 0, stdout: "", stderr: "" };

// a fake docker: a build writes the next ID to its --iidfile; `fail` makes the call whose first word matches fail
function fakeDocker(ids: readonly string[], fail = ""): { readonly calls: Call[]; readonly run: Runner } {
  const calls: Call[] = [];
  const left = [...ids];
  // every build here has --iidfile: its path is the next argument
  const writeId = (args: readonly string[]): void =>
    writeFileSync(args[args.indexOf("--iidfile") + 1] ?? "", `${left.shift() ?? ""}\n`);
  const run: Runner = async (c) => {
    calls.push(c);
    if (c.args[0] === fail) {
      return { code: 1, stdout: "", stderr: `${fail} broke` };
    }
    if (c.args[0] === "build") {
      writeId(c.args);
    }
    return OK;
  };
  return { calls, run };
}

let home = "";
beforeEach(() => {
  home = tempDir("factory-build-");
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const docker = (run: Runner) => ({ run, bin: "docker", env: {} });

// a fake npm pack: writes a tarball into the folder it is given, and records each folder
function packer(packed: string[] = [], fail = ""): Packer {
  return async (dest) => {
    if (fail !== "") {
      return { kind: "failed", reason: fail };
    }
    packed.push(dest);
    const path = join(dest, "chiyanram-agent-factory-0.10.0.tgz");
    writeFileSync(path, "tarball");
    return { kind: "ok", value: path };
  };
}

const build = (run: Runner, project = "ledger", pack: Packer = packer()) =>
  buildBox({ docker: docker(run), home, project, baseDir: "/pkg/images/factory-box", pack });
// a build's scratch folder changes each run: name it <base>
const argv = (calls: readonly Call[]): string[] =>
  calls.map((c) =>
    c.args
      .join(" ")
      .replace(/\S+\.id /, "<id> ")
      .replace(/\S+factory-box-build-\w+\/base/, "<base>"),
  );

describe("box build (#113 Q1)", () => {
  it("builds the base, tags it by its ID, and pins that ID in box.json when the project has no Dockerfile", async () => {
    const fake = fakeDocker([BASE_ID]);
    expect(await build(fake.run)).toEqual({ kind: "ok", value: { base: BASE_ID, image: BASE_ID, layer: "none" } });
    expect(argv(fake.calls)).toEqual([
      "build --quiet --iidfile <id> --file /pkg/images/factory-box/Dockerfile <base>",
      `tag ${BASE_ID} factory-box-base:aaaaaaaaaaaa`,
    ]);
    expect(await readBoxFile({ home, project: "ledger" })).toEqual({
      kind: "ok",
      image: { kind: "pinned", ref: BASE_ID },
    });
  });

  it("builds the project's layer FROM the base's tag, since BuildKit cannot build FROM an ID, and pins the layer", async () => {
    mkdirSync(join(home, "projects", "ledger"), { recursive: true });
    writeFileSync(join(home, "projects", "ledger", "box.Dockerfile"), "ARG BASE\nFROM ${BASE}\nRUN true\n");
    const fake = fakeDocker([BASE_ID, LAYER_ID]);
    expect(await build(fake.run)).toEqual({
      kind: "ok",
      value: { base: BASE_ID, image: LAYER_ID, layer: "project" },
    });
    const dir = join(home, "projects", "ledger");
    expect(argv(fake.calls).slice(2)).toEqual([
      `build --quiet --iidfile <id> --file ${join(dir, "box.Dockerfile")} --build-arg BASE=factory-box-base:aaaaaaaaaaaa ${dir}`,
      `tag ${LAYER_ID} factory-box-ledger:bbbbbbbbbbbb`,
    ]);
    expect(JSON.parse(readFileSync(join(dir, "box.json"), "utf8"))).toEqual({ image: LAYER_ID, base: BASE_ID });
  });

  it("refuses a project Dockerfile that does not end on the base, before it builds it", async () => {
    mkdirSync(join(home, "projects", "ledger"), { recursive: true });
    writeFileSync(join(home, "projects", "ledger", "box.Dockerfile"), "FROM ubuntu:24.04\n");
    const fake = fakeDocker([BASE_ID]);
    expect(await build(fake.run)).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("its last FROM must be the base image"),
    });
    expect(fake.calls.filter((c) => c.args[0] === "build")).toHaveLength(1);
    expect(existsSync(join(home, "projects", "ledger", "box.json"))).toBe(false);
  });

  it("writes no box.json when a build or a tag fails, so the last good image stays pinned", async () => {
    for (const fail of ["build", "tag"]) {
      const fake = fakeDocker([BASE_ID], fail);
      expect(await build(fake.run)).toEqual({ kind: "failed", reason: `docker ${fail}: ${fail} broke` });
    }
    expect(existsSync(join(home, "projects", "ledger", "box.json"))).toBe(false);
  });

  it("refuses an ID docker did not write, and a project name that is not plain", async () => {
    expect(await build(fakeDocker(["not-an-id"]).run)).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("is not pinned"),
    });
    const fake = fakeDocker([BASE_ID]);
    expect(await build(fake.run, "../x")).toMatchObject({ kind: "failed", reason: expect.stringContaining("plain") });
    expect(fake.calls).toEqual([]);
  });
});

describe("this package in the base image (#171 Q3)", () => {
  it("builds the base from a folder that holds this package as agent-factory.tgz, and removes the folder after", async () => {
    const packed: string[] = [];
    const seen: boolean[] = [];
    const fake = fakeDocker([BASE_ID]);
    const run: Runner = async (c) => {
      if (c.args[0] === "build") {
        seen.push(existsSync(join(c.args.at(-1) ?? "", PACKAGE_FILE)));
      }
      return fake.run(c);
    };
    expect(await build(run, "ledger", packer(packed))).toMatchObject({ kind: "ok" });
    expect(seen).toEqual([true]);
    expect(packed).toHaveLength(1);
    expect(existsSync(packed[0] ?? "")).toBe(false);
  });

  it("builds nothing when the package cannot be packed", async () => {
    const fake = fakeDocker([BASE_ID]);
    expect(await build(fake.run, "ledger", packer([], "npm pack: no npm"))).toEqual({
      kind: "failed",
      reason: "npm pack: no npm",
    });
    expect(fake.calls).toEqual([]);
  });

  it("reads the tarball npm wrote, and refuses a package with no built CLI", () => {
    const answer = (paths: readonly string[]) =>
      JSON.stringify([{ filename: "chiyanram-agent-factory-0.10.0.tgz", files: paths.map((path) => ({ path })) }]);
    expect(packedOf(answer(["package.json", "dist/cli.js"]), "/ctx")).toEqual({
      kind: "ok",
      value: "/ctx/chiyanram-agent-factory-0.10.0.tgz",
    });
    expect(packedOf(answer(["package.json"]), "/ctx")).toEqual({
      kind: "failed",
      reason: "the package has no dist/cli.js: run npm run build in it first",
    });
    expect(packedOf("npm WARN", "/ctx")).toEqual({ kind: "failed", reason: "npm pack named no tarball" });
  });
});

describe("checkLayer", () => {
  it("takes a last FROM on the base, in any of its spellings, after other stages", () => {
    for (const text of [
      "ARG BASE\nFROM ${BASE}\n",
      "FROM $BASE AS box\n",
      "FROM node:22 AS n\nARG BASE\nfrom ${BASE}",
    ]) {
      expect(checkLayer(text).kind).toBe("ok");
    }
  });

  it("refuses no FROM, another image last, and the base used only in an early stage", () => {
    for (const text of ["RUN true\n", "FROM ubuntu:24.04\n", "FROM ${BASE} AS b\nFROM ubuntu:24.04\n"]) {
      expect(checkLayer(text).kind).toBe("failed");
    }
  });
});

describe("readBoxFile", () => {
  it("says to run box build when there is none, and refuses an image that is not pinned", async () => {
    expect(await readBoxFile({ home, project: "ledger" })).toMatchObject({
      kind: "missing",
      reason: expect.stringContaining("run agent-factory box build ledger"),
    });
    mkdirSync(join(home, "projects", "ledger"), { recursive: true });
    writeFileSync(join(home, "projects", "ledger", "box.json"), JSON.stringify({ image: "factory-box:latest" }));
    expect((await readBoxFile({ home, project: "ledger" })).kind).toBe("failed");
  });
});

describe("hostDocker", () => {
  it("passes the docker CLI only what it reads to find its engine, never the rest of the host", () => {
    const d = hostDocker({ PATH: "/bin", HOME: "/h", DOCKER_HOST: "unix:///s", GITHUB_TOKEN: "t" }, async () => OK);
    expect(d.bin).toBe("docker");
    expect(d.env).toEqual({ PATH: "/bin", HOME: "/h", DOCKER_HOST: "unix:///s" });
  });
});
