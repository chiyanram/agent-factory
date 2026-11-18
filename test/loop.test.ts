import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { linkSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Done, Result } from "../src/core/forge/api.js";
import type { Change, Forge } from "../src/core/forge/types.js";
import { lintEdit } from "../src/core/lint-edit.js";
import { ask, grill, status } from "../src/core/loop.js";
import { openAsks } from "../src/core/notes.js";
import { LOOP_COMMANDS, questionsFrom } from "../src/loop-cli.js";
import { tempDir } from "./temp.js";
import { renderPost } from "../src/core/post.js";
import { runInFolder, type FolderCall } from "../src/core/agent/folder.js";
import { project, type Project } from "./review-repo.js";

const SHA = "aaaa1111bbbb2222cccc3333dddd4444eeee5555";

// A forge that answers change() from `change` and records every write in order.
function forge(
  log: string[],
  over: {
    readonly change?: Partial<Change>;
    readonly fail?: string;
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
  return {
    name: "gitlab",
    mark: "!",
    me: notUsed,
    change: async ({ number }) => ({ kind: "ok", value: { ...change, number } }),
    defaultBranch: async () => ({ kind: "ok", value: "main" }),
    branchExists: async () => ({ kind: "ok", value: false }),
    branchState: async () => ({ kind: "ok", value: "none" }),
    issueState: async () => ({ kind: "ok", value: "open" }),
    issueBody: notUsed,
    setIssueBody: notUsed,
    landed: notUsed,
    addLabel: ({ number, label }) => write(`+${label} !${number}`),
    removeLabel: ({ number, label }) => write(`-${label} !${number}`),
    note: ({ number, post }) => {
      const r = renderPost(post);
      return write(`note !${number} ${r.kind === "ok" ? r.text : r.reason}`);
    },
    notes: notUsed,
    setBody: notUsed,
    lineFinding: notUsed,
    status: notUsed,
    ciConfig: async () => ({ kind: "ok", value: { kind: "none", why: "test" } }),
    openChange: notUsed,
    waiting: async () => ({ kind: "ok", value: [] }),
    claimed: async (): Promise<Result<readonly number[]>> => ({ kind: "ok", value: [] }),
    changes: notUsed,
    failedJobs: notUsed,
  };
}

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

// #517 AC-1: the coordinator posts its numbered round through a command it may run, and the round stays open until a
// member answers every question
describe("grill (#517)", () => {
  const QUESTIONS = [
    { question: "which store?", choices: ["a file", "a table"], recommended: 1 },
    { question: "which currency?", choices: ["EUR", "USD", "GBP"], recommended: 0 },
  ] as const;
  const ASKED = QUESTIONS.map((q) => ({ kind: "choices", ...q }) as const);

  it("AC-1: posts one [coordinator] OPEN: N questions note with an item per question, open until each is answered", async () => {
    const log: string[] = [];
    expect(await grill({ forge: forge(log), number: 12, sha: "aaaa1111", questions: ASKED })).toEqual({
      kind: "ok",
      value: "asked 2 question(s) on !12 at aaaa1111",
    });
    const body = (log[0] ?? "").replace(/^note !12 /, "");
    expect(body.split("\n")[0]).toBe("[coordinator] OPEN: 2 questions");
    expect(body).toContain("- 1. which store? A) a file · B) a table (recommended)");
    expect(body).toContain("- 2. which currency? A) EUR (recommended) · B) USD · C) GBP");
    const readers = { factory: "ram", members: new Set(["ram", "lee"]) };
    const at = (i: number) => `2026-11-07T10:0${i}:00Z`;
    const notes = (...replies: string[]) => [
      { author: { name: "ram" }, body, at: at(0) },
      ...replies.map((r, i) => ({ author: { name: "lee" }, body: r, at: at(i + 1) })),
    ];
    expect(openAsks({ notes: notes(), readers })).toBe(1);
    expect(openAsks({ notes: notes("1B"), readers })).toBe(1);
    expect(openAsks({ notes: notes("1B", "2: A"), readers })).toBe(0);
  });

  it("refuses a head that moved and posts nothing", async () => {
    const log: string[] = [];
    expect(await grill({ forge: forge(log), number: 12, sha: "bbbb2222", questions: ASKED })).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("head moved"),
    });
    expect(log).toEqual([]);
  });

  describe("its questions file", () => {
    let home = "";
    beforeEach(() => {
      home = tempDir("factory-grill-");
      mkdirSync(join(home, "specs", "ledger", "PROJ-1"), { recursive: true });
    });
    afterEach(() => rmSync(home, { recursive: true, force: true }));
    const env = () => ({ FACTORY_HOME: home });
    const put = (name: string, text: string) => {
      const path = join(home, "specs", "ledger", "PROJ-1", name);
      writeFileSync(path, text);
      return path;
    };

    it("reads a list of questions from a file under <home>/specs", async () => {
      const read = await questionsFrom(env(), put("q.json", JSON.stringify(QUESTIONS)));
      expect(read).toEqual({ kind: "ok", value: ASKED });
    });

    it("refuses a file outside <home>/specs, one that links out of it, and one that is not there", async () => {
      const outside = join(home, "q.json");
      writeFileSync(outside, JSON.stringify(QUESTIONS));
      const linked = join(home, "specs", "ledger", "PROJ-1", "link.json");
      symlinkSync(outside, linked);
      for (const file of [outside, linked, join(home, "specs", "gone.json")]) {
        expect(await questionsFrom(env(), file)).toMatchObject({
          kind: "failed",
          reason: expect.stringContaining("must be a file under"),
        });
      }
    });

    it("refuses what is not a list of questions with 2 to 4 choices and a recommended one", async () => {
      for (const [text, why] of [
        ["not json", "not JSON"],
        ["[]", "at least one entry"],
        [JSON.stringify(["which store?"]), "must be {question, choices, recommended}"],
        [JSON.stringify([{ question: "x", choices: ["a"], recommended: 0 }]), "choices must be a list of 2 to 4"],
        [JSON.stringify([{ question: "x", choices: ["a", "b"], recommended: 2 }]), "recommended must be the index"],
      ] as const) {
        expect(await questionsFrom(env(), put("q.json", text))).toMatchObject({
          kind: "failed",
          reason: expect.stringContaining(why),
        });
      }
    });

    it("never opens through a link at its end, even one to another file under <home>/specs", async () => {
      const target = put("q.json", JSON.stringify(QUESTIONS));
      const link = join(home, "specs", "ledger", "PROJ-1", "same.json");
      symlinkSync(target, link);
      expect(await questionsFrom(env(), target)).toMatchObject({ kind: "ok" });
      expect(await questionsFrom(env(), link)).toMatchObject({ kind: "failed" });
    });

    it("refuses a hard link to a file elsewhere, a folder, and a file over 64 KB", async () => {
      const outside = join(home, "q.json");
      writeFileSync(outside, JSON.stringify(QUESTIONS));
      const hard = join(home, "specs", "ledger", "PROJ-1", "hard.json");
      linkSync(outside, hard);
      expect(await questionsFrom(env(), hard)).toMatchObject({
        kind: "failed",
        reason: expect.stringContaining("one link"),
      });
      const folder = join(home, "specs", "ledger", "PROJ-1", "dir.json");
      mkdirSync(folder);
      expect(await questionsFrom(env(), folder)).toMatchObject({
        kind: "failed",
        reason: expect.stringContaining("regular file"),
      });
      const big = put(
        "big.json",
        JSON.stringify([{ question: "x".repeat(70_000), choices: ["a", "b"], recommended: 0 }]),
      );
      expect(await questionsFrom(env(), big)).toMatchObject({
        kind: "failed",
        reason: expect.stringContaining("65536 bytes"),
      });
    });

    it("refuses a round that checks but would read back damaged once posted: 4 choices of 200 characters", async () => {
      const long = [
        { question: "which store?", choices: ["a", "b", "c", "d"].map((c) => c.repeat(200)), recommended: 3 },
      ];
      expect(await questionsFrom(env(), put("q.json", JSON.stringify(long)))).toMatchObject({
        kind: "failed",
        reason: expect.stringContaining("question 1 would not read back as written once posted"),
      });
      // the last choice cut, with every choice and the recommended one still there: only its text tells
      const cutLast = [{ question: "q".repeat(300), choices: ["a", "b", "c", "d".repeat(190)], recommended: 0 }];
      expect(await questionsFrom(env(), put("q.json", JSON.stringify(cutLast)))).toMatchObject({
        kind: "failed",
        reason: expect.stringContaining("would not read back"),
      });
      // a choice that holds the separator splits it on read-back too
      const split = [{ question: "which?", choices: ["a · b", "c"], recommended: 0 }];
      expect(await questionsFrom(env(), put("q.json", JSON.stringify(split)))).toMatchObject({ kind: "failed" });
      // text the template escapes still reads back the same
      const escaped = [{ question: "is #12 <done>?", choices: ["yes | now", "no"], recommended: 1 }];
      expect(await questionsFrom(env(), put("q.json", JSON.stringify(escaped)))).toMatchObject({ kind: "ok" });
    });

    it("takes a question and a choice that start with a slash: they read back as written (#522)", async () => {
      const slash = [{ question: "/merge or wait?", choices: ["/merge", "wait"], recommended: 1 }];
      expect(await questionsFrom(env(), put("q.json", JSON.stringify(slash)))).toMatchObject({ kind: "ok" });
    });

    it("the command exits 2 naming the problem, and posts nothing, for a file that does not check", async () => {
      const parsed = LOOP_COMMANDS.grill?.(["12", "aaaa1111", put("q.json", "[]")]);
      const errs: string[] = [];
      const io = { env: env(), out: () => undefined, err: (t: string) => void errs.push(t), readStdin: async () => "" };
      expect(typeof parsed === "function" ? await parsed(io) : parsed).toBe(2);
      expect(errs.join("")).toContain("agent-factory grill: questions must be a list with at least one entry");
      expect(LOOP_COMMANDS.grill?.(["12", "aaaa1111"])).toBe("usage");
    });
  });
});

describe("lint-edit, the writer's hook (#138; ADR-0011 D17)", () => {
  let p: Project;
  beforeEach(() => {
    p = project("feat/x");
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
    expect(await hook(edit(join(p.clone, "ok.txt")), calls)).toEqual({ code: 0, err: "" });
    const bad = await hook(edit(join(p.clone, "bad.txt")), calls);
    expect(bad.code).toBe(2);
    expect(bad.err).toContain(`lint failed on ${join(p.clone, "bad.txt")} (grep -n BAD):`);
    expect(bad.err).toContain("1:BAD");
    // no shell: the command's words, then the file as one more word, in the session's folder
    expect(calls[0]).toMatchObject({ bin: "grep", args: ["-n", "BAD", join(p.clone, "ok.txt")], cwd: p.clone });
    expect((await hook(edit(join(p.clone, "a b.txt")), calls)).code).toBe(2);
    expect(calls.at(-1)?.args.at(-1)).toBe(join(p.clone, "a b.txt"));
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
