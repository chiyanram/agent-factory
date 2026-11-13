import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { approve } from "../src/core/approval.js";
import { readLog } from "../src/core/plugin/writes.js";
import { issueStore } from "../src/core/spec-store.js";
import { specHash } from "../src/core/spec.js";
import { REQUEST_COMMANDS } from "../src/request-cli.js";
import { tempDir } from "./temp.js";

// a spec change in the issue store, sent as the issue's new body on the person's yes (#542)
const OLD = [
  "# 6: renewals",
  "",
  "## Intent",
  "",
  "The old words.",
  "",
  "## Acceptance criteria",
  "",
  "1. It works.",
  "",
  "## Design",
  "",
  "none",
  "",
  "## Lane",
  "",
  "bug",
  "",
].join("\n");
const NEW =
  "# 6: renewals\n\n## Intent\n\nA member's renewal of a reserved loan is refused; see #12 and `@types/node`.\n";

let home = "";
beforeEach(() => {
  home = tempDir("factory-spec-body-");
  issue(OLD);
  project();
  draft(NEW);
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

function issue(description: string): void {
  writeFileSync(join(home, "issue.json"), JSON.stringify({ iid: 6, description }));
}

function project(extra: object = {}): void {
  mkdirSync(join(home, "projects"), { recursive: true });
  const value = { gitHost: "gitlab", gitHostProject: "a/ledger", clone: home, specStore: "issue", ...extra };
  writeFileSync(join(home, "projects", "ledger.json"), JSON.stringify(value));
}

function draft(text: string, ticket = "6", name = "spec.md"): string {
  mkdirSync(join(home, "specs", "ledger", ticket), { recursive: true });
  const file = join(home, "specs", "ledger", ticket, name);
  writeFileSync(file, text);
  return file;
}

// a glab that answers issue 6 from issue.json, and keeps what a PUT sends in put.json
function glab(): string {
  const path = join(home, "glab");
  const [put, read] = [join(home, "put.json"), join(home, "issue.json")];
  writeFileSync(
    path,
    `#!/bin/sh\ncase "$*" in\n  *issues/6*PUT*) cat > '${put}'; printf 'HTTP/2.0 200 OK\\r\\n\\r\\n{"iid":6}' ;;\n  *issues/6*) printf 'HTTP/2.0 200 OK\\r\\n\\r\\n'; cat '${read}' ;;\n  *) exit 3 ;;\nesac\n`,
    { mode: 0o755 },
  );
  return path;
}

async function run(name: string, argv: readonly string[]) {
  const [out, err] = [[] as string[], [] as string[]];
  const command = REQUEST_COMMANDS[name];
  if (command === undefined) {
    throw new Error(name);
  }
  const code = await command(argv, {
    env: { HOME: home, LANG: "C", PATH: process.env.PATH, FACTORY_GLAB: glab() },
    home,
    out: (t) => out.push(t),
    err: (t) => err.push(t),
    secrets: async () => ({ kind: "ok", value: {} }),
  });
  return { code, out: out.join(""), err: err.join("") };
}

const request = (file = join(home, "specs", "ledger", "6", "spec.md")) => run("request", ["spec.body", "--file", file]);

// idOf : the id in the confirm command request printed
function idOf(out: string): string {
  return /agent-factory confirm (\S+) /.exec(out)?.[1] ?? "";
}

const sent = (): unknown =>
  existsSync(join(home, "put.json")) ? JSON.parse(readFileSync(join(home, "put.json"), "utf8")) : undefined;

describe("request spec.body and confirm (#542)", () => {
  it("keeps the change and sends nothing; the person's confirm with the exact text sets the issue's body, once", async () => {
    const asked = await request();
    expect(asked).toMatchObject({ code: 3, err: "" });
    expect(asked.out).toContain(`agent-factory confirm ledger/6/spec.body/`);
    expect(asked.out).toContain(`'${NEW.replace("member's", "member'\\''s")}'`);
    expect(sent()).toBeUndefined();
    const id = idOf(asked.out);
    expect(await run("confirm", [id, NEW])).toMatchObject({
      code: 0,
      out: "confirm: done (1 of 10 since the approval)\n",
    });
    expect(sent()).toEqual({ description: NEW });
    expect(readdirSync(join(home, "pending"))).toEqual([]);
    const log = await readLog({ home, project: "ledger", ticket: "6" });
    expect(log.kind === "ok" && log.value.map((l) => l.kind)).toEqual(["reserved", "done"]);
    expect(log.kind === "ok" && log.value[0]).toMatchObject({ capability: "spec.body", approval: "unapproved" });
    expect((await run("confirm", [id, NEW])).err).toContain("no pending request");
  });

  it("refuses a local store, a ticket that is no issue, a body it may not post, a denied policy and any other file", async () => {
    const cases: readonly [() => void, string, string][] = [
      [
        () => project({ specStore: "local" }),
        join(home, "specs", "ledger", "6", "spec.md"),
        "keeps its specs in local files",
      ],
      [() => draft(NEW, "PROJ-1"), join(home, "specs", "ledger", "PROJ-1", "spec.md"), "the issue number"],
      [() => draft(`${NEW}ask @alice\n`), join(home, "specs", "ledger", "6", "spec.md"), "mentions @alice"],
      [
        () => project({ policy: { "spec.body": { mode: "deny", cap: 1 } } }),
        join(home, "specs", "ledger", "6", "spec.md"),
        "denies spec.body",
      ],
      [
        () => draft(NEW, "6", "comment.json"),
        join(home, "specs", "ledger", "6", "comment.json"),
        "takes the spec file",
      ],
    ];
    for (const [arrange, file, reason] of cases) {
      project();
      draft(NEW);
      arrange();
      const refused = await request(file);
      expect({ reason, refused }).toMatchObject({ reason, refused: { code: 1, err: expect.stringContaining(reason) } });
    }
    expect(existsSync(join(home, "pending"))).toBe(false);
    expect(sent()).toBeUndefined();
  });

  it("confirm refuses another text and an issue edited since the request; the cap counts each change", async () => {
    const id = idOf((await request()).out);
    expect((await run("confirm", [id, `${NEW} `])).err).toContain("not the kept request's text");
    issue(`${OLD}A person's edit.\n`);
    expect((await run("confirm", [id, NEW])).err).toContain("changed since the request");
    expect(sent()).toBeUndefined();
    project({ policy: { "spec.body": { mode: "confirm", cap: 1 } } });
    expect((await run("confirm", [idOf((await request()).out), NEW])).code).toBe(0);
    expect((await request()).err).toContain("the cap is reached, 1 of 1 spec.body");
  });

  it("says an approved ticket's approval is now stale once its spec changed", async () => {
    const store = issueStore({
      open: async () => ({ kind: "ok", value: { issueBody: async () => ({ kind: "ok", value: OLD }) } }),
      hostProject: "a/ledger",
    });
    const where = { home, project: "ledger", ticket: "6", store };
    expect(
      (await approve({ where, seenHash: specHash(OLD), by: "ram", via: "terminal", at: "2026-11-13T10:00:00Z" })).kind,
    ).toBe("approved");
    const done = await run("confirm", [idOf((await request()).out), NEW]);
    expect(done).toMatchObject({
      code: 0,
      out: expect.stringContaining("approval is now stale: approve the new spec again"),
    });
  });
});
