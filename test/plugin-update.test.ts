import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync, rmSync } from "node:fs";
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
    },
  });
  return { code, out, err };
}

const update = (...more: string[]) => cli(["plugin", "update", "ledger", "rulebook@chiyanram", ...more]);
const LANES_PATH = "plugins/rulebook/skills/crq/process/lanes.json";

describe("plugin update <project> <name@marketplace> (#232)", () => {
  it("fetches the plugin into the home's store, shows it, checks it and pins it; a run then finds it", async () => {
    const first = setUpMarket(home);
    const r = await update();
    expect(r).toMatchObject({ code: 0, err: "" });
    expect(r.out).toContain(`rulebook@chiyanram: not pinned -> ${first.slice(0, 12)} 1.1.0 sha256:`);
    expect(r.out).toContain("+ skills/crq/process/lanes.json");
    const pins = await readPins(home, "ledger");
    const sha256 = pins.kind === "ok" ? (pins.value["rulebook@chiyanram"]?.sha256 ?? "") : "";
    expect(pins).toEqual({ kind: "ok", value: { "rulebook@chiyanram": { commit: first, version: "1.1.0", sha256 } } });
    const dir = join(home, "plugins", "chiyanram", "rulebook", sha256);
    expect(readFileSync(join(dir, ".claude-plugin", "plugin.json"), "utf8")).toContain("rulebook");
    expect(await pinnedPlugins({ home, project: "ledger", env: GIT_ENV })).toMatchObject({
      kind: "ok",
      value: [{ dir }],
    });
    expect((await update()).out).toContain("already pinned");
  });

  it("an update that fails the check keeps the pin; a good one shows the changed files and moves it", async () => {
    const first = setUpMarket(home);
    await update();
    const loose = LANES.replaceAll('"approval": true', '"approval": false');
    expect(loose).not.toBe(LANES);
    commitMarket(home, { [LANES_PATH]: loose });
    const refused = await update();
    expect(refused.code).toBe(1);
    expect(refused.out).toContain("~ skills/crq/process/lanes.json");
    expect(refused.err).toContain("the approval floor");
    expect(refused.err).toContain(`the pin stays at ${first.slice(0, 12)}`);
    expect(JSON.parse(readFileSync(pinsPath(home, "ledger"), "utf8"))["rulebook@chiyanram"].commit).toBe(first);

    const third = commitMarket(home, { [LANES_PATH]: LANES, "plugins/rulebook/NEW.md": "x" });
    const moved = await update();
    expect(moved).toMatchObject({ code: 0, err: "" });
    expect(moved.out).toContain("+ NEW.md");
    expect(moved.out).toContain(`pinned rulebook@chiyanram at ${third.slice(0, 12)}`);
    // an older commit can be named, and moving back shows what goes
    const back = await update(first);
    expect(back.out).toContain(`-> ${first.slice(0, 12)}`);
    expect(back.out).toContain("- NEW.md");
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
