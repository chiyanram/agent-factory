import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { openProjectForge } from "../src/core/forge/index.js";
import { pluginForge } from "../src/core/forge/plugin.js";
import { reader } from "../src/core/forge/read.js";
import { answer, described } from "../src/core/forge/serve.js";
import { changeOf, changesOf } from "../src/core/forge/shapes.js";
import type { Change } from "../src/core/forge/types.js";
import { renderPost, type Post } from "../src/core/post.js";
import { makeFakes, type FakeAnswer } from "../src/core/plugin/fakes.js";
import { addPlugin, type Setup } from "../src/core/plugin/registry.js";
import { tempDir } from "./temp.js";

// the bundled plugins are made by `npm run build` (scripts/build-plugins.mjs); make test builds first
const BUNDLED = join(import.meta.dirname, "..", "plugins");
const NODE_DIR = dirname(process.execPath);

let root = "";
let home = "";
beforeEach(() => {
  root = tempDir("factory-forge-plugin-");
  home = join(root, "home");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const POST: Post = {
  seat: "reviewer",
  title: "one finding @alice",
  fields: [{ label: "head", value: "abc" }],
  items: [],
};

function http(status: string, body: unknown): FakeAnswer {
  return {
    code: 0,
    stdout: `HTTP/2.0 ${status}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(body)}`,
    stderr: "",
  };
}

// the bundled github plugin, added and pinned, with a fake gh first on its PATH
async function bundled(answers: readonly FakeAnswer[]) {
  expect(existsSync(join(BUNDLED, "github", "lib")), "run npm run build first").toBe(true);
  const fakes = await makeFakes(["gh"], answers);
  if (fakes.kind === "failed") {
    throw new Error(fakes.reason);
  }
  const setup: Setup = { home, env: { HOME: root, LANG: "C" }, path: `${fakes.value.dir}:${NODE_DIR}` };
  const added = await addPlugin(setup, join(BUNDLED, "github", "plugin"));
  expect(added.kind).toBe("ok");
  return { setup, fakes: fakes.value };
}

describe("the forge as a plugin (#134 PR C)", () => {
  it("serves the Forge interface through the bundled github plugin and the gh on its PATH", async () => {
    const { setup, fakes } = await bundled([http("200 OK", { login: "factory-bot" }), http("201 Created", { id: 1 })]);
    const forge = pluginForge({ setup, plugin: "github", forge: "github", project: "chiyanram/ledger" });
    expect(forge).toMatchObject({ name: "github", mark: "#" });
    expect(await forge.me()).toEqual({ kind: "ok", value: "factory-bot" });
    expect(await forge.note({ number: 12, post: POST })).toEqual({ kind: "ok" });
    const calls = await fakes.calls();
    expect(calls.map((c) => c.argv.slice(0, 5))).toEqual([
      ["api", "--include", "user", "-X", "GET"],
      ["api", "--include", "repos/chiyanram/ledger/issues/12/comments", "-X", "POST"],
    ]);
    const rendered = renderPost(POST);
    expect(rendered.kind === "ok" && JSON.parse(calls[1]?.stdin ?? "{}").body).toBe(
      rendered.kind === "ok" ? rendered.text : "",
    );
    await fakes.remove();
  });

  it("carries a status and a line finding, and an answer past 1 MiB, as the built-in adapter does", async () => {
    const big = "x".repeat(2 * 1024 * 1024);
    const comment = { body: big, user: { login: "alice", type: "User" }, created_at: "2026-11-08T00:00:00Z" };
    const { setup, fakes } = await bundled([
      http("201 Created", { id: 1 }),
      http("201 Created", { id: 2 }),
      http("200 OK", [comment]),
    ]);
    try {
      const forge = pluginForge({ setup, plugin: "github", forge: "github", project: "chiyanram/ledger" });
      const sha = "a".repeat(40);
      expect(
        await forge.status({
          sha,
          ref: "factory/P-1",
          state: "success",
          context: "agent-factory/verify",
          description: "ok",
        }),
      ).toEqual({ kind: "ok" });
      const change: Change = {
        number: 5,
        state: "opened",
        sha,
        sourceBranch: "factory/P-1",
        targetBranch: "main",
        labels: [],
        description: "",
        anchor: { kind: "github", head: sha },
      };
      expect(await forge.lineFinding({ change, at: { file: "src/a.ts", line: 3 }, post: POST })).toEqual({
        kind: "ok",
      });
      const notes = await forge.notes({ number: 5 });
      expect(notes.kind === "ok" && notes.value[0]?.body.length).toBe(big.length);
      const calls = await fakes.calls();
      expect(calls.map((c) => c.argv[2])).toEqual([
        `repos/chiyanram/ledger/statuses/${sha}`,
        "repos/chiyanram/ledger/pulls/5/comments",
        expect.stringContaining("repos/chiyanram/ledger/issues/5/comments"),
      ]);
    } finally {
      await fakes.remove();
    }
  });

  it("carries the failed jobs at a head, a log's end and a job with no log, as the built-in adapter does (#171)", async () => {
    const sha = "b".repeat(40);
    const { setup, fakes } = await bundled([
      http("200 OK", {
        check_runs: [
          { id: 7, name: "lint", conclusion: "failure", app: { slug: "github-actions" } },
          { id: 8, name: "external", conclusion: "failure", app: { slug: "circleci" } },
        ],
      }),
      http("200 OK", { statuses: [] }),
      { code: 0, stdout: "HTTP/2.0 200 OK\r\nContent-Type: text/plain\r\n\r\nstep 1\nFAIL lint", stderr: "" },
    ]);
    try {
      const forge = pluginForge({ setup, plugin: "github", forge: "github", project: "chiyanram/ledger" });
      expect(await forge.failedJobs({ number: 5, head: sha })).toEqual({
        kind: "ok",
        value: [
          { name: "lint", log: { kind: "tail", text: "step 1\nFAIL lint" } },
          { name: "external", log: { kind: "none", why: "not a GitHub Actions job: its log is on its own site" } },
        ],
      });
      const calls = await fakes.calls();
      expect(calls.map((c) => c.argv[2])).toEqual([
        `repos/chiyanram/ledger/commits/${sha}/check-runs?filter=latest&per_page=100`,
        `repos/chiyanram/ledger/commits/${sha}/status?per_page=100`,
        "repos/chiyanram/ledger/actions/jobs/7/logs",
      ]);
    } finally {
      await fakes.remove();
    }
  });

  it("fails a call the forge refuses, with the CLI's reason, and never retries a plain failure", async () => {
    const { setup, fakes } = await bundled([http("404 Not Found", { message: "Not Found" })]);
    const forge = pluginForge({ setup, plugin: "github", forge: "github", project: "chiyanram/ledger" });
    expect(await forge.addLabel({ number: 3, label: "agent::claimed" })).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("HTTP 404"),
    });
    await fakes.remove();
  });

  it("refuses an answer that is not the shape the interface says, or not the kind of its op", async () => {
    const dir = join(root, "odd");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "plugin");
    writeFileSync(
      path,
      `#!${process.execPath}
const out = (v) => process.stdout.write(JSON.stringify(v));
if (process.argv[2] === "describe") { out(${JSON.stringify({ ...described("github", "1"), name: "odd", cli: [] })}); process.exit(0); }
let t = ""; process.stdin.on("data", (d) => (t += d)); process.stdin.on("end", () => {
  const req = JSON.parse(t);
  if (req.op === "me") { out({ kind: "ok", value: 7 }); return; }
  if (req.op === "defaultBranch") { out({ kind: "done" }); return; }
  if (req.op === "change") { out({ kind: "ok", value: { number: 1, state: "open" } }); return; }
  if (req.op === "addLabel") { out({ kind: "ok" }); return; }
  out({ kind: "failed", reason: "no" });
});
`,
    );
    chmodSync(path, 0o755);
    const setup: Setup = { home, env: { HOME: root }, path: NODE_DIR };
    expect((await addPlugin(setup, path)).kind).toBe("ok");
    const forge = pluginForge({ setup, plugin: "odd", forge: "gitlab", project: "a/b" });
    expect(forge.mark).toBe("!");
    expect(await forge.me()).toMatchObject({ kind: "failed", reason: expect.stringContaining("expected a string") });
    expect(await forge.defaultBranch()).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("answered done"),
    });
    expect(await forge.change({ number: 1 })).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("one of"),
    });
    expect(await forge.addLabel({ number: 1, label: "x" })).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("answered ok"),
    });
    expect(await forge.notes({ number: 1 })).toMatchObject({ kind: "failed", reason: "odd notes: no" });
  });
});

describe("serve: the plugin side (#134 PR C)", () => {
  const io = { argv: [], stdin: async () => "", env: {}, out: () => undefined };
  const ask = (request: unknown) => answer("github", io, JSON.stringify(request));

  it("refuses a request for another forge", async () => {
    expect(await ask({ capability: "forge.read", op: "me", input: { project: "a/b", forge: "gitlab" } })).toEqual({
      kind: "refused",
      reason: 'this plugin serves github, not "gitlab"',
    });
  });

  it("refuses a write sent as a read, does not know other ops, and answers a bad input or project", async () => {
    expect(await ask({ capability: "forge.read", op: "note", input: {} })).toMatchObject({ kind: "refused" });
    expect(await ask({ capability: "forge.write", op: "merge", input: {} })).toEqual({
      kind: "unsupported",
      op: "merge",
    });
    expect(await ask({ capability: "forge.read", op: "me", input: { project: "../etc" } })).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("owner/name"),
    });
    expect(await ask({ capability: "forge.write", op: "note", input: { project: "a/b", number: "x" } })).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("the request's input"),
    });
    expect(await answer("github", io, "[1]")).toMatchObject({ kind: "failed" });
  });

  it("reads a change back in the seam's own shape", () => {
    const change: Change = {
      number: 4,
      state: "opened",
      sha: "a".repeat(40),
      sourceBranch: "factory/PROJ-1",
      targetBranch: "main",
      labels: ["agent::claimed"],
      description: "d",
      anchor: { kind: "gitlab", base: "b", start: "s", head: "h" },
    };
    const r = reader("test");
    expect(r.done(changeOf(r, JSON.parse(JSON.stringify(change))))).toEqual({ kind: "ok", value: change });
  });
});

describe("changesOf: an open change's mergeability over the plugin protocol (#103)", () => {
  const open = (extra: Record<string, unknown>) => ({
    team: [],
    merged: [],
    open: [
      {
        number: 4,
        branch: "factory/T-4",
        fork: false,
        head: "h",
        draft: true,
        labels: [],
        pipeline: { kind: "none" },
        comments: [],
        ...extra,
      },
    ],
  });

  it("keeps what the plugin says, reads a plugin built before it as unknown, and refuses another word", () => {
    const read = (extra: Record<string, unknown>) => {
      const r = reader("test");
      return r.done(changesOf(r, open(extra)));
    };
    expect(read({ mergeable: "conflict" })).toMatchObject({ kind: "ok", value: { open: [{ mergeable: "conflict" }] } });
    expect(read({})).toMatchObject({ kind: "ok", value: { open: [{ mergeable: "unknown" }] } });
    expect(read({ mergeable: "maybe" })).toMatchObject({ kind: "failed" });
  });
});

describe("openProjectForge: the forge plugin, opted in per project (#134 PR C)", () => {
  function projectFile(value: unknown): void {
    mkdirSync(join(home, "projects"), { recursive: true });
    writeFileSync(join(home, "projects", "ledger.json"), typeof value === "string" ? value : JSON.stringify(value));
  }

  const open = (env: NodeJS.ProcessEnv, log: (l: string) => void = () => undefined) =>
    openProjectForge(
      { env: { FACTORY_FORGE: "github", FACTORY_PROJECT: "chiyanram/ledger", ...env }, log },
      { home, project: "ledger", plugins: { home, env: {}, path: NODE_DIR } },
    );

  it("stops on a project file that is there but does not read", async () => {
    projectFile("not json");
    expect(await open({})).toMatchObject({ kind: "failed", reason: expect.stringContaining("not a JSON object") });
    projectFile({ policy: { "forge.write": { mode: "allow", cap: 1 } } });
    expect(await open({})).toMatchObject({ kind: "failed", reason: expect.stringContaining("dispatcher's") });
  });

  it("uses the built-in adapter when the project maps no forge plugin, or has no file", async () => {
    expect(await open({})).toMatchObject({ kind: "ok", value: { identity: { kind: "own" } } });
    projectFile({ connectors: { notify: "discord" } });
    expect(await open({})).toMatchObject({ kind: "ok" });
  });

  it("refuses forge.read and forge.write mapped apart, and a forge plugin with the App identity", async () => {
    projectFile({ connectors: { "forge.read": "github" } });
    expect(await open({})).toMatchObject({ kind: "failed", reason: expect.stringContaining("the same connector") });
    projectFile({ connectors: { "forge.read": "github", "forge.write": "github" } });
    expect(await open({ FACTORY_IDENTITY: "app" })).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("no plugin may hold"),
    });
    expect(await open({ FACTORY_FORGE: "gitlab", FACTORY_PROJECT: "a/b" })).toMatchObject({
      kind: "failed",
      reason: "FACTORY_FORGE is gitlab, but the project maps the forge to the plugin github",
    });
    for (const [name, value] of [
      ["FACTORY_FORGE_HOST", "ghe.corp.example"],
      ["GH_HOST", "ghe.corp.example"],
      ["GH_TOKEN", "t"],
      ["FACTORY_GH", "/opt/gh"],
    ] as const) {
      expect(await open({ [name]: value })).toMatchObject({
        kind: "failed",
        reason: expect.stringContaining(`${name} is set, which the forge plugin cannot honour`),
      });
    }
    expect(await open({ FACTORY_FORGE_HOST: "github.com" })).toMatchObject({ kind: "ok" });
    expect(await open({ FACTORY_PROJECT: "nope" })).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("owner/name"),
    });
  });

  it("serves the project through its plugin, with FACTORY_DRY_RUN still holding every write back", async () => {
    projectFile({ connectors: { "forge.read": "github", "forge.write": "github" } });
    const logged: string[] = [];
    const opened = await open({ FACTORY_DRY_RUN: "1" }, (l) => logged.push(l));
    if (opened.kind === "failed") {
      throw new Error(opened.reason);
    }
    expect(opened.value.forge).toMatchObject({ name: "github", mark: "#" });
    expect(await opened.value.forge.addLabel({ number: 2, label: "agent::claimed" })).toEqual({ kind: "ok" });
    expect(
      await opened.value.forge.openChange({
        branch: "factory/P-1",
        base: "main",
        title: "t",
        body: { seat: "writer", title: "t", fields: [], items: [] },
      }),
    ).toMatchObject({ kind: "failed", reason: "a dry run opens no change" });
    expect(logged).toEqual([
      "DRY RUN: add the label agent::claimed to #2",
      "DRY RUN: open a draft change from factory/P-1 into main",
    ]);
    // no plugin is registered here, so a read reaches the registry and is refused there
    expect(await opened.value.forge.me()).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("plugin add"),
    });
  });
});
