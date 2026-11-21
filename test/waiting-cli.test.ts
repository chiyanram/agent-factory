import { describe, expect, it } from "vitest";
import type { Result } from "../src/core/forge/api.js";
import type { WaitingRun } from "../src/core/dispatch/tick.js";
import type { WaitingRan } from "../src/core/dispatch/waiting-pass.js";
import { waitingCommand } from "../src/waiting-cli.js";

async function ran(answer: Result<WaitingRun>): Promise<{ code: number; out: string; err: string }> {
  let out = "";
  let err = "";
  const code = await waitingCommand("ledger", {
    out: (t) => (out += t),
    err: (t) => (err += t),
    run: async () => answer,
  });
  return { code, out, err };
}

const waits = (list: readonly WaitingRan[]): Result<WaitingRun> => ({
  kind: "ok",
  value: { kind: "ran", waits: list },
});

describe("agent-factory waiting", () => {
  it("prints one line per waiting ticket, by what was done", async () => {
    const r = await ran(
      waits([
        { ticket: "12", title: "an approval", outcome: "pinged" },
        { ticket: "13", title: "grill answers", outcome: "recorded" },
        { ticket: "14", title: "a yes to push", outcome: "already" },
      ]),
    );
    expect(r).toEqual({
      code: 0,
      err: "",
      out: [
        "#12 waits for the operator (an approval): pinged",
        "#13 waits for the operator (grill answers): recorded; its own turn already pinged the operator",
        "#14 waits for the operator (a yes to push): already pinged for this label",
        "",
      ].join("\n"),
    });
  });

  it("says when no session waits", async () => {
    expect(await ran(waits([]))).toEqual({ code: 0, err: "", out: "no session waits\n" });
  });

  it("names a dry run's waits and says nothing was recorded or pinged", async () => {
    const r = await ran(waits([{ ticket: "12", title: "an approval", outcome: "dry-run" }]));
    expect(r.out).toBe("#12 waits for the operator (an approval): DRY RUN, not recorded or pinged\n");
  });

  it("exits 2 when a wait was not recorded, and the line says so", async () => {
    const r = await ran(waits([{ ticket: "12", title: "an approval", outcome: "failed" }]));
    expect(r.code).toBe(2);
    expect(r.out).toBe("#12 waits for the operator (an approval): not recorded or pinged; the log line says why\n");
  });

  it("exits 2 when the ping did not go out, and does not call it pinged", async () => {
    const r = await ran(waits([{ ticket: "12", title: "an approval", outcome: "ping-failed" }]));
    expect(r.code).toBe(2);
    expect(r.out).toBe(
      "#12 waits for the operator (an approval): recorded, but the ping did not go out; the log line says why\n",
    );
  });

  it("does nothing while a pass runs, and says to run it again once it ends, exit 0", async () => {
    expect(await ran({ kind: "ok", value: { kind: "busy" } })).toEqual({
      code: 0,
      err: "",
      out: "a pass for ledger is running; a loop's next pass pings each waiting session, else run this again once it ends\n",
    });
  });

  it("fails on stderr, exit 1, when the label or the tickets cannot be read", async () => {
    expect(await ran({ kind: "failed", reason: "github: 502" })).toEqual({
      code: 1,
      err: "agent-factory waiting: github: 502\n",
      out: "",
    });
  });
});
