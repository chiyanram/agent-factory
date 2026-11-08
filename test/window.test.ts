import { describe, expect, it } from "vitest";
import { POLL_MS, WINDOW_SECONDS, watched } from "../src/core/writer/window.js";

const NEVER = new Promise<never>(() => {});
// a watch that polls this often has missed its window: it fails by name, not by running out of memory
const MAX_POLLS = 100;

// a wait that ends at once for a poll, and never for the completion window unless `window` says so
function clock(window: "ends" | "never" = "ends") {
  const waited: number[] = [];
  const wait = (ms: number): Promise<void> => {
    waited.push(ms);
    if (waited.length > MAX_POLLS) return Promise.reject(new Error(`still watching after ${MAX_POLLS} polls`));
    return ms === WINDOW_SECONDS * 1000 && window === "never" ? NEVER : Promise.resolve();
  };
  return { waited, wait };
}

describe("watched: the completion window (#182)", () => {
  it("returns the run's end when it ends before any report, and never opens the window", async () => {
    const c = clock();
    const seen = await watched({ running: Promise.resolve("exit 0"), reported: async () => false, wait: c.wait });
    expect(seen).toEqual({ kind: "ended", value: "exit 0" });
    expect(c.waited).not.toContain(WINDOW_SECONDS * 1000);
  });

  it("calls a run hung when it is still running 60s after a report the schema accepts", async () => {
    const c = clock();
    let asked = 0;
    const reported = async () => (asked++, asked >= 3);
    const seen = await watched({ running: NEVER, reported, wait: c.wait });
    expect(seen).toEqual({ kind: "hung" });
    expect(c.waited).toEqual([POLL_MS, POLL_MS, POLL_MS, WINDOW_SECONDS * 1000]);
  });

  it("returns the run's end when it exits inside the window", async () => {
    const c = clock("never");
    let exit: (value: string) => void = () => {};
    const running = new Promise<string>((resolve) => {
      exit = resolve;
    });
    const reported = async () => (exit("exit 0"), true);
    expect(await watched({ running, reported, wait: c.wait })).toEqual({ kind: "ended", value: "exit 0" });
  });

  it("keeps polling while there is no report, so a run without one waits out its own timeout", async () => {
    let polls = 0;
    let stop: (value: string) => void = () => {};
    const running = new Promise<string>((resolve) => {
      stop = resolve;
    });
    const wait = async () => {
      polls++;
      if (polls === 5) stop("timed out");
    };
    expect(await watched({ running, reported: async () => false, wait })).toEqual({
      kind: "ended",
      value: "timed out",
    });
    expect(polls).toBeGreaterThanOrEqual(5);
  });
});
