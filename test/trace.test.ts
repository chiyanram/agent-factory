import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  openTrace,
  pruneTraces,
  traceLine,
  traceName,
  TRACE_DAYS,
  NOTHING_HELD,
  traceStep,
} from "../src/core/dispatch/trace.js";
import { tempDir } from "./temp.js";

// A run's whole stream-json output is kept as its trace, beside the ticket's records, 30 days (#487).

const DAY = 24 * 60 * 60_000;
const AT = Date.parse("2026-11-13T06:07:15.123Z");
// a token prefix, joined at run time, so no secret scanner reads this file as holding a token
const TOKEN = `${["sk-ant-"].join("")}oat01-AAAAbbbbCCCCdddd`;

let home = "";
const where = () => ({ home, project: "ledger", ticket: "PROJ-1" });
const dir = () => join(home, "runs", "ledger", "PROJ-1");

beforeEach(() => {
  home = tempDir("trace-");
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

async function kept(chunks: readonly string[], max?: number) {
  const opened = await openTrace({ ...where(), kind: "writer", at: AT }, max);
  if (opened.kind !== "ok") throw new Error(opened.reason);
  for (const c of chunks) opened.value.write(c);
  return opened.value.close();
}

describe("a trace is written as the run prints (#487)", () => {
  it("keeps every line, however the output is cut into pieces, in a file named by its kind and time", async () => {
    const text = '{"type":"system","subtype":"init"}\n{"type":"assistant","message":"hi"}\n{"type":"result"}';
    const out = await kept(text.match(/.{1,5}/gs) ?? []);
    expect(out).toEqual({
      kind: "ok",
      value: { name: "writer-2026-11-13T06-07-15-123Z.jsonl", bytes: text.length + 1, cut: false },
    });
    expect(readFileSync(join(dir(), traceName({ kind: "writer", at: AT })), "utf8")).toBe(`${text}\n`);
    expect(statSync(join(dir(), "writer-2026-11-13T06-07-15-123Z.jsonl")).mode & 0o777).toBe(0o600);
  });

  it("scrubs every line: a JSON event still reads back, and plain text loses its token", async () => {
    await kept([`{"type":"assistant","text":"key ${TOKEN}"}\nplain ${TOKEN}\n`]);
    const [event = "", plain = ""] = readFileSync(join(dir(), traceName({ kind: "writer", at: AT })), "utf8").split(
      "\n",
    );
    expect(JSON.parse(event)).toEqual({ type: "assistant", text: "key [scrubbed]" });
    expect(plain).toBe("plain [scrubbed]");
    expect(traceLine("not json {")).toBe("not json {");
  });

  it("stops at the cap, and its last line says it was cut", async () => {
    const line = `{"n":"${"x".repeat(40)}"}`;
    const out = await kept([`${line}\n${line}\n${line}\n`], 100);
    expect(out).toMatchObject({ kind: "ok", value: { cut: true, bytes: line.length * 2 + 2 } });
    const lines = readFileSync(join(dir(), traceName({ kind: "writer", at: AT })), "utf8")
      .trim()
      .split("\n");
    expect(lines).toEqual([line, line, JSON.stringify({ type: "trace", cut: true, bytes: 100 })]);
  });

  it("cuts at once on a line still being printed that is past the room left, holding none of it", () => {
    const first = traceStep(NOTHING_HELD, '{"a":1}\n{"long":"', 100);
    expect(first).toEqual({ held: { partial: '{"long":"', bytes: 8, cut: false }, text: '{"a":1}\n' });
    const past = traceStep(first.held, "x".repeat(100), 100);
    expect(past).toEqual({
      held: { partial: "", bytes: 8, cut: true },
      text: `${JSON.stringify({ type: "trace", cut: true, bytes: 100 })}\n`,
    });
  });

  it("drops every piece after the cut, holding nothing, whatever its newlines", () => {
    const cut = { partial: "", bytes: 8, cut: true };
    expect(traceStep(cut, `${"y".repeat(500)}\n{"b":2}\n${"z".repeat(500)}`, 100)).toEqual({ held: cut, text: "" });
    expect(traceStep(cut, "z".repeat(500), 100)).toEqual({ held: cut, text: "" });
  });

  it("holds a line still being printed while it fits the room left, and keeps it whole at its newline", async () => {
    const opened = await openTrace({ ...where(), kind: "writer", at: AT }, 100);
    if (opened.kind !== "ok") throw new Error(opened.reason);
    opened.value.write(`{"n":"${"x".repeat(40)}`);
    opened.value.write('"}\n');
    expect(await opened.value.close()).toMatchObject({ kind: "ok", value: { cut: false, bytes: 49 } });
  });

  it("leaves no trace for a run that printed nothing, such as one whose box never started", async () => {
    expect(await kept([])).toEqual({ kind: "failed", reason: "the run printed nothing" });
    expect(readdirSync(dir())).toEqual([]);
  });

  it("refuses a ticket that is not a plain name", async () => {
    expect((await openTrace({ ...where(), ticket: "../x", kind: "writer", at: AT })).kind).toBe("failed");
  });
});

describe("traces older than 30 days are deleted (#487)", () => {
  it("deletes each trace past 30 days by the time in its name, and nothing else", async () => {
    mkdirSync(dir(), { recursive: true });
    const old = traceName({ kind: "writer", at: AT - (TRACE_DAYS + 1) * DAY });
    const oldLens = traceName({ kind: "finder", lens: "test-integrity", at: AT - 40 * DAY });
    const young = traceName({ kind: "verify", at: AT - (TRACE_DAYS - 1) * DAY });
    for (const f of [old, oldLens, young, "writer-2020-01-01T00-00-00-000Z.log", "notes.jsonl"]) {
      writeFileSync(join(dir(), f), "x\n");
    }
    writeFileSync(join(home, "runs", "ledger", "PROJ-1.jsonl"), "");
    expect(await pruneTraces({ home, project: "ledger", now: AT })).toEqual({ deleted: 2, problems: [] });
    expect(readdirSync(dir()).toSorted()).toEqual(
      ["notes.jsonl", young, "writer-2020-01-01T00-00-00-000Z.log"].toSorted(),
    );
    expect(existsSync(join(home, "runs", "ledger", "PROJ-1.jsonl"))).toBe(true);
  });

  it("deletes nothing for a project with no records, and refuses a name that is not plain", async () => {
    expect(await pruneTraces({ home, project: "ledger", now: AT })).toEqual({ deleted: 0, problems: [] });
    expect((await pruneTraces({ home, project: "../x", now: AT })).problems).toHaveLength(1);
  });
});
