import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { specHash } from "../src/core/spec.js";
import { isVouched, vouch, type Person } from "../src/core/door/person.js";
import { terminalDoor } from "../src/core/door/terminal.js";
import { acceptAs, approveAs, MODEL_RUN_MARKERS, startAs, waiveAs } from "../src/core/door/write.js";
import { tempDir } from "./temp.js";

const SPEC = [
  "# PROJ-1: x",
  "",
  "## Intent",
  "",
  "It works.",
  "",
  "## Acceptance criteria",
  "",
  "1. It answers 200.",
  "",
  "## Design",
  "",
  "none",
  "",
  "## Lane",
  "",
  "bug",
  "",
].join("\n");
const HEAD = "a".repeat(40);
const AT = "2026-11-17T08:00:00Z";
const PLAIN = { FACTORY_HOME: "unused" };

let home = "";
beforeEach(() => {
  home = tempDir("factory-door-");
  mkdirSync(join(home, "specs", "ledger", "PROJ-1"), { recursive: true });
  writeFileSync(join(home, "specs", "ledger", "PROJ-1", "spec.md"), SPEC);
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const where = () => ({ home, project: "ledger", ticket: "PROJ-1" });
const startOf = () => ({ where: where(), at: AT, branch: "absent" as const, confirmed: false });
const approveOf = () => ({ where: where(), seenHash: specHash(SPEC), at: AT });
const waiveOf = () => ({ where: where(), head: HEAD, at: AT });

function vouched(via: string, by: string): Person {
  const person = vouch(via, by);
  if (person.kind !== "person") {
    throw new Error(person.reason);
  }
  return person;
}

async function writeAll(person: Person, env: NodeJS.ProcessEnv) {
  return [
    await startAs(person, startOf(), env),
    await approveAs(person, approveOf(), env),
    await waiveAs(person, waiveOf(), env),
  ];
}

const RECORDS = ["starts", "approvals", "waivers"];
const written = (): readonly string[] => RECORDS.filter((dir) => existsSync(join(home, dir)));

describe("vouch: the person a door verified (#713)", () => {
  it("makes a person with the door's via, and the name as the door gave it", () => {
    const person = vouched("discord", "ram (Ram M)");
    expect(person).toMatchObject({ kind: "person", by: "ram (Ram M)", via: "discord" });
    expect(isVouched(person)).toBe(true);
  });

  it("refuses an empty name, a name with a newline or control character, and an unknown door", () => {
    const unseen = ["\u0007", "\u007f", "\u0085", "\u2028", "\u2029", "\u202e", "\u2066", "\u200f"];
    for (const by of ["", "   ", "ram\nmallory", ...unseen.map((c) => `ram${c}ecila`)]) {
      expect(vouch("terminal", by)).toMatchObject({ kind: "refused" });
    }
    for (const via of ["ui", "web", "", undefined]) {
      expect(vouch(via, "ram")).toMatchObject({ kind: "refused", reason: expect.stringContaining("not a front door") });
    }
  });

  it("a person cannot be changed after a door vouched for them", () => {
    const person = vouched("terminal", "ram");
    expect(Object.isFrozen(person)).toBe(true);
    expect(Reflect.set(person, "by", "mallory")).toBe(false);
    expect(person.by).toBe("ram");
  });
});

describe("the write API fills by and via from the person (#713)", () => {
  it("startAs, approveAs and waiveAs write the person's by and via, as the records have them today", async () => {
    const person = vouched("terminal", "ram");
    const results = await writeAll(person, PLAIN);
    expect(results.map((r) => ("reason" in r ? r.reason : r.kind))).toEqual(["started", "approved", "waived"]);
    const read = (dir: string) => JSON.parse(readFileSync(join(home, dir, "ledger", "PROJ-1.json"), "utf8")) as unknown;
    for (const dir of RECORDS) {
      expect(read(dir)).toMatchObject({ by: "ram", via: "terminal", at: AT });
    }
  });

  it("a request that carries its own by or via does not change who the record names", async () => {
    const person = vouched("discord", "ram");
    const smuggled = { ...startOf(), by: "mallory", via: "terminal" };
    await startAs(person, smuggled, PLAIN);
    const record = JSON.parse(readFileSync(join(home, "starts", "ledger", "PROJ-1.json"), "utf8")) as unknown;
    expect(record).toMatchObject({ by: "ram", via: "discord" });
  });
});

describe("a door cannot claim a person it did not verify (#713)", () => {
  it("refuses a person no door vouched for, and writes no record", async () => {
    const claimed = structuredClone(vouched("discord", "alice"));
    expect(claimed).toMatchObject({ kind: "person", by: "alice", via: "discord" });
    for (const result of await writeAll(claimed, PLAIN)) {
      expect(result).toMatchObject({ kind: "refused", reason: expect.stringContaining("no front door verified") });
    }
    expect(written()).toEqual([]);
  });

  it("refuses a copy of a vouched person, since only the door's own value counts", async () => {
    const copy = { ...vouched("terminal", "ram") };
    expect(await startAs(copy, startOf(), PLAIN)).toMatchObject({ kind: "refused" });
    expect(written()).toEqual([]);
  });
});

describe("a model run cannot write a person's word (#713)", () => {
  it.each(MODEL_RUN_MARKERS)("refuses all three writes when %s is set, and writes no record", async (marker) => {
    const person = vouched("terminal", "ram");
    for (const result of await writeAll(person, { ...PLAIN, [marker]: "1" })) {
      expect(result).toMatchObject({ kind: "refused", reason: expect.stringContaining(marker) });
    }
    expect(written()).toEqual([]);
  });

  it("an empty marker is not set", async () => {
    const person = vouched("terminal", "ram");
    expect(await startAs(person, startOf(), { ...PLAIN, CLAUDECODE: "" })).toMatchObject({ kind: "started" });
  });
});

describe("an onboard acceptance goes through the seam (#727)", () => {
  const BRIEF = "# brief\n";
  const GLOSSARY = "# glossary\n";
  const project = () => join(home, "projects", "ledger");
  const knowledge = () => join(project(), "knowledge.json");
  const acceptOf = () => ({
    home,
    project: "ledger",
    seen: { brief: specHash(BRIEF), glossary: specHash(GLOSSARY) },
    at: AT,
  });
  beforeEach(() => {
    const staged = join(project(), "staged");
    mkdirSync(staged, { recursive: true });
    writeFileSync(join(staged, "brief.md"), BRIEF);
    writeFileSync(join(staged, "glossary.md"), GLOSSARY);
    writeFileSync(join(staged, "cites.json"), "[]\n");
  });

  it("acceptAs writes the record with the person's by and via", async () => {
    expect(await acceptAs(vouched("discord", "ram"), acceptOf(), PLAIN)).toMatchObject({ kind: "ok" });
    expect(JSON.parse(readFileSync(knowledge(), "utf8"))).toMatchObject({ by: "ram", via: "discord", at: AT });
  });

  it("refuses a person no door vouched for, writes no record and leaves the staged files", async () => {
    const claimed = structuredClone(vouched("terminal", "alice"));
    expect(await acceptAs(claimed, acceptOf(), PLAIN)).toMatchObject({
      kind: "refused",
      reason: expect.stringContaining("no front door verified"),
    });
    expect(existsSync(knowledge())).toBe(false);
    expect(existsSync(join(project(), "staged", "brief.md"))).toBe(true);
  });

  it.each(MODEL_RUN_MARKERS)("refuses when %s is set, and writes no record", async (marker) => {
    const result = await acceptAs(vouched("terminal", "ram"), acceptOf(), { ...PLAIN, [marker]: "1" });
    expect(result).toMatchObject({ kind: "refused", reason: expect.stringContaining(marker) });
    expect(existsSync(knowledge())).toBe(false);
  });
});

describe("the terminal door (#713)", () => {
  it("vouches for the OS user, with the terminal as its via", async () => {
    const person = await terminalDoor.verify({ HOME: home, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" });
    expect(person).toMatchObject({ kind: "person", via: "terminal", by: expect.stringMatching(/\S/) });
    expect(isVouched(person)).toBe(true);
  });
});

function sources(dir: string): readonly string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? sources(path) : entry.name.endsWith(".ts") ? [relative(".", path)] : [];
  });
}

function importsOf(text: string): readonly { readonly from: string; readonly values: readonly string[] }[] {
  const named = [...text.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s*from\s*"([^"]+)"/g)].map((m) => ({
    from: String(m[3]),
    values:
      m[1] === undefined
        ? String(m[2])
            .split(",")
            .map((n) => n.trim())
            .filter((n) => n !== "" && !n.startsWith("type "))
            .map((n) => n.split(/\s+as\s+/)[0] ?? n)
        : [],
  }));
  const spaces = [...text.matchAll(/import\s+\*\s+as\s+\w+\s+from\s*"([^"]+)"/g)].map((m) => ({
    from: String(m[1]),
    values: ["*"],
  }));
  return [...named, ...spaces];
}

describe("only the door seam makes a person or writes a person's word (#713)", () => {
  const files = sources("src").map((path) => ({ path, imports: importsOf(readFileSync(path, "utf8")) }));
  const takes = (from: RegExp, names: readonly string[]) =>
    files.flatMap((f) =>
      f.imports.some((i) => from.test(i.from) && i.values.some((v) => v === "*" || names.includes(v))) ? [f.path] : [],
    );

  it("only src/core/door/ takes vouch, or person.ts by value, so no other code makes a person", () => {
    const users = takes(/door\/person\.js$|^\.\/person\.js$/, ["vouch"]);
    expect(users.filter((path) => !path.startsWith(join("src", "core", "door")))).toEqual([]);
  });

  it("only door/write.ts takes start, approve or waive, so every front door goes through the seam", () => {
    const users = takes(/(?:^|\/)(?:start|approval|waiver)\.js$/, ["start", "approve", "waive"]);
    expect(users).toEqual([join("src", "core", "door", "write.ts")]);
  });

  it("only door/write.ts takes an onboard acceptance, so a person accepts a brief only through the seam (#727)", () => {
    expect(takes(/(?:^|\/)home\.js$/, ["accept"])).toEqual([join("src", "core", "door", "write.ts")]);
  });
});
