import { describe, expect, it } from "vitest";
import type { Event } from "../src/core/dispatch/records.js";
import { recordedSince, WAITING_LABEL, waitingPing, waitingStep } from "../src/core/dispatch/waiting.js";

const w = (number: number, since = "2026-11-17T03:00:00Z") => ({ number, title: `ticket ${number}`, since });

describe("WAITING_LABEL", () => {
  it("is the label a ticket session sets while it waits for the operator's word", () => {
    expect(WAITING_LABEL).toBe("waiting:operator");
  });
});

describe("recordedSince", () => {
  const line = (since: string, at = "2026-11-17T04:00:00Z"): Event => ({ at, kind: "waiting", since });

  it("is the label time of the newest waiting line, or none before the first", () => {
    expect(recordedSince([])).toBe("none");
    expect(recordedSince([{ at: "2026-11-17T04:00:00Z", kind: "turn", to: "needs-you" }])).toBe("none");
    expect(recordedSince([line("2026-11-17T01:00:00Z", "2026-11-17T01:01:00Z"), line("2026-11-17T03:00:00Z")])).toBe(
      "2026-11-17T03:00:00Z",
    );
  });
});

describe("waitingStep", () => {
  it("records and pings once for a label no line has seen yet", () => {
    expect(waitingStep({ recorded: "none", since: "2026-11-17T03:00:00Z", lane: "none" })).toEqual({
      record: true,
      ping: true,
    });
  });

  it("does nothing for the same label again, so the ping goes once", () => {
    expect(waitingStep({ recorded: "2026-11-17T03:00:00Z", since: "2026-11-17T03:00:00Z", lane: "factory" })).toEqual({
      record: false,
      ping: false,
    });
  });

  it("pings again once the label was removed and put on again: it has a newer time", () => {
    expect(
      waitingStep({ recorded: "2026-11-17T01:00:00Z", since: "2026-11-17T03:00:00Z", lane: "ready-to-merge" }),
    ).toEqual({ record: true, ping: true });
  });

  it("records but does not ping when the ticket's own turn already put it in needs you", () => {
    expect(waitingStep({ recorded: "none", since: "2026-11-17T03:00:00Z", lane: "needs-you" })).toEqual({
      record: true,
      ping: false,
    });
  });

  it("pings once for a label with no time, and never again for it", () => {
    expect(waitingStep({ recorded: "none", since: "", lane: "none" })).toEqual({ record: true, ping: true });
    expect(waitingStep({ recorded: "", since: "", lane: "none" })).toEqual({ record: false, ping: false });
  });
});

describe("waitingPing", () => {
  it("is a needs-you ping that names the session's wait and what the operator does", () => {
    expect(waitingPing(w(12), 40)).toEqual({
      kind: "needs-you",
      ticket: "12",
      change: 40,
      why: "its ticket session waits for your word (ticket 12)",
      next: "answers in the ticket's session, or tells the coordinator in their own words",
    });
  });
});
