import { describe, expect, it } from "vitest";
import { keyById } from "../src/core/settings/keys.js";
import { keyLines, keyPlaces, pathKey } from "../src/core/settings/lines.js";
import { partnerOf, withValue, withValues } from "../src/core/settings/write.js";

const FILE = `{
  "team": "acme@${"a".repeat(40)}",
  "gate": "make test",
  "ready": {
    "programs": ["make"],
    "timeoutMinutes": 30
  },
  "empty": {}
}
`;

function set(text: string, path: readonly string[], value: unknown): string {
  const r = withValue(text, { path, value });
  if (r.kind === "failed") {
    throw new Error(r.reason);
  }
  return r.value;
}

describe("keyPlaces", () => {
  it("gives each key's value as a span of the text, and the whole value at the empty path", () => {
    const places = keyPlaces(FILE);
    const at = places.get(pathKey(["ready", "timeoutMinutes"]));
    expect(at === undefined ? "" : FILE.slice(at.start, at.end)).toBe("30");
    const programs = places.get(pathKey(["ready", "programs"]));
    expect(programs === undefined ? "" : FILE.slice(programs.start, programs.end)).toBe('["make"]');
    expect(places.get(pathKey([]))?.start).toBe(0);
  });

  it("keeps each key's line", () => {
    expect(keyLines(FILE).get(pathKey(["ready", "timeoutMinutes"]))).toBe(6);
  });
});

describe("withValue", () => {
  it("changes only the value of a key the file holds, byte for byte elsewhere", () => {
    expect(set(FILE, ["ready", "timeoutMinutes"], 45)).toBe(
      FILE.replace('"timeoutMinutes": 30', '"timeoutMinutes": 45'),
    );
    expect(set(FILE, ["gate"], "make check")).toBe(FILE.replace('"make test"', '"make check"'));
  });

  it("inserts an absent key at the end of its object, at the file's indent", () => {
    expect(set(FILE, ["ready", "testFiles"], ["*.spec.ts"])).toBe(
      FILE.replace('"timeoutMinutes": 30\n', '"timeoutMinutes": 30,\n    "testFiles": [\n      "*.spec.ts"\n    ]\n'),
    );
  });

  it("inserts an absent key with its missing parents", () => {
    const next = set(FILE, ["policy", "tracker.comment", "mode"], "deny");
    expect(JSON.parse(next)).toMatchObject({ gate: "make test", policy: { "tracker.comment": { mode: "deny" } } });
    expect(next.startsWith(FILE.slice(0, FILE.lastIndexOf("}")).trimEnd())).toBe(true);
  });

  it("fills an empty object", () => {
    expect(set(FILE, ["empty", "x"], 1)).toBe(FILE.replace('"empty": {}', '"empty": {\n    "x": 1\n  }'));
  });

  it("follows a tab indent", () => {
    expect(set('{\n\t"gate": "a"\n}\n', ["verify"], "b")).toBe('{\n\t"gate": "a",\n\t"verify": "b"\n}\n');
  });

  it("refuses a parent that is not an object", () => {
    expect(withValue(FILE, { path: ["gate", "x"], value: 1 })).toEqual({
      kind: "failed",
      reason: "gate is not an object",
    });
  });

  it("makes several changes in turn", () => {
    const r = withValues(FILE, [
      { path: ["gate"], value: "g" },
      { path: ["verify"], value: "v" },
    ]);
    expect(r.kind === "ok" ? JSON.parse(r.value) : r).toMatchObject({ gate: "g", verify: "v" });
  });
});

describe("partnerOf", () => {
  const mode = keyById("policy.tracker.comment.mode");
  const resolvedOf = (id: string): unknown => (id.endsWith(".cap") ? 3 : "deny");

  it("names the other half of a policy point that the project file lacks, at its resolved value", () => {
    expect(mode === undefined ? "" : partnerOf(mode, {}, resolvedOf)).toEqual({
      path: ["policy", "tracker.comment", "cap"],
      value: 3,
    });
  });

  it("names none when the file holds the other half, or for a key that is not a policy point", () => {
    const held = { policy: { "tracker.comment": { cap: 1 } } };
    expect(mode === undefined ? "" : partnerOf(mode, held, resolvedOf)).toBeUndefined();
    const gate = keyById("gate");
    expect(gate === undefined ? "" : partnerOf(gate, {}, resolvedOf)).toBeUndefined();
  });
});
