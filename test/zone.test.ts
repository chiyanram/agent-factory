import { describe, expect, it } from "vitest";
import { dayStart, monthStart, readerZone, shownAt, shownFor, UTC } from "../src/core/zone.js";

// The views show the reader's zone; the records stay in UTC (#487, Q8).

const TOKYO = { name: "Asia/Tokyo" };
const LA = { name: "America/Los_Angeles" };

describe("the reader's zone (#487)", () => {
  it("is TZ when the runtime knows it, else the system's, never a name it does not know", () => {
    expect(readerZone({ TZ: "Asia/Tokyo" })).toEqual(TOKYO);
    const system = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(readerZone({ TZ: "Not/AZone" })).toEqual({ name: system });
    expect(readerZone({})).toEqual({ name: system });
  });

  it("shows a time on the zone's clock, with the zone's name", () => {
    expect(shownAt("2026-11-13T06:07:15Z", TOKYO)).toBe("2026-11-13 15:07 Asia/Tokyo");
    expect(shownAt("2026-11-13T06:07:15Z", LA)).toBe("2026-11-12 22:07 America/Los_Angeles");
    expect(shownAt("2026-11-13T06:07:15Z", UTC)).toBe("2026-11-13 06:07 UTC");
    expect(shownAt("not a time", UTC)).toBe("not a time");
  });

  it("starts the day and the month at the zone's midnight", () => {
    const now = Date.parse("2026-11-13T06:07:15Z");
    // 15:07 in Tokyo, so the day began at 00:00 there, 15:00 UTC the day before
    expect(new Date(dayStart(now, TOKYO)).toISOString()).toBe("2026-11-12T15:00:00.000Z");
    // 22:07 on the 12th in Los Angeles (UTC-8)
    expect(new Date(dayStart(now, LA)).toISOString()).toBe("2026-11-12T08:00:00.000Z");
    expect(new Date(monthStart(now, TOKYO)).toISOString()).toBe("2026-10-31T15:00:00.000Z");
    expect(new Date(dayStart(now, UTC)).toISOString()).toBe("2026-11-13T00:00:00.000Z");
  });

  it("shows a span in minutes, hours or days", () => {
    expect([
      shownFor(0),
      shownFor(7 * 60_000),
      shownFor(125 * 60_000),
      shownFor(3 * 86_400_000 + 4 * 3_600_000),
    ]).toEqual(["0m", "7m", "2h 05m", "3d 4h"]);
  });
});
