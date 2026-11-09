import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ApprovalRecord } from "../src/core/approval.js";
import { approvalKey, sharedCopy, sharedNote } from "../src/core/dispatch/shared.js";
import { renderPost } from "../src/core/post.js";
import { approve } from "../src/core/approval.js";
import { specHash } from "../src/core/spec.js";
import { goAhead, readStart, start, startPath, type StartRequest } from "../src/core/start.js";
import { tempDir } from "./temp.js";

let home = "";
beforeEach(() => {
  home = tempDir("factory-start-");
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const request = (over: Partial<StartRequest> = {}): StartRequest => ({
  where: { home, project: "ledger", ticket: "PROJ-1" },
  by: "ram",
  via: "terminal",
  at: "2026-11-09T08:00:00Z",
  branch: "absent",
  confirmed: false,
  ...over,
});

describe("start (#227)", () => {
  it("records { ticket, kind: start, by, via, at } under starts/<project>/<ticket>.json", async () => {
    expect(await start(request())).toMatchObject({ kind: "started" });
    const path = join(home, "starts", "ledger", "PROJ-1.json");
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      version: 1,
      kind: "start",
      project: "ledger",
      ticket: "PROJ-1",
      by: "ram",
      via: "terminal",
      at: "2026-11-09T08:00:00Z",
    });
    expect(await readStart(request().where)).toMatchObject({ kind: "record", record: { by: "ram" } });
  });

  it("asks first when factory/<ticket> is already on the git host, and starts on the human's yes", async () => {
    const asked = await start(request({ branch: "present" }));
    expect(asked).toMatchObject({ kind: "ask", question: expect.stringContaining("factory/PROJ-1 is already") });
    expect(await readStart(request().where)).toEqual({ kind: "missing" });
    expect(await start(request({ branch: "present", confirmed: true }))).toMatchObject({ kind: "started" });
  });

  it("a START given again replaces the record with its new time", async () => {
    await start(request());
    await start(request({ at: "2026-11-09T09:00:00Z", via: "discord" }));
    expect(await readStart(request().where)).toMatchObject({
      record: { at: "2026-11-09T09:00:00Z", via: "discord" },
    });
  });

  it("refuses a name that would leave the folder, and a record that is not a START for this ticket", async () => {
    expect(startPath({ home, project: "ledger", ticket: "../x" })).toMatchObject({ kind: "refused" });
    expect(await start(request({ where: { home, project: "..", ticket: "x" } }))).toMatchObject({ kind: "refused" });
    mkdirSync(join(home, "starts", "ledger"), { recursive: true });
    const path = join(home, "starts", "ledger", "PROJ-1.json");
    for (const bad of [
      "{not json",
      JSON.stringify({
        version: 1,
        kind: "start",
        project: "ledger",
        ticket: "PROJ-2",
        by: "r",
        via: "terminal",
        at: "2026-11-09T08:00:00Z",
      }),
      JSON.stringify({
        version: 1,
        kind: "start",
        project: "ledger",
        ticket: "PROJ-1",
        by: "r",
        via: "bot",
        at: "2026-11-09T08:00:00Z",
      }),
      JSON.stringify({
        version: 1,
        kind: "approval",
        project: "ledger",
        ticket: "PROJ-1",
        by: "r",
        via: "terminal",
        at: "2026-11-09T08:00:00Z",
      }),
    ]) {
      writeFileSync(path, bad);
      expect(await readStart(request().where)).toMatchObject({ kind: "refused" });
    }
  });
});

describe("the shared copy of an approval (#227)", () => {
  const record: ApprovalRecord = {
    version: 2,
    kind: "approval",
    project: "ledger",
    ticket: "PROJ-1",
    spec_hash: "a".repeat(64),
    design_hash: "none",
    by: "ram @team",
    via: "pr",
    at: "2026-11-09T08:00:00Z",
  };

  it("is one templated line naming the human, the door and both hashes, cleaned by the posting template", () => {
    const text = renderPost(sharedNote(record));
    expect(text).toEqual({
      kind: "ok",
      text: `[coordinator] approved by ram @⁠team via pr, spec ${"a".repeat(64)}, design none`,
    });
    expect(approvalKey(record)).toBe(`${"a".repeat(64)} none 2026-11-09T08:00:00Z`);
  });

  it("is trusted only when the project's own factory identity posted it", () => {
    const rendered = renderPost(sharedNote({ ...record, design_hash: "b".repeat(64) }));
    const body = rendered.kind === "ok" ? rendered.text : "";
    const at = "2026-11-09T08:01:00Z";
    expect(sharedCopy({ body, author: { name: "Factory-Bot" }, at }, "factory-bot")).toEqual({
      by: "ram @⁠team",
      via: "pr",
      spec: "a".repeat(64),
      design: "b".repeat(64),
      at,
    });
    expect(sharedCopy({ body, author: { name: "mallory" }, at }, "factory-bot")).toBe("none");
    expect(
      sharedCopy(
        { body: "[coordinator] approved by x via bot, spec 1, design none", author: { name: "factory-bot" }, at },
        "factory-bot",
      ),
    ).toBe("none");
  });
});

describe("goAhead: what lets the build begin (#227)", () => {
  const spec = (lane: string): string => {
    const text = `# PROJ-1: t\n\n## Intent\n\nDo it.\n\n## Acceptance criteria\n\n1. It works.\n\n## Design\n\nnone\n\n## Lane\n\n${lane}\n`;
    mkdirSync(join(home, "specs", "ledger", "PROJ-1"), { recursive: true });
    writeFileSync(join(home, "specs", "ledger", "PROJ-1", "spec.md"), text);
    return text;
  };
  const where = () => request().where;

  it("an approval with no START holds: nothing runs without one", async () => {
    const feature = spec("feature");
    await approve({ where: where(), seenHash: specHash(feature), by: "ana", at: "2026-11-09T09:00:00Z" });
    expect(await goAhead(where())).toEqual({
      kind: "held",
      why: "approved, no START: a human STARTs the ticket first",
    });
    await start(request());
    expect(await goAhead(where())).toMatchObject({ kind: "go", said: "approved", by: "ana" });
  });

  it("a tiny ticket goes on its START alone; a feature ticket holds until it is approved", async () => {
    spec("tiny");
    expect(await goAhead(where())).toMatchObject({ kind: "held", why: "the approval is missing" });
    await start(request());
    expect(await goAhead(where())).toMatchObject({ kind: "go", said: "started", by: "ram" });
    const feature = spec("feature");
    expect(await goAhead(where())).toMatchObject({ kind: "held", why: expect.stringContaining("only the tiny lane") });
    await approve({ where: where(), seenHash: specHash(feature), by: "ana", at: "2026-11-09T09:00:00Z" });
    expect(await goAhead(where())).toMatchObject({ kind: "go", said: "approved", by: "ana" });
  });
});
