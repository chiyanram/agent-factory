import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCli, type Io } from "../src/app.js";
import { doorCommand, type DoorWiring } from "../src/door-cli.js";
import { doorDir } from "../src/core/door/discord/files.js";
import { FakeDiscord, timersOf } from "./fake-discord.js";
import { tempDir } from "./temp.js";
import { fakeToken } from "./planted.js";

const SPEC =
  "# PROJ-1: a title\n\n## Intent\n\nDo the thing.\n\n## Acceptance criteria\n\n1. It works.\n\n## Design\n\nnone\n\n## Lane\n\ntiny\n";
const TOKEN = fakeToken("discord-bot");
const GUILD = "100000000000000001";
const CHANNEL = "200000000000000002";
const RAM = "300000000000000003";

const ME = { uid: process.getuid?.() ?? -1, gid: process.getgid?.() ?? -1 };

let home = "";
let out = "";
let err = "";
let loops: string[] = [];

beforeEach(() => {
  home = tempDir("factory-door-cli-");
  out = "";
  err = "";
  loops = [];
  mkdirSync(join(home, "specs", "ledger", "PROJ-1"), { recursive: true });
  writeFileSync(join(home, "specs", "ledger", "PROJ-1", "spec.md"), SPEC);
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

function io(pasted = ""): Io {
  return {
    env: { FACTORY_HOME: home },
    out: (t) => {
      out += t;
    },
    err: (t) => {
      err += t;
    },
    readSecret: async () => pasted,
    readStdin: async () => "",
    system: {
      platform: "linux",
      ...ME,
      run: async () => ({ code: 1, stdout: "", stderr: "no CLI in this test" }),
      interactive: async () => 0,
      background: async () => ({ kind: "ok", value: 4242 }),
      agent: async () => ({ code: 1, stdout: "", stderr: "" }),
    },
  };
}

const wiring: DoorWiring = {
  where: (_io, project, ticket) => ({ kind: "ok", value: { home, project, ticket } }),
  branchThere: async () => ({ kind: "ok", value: false }),
  board: async () => ({ kind: "ok", value: `the board, near ${TOKEN}` }),
  after: async (_io, project) => {
    loops.push(project);
  },
};

function plant(tokenMode = 0o600): void {
  mkdirSync(doorDir(home), { recursive: true });
  writeFileSync(join(doorDir(home), "token"), `${TOKEN}\n`);
  chmodSync(join(doorDir(home), "token"), tokenMode);
  writeFileSync(
    join(doorDir(home), "people.json"),
    JSON.stringify({ guild: GUILD, channels: { [CHANNEL]: "ledger" }, people: { [RAM]: "Ram" } }),
  );
}

function interaction(name: string, ticket?: string) {
  return {
    id: "400000000000000001",
    application_id: "500000000000000001",
    token: "interaction-token",
    type: 2,
    guild_id: GUILD,
    channel: { id: CHANNEL, type: 0 },
    member: { user: { id: RAM } },
    data: { name, options: ticket === undefined ? [] : [{ name: "ticket", type: 3, value: ticket }] },
  };
}

describe("agent-factory door discord (#731)", () => {
  it("refuses to start, and never reaches Discord, when the token file is readable by group or others", async () => {
    for (const mode of [0o640, 0o604]) {
      plant(mode);
      const fake = new FakeDiscord();
      const code = await doorCommand(["discord"], io(), wiring, { transport: () => fake, timers: timersOf(fake) });
      expect(code).toBe(1);
      expect(err).toContain("group or others");
      expect(fake.calls).toEqual([]);
      expect(fake.sockets).toEqual([]);
    }
    expect(`${out}${err}`).not.toContain(TOKEN);
  });

  it("refuses to start with no people.json", async () => {
    plant();
    rmSync(join(doorDir(home), "people.json"));
    const fake = new FakeDiscord();
    expect(await doorCommand(["discord"], io(), wiring, { transport: () => fake, timers: timersOf(fake) })).toBe(1);
    expect(fake.calls).toEqual([]);
  });

  it("answers /start and /board through the wiring, prints nothing that holds the token, and ends on a refused token", async () => {
    plant();
    const fake = new FakeDiscord();
    const running = doorCommand(["discord"], io(), wiring, { transport: () => fake, timers: timersOf(fake) });
    await vi.waitFor(() => expect(fake.sockets.length).toBe(1));
    fake.hello();
    fake.dispatch("INTERACTION_CREATE", interaction("start", "PROJ-1"));
    fake.dispatch("INTERACTION_CREATE", interaction("board"));
    await vi.waitFor(() => expect(fake.calls.filter((c) => c.method === "PATCH").length).toBe(2));
    const record: unknown = JSON.parse(readFileSync(join(home, "starts", "ledger", "PROJ-1.json"), "utf8"));
    expect(record).toMatchObject({ by: "Ram", via: "discord" });
    expect(loops).toEqual(["ledger"]);
    fake.socket.on.closed(4004);
    expect(await running).toBe(1);
    expect(out).toContain("started ledger/PROJ-1 by Ram");
    for (const text of [out, err, ...fake.calls.map((c) => JSON.stringify(c))]) {
      expect(text).not.toContain(TOKEN);
    }
  });

  it("takes only discord", async () => {
    expect(await doorCommand(["slack"], io(), wiring)).toBe(64);
  });
});

describe("agent-factory setup door-discord (#731)", () => {
  it("stores the pasted token at 0600 and never prints it", async () => {
    const code = await runCli(["setup", "door-discord"], io(TOKEN));
    expect(code).toBe(0);
    const path = join(doorDir(home), "token");
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readFileSync(path, "utf8").trim()).toBe(TOKEN);
    expect(`${out}${err}`).not.toContain(TOKEN);
  });

  it("refuses text that is not a bot token, and stores nothing", async () => {
    expect(await runCli(["setup", "door-discord"], io("hello"))).toBe(1);
    expect(existsSync(join(doorDir(home), "token"))).toBe(false);
  });
});
