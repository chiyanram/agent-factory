import { describe, expect, it } from "vitest";
import { designView, MAX_DESIGN_FAILURES } from "../src/core/dispatch/design.js";
import { summarize, type Event } from "../src/core/dispatch/records.js";
import { keep, readDesignFindings, toVerify, type DesignFinding } from "../src/core/design/findings.js";

const S = "a".repeat(64);
const D = "none";
const NOW = Date.parse("2026-11-07T10:00:00Z");

const started = (at: string, phase: "design-review" | "design-verify"): Event => ({
  at,
  kind: "started",
  phase,
  mode: "none",
  head: "",
});

const ended = (at: string, step: "review" | "verify", outcome: "done" | "failed", spec = S): Event => ({
  at,
  kind: "design-ended",
  step,
  spec,
  design: D,
  outcome,
  why: outcome === "failed" ? "the model failed" : "",
  findings: [],
  kept: [],
});

// a done review's line, typed as itself
function designEnd(at: string): Extract<Event, { kind: "design-ended" }> {
  return {
    at,
    kind: "design-ended",
    step: "review",
    spec: S,
    design: D,
    outcome: "done",
    why: "",
    findings: [],
    kept: [],
  };
}

const view = (events: readonly Event[], approvedAt = "") =>
  designView({ events, spec: S, design: D, approvedAt, now: NOW });

describe("designView (#236)", () => {
  it("runs the design-reviewer first, then the verify pass, then is done", () => {
    expect(view([])).toEqual({ kind: "run", step: "review", spec: S, design: D });
    const reviewed = [
      started("2026-11-07T09:00:00Z", "design-review"),
      ended("2026-11-07T09:01:00Z", "review", "done"),
    ];
    expect(view(reviewed)).toEqual({ kind: "run", step: "verify", spec: S, design: D });
    const verified = [...reviewed, ended("2026-11-07T09:02:00Z", "verify", "done")];
    expect(view(verified)).toEqual({ kind: "done" });
  });

  it("an edit to the spec is new hashes: the review runs afresh", () => {
    const old = [ended("2026-11-07T09:01:00Z", "review", "done", "b".repeat(64))];
    expect(view(old)).toEqual({ kind: "run", step: "review", spec: S, design: D });
  });

  it("an approval before the verify pass ended waits for an approval after it", () => {
    const verified = [ended("2026-11-07T09:01:00Z", "review", "done"), ended("2026-11-07T09:02:00Z", "verify", "done")];
    expect(view(verified, "2026-11-07T08:00:00Z")).toEqual({ kind: "early", at: "2026-11-07T09:02:00Z" });
    expect(view(verified, "2026-11-07T09:30:00Z")).toEqual({ kind: "done" });
  });

  it("a failed run backs off, a lost start counts as a failure, and three failures stop for a person", () => {
    const once = [ended("2026-11-07T09:59:55Z", "review", "failed")];
    expect(view(once)).toEqual({ kind: "later", step: "review", at: "2026-11-07T10:00:05.000Z" });
    const lost = [ended("2026-11-07T09:00:00Z", "review", "failed"), started("2026-11-07T09:59:50Z", "design-review")];
    expect(view(lost)).toEqual({ kind: "later", step: "review", at: "2026-11-07T10:00:10.000Z" });
    const many = Array.from({ length: MAX_DESIGN_FAILURES }, (_, i) =>
      ended(`2026-11-07T09:0${i}:00Z`, "review", "failed"),
    );
    expect(view(many)).toMatchObject({ kind: "stopped", why: expect.stringContaining("failed 3 times") });
  });

  it("a design run's end clears its start and counts its spend toward the ticket", () => {
    const events: Event[] = [
      started("2026-11-07T09:00:00Z", "design-review"),
      { ...designEnd("2026-11-07T09:01:00Z"), spend: { usd: 0.5, tokens: 100 } },
    ];
    const s = summarize({ events, since: "1970-01-01T00:00:00Z" });
    expect(s.interrupted).toEqual({ kind: "none" });
    expect(s.spent).toEqual({ usd: 0.5, tokens: 100 });
  });
});

describe("design findings", () => {
  const raw = (verdict: string) => ({
    id: "x",
    decision: "one table per ticket",
    verdict,
    file: "src/a.ts",
    line: 3,
    rule: "SR9",
    severity: "warning",
    grade: "cited",
    finding: "it contradicts records.ts",
    fix: "use the records",
  });

  it("are checked and renumbered; the verify pass sees only conflicts and opens; dismissed ones are not kept", () => {
    const read = readDesignFindings({ findings: [raw("aligned"), raw("conflict"), raw("open")] });
    expect(read.kind).toBe("ok");
    const findings: readonly DesignFinding[] = read.kind === "ok" ? read.value : [];
    expect(findings.map((f) => f.id)).toEqual(["D1", "D2", "D3"]);
    expect(toVerify(findings).map((f) => f.id)).toEqual(["D2", "D3"]);
    const kept = keep(toVerify(findings), [{ id: "D2", bucket: "dismissed", why: "the line says otherwise" }]);
    expect(kept.map((k) => [k.id, k.bucket])).toEqual([["D3", "consider"]]);
    expect(readDesignFindings({ findings: [{ ...raw("conflict"), verdict: "approve" }] }).kind).toBe("failed");
  });
});
