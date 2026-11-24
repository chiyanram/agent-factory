import { describe, expect, it } from "vitest";
import { EMPTY, summarize, type Event } from "../src/core/dispatch/records.js";
import { refusedLine } from "../src/core/dispatch/refused.js";

const at = "2026-11-23T09:00:00Z";
const since = "2026-11-23T08:00:00Z";
const why = "the reviewer is not set up";
const refused: Event = { at, kind: "setup-refused", phase: "review", why };

describe("a refused setup, recorded once per cause", () => {
  it("gives a line the first time a step cannot run", () => {
    expect(refusedLine(EMPTY, "review", why, at)).toEqual(refused);
  });

  it("gives none while the newest refusal names the same step and why", () => {
    expect(refusedLine(summarize({ events: [refused], since }), "review", why, at)).toBeUndefined();
  });

  it("gives one again when the why or the step changes", () => {
    const runs = summarize({ events: [refused], since });
    expect(refusedLine(runs, "review", "the reviewer needs FACTORY_REPO", at)).toMatchObject({
      why: "the reviewer needs FACTORY_REPO",
    });
    expect(refusedLine(runs, "writer", why, at)).toMatchObject({ phase: "writer" });
  });

  it("gives one again once a run has started since the last refusal", () => {
    const started: Event = { at, kind: "started", phase: "review", mode: "none", head: "a".repeat(40) };
    expect(refusedLine(summarize({ events: [refused, started], since }), "review", why, at)).toEqual(refused);
  });
});
