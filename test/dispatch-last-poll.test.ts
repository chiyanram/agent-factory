import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  headed,
  lastPollOf,
  livenessLine,
  readLastPoll,
  writeLastPoll,
  type LastPoll,
} from "../src/core/dispatch/last-poll.js";
import { STEPS_TODAY, tick, type TickSetup } from "../src/core/dispatch/tick.js";
import type { Forge } from "../src/core/forge/types.js";
import { NO_NOTIFY } from "../src/core/notify.js";
import { tempDir } from "./temp.js";

const NOW = Date.parse("2026-11-09T10:00:00Z");
const ago = (minutes: number): string => new Date(NOW - minutes * 60_000).toISOString();
const POLL: LastPoll = { at: ago(4), pollMinutes: 5, forge: "github", repo: "chiyanram/ledger" };

let home = "";
beforeEach(() => {
  home = tempDir("factory-last-poll-");
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const notUsed = async (): Promise<{ readonly kind: "failed"; readonly reason: string }> => ({
  kind: "failed",
  reason: "not used in these tests",
});

// a git host with these claimed open changes; "down" when it cannot list them
function forge(claimed: readonly number[] | "down"): Forge {
  return {
    name: "github",
    mark: "#",
    me: async () => ({ kind: "ok", value: "ram" }),
    change: notUsed,
    defaultBranch: notUsed,
    branchExists: notUsed,
    openChange: notUsed,
    notes: notUsed,
    lineFinding: notUsed,
    status: notUsed,
    ciConfig: notUsed,
    claimed: async () =>
      claimed === "down" ? { kind: "failed", reason: "gh is down" } : { kind: "ok", value: claimed },
    changes: async () => ({ kind: "ok", value: { team: [], open: [], merged: [] } }),
    failedJobs: notUsed,
    addLabel: notUsed,
    removeLabel: notUsed,
    note: notUsed,
  };
}

const status = (claimed: readonly number[] | "down") =>
  headed({
    home: { kind: "ok", value: home },
    forge: forge(claimed),
    label: "agent::claimed",
    repo: "chiyanram/ledger",
    now: NOW,
    line: "posted #12 at aaaa1111",
  });

describe("status: when the orchestrator last ran (#103)", () => {
  it("flags the line when the last poll is older than three intervals while a ticket is claimed", async () => {
    expect((await writeLastPoll({ home, project: "ledger", poll: { ...POLL, at: ago(16) } })).kind).toBe("ok");
    expect(await status([12])).toBe(
      "LATE: orchestrator last ran 16 min ago, over 3 poll intervals of 5 min, while 1 change is claimed; check its cron or launchd job; posted #12 at aaaa1111",
    );
  });

  it("says how long ago it ran, unflagged, when it is on time or nothing is claimed", async () => {
    await writeLastPoll({ home, project: "ledger", poll: POLL });
    expect(await status([12, 14])).toBe("orchestrator last ran 4 min ago; posted #12 at aaaa1111");
    await writeLastPoll({ home, project: "ledger", poll: { ...POLL, at: ago(90) } });
    expect(await status([])).toBe("orchestrator last ran 90 min ago; posted #12 at aaaa1111");
    // exactly three intervals is not late yet
    await writeLastPoll({ home, project: "ledger", poll: { ...POLL, at: ago(15) } });
    expect(await status([12])).toBe("orchestrator last ran 15 min ago; posted #12 at aaaa1111");
  });

  it("counts claims the git host cannot list as claimed, and says why", async () => {
    await writeLastPoll({ home, project: "ledger", poll: { ...POLL, at: ago(60) } });
    expect(await status("down")).toMatch(
      /^LATE: orchestrator last ran 60 min ago, .* and the claimed changes could not be read: gh is down; /,
    );
  });

  it("flags an orchestrator that never ran while a ticket is claimed", async () => {
    expect(await status([12])).toMatch(/^LATE: the orchestrator has never run here, while 1 change is claimed; /);
    expect(await status([])).toBe("orchestrator has not run here yet; posted #12 at aaaa1111");
  });

  it("reads the newest pass for this git host and repository, and never another's", async () => {
    await writeLastPoll({ home, project: "ledger", poll: { ...POLL, at: ago(50) } });
    await writeLastPoll({ home, project: "ledger-2", poll: { ...POLL, at: ago(2) } });
    await writeLastPoll({ home, project: "other", poll: { ...POLL, at: ago(1), repo: "chiyanram/other" } });
    await writeLastPoll({ home, project: "lab", poll: { ...POLL, at: ago(1), forge: "gitlab" } });
    const read = await readLastPoll({ home, forge: "github", repo: "chiyanram/ledger" });
    expect(read).toEqual({ kind: "ok", value: { ...POLL, at: ago(2) } });
  });

  it("names a broken last-poll file, never reading it as never ran", async () => {
    mkdirSync(join(home, "runs", "ledger"), { recursive: true });
    writeFileSync(join(home, "runs", "ledger", "last-poll.json"), "{");
    expect(await status([12])).toMatch(
      /^orchestrator last ran: cannot tell: .*last-poll\.json is not a last-poll record/,
    );
    expect(lastPollOf(JSON.stringify({ ...POLL, pollMinutes: 0 }))).toBe("bad");
    expect(lastPollOf(JSON.stringify({ ...POLL, forge: "bitbucket" }))).toBe("bad");
    expect(
      livenessLine({ last: { kind: "failed", reason: "x" }, now: NOW, claimed: { kind: "count", count: 0 } }),
    ).toBe("orchestrator last ran: cannot tell: x");
  });
});

describe("tick: each poll writes its last-poll time (#103)", () => {
  const setup = (over: Partial<TickSetup> = {}): TickSetup => ({
    home,
    project: "ledger",
    gate: "forge-ci",
    forge: forge([]),
    label: "agent::claimed",
    steps: STEPS_TODAY,
    now: () => NOW,
    quietMinutes: 30,
    pollMinutes: 7,
    repo: "chiyanram/ledger",
    notify: NO_NOTIFY,
    dryRun: false,
    log: () => undefined,
    ...over,
  });
  const file = () => join(home, "runs", "ledger", "last-poll.json");

  it("writes the time, the interval and the repository after the poll", async () => {
    expect((await tick(setup())).kind).toBe("ok");
    expect(JSON.parse(readFileSync(file(), "utf8"))).toEqual({
      at: new Date(NOW).toISOString(),
      pollMinutes: 7,
      forge: "github",
      repo: "chiyanram/ledger",
    });
  });

  it("writes nothing on a dry run, or when the poll failed", async () => {
    await tick(setup({ dryRun: true }));
    const down = { ...forge([]), me: async () => ({ kind: "failed" as const, reason: "down" }) };
    expect((await tick(setup({ forge: down }))).kind).toBe("failed");
    expect(await readLastPoll({ home, forge: "github", repo: "chiyanram/ledger" })).toEqual({
      kind: "ok",
      value: "none",
    });
  });
});
