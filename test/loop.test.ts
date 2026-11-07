import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Done, Result } from "../src/core/forge/api.js";
import type { Change, Forge } from "../src/core/forge/types.js";
import { lintEdit } from "../src/core/lint-edit.js";
import { ask, block, claim, reconcile, release, status } from "../src/core/loop.js";
import { renderPost } from "../src/core/post.js";
import { runInFolder, type FolderCall } from "../src/core/review/model.js";
import { project, type Project } from "./review-repo.js";

const SHA = "aaaa1111bbbb2222cccc3333dddd4444eeee5555";

type Lists = { readonly opened: readonly number[]; readonly merged: readonly number[] };

function listsOf(claimed: Lists | undefined): Lists {
  return claimed ?? { opened: [], merged: [] };
}

// A forge that answers change() from `change` and records every write in order.
function forge(
  log: string[],
  over: {
    readonly change?: Partial<Change>;
    readonly fail?: string;
    readonly claimed?: { readonly opened: readonly number[]; readonly merged: readonly number[] };
  } = {},
): Forge {
  const notUsed = async (): Promise<{ readonly kind: "failed"; readonly reason: string }> => ({
    kind: "failed",
    reason: "not used",
  });
  const write = async (line: string): Promise<Done> => {
    log.push(line);
    return over.fail !== undefined && line.startsWith(over.fail)
      ? { kind: "failed", reason: `gitlab: HTTP 500 on ${line}` }
      : { kind: "ok" };
  };
  const change: Change = {
    number: 12,
    state: "opened",
    sha: SHA,
    sourceBranch: "factory/PROJ-1",
    targetBranch: "main",
    labels: ["agent::claimed"],
    description: "",
    anchor: { kind: "gitlab", base: "b", start: "s", head: SHA },
    ...over.change,
  };
  const lists = listsOf(over.claimed);
  return {
    name: "gitlab",
    mark: "!",
    me: notUsed,
    change: async ({ number }) => ({ kind: "ok", value: { ...change, number } }),
    defaultBranch: notUsed,
    addLabel: ({ number, label }) => write(`+${label} !${number}`),
    removeLabel: ({ number, label }) => write(`-${label} !${number}`),
    note: ({ number, post }) => {
      const r = renderPost(post);
      return write(`note !${number} ${r.kind === "ok" ? r.text : r.reason}`);
    },
    notes: notUsed,
    lineFinding: notUsed,
    status: notUsed,
    ciConfig: notUsed,
    openChange: notUsed,
    claimed: async ({ state }): Promise<Result<readonly number[]>> => ({ kind: "ok", value: lists[state] }),
    changes: notUsed,
  };
}

const LABEL = "agent::claimed";

describe("claim and release (#138)", () => {
  it("claim adds the label to an open change with none; refuses a claimed or a closed one", async () => {
    const log: string[] = [];
    expect(await claim({ forge: forge(log, { change: { labels: [] } }), number: 12, label: LABEL })).toEqual({
      kind: "ok",
      value: "claimed !12",
    });
    expect(log).toEqual(["+agent::claimed !12"]);
    expect(await claim({ forge: forge(log), number: 12, label: LABEL })).toMatchObject({
      kind: "failed",
      reason: "!12 is already claimed (agent::claimed)",
    });
    expect(
      await claim({ forge: forge(log, { change: { state: "merged", labels: [] } }), number: 12, label: LABEL }),
    ).toMatchObject({ kind: "failed", reason: expect.stringContaining("only an open change is claimed") });
    expect(log).toHaveLength(1);
  });

  it("release removes the label; a change with no claim is not an error; a failed removal fails", async () => {
    const log: string[] = [];
    expect(await release({ forge: forge(log), number: 12, label: LABEL })).toEqual({
      kind: "ok",
      value: "released !12",
    });
    expect(await release({ forge: forge(log, { change: { labels: [] } }), number: 12, label: LABEL })).toEqual({
      kind: "ok",
      value: "!12 was not claimed",
    });
    expect(log).toEqual(["-agent::claimed !12"]);
    expect(await release({ forge: forge([], { fail: "-" }), number: 12, label: LABEL })).toMatchObject({
      kind: "failed",
    });
  });
});

describe("status and ask (#138)", () => {
  it("post one note at the head the run started at, through the template", async () => {
    const log: string[] = [];
    expect(await status({ forge: forge(log), number: 12, sha: "aaaa1111", text: "writer started" })).toEqual({
      kind: "ok",
      value: "posted !12 at aaaa1111",
    });
    expect(await ask({ forge: forge(log), number: 12, sha: SHA, text: 'is $PATH a "literal" here?' })).toEqual({
      kind: "ok",
      value: "asked !12 at aaaa1111",
    });
    expect(log).toEqual([
      "note !12 [coordinator] writer started",
      'note !12 [writer] OPEN: is $PATH a "literal" here?',
    ]);
  });

  it("refuse a head that moved, a bad SHA and more than one line, and post nothing", async () => {
    const log: string[] = [];
    const cases = [
      { sha: "bbbb2222", text: "x", reason: "head moved: the run started at bbbb2222, the head is now aaaa1111" },
      { sha: "aaa", text: "x", reason: "7 to 40 hex characters" },
      { sha: "AAAA1111", text: "x", reason: "7 to 40 hex characters" },
      { sha: "aaaa1111", text: "a\nb", reason: "one line" },
      { sha: "aaaa1111", text: "  ", reason: "one line" },
    ];
    for (const c of cases) {
      expect(await status({ forge: forge(log), number: 12, sha: c.sha, text: c.text })).toMatchObject({
        kind: "failed",
        reason: expect.stringContaining(c.reason),
      });
    }
    expect(await ask({ forge: forge(log), number: 12, sha: "bbbb2222", text: "q" })).toMatchObject({
      reason: expect.stringContaining("question not posted"),
    });
    expect(log).toEqual([]);
  });

  it("a line that starts with / cannot run a GitLab quick action", async () => {
    const log: string[] = [];
    await status({ forge: forge(log), number: 12, sha: "aaaa1111", text: "/approve" });
    expect(log[0]).not.toMatch(/\n\//);
    expect(log[0]?.startsWith("note !12 [coordinator] ")).toBe(true);
  });
});

describe("block (#138; ADR-0011 D14)", () => {
  it("labels needs-human first, then the reason and the log, then releases the claim", async () => {
    const log: string[] = [];
    const out = await block({
      forge: forge(log),
      number: 12,
      label: LABEL,
      reason: "writer hit the 45-minute cap",
      log: ".claude/runs/writer-12.log",
    });
    expect(out).toEqual({ kind: "ok", value: "blocked !12" });
    expect(log).toEqual([
      "+needs-human !12",
      "note !12 [coordinator] blocked: writer hit the 45-minute cap\n\n- log: .claude/runs/writer-12.log",
      "-agent::claimed !12",
    ]);
  });

  it("a failed label posts no note and keeps the claim; no claim, none removed; a reason is one line", async () => {
    const failed: string[] = [];
    expect(
      await block({ forge: forge(failed, { fail: "+" }), number: 12, label: LABEL, reason: "silent", log: "" }),
    ).toMatchObject({ kind: "failed" });
    expect(failed).toEqual(["+needs-human !12"]);
    const unclaimed: string[] = [];
    await block({
      forge: forge(unclaimed, { change: { labels: [] } }),
      number: 12,
      label: LABEL,
      reason: "x",
      log: "",
    });
    expect(unclaimed).toEqual(["+needs-human !12", "note !12 [coordinator] blocked: x"]);
    for (const reason of ["", "a\nb"]) {
      expect(await block({ forge: forge([]), number: 12, label: LABEL, reason, log: "" })).toMatchObject({
        kind: "failed",
        reason: expect.stringContaining("one line"),
      });
    }
  });
});

describe("reconcile (#138; #39)", () => {
  let p: Project;
  beforeEach(() => {
    p = project();
  });
  afterEach(() => rmSync(p.root, { recursive: true, force: true }));

  const worktree = (name: string) =>
    p.git("worktree", "add", "-q", "--detach", join(p.clone, ".claude", "worktrees", name));

  it("releases each claim with no live run and each left on a merged change; removes each idle run's worktree", async () => {
    for (const name of ["writer-12", "reviewer-7", "writer-13", "notes"]) {
      worktree(name);
    }
    const log: string[] = [];
    const out = await reconcile({
      forge: forge(log, { claimed: { opened: [12, 13], merged: [9] } }),
      label: LABEL,
      repo: p.clone,
      env: p.env,
      dryRun: false,
      sessions: async () => ({ kind: "ok", value: ["writer-13", "someone-else"] }),
    });
    expect(out).toEqual({
      kind: "ok",
      value: [
        "released !12 (no live run)",
        "released !9 (merged)",
        "removed worktree reviewer-7 (no live run)",
        "removed worktree writer-12 (no live run)",
      ],
    });
    expect(log).toEqual(["-agent::claimed !12", "-agent::claimed !9"]);
    const dir = join(p.clone, ".claude", "worktrees");
    expect(["writer-13", "notes", "writer-12"].map((n) => existsSync(join(dir, n)))).toEqual([true, true, false]);
    // git forgets the removed ones: the clone and the two left
    expect(p.git("worktree", "list").split("\n")).toHaveLength(3);
  });

  it("a live run with a pid file keeps its claim; nothing to do says so", async () => {
    mkdirSync(join(p.clone, ".claude", "runs"), { recursive: true });
    writeFileSync(join(p.clone, ".claude", "runs", "writer-12.pid"), String(process.pid));
    const log: string[] = [];
    const out = await reconcile({
      forge: forge(log, { claimed: { opened: [12], merged: [] } }),
      label: LABEL,
      repo: p.clone,
      env: p.env,
      dryRun: false,
      sessions: async () => ({ kind: "ok", value: [] }),
    });
    expect(out).toEqual({ kind: "ok", value: ["nothing to reconcile"] });
    expect(log).toEqual([]);
  });

  it("refuses a FACTORY_REPO that is not a clone, so a live run's pid file is never missed", async () => {
    const log: string[] = [];
    const out = await reconcile({
      forge: forge(log, { claimed: { opened: [12], merged: [] } }),
      label: LABEL,
      repo: join(p.root, "no-such-clone"),
      env: p.env,
      dryRun: false,
      sessions: async () => ({ kind: "ok", value: [] }),
    });
    expect(out).toMatchObject({ kind: "failed", reason: expect.stringContaining("must be a local clone") });
    expect(log).toEqual([]);
  });

  it("a dry run removes no worktree, and says which it would", async () => {
    worktree("writer-12");
    const out = await reconcile({
      forge: forge([], { claimed: { opened: [], merged: [] } }),
      label: LABEL,
      repo: p.clone,
      env: p.env,
      dryRun: true,
      sessions: async () => ({ kind: "ok", value: [] }),
    });
    expect(out).toEqual({ kind: "ok", value: ["would remove worktree writer-12 (no live run)"] });
    expect(existsSync(join(p.clone, ".claude", "worktrees", "writer-12"))).toBe(true);
  });

  it("a live-run list it cannot read releases nothing: unknown is never none", async () => {
    const log: string[] = [];
    const out = await reconcile({
      forge: forge(log, { claimed: { opened: [12], merged: [9] } }),
      label: LABEL,
      repo: p.clone,
      env: p.env,
      dryRun: false,
      sessions: async () => ({ kind: "failed", reason: "cannot list live runs: claude agents --json failed" }),
    });
    expect(out).toMatchObject({ kind: "failed", reason: expect.stringContaining("cannot list live runs") });
    expect(log).toEqual([]);
  });
});

describe("lint-edit, the writer's hook (#138; ADR-0011 D17)", () => {
  let p: Project;
  beforeEach(() => {
    p = project();
    p.write("ok.txt", "good\n");
    p.write("bad.txt", "BAD\n");
    p.write("a b.txt", "BAD\n");
  });
  afterEach(() => rmSync(p.root, { recursive: true, force: true }));

  const edit = (file: string) => JSON.stringify({ tool_name: "Edit", tool_input: { file_path: file } });
  // a lint that fails on a file holding BAD
  const run = (calls: FolderCall[]) => async (call: FolderCall) => {
    calls.push(call);
    const file = call.args.at(-1) ?? "";
    const bad = file.endsWith("bad.txt") || file.endsWith("a b.txt");
    return { code: bad ? 1 : 0, stdout: bad ? `${file}:1:BAD\n` : "", stderr: "" };
  };
  const hook = (stdin: string, calls: FolderCall[], command = "grep -n BAD") =>
    lintEdit({ command, stdin, root: p.clone, env: {}, run: run(calls) });

  it("a clean file passes in silence; a failing lint exits 2 with the file, the command and its output", async () => {
    const calls: FolderCall[] = [];
    // the hook names the file by its real path (macOS: /var is /private/var)
    const real = realpathSync(p.clone);
    expect(await hook(edit(join(p.clone, "ok.txt")), calls)).toEqual({ code: 0, err: "" });
    const bad = await hook(edit(join(p.clone, "bad.txt")), calls);
    expect(bad.code).toBe(2);
    expect(bad.err).toContain(`lint failed on ${join(real, "bad.txt")} (grep -n BAD):`);
    expect(bad.err).toContain("1:BAD");
    // no shell: the command's words, then the file as one more word, in the session's folder
    expect(calls[0]).toMatchObject({ bin: "grep", args: ["-n", "BAD", join(real, "ok.txt")], cwd: p.clone });
    expect((await hook(edit(join(p.clone, "a b.txt")), calls)).code).toBe(2);
    expect(calls.at(-1)?.args.at(-1)).toBe(join(real, "a b.txt"));
  });

  it("skips a file that is gone, one outside the folder, and a tool call with no file; runs nothing for them", async () => {
    const calls: FolderCall[] = [];
    writeFileSync(join(p.root, "out.txt"), "BAD\n");
    for (const stdin of [
      edit(join(p.clone, "gone.txt")),
      edit(join(p.root, "out.txt")),
      edit(join(p.clone, "..", "out.txt")),
      JSON.stringify({ tool_input: {} }),
      "not json",
    ]) {
      expect(await hook(stdin, calls)).toEqual({ code: 0, err: "" });
    }
    expect(calls).toEqual([]);
  });

  it("a program that cannot start, or a NAME=value prefix, exits 1: the writer is not held on it", async () => {
    const calls: FolderCall[] = [];
    expect(await hook(edit(join(p.clone, "bad.txt")), calls, "FOO=1 grep BAD")).toMatchObject({
      code: 1,
      err: expect.stringContaining("needs a shell"),
    });
    const real = await lintEdit({
      command: "no-such-lint-program-x",
      stdin: edit(join(p.clone, "bad.txt")),
      root: p.clone,
      env: { PATH: process.env.PATH },
      run: runInFolder,
    });
    expect(real).toMatchObject({ code: 1, err: expect.stringContaining("cannot start no-such-lint-program-x") });
  });

  it("follows a symlink before the inside check: a link to a file outside is skipped", async () => {
    const calls: FolderCall[] = [];
    writeFileSync(join(p.root, "secret.txt"), "BAD\n");
    symlinkSync(join(p.root, "secret.txt"), join(p.clone, "link.txt"));
    expect(await hook(edit(join(p.clone, "link.txt")), calls)).toEqual({ code: 0, err: "" });
    // a sibling folder whose name starts with the session's is outside too
    mkdirSync(`${p.clone}-x`);
    writeFileSync(`${p.clone}-x/bad.txt`, "BAD\n");
    expect(await hook(edit(`${p.clone}-x/bad.txt`), calls)).toEqual({ code: 0, err: "" });
    expect(calls).toEqual([]);
  });

  it("a lint command that needs a shell exits 1 and runs nothing, so the writer is not held on it", async () => {
    const calls: FolderCall[] = [];
    const out = await hook(edit(join(p.clone, "bad.txt")), calls, "! grep -n BAD");
    expect(out).toMatchObject({ code: 1, err: expect.stringContaining("needs a shell") });
    expect(calls).toEqual([]);
  });
});
