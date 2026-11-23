import { describe, expect, it } from "vitest";
import { asksOf, initOf, namedIn, runsOf } from "../src/core/agent/ran.js";
import { NO_STREAM, streamOf } from "../src/core/dispatch/spend.js";

const REAL_INIT = JSON.stringify({
  type: "system",
  subtype: "init",
  cwd: "/run/folder",
  session_id: "00000000-0000-0000-0000-000000000000",
  tools: ["Read", "Grep", "Glob"],
  mcp_servers: [],
  model: "claude-model-id",
  permissionMode: "default",
  apiKeySource: "none",
  claude_code_version: "9.9.9",
  output_style: "default",
  uuid: "00000000-0000-0000-0000-000000000001",
});

const BARE_INIT = '{"type":"system","subtype":"init"}';
const RESULT = '{"type":"result","is_error":false,"total_cost_usd":0.1}';

describe("initOf", () => {
  it("reads the version and the model from a real init line's field names", () => {
    expect(initOf(JSON.parse(REAL_INIT))).toEqual({ version: "9.9.9", model: "claude-model-id" });
  });

  it("gives neither from a bare init event, so the record reads them as unreported", () => {
    expect(initOf(JSON.parse(BARE_INIT))).toEqual({});
  });

  it("ignores every other event", () => {
    expect(initOf(JSON.parse(RESULT))).toBeUndefined();
    expect(initOf({ type: "system", subtype: "status", model: "m" })).toBeUndefined();
    expect(initOf("text")).toBeUndefined();
  });

  it("drops a field of the wrong type", () => {
    expect(initOf({ type: "system", subtype: "init", model: 3, claude_code_version: "1.0.0" })).toEqual({
      version: "1.0.0",
    });
  });
});

describe("namedIn", () => {
  it("reads the first init event of a whole stream", () => {
    const second = REAL_INIT.replace("9.9.9", "1.1.1");
    expect(namedIn(`not json\n${REAL_INIT}\n${second}\n${RESULT}`)).toEqual({
      version: "9.9.9",
      model: "claude-model-id",
    });
  });

  it("gives neither for a stream with no init event", () => {
    expect(namedIn(RESULT)).toEqual({});
    expect(namedIn(undefined)).toEqual({});
  });
});

describe("streamOf keeps the init event", () => {
  it("keeps the first init event, even one split across two chunks", () => {
    const cut = Math.floor(REAL_INIT.length / 2);
    const first = streamOf(NO_STREAM, REAL_INIT.slice(0, cut));
    expect(first.init).toBeUndefined();
    const second = streamOf(first, `${REAL_INIT.slice(cut)}\n${REAL_INIT.replace("9.9.9", "1.1.1")}\n`);
    expect(second.init).toEqual({ version: "9.9.9", model: "claude-model-id" });
  });
});

describe("runsOf", () => {
  it("keeps entries of the right shape", () => {
    const runs = [
      { part: "logic", cli: "claude", asked: "a", version: "1.0.0", model: "m" },
      { cli: "claude", asked: "default" },
    ];
    expect(runsOf(runs)).toEqual(runs);
  });

  it("drops a wrong shape, never failing the read", () => {
    expect(runsOf("x")).toBeUndefined();
    expect(runsOf([{ cli: "claude" }])).toBeUndefined();
    expect(runsOf([{ cli: "claude", asked: "a", version: 1 }])).toBeUndefined();
    expect(runsOf(undefined)).toBeUndefined();
  });

  it("reads past a field it does not know", () => {
    expect(runsOf([{ cli: "claude", asked: "a", later: true }])).toEqual([{ cli: "claude", asked: "a" }]);
  });
});

describe("asksOf", () => {
  it("keeps a map of names to model ids", () => {
    expect(asksOf({ find: "a", rule: "b", logic: "c" })).toEqual({ find: "a", rule: "b", logic: "c" });
  });

  it("drops a wrong shape", () => {
    expect(asksOf({ writer: 3 })).toBeUndefined();
    expect(asksOf(["a"])).toBeUndefined();
    expect(asksOf("a")).toBeUndefined();
  });
});
