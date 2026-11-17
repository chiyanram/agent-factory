import { describe, expect, it } from "vitest";
import { claudeUsageLimit, NO_WINDOWS, windowsOf } from "../src/core/agent/usage-limit.js";

// A provider's usage limit is read from its exact refusal text only, its reset time from the stream's rate-limit
// event first, then from the text (AO b5f4911 backend/internal/domain/usage_limit.go).

const at = (iso: string): number => Date.parse(iso);

function line(event: unknown): string {
  return JSON.stringify(event);
}

function result(text: string, isError = true): string {
  return line({ type: "result", subtype: "success", is_error: isError, result: text });
}

function rateLimit(info: Record<string, unknown>): string {
  return line({ type: "rate_limit_event", rate_limit_info: info });
}

function stream(...lines: readonly string[]): string {
  return `${lines.join("\n")}\n`;
}

const HIT = "You've hit your limit · resets 3pm (Europe/London)";

describe("a Claude usage-limit refusal", () => {
  it("takes the reset from the stream's rejected rate-limit event", () => {
    const resetsAt = at("2026-11-17T15:00:00Z") / 1000;
    const out = stream(
      rateLimit({ status: "rejected", resetsAt, rateLimitType: "five_hour", overageStatus: "rejected" }),
      result(HIT),
    );
    expect(claudeUsageLimit(out, "", at("2026-11-17T10:12:00Z"))).toEqual({
      kind: "limited",
      until: "2026-11-17T15:00:00Z",
      said: HIT,
    });
  });

  it("reads a clock time in an IANA zone, anchored to when the run ended", () => {
    expect(claudeUsageLimit(stream(result(HIT)), "", at("2026-11-17T10:00:00Z"))).toMatchObject({
      until: "2026-11-17T15:00:00Z",
    });
    // past 15:00 London, the clock means the next day
    expect(claudeUsageLimit(stream(result(HIT)), "", at("2026-11-17T16:00:00Z"))).toMatchObject({
      until: "2026-11-18T15:00:00Z",
    });
    const tomorrow = "You've hit your limit · resets tomorrow 9:30am (Asia/Tokyo)";
    // 19:00 in Tokyo on the 17th: tomorrow 09:30 is the 18th, 00:30 UTC
    expect(claudeUsageLimit(stream(result(tomorrow)), "", at("2026-11-17T10:00:00Z"))).toMatchObject({
      until: "2026-11-18T00:30:00Z",
    });
  });

  it("uses an ISO time as it is", () => {
    const iso = "You've reached your usage limit. It resets at 2026-11-17T15:00:00+01:00";
    expect(claudeUsageLimit(stream(result("Usage limit reached; resets 2026-11-17T15:00:00+01:00")), "", 0)).toEqual({
      kind: "limited",
      until: "2026-11-17T14:00:00Z",
      said: "Usage limit reached; resets 2026-11-17T15:00:00+01:00",
    });
    expect(claudeUsageLimit(stream(result(iso)), "", 0)).toMatchObject({ until: "2026-11-17T14:00:00Z" });
  });

  it("gives an unknown reset for a zone abbreviation, a clock daylight saving skips or repeats, or no time", () => {
    const unknown = (text: string, ended: string): unknown => claudeUsageLimit(stream(result(text)), "", at(ended));
    expect(unknown("You've hit your limit · resets 3pm (PST)", "2026-11-17T10:00:00Z")).toMatchObject({
      until: "unknown",
    });
    // 23:00 on 31 October in New York: 01:30 is next on 1 November, which shows 01:30 twice
    expect(unknown("You've hit your limit · resets 1:30am (America/New_York)", "2026-11-01T03:00:00Z")).toMatchObject({
      until: "unknown",
    });
    // 00:00 on 8 March in New York, which skips 02:30
    expect(unknown("You've hit your limit · resets 2:30am (America/New_York)", "2026-03-08T05:00:00Z")).toMatchObject({
      until: "unknown",
    });
    expect(unknown("You've reached your usage limit.", "2026-11-17T10:00:00Z")).toMatchObject({ until: "unknown" });
  });

  it("falls back to the text when the event has no usable time", () => {
    const noTime = rateLimit({ status: "rejected", rateLimitType: "five_hour" });
    const tooFar = rateLimit({
      status: "rejected",
      rateLimitType: "seven_day",
      resetsAt: at("2027-01-30T00:00:00Z") / 1000,
    });
    const overage = rateLimit({
      status: "rejected",
      resetsAt: at("2026-11-17T12:00:00Z") / 1000,
      overageStatus: "allowed",
    });
    for (const event of [noTime, tooFar, overage]) {
      expect(claudeUsageLimit(stream(event, result(HIT)), "", at("2026-11-17T10:00:00Z"))).toMatchObject({
        until: "2026-11-17T15:00:00Z",
      });
    }
  });

  it("takes the latest rejected window, and drops one a later allowed event for its kind clears", () => {
    const five = rateLimit({
      status: "rejected",
      rateLimitType: "five_hour",
      resetsAt: at("2026-11-17T12:00:00Z") / 1000,
    });
    const week = rateLimit({
      status: "rejected",
      rateLimitType: "seven_day",
      resetsAt: at("2026-11-19T08:00:00Z") / 1000,
    });
    const weekOk = rateLimit({ status: "allowed", rateLimitType: "seven_day" });
    const ended = at("2026-11-17T10:00:00Z");
    expect(claudeUsageLimit(stream(five, week, result(HIT)), "", ended)).toMatchObject({
      until: "2026-11-19T08:00:00Z",
    });
    expect(claudeUsageLimit(stream(five, week, weekOk, result(HIT)), "", ended)).toMatchObject({
      until: "2026-11-17T12:00:00Z",
    });
    expect(windowsOf(NO_WINDOWS, JSON.parse(weekOk))).toEqual({});
  });

  it("reads the known refusals only: never a result that is no error, nor the model's own words", () => {
    const said = line({ type: "assistant", message: { content: [{ type: "text", text: HIT }] } });
    expect(claudeUsageLimit(stream(said, result("done")), "", 0)).toEqual({ kind: "none" });
    expect(claudeUsageLimit(stream(result(HIT, false)), "", 0)).toEqual({ kind: "none" });
    expect(claudeUsageLimit(stream(result("API Error: 500")), "", 0)).toEqual({ kind: "none" });
    expect(claudeUsageLimit("", "", 0)).toEqual({ kind: "none" });
  });

  it("reads a curly apostrophe, the general wording, and stderr when there is no result event", () => {
    expect(claudeUsageLimit(stream(result("You’ve hit your limit")), "", 0)).toMatchObject({ kind: "limited" });
    expect(claudeUsageLimit(stream(result("Weekly usage limit reached")), "", 0)).toMatchObject({ kind: "limited" });
    expect(claudeUsageLimit("", "You've hit your limit · resets 3pm (UTC)\nmore", at("2026-11-17T10:00:00Z"))).toEqual({
      kind: "limited",
      until: "2026-11-17T15:00:00Z",
      said: "You've hit your limit · resets 3pm (UTC)",
    });
  });
});
