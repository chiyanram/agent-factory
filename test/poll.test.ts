import { describe, expect, it } from "vitest";
import { decide, format, poll, stop, type OpenLine } from "../src/core/poll.js";
import type { Changes, Forge, OpenChange } from "../src/core/forge/types.js";
import { renderPost } from "../src/core/post.js";

// At work the factory posts as the developer: "ram" writes both the agents' notes and their own replies.
const team = [
  { name: "ram", level: "maintainer" },
  { name: "lee", level: "developer" },
  { name: "gus", level: "guest" },
] as const;
const agent = (seat: "writer" | "coordinator", title: string): string => {
  const r = renderPost({ seat, title, fields: [], items: [] });
  return r.kind === "ok" ? r.text : "";
};
const n = (name: string, body: string, at: string) => ({ body, author: { name }, at });
const change = (number: number, o: Partial<OpenChange> = {}): OpenChange => ({
  number,
  head: "1234567890abcdef",
  draft: true,
  labels: [],
  pipeline: { kind: "success" },
  comments: [],
  ...o,
});
const changes = (open: readonly OpenChange[], merged: readonly number[] = []): Changes => ({ team, open, merged });
const one = (c: OpenChange): OpenLine => decide({ changes: changes([c]), label: "agent::claimed", factory: "ram" })[0] as OpenLine;

describe("decide", () => {
  it("reads claimed and needs-human from the labels", () => {
    expect(one(change(1, { labels: ["agent::claimed", "needs-human"] }))).toMatchObject({ claimed: true, needsHuman: true });
    expect(one(change(1))).toMatchObject({ claimed: false, needsHuman: false, stop: { kind: "none" }, asks: 0 });
  });

  it("an agent's ask stays open until a developer or maintainer writes; a guest's reply does not answer it", () => {
    const ask = n("ram", agent("writer", "OPEN: which currency?"), "2026-11-02T10:00:00Z");
    expect(one(change(1, { comments: [ask] })).asks).toBe(1);
    expect(one(change(1, { comments: [ask, n("gus", "EUR", "2026-11-02T11:00:00Z")] })).asks).toBe(1);
    expect(one(change(1, { comments: [ask, n("Lee", "EUR", "2026-11-02T11:00:00Z")] })).asks).toBe(0);
    expect(one(change(1, { comments: [ask, n("ram", "EUR", "2026-11-02T11:00:00Z")] })).asks).toBe(0);
  });

  it("lists merged claims, all in change-number order", () => {
    const lines = decide({ changes: changes([change(7), change(2)], [5]), label: "agent::claimed", factory: "ram" });
    expect(lines.map((l) => [l.kind, l.number])).toEqual([["open", 2], ["merged", 5], ["open", 7]]);
  });
});

describe("stop", () => {
  const readers = { factory: "ram", members: new Set(["ram", "lee"]) };
  const maintainers = new Set(["ram"]);

  it("is a maintainer's last /stop, as the first line, even under the factory's login", () => {
    const comments = [n("ram", "/stop", "2026-11-02T10:00:00Z"), n("ram", " /stop \nwait for me", "2026-11-02T12:00:00Z")];
    expect(stop({ comments, readers, maintainers })).toEqual({ kind: "stopped", at: "2026-11-02T12:00:00Z" });
  });

  it("a developer's /stop, a /stop later in a note, or a stop word in a post does not count", () => {
    const comments = [n("lee", "/stop", "2026-11-02T10:00:00Z"), n("ram", "ok\n/stop", "2026-11-02T11:00:00Z"), n("ram", agent("coordinator", "/stop"), "2026-11-02T12:00:00Z")];
    expect(stop({ comments, readers, maintainers })).toEqual({ kind: "none" });
  });
});

describe("format", () => {
  it("writes one line per change, with the forge's mark", () => {
    const line = one(change(12, { labels: ["agent::claimed"], comments: [n("ram", "/stop", "2026-11-02T10:00:00Z")] }));
    expect(format({ line, mark: "!" })).toBe("!12 head=12345678 draft=yes claimed=yes pipeline=success needs_human=no stop=2026-11-02T10:00:00Z asks=0");
    expect(format({ line: { kind: "merged", number: 9 }, mark: "#" })).toBe("#9 merged claimed=yes");
  });

  it("an unknown pipeline says what the forge said, in plain characters (#124)", () => {
    const line = one(change(3, { pipeline: { kind: "unknown", raw: "WEIRD state=x" } }));
    expect(format({ line, mark: "#" })).toContain(" pipeline=unknown:WEIRD_state_x ");
  });
});

describe("poll", () => {
  const forge = (me: Forge["me"], read: Forge["changes"]): Forge => ({ me, changes: read } as unknown as Forge);

  it("decides with the CLI's login as the factory's", async () => {
    const ask = n("lee", agent("writer", "OPEN: x"), "2026-11-02T10:00:00Z");
    const result = await poll({ forge: forge(async () => ({ kind: "ok", value: "lee" }), async () => ({ kind: "ok", value: changes([change(1, { comments: [ask] })]) })), label: "l" });
    expect(result.kind === "ok" ? (result.value[0] as OpenLine).asks : -1).toBe(1);
  });

  it("fails when the login or the changes cannot be read, never prints a partial poll", async () => {
    const failed = { kind: "failed", reason: "github: HTTP 502" } as const;
    expect(await poll({ forge: forge(async () => failed, async () => ({ kind: "ok", value: changes([]) })), label: "l" })).toEqual(failed);
    expect(await poll({ forge: forge(async () => ({ kind: "ok", value: "ram" }), async () => failed), label: "l" })).toEqual(failed);
  });
});
