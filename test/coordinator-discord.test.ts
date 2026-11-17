import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmodSync, existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  accessFileProblem,
  accessProblems,
  checkDiscord,
  discordArgv,
  discordEnv,
  discordStateDir,
  ownWarning,
  stateFolderProblem,
  tokenFileProblem,
  type Entry,
} from "../src/core/coordinator-discord.js";
import { installCoordinator, startCoordinator, type Interactive } from "../src/coordinator-cli.js";
import type { CoordinatorPlaces } from "../src/core/coordinator.js";
import { tempDir } from "./temp.js";

const ME = process.getuid?.() ?? 1000;
const OPERATOR = "111111111111111111";
const SECOND = "222222222222222222";
const CHANNEL = "333333333333333333";
const TOKEN_CANARY = "MTAx.canary-bot-token.never-printed";

// the access.json the wall asks for: allowlist DMs, one project channel, its allowFrom the same mapped people
function good(): Record<string, unknown> {
  return {
    dmPolicy: "allowlist",
    allowFrom: [OPERATOR, SECOND],
    groups: { [CHANNEL]: { requireMention: false, allowFrom: [SECOND, OPERATOR] } },
    pending: {},
  };
}

describe("the --discord launch (#732 D-1)", () => {
  it("enables the plugin for this session alone and never continues or resumes an old one", () => {
    const argv = discordArgv();
    expect(argv).toEqual([
      "claude",
      "--setting-sources",
      "project",
      "--settings",
      '{"enabledPlugins":{"discord@claude-plugins-official":true}}',
      "--channels",
      "plugin:discord@claude-plugins-official",
      "--permission-mode",
      "dontAsk",
      "--autocompact",
      "200k",
    ]);
    for (const flag of ["--continue", "-c", "--resume", "-r", "--dangerously-skip-permissions"]) {
      expect(argv).not.toContain(flag);
    }
    // the plugin's permission relay stays off: no mode in which a prompt could reach it
    for (const mode of ["default", "auto", "acceptEdits", "bypassPermissions", "manual"]) {
      expect(argv).not.toContain(mode);
    }
    expect(argv.join(" ")).not.toMatch(/bypass|skip-permissions/);
  });

  it("gives each project its own state folder, in static mode, and drops a bot token from the caller's env", () => {
    const dir = discordStateDir("/home/coord", "ledger");
    expect(dir).toBe("/home/coord/.claude/channels/discord-ledger");
    const env = discordEnv({ PATH: "/usr/bin", DISCORD_BOT_TOKEN: TOKEN_CANARY }, dir);
    expect(env).toEqual({ PATH: "/usr/bin", DISCORD_ACCESS_MODE: "static", DISCORD_STATE_DIR: dir });
  });
});

describe("access.json, held to #548 S-2 (accessProblems)", () => {
  it("passes the safe file", () => {
    expect(accessProblems(good())).toEqual([]);
    expect(accessProblems({ ...good(), pending: undefined })).toEqual([]);
  });

  it("refuses an empty channel allowFrom: anyone in the channel could allow a tool call by text", () => {
    const open = { ...good(), groups: { [CHANNEL]: { requireMention: false, allowFrom: [] } } };
    expect(accessProblems(open)).toEqual([expect.stringContaining("anyone in the channel")]);
    const none = { ...good(), groups: { [CHANNEL]: { requireMention: false } } };
    expect(accessProblems(none)).toEqual([expect.stringContaining("must list the mapped people")]);
  });

  it("refuses a channel allowFrom that is not the same people as the DM allowFrom", () => {
    const more = { ...good(), groups: { [CHANNEL]: { allowFrom: [OPERATOR, SECOND, "444444444444444444"] } } };
    const fewer = { ...good(), groups: { [CHANNEL]: { allowFrom: [OPERATOR] } } };
    for (const access of [more, fewer]) {
      expect(accessProblems(access)).toEqual([expect.stringContaining("same people as allowFrom")]);
    }
  });

  it("refuses pairing, an empty DM list, two channels, a bad channel id, pending codes and a non-object", () => {
    expect(accessProblems({ ...good(), dmPolicy: "pairing" })).toEqual(["dmPolicy must be allowlist"]);
    expect(accessProblems({ ...good(), allowFrom: [] })).toContain("allowFrom must list the mapped people's user ids");
    expect(accessProblems({ ...good(), allowFrom: ["alice"] })).toContain(
      "allowFrom must list the mapped people's user ids",
    );
    const two = { ...good(), groups: { [CHANNEL]: { allowFrom: [OPERATOR] }, "555555555555555555": {} } };
    expect(accessProblems(two)).toEqual([expect.stringContaining("exactly one channel")]);
    expect(accessProblems({ ...good(), groups: { general: { allowFrom: [OPERATOR, SECOND] } } })).toEqual([
      expect.stringContaining("not a channel id"),
    ]);
    expect(accessProblems({ ...good(), pending: { ab12c: { senderId: "9" } } })).toEqual([
      expect.stringContaining("pending must be empty"),
    ]);
    expect(accessProblems({ ...good(), pending: "x" })).toEqual([expect.stringContaining("pending must be empty")]);
    expect(accessProblems([])).toEqual(["it is not a JSON object"]);
  });
});

describe("the state folder's files, by their stat", () => {
  // a session user other than root, whatever user runs the suite
  const USER = 1000;
  const entry = (over: Partial<Entry>): Entry => ({
    mode: 0o100600,
    uid: USER,
    link: false,
    file: true,
    folder: false,
    ...over,
  });

  it("refuses a .env that is missing, a link, another user's or readable by group or others", () => {
    expect(tokenFileProblem("/s/.env", undefined, USER)).toBe("/s/.env is missing");
    expect(tokenFileProblem("/s/.env", entry({ link: true }), USER)).toContain("not a plain file");
    expect(tokenFileProblem("/s/.env", entry({ uid: USER + 1 }), USER)).toContain("belongs to another user");
    expect(tokenFileProblem("/s/.env", entry({ mode: 0o100640 }), USER)).toContain("mode 640");
    expect(tokenFileProblem("/s/.env", entry({ mode: 0o100604 }), USER)).toContain("readable by group or others");
    expect(tokenFileProblem("/s/.env", entry({}), USER)).toBeUndefined();
  });

  it("refuses an access.json or folder that group or others can write; warns when the session's user owns it", () => {
    expect(accessFileProblem("/s/access.json", entry({ mode: 0o100664 }), "file")).toContain("writable by group");
    expect(accessFileProblem("/s/access.json", entry({ link: true }), "file")).toContain("not a plain file");
    expect(accessFileProblem("/s", entry({ mode: 0o40777, file: false, folder: true }), "folder")).toContain(
      "mode 777",
    );
    const folder = entry({ mode: 0o40700, file: false, folder: true });
    expect(stateFolderProblem("/s", folder, USER)).toBeUndefined();
    // a folder the plugin cannot write leaves the coordinator deaf with every check green
    expect(stateFolderProblem("/s", { ...folder, uid: 0 }, USER)).toContain("belongs to another user");
    const root = entry({ mode: 0o100444, uid: 0 });
    expect(accessFileProblem("/s/access.json", root, "file")).toBeUndefined();
    expect(ownWarning("/s/access.json", root, USER)).toBeUndefined();
    expect(ownWarning("/s/access.json", entry({ mode: 0o100644 }), USER)).toContain("make it root's, mode 444");
  });
});

describe("checkDiscord and the launch, on planted files", () => {
  let home = "";
  let dir = "";
  beforeEach(() => {
    home = tempDir("factory-coord-discord-");
    dir = discordStateDir(home, "ledger");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  // each plant starts from no files: a read-only access.json from an earlier plant cannot be written over by a
  // user other than root
  const plant = (access: unknown = good(), tokenMode = 0o600): void => {
    rmSync(join(dir, ".env"), { force: true });
    rmSync(join(dir, "access.json"), { force: true });
    writeFileSync(join(dir, ".env"), `DISCORD_BOT_TOKEN=${TOKEN_CANARY}\n`, { mode: tokenMode });
    chmodSync(join(dir, ".env"), tokenMode);
    writeFileSync(join(dir, "access.json"), typeof access === "string" ? access : JSON.stringify(access));
    chmodSync(join(dir, "access.json"), 0o444);
  };

  it("passes the safe files, warning that the session's own user owns access.json", async () => {
    plant();
    expect(await checkDiscord(dir, ME)).toEqual({
      kind: "ok",
      value: [expect.stringContaining("belongs to the coordinator's own user")],
    });
  });

  it("refuses a loose access.json, bad JSON and a group-readable .env, and no reason holds the token", async () => {
    plant({ ...good(), groups: { [CHANNEL]: { allowFrom: [] } } });
    const loose = await checkDiscord(dir, ME);
    expect(loose).toMatchObject({ kind: "failed", reason: expect.stringContaining("anyone in the channel") });
    plant("{not json");
    expect(await checkDiscord(dir, ME)).toMatchObject({ reason: expect.stringContaining("not valid JSON") });
    plant(good(), 0o640);
    const readable = await checkDiscord(dir, ME);
    expect(readable).toMatchObject({ reason: expect.stringContaining("readable by group or others") });
    for (const r of [loose, readable]) {
      expect(JSON.stringify(r)).not.toContain(TOKEN_CANARY);
    }
  });

  it("refuses a missing .env or access.json, and an access.json put there as a link", async () => {
    expect(await checkDiscord(dir, ME)).toMatchObject({ reason: expect.stringContaining(".env is missing") });
    plant();
    rmSync(join(dir, "access.json"));
    expect(await checkDiscord(dir, ME)).toMatchObject({ reason: expect.stringContaining("access.json is missing") });
    const elsewhere = join(home, "elsewhere.json");
    writeFileSync(elsewhere, JSON.stringify(good()));
    symlinkSync(elsewhere, join(dir, "access.json"));
    expect(await checkDiscord(dir, ME)).toMatchObject({ reason: expect.stringContaining("not a plain file") });
  });

  const places = (): CoordinatorPlaces => ({ pkg: "/opt/agent-factory", factoryHome: home, botHome: "/home/factory" });
  const launch = { kind: "discord", project: "ledger", home: "", uid: ME } as const;

  it("starts Claude with the plugin, static mode and its state folder; refuses before Claude when a file is loose", async () => {
    await installCoordinator(places());
    const calls: Parameters<Interactive>[0][] = [];
    const err: string[] = [];
    const io = {
      env: { PATH: "/usr/bin", DISCORD_BOT_TOKEN: TOKEN_CANARY },
      out: () => undefined,
      err: (t: string) => void err.push(t),
      interactive: async (call: Parameters<Interactive>[0]) => (calls.push(call), 0),
      seat: async () => ({ kind: "missing", reason: "no claude-coordinator token" }) as const,
    };
    plant({ ...good(), dmPolicy: "pairing" });
    expect(await startCoordinator(places(), { ...launch, home }, io)).toBe(1);
    expect(calls).toEqual([]);
    expect(err.join("")).toContain("dmPolicy must be allowlist");
    plant();
    err.length = 0;
    expect(await startCoordinator(places(), { ...launch, home }, io)).toBe(0);
    expect(calls).toEqual([
      {
        bin: "claude",
        args: discordArgv().slice(1),
        cwd: join(home, "coordinator"),
        env: { PATH: "/usr/bin", DISCORD_ACCESS_MODE: "static", DISCORD_STATE_DIR: dir },
        // the supervisor's: it ends the session at the reset size
        signal: expect.any(AbortSignal),
      },
    ]);
    // a Discord session with no seat token of its own says the chat shares the runs' limit
    expect(err.join("")).toContain("shares the runs' limit");
    expect(err.join("")).toContain("belongs to the coordinator's own user");
  });

  it("refuses the Discord launch on a seat token it cannot use, so the chat never shares the runs' limit unawares", async () => {
    await installCoordinator(places());
    plant();
    const calls: Parameters<Interactive>[0][] = [];
    const err: string[] = [];
    const io = {
      env: { PATH: "/usr/bin" },
      out: () => undefined,
      err: (t: string) => void err.push(t),
      interactive: async (call: Parameters<Interactive>[0]) => (calls.push(call), 0),
      seat: async () => ({ kind: "refused", reason: "the coordinator's seat token: expired" }) as const,
    };
    expect(await startCoordinator(places(), { ...launch, home }, io)).toBe(1);
    expect(calls).toEqual([]);
    expect(err.join("")).toContain("seat token: expired");
  });

  it("ends the session after the turn that reached the reset size, and starts a fresh one from the brief", async () => {
    await installCoordinator(places());
    plant();
    const calls: Parameters<Interactive>[0][] = [];
    const err: string[] = [];
    const marker = join(home, ".local", "state", "agent-factory", "coordinator-ledger.reset");
    // a marker left from before the launch is not a reset
    mkdirSync(join(home, ".local", "state", "agent-factory"), { recursive: true });
    writeFileSync(marker, "1\n");
    const io = {
      env: { PATH: "/usr/bin" },
      out: () => undefined,
      err: (t: string) => void err.push(t),
      pollMs: 5,
      seat: async () => ({ kind: "missing", reason: "none" }) as const,
      // the first session runs until it is aborted, after its Stop hook wrote the marker; the second ends by itself
      interactive: (call: Parameters<Interactive>[0]) => {
        calls.push(call);
        if (calls.length > 1) {
          return Promise.resolve(0);
        }
        writeFileSync(marker, "120000\n");
        return new Promise<number>((resolve) => call.signal?.addEventListener("abort", () => resolve(143)));
      },
    };
    expect(await startCoordinator(places(), { ...launch, home }, io)).toBe(0);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.args).toEqual(discordArgv().slice(1));
    expect(err.join("")).toContain("starting a fresh session from the handoff note");
    expect(existsSync(marker)).toBe(false);
  });
});
