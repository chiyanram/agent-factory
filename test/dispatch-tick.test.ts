import { NO_NOTIFY, type Notify, type Ping } from "../src/core/notify.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { approve } from "../src/core/approval.js";
import { readRecords, record, summarize, tornPath, type Event } from "../src/core/dispatch/records.js";
import type { Evidence } from "../src/core/report.js";
import { waive } from "../src/core/waiver.js";
import { DEFAULT_LANES } from "../src/core/lane.js";
import { NO_CAPS, ticketCapped, type Caps } from "../src/core/dispatch/caps.js";
import { NO_SPEND } from "../src/core/dispatch/spend.js";
import { readSpends } from "../src/core/dispatch/usage.js";
import {
  lock,
  runHoursEnd,
  STEPS_TODAY,
  tick,
  type DesignInput,
  type Steps,
  type TickSetup,
} from "../src/core/dispatch/tick.js";
import { ROUND_CAP } from "../src/core/dispatch/design.js";
import type { Changes, Forge, OpenChange } from "../src/core/forge/types.js";
import { renderPost } from "../src/core/post.js";
import { goAhead, start } from "../src/core/start.js";
import { specHash } from "../src/core/spec.js";
import { issueStore } from "../src/core/spec-store.js";
import { tempDir } from "./temp.js";

const SPEC = (lane: string) =>
  [
    "# PROJ-1: renewals refuse a reserved loan",
    "",
    "## Intent",
    "",
    "A member cannot renew a reserved loan.",
    "",
    "## Acceptance criteria",
    "",
    "1. It answers 409.",
    "",
    "## Design",
    "",
    "none",
    "",
    "## Lane",
    "",
    lane,
    "",
  ].join("\n");

const H = "1".repeat(40);
// the next step every hand-over note names (next-step.ts, #485)
const NEXT =
  "\n\n- next: a person decides; to go on, removes needs-human and STARTs the ticket again (tiny) or approves its spec again: agent-factory start \\| approve";
const NO_DESIGN_REVIEW = DEFAULT_LANES.map((l) => ({
  name: l.name,
  approval: l.approval,
  lenses: l.lenses,
  designReview: false,
}));
// the shared copy of the approval approved() gives (#227)
const COPY = (ticket: string, lane = "feature") =>
  `[coordinator] approved by ram via terminal, spec ${specHash(SPEC(lane).replace("PROJ-1", ticket))}, design none`;
let home = "";

// a ticket a human STARTed and then approved: both records, since nothing runs without a START (#227)
async function approved(ticket = "PROJ-1", lane = "feature"): Promise<void> {
  const started = await start({
    where: { home, project: "ledger", ticket },
    by: "ram",
    via: "terminal",
    at: "2026-11-07T07:00:00Z",
    branch: "absent",
    confirmed: false,
  });
  expect(started.kind).toBe("started");
  mkdirSync(join(home, "specs", "ledger", ticket), { recursive: true });
  const text = SPEC(lane).replace("PROJ-1", ticket);
  writeFileSync(join(home, "specs", "ledger", ticket, "spec.md"), text);
  const done = await approve({
    where: { home, project: "ledger", ticket },
    seenHash: specHash(text),
    by: "ram",
    at: "2026-11-07T08:00:00Z",
  });
  expect(done.kind).toBe("approved");
}

const open = (over: Partial<OpenChange> = {}): OpenChange => ({
  number: 12,
  branch: "factory/PROJ-1",
  fork: false,
  head: H,
  draft: true,
  labels: ["agent::claimed"],
  pipeline: { kind: "success" },
  mergeable: "clean",
  comments: [],
  ...over,
});

const notUsed = async (): Promise<{ readonly kind: "failed"; readonly reason: string }> => ({
  kind: "failed",
  reason: "not used in these tests",
});

// A forge that answers poll from `changes` and records every write.
function forge(changes: Changes, log: string[]): Forge {
  return {
    name: "github",
    mark: "#",
    me: async () => ({ kind: "ok", value: "ram" }),
    change: notUsed,
    defaultBranch: notUsed,
    branchExists: async () => ({ kind: "ok", value: false }),
    branchState: async () => ({ kind: "ok", value: "none" }),
    issueState: async () => ({ kind: "ok", value: "open" }),
    issueBody: notUsed,
    openChange: notUsed,
    notes: notUsed,
    setBody: notUsed,
    lineFinding: notUsed,
    status: notUsed,
    ciConfig: notUsed,
    claimed: notUsed,
    changes: async () => ({ kind: "ok", value: changes }),
    failedJobs: notUsed,
    addLabel: async ({ number, label }) => {
      log.push(`label +${label} #${number}`);
      return { kind: "ok" };
    },
    removeLabel: async ({ number, label }) => {
      log.push(`label -${label} #${number}`);
      return { kind: "ok" };
    },
    note: async ({ number, post }) => {
      const r = renderPost(post);
      log.push(`note #${number} ${r.kind === "ok" ? r.text : r.reason}`);
      return { kind: "ok" };
    },
  };
}

const team = [{ name: "ram", level: "maintainer", bot: false }] as const;

// a notifier that keeps each ping, or fails every one when told to
function pinger(pings: Ping[], fail = false): Notify {
  return async (ping) => {
    pings.push(ping);
    return fail ? { kind: "failed", reason: "discord is down" } : { kind: "ok" };
  };
}

function setup(changes: Changes, log: string[], over: Partial<TickSetup> = {}): TickSetup {
  return {
    home,
    project: "ledger",
    gate: "forge-ci",
    forge: forge(changes, log),
    label: "agent::claimed",
    steps: STEPS_TODAY,
    now: () => Date.parse("2026-11-07T10:00:00Z"),
    quietMinutes: 30,
    caps: NO_CAPS,
    pollMinutes: 5,
    repo: "chiyanram/ledger",
    notify: NO_NOTIFY,
    dryRun: false,
    log: (l) => log.push(`log ${l}`),
    // the tests of the build leave the design review out (a lanes file may): its own tests below use the default lanes
    lanes: NO_DESIGN_REVIEW,
    ...over,
  };
}

beforeEach(() => {
  home = tempDir("factory-dispatch-");
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

// a review round's spend per run (#337): each finder's by its lens, and the verify pass's
const SPLIT = {
  finders: { errors: { usd: 0.1, tokens: 10 }, api: { usd: 0.1, tokens: 15 } },
  verify: { usd: 0.1, tokens: 15 },
};

describe("records", () => {
  const where = () => ({ home, project: "ledger", ticket: "PROJ-1" });

  it("appends one line per event, and counts only what came after the approval", async () => {
    const events: Event[] = [
      { at: "2026-11-06T09:00:00Z", kind: "ready-ended", head: H, passed: false, why: "" },
      { at: "2026-11-07T09:00:00Z", kind: "ready-ended", head: H, passed: false, why: "" },
      { at: "2026-11-07T09:10:00Z", kind: "started", phase: "writer", mode: "ci", head: H },
      {
        at: "2026-11-07T09:20:00Z",
        kind: "writer-ended",
        mode: "ci",
        head: H,
        outcome: "done",
        patch: "p",
        evidence: [],
        hung: false,
      },
    ];
    for (const event of events) {
      expect(await record({ where: where(), event })).toEqual({ kind: "ok" });
    }
    const read = await readRecords(where());
    expect(read.kind === "ok" ? read.value : []).toEqual(events);
    const s = summarize({ events: read.kind === "ok" ? read.value : [], since: "2026-11-07T08:00:00Z" });
    expect(s).toMatchObject({
      readyFailures: 1,
      ciRounds: 1,
      interrupted: { kind: "none" },
      lastAt: "2026-11-07T09:20:00Z",
    });
  });

  it("a start with no end is an interrupted run; a middle line that is not a record fails the read", async () => {
    await record({
      where: where(),
      event: { at: "2026-11-07T09:00:00Z", kind: "started", phase: "review", mode: "none", head: H },
    });
    const read = await readRecords(where());
    expect(
      summarize({ events: read.kind === "ok" ? read.value : [], since: "2026-11-07T08:00:00Z" }).interrupted,
    ).toEqual({ kind: "interrupted", phase: "review", at: "2026-11-07T09:00:00Z" });
    const ping = `${JSON.stringify({ at: "2026-11-07T09:05:00Z", kind: "pinged", head: H })}\n`;
    writeFileSync(join(home, "runs", "ledger", "PROJ-1.jsonl"), `{"kind":"started"}\n${ping}`, { flag: "a" });
    expect(await readRecords(where())).toMatchObject({ kind: "failed", reason: expect.stringContaining("line 2") });
    expect(
      await record({ where: { ...where(), ticket: "../x" }, event: { at: "t", kind: "pinged", head: H } }),
    ).toMatchObject({ kind: "failed" });
  });
});

describe("records: a torn last line (#483)", () => {
  const where = () => ({ home, project: "ledger", ticket: "PROJ-1" });
  const file = () => join(home, "runs", "ledger", "PROJ-1.jsonl");
  const TORN = '{"at":"2026-11-07T09:10:00Z","kind":"writer-en';
  const started = () =>
    record({
      where: where(),
      event: { at: "2026-11-07T09:00:00Z", kind: "started", phase: "writer", mode: "fix", head: H },
    });

  it("the pass sets a write cut short aside, warns once, and reads its run as one that never ended", async () => {
    await started();
    writeFileSync(file(), TORN, { flag: "a" });
    const warned: string[] = [];
    const read = await readRecords(where(), { warn: (l) => warned.push(l), setAside: true });
    expect(read).toMatchObject({ kind: "ok", value: [{ kind: "started" }] });
    expect(warned).toEqual([expect.stringContaining("was torn (a write cut short); it is moved to")]);
    expect(readFileSync(tornPath(file()), "utf8")).toBe(`${TORN}\n`);
    expect(
      summarize({ events: read.kind === "ok" ? read.value : [], since: "2026-11-07T08:00:00Z" }).interrupted,
    ).toEqual({ kind: "interrupted", phase: "writer", at: "2026-11-07T09:00:00Z" });
    // the next line appended starts on its own line, and the record reads clean, with no second warning
    await record({ where: where(), event: { at: "2026-11-07T09:20:00Z", kind: "pinged", head: H } });
    const again = await readRecords(where(), { warn: (l) => warned.push(l), setAside: true });
    expect(again).toMatchObject({ kind: "ok", value: [{ kind: "started" }, { kind: "pinged" }] });
    expect(warned).toHaveLength(1);
  });

  it("any other reader skips it with a warning and writes nothing: usage leaves the file as it was", async () => {
    await started();
    writeFileSync(file(), TORN, { flag: "a" });
    const before = readFileSync(file(), "utf8");
    const warned: string[] = [];
    expect(await readRecords(where(), { warn: (l) => warned.push(l) })).toMatchObject({ kind: "ok" });
    expect(warned).toEqual([expect.stringContaining("it is skipped")]);
    const spends = await readSpends({ home, project: "ledger" });
    expect(spends.problems).toEqual([]);
    expect(readFileSync(file(), "utf8")).toBe(before);
    expect(existsSync(tornPath(file()))).toBe(false);
  });

  it("a complete last line that is not a record fails the read, an unknown kind from a newer engine too", async () => {
    await started();
    writeFileSync(file(), `${JSON.stringify({ at: "2026-11-07T09:10:00Z", kind: "from-a-newer-engine" })}\n`, {
      flag: "a",
    });
    expect(await readRecords(where(), { warn: () => undefined, setAside: true })).toEqual({
      kind: "failed",
      reason: `${file()} line 2 is not a record; fix or remove it`,
    });
    // the same line with no closing newline parses as JSON, so it is no write cut short: it fails, and nothing is cut
    writeFileSync(file(), `{"at":"2026-11-07T09:00:00Z","kind":"from-a-newer-engine"}`);
    expect(await readRecords(where(), { warn: () => undefined, setAside: true })).toMatchObject({ kind: "failed" });
    expect(existsSync(tornPath(file()))).toBe(false);
  });

  it("a valid last line with no closing newline is read, never cut", async () => {
    mkdirSync(join(home, "runs", "ledger"), { recursive: true });
    const line = JSON.stringify({ at: "2026-11-07T09:20:00Z", kind: "pinged", head: H });
    writeFileSync(file(), line);
    expect(await readRecords(where(), { warn: () => undefined, setAside: true })).toMatchObject({
      kind: "ok",
      value: [{ kind: "pinged" }],
    });
    expect(readFileSync(file(), "utf8")).toBe(line);
  });

  it("a torn line in the middle still stops the ticket, naming the line", async () => {
    mkdirSync(join(home, "runs", "ledger"), { recursive: true });
    writeFileSync(file(), `${TORN}\n${JSON.stringify({ at: "2026-11-07T09:20:00Z", kind: "pinged", head: H })}\n`);
    expect(await readRecords(where(), { warn: () => undefined, setAside: true })).toEqual({
      kind: "failed",
      reason: `${file()} line 1 is not a record; fix or remove it`,
    });
  });
});

describe("records: evidence", () => {
  it("keeps the writer's evidence rows; a line from before the rows has none; a bad row fails the read", async () => {
    const file = join(home, "runs", "ledger", "PROJ-1.jsonl");
    mkdirSync(join(home, "runs", "ledger"), { recursive: true });
    writeFileSync(
      file,
      `${JSON.stringify({ at: "2026-11-07T09:00:00Z", kind: "writer-ended", mode: "fix", head: H, outcome: "done", patch: "p" })}\n${JSON.stringify({ at: "2026-11-07T09:01:00Z", kind: "ready-ended", head: H, passed: true })}\n`,
    );
    const read = await readRecords({ home, project: "ledger", ticket: "PROJ-1" });
    expect(read).toMatchObject({ kind: "ok", value: [{ evidence: [] }, { why: "" }] });
    writeFileSync(
      file,
      `${JSON.stringify({ at: "2026-11-07T09:02:00Z", kind: "writer-ended", mode: "fix", head: H, outcome: "done", patch: "p", evidence: [{ criterion: "AC1" }] })}\n${JSON.stringify({ at: "2026-11-07T09:03:00Z", kind: "pinged", head: H })}\n`,
      { flag: "a" },
    );
    expect(await readRecords({ home, project: "ledger", ticket: "PROJ-1" })).toMatchObject({ kind: "failed" });
  });
});

describe("tick", () => {
  it("today the writer's step is not built: the pass says so and records nothing, so the next pass decides the same", async () => {
    await approved();
    const log: string[] = [];
    expect(await tick(setup({ team, open: [], merged: [] }, log))).toMatchObject({ kind: "ok" });
    expect(log).toEqual([
      "log PROJ-1: writer (fix): approved; no run yet",
      "log PROJ-1: unavailable: the writer's box is not built yet (#113)",
    ]);
    expect(await readRecords({ home, project: "ledger", ticket: "PROJ-1" })).toEqual({ kind: "ok", value: [] });
  });

  it("an available writer: claims the change, records the start and the end with its spend; one run per pass", async () => {
    await approved("PROJ-1");
    await approved("PROJ-2");
    const log: string[] = [];
    const runs: string[] = [];
    const steps: Steps = {
      ...STEPS_TODAY,
      writer: {
        kind: "available",
        run: async (input) => (
          runs.push(input.ticket),
          {
            kind: "ok",
            value: {
              head: H,
              outcome: "done",
              patch: "p1",
              evidence: [],
              hung: false,
              spend: { usd: 0.5, tokens: 900 },
            },
          }
        ),
      },
    };
    const changes = {
      team,
      open: [open({ labels: [] }), open({ number: 13, branch: "factory/PROJ-2", labels: [] })],
      merged: [],
    };
    expect(await tick(setup(changes, log, { steps }))).toMatchObject({ kind: "ok" });
    expect(runs).toEqual(["PROJ-1"]);
    expect(log).toContain("label +agent::claimed #12");
    const read = await readRecords({ home, project: "ledger", ticket: "PROJ-1" });
    // the approval's shared copy goes on the PR first, once (#227)
    expect(read.kind === "ok" ? read.value.map((e) => e.kind) : []).toEqual(["shared", "started", "writer-ended"]);
    // every run records its tokens and cost (#131)
    expect(read.kind === "ok" ? read.value.at(-1) : undefined).toMatchObject({ spend: { usd: 0.5, tokens: 900 } });
  });

  // AC-3 of #486 (P13): the answers reach the next run as a typed field, kept first as their own event; the approval holds
  it("after an answered round, the next writer run gets Q1=A, Q2=B, recorded with the spec's hash, under the same approval", async () => {
    await approved();
    const where = { home, project: "ledger", ticket: "PROJ-1" };
    await record({
      where,
      event: { at: "2026-11-07T08:30:00Z", kind: "started", phase: "writer", mode: "fix", head: H, plugins: [] },
    });
    await record({
      where,
      event: {
        at: "2026-11-07T09:00:00Z",
        kind: "writer-ended",
        mode: "fix",
        head: H,
        outcome: "asked",
        patch: "",
        evidence: [],
        hung: false,
      },
    });
    const asked = renderPost({
      seat: "writer",
      title: "OPEN: 2 questions",
      fields: [],
      items: ["1. a? A) x · B) y (recommended)", "2. b? A) x · B) y (recommended)"],
    });
    const comments = [
      { author: { name: "ram" }, body: asked.kind === "ok" ? asked.text : "", at: "2026-11-07T09:01:00Z" },
      { author: { name: "ram" }, body: "1A 2B", at: "2026-11-07T09:30:00Z" },
    ];
    const tasks: unknown[] = [];
    const steps: Steps = {
      ...STEPS_TODAY,
      writer: {
        kind: "available",
        run: async (input) => (
          tasks.push(input.task),
          { kind: "ok", value: { head: H, outcome: "done", patch: "p1", evidence: [], hung: false } }
        ),
      },
    };
    const changes = { team, open: [open({ comments })], merged: [] };
    expect(await tick(setup(changes, [], { steps }))).toMatchObject({ kind: "ok" });
    expect(tasks).toEqual([
      {
        kind: "fix",
        answers: [
          { question: 1, choice: "A", text: "", asked: "a?", chosen: "x" },
          { question: 2, choice: "B", text: "", asked: "b?", chosen: "y" },
        ],
      },
    ]);
    const read = await readRecords(where);
    const events = read.kind === "ok" ? read.value : [];
    expect(events.map((e) => e.kind)).toEqual([
      "started",
      "writer-ended",
      "shared",
      "answered",
      "started",
      "writer-ended",
    ]);
    expect(events.find((e) => e.kind === "answered")).toMatchObject({ spec: specHash(SPEC("feature")) });
    // the approval still holds: the answered run went ahead under it
    expect((await goAhead({ home, project: "ledger", ticket: "PROJ-1" })).kind).not.toBe("stale");
  });

  // #494: the tick reads each blocker's change through the Forge seam
  async function blockedBy(blocker: string): Promise<{ runs: string[]; steps: Steps }> {
    await approved();
    const path = join(home, "specs", "ledger", "PROJ-1", "spec.md");
    const text = `${readFileSync(path, "utf8")}\n## Blocked by\n\n- ${blocker}\n`;
    writeFileSync(path, text);
    await approve({
      where: { home, project: "ledger", ticket: "PROJ-1" },
      seenHash: specHash(text),
      by: "ram",
      at: "2026-11-07T08:30:00Z",
    });
    const runs: string[] = [];
    const steps: Steps = {
      ...STEPS_TODAY,
      writer: {
        kind: "available",
        run: async (input) => (
          runs.push(input.ticket),
          { kind: "ok", value: { head: H, outcome: "done", patch: "p1", evidence: [], hung: false } }
        ),
      },
    };
    return { runs, steps };
  }

  it("AC-2, AC-3, AC-7: holds a first build while its blocker is open, and starts it once the blocker is merged", async () => {
    const { runs, steps } = await blockedBy("PROJ-0");
    const changes = { team, open: [], merged: [] };
    const asked: string[] = [];
    const at = (state: "opened" | "merged", log: string[]): Forge => ({
      ...forge(changes, log),
      branchState: async ({ branch }) => (asked.push(branch), { kind: "ok", value: state }),
      issueState: async () => {
        throw new Error("a ticket that is not a number has no issue to read");
      },
    });
    const held: string[] = [];
    await tick({ ...setup(changes, held, { steps }), forge: at("opened", held) });
    expect(asked).toEqual(["factory/PROJ-0"]);
    expect(runs).toEqual([]);
    expect(held.some((l) => l.includes("blocked by PROJ-0 (open, not merged)"))).toBe(true);
    await tick({ ...setup(changes, [], { steps }), forge: at("merged", []) });
    expect(runs).toEqual(["PROJ-1"]);
  });

  it("AC-9: a blocker issue a person closed as completed lets the build start; one closed with no merge seen goes to a person", async () => {
    const { runs, steps } = await blockedBy("#12");
    const changes = { team, open: [], merged: [] };
    const at = (issue: "completed" | "closed", log: string[]): Forge => ({
      ...forge(changes, log),
      branchState: async () => ({ kind: "ok", value: "none" }),
      issueState: async ({ number }) => (expect(number).toBe(12), { kind: "ok", value: issue }),
    });
    const unseen: string[] = [];
    await tick({ ...setup(changes, unseen, { steps }), forge: at("closed", unseen) });
    expect(runs).toEqual([]);
    expect(unseen.join("\n")).toContain("blocked by 12, closed, no merge seen");
    await tick({ ...setup(changes, [], { steps }), forge: at("completed", []) });
    expect(runs).toEqual(["PROJ-1"]);
  });

  it("a writer run that stops before a change exists: the record, the log and the ping all say why (#62)", async () => {
    await approved();
    const log: string[] = [];
    const pings: Ping[] = [];
    const why = "the run exited 1; the run said: Error: Invalid API key";
    const output = join(home, "runs", "ledger", "PROJ-1", "writer-2026-11-10T08-12-03-764Z.log");
    const steps: Steps = {
      ...STEPS_TODAY,
      writer: {
        kind: "available",
        run: async () => ({
          kind: "ok",
          value: { head: H, outcome: "blocked", patch: "", evidence: [], hung: false, why, output },
        }),
      },
    };
    await tick(setup({ team, open: [], merged: [] }, log, { steps, notify: pinger(pings) }));
    expect(log).toContain(
      `log PROJ-1: writer blocked: ${why}; output kept in ${output}; there is no open change to say so on`,
    );
    expect(log).not.toContain("log PROJ-1: done");
    const read = await readRecords({ home, project: "ledger", ticket: "PROJ-1" });
    expect(read.kind === "ok" ? read.value.at(-1) : undefined).toMatchObject({ kind: "writer-ended", why, output });
    expect(pings).toEqual([
      { kind: "needs-you", ticket: "PROJ-1", change: "none", why: `the writer's run is blocked: ${why}` },
    ]);
  });

  it("reads a writer-ended line written before #62, with no why, as before", async () => {
    const line = {
      at: "2026-11-10T08:12:03.764Z",
      kind: "writer-ended",
      mode: "fix",
      head: H,
      outcome: "blocked",
      patch: "",
      evidence: [],
      hung: false,
    };
    mkdirSync(join(home, "runs", "ledger"), { recursive: true });
    writeFileSync(join(home, "runs", "ledger", "OLD-1.jsonl"), `${JSON.stringify(line)}\n`);
    const read = await readRecords({ home, project: "ledger", ticket: "OLD-1" });
    expect(read).toEqual({ kind: "ok", value: [line] });
    writeFileSync(
      join(home, "runs", "ledger", "OLD-2.jsonl"),
      `${JSON.stringify({ ...line, why: 7 })}\n${JSON.stringify(line)}\n`,
    );
    expect(await readRecords({ home, project: "ledger", ticket: "OLD-2" })).toMatchObject({ kind: "failed" });
  });

  it("a writer step that fails after the run records what the run spent, and usage and the caps count it (#483)", async () => {
    await approved();
    const steps: Steps = {
      ...STEPS_TODAY,
      writer: {
        kind: "available",
        run: async () => ({ kind: "failed", reason: "the push failed", spend: { usd: 0.3, tokens: 900 } }),
      },
    };
    await tick(setup({ team, open: [], merged: [] }, [], { steps }));
    const read = await readRecords({ home, project: "ledger", ticket: "PROJ-1" });
    expect(read).toMatchObject({
      kind: "ok",
      value: [
        { kind: "started", phase: "writer" },
        { kind: "spent", phase: "writer", spend: { usd: 0.3, tokens: 900 } },
      ],
    });
    const spends = await readSpends({ home, project: "ledger" });
    expect(spends.runs.map((r) => r.spend)).toEqual([{ usd: 0.3, tokens: 900 }]);
    const summary = summarize({ events: read.kind === "ok" ? read.value : [], since: "1970-01-01T00:00:00Z" });
    expect(summary.spent).toEqual({ usd: 0.3, tokens: 900 });
  });

  it("a writer step that fails leaves its start: the next pass hands the ticket to a person", async () => {
    await approved();
    const steps: Steps = {
      ...STEPS_TODAY,
      writer: { kind: "available", run: async () => ({ kind: "failed", reason: "the box died" }) },
    };
    const changes = { team, open: [open({ labels: [] })], merged: [] };
    const first: string[] = [];
    await tick(setup(changes, first, { steps }));
    expect(first).toContain("log PROJ-1: failed: the box died");
    const second: string[] = [];
    await tick(setup(changes, second, { steps }));
    expect(second).toContain("label +needs-human #12");
    expect(second.find((l) => l.startsWith("note #12"))).toMatch(
      /^note #12 \[coordinator\] blocked: the writer run started at .* never ended/,
    );
  });

  it("two failures in a row skip the step until each nextTry (#228)", async () => {
    await approved();
    const H2 = "2".repeat(40);
    const where = { home, project: "ledger", ticket: "PROJ-1" };
    await record({
      where,
      event: {
        at: "2026-11-07T09:00:00Z",
        kind: "writer-ended",
        mode: "cleanup",
        head: H,
        outcome: "done",
        patch: "p1",
        evidence: [],
        hung: false,
      },
    });
    const wrote: string[] = [];
    let head = H;
    const steps: Steps = {
      ...STEPS_TODAY,
      ready: {
        kind: "available",
        run: async () => ({ kind: "ok", value: { passed: false, why: "row 1", human: false } }),
      },
      writer: {
        kind: "available",
        run: async (input) => {
          wrote.push(input.task.kind);
          head = H2;
          return { kind: "ok", value: { head: H2, outcome: "done", patch: "p2", evidence: [], hung: false } };
        },
      },
    };
    const pass = async (time: string) => {
      const changes = { team, open: [open({ head })], merged: [] };
      await tick(setup(changes, [], { steps, now: () => Date.parse(time) }));
    };
    const nextTry = async () => {
      const read = await readRecords(where);
      const last = read.kind === "ok" ? read.value.at(-1) : undefined;
      return last?.kind === "ready-ended" ? last.nextTry : undefined;
    };
    // the first failure: the writer's retry waits 10 s
    await pass("2026-11-07T10:00:00Z");
    expect(await nextTry()).toEqual({ step: "ready", at: "2026-11-07T10:00:10.000Z" });
    await pass("2026-11-07T10:00:09Z");
    expect(wrote).toEqual([]);
    await pass("2026-11-07T10:00:10Z");
    expect(wrote).toEqual(["ready-failed"]);
    // the cleanup run follows the implementer's done run, with no backoff of its own (#236)
    await pass("2026-11-07T10:00:30Z");
    expect(wrote).toEqual(["ready-failed", "cleanup"]);
    // the second failure: 20 s
    await pass("2026-11-07T10:01:00Z");
    expect(await nextTry()).toEqual({ step: "ready", at: "2026-11-07T10:01:20.000Z" });
    await pass("2026-11-07T10:01:19Z");
    expect(wrote).toEqual(["ready-failed", "cleanup"]);
    await pass("2026-11-07T10:01:20Z");
    expect(wrote).toEqual(["ready-failed", "cleanup", "ready-failed"]);
  });

  it("ledger ticket 4 (#444): ready failed, a rework that changed only its rows, a hold a person clears, then the ready check on the new rows", async () => {
    await approved();
    const where = { home, project: "ledger", ticket: "PROJ-1" };
    const grep = [{ criterion: "AC-1: README", command: 'grep -c "records" README.md', result: "1" }];
    const gate = [{ criterion: "AC-1: README", command: "./gradlew check", result: "BUILD SUCCESSFUL" }];
    const lines: readonly Event[] = [
      {
        at: "2026-11-07T09:00:00Z",
        kind: "writer-ended",
        mode: "cleanup",
        head: H,
        outcome: "done",
        patch: "",
        evidence: grep,
        hung: false,
      },
      { at: "2026-11-07T09:01:00Z", kind: "ready-ended", head: H, passed: false, why: "row 1: grep is not allowed" },
      {
        at: "2026-11-07T09:05:00Z",
        kind: "writer-ended",
        mode: "rework",
        head: H,
        outcome: "done",
        patch: "",
        evidence: gate,
        hung: false,
      },
      // what the release before #444 did with it
      { at: "2026-11-07T09:06:00Z", kind: "blocked", why: "the writer's run changed nothing" },
    ];
    for (const event of lines) {
      await record({ where, event });
    }
    const checked: (readonly Evidence[])[] = [];
    const steps: Steps = {
      ...STEPS_TODAY,
      ready: {
        kind: "available",
        run: async (input) => (
          checked.push(input.evidence), { kind: "ok", value: { passed: true, why: "", human: false } }
        ),
      },
    };
    const programs = ["grep", "test", "wc", "ls", "cat", "head", "tail", "git", "./gradlew"];
    const pass = (labels: readonly string[]) =>
      tick(
        setup({ team, open: [open({ head: H, labels })], merged: [] }, [], {
          steps,
          readyPrograms: programs,
          now: () => Date.parse("2026-11-07T10:00:00Z"),
        }),
      );
    // the hold stands while the label is on
    await pass(["needs-human"]);
    expect(checked).toEqual([]);
    // the person removes needs-human: the next pass runs the ready check on the rework's rows, and records the programs
    await pass([]);
    expect(checked).toEqual([gate]);
    const read = await readRecords(where);
    expect(read.kind === "ok" ? read.value.at(-1) : undefined).toMatchObject({
      kind: "ready-ended",
      passed: true,
      programs,
    });
  });

  it("a test check hit goes to a person, never back to the writer; a human's waiver at the head runs it again (#231)", async () => {
    await approved();
    const where = { home, project: "ledger", ticket: "PROJ-1" };
    await record({
      where,
      event: {
        at: "2026-11-07T09:00:00Z",
        kind: "writer-ended",
        mode: "cleanup",
        head: H,
        outcome: "done",
        patch: "p1",
        evidence: [],
        hung: false,
      },
    });
    let human = true;
    const wrote: string[] = [];
    const steps: Steps = {
      ...STEPS_TODAY,
      ready: {
        kind: "available",
        run: async () => ({
          kind: "ok",
          value: human
            ? { passed: false, why: "the floor guard: build.gradle adds a judge file", human: true }
            : { passed: true, why: "", human: false },
        }),
      },
      writer: {
        kind: "available",
        run: async (input) => (wrote.push(input.task.kind), { kind: "failed", reason: "not this time" }),
      },
    };
    const log: string[] = [];
    const pass = (time: string) =>
      tick(setup({ team, open: [open({ head: H })], merged: [] }, log, { steps, now: () => Date.parse(time) }));
    const last = async () => {
      const read = await readRecords(where);
      return read.kind === "ok" ? read.value.at(-1) : undefined;
    };
    await pass("2026-11-07T10:00:00Z");
    expect(await last()).toMatchObject({ kind: "ready-ended", passed: false, human: true });
    expect(await last()).not.toHaveProperty("nextTry");
    await pass("2026-11-07T10:01:00Z");
    expect(await last()).toMatchObject({
      kind: "blocked",
      why: expect.stringContaining("the test checks stopped the change at 11111111: the floor guard: build.gradle"),
    });
    expect(wrote).toEqual([]);
    expect(await waive({ where, head: H, by: "ram", via: "terminal", at: "2026-11-07T10:02:00Z" })).toMatchObject({
      kind: "waived",
    });
    human = false;
    await pass("2026-11-07T10:03:00Z");
    expect(await last()).toMatchObject({ kind: "ready-ended", passed: true, head: H });
    expect(wrote).toEqual([]);
  });

  it("a stale approval releases the claim; a merged change is reconciled; a green gate is pinged once", async () => {
    await approved("PROJ-1");
    writeFileSync(join(home, "specs", "ledger", "PROJ-1", "spec.md"), SPEC("feature").replace("409", "423"));
    await approved("PROJ-3");
    await record({
      where: { home, project: "ledger", ticket: "PROJ-3" },
      event: {
        at: "2026-11-07T09:00:00Z",
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
      where: { home, project: "ledger", ticket: "PROJ-3" },
      event: { at: "2026-11-07T09:05:00Z", kind: "ready-ended", head: H, passed: true, why: "" },
    });
    await record({
      where: { home, project: "ledger", ticket: "PROJ-3" },
      event: { at: "2026-11-07T09:10:00Z", kind: "review-ended", head: H, actOn: 0 },
    });
    const changes = {
      team,
      open: [open(), open({ number: 14, branch: "factory/PROJ-3" })],
      merged: [{ number: 9, branch: "factory/PROJ-9", fork: false }],
    };
    const log: string[] = [];
    const pings: Ping[] = [];
    await tick(setup(changes, log, { notify: pinger(pings) }));
    expect(log).toContain("label -agent::claimed #12");
    expect(log).toContain("label -agent::claimed #9");
    expect(log.filter((l) => l.startsWith("note #14"))).toEqual([
      `note #14 ${COPY("PROJ-3")}`,
      "note #14 [coordinator] ready for you at 11111111: the gate is green; review and merge",
    ]);
    expect(pings).toEqual([{ kind: "ready", ticket: "PROJ-3", change: 14, head: H }]);
    const again: string[] = [];
    await tick(setup(changes, again, { notify: pinger(pings) }));
    expect(again.filter((l) => l.startsWith("note #14"))).toEqual([]);
    // pinged once, as the note
    expect(pings).toHaveLength(1);
  });

  // #485 (#456 decision 3): a red check is a fail, never re-run by the factory; only a person quarantines one
  it("a red head whose every failed job a person quarantined reads as passed and is shown; an expired one blocks", async () => {
    await approved();
    const where = { home, project: "ledger", ticket: "PROJ-1" };
    const events: readonly Event[] = [
      {
        at: "2026-11-07T09:00:00Z",
        kind: "writer-ended",
        mode: "cleanup",
        head: H,
        outcome: "done",
        patch: "p",
        evidence: [],
        hung: false,
      },
      { at: "2026-11-07T09:05:00Z", kind: "ready-ended", head: H, passed: true, why: "" },
      { at: "2026-11-07T09:10:00Z", kind: "review-ended", head: H, actOn: 0 },
    ];
    for (const event of events) {
      await record({ where, event });
    }
    const changes = { team, open: [open({ pipeline: { kind: "failed" } })], merged: [] };
    const red = (log: string[]): Forge => ({
      ...forge(changes, log),
      failedJobs: async () => ({ kind: "ok", value: [{ name: "e2e-firefox", log: { kind: "none", why: "no log" } }] }),
    });
    const entry = { check: "e2e-firefox", owner: "ram", added: "2026-11-06", expires: "2026-11-20", ticket: "#512" };
    const held: string[] = [];
    await tick({ ...setup(changes, held), forge: red(held), quarantine: [entry] });
    expect(held).toContain(
      "log PROJ-1: red, but quarantined by a person: e2e-firefox (owner ram, until 2026-11-20, #512); it does not block",
    );
    // the PR's note says the gate reads green only through the quarantine, naming the check and its expiry
    const note = held.find((l) => l.startsWith("note #12 [coordinator] ready for you")) ?? "";
    expect(note).toContain("the gate is green but for 1 quarantined check(s)");
    expect(note).toContain("- quarantined: e2e-firefox, owner ram, since 2026-11-06, until 2026-11-20, ");
    const expired: string[] = [];
    await tick({
      ...setup(changes, expired),
      forge: red(expired),
      quarantine: [{ ...entry, expires: "2026-11-06" }],
      dryRun: true,
    });
    expect(expired.some((l) => l.includes("quarantined"))).toBe(false);
    expect(expired.some((l) => l.includes("writer"))).toBe(true);
  });

  it("a review round records its Act on count, what it spent (#131) and each lens's unique findings (#237)", async () => {
    await approved();
    const where = { home, project: "ledger", ticket: "PROJ-1" };
    const done = { mode: "cleanup", head: H, outcome: "done", patch: "p", evidence: [], hung: false } as const;
    await record({ where, event: { at: "2026-11-07T09:00:00Z", kind: "writer-ended", ...done } });
    await record({ where, event: { at: "2026-11-07T09:05:00Z", kind: "ready-ended", head: H, passed: true, why: "" } });
    const steps: Steps = {
      ...STEPS_TODAY,
      review: {
        kind: "available",
        run: async () => ({
          kind: "ok",
          value: {
            actOn: 0,
            spend: { usd: 0.3, tokens: 40 },
            split: SPLIT,
            lenses: { errors: 1, api: 0 },
            citesNotFound: 1,
          },
        }),
      },
    };
    expect(await tick(setup({ team, open: [open()], merged: [] }, [], { steps }))).toMatchObject({ kind: "ok" });
    const read = await readRecords(where);
    expect(read.kind === "ok" ? read.value.at(-1) : undefined).toMatchObject({
      kind: "review-ended",
      actOn: 0,
      spend: { usd: 0.3, tokens: 40 },
      split: SPLIT,
      lenses: { errors: 1, api: 0 },
      // the findings the cite check noted (#485)
      citesNotFound: 1,
    });
  });

  it("keeps a run's spend; a line from before #131 has none; a spend that is not two amounts fails the read", async () => {
    const where = { home, project: "ledger", ticket: "PROJ-1" };
    const path = join(home, "runs", "ledger", "PROJ-1.jsonl");
    // a bad line is followed by a good one: only a bad middle line fails the read (a torn last line is set aside, #483)
    const ping = `${JSON.stringify({ at: "2026-11-07T09:30:00Z", kind: "pinged", head: H })}\n`;
    mkdirSync(join(home, "runs", "ledger"), { recursive: true });
    const base = { at: "2026-11-07T09:00:00Z", kind: "review-ended", head: H, actOn: 0 };
    writeFileSync(path, `${JSON.stringify(base)}\n${JSON.stringify({ ...base, spend: { usd: 0.1, tokens: 7 } })}\n`);
    const read = await readRecords(where);
    expect(read.kind === "ok" ? read.value : []).toEqual([base, { ...base, spend: { usd: 0.1, tokens: 7 } }]);
    writeFileSync(path, `${JSON.stringify({ ...base, spend: { usd: -1, tokens: 7 } })}\n${ping}`);
    expect(await readRecords(where)).toMatchObject({ kind: "failed" });
    writeFileSync(path, `${JSON.stringify({ ...base, spend: { usd: 1 } })}\n${ping}`);
    expect(await readRecords(where)).toMatchObject({ kind: "failed" });
    // each lens's unique findings (#237): kept, and a count that is not one fails the read
    writeFileSync(path, `${JSON.stringify({ ...base, lenses: { errors: 2 } })}\n`);
    expect(await readRecords(where)).toEqual({ kind: "ok", value: [{ ...base, lenses: { errors: 2 } }] });
    writeFileSync(path, `${JSON.stringify({ ...base, lenses: { errors: "two" } })}\n${ping}`);
    expect(await readRecords(where)).toMatchObject({ kind: "failed" });
    // the cite check's count (#485): kept; one that is not a whole number fails the read
    writeFileSync(path, `${JSON.stringify({ ...base, citesNotFound: 2 })}\n`);
    expect(await readRecords(where)).toEqual({ kind: "ok", value: [{ ...base, citesNotFound: 2 }] });
    writeFileSync(path, `${JSON.stringify({ ...base, citesNotFound: -1 })}\n${ping}`);
    expect(await readRecords(where)).toMatchObject({ kind: "failed" });
    // the round's spend per run (#337): kept; a split whose finders are not spends by lens fails the read
    writeFileSync(path, `${JSON.stringify({ ...base, split: SPLIT })}\n`);
    expect(await readRecords(where)).toEqual({ kind: "ok", value: [{ ...base, split: SPLIT }] });
    for (const bad of [
      { finders: { errors: { usd: 1 } }, verify: { usd: 0, tokens: 0 } },
      { finders: [], verify: { usd: 0, tokens: 0 } },
      { finders: {} },
    ]) {
      writeFileSync(path, `${JSON.stringify({ ...base, split: bad })}\n${ping}`);
      expect(await readRecords(where)).toMatchObject({ kind: "failed" });
    }
  });

  it("the ready check gets the writer's evidence rows and records its reason; a local gate runs the verifier (#91)", async () => {
    await approved();
    const evidence = [{ criterion: "AC1", command: "make test", result: "passed" }];
    await record({
      where: { home, project: "ledger", ticket: "PROJ-1" },
      event: {
        at: "2026-11-07T09:00:00Z",
        kind: "writer-ended",
        mode: "cleanup",
        head: H,
        outcome: "done",
        patch: "p",
        evidence,
        hung: false,
      },
    });
    const given: unknown[] = [];
    const steps: Steps = {
      ...STEPS_TODAY,
      ready: {
        kind: "available",
        run: async (input) => (
          given.push(input.evidence),
          { kind: "ok", value: { passed: false, why: "row 1 (AC1): make test exited 2", human: false } }
        ),
      },
    };
    const changes = { team, open: [open()], merged: [] };
    await tick(setup(changes, [], { steps }));
    expect(given).toEqual([evidence]);
    const read = await readRecords({ home, project: "ledger", ticket: "PROJ-1" });
    expect(read.kind === "ok" ? read.value.at(-1) : undefined).toMatchObject({
      kind: "ready-ended",
      passed: false,
      why: "row 1 (AC1): make test exited 2",
    });
    // the ready check passed and the review found nothing: with a local gate and no status, the verifier runs
    await record({
      where: { home, project: "ledger", ticket: "PROJ-1" },
      event: { at: "2026-11-07T09:10:00Z", kind: "ready-ended", head: H, passed: true, why: "" },
    });
    await record({
      where: { home, project: "ledger", ticket: "PROJ-1" },
      event: { at: "2026-11-07T09:20:00Z", kind: "review-ended", head: H, actOn: 0 },
    });
    const verified: string[] = [];
    const local: Steps = {
      ...STEPS_TODAY,
      verify: {
        kind: "available",
        run: async (input) => (verified.push(input.head), { kind: "ok", value: { passed: true } }),
      },
    };
    const noCi = { team, open: [open({ pipeline: { kind: "none" } })], merged: [] };
    await tick(setup(noCi, [], { steps: local, gate: "local" }));
    expect(verified).toEqual([H]);
    const after = await readRecords({ home, project: "ledger", ticket: "PROJ-1" });
    expect(after.kind === "ok" ? after.value.slice(-2).map((e) => e.kind) : []).toEqual(["started", "verify-ended"]);
  });

  it("a dry run decides every ticket and acts on none", async () => {
    await approved();
    const log: string[] = [];
    await tick(
      setup({ team, open: [open()], merged: [{ number: 9, branch: "factory/PROJ-9", fork: false }] }, log, {
        dryRun: true,
      }),
    );
    expect(log.every((l) => l.startsWith("log ") && l.endsWith("(dry run)"))).toBe(true);
    expect(log).toHaveLength(2);
  });

  it("a fork's branch named factory/<ticket> is never the ticket's change", async () => {
    await approved();
    const log: string[] = [];
    const steps: Steps = {
      ...STEPS_TODAY,
      writer: {
        kind: "available",
        run: async (input) => (log.push(`writer on ${input.change.kind}`), { kind: "failed", reason: "stop here" }),
      },
    };
    await tick(setup({ team, open: [open({ fork: true, labels: [] })], merged: [] }, log, { steps }));
    expect(log).toContain("writer on none");
    expect(log.some((l) => l.includes("#12"))).toBe(false);
  });

  it("a broken ticket fails on its own; every other ticket is still decided and acted on", async () => {
    await approved("PROJ-1");
    await approved("PROJ-2");
    mkdirSync(join(home, "runs", "ledger"), { recursive: true });
    writeFileSync(
      join(home, "runs", "ledger", "PROJ-1.jsonl"),
      `not a record\n${JSON.stringify({ at: "2026-11-07T09:30:00Z", kind: "pinged", head: H })}\n`,
      { flag: "a" },
    );
    const log: string[] = [];
    const passed = await tick(
      setup({ team, open: [], merged: [{ number: 9, branch: "factory/PROJ-2", fork: false }] }, log),
    );
    expect(log).toContain(
      "log PROJ-1: broken: " +
        join(home, "runs", "ledger", "PROJ-1.jsonl") +
        " line 1 is not a record; fix or remove it",
    );
    expect(log).toContain("label -agent::claimed #9");
    expect(passed.kind === "ok" ? passed.value.some((r) => r.result.kind === "failed") : false).toBe(true);
  });

  it("a stop is handed to a person once: needs-human, the claim released, one note; a person removing the label does not repost it", async () => {
    await approved();
    await record({
      where: { home, project: "ledger", ticket: "PROJ-1" },
      event: {
        at: "2026-11-07T09:00:00Z",
        kind: "writer-ended",
        mode: "fix",
        head: H,
        outcome: "done",
        patch: "",
        evidence: [],
        hung: false,
      },
    });
    const changes = { team, open: [open()], merged: [] };
    const first: string[] = [];
    const pings: Ping[] = [];
    await tick(setup(changes, first, { notify: pinger(pings) }));
    expect(first.filter((l) => !l.startsWith("log"))).toEqual([
      `note #12 ${COPY("PROJ-1")}`,
      "label +needs-human #12",
      "label -agent::claimed #12",
      `note #12 [coordinator] blocked: the writer's run changed nothing${NEXT}`,
    ]);
    expect(pings).toEqual([
      { kind: "needs-you", ticket: "PROJ-1", change: 12, why: "the writer's run changed nothing" },
    ]);
    const second: string[] = [];
    await tick(setup(changes, second, { notify: pinger(pings) }));
    expect(pings).toHaveLength(1);
    expect(second.filter((l) => !l.startsWith("log"))).toEqual([]);
    expect(second.join(" ")).toContain("approve again");
  });

  it("pings when the writer asked or was blocked; a ping that fails is printed and never stops the pass (#119)", async () => {
    await approved();
    const changes = { team, open: [open({ labels: [] })], merged: [] };
    for (const [outcome, kind] of [
      ["asked", "asked"],
      ["blocked", "needs-you"],
    ] as const) {
      const log: string[] = [];
      const pings: Ping[] = [];
      const steps: Steps = {
        ...STEPS_TODAY,
        writer: {
          kind: "available",
          run: async () => ({ kind: "ok", value: { head: H, outcome, patch: "p1", evidence: [], hung: false } }),
        },
      };
      const ran = await tick(setup(changes, log, { steps, notify: pinger(pings, true) }));
      expect(ran).toMatchObject({ kind: "ok" });
      expect(pings.map((p) => p.kind)).toEqual([kind]);
      expect(log.join("\n")).toContain(
        "PROJ-1: the ping did not go out (the forge note is the record): discord is down",
      );
      rmSync(join(home, "runs"), { recursive: true, force: true });
    }
  });

  it("forge-only actions come before the one run, so no ping waits behind an hour-long writer", async () => {
    await approved("PROJ-1");
    await approved("PROJ-3");
    for (const event of [
      {
        at: "2026-11-07T09:00:00Z",
        kind: "writer-ended",
        mode: "fix",
        head: H,
        outcome: "done",
        patch: "p",
        evidence: [],
        hung: false,
      },
      { at: "2026-11-07T09:05:00Z", kind: "ready-ended", head: H, passed: true, why: "" },
      { at: "2026-11-07T09:10:00Z", kind: "review-ended", head: H, actOn: 0 },
    ] as const) {
      await record({ where: { home, project: "ledger", ticket: "PROJ-3" }, event });
    }
    const log: string[] = [];
    const steps: Steps = {
      ...STEPS_TODAY,
      writer: {
        kind: "available",
        run: async () => (
          log.push("writer runs"),
          { kind: "ok", value: { head: H, outcome: "done", patch: "p1", evidence: [], hung: false } }
        ),
      },
    };
    await tick(
      setup({ team, open: [open({ labels: [] }), open({ number: 14, branch: "factory/PROJ-3" })], merged: [] }, log, {
        steps,
      }),
    );
    expect(log.findIndex((l) => l.startsWith("note #14"))).toBeLessThan(log.indexOf("writer runs"));
  });

  it("a lock just made and not yet written is busy, and a pass never removes a lock that is not its own", async () => {
    mkdirSync(join(home, "runs", "ledger"), { recursive: true });
    writeFileSync(join(home, "runs", "ledger", ".lock"), "");
    expect(await lock({ home, project: "ledger" })).toMatchObject({ kind: "busy" });
    rmSync(join(home, "runs", "ledger", ".lock"));
    const a = await lock({ home, project: "ledger" });
    expect(a.kind).toBe("held");
    writeFileSync(join(home, "runs", "ledger", ".lock"), `${process.pid}:someone-else`);
    if (a.kind === "held") {
      await a.release();
    }
    expect(readFileSync(join(home, "runs", "ledger", ".lock"), "utf8")).toBe(`${process.pid}:someone-else`);
  });

  it("one pass at a time: a live lock refuses, a dead one is taken over", async () => {
    const held = await lock({ home, project: "ledger" });
    expect(held.kind).toBe("held");
    expect(await tick(setup({ team, open: [], merged: [] }, []))).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("another pass"),
    });
    if (held.kind === "held") {
      await held.release();
    }
    writeFileSync(join(home, "runs", "ledger", ".lock"), "999999999");
    expect(await tick(setup({ team, open: [], merged: [] }, []))).toMatchObject({ kind: "ok" });
    expect(() => readFileSync(join(home, "runs", "ledger", ".lock"))).toThrow(/ENOENT/);
  });
});

describe("START and approval (#227)", () => {
  const where = (ticket = "PROJ-1") => ({ home, project: "ledger", ticket });

  function spec(lane: string, ticket = "PROJ-1"): string {
    const text = SPEC(lane).replace("PROJ-1", ticket);
    mkdirSync(join(home, "specs", "ledger", ticket), { recursive: true });
    writeFileSync(join(home, "specs", "ledger", ticket, "spec.md"), text);
    return text;
  }

  async function started(at: string, ticket = "PROJ-1"): Promise<void> {
    const done = await start({
      where: where(ticket),
      by: "ram",
      via: "terminal",
      at,
      branch: "absent",
      confirmed: false,
    });
    expect(done.kind).toBe("started");
  }

  async function approvedAt(text: string, at: string): Promise<void> {
    const done = await approve({ where: where(), seenHash: specHash(text), by: "ram", at });
    expect(done.kind).toBe("approved");
  }

  const decisions = async (changes: Changes = { team, open: [], merged: [] }): Promise<readonly string[]> => {
    const log: string[] = [];
    await tick(setup(changes, log, { dryRun: true }));
    return log;
  };

  it("a tiny ticket's START lets its build begin; nothing else is needed", async () => {
    spec("tiny");
    expect(await decisions()).toEqual([]);
    await started("2026-11-07T08:00:00Z");
    expect(await decisions()).toEqual(["log PROJ-1: writer (fix): started; no run yet (dry run)"]);
  });

  it("with the issue spec store, the issue's body is the spec: a tiny START builds it, an edit makes the approval stale (#381)", async () => {
    let body = SPEC("tiny").replace("PROJ-1", "2");
    const specs = issueStore({
      open: async () => ({ kind: "ok", value: { issueBody: async () => ({ kind: "ok", value: body }) } }),
      hostProject: "a/ledger",
    });
    const issueTick = async (): Promise<readonly string[]> => {
      const log: string[] = [];
      await tick(setup({ team, open: [], merged: [] }, log, { dryRun: true, specs }));
      return log;
    };
    await started("2026-11-07T08:00:00Z", "2");
    expect(await issueTick()).toEqual(["log 2: writer (fix): started; no run yet (dry run)"]);
    body = SPEC("feature").replace("PROJ-1", "2");
    const done = await approve({
      where: { ...where("2"), store: specs },
      seenHash: specHash(body),
      by: "ram",
      at: "2026-11-07T09:00:00Z",
    });
    expect(done.kind).toBe("approved");
    expect(await goAhead({ ...where("2"), store: specs })).toMatchObject({ kind: "go", said: "approved" });
    body = body.replace("## Intent\n\n", "## Intent\n\nAlso: ");
    expect(await goAhead({ ...where("2"), store: specs })).toMatchObject({ kind: "held" });
  });

  it("the project's process lanes decide: a process that makes tiny need an approval holds a START (#232)", async () => {
    spec("tiny");
    await started("2026-11-07T08:00:00Z");
    const strict = DEFAULT_LANES.map((l) => ({ name: l.name, approval: true, lenses: l.lenses }));
    const log: string[] = [];
    await tick(setup({ team, open: [], merged: [] }, log, { dryRun: true, lanes: strict }));
    expect(log).toEqual([
      "log PROJ-1: wait: the tiny lane needs a human's approval; the ticket has a START only (dry run)",
    ]);
  });

  it("a START in a lane that needs an approval waits for one; the approval lets the build begin", async () => {
    const text = spec("feature");
    await started("2026-11-07T08:00:00Z");
    expect(await decisions()).toEqual([
      "log PROJ-1: wait: the feature lane needs a human's approval; the ticket has a START only (dry run)",
    ]);
    await approvedAt(text, "2026-11-07T09:00:00Z");
    expect(await decisions()).toEqual(["log PROJ-1: writer (fix): approved; no run yet (dry run)"]);
  });

  it("a START whose spec is not written yet waits for the coordinator", async () => {
    await started("2026-11-07T08:00:00Z");
    expect(await decisions()).toEqual([
      "log PROJ-1: wait: the ticket has a START; its spec is not written yet (dry run)",
    ]);
  });

  it("a stale approval stops a START from building in an approval lane, and a bad START record breaks only its ticket", async () => {
    const text = spec("bug");
    await started("2026-11-07T08:00:00Z");
    await approvedAt(text, "2026-11-07T09:00:00Z");
    writeFileSync(join(home, "specs", "ledger", "PROJ-1", "spec.md"), text.replace("409", "423"));
    expect(await decisions()).toEqual([
      "log PROJ-1: wait: the spec or its design changed after its approval (dry run)",
    ]);
    mkdirSync(join(home, "starts", "ledger"), { recursive: true });
    writeFileSync(join(home, "starts", "ledger", "PROJ-2.json"), JSON.stringify({ kind: "start", ticket: "PROJ-2" }));
    expect((await decisions()).find((l) => l.includes("PROJ-2"))).toContain("broken");
  });

  // a ticket handed to a person: the writer's run changed nothing, and its PR carries needs-human
  async function handedOver(): Promise<void> {
    await record({
      where: where(),
      event: {
        at: "2026-11-07T09:30:00Z",
        kind: "writer-ended",
        mode: "fix",
        head: H,
        outcome: "done",
        patch: "",
        evidence: [],
        hung: false,
      },
    });
    await tick(setup({ team, open: [open()], merged: [] }, []));
    const read = await readRecords(where());
    expect(read.kind === "ok" ? read.value.map((e) => e.kind) : []).toContain("blocked");
  }

  const cleared = { team, open: [open({ labels: [] })], merged: [] };

  it("the way back from needs-human, tiny: the label removed, the ticket waits; a new START picks it up", async () => {
    spec("tiny");
    await started("2026-11-07T09:00:00Z");
    await handedOver();
    expect(await decisions({ team, open: [open({ labels: ["needs-human"] })], merged: [] })).toEqual([
      "log PROJ-1: wait: needs-human: a person decides (dry run)",
    ]);
    const held = await decisions(cleared);
    expect(held.join(" ")).toContain("handed to a person earlier: the writer's run changed nothing; START again");
    await started("2026-11-07T09:45:00Z");
    expect(await decisions(cleared)).toEqual(["log PROJ-1: writer (fix): started; no run yet (dry run)"]);
  });

  it("the way back from needs-human, an approval lane: approving again picks it up, with the START it has", async () => {
    const text = spec("feature");
    await started("2026-11-07T08:00:00Z");
    await approvedAt(text, "2026-11-07T09:00:00Z");
    await handedOver();
    expect((await decisions(cleared)).join(" ")).toContain("handed to a person earlier");
    await approvedAt(text, "2026-11-07T09:50:00Z");
    expect(await decisions(cleared)).toEqual(["log PROJ-1: writer (fix): approved; no run yet (dry run)"]);
  });

  it("the way back from needs-human, an approval lane: a new START also restarts the counts, the approval still current", async () => {
    const text = spec("feature");
    await started("2026-11-07T08:00:00Z");
    await approvedAt(text, "2026-11-07T09:00:00Z");
    await handedOver();
    await started("2026-11-07T09:45:00Z");
    expect(await decisions(cleared)).toEqual(["log PROJ-1: writer (fix): approved; no run yet (dry run)"]);
  });

  it("an approval with no START waits: nothing runs without one; the START then lets the build begin", async () => {
    const text = spec("bug");
    await approvedAt(text, "2026-11-07T08:00:00Z");
    expect(await decisions()).toEqual([
      "log PROJ-1: wait: approved, no START: a human STARTs the ticket first (dry run)",
    ]);
    const log: string[] = [];
    const runs: string[] = [];
    const steps: Steps = {
      ...STEPS_TODAY,
      writer: {
        kind: "available",
        run: async (input) => (
          runs.push(input.task.kind),
          { kind: "ok", value: { head: H, outcome: "done", patch: "p1", evidence: [], hung: false } }
        ),
      },
    };
    await tick(setup({ team, open: [open({ labels: [] })], merged: [] }, log, { steps }));
    expect(runs).toEqual([]);
    await started("2026-11-07T09:00:00Z");
    await tick(setup({ team, open: [open({ labels: [] })], merged: [] }, log, { steps }));
    expect(runs).toEqual(["test-first"]);
  });

  it("posts the shared copy of each approval once, through the posting template; a new approval posts again", async () => {
    const text = spec("feature");
    await approvedAt(text, "2026-11-07T08:00:00Z");
    const changes = { team, open: [open({ labels: [] })], merged: [] };
    const notes = async (): Promise<readonly string[]> => {
      const log: string[] = [];
      await tick(setup(changes, log));
      return log.filter((l) => l.startsWith("note"));
    };
    expect(await notes()).toEqual([`note #12 ${COPY("PROJ-1")}`]);
    expect(await notes()).toEqual([]);
    await approvedAt(text, "2026-11-07T09:00:00Z");
    expect(await notes()).toEqual([`note #12 ${COPY("PROJ-1")}`]);
  });

  it("a shared copy that fails to post is printed, and the pass goes on", async () => {
    await approvedAt(spec("feature"), "2026-11-07T08:00:00Z");
    const log: string[] = [];
    const base = setup({ team, open: [open({ labels: [] })], merged: [] }, log);
    const failing: Forge = { ...base.forge, note: async () => ({ kind: "failed", reason: "HTTP 502" }) };
    expect(await tick({ ...base, forge: failing })).toMatchObject({ kind: "ok" });
    expect(log).toContain("log PROJ-1: the shared copy of the approval did not go out: HTTP 502");
    const read = await readRecords(where());
    expect(read.kind === "ok" ? read.value.map((e) => e.kind) : []).not.toContain("shared");
  });
});

describe("the lane set by code, raise only (#230)", () => {
  const where = () => ({ home, project: "ledger", ticket: "PROJ-1" });
  const LONG = "the coordinator raises the spec's lane, and a human approves it";

  function specWith(lane: string, planned: readonly string[] = []): string {
    const text = `${SPEC(lane)}\n## Planned files\n\n${planned.map((p) => `- ${p}`).join("\n")}\n`;
    mkdirSync(join(home, "specs", "ledger", "PROJ-1"), { recursive: true });
    writeFileSync(join(home, "specs", "ledger", "PROJ-1", "spec.md"), text);
    return text;
  }

  function oneWayDoor(globs: readonly string[]): void {
    mkdirSync(join(home, "projects"), { recursive: true });
    writeFileSync(join(home, "projects", "ledger.json"), JSON.stringify({ lanes: { oneWayDoor: globs } }));
  }

  async function startedTiny(): Promise<void> {
    const done = await start({
      where: where(),
      by: "ram",
      via: "terminal",
      at: "2026-11-07T08:00:00Z",
      branch: "absent",
      confirmed: false,
    });
    expect(done.kind).toBe("started");
  }

  const dry = async (changes: Changes = { team, open: [], merged: [] }): Promise<readonly string[]> => {
    const log: string[] = [];
    await tick(setup(changes, log, { dryRun: true }));
    return log;
  };

  it("before the build: a planned file under a one-way-door path raises the lane, and the ticket waits for approval", async () => {
    oneWayDoor(["db/migrations/**"]);
    specWith("tiny", ["db/migrations/V7__loans.sql"]);
    await startedTiny();
    expect(await dry()).toEqual([
      `log PROJ-1: wait: the lane is raised from tiny to one-way door (db/migrations/V7__loans.sql is under a one-way-door path): ${LONG} (dry run)`,
    ]);
    // the writer's own check holds it too
    expect(await goAhead(where())).toMatchObject({
      kind: "held",
      why: expect.stringContaining("raised from tiny to one-way door"),
    });
    // raised in the spec and approved, the build begins
    const text = specWith("one-way door", ["db/migrations/V7__loans.sql"]);
    const done = await approve({ where: where(), seenHash: specHash(text), by: "ram", at: "2026-11-07T09:00:00Z" });
    expect(done.kind).toBe("approved");
    expect(await dry()).toEqual(["log PROJ-1: writer (fix): approved; no run yet (dry run)"]);
  });

  it("a lanes.oneWayDoor key that is not a list breaks the ticket rather than drop the check", async () => {
    mkdirSync(join(home, "projects"), { recursive: true });
    writeFileSync(join(home, "projects", "ledger.json"), JSON.stringify({ lanes: { oneWayDoor: "db/**" } }));
    specWith("tiny", ["db/x.sql"]);
    await startedTiny();
    expect((await dry()).join(" ")).toContain("broken");
  });

  it("the ready check: a tiny spec whose diff changes code is raised to bug, and stops for approval", async () => {
    oneWayDoor(["db/migrations/**"]);
    specWith("tiny");
    await startedTiny();
    await record({
      where: where(),
      event: {
        at: "2026-11-07T09:00:00Z",
        kind: "writer-ended",
        mode: "cleanup",
        head: H,
        outcome: "done",
        patch: "p1",
        evidence: [{ criterion: "AC-1", command: "make test", result: "ok" }],
        hung: false,
      },
    });
    const seen: unknown[] = [];
    const steps: Steps = {
      ...STEPS_TODAY,
      ready: {
        kind: "available",
        run: async (input) => (
          seen.push({ criteria: input.criteria, oneWayDoor: input.oneWayDoor }),
          { kind: "ok", value: { passed: true, why: "", human: false, lane: "bug" } }
        ),
      },
    };
    const changes = { team, open: [open()], merged: [] };
    await tick(setup(changes, [], { steps }));
    expect(seen).toEqual([{ criteria: ["It answers 409."], oneWayDoor: ["db/migrations/**"] }]);
    const read = await readRecords(where());
    expect(read.kind === "ok" ? read.value.at(-1) : undefined).toMatchObject({ kind: "ready-ended", lane: "bug" });
    const log: string[] = [];
    await tick(setup(changes, log, { steps }));
    expect(log).toContain("label +needs-human #12");
    expect(log.find((l) => l.startsWith("note #12"))).toBe(
      `note #12 [coordinator] blocked: the lane is raised from tiny to bug (the ready check read the real diff): ${LONG}${NEXT}`,
    );
  });
});

describe("caps per ticket, per project-day and the window share (#131)", () => {
  const caps = (over: Partial<Caps> = {}): Caps => ({ ...NO_CAPS, ...over });
  const writer = (runs: string[]): Steps => ({
    ...STEPS_TODAY,
    writer: {
      kind: "available",
      run: async (input) => (
        runs.push(input.ticket),
        { kind: "ok", value: { head: H, outcome: "done", patch: "p1", evidence: [], hung: false } }
      ),
    },
  });
  // a review round of PROJ-9 at `at` that spent this much
  const spent = (at: string, usd: number, tokens: number, project = "ledger") =>
    record({
      where: { home, project, ticket: "PROJ-9" },
      event: { at, kind: "review-ended", head: H, actOn: 0, spend: { usd, tokens } },
    });
  const changes = () => ({ team, open: [open({ labels: [] })], merged: [] });

  it("a ticket at its cap goes to needs-human with its spend shown, once, and starts no run", async () => {
    await approved();
    await record({
      where: { home, project: "ledger", ticket: "PROJ-1" },
      event: {
        at: "2026-11-07T09:00:00Z",
        kind: "writer-ended",
        mode: "test-first",
        head: H,
        outcome: "blocked",
        patch: "p",
        evidence: [],
        hung: false,
        spend: { usd: 2.5, tokens: 300 },
      },
    });
    const log: string[] = [];
    const runs: string[] = [];
    const ticket = { usd: 2, tokens: "none" } as const;
    await tick(setup(changes(), log, { steps: writer(runs), caps: caps({ ticket }) }));
    expect(runs).toEqual([]);
    expect(log).toContain("label +needs-human #12");
    expect(log.find((l) => l.startsWith("note #12 [coordinator] blocked"))).toBe(
      `note #12 [coordinator] blocked: the ticket spent $2.50 and 300 tokens since its approval, at its cap of $2 (FACTORY_MAX_USD_TICKET)${NEXT}`,
    );
    // handed over once: a person removing the label does not repost it
    const again: string[] = [];
    await tick(setup(changes(), again, { steps: writer(runs), caps: caps({ ticket }) }));
    expect(again.filter((l) => l.includes("blocked:"))).toEqual([]);
    expect(runs).toEqual([]);
    // under the cap, the same ticket runs
    rmSync(join(home, "runs"), { recursive: true, force: true });
    await tick(setup(changes(), [], { steps: writer(runs), caps: caps({ ticket: { usd: 3, tokens: "none" } }) }));
    expect(runs).toEqual(["PROJ-1"]);
  });

  it("a review round that fails records what it spent, and that spend counts toward the ticket's cap", async () => {
    await approved();
    const where = { home, project: "ledger", ticket: "PROJ-1" };
    const done = { mode: "cleanup", head: H, outcome: "done", patch: "p", evidence: [], hung: false } as const;
    await record({
      where,
      event: { at: "2026-11-07T09:00:00Z", kind: "writer-ended", ...done, spend: { usd: 1, tokens: 100 } },
    });
    await record({ where, event: { at: "2026-11-07T09:05:00Z", kind: "ready-ended", head: H, passed: true, why: "" } });
    const steps: Steps = {
      ...STEPS_TODAY,
      review: {
        kind: "available",
        run: async () => ({
          kind: "failed",
          reason: "the verify pass failed: budget",
          spend: { usd: 1.5, tokens: 200 },
          split: { finders: { errors: { usd: 0.5, tokens: 80 } }, verify: { usd: 1, tokens: 120 } },
        }),
      },
    };
    const ran = await tick(setup({ team, open: [open()], merged: [] }, [], { steps }));
    expect(ran).toMatchObject({
      kind: "ok",
      value: [{ result: { kind: "failed", reason: "the verify pass failed: budget" } }],
    });
    const read = await readRecords(where);
    const events = read.kind === "ok" ? read.value : [];
    // the start stays without an end, so a person looks; the spend is kept beside it
    expect(events.slice(-2)).toMatchObject([
      { kind: "started", phase: "review" },
      {
        kind: "spent",
        phase: "review",
        head: H,
        spend: { usd: 1.5, tokens: 200 },
        split: { finders: { errors: { usd: 0.5, tokens: 80 } }, verify: { usd: 1, tokens: 120 } },
      },
    ]);
    const summary = summarize({ events, since: "2026-11-07T08:00:00Z" });
    expect(summary.spent).toEqual({ usd: 2.5, tokens: 300 });
    expect(summary.interrupted).toMatchObject({ kind: "interrupted", phase: "review" });
    expect(ticketCapped(summary.spent, caps({ ticket: { usd: 2, tokens: "none" } }))).toContain(
      "spent $2.50 and 300 tokens",
    );
    expect(ticketCapped({ usd: 1, tokens: 100 }, caps({ ticket: { usd: 2, tokens: "none" } }))).toBe("");
    // usage counts it too, by run kind: the failed round's spend per run (#337)
    const spends = await readSpends({ home, project: "ledger" });
    expect(spends.runs.map((r) => [r.kind, r.spend])).toEqual([
      ["cleanup", { usd: 1, tokens: 100 }],
      ["finder", { usd: 0.5, tokens: 80 }],
      ["verify pass", { usd: 1, tokens: 120 }],
    ]);
  });

  it("holds a review round whose worst case could pass the ticket's dollar cap, with no start line (#237)", async () => {
    await approved();
    const where = { home, project: "ledger", ticket: "PROJ-1" };
    const done = { mode: "cleanup", head: H, outcome: "done", patch: "p", evidence: [], hung: false } as const;
    await record({
      where,
      event: { at: "2026-11-07T09:00:00Z", kind: "writer-ended", ...done, spend: { usd: 1, tokens: 100 } },
    });
    await record({ where, event: { at: "2026-11-07T09:05:00Z", kind: "ready-ended", head: H, passed: true, why: "" } });
    const rounds: string[] = [];
    const review = (worst: number | "unbounded"): Steps => ({
      ...STEPS_TODAY,
      review: {
        kind: "available",
        worstUsd: async () => ({ kind: "ok", value: worst }),
        run: async (input) => (rounds.push(input.ticket), { kind: "ok", value: { actOn: 0, spend: NO_SPEND } }),
      },
    });
    const ticket = { usd: 3, tokens: "none" } as const;
    // $1 spent of a $3 cap: a worst case of $4 could pass it, so the round is held before its start line
    const held = await tick(
      setup({ team, open: [open()], merged: [] }, [], { steps: review(4), caps: caps({ ticket }) }),
    );
    expect(held).toMatchObject({
      kind: "ok",
      value: [
        {
          held: true,
          result: {
            kind: "unavailable",
            reason: expect.stringContaining("could spend up to $4.00 (every finder it can pick and its verify passes"),
          },
        },
      ],
    });
    expect(rounds).toEqual([]);
    const read = await readRecords(where);
    expect((read.kind === "ok" ? read.value : []).map((e) => e.kind)).not.toContain("started");
    // an unbounded worst case, with no per-run cap, starts the round (overCaps is tested on its own)
    await tick(setup({ team, open: [open()], merged: [] }, [], { steps: review("unbounded"), caps: caps({ ticket }) }));
    expect(rounds).toEqual(["PROJ-1"]);
  });

  it("once a person takes the failed round back, the ticket at its cap goes to needs-human, not to another run", async () => {
    await approved();
    const where = { home, project: "ledger", ticket: "PROJ-1" };
    const done = { mode: "fix", head: H, outcome: "done", patch: "p", evidence: [], hung: false } as const;
    await record({ where, event: { at: "2026-11-07T09:00:00Z", kind: "writer-ended", ...done } });
    await record({ where, event: { at: "2026-11-07T09:05:00Z", kind: "ready-ended", head: H, passed: true, why: "" } });
    await record({
      where,
      event: { at: "2026-11-07T09:10:00Z", kind: "spent", phase: "review", head: H, spend: { usd: 3, tokens: 9 } },
    });
    const log: string[] = [];
    const steps: Steps = {
      ...STEPS_TODAY,
      review: { kind: "available", run: async () => ({ kind: "ok", value: { actOn: 0, spend: NO_SPEND } }) },
    };
    await tick(
      setup({ team, open: [open()], merged: [] }, log, { steps, caps: caps({ ticket: { usd: 2, tokens: "none" } }) }),
    );
    expect(log.find((l) => l.startsWith("note #12 [coordinator] blocked"))).toBe(
      `note #12 [coordinator] blocked: the ticket spent $3.00 and 9 tokens since its approval, at its cap of $2 (FACTORY_MAX_USD_TICKET)${NEXT}`,
    );
  });

  it("a project at its day cap starts no run that day and sends one notice; the next day it runs again", async () => {
    await approved();
    await spent("2026-11-07T01:00:00Z", 1, 10);
    await spent("2026-11-06T23:00:00Z", 50, 10);
    const pings: Ping[] = [];
    const runs: string[] = [];
    const day = { usd: 1, tokens: "none" } as const;
    const pass = async (now: string) => {
      const log: string[] = [];
      const ran = await tick(
        setup(changes(), log, {
          steps: writer(runs),
          caps: caps({ day }),
          notify: pinger(pings),
          now: () => Date.parse(now),
        }),
      );
      return { ran, log };
    };
    const first = await pass("2026-11-07T10:00:00Z");
    expect(runs).toEqual([]);
    expect(first.log).toContain(
      "log no new runs: the project-day cap is reached: today (2026-11-07, UTC) the project spent $1.00 and 10 tokens, at the cap of $1 (FACTORY_MAX_USD_DAY); run `agent-factory dispatch ledger` again tomorrow",
    );
    // held, not failed: the pass exits 0
    expect(first.ran).toMatchObject({ kind: "ok", value: [{ ticket: "PROJ-1", result: { kind: "unavailable" } }] });
    await pass("2026-11-07T11:00:00Z");
    expect(pings).toEqual([
      { kind: "paused", ticket: "PROJ-1", change: 12, why: expect.stringContaining("FACTORY_MAX_USD_DAY") },
    ]);
    await pass("2026-11-08T00:30:00Z");
    expect(runs).toEqual(["PROJ-1"]);
  });

  const two = () => ({
    team,
    open: [open({ labels: [] }), open({ number: 13, branch: "factory/PROJ-2", labels: [] })],
    merged: [],
  });

  it("runs at once: a pass starts up to that many runs, one after another (#299)", async () => {
    await approved("PROJ-1");
    await approved("PROJ-2");
    const runs: string[] = [];
    await tick(setup(two(), [], { steps: writer(runs), caps: caps({ runsAtOnce: 2 }) }));
    expect(runs.toSorted()).toEqual(["PROJ-1", "PROJ-2"]);
  });

  it("runs at once: the day cap is checked again before each run after the first (#299)", async () => {
    await approved("PROJ-1");
    await approved("PROJ-2");
    const runs: string[] = [];
    const steps: Steps = {
      ...STEPS_TODAY,
      writer: {
        kind: "available",
        run: async (input) => (
          runs.push(input.ticket),
          {
            kind: "ok",
            value: { head: H, outcome: "done", patch: "p1", evidence: [], hung: false, spend: { usd: 2, tokens: 5 } },
          }
        ),
      },
    };
    const log: string[] = [];
    const day = { usd: 1, tokens: "none" } as const;
    const ran = await tick(setup(two(), log, { steps, caps: caps({ runsAtOnce: 2, day }) }));
    expect(runs).toHaveLength(1);
    expect(
      log.some((l) =>
        l.startsWith(
          "log no new runs: the project-day cap is reached: today (2026-11-07, UTC) the project spent $2.00",
        ),
      ),
    ).toBe(true);
    expect(ran).toMatchObject({ kind: "ok" });
  });

  it("run hours: a pass outside them starts no run, records it held and says when to run dispatch again; inside them, it runs (#299)", async () => {
    await approved();
    const runs: string[] = [];
    const runHours = { from: 22, to: 6, text: "22-06" };
    const at = (now: string) => {
      const log: string[] = [];
      return {
        log,
        pass: tick(
          setup(changes(), log, { steps: writer(runs), caps: caps({ runHours }), now: () => Date.parse(now) }),
        ),
      };
    };
    const day = at("2026-11-07T10:00:00Z");
    expect(await day.pass).toMatchObject({
      kind: "ok",
      value: [
        {
          ticket: "PROJ-1",
          result: { kind: "unavailable", reason: expect.stringContaining("held: outside the run hours 22-06") },
          held: true,
        },
      ],
    });
    expect(day.log).toContain("log no new runs: outside the run hours 22-06 (UTC, FACTORY_RUN_HOURS)");
    expect(runs).toEqual([]);
    const held = await at("2026-11-07T10:00:00Z").pass;
    const ran = held.kind === "ok" ? held.value : [];
    // the loop ends on this line rather than wait for the hours: no job runs in the background
    expect(runHoursEnd({ project: "ledger", caps: caps({ runHours }) }, ran)).toBe(
      "run hours are 22-06 UTC; run `agent-factory dispatch ledger` again then",
    );
    // nothing is lost: the pass lists the held run, the ticket's records are untouched, and a dispatch inside the hours
    // starts it
    const night = await at("2026-11-07T23:30:00Z").pass;
    expect(runs).toEqual(["PROJ-1"]);
    const nightRan = night.kind === "ok" ? night.value : [];
    expect(runHoursEnd({ project: "ledger", caps: caps({ runHours }) }, nightRan)).toBe("none");
    expect(runHoursEnd({ project: "ledger", caps: NO_CAPS }, ran)).toBe("none");
  });

  it("the token caps count tokens, as on a subscription, and the window share pauses until the window has room", async () => {
    await approved();
    await spent("2026-11-07T06:00:00Z", 0, 700);
    const runs: string[] = [];
    const log: string[] = [];
    const window = { tokens: 500, machineTokens: "none" } as const;
    await tick(setup(changes(), log, { steps: writer(runs), caps: caps({ window }) }));
    expect(runs).toEqual([]);
    expect(log).toContain(
      "log no new runs: the window is full until 11:00 UTC: in the last 5 h the project spent $0.00 and 700 tokens, at the cap of 500 tokens (FACTORY_WINDOW_TOKENS); run `agent-factory dispatch ledger` again then",
    );
    // 5 h after that round the window has room again
    await tick(
      setup(changes(), [], {
        steps: writer(runs),
        caps: caps({ window }),
        now: () => Date.parse("2026-11-07T11:30:00Z"),
      }),
    );
    expect(runs).toEqual(["PROJ-1"]);
  });

  it("the machine's share counts every project on this machine", async () => {
    await approved();
    await spent("2026-11-07T09:00:00Z", 0, 300, "atlas");
    await spent("2026-11-07T09:00:00Z", 0, 300);
    const runs: string[] = [];
    const log: string[] = [];
    const share = (machineTokens: number) => caps({ window: { tokens: "none", machineTokens } });
    await tick(setup(changes(), log, { steps: writer(runs), caps: share(600) }));
    expect(runs).toEqual([]);
    expect(log.join("\n")).toContain("every project on this machine spent $0.00 and 600 tokens");
    await tick(setup(changes(), [], { steps: writer(runs), caps: share(601) }));
    expect(runs).toEqual(["PROJ-1"]);
  });
});

describe("the design review and the cleanup run (#236)", () => {
  const where = () => ({ home, project: "ledger", ticket: "PROJ-1" });
  const CARD = "c".repeat(64);
  const finding = {
    id: "D1",
    source: "design",
    decision: "renewals keep their own table",
    verdict: "conflict",
    file: "src/loans.ts",
    line: 12,
    rule: "SR9",
    severity: "warning",
    grade: "walked",
    finding: "the loans table already holds renewals",
    fix: "reuse the loans table",
  } as const;

  function spec(lane: string): string {
    const text = SPEC(lane);
    mkdirSync(join(home, "specs", "ledger", "PROJ-1"), { recursive: true });
    writeFileSync(join(home, "specs", "ledger", "PROJ-1", "spec.md"), text);
    return text;
  }

  async function started(): Promise<void> {
    const done = await start({
      where: where(),
      by: "ram",
      via: "terminal",
      at: "2026-11-07T08:00:00Z",
      branch: "absent",
      confirmed: false,
    });
    expect(done.kind).toBe("started");
  }

  // fake design runs that keep what they were given
  function designSteps(seen: string[]): Steps {
    return {
      ...STEPS_TODAY,
      designReview: {
        kind: "available",
        run: async (input) => {
          seen.push(`review ${input.spec.slice(0, 8)} ${input.design}`);
          return {
            kind: "ok",
            value: {
              kind: "done",
              findings: [finding, { ...finding, id: "D2", verdict: "aligned" }],
              card: CARD,
              spend: { usd: 0.4, tokens: 500 },
            },
          };
        },
      },
      designVerify: {
        kind: "available",
        run: async (input) => {
          seen.push(`verify ${input.findings.map((f) => f.id).join(",")}`);
          return {
            kind: "ok",
            value: {
              kind: "done",
              kept: input.findings
                .slice(0, 1)
                .map((f) => Object.assign({}, f, { bucket: "act_on" as const, why: "it holds" })),
              card: CARD,
              spend: { usd: 0.2, tokens: 300 },
            },
          };
        },
      },
    };
  }

  const pass = async (steps: Steps, at: string, pings: Ping[] = []) => {
    const log: string[] = [];
    await tick(
      setup({ team, open: [], merged: [] }, log, {
        steps,
        lanes: DEFAULT_LANES,
        now: () => Date.parse(at),
        notify: pinger(pings),
      }),
    );
    return log;
  };

  it("a feature-lane ticket: coordinator's spec → design review → verify pass → posted → waits for the approval → build", async () => {
    const text = spec("feature");
    await started();
    const seen: string[] = [];
    const pings: Ping[] = [];
    const steps = designSteps(seen);
    const first = await pass(steps, "2026-11-07T09:00:00Z");
    expect(first).toContain(`log PROJ-1: design review at spec ${specHash(text).slice(0, 8)}`);
    expect(seen).toEqual([`review ${specHash(text).slice(0, 8)} none`]);
    // the verify pass checks the conflict and the open, never an aligned decision
    const second = await pass(steps, "2026-11-07T09:01:00Z", pings);
    expect(seen.at(-1)).toBe("verify D1");
    expect(second).toContain(
      "log PROJ-1: design review: D1 conflict (act on, walked) src/loans.ts:12: the loans table already holds renewals",
    );
    expect(pings).toEqual([
      {
        kind: "needs-you",
        ticket: "PROJ-1",
        change: "none",
        why: `the design review is in, 1 finding(s) kept at spec ${specHash(text).slice(0, 8)}: read them, then approve`,
      },
    ]);
    // each run record carries the card's hash and what it spent
    const read = await readRecords(where());
    const ends = read.kind === "ok" ? read.value.filter((e) => e.kind === "design-ended") : [];
    expect(ends.map((e) => [e.step, e.outcome, e.card, e.spend?.usd])).toEqual([
      ["review", "done", CARD, 0.4],
      ["verify", "done", CARD, 0.2],
    ]);
    // the build waits for the human's approval, and runs nothing more
    const third = await pass(steps, "2026-11-07T09:02:00Z");
    expect(third).toEqual(["log PROJ-1: wait: the feature lane needs a human's approval; the ticket has a START only"]);
    expect(seen).toHaveLength(2);
    expect(
      (await approve({ where: where(), seenHash: specHash(text), by: "ram", at: "2026-11-07T09:30:00Z" })).kind,
    ).toBe("approved");
    expect(await pass(steps, "2026-11-07T09:31:00Z")).toContain("log PROJ-1: writer (fix): approved; no run yet");
  });

  it("an approval given before the findings waits for an approval after them; an edit to the spec reviews again", async () => {
    const text = spec("bug");
    await started();
    expect(
      (await approve({ where: where(), seenHash: specHash(text), by: "ram", at: "2026-11-07T08:30:00Z" })).kind,
    ).toBe("approved");
    const seen: string[] = [];
    const steps = designSteps(seen);
    await pass(steps, "2026-11-07T09:00:00Z");
    await pass(steps, "2026-11-07T09:01:00Z");
    expect(await pass(steps, "2026-11-07T09:02:00Z")).toEqual([
      expect.stringContaining("wait: approved before the design review's findings"),
    ]);
    writeFileSync(join(home, "specs", "ledger", "PROJ-1", "spec.md"), text.replace("409", "423"));
    expect(await pass(steps, "2026-11-07T09:03:00Z")).toContain(
      `log PROJ-1: design review at spec ${specHash(text.replace("409", "423")).slice(0, 8)}`,
    );
  });

  // #489 review: the tick hands the re-review, and its verify pass, every earlier round from the records
  it("a re-review after an Act on round gets the earlier rounds, and so does its verify pass", async () => {
    const text = spec("feature");
    await started();
    const inputs: DesignInput[] = [];
    const steps = designSteps([]);
    const keep = (inner: Steps["designReview"]): Steps["designReview"] =>
      inner.kind === "available"
        ? { kind: "available", run: async (input) => (inputs.push(input), inner.run(input)) }
        : inner;
    const verify = steps.designVerify;
    const watched: Steps = {
      ...steps,
      designReview: keep(steps.designReview),
      designVerify:
        verify.kind === "available"
          ? { kind: "available", run: async (input) => (inputs.push(input), verify.run(input)) }
          : verify,
    };
    await pass(watched, "2026-11-07T09:00:00Z");
    await pass(watched, "2026-11-07T09:01:00Z");
    expect(inputs.map((i) => i.earlier)).toEqual([undefined, undefined]);
    writeFileSync(join(home, "specs", "ledger", "PROJ-1", "spec.md"), text.replace("409", "423"));
    await pass(watched, "2026-11-07T09:02:00Z");
    await pass(watched, "2026-11-07T09:03:00Z");
    const round = {
      round: 1,
      spec: specHash(text),
      design: "none",
      lane: "feature",
      planned: [],
      findings: [finding, { ...finding, id: "D2", verdict: "aligned" }],
      kept: [{ ...finding, bucket: "act_on", why: "it holds" }],
      dismissed: [],
    };
    expect(inputs.slice(2).map((i) => i.earlier)).toEqual([[round], [round]]);
  });

  it("a re-review's repeat of a finding the person answered is dropped before it is kept; its Act on CONFLICT stays", async () => {
    const text = spec("feature");
    await started();
    const opened = { ...finding, id: "D2", verdict: "open", decision: "the currency" } as const;
    const steps: Steps = {
      ...STEPS_TODAY,
      designReview: {
        kind: "available",
        run: async () => ({ kind: "ok", value: { kind: "done", findings: [finding, opened], card: CARD } }),
      },
      designVerify: {
        kind: "available",
        run: async (input) => ({
          kind: "ok",
          value: {
            kind: "done",
            kept: input.findings.map((f) =>
              Object.assign({}, f, { bucket: f.id === "D1" ? ("act_on" as const) : ("consider" as const), why: "x" }),
            ),
            card: CARD,
          },
        }),
      },
    };
    await pass(steps, "2026-11-07T09:00:00Z");
    await pass(steps, "2026-11-07T09:01:00Z");
    writeFileSync(join(home, "specs", "ledger", "PROJ-1", "spec.md"), text.replace("409", "423"));
    const again = await pass(steps, "2026-11-07T09:02:00Z");
    expect(again).toContain("log PROJ-1: design review: dropped 1 finding(s) an earlier round settled");
    const read = await readRecords(where());
    const reviews =
      read.kind === "ok" ? read.value.filter((e) => e.kind === "design-ended" && e.step === "review") : [];
    expect(reviews.map((e) => (e.kind === "design-ended" ? e.findings.map((f) => f.id) : []))).toEqual([
      ["D1", "D2"],
      ["D1"],
    ]);
  });

  it("a design run that fails for good (a broken cite) stops at once: no backoff, no second try", async () => {
    spec("feature");
    await started();
    let runs = 0;
    const why = "a cite in the spec or design does not hold, so no design review runs; the coordinator edits it: x";
    const steps: Steps = {
      ...STEPS_TODAY,
      designReview: {
        kind: "available",
        run: async () => ((runs += 1), { kind: "ok", value: { kind: "failed", why, final: true, card: CARD } }),
      },
    };
    await pass(steps, "2026-11-07T09:00:00Z");
    expect(await pass(steps, "2026-11-07T09:30:00Z")).toEqual([`log PROJ-1: wait: ${why}`]);
    expect(runs).toBe(1);
  });

  it("at the round cap the person is told once, in the record and a ping, and no third review runs", async () => {
    const text = spec("feature");
    await started();
    const seen: string[] = [];
    const steps = designSteps(seen);
    for (const [i, edit] of ["409", "423"].entries()) {
      writeFileSync(join(home, "specs", "ledger", "PROJ-1", "spec.md"), text.replace("409", edit));
      await pass(steps, `2026-11-07T09:0${2 * i}:00Z`);
      await pass(steps, `2026-11-07T09:0${2 * i + 1}:00Z`);
    }
    expect(seen.filter((s) => s.startsWith("review"))).toHaveLength(2);
    // the second round kept an Act on CONFLICT again: the person edits a third time
    writeFileSync(join(home, "specs", "ledger", "PROJ-1", "spec.md"), text.replace("409", "429"));
    const pings: Ping[] = [];
    const after = await pass(steps, "2026-11-07T09:10:00Z", pings);
    expect(seen.filter((s) => s.startsWith("review"))).toHaveLength(2);
    expect(after).toContain(`log PROJ-1: design review: ${ROUND_CAP}`);
    expect(pings).toEqual([
      { kind: "needs-you", ticket: "PROJ-1", change: "none", why: `design review: ${ROUND_CAP}` },
    ]);
    const read = await readRecords(where());
    expect(read.kind === "ok" ? read.value.filter((e) => e.kind === "design-noted").length : -1).toBe(1);
    expect(await pass(steps, "2026-11-07T09:11:00Z", pings)).toEqual([
      "log PROJ-1: wait: the feature lane needs a human's approval; the ticket has a START only",
    ]);
    expect(pings).toHaveLength(1);
  });

  it("holds the design review while the Planned files need a heavier lane: told once, then it waits", async () => {
    mkdirSync(join(home, "projects"), { recursive: true });
    writeFileSync(join(home, "projects", "ledger.json"), JSON.stringify({ lanes: { oneWayDoor: ["db/**"] } }));
    const text = spec("feature").replace("## Lane", "## Planned files\n\n- db/V2__renewals.sql\n\n## Lane");
    writeFileSync(join(home, "specs", "ledger", "PROJ-1", "spec.md"), text);
    await started();
    const seen: string[] = [];
    const pings: Ping[] = [];
    const first = await pass(designSteps(seen), "2026-11-07T09:00:00Z", pings);
    expect(seen).toEqual([]);
    expect(first.join("\n")).toContain("design review: the lane is raised from feature to one-way door");
    expect(pings).toMatchObject([{ kind: "needs-you", why: expect.stringContaining("the lane is raised") }]);
    const second = await pass(designSteps(seen), "2026-11-07T09:01:00Z", pings);
    expect(second).toEqual([
      expect.stringMatching(/^log PROJ-1: wait: the lane is raised from feature to one-way door/),
    ]);
    expect(seen).toEqual([]);
    expect(pings).toHaveLength(1);
    // the coordinator raises the lane in the spec: the hold is released, and the design review runs
    writeFileSync(
      join(home, "specs", "ledger", "PROJ-1", "spec.md"),
      text.replace("## Lane\n\nfeature", "## Lane\n\none-way door"),
    );
    const third = await pass(designSteps(seen), "2026-11-07T09:02:00Z", pings);
    expect(seen).toHaveLength(1);
    expect(third.join("\n")).toContain("design review at spec");
  });

  it("a tiny-lane ticket skips the design review: its START builds at once", async () => {
    spec("tiny");
    await started();
    const seen: string[] = [];
    expect(await pass(designSteps(seen), "2026-11-07T09:00:00Z")).toContain(
      "log PROJ-1: unavailable: the writer's box is not built yet (#113)",
    );
    expect(seen).toEqual([]);
  });

  it("a failed design run records its spend, backs off, and is tried again; a lanes file may switch it off", async () => {
    spec("feature");
    await started();
    let calls = 0;
    const steps: Steps = {
      ...STEPS_TODAY,
      designReview: {
        kind: "available",
        run: async () => {
          calls += 1;
          return {
            kind: "ok",
            value: { kind: "failed", why: "the model ran out of budget", card: CARD, spend: { usd: 1, tokens: 9 } },
          };
        },
      },
    };
    expect(await pass(steps, "2026-11-07T09:00:00Z")).toContain(
      "log PROJ-1: failed: the design-review run failed: the model ran out of budget",
    );
    expect(await pass(steps, "2026-11-07T09:00:05Z")).toEqual([
      "log PROJ-1: wait: the design review failed; the next try is at 2026-11-07T09:00:10.000Z",
    ]);
    await pass(steps, "2026-11-07T09:00:10Z");
    expect(calls).toBe(2);
    const read = await readRecords(where());
    const spent =
      read.kind === "ok" ? summarize({ events: read.value, since: "1970-01-01T00:00:00Z" }).spent : undefined;
    expect(spent).toEqual({ usd: 2, tokens: 18 });
    const off = DEFAULT_LANES.map((l) => ({
      name: l.name,
      approval: l.approval,
      lenses: l.lenses,
      designReview: false,
    }));
    const log: string[] = [];
    await tick(setup({ team, open: [], merged: [] }, log, { lanes: off, dryRun: true }));
    expect(log).toEqual([
      "log PROJ-1: wait: the feature lane needs a human's approval; the ticket has a START only (dry run)",
    ]);
  });

  it("the cleanup run follows the implementer's done run; the ready check then runs the cleanup's evidence rows", async () => {
    await approved();
    const row = { criterion: "AC-1 it answers 409", command: "npm test", result: "1 passed" };
    await record({
      where: where(),
      event: {
        at: "2026-11-07T09:00:00Z",
        kind: "writer-ended",
        mode: "fix",
        head: H,
        outcome: "done",
        patch: "p1",
        evidence: [row],
        hung: false,
      },
    });
    const H2 = "2".repeat(40);
    const tasks: unknown[] = [];
    const checked: unknown[] = [];
    let head = H;
    const steps: Steps = {
      ...STEPS_TODAY,
      writer: {
        kind: "available",
        run: async (input) => {
          tasks.push(input.task);
          head = H2;
          return {
            kind: "ok",
            value: {
              head: H2,
              outcome: "done",
              patch: "c1",
              evidence: [row],
              hung: false,
              card: CARD,
              deferred: ["drop the guard in loans.ts:40"],
            },
          };
        },
      },
      ready: {
        kind: "available",
        run: async (input) => (
          checked.push(input.evidence), { kind: "ok", value: { passed: true, why: "", human: false } }
        ),
      },
    };
    const run = async () => tick(setup({ team, open: [open({ head })], merged: [] }, [], { steps }));
    await run();
    expect(tasks).toEqual([{ kind: "cleanup", head: H, evidence: [row] }]);
    const read = await readRecords(where());
    expect(read.kind === "ok" ? read.value.at(-1) : undefined).toMatchObject({
      kind: "writer-ended",
      mode: "cleanup",
      card: CARD,
      deferred: ["drop the guard in loans.ts:40"],
    });
    await run();
    expect(checked).toEqual([[row]]);
  });
});
