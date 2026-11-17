import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { claudeConfigDir, pluginProblem, pluginState, stateLine } from "../src/core/agent/claude-plugins.js";
import { tempDir } from "./temp.js";

const ID = "discord@claude-plugins-official";

describe("a Claude Code plugin is enabled at user scope (#555)", () => {
  let root = "";
  let config = "";
  let clone = "";
  beforeEach(() => {
    root = tempDir("factory-claude-plugins-");
    config = join(root, "home", ".claude");
    clone = join(root, "clone");
    mkdirSync(join(config, "plugins"), { recursive: true });
    mkdirSync(clone);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const places = () => ({ env: { HOME: join(root, "home") }, folders: [clone] });
  const userSettings = (value: unknown): void => {
    writeFileSync(join(config, "settings.json"), typeof value === "string" ? value : JSON.stringify(value));
  };
  // installed_plugins.json as Claude Code 2.1.326 writes it
  const installed = (scope = "user"): void => {
    writeFileSync(
      join(config, "plugins", "installed_plugins.json"),
      JSON.stringify({ version: 2, plugins: { [ID]: [{ scope, installPath: "/x", version: "0.0.1" }] } }),
    );
  };
  const folderSettings = (folder: string, file: string, value: unknown): void => {
    mkdirSync(join(folder, ".claude"), { recursive: true });
    writeFileSync(join(folder, ".claude", file), JSON.stringify(value));
  };

  it("is on when the user file enables it and a user install is recorded", async () => {
    userSettings({ enabledPlugins: { [ID]: true } });
    installed();
    const state = await pluginState(ID, places());
    expect(state).toEqual({ kind: "on", file: join(config, "settings.json") });
    expect(pluginProblem(ID, state)).toBe("");
    expect(stateLine(ID, state)).toBe(`claude plugin ${ID}: on (user, ${join(config, "settings.json")})`);
  });

  it("refuses it off, naming the file and the enable at user scope", async () => {
    userSettings({ enabledPlugins: { [ID]: false } });
    installed();
    const state = await pluginState(ID, places());
    expect(state).toMatchObject({ kind: "off", fix: `claude plugin enable ${ID} --scope user` });
    expect(pluginProblem(ID, state)).toContain(join(config, "settings.json"));
  });

  it("refuses it missing: no settings file, no key, or no user install recorded", async () => {
    const fix = `claude plugin install ${ID} --scope user`;
    expect(await pluginState(ID, places())).toMatchObject({ kind: "missing", fix });
    userSettings({ enabledPlugins: { "other@x": true } });
    installed();
    expect(await pluginState(ID, places())).toMatchObject({ kind: "missing", fix });
    userSettings({ enabledPlugins: { [ID]: true } });
    rmSync(join(config, "plugins", "installed_plugins.json"));
    expect(await pluginState(ID, places())).toMatchObject({ kind: "missing", fix });
    installed("project");
    expect(await pluginState(ID, places())).toMatchObject({ kind: "missing", fix });
  });

  it("refuses it at project or local scope in a folder, even while the user scope has it on", async () => {
    userSettings({ enabledPlugins: { [ID]: true } });
    installed();
    for (const file of ["settings.json", "settings.local.json"]) {
      folderSettings(clone, file, { enabledPlugins: { [ID]: true } });
      const state = await pluginState(ID, places());
      expect(state).toMatchObject({ kind: "project", file: join(clone, ".claude", file) });
      expect(pluginProblem(ID, state)).toContain(`remove enabledPlugins.${ID} from ${join(clone, ".claude", file)}`);
      rmSync(join(clone, ".claude"), { recursive: true });
    }
    folderSettings(clone, "settings.json", { enabledPlugins: { [ID]: false } });
    expect(await pluginState(ID, places())).toMatchObject({ kind: "project" });
  });

  it("reads CLAUDE_CONFIG_DIR in place of ~/.claude", async () => {
    userSettings({ enabledPlugins: { [ID]: true } });
    installed();
    const other = join(root, "cfg");
    mkdirSync(other);
    const env = { HOME: join(root, "home"), CLAUDE_CONFIG_DIR: other };
    expect(claudeConfigDir(env)).toBe(other);
    expect(await pluginState(ID, { env, folders: [] })).toMatchObject({ kind: "missing" });
  });

  it("refuses a settings file that is not JSON, naming it", async () => {
    userSettings("{not json");
    installed();
    const state = await pluginState(ID, places());
    expect(state).toMatchObject({ kind: "unreadable" });
    expect(pluginProblem(ID, state)).toContain(join(config, "settings.json"));
    userSettings({ enabledPlugins: { [ID]: true } });
    folderSettings(clone, "settings.json", {});
    writeFileSync(join(clone, ".claude", "settings.json"), "[");
    expect(pluginProblem(ID, await pluginState(ID, places()))).toContain(join(clone, ".claude", "settings.json"));
  });

  it("names a settings file it cannot read as unreadable, never as bad JSON to remove", async () => {
    mkdirSync(join(config, "settings.json"));
    const state = await pluginState(ID, places());
    expect(state).toMatchObject({ kind: "unreadable", fix: `let this user read ${join(config, "settings.json")}` });
    expect(pluginProblem(ID, state)).toContain("EISDIR");
  });
});
