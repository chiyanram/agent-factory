import { describe, expect, it } from "vitest";
import { installLine, latestRelease, newer, RELEASES_API, versionCheck } from "../src/core/init/latest.js";

describe("the installed version against the latest release (#482, row 11)", () => {
  it("compares versions by their numbers", () => {
    expect(newer("0.35.0", "0.34.1")).toBe(true);
    expect(newer("0.34.10", "0.34.9")).toBe(true);
    expect(newer("0.34.1", "0.34.1")).toBe(false);
    expect(newer("0.30.0", "0.34.1")).toBe(false);
  });

  it("says a newer release with its install line, and never fails the check", () => {
    expect(versionCheck("0.34.1", { kind: "ok", value: "0.35.0" })).toEqual({
      ok: true,
      line: `agent-factory 0.34.1; 0.35.0 is the latest release: ${installLine("0.35.0")}`,
      fix: "",
    });
    expect(versionCheck("0.34.1", { kind: "ok", value: "0.34.1" }).line).toBe(
      "agent-factory 0.34.1, the latest release",
    );
    expect(versionCheck("0.34.1", { kind: "failed", reason: "no answer" })).toMatchObject({
      ok: true,
      line: "agent-factory 0.34.1; the latest release could not be read (no answer)",
    });
  });

  it("reads the version from the release list, and says why when it cannot", async () => {
    const seen: string[] = [];
    const answer = (status: number, body: unknown) => async (url: string) => (
      seen.push(url), new Response(JSON.stringify(body), { status })
    );
    expect(await latestRelease(answer(200, { tag_name: "v0.35.0" }))).toEqual({ kind: "ok", value: "0.35.0" });
    expect(seen).toEqual([RELEASES_API]);
    expect(await latestRelease(answer(403, {}))).toEqual({ kind: "failed", reason: "the git host answered 403" });
    expect(await latestRelease(answer(200, { tag_name: "latest" }))).toMatchObject({ kind: "failed" });
    expect(
      await latestRelease(async () => {
        throw new Error("offline");
      }),
    ).toEqual({ kind: "failed", reason: "no answer" });
  });
});
