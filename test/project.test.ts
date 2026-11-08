import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readProjectFile } from "../src/core/project.js";
import { commandArgv } from "../src/core/ready/command.js";

let home = "";
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "factory-project-"));
  mkdirSync(join(home, "projects"));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

function write(value: unknown): void {
  writeFileSync(join(home, "projects", "ledger.json"), typeof value === "string" ? value : JSON.stringify(value));
}

const read = () => readProjectFile({ home, project: "ledger" });

describe("readProjectFile (ADR-0014 P3, #91)", () => {
  it("reads a file with only the plugin fields as no ready settings; once one ready field is there, it checks them all", async () => {
    write({ plugins: { notify: "discord" }, policy: {} });
    expect(await read()).toMatchObject({ kind: "missing", reason: expect.stringContaining("no gate yet") });
    write({ plugins: {}, verify: ["make", "verify"] });
    expect(await read()).toMatchObject({ kind: "failed", reason: expect.stringContaining('"gate"') });
    write([]);
    expect(await read()).toMatchObject({ kind: "failed", reason: expect.stringContaining("not a JSON object") });
  });

  it("reads the gate, the verify command and the ready programs; leaves fields it does not know alone", async () => {
    write({
      gate: "local",
      verify: ["make", "verify"],
      ready: { programs: ["make", "./gradlew"], timeoutMinutes: 10 },
      egress: { allow: ["repo.maven.apache.org", "api.anthropic.com", ".gradle.org", "services.gradle.org"] },
      capabilities: { forge: "github" },
    });
    expect(await read()).toEqual({
      kind: "ok",
      value: {
        gate: { kind: "local", verify: ["make", "verify"] },
        ready: { programs: ["make", "./gradlew"], timeoutSeconds: 600 },
        // checked as the proxy will use it: sorted, and a host a dotted entry covers dropped
        egress: { allow: [".gradle.org", "api.anthropic.com", "repo.maven.apache.org"] },
      },
    });
    write({ gate: "forge-ci", ready: { programs: ["make"] } });
    expect(await read()).toEqual({
      kind: "ok",
      value: {
        gate: { kind: "forge-ci" },
        ready: { programs: ["make"], timeoutSeconds: 1800 },
        egress: { allow: [] },
      },
    });
  });

  it("refuses a missing file, and every field that is there but not valid", async () => {
    expect(await read()).toMatchObject({ kind: "missing", reason: expect.stringContaining("no project file") });
    const cases: readonly [unknown, string][] = [
      ["{not json", "is not a JSON object"],
      [{ gate: "ci", ready: { programs: ["make"] } }, '"gate" must be'],
      [{ gate: "local", ready: { programs: ["make"] } }, '"verify" must be'],
      [{ gate: "local", verify: "make verify", ready: { programs: ["make"] } }, '"verify" must be'],
      [{ gate: "local", verify: [], ready: { programs: ["make"] } }, '"verify" must be'],
      [{ gate: "forge-ci" }, '"ready.programs" must list'],
      [{ gate: "forge-ci", ready: { programs: [] } }, '"ready.programs" must list'],
      [{ gate: "forge-ci", ready: { programs: ["make", ""] } }, '"ready.programs" must list'],
      [{ gate: "forge-ci", ready: { programs: ["make"], timeoutMinutes: 0 } }, '"ready.timeoutMinutes"'],
      [{ gate: "forge-ci", ready: { programs: ["make"], timeoutMinutes: 241 } }, '"ready.timeoutMinutes"'],
      [{ gate: "forge-ci", ready: { programs: ["make"] }, egress: ["a.com"] }, '"egress.allow" must list'],
      [{ gate: "forge-ci", ready: { programs: ["make"] }, egress: { allow: [1] } }, '"egress.allow" must list'],
      [{ gate: "forge-ci", ready: { programs: ["make"] }, egress: { allow: [] } }, "the egress allowlist is empty"],
      [{ gate: "forge-ci", ready: { programs: ["make"] }, egress: { allow: ["*.a.com"] } }, "a wildcard"],
    ];
    for (const [value, reason] of cases) {
      write(value);
      expect(await read()).toMatchObject({ kind: "failed", reason: expect.stringContaining(reason) });
    }
    expect(await readProjectFile({ home, project: "../x" })).toMatchObject({ kind: "failed" });
  });
});

describe("commandArgv: an evidence row with no shell (#91)", () => {
  const programs = ["make", "./gradlew", "npm"];

  it("splits on blanks and lets quotes group a word", () => {
    expect(commandArgv("make test", programs)).toEqual({ kind: "ok", value: ["make", "test"] });
    expect(commandArgv("  ./gradlew   test --tests 'Order*Test'  ", programs)).toEqual({
      kind: "ok",
      value: ["./gradlew", "test", "--tests", "Order*Test"],
    });
    expect(commandArgv('npm run "unit tests" -- --grep=""', programs)).toEqual({
      kind: "ok",
      value: ["npm", "run", "unit tests", "--", "--grep="],
    });
  });

  it("refuses what needs a shell, a program not on the list, and what cannot be read", () => {
    const cases: readonly [string, string][] = [
      ["make test && rm -rf /", "needs a shell"],
      ["make test | tee log", "needs a shell"],
      ["make test > out", "needs a shell"],
      ["make $TARGET", "needs a shell"],
      ['make "$(id)"', "needs a shell"],
      ["make `id`", "needs a shell"],
      ["make test*", "needs a shell"],
      ["make test\\ x", "needs a shell"],
      ["make test # all", "needs a shell"],
      ["make test\nrm x", "control character"],
      ["make 'test", "not closed"],
      ["", "empty"],
      ["   ", "empty"],
      ["FOO=1 make test", "not a program"],
      ["bash -c 'make test'", "not a program"],
      ["/usr/bin/make test", "not a program"],
    ];
    for (const [command, reason] of cases) {
      expect(commandArgv(command, programs)).toMatchObject({ kind: "failed", reason: expect.stringContaining(reason) });
    }
  });
});
