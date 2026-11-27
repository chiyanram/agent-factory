import { describe, expect, it } from "vitest";
import { END_REASONS, isEndReason } from "../src/core/end-reason.js";

describe("the closed list of end reasons", () => {
  it("holds the twelve reasons a run can end with", () => {
    expect(END_REASONS).toEqual([
      "done",
      "asked",
      "blocked",
      "setup_refused",
      "launch_failed",
      "timed_out",
      "stalled",
      "usage_limit",
      "output_invalid",
      "oom_killed",
      "stopped",
      "unknown",
    ]);
  });

  it("takes only a value on the list", () => {
    expect(END_REASONS.every(isEndReason)).toBe(true);
    expect(["no_room", "failed", "", 3, undefined].some(isEndReason)).toBe(false);
  });
});
