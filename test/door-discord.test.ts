import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { specHash } from "../src/core/spec.js";
import type { Result } from "../src/core/forge/api.js";
import { wallProblems } from "../src/core/coordinator.js";
import { CONFIRM_MS, discordDoor, type DoorDeps } from "../src/core/door/discord/door.js";
import { INTENTS, openGateway, scrubberOf, type GatewaySetup } from "../src/core/door/discord/gateway.js";
import { FakeDiscord, timersOf } from "./fake-discord.js";
import { readDoorConfig, readDoorToken, storeDoorToken, doorDir } from "../src/core/door/discord/files.js";
import { field } from "../src/core/human-record.js";
import { tempDir } from "./temp.js";

// The Discord door (ADR-0023 D4): a code-only bot that writes a START or an approval only through the door seam,
// for a person its own check named from people.json. Every Discord call goes through a fake transport, so no test
// reaches the network.

const SPEC = [
  "# PROJ-1: renewals refuse a reserved loan",
  "",
  "## Intent",
  "",
  "A member cannot renew a loan someone else has reserved.",
  "",
  "## Acceptance criteria",
  "",
  "1. Renewing a reserved loan answers 409 Conflict.",
  "",
  "## Design",
  "",
  "See design.md.",
  "",
  "## Lane",
  "",
  "feature",
  "",
].join("\n");
const DESIGN = "# Design\n\nA reservation check in RenewalService.\n";

const GUILD = "100000000000000001";
const CHANNEL = "200000000000000002";
const OTHER_CHANNEL = "200000000000000003";
const THREAD = "200000000000000009";
const RAM = "300000000000000003";
const ALICE = "300000000000000004";
const STRANGER = "300000000000000005";
const APP = "500000000000000001";
// a planted bot token in the shape Discord gives one, joined at run time so the source holds no token-shaped string
const TOKEN = ["MTIzNDU2Nzg5MDEyMzQ1Njc4OQ", "GaBcDe", "abcdefghijklmnopqrstuvwxyz0123456789AB"].join(".");

let home = "";
let now = 0;
let nonces = 0;
let branch: Result<boolean> = { kind: "ok", value: false };
let after: string[] = [];

const specDir = (): string => join(home, "specs", "ledger", "PROJ-1");
const records = (): readonly string[] =>
  ["starts", "approvals"].filter((dir) => existsSync(join(home, dir, "ledger", "PROJ-1.json")));

beforeEach(() => {
  home = tempDir("factory-door-discord-");
  mkdirSync(specDir(), { recursive: true });
  writeFileSync(join(specDir(), "spec.md"), SPEC);
  writeFileSync(join(specDir(), "design.md"), DESIGN);
  now = Date.parse("2026-11-17T10:00:00Z");
  nonces = 0;
  branch = { kind: "ok", value: false };
  after = [];
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

function deps(over: Partial<DoorDeps> = {}): DoorDeps {
  return {
    config: { guild: GUILD, channels: { [CHANNEL]: "ledger" }, people: { [RAM]: "Ram", [ALICE]: "Alice" } },
    env: {},
    now: () => now,
    nonce: () => String(++nonces).padStart(32, "0"),
    scrub: scrubberOf(TOKEN),
    open: async (project) => ({
      kind: "ok",
      value: {
        home,
        specs: (ticket) => ({ kind: "ok", value: { home, project, ticket } }),
        branchThere: async () => branch,
        board: async () => ({ kind: "ok", value: `needs you\n  ${project} PROJ-1 waits on Ram` }),
        after: async () => {
          after.push(project);
        },
      },
    }),
    ...over,
  };
}

// Who : who acts, and where; each field left out is the mapped default, and guild: undefined is a direct message
type Who = {
  readonly user?: string;
  readonly bot?: true;
  readonly guild?: string | undefined;
  readonly channel?: string;
  readonly parent?: string;
};

const DEFAULTS = { user: RAM, guild: GUILD, channel: CHANNEL } as const;

// channelOf : the interaction's channel object: a thread (type 11) when it has a parent
function channelOf(id: string, parent: string | undefined) {
  return parent === undefined ? { id, type: 0 } : { id, type: 11, parent_id: parent };
}

function base(given: Who) {
  const who = { ...DEFAULTS, ...given };
  return {
    id: "400000000000000001",
    application_id: APP,
    token: "interaction-token",
    guild_id: who.guild,
    channel_id: who.channel,
    channel: channelOf(who.channel, who.parent),
    member: { user: { id: who.user, username: "x", bot: who.bot } },
  };
}

function command(name: string, ticket: string | undefined, who: Who = {}) {
  const options = ticket === undefined ? [] : [{ name: "ticket", type: 3, value: ticket }];
  return { ...base(who), type: 2, data: { id: "600000000000000001", name, type: 1, options } };
}

function click(customId: string, who: Who = {}) {
  return { ...base(who), type: 3, data: { custom_id: customId, component_type: 2 } };
}

type Shown = { readonly text: string; readonly confirm?: string };

function confirmOf(reply: Shown): string {
  if (reply.confirm === undefined) {
    throw new Error(`no Confirm in: ${reply.text}`);
  }
  return reply.confirm;
}

const refused = (reply: Shown): void => expect(reply.text).toMatch(/^refused: /);

describe("the Discord door's check: who may give their word (#731)", () => {
  it("writes a START for a mapped person in the project's channel, with via discord, and starts the loop", async () => {
    const reply = await discordDoor(deps()).handle(command("start", "PROJ-1"));
    expect(reply.text).toContain("started ledger/PROJ-1 by Ram");
    const record: unknown = JSON.parse(readFileSync(join(home, "starts", "ledger", "PROJ-1.json"), "utf8"));
    expect(record).toMatchObject({ by: "Ram", via: "discord", ticket: "PROJ-1", project: "ledger" });
    expect(after).toEqual(["ledger"]);
  });

  it("takes a thread through its parent channel's project", async () => {
    const reply = await discordDoor(deps()).handle(command("start", "PROJ-1", { channel: THREAD, parent: CHANNEL }));
    expect(reply.text).toContain("started ledger/PROJ-1");
  });

  it("refuses a bot user, even one whose id is mapped", async () => {
    const reply = await discordDoor(deps()).handle(command("start", "PROJ-1", { bot: true }));
    refused(reply);
    expect(reply.text).toContain("bot");
    expect(records()).toEqual([]);
  });

  it("refuses an unmapped user id", async () => {
    const reply = await discordDoor(deps()).handle(command("start", "PROJ-1", { user: STRANGER }));
    refused(reply);
    expect(records()).toEqual([]);
  });

  it("refuses an unknown guild, and a direct message that has none", async () => {
    const door = discordDoor(deps());
    refused(await door.handle(command("start", "PROJ-1", { guild: "100000000000000099" })));
    refused(await door.handle(command("start", "PROJ-1", { guild: undefined })));
    expect(records()).toEqual([]);
  });

  it("refuses a channel outside the project's, and a thread whose parent is not the project's", async () => {
    const door = discordDoor(deps());
    refused(await door.handle(command("start", "PROJ-1", { channel: OTHER_CHANNEL })));
    refused(await door.handle(command("start", "PROJ-1", { channel: THREAD, parent: OTHER_CHANNEL })));
    expect(records()).toEqual([]);
  });

  it("refuses a ticket that is not a plain name", async () => {
    refused(await discordDoor(deps()).handle(command("start", "../PROJ-1")));
    expect(records()).toEqual([]);
  });

  it("refuses when the model-run marker is set, through the seam, and writes nothing", async () => {
    const door = discordDoor(deps({ env: { CLAUDECODE: "1" } }));
    const reply = await door.handle(command("start", "PROJ-1"));
    refused(reply);
    expect(reply.text).toContain("model run");
    const shown = await door.handle(command("approve", "PROJ-1"));
    refused(await door.handle(click(confirmOf(shown))));
    expect(records()).toEqual([]);
    expect(after).toEqual([]);
  });
});

describe("/start asks first when the ticket's branch is on the git host (#731)", () => {
  it("answers with a Confirm, and STARTs only on the same person's Confirm", async () => {
    branch = { kind: "ok", value: true };
    const door = discordDoor(deps());
    const asked = await door.handle(command("start", "PROJ-1"));
    expect(asked.text).toContain("factory/PROJ-1 is already on the git host");
    expect(records()).toEqual([]);
    refused(await door.handle(click(confirmOf(asked), { user: ALICE })));
    expect(records()).toEqual([]);
    const done = await door.handle(click(confirmOf(asked)));
    expect(done.text).toContain("started ledger/PROJ-1 by Ram");
    expect(records()).toEqual(["starts"]);
  });

  it("refuses when the git host cannot say whether the branch is there", async () => {
    branch = { kind: "failed", reason: "the git host did not answer" };
    refused(await discordDoor(deps()).handle(command("start", "PROJ-1")));
    expect(records()).toEqual([]);
  });
});

describe("/approve binds the hashes the person was shown (#731)", () => {
  it("shows the lane, both full hashes and both texts, then approves exactly those on Confirm", async () => {
    const door = discordDoor(deps());
    const shown = await door.handle(command("approve", "PROJ-1"));
    expect(shown.text).toContain("lane feature");
    expect(shown.text).toContain(specHash(SPEC));
    expect(shown.text).toContain(specHash(DESIGN));
    expect(shown.files.map((f) => f.name)).toEqual(["PROJ-1-spec.md", "PROJ-1-design.md"]);
    expect(shown.files[0]?.text).toBe(SPEC);
    expect(records()).toEqual([]);
    const done = await door.handle(click(confirmOf(shown)));
    expect(done.text).toContain("approved ledger/PROJ-1");
    const record: unknown = JSON.parse(readFileSync(join(home, "approvals", "ledger", "PROJ-1.json"), "utf8"));
    expect(record).toMatchObject({
      by: "Ram",
      via: "discord",
      spec_hash: specHash(SPEC),
      design_hash: specHash(DESIGN),
    });
    expect(after).toEqual(["ledger"]);
  });

  it("refuses a Confirm clicked by a different person, and the right person can still confirm", async () => {
    const door = discordDoor(deps());
    const shown = await door.handle(command("approve", "PROJ-1"));
    const other = await door.handle(click(confirmOf(shown), { user: ALICE }));
    refused(other);
    expect(other.text).toContain("only the person who ran /approve");
    expect(records()).toEqual([]);
    expect((await door.handle(click(confirmOf(shown)))).text).toContain("approved");
  });

  it("refuses a stale spec: the spec edited between /approve and Confirm", async () => {
    const door = discordDoor(deps());
    const shown = await door.handle(command("approve", "PROJ-1"));
    writeFileSync(join(specDir(), "spec.md"), SPEC.replace("409 Conflict", "423 Locked"));
    const reply = await door.handle(click(confirmOf(shown)));
    refused(reply);
    expect(reply.text).toContain("spec's hash is now");
    expect(records()).toEqual([]);
  });

  it("refuses a stale design: the design edited between /approve and Confirm", async () => {
    const door = discordDoor(deps());
    const shown = await door.handle(command("approve", "PROJ-1"));
    writeFileSync(join(specDir(), "design.md"), `${DESIGN}\nAnd a second check.\n`);
    const reply = await door.handle(click(confirmOf(shown)));
    refused(reply);
    expect(reply.text).toContain("design's hash is now");
    expect(records()).toEqual([]);
  });

  it("refuses a nonce past its 10 minutes, and an unknown one", async () => {
    const door = discordDoor(deps());
    const shown = await door.handle(command("approve", "PROJ-1"));
    now += CONFIRM_MS + 1000;
    const late = await door.handle(click(confirmOf(shown)));
    refused(late);
    expect(late.text).toContain("run /approve again");
    refused(await door.handle(click(`confirm:${"f".repeat(32)}`)));
    refused(await door.handle(click("something-else")));
    expect(records()).toEqual([]);
    expect(CONFIRM_MS).toBe(10 * 60 * 1000);
  });

  it("uses a nonce once", async () => {
    const door = discordDoor(deps());
    const shown = await door.handle(command("approve", "PROJ-1"));
    expect((await door.handle(click(confirmOf(shown)))).text).toContain("approved");
    refused(await door.handle(click(confirmOf(shown))));
  });

  it("refuses /approve with no spec", async () => {
    rmSync(join(specDir(), "spec.md"));
    const reply = await discordDoor(deps()).handle(command("approve", "PROJ-1"));
    refused(reply);
    expect(reply.confirm).toBeUndefined();
  });

  it("binds none when the ticket has no design", async () => {
    rmSync(join(specDir(), "design.md"));
    const door = discordDoor(deps());
    const shown = await door.handle(command("approve", "PROJ-1"));
    expect(shown.files.map((f) => f.name)).toEqual(["PROJ-1-spec.md"]);
    await door.handle(click(confirmOf(shown)));
    const record: unknown = JSON.parse(readFileSync(join(home, "approvals", "ledger", "PROJ-1.json"), "utf8"));
    expect(record).toMatchObject({ design_hash: "none" });
  });
});

describe("/board is read only (#731)", () => {
  it("answers the project's board and writes nothing", async () => {
    const reply = await discordDoor(deps()).handle(command("board", undefined));
    expect(reply.text).toContain("ledger PROJ-1 waits on Ram");
    expect(records()).toEqual([]);
  });

  it("refuses waive, merge and any other command: they stay at the terminal", async () => {
    const door = discordDoor(deps());
    for (const name of ["waive", "merge", "coordinator"]) {
      refused(await door.handle(command(name, "PROJ-1")));
    }
    expect(records()).toEqual([]);
  });
});

function gatewayOf(fake: FakeDiscord, handle: GatewaySetup["handle"], log: (line: string) => void) {
  return openGateway({ transport: fake, token: TOKEN, guild: GUILD, handle, log, timers: timersOf(fake) });
}

async function connected(fake: FakeDiscord): Promise<void> {
  await vi.waitFor(() => expect(fake.sockets.length).toBeGreaterThan(0));
  fake.hello();
}

describe("an approve sent as chat never reaches the door (#731)", () => {
  it("identifies with the Guilds intent only: no MessageContent, no message intents", async () => {
    expect(INTENTS).toBe(1);
    const fake = new FakeDiscord();
    const gateway = gatewayOf(fake, discordDoor(deps()).handle, () => undefined);
    await connected(fake);
    const frames = fake.socket.sent.map((s): unknown => JSON.parse(s));
    expect(frames.find((m) => field(m, "op") === 2)).toMatchObject({ d: { intents: 1 } });
    await gateway.stop();
  });

  it("drops a MESSAGE_CREATE reading approve: no REST call, no record", async () => {
    const fake = new FakeDiscord();
    const gateway = gatewayOf(fake, discordDoor(deps()).handle, () => undefined);
    await connected(fake);
    const before = fake.calls.length;
    fake.dispatch("MESSAGE_CREATE", {
      id: "1",
      channel_id: CHANNEL,
      guild_id: GUILD,
      author: { id: RAM },
      content: "/approve ticket:PROJ-1",
    });
    await gateway.drain();
    expect(fake.calls.length).toBe(before);
    expect(records()).toEqual([]);
    await gateway.stop();
  });

  it("the coordinator's wall still flags a rule that would let it run agent-factory approve or door", () => {
    const places = { pkg: "/pkg", factoryHome: "/f", botHome: "/home/factory" };
    const problems = wallProblems({ permissions: { allow: ["Bash(agent-factory *)"] } }, places).join("\n");
    expect(problems).toContain("lets the coordinator run agent-factory door discord");
    expect(problems).toContain("lets the coordinator run agent-factory approve");
  });
});

describe("the gateway answers each interaction ephemerally (#731)", () => {
  it("registers /start, /approve and /board for the guild on READY", async () => {
    const fake = new FakeDiscord();
    const gateway = gatewayOf(fake, discordDoor(deps()).handle, () => undefined);
    await connected(fake);
    fake.dispatch("READY", { session_id: "s", application: { id: APP } });
    await gateway.drain();
    const put = fake.calls.find((c) => c.method === "PUT");
    expect(put).toMatchObject({
      path: `/applications/${APP}/guilds/${GUILD}/commands`,
      json: [{ name: "start" }, { name: "approve" }, { name: "board" }],
    });
    await gateway.stop();
  });

  it("defers, then edits the answer in place, with the Confirm button and the files", async () => {
    const fake = new FakeDiscord();
    const gateway = gatewayOf(fake, discordDoor(deps()).handle, () => undefined);
    await connected(fake);
    fake.dispatch("INTERACTION_CREATE", command("approve", "PROJ-1"));
    await gateway.drain();
    const [callback, edit] = fake.calls.filter((c) => c.path !== "/gateway/bot");
    expect(callback).toMatchObject({ json: { type: 5, data: { flags: 64 } } });
    expect(edit).toMatchObject({
      method: "PATCH",
      path: `/webhooks/${APP}/interaction-token/messages/@original`,
      files: [{ name: "PROJ-1-spec.md" }, { name: "PROJ-1-design.md" }],
      json: { flags: 64, components: [{ components: [{ custom_id: expect.stringMatching(/^confirm:/) }] }] },
    });
    await gateway.stop();
  });

  it("ends on a refused token or intent, and reconnects on any other close", async () => {
    const fake = new FakeDiscord();
    const gateway = gatewayOf(fake, discordDoor(deps()).handle, () => undefined);
    await connected(fake);
    fake.socket.on.closed(1006);
    fake.tick();
    await vi.waitFor(() => expect(fake.sockets.length).toBe(2));
    fake.socket.on.closed(4014);
    const ended = await gateway.ended;
    expect(ended).toMatchObject({ kind: "failed" });
  });
});

describe("no log line or reply holds the token (#731)", () => {
  it("the door's scrub cuts its own token, whatever its shape, and still scrubs other secrets", () => {
    const scrub = scrubberOf(TOKEN);
    expect(scrub(`here ${TOKEN} there`)).toBe("here [scrubbed] there");
    expect(scrub("Bearer abc.def")).toBe("Bearer [scrubbed]");
  });

  it("cuts a token planted in a person's name, the board and a REST failure from every log line and reply", async () => {
    const fake = new FakeDiscord();
    const lines: string[] = [];
    const plain = deps();
    const door = discordDoor({
      ...plain,
      config: { guild: GUILD, channels: { [CHANNEL]: "ledger" }, people: { [RAM]: `Ram ${TOKEN}` } },
      open: async (project) => {
        const opened = await plain.open(project);
        return opened.kind === "ok"
          ? { kind: "ok", value: { ...opened.value, board: async () => ({ kind: "failed", reason: `near ${TOKEN}` }) } }
          : opened;
      },
    });
    const gateway = gatewayOf(fake, door.handle, (line) => lines.push(line));
    await connected(fake);
    fake.dispatch("INTERACTION_CREATE", command("approve", "PROJ-1"));
    fake.dispatch("INTERACTION_CREATE", command("board", undefined));
    fake.dispatch("INTERACTION_CREATE", command("start", "PROJ-1"));
    await gateway.drain();
    fake.fail = `HTTP 500 for Bot ${TOKEN}`;
    fake.dispatch("INTERACTION_CREATE", command("board", undefined));
    await gateway.drain();
    const outbound = fake.calls.filter((c) => c.path !== "/gateway/bot");
    expect(outbound.length).toBeGreaterThan(0);
    expect(lines.length).toBeGreaterThan(0);
    for (const text of [...lines, ...outbound.map((c) => JSON.stringify(c))]) {
      expect(text).not.toContain(TOKEN);
    }
    await gateway.stop();
  });

  it("refuses /approve when the scrub would change the spec, since the person would approve words they never saw", async () => {
    writeFileSync(join(specDir(), "spec.md"), SPEC.replace("Conflict.", `Conflict. ${TOKEN}`));
    const reply = await discordDoor(deps()).handle(command("approve", "PROJ-1"));
    refused(reply);
    expect(reply.text).toContain("shaped like a secret");
    expect(reply.confirm).toBeUndefined();
    writeFileSync(join(specDir(), "spec.md"), SPEC);
    writeFileSync(join(specDir(), "design.md"), `${DESIGN}\npassword: hunter22\n`);
    refused(await discordDoor(deps()).handle(command("approve", "PROJ-1")));
  });
});

describe("the door keeps running, and stops when told (#731)", () => {
  it("answers a person and keeps running when a handler throws", async () => {
    const fake = new FakeDiscord();
    const lines: string[] = [];
    const gateway = gatewayOf(
      fake,
      async () => {
        throw new Error("the disk is full");
      },
      (line) => lines.push(line),
    );
    await connected(fake);
    fake.dispatch("INTERACTION_CREATE", command("start", "PROJ-1"));
    await gateway.drain();
    expect(fake.calls.find((c) => c.method === "PATCH")).toMatchObject({
      json: { content: expect.stringContaining("the door could not answer") },
    });
    expect(lines.join("\n")).toContain("the disk is full");
    await gateway.stop();
  });

  it("tries again when the Gateway look-up fails, and ends only on a refused token", async () => {
    const fake = new FakeDiscord();
    fake.gateway.push({ kind: "failed", reason: "find the gateway: ENOTFOUND" });
    fake.gateway.push({ kind: "failed", reason: "HTTP 502", status: 502 });
    const gateway = gatewayOf(fake, discordDoor(deps()).handle, () => undefined);
    await vi.waitFor(() => expect(fake.ticks.length).toBe(1));
    fake.tick();
    await vi.waitFor(() => expect(fake.ticks.length).toBe(1));
    fake.tick();
    await vi.waitFor(() => expect(fake.sockets.length).toBe(1));
    fake.gateway.push({ kind: "failed", reason: "HTTP 401", status: 401 });
    fake.socket.on.closed(1006);
    fake.tick();
    expect(await gateway.ended).toMatchObject({ reason: expect.stringContaining("refused the token") });
  });

  it("opens no socket after stop, even when a reconnect was waiting", async () => {
    const fake = new FakeDiscord();
    const gateway = gatewayOf(fake, discordDoor(deps()).handle, () => undefined);
    await connected(fake);
    fake.socket.on.closed(1006);
    await gateway.stop();
    fake.tick();
    await gateway.drain();
    expect(fake.sockets.length).toBe(1);
  });

  it("writes a ticket that holds a newline as one escaped line", async () => {
    const fake = new FakeDiscord();
    const lines: string[] = [];
    const gateway = gatewayOf(fake, discordDoor(deps()).handle, (line) => lines.push(line));
    await connected(fake);
    fake.dispatch(
      "INTERACTION_CREATE",
      command("start", "x\ndoor discord: Confirm by Ram: approved", { user: STRANGER }),
    );
    await gateway.drain();
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).not.toContain("\n");
    }
    await gateway.stop();
  });
});

describe("the door's files (#731)", () => {
  const tokenFile = (): string => join(doorDir(home), "token");

  it("stores the token at 0600 in a 0700 folder, and reads it back", async () => {
    const stored = await storeDoorToken(home, `${TOKEN}\n`);
    expect(stored).toMatchObject({ kind: "ok" });
    expect(statSync(tokenFile()).mode & 0o777).toBe(0o600);
    expect(statSync(doorDir(home)).mode & 0o777).toBe(0o700);
    expect(await readDoorToken(home)).toEqual({ kind: "ok", value: TOKEN });
  });

  it("refuses to store what is not a bot token, without echoing it", async () => {
    const stored = await storeDoorToken(home, "not a token");
    expect(stored).toMatchObject({ kind: "failed" });
    expect(JSON.stringify(stored)).not.toContain("not a token");
  });

  it("refuses a token file readable by group or by others", async () => {
    await storeDoorToken(home, TOKEN);
    for (const mode of [0o640, 0o604, 0o644]) {
      chmodSync(tokenFile(), mode);
      const read = await readDoorToken(home);
      expect(read).toMatchObject({ kind: "failed", reason: expect.stringContaining("group or others") });
      expect(JSON.stringify(read)).not.toContain(TOKEN);
    }
  });

  it("refuses a token or people.json in a folder that group or others can write", async () => {
    await storeDoorToken(home, TOKEN);
    people({ guild: GUILD, channels: { [CHANNEL]: "ledger" }, people: { [RAM]: "Ram" } });
    for (const dir of [doorDir(home), join(home, "door")]) {
      chmodSync(dir, 0o777);
      expect(await readDoorToken(home)).toMatchObject({ kind: "failed", reason: expect.stringContaining("writable") });
      expect(await readDoorConfig(home)).toMatchObject({ kind: "failed", reason: expect.stringContaining("writable") });
      chmodSync(dir, 0o700);
    }
  });

  it("makes a folder that was already there 0700 when it stores the token", async () => {
    mkdirSync(doorDir(home), { recursive: true, mode: 0o755 });
    chmodSync(doorDir(home), 0o755);
    await storeDoorToken(home, TOKEN);
    expect(statSync(doorDir(home)).mode & 0o777).toBe(0o700);
  });

  it("refuses a missing token file, and names setup door-discord", async () => {
    expect(await readDoorToken(home)).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("setup door-discord"),
    });
  });

  const people = (value: unknown, mode = 0o600): void => {
    mkdirSync(doorDir(home), { recursive: true });
    writeFileSync(join(doorDir(home), "people.json"), JSON.stringify(value));
    chmodSync(join(doorDir(home), "people.json"), mode);
  };

  it("reads people.json: the guild, each channel's project and each person's name", async () => {
    people({ guild: GUILD, channels: { [CHANNEL]: "ledger" }, people: { [RAM]: "Ram" } });
    expect(await readDoorConfig(home)).toEqual({
      kind: "ok",
      value: { guild: GUILD, channels: { [CHANNEL]: "ledger" }, people: { [RAM]: "Ram" } },
    });
  });

  it("refuses a people.json that group or others can write, a bad id and a project that is not a plain name", async () => {
    people({ guild: GUILD, channels: { [CHANNEL]: "ledger" }, people: { [RAM]: "Ram" } }, 0o664);
    expect(await readDoorConfig(home)).toMatchObject({ kind: "failed" });
    people({ guild: "x", channels: { [CHANNEL]: "ledger" }, people: { [RAM]: "Ram" } });
    expect(await readDoorConfig(home)).toMatchObject({ kind: "failed" });
    people({ guild: GUILD, channels: { [CHANNEL]: "../ledger" }, people: { [RAM]: "Ram" } });
    expect(await readDoorConfig(home)).toMatchObject({ kind: "failed" });
    people({ guild: GUILD, channels: { [CHANNEL]: "ledger" }, people: { "12": "Ram" } });
    expect(await readDoorConfig(home)).toMatchObject({ kind: "failed" });
  });
});
