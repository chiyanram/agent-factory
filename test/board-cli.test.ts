import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { approve } from "../src/core/approval.js";
import { start } from "../src/core/start.js";
import { specHash } from "../src/core/spec.js";
import { NO_CAPS } from "../src/core/dispatch/caps.js";
import { record } from "../src/core/dispatch/records.js";
import { STEPS_TODAY } from "../src/core/dispatch/steps.js";
import { decideAll, type Decided, type TickSetup } from "../src/core/dispatch/tick.js";
import { FORGE_OPS } from "../src/core/forge/ops.js";
import type { Changes, Forge } from "../src/core/forge/types.js";
import { NO_NOTIFY } from "../src/core/notify.js";
import { boardCommand, boardPass, readOnly } from "../src/board-cli.js";
import { tempDir } from "./temp.js";

// agent-factory board reads what a pass would decide, and can write nothing: no forge write, no record line, no lock
// (#487 AC-5; the coordinator runs it with no prompt).

const H = "1".repeat(40);
const NOW = Date.parse("2026-11-13T12:00:00Z");
const SPEC = [
  "# PROJ-1: x",
  "",
  "## Intent",
  "",
  "x",
  "",
  "## Acceptance criteria",
  "",
  "1. y",
  "",
  "## Design",
  "",
  "none",
  "",
  "## Lane",
  "",
  "feature",
  "",
].join("\n");

let home = "";
beforeEach(() => {
  home = tempDir("factory-board-");
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

// a git host that answers poll from `changes`, and keeps every write op it is asked for
function recording(changes: Changes, writes: string[]): Forge {
  const read = async () => ({ kind: "failed" as const, reason: "not read in this test" });
  const wrote = (op: string) => async () => {
    writes.push(op);
    return { kind: "ok" as const };
  };
  return {
    name: "github",
    mark: "#",
    me: async () => ({ kind: "ok", value: "ram" }),
    change: read,
    landed: read,
    defaultBranch: read,
    branchExists: async () => ({ kind: "ok", value: false }),
    branchState: async () => ({ kind: "ok", value: "none" }),
    issueState: async () => ({ kind: "ok", value: "open" }),
    issueBody: read,
    notes: read,
    ciConfig: read,
    claimed: read,
    changes: async () => ({ kind: "ok", value: changes }),
    failedJobs: read,
    addLabel: wrote("addLabel"),
    removeLabel: wrote("removeLabel"),
    note: wrote("note"),
    setBody: wrote("setBody"),
    setIssueBody: wrote("setIssueBody"),
    lineFinding: wrote("lineFinding"),
    status: wrote("status"),
    openChange: async () => {
      writes.push("openChange");
      return { kind: "ok", value: 1 };
    },
  };
}

function setup(forge: Forge, log: string[]): TickSetup {
  return {
    home,
    project: "ledger",
    gate: "forge-ci",
    forge,
    label: "agent::claimed",
    steps: STEPS_TODAY,
    now: () => NOW,
    quietMinutes: 30,
    caps: NO_CAPS,
    pollMinutes: 5,
    repo: "o/ledger",
    notify: NO_NOTIFY,
    dryRun: false,
    log: (l) => log.push(l),
    // a feature with no design review, so an approved ticket goes straight to its writer
    lanes: [{ name: "feature", approval: true, lenses: 3, designReview: false, testFirst: false }],
  };
}

async function approved(ticket: string): Promise<void> {
  const where = { home, project: "ledger", ticket };
  expect(
    (await start({ where, by: "ram", via: "terminal", at: "2026-11-13T07:00:00Z", branch: "absent", confirmed: false }))
      .kind,
  ).toBe("started");
  mkdirSync(join(home, "specs", "ledger", ticket), { recursive: true });
  const text = SPEC.replace("PROJ-1", ticket);
  writeFileSync(join(home, "specs", "ledger", ticket, "spec.md"), text);
  expect((await approve({ where, seenHash: specHash(text), by: "mo", at: "2026-11-13T08:00:00Z" })).kind).toBe(
    "approved",
  );
}

function isCall(value: unknown): value is (input: unknown) => Promise<unknown> {
  return typeof value === "function";
}

// every file under the home, with its bytes
function snapshot(): ReadonlyMap<string, string> {
  const files = readdirSync(home, { recursive: true, withFileTypes: true }).filter((d) => d.isFile());
  return new Map(
    files.map((d) => [relative(home, join(d.parentPath, d.name)), readFileSync(join(d.parentPath, d.name), "utf8")]),
  );
}

describe("the board writes nothing (#487 AC-5)", () => {
  it("refuses every write op of the git host seam, and passes reads through", async () => {
    const writes: string[] = [];
    const forge = readOnly(recording({ team: [], open: [], merged: [] }, writes));
    const writeOps = Object.entries(FORGE_OPS).flatMap(([op, kind]) => (kind === "forge.write" ? [op] : []));
    expect(writeOps.length).toBeGreaterThanOrEqual(8);
    const answers = new Map<string, unknown>();
    for (const op of writeOps) {
      const call: unknown = Reflect.get(forge, op);
      answers.set(op, isCall(call) ? await call({}) : "not a function");
    }
    const refused = { kind: "failed", reason: "agent-factory board writes nothing to the git host" };
    expect(answers).toEqual(new Map(writeOps.map((op) => [op, refused])));
    expect(writes).toEqual([]);
    expect(await forge.me()).toEqual({ kind: "ok", value: "ram" });
  });

  it("over tickets a pass would act on, shows them and makes no forge write, no record line and no lock", async () => {
    // PROJ-1: approved, no PR (a pass would run the writer); PROJ-2: a green gate not yet pinged (a pass would note
    // and ping); PROJ-9: merged and still claimed (a pass would remove the label)
    await approved("PROJ-1");
    await approved("PROJ-2");
    const at = { home, project: "ledger", ticket: "PROJ-2" };
    await record({
      where: at,
      event: {
        at: "2026-11-13T11:00:00Z",
        kind: "writer-ended",
        mode: "cleanup",
        head: H,
        outcome: "done",
        patch: "p",
        evidence: [],
        hung: false,
      },
    });
    await record({
      where: at,
      event: { at: "2026-11-13T11:10:00Z", kind: "ready-ended", head: H, passed: true, why: "" },
    });
    await record({ where: at, event: { at: "2026-11-13T11:20:00Z", kind: "review-ended", head: H, actOn: 0 } });
    const open = {
      number: 14,
      branch: "factory/PROJ-2",
      fork: false,
      head: H,
      draft: true,
      labels: ["agent::claimed"],
      pipeline: { kind: "success" as const },
      mergeable: "clean" as const,
      comments: [],
    };
    const changes: Changes = { team: [], open: [open], merged: [{ number: 9, branch: "factory/PROJ-9", fork: false }] };
    const writes: string[] = [];
    const log: string[] = [];
    const before = snapshot();
    const out: string[] = [];
    const io = {
      home,
      env: { TZ: "UTC" },
      now: () => NOW,
      out: (t: string) => out.push(t),
      err: () => undefined,
      mark: "#",
    };
    const pass = boardPass(setup(recording(changes, writes), log), () => undefined);
    expect(await boardCommand("ledger", false, { ...io, decided: () => decideAll(pass) })).toBe(0);
    const text = out.join("");
    expect(text).toContain("  PROJ-1  no PR  writer (fix)");
    expect(text).toContain("  PROJ-2  #14  ping at 11111111");
    expect(text).not.toContain("PROJ-9");
    expect(writes).toEqual([]);
    expect(snapshot()).toEqual(before);
  });

  it("is a dry run on the read-only git host, with no step and no ping that could act, its log on stderr", async () => {
    const err: string[] = [];
    const writes: string[] = [];
    // a step and a ping that would act, given by the pass's caller: the board's pass keeps neither
    const ran = { kind: "available" as const, run: async () => ({ kind: "failed" as const, reason: "ran" }) };
    const given: TickSetup = {
      ...setup(recording({ team: [], open: [], merged: [] }, writes), []),
      dryRun: false,
      steps: { ...STEPS_TODAY, writer: ran },
      notify: async () => ({ kind: "ok" }),
    };
    const pass = boardPass(given, (t) => err.push(t));
    expect([pass.dryRun, pass.steps, pass.notify]).toEqual([true, STEPS_TODAY, NO_NOTIFY]);
    expect(await pass.forge.addLabel({ number: 1, label: "x" })).toMatchObject({ kind: "failed" });
    expect(writes).toEqual([]);
    pass.log("a line");
    expect(err).toEqual(["a line\n"]);
  });
});

describe("agent-factory board (#487 AC-5)", () => {
  it("prints the board, or --json, from the pass's decisions; a pass that cannot read fails", async () => {
    await approved("PROJ-1");
    const out: string[] = [];
    const err: string[] = [];
    const io = (answer: readonly Decided[] | "fail") => ({
      home,
      env: { TZ: "UTC" },
      now: () => NOW,
      out: (t: string) => out.push(t),
      err: (t: string) => err.push(t),
      mark: "!",
      decided: async () =>
        answer === "fail"
          ? { kind: "failed" as const, reason: "the git host did not answer" }
          : { kind: "ok" as const, value: answer },
    });
    const decided = await decideAll(setup(recording({ team: [], open: [], merged: [] }, []), []));
    const value = decided.kind === "ok" ? decided.value : [];
    expect(await boardCommand("ledger", false, io(value))).toBe(0);
    expect(out.join("")).toContain("tickets in flight (times in UTC):\n  PROJ-1  no PR  writer (fix)");
    out.length = 0;
    expect(await boardCommand("ledger", true, io(value))).toBe(0);
    expect(JSON.parse(out.join(""))).toMatchObject([{ ticket: "PROJ-1", change: null }]);
    expect(await boardCommand("ledger", false, io("fail"))).toBe(1);
    expect(err.join("")).toBe("agent-factory board: the git host did not answer\n");
  });
});
