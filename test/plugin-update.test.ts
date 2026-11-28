import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCli } from "../src/app.js";
import { pinnedPlugins, pinsPath, readPins } from "../src/core/process/pins.js";
import { commitMarket, GIT_ENV, LANES, setUpMarket } from "./market.js";
import { tempDir } from "./temp.js";

let home = "";
beforeEach(() => {
  home = tempDir("factory-update-");
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

type Run = { readonly code: number; readonly out: string; readonly err: string };
async function cli(argv: readonly string[]): Promise<Run> {
  let out = "";
  let err = "";
  const code = await runCli(argv, {
    env: { ...GIT_ENV, FACTORY_HOME: home },
    out: (t) => (out += t),
    err: (t) => (err += t),
    readSecret: async () => "",
    readStdin: async () => "",
    system: {
      platform: "linux",
      uid: process.getuid?.() ?? -1,
      gid: process.getgid?.() ?? -1,
      run: async () => ({ code: 1, stdout: "", stderr: "no CLI in this test" }),
      interactive: async () => 0,
      background: async () => ({ kind: "failed", reason: "no background in this test" }),
      agent: async () => ({ code: 127, stdout: "", stderr: "no agent CLI in this test" }),
    },
  });
  return { code, out, err };
}

const update = (...more: string[]) => cli(["plugin", "update", "ledger", "rulebook@chiyanram", ...more]);
const LANES_PATH = "plugins/rulebook/skills/flow/process/lanes.json";
const REVIEW_PATH = "plugins/rulebook/skills/crq/references/code-review.md";
const WHY = ["--reason", "the manifest and lanes: no eval tests them"];

function storeSha(prefix: string): string {
  return readdirSync(join(home, "plugins", "chiyanram", "rulebook")).find((d) => d.startsWith(prefix)) ?? "";
}

function proveAt(sha256: string, size = "review"): void {
  const dir = join(home, "evals", "pins", "rulebook@chiyanram");
  mkdirSync(dir, { recursive: true });
  const proof = { version: 1, ref: "rulebook@chiyanram", commit: "c".repeat(40), sha256, base: null };
  const rest = { changed: [], baseline: [], size, uncovered: [], reason: "", review: null };
  writeFileSync(join(dir, `${sha256}.json`), JSON.stringify({ ...proof, ...rest }));
}

function pinOf(): Record<string, unknown> {
  return JSON.parse(readFileSync(pinsPath(home, "ledger"), "utf8"))["rulebook@chiyanram"];
}

describe("plugin update <project> <name@marketplace> (#232)", () => {
  it("fetches the plugin into the home's store, shows it and its eval size, checks it and pins it", async () => {
    const first = setUpMarket(home);
    const bare = await update();
    expect(bare.code).toBe(1);
    expect(bare.err).toContain(
      "files no eval can prove yet (.claude-plugin/plugin.json, skills/flow/process/lanes.json)",
    );
    expect(bare.err).toContain("the pin stays at not pinned");
    const r = await update(...WHY);
    expect(r).toMatchObject({ code: 0, err: "" });
    expect(r.out).toContain(`rulebook@chiyanram: not pinned -> ${first.slice(0, 12)} 1.1.0 sha256:`);
    expect(r.out).toContain("+ 1 file in skills/flow\n");
    expect(r.out).toContain("eval size: none\n");
    const pins = await readPins(home, "ledger");
    const sha256 = pins.kind === "ok" ? (pins.value["rulebook@chiyanram"]?.sha256 ?? "") : "";
    const proof = { size: "none", proven: "", reason: WHY[1] };
    expect(pins).toEqual({
      kind: "ok",
      value: { "rulebook@chiyanram": { commit: first, version: "1.1.0", sha256, proof } },
    });
    const dir = join(home, "plugins", "chiyanram", "rulebook", sha256);
    expect(readFileSync(join(dir, ".claude-plugin", "plugin.json"), "utf8")).toContain("rulebook");
    expect(await pinnedPlugins({ home, project: "ledger", env: GIT_ENV })).toMatchObject({
      kind: "ok",
      value: [{ dir }],
    });
    expect((await update()).out).toContain("already pinned");
  });

  it("a pinned plugin's process folder no longer gates a move: a lanes file that drops the floor still pins", async () => {
    const first = setUpMarket(home);
    await update(...WHY);
    const loose = LANES.replaceAll('"approval": true', '"approval": false');
    expect(loose).not.toBe(LANES);
    const second = commitMarket(home, { [LANES_PATH]: loose });
    const moved = await update(...WHY);
    expect(moved).toMatchObject({ code: 0, err: "" });
    expect(moved.out).toContain("~ skills/flow/process/lanes.json");
    expect(moved.out).toContain(`pinned rulebook@chiyanram at ${second.slice(0, 12)}`);
    const back = await update(first, ...WHY);
    expect(back.out).toContain(`-> ${first.slice(0, 12)}`);
  });

  it("moves a change to what the implementer can read only on a reason, and keeps it as unproven", async () => {
    const first = setUpMarket(home);
    await update(...WHY);
    const card = commitMarket(home, {
      [LANES_PATH]: LANES,
      "plugins/rulebook/skills/flow/process/roles/implementer.md": "x",
    });
    const bare = await update();
    expect(bare.code).toBe(1);
    expect(bare.out).toContain("eval size: writer\n  writer: skills/flow/process/roles/implementer.md\n");
    expect(bare.err).toContain("there is no implementer eval yet (#824)");
    expect(bare.err).not.toContain("run the eval first");
    expect(pinOf().commit).toBe(first);
    const typed = await update("--reason", "read by hand");
    expect(typed).toMatchObject({ code: 0, err: "" });
    expect(pinOf()).toMatchObject({ commit: card, proof: { size: "writer", proven: "", reason: "read by hand" } });
    commitMarket(home, { [LANES_PATH]: LANES, "plugins/rulebook/NEW.md": "x" });
    const unknown = await update();
    expect(unknown.out).toContain("eval size: both\n  any skill the implementer can load (counted as both): NEW.md\n");
    expect(unknown.code).toBe(1);
  });

  it("a review change needs a proof for its sha256: refused with the cost and the command, then moved", async () => {
    setUpMarket(home);
    await update(...WHY);
    const second = commitMarket(home, { [LANES_PATH]: LANES, [REVIEW_PATH]: "the review's rubric" });
    const refused = await update();
    expect(refused.code).toBe(1);
    expect(refused.out).toContain("eval size: review\n  review: skills/crq/references/code-review.md\n");
    expect(refused.err).toMatch(/no eval proof for sha256:(\w{12}) covers the review size/);
    expect(refused.err).toMatch(/targeted review pass: \d+ case\(s\), 1 run each/);
    expect(refused.err).toMatch(/cost: about \$\d+\.\d\d .*at most \$\d+\.\d\d/);
    expect(refused.err).toContain(`run the eval first: agent-factory eval pin ledger rulebook@chiyanram ${second}`);
    const sha256 = storeSha(/sha256:(\w{12}) covers/.exec(refused.err)?.[1] ?? "-");
    proveAt(sha256, "writer");
    expect((await update()).code).toBe(1);
    proveAt(sha256);
    const moved = await update();
    expect(moved).toMatchObject({ code: 0, err: "" });
    expect(pinOf()).toMatchObject({ commit: second, sha256, proof: { size: "review", proven: sha256 } });

    const docs = commitMarket(home, {
      [LANES_PATH]: LANES,
      [REVIEW_PATH]: "the review's rubric",
      "plugins/rulebook/docs/a.md": "x",
    });
    const none = await update();
    expect(none).toMatchObject({ code: 0, err: "" });
    expect(pinOf()).toMatchObject({ commit: docs, proof: { size: "none", proven: sha256 } });
  });

  it("config check warns about a pin with no eval proof and never fails on it", async () => {
    setUpMarket(home);
    await update(...WHY);
    const bare = await cli(["config", "check", "ledger"]);
    expect(bare.err).toContain("warning: rulebook@chiyanram at sha256:");
    expect(bare.err).toContain("has no eval proof (ADR-0020)");
    expect(bare.err).not.toMatch(/^error: .*eval proof/m);
    const pin = pinOf();
    proveAt(String(pin.sha256), "none");
    expect((await cli(["config", "check", "ledger"])).err).not.toContain("eval proof");
  });

  it("refuses a plugin the project does not list, a missing marketplace clone, and a bad commit", async () => {
    setUpMarket(home, ["rulebook@chiyanram", "team@acme"]);
    expect((await cli(["plugin", "update", "ledger", "other@chiyanram"])).err).toContain(
      'does not list "other@chiyanram"',
    );
    expect((await cli(["plugin", "update", "ledger", "team@acme"])).err).toContain("no marketplace clone at");
    expect((await update("nothead")).err).toContain("is not a commit");
    expect((await update("a", "b")).code).toBe(64);
    expect((await cli(["plugin", "update", "../x", "rulebook@chiyanram"])).err).toContain("not a plain project name");
  });
});
