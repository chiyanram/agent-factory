// the non-negotiables' CI tests (#485; docs/CONSTITUTION.md): one named test per principle the constitution marks
// non-negotiable and #485 lists, as its "How it's checked" line states it. A test the code does not meet yet is marked
// expected-to-fail (it.fails) with the ticket that fixes it, never skipped: once the code meets it, the build fails until
// the mark is removed.
//
// P6, P13, P15, P18 and P21 have their own named tests beside the code they hold (P6 below too; P13 in notes.test.ts
// with #486; P15 in floor.test.ts, finding.test.ts and cite-check.test.ts; P18 in pack-schema.test.ts; P21 in
// lane.test.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { NO_CAPS } from "../src/core/dispatch/caps.js";
import { EMPTY, readRecords, record, type Summary } from "../src/core/dispatch/records.js";
import {
  decide,
  MAX_CI_ROUNDS,
  MAX_READY_FAILURES,
  MAX_REVIEW_ROUNDS,
  type Action,
  type ApprovalView,
  type ChangeView,
  type TicketState,
} from "../src/core/dispatch/table.js";
import type { DesignView } from "../src/core/dispatch/design.js";
import type { OpenLine } from "../src/core/poll.js";
import { srtEnv } from "../src/core/box/srt-plan.js";
import { claudeEnv } from "../src/core/review/settings.js";
import { buildPack } from "../src/core/review/pack.js";
import { resolve as resolveSettings, type FileLayer } from "../src/core/settings/resolve.js";
import { modesOf } from "../src/core/settings/layers.js";
import { keyLines } from "../src/core/settings/lines.js";
import { specHash } from "../src/core/spec.js";
import { changeAt, project, RULEBOOK, specText, writeSpec, type Project } from "./review-repo.js";
import { tempDir } from "./temp.js";

const ROOT = resolve(import.meta.dirname, "..");
const H = "1".repeat(40);
const NOW = Date.parse("2026-11-07T10:00:00Z");

// ---- P1: the decision table reaches no model, runner or git-host module, and is pure

// valueImports : the modules a source file imports for their values; `import type` and `export type` erase at build
function valueImports(file: string): readonly string[] {
  const text = readFileSync(file, "utf8");
  const found = [...text.matchAll(/^(?:import|export)\s+(?!type\b)[^;]*?from\s+"([^"]+)";/gms)].map((m) => m[1] ?? "");
  return found.filter((s) => s !== "");
}

// reached : every module the file reaches through value imports: a source path under src/, or a bare name (node:fs)
function reached(file: string): ReadonlySet<string> {
  const seen = new Set<string>();
  const walk = (at: string): void => {
    for (const spec of valueImports(at)) {
      const next = spec.startsWith(".") ? resolve(dirname(at), spec.replace(/\.js$/, ".ts")) : spec;
      if (seen.has(next)) {
        continue;
      }
      seen.add(next);
      if (next.endsWith(".ts")) {
        walk(next);
      }
    }
  };
  walk(file);
  return new Set([...seen].map((m) => (m.startsWith("/") ? relative(ROOT, m) : m)));
}

// what the table must never reach: a model, a runner, a git host, a process, the network or the disk
const FORBIDDEN = [
  /^src\/core\/review\/model\.ts$/,
  /^src\/core\/writer\//,
  /^src\/core\/box\//,
  /^src\/core\/egress\//,
  /^src\/core\/forge\/(github|gitlab|index|api|serve|shared)\.ts$/,
  /^src\/core\/git\.ts$/,
  /^src\/core\/push\.ts$/,
  /^node:(child_process|fs|fs\/promises|net|http|https|dns|worker_threads)$/,
];

describe("P1: the engine decides every routine step", () => {
  it("the decision table reaches no model, runner, git-host, process, network or disk module", () => {
    const mods = reached(join(ROOT, "src", "core", "dispatch", "table.ts"));
    expect(mods.size).toBeGreaterThan(0);
    expect([...mods].filter((m) => FORBIDDEN.some((f) => f.test(m)))).toEqual([]);
  });

  it("the table is pure: it reads no clock or chance of its own, and the same state gives the same action", () => {
    const now = vi.spyOn(Date, "now").mockImplementation(() => {
      throw new Error("the table read the clock");
    });
    const random = vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("the table rolled a die");
    });
    try {
      for (const s of states()) {
        expect(decide(s)).toEqual(decide(structuredClone(s)));
      }
    } finally {
      now.mockRestore();
      random.mockRestore();
    }
  });
});

// ---- the generated ticket states P7 and P8 are checked over

function line(over: Partial<OpenLine> = {}): OpenLine {
  return {
    kind: "open",
    number: 12,
    branch: "factory/PROJ-1",
    fork: false,
    lastNoteAt: "",
    head: H,
    draft: true,
    claimed: true,
    pipeline: { kind: "success" },
    needsHuman: false,
    stop: { kind: "none" },
    asks: 0,
    mergeable: "clean",
    ...over,
  };
}

const AT = "2026-11-07T08:00:00Z";
const APPROVALS: readonly ApprovalView[] = [
  { kind: "approved", at: AT, lane: "feature", testFirst: false },
  { kind: "started", at: AT, lane: "tiny", testFirst: false },
  { kind: "approved", at: AT, lane: "bug", testFirst: true },
  { kind: "stale" },
  { kind: "missing" },
  { kind: "unapproved", lane: "feature" },
  { kind: "unwritten" },
  { kind: "unstarted" },
  { kind: "raised", from: "tiny", to: "feature", why: "a planned file needs the feature lane" },
];

const CHANGES: readonly ChangeView[] = [
  { kind: "none" },
  { kind: "open", line: line() },
  { kind: "open", line: line({ pipeline: { kind: "failed" } }) },
  { kind: "open", line: line({ pipeline: { kind: "running" } }) },
  { kind: "open", line: line({ needsHuman: true }) },
  { kind: "open", line: line({ mergeable: "conflict" }) },
  { kind: "open", line: line({ head: "2".repeat(40) }) },
  { kind: "open", line: line({ claimed: false, asks: 1 }) },
  { kind: "merged", line: { kind: "merged", number: 12, branch: "factory/PROJ-1", fork: false } },
  { kind: "many", numbers: [12, 13] },
];

const done = { kind: "ended", mode: "cleanup", head: H, outcome: "done", patch: "p1", evidence: [] } as const;
const readyFailed = {
  kind: "ended",
  at: "2026-11-07T09:55:00Z",
  human: false,
  head: H,
  passed: false,
  why: "x",
} as const;
const readyOk = { ...readyFailed, passed: true } as const;
const RUNS: readonly Summary[] = [
  EMPTY,
  { ...EMPTY, lastWriter: done, lastAt: "2026-11-07T09:50:00Z" },
  { ...EMPTY, lastWriter: done, lastReady: readyFailed, readyFailures: MAX_READY_FAILURES },
  {
    ...EMPTY,
    lastWriter: done,
    lastReady: readyOk,
    lastReview: { kind: "ended", head: H, actOn: 2 },
    reviewRounds: MAX_REVIEW_ROUNDS,
  },
  {
    ...EMPTY,
    lastWriter: done,
    lastReady: readyOk,
    lastReview: { kind: "ended", head: H, actOn: 0 },
    reviewRounds: 1,
    ciRounds: MAX_CI_ROUNDS,
  },
  { ...EMPTY, interrupted: { kind: "interrupted", phase: "writer", at: "2026-11-07T09:00:00Z" } },
  {
    ...EMPTY,
    lastWriter: { kind: "ended", mode: "fix", head: H, outcome: "asked", patch: "", evidence: [] },
  },
];

const DESIGNS: readonly DesignView[] = [
  { kind: "off" },
  { kind: "run", step: "review", spec: "a".repeat(64), design: "none" },
  { kind: "stopped", step: "review", why: "3 failures" },
  { kind: "done" },
];

function states(): readonly TicketState[] {
  return APPROVALS.flatMap((approval) =>
    CHANGES.flatMap((change) =>
      RUNS.flatMap((runs) =>
        DESIGNS.map(
          (design): TicketState => ({
            ticket: "PROJ-1",
            gate: "forge-ci",
            approval,
            waiver: { kind: "none" },
            change,
            runs,
            now: NOW,
            quietMinutes: 30,
            caps: NO_CAPS,
            design,
          }),
        ),
      ),
    ),
  );
}

// the actions that start a model or runner run
const RUNS_A_STEP: ReadonlySet<Action["kind"]> = new Set(["writer", "ready", "review", "verify", "design"]);

// ---- P7: every loop has a cap and a stop, and ends at a person with a short summary

describe("P7: every loop has a cap and a stop", () => {
  it("over every generated state, a hand-over to a person names why in at most 3 lines", () => {
    const whys = states()
      .map(decide)
      .flatMap((a) => (a.kind === "needs-human" ? [a.why] : []));
    expect(whys.length).toBeGreaterThan(0);
    expect(whys.filter((w) => w.trim() === "" || w.split("\n").length > 3)).toEqual([]);
  });

  it("a step at its cap never runs again: the ready check, the review rounds and the CI rounds each go to a person", () => {
    const base = states().filter((s) => s.approval.kind === "approved" && s.change.kind === "open");
    const capped = (r: Summary): boolean =>
      r.readyFailures >= MAX_READY_FAILURES || r.reviewRounds >= MAX_REVIEW_ROUNDS || r.ciRounds >= MAX_CI_ROUNDS;
    const atCap = base.filter((s) => capped(s.runs));
    expect(atCap.length).toBeGreaterThan(0);
    for (const s of atCap) {
      expect(decide(s).kind).not.toBe("writer");
    }
  });
});

// ---- P8: nothing starts unless a person starts it

describe("P8: a person starts everything", () => {
  it("with no START (none at all, or an approval alone), no state starts a run", () => {
    const unstarted = states().filter((s) => s.approval.kind === "missing" || s.approval.kind === "unstarted");
    expect(unstarted.length).toBeGreaterThan(0);
    const ran = unstarted.filter((s) => RUNS_A_STEP.has(decide(s).kind));
    expect(ran.map((s) => [s.approval.kind, s.change.kind, s.design.kind, decide(s)])).toEqual([]);
  });
});

// ---- P3: one record per ticket; a restart loses nothing

describe("P3: one record per ticket; a restart loses nothing", () => {
  it("a writer run killed before its end line is never run again on restart: one push and one PR at most", () => {
    const killed: Summary = { ...EMPTY, interrupted: { kind: "interrupted", phase: "writer", at: AT } };
    for (const change of CHANGES.filter((c) => c.kind === "open" && !c.line.needsHuman)) {
      const first = states()[0];
      if (first === undefined) throw new Error("no states");
      const a = decide({ ...first, change, runs: killed });
      expect(a.kind).toBe("needs-human");
    }
  });
});

// ---- P4: no run holds a login, and no record or trace holds a secret

const FAKE_TOKEN = "ghp_FAKEFAKEFAKEFAKEFAKEFAKE1234";
const HOST_ENV: NodeJS.ProcessEnv = {
  PATH: "/usr/bin",
  HOME: "/home/op",
  GH_TOKEN: FAKE_TOKEN,
  GITHUB_TOKEN: FAKE_TOKEN,
  GITLAB_TOKEN: `glpat-${"F".repeat(20)}`,
  FACTORY_GITHUB_APP_KEY: "/home/op/app.pem",
  CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat-model-only",
};

describe("P4: no run holds a login", () => {
  let home = "";
  beforeEach(() => {
    home = tempDir("factory-p4-");
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  it("the srt runner's environment holds no git host token from the host", () => {
    const env = srtEnv({ host: HOST_ENV, home: "/r/home", tmp: "/r/home/tmp", ca: { name: "", file: "" }, spec: {} });
    expect(JSON.stringify(env)).not.toContain(FAKE_TOKEN);
    expect(JSON.stringify(env)).not.toContain("glpat-");
    expect(Object.keys(env).filter((k) => k.startsWith("FACTORY_"))).toEqual([]);
  });

  it("a model run's environment holds no git host token and no factory setting", () => {
    const env = claudeEnv(HOST_ENV);
    expect(JSON.stringify(env)).not.toContain(FAKE_TOKEN);
    expect(JSON.stringify(env)).not.toContain("glpat-");
    expect(Object.keys(env).filter((k) => k.startsWith("FACTORY_"))).toEqual([]);
  });

  it("a planted fake token never appears in a saved record", async () => {
    const where = { home, project: "ledger", ticket: "PROJ-1" };
    const why = `the run printed GH_TOKEN=${FAKE_TOKEN} and Authorization: Bearer ${FAKE_TOKEN}`;
    expect(await record({ where, event: { at: AT, kind: "blocked", why } })).toEqual({ kind: "ok" });
    const files = readdirSync(join(home, "runs"), { recursive: true }).map(String);
    const texts = files.flatMap((f) => {
      try {
        return [readFileSync(join(home, "runs", f), "utf8")];
      } catch {
        return [];
      }
    });
    expect(texts.join("")).not.toContain(FAKE_TOKEN);
    // the record still reads, with the rest of its words
    const read = await readRecords(where);
    expect(read.kind === "ok" ? JSON.stringify(read.value) : read.reason).toContain("the run printed");
  });
});

// ---- P5: what judges a change never comes from that change

describe("P5: the judge never comes from the change", () => {
  let p: Project;
  beforeEach(() => {
    p = project();
    writeSpec(join(p.root, "factory"), specText());
  });
  afterEach(() => rmSync(p.root, { recursive: true, force: true }));

  it("the review's rules come from the default branch, never the branch under review", async () => {
    const built = await buildPack({
      spec: {
        store: { kind: "local", root: join(p.root, "factory", "specs") },
        project: "ledger",
        ticket: "PROJ-1",
        approval: { kind: "approved", hash: specHash(specText()), by: "ram", at: AT },
      },
      repo: p.clone,
      env: p.env,
      change: changeAt(p.head2),
      defaultBranch: "main",
      rulebook: RULEBOOK,
      previous: { kind: "none" },
      dir: join(p.root, "packs"),
      mark: "!",
    });
    if (built.kind !== "ok") throw new Error(built.reason);
    const text = readFileSync(built.value.path, "utf8");
    const rules = text.slice(text.indexOf("\n## 3 "), text.indexOf("\n## ", text.indexOf("\n## 3 ") + 4));
    // main's svc/AGENTS.md is the rule; the branch's edit of it is not
    expect(rules).toContain("SVC-RULES");
    expect(rules).not.toContain("IGNORE ALL RULES");
  });
});

// ---- P6: the AI never approves

describe("P6: the AI never approves", () => {
  it("the git host seam has no merge or approve operation", () => {
    const ops = readFileSync(join(ROOT, "src", "core", "forge", "types.ts"), "utf8");
    const start = ops.indexOf("export type Forge = {");
    const forge = ops.slice(start, ops.indexOf("\n};", start));
    const operations = [...forge.matchAll(/^ {2}(?:readonly )?(\w+)[(:?]/gm)].map((m) => m[1] ?? "");
    expect(operations.length).toBeGreaterThan(10);
    expect(operations.filter((o) => /merge|approve|accept/i.test(o))).toEqual([]);
  });
});

// ---- P9: nothing is committed to the product repo by default

function layer(name: FileLayer["name"], value: object): FileLayer {
  return { name, file: `/${name}.json`, value, lines: keyLines(`${JSON.stringify(value, null, 2)}\n`) };
}

describe("P9: nothing in the product repo by default", () => {
  it("with the work setting, an opt-in to commit to the product repo is refused, from any layer", () => {
    for (const where of ["project", "user"] as const) {
      const layers = [layer("team", { work: true }), layer(where, { repoCommits: true })];
      const team = layers[0];
      const r = resolveSettings({ layers, modes: modesOf(team).modes, env: {}, problems: [] });
      expect(r.problems.filter((x) => x.level === "error").map((x) => x.text)).toEqual([
        expect.stringContaining("where nothing is ever committed (P9)"),
      ]);
    }
  });

  it("no module outside the settings reads the commit opt-in: nothing commits to the product repo yet", () => {
    const src = join(ROOT, "src");
    const files = readdirSync(src, { recursive: true })
      .map(String)
      .filter((f) => f.endsWith(".ts") && !f.startsWith("core/settings"));
    expect(files.filter((f) => readFileSync(join(src, f), "utf8").includes("repoCommits"))).toEqual([]);
  });
});
