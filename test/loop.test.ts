import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, linkSync, mkdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Done, Result } from "../src/core/forge/api.js";
import type { Change, Forge } from "../src/core/forge/types.js";
import { lintEdit } from "../src/core/lint-edit.js";
import { ask, block, claim, grill, reconcile, release, status, type Reconcile } from "../src/core/loop.js";
import { openAsks } from "../src/core/notes.js";
import { LOOP_COMMANDS, questionsFrom } from "../src/loop-cli.js";
import { tempDir } from "./temp.js";
import { renderPost } from "../src/core/post.js";
import type { PushRequest } from "../src/core/push.js";
import type { PushTarget } from "../src/core/writer/step.js";
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
    defaultBranch: async () => ({ kind: "ok", value: "main" }),
    branchExists: async () => ({ kind: "ok", value: false }),
    branchState: async () => ({ kind: "ok", value: "none" }),
    issueState: async () => ({ kind: "ok", value: "open" }),
    issueBody: notUsed,
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
    claimed: async ({ state }): Promise<Result<readonly number[]>> => ({ kind: "ok", value: lists[state] }),
    changes: notUsed,
    failedJobs: notUsed,
  };
}

const LABEL = "agent::claimed";

// no push is expected: a test that finds unlanded work passes its own landing
const noLanding: Reconcile["landing"] = {
  target: { kind: "failed", reason: "no push in this test" },
  pusher: async () => ({ kind: "failed", reason: "no push in this test" }),
};

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
    p = project("feat/x");
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
      landing: noLanding,
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
      landing: noLanding,
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
      landing: noLanding,
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
      landing: noLanding,
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
      landing: noLanding,
      sessions: async () => ({ kind: "failed", reason: "cannot list live runs: claude agents --json failed" }),
    });
    expect(out).toMatchObject({ kind: "failed", reason: expect.stringContaining("cannot list live runs") });
    expect(log).toEqual([]);
  });
});

describe("reconcile keeps a writer's unlanded work (#189)", () => {
  let p: Project;
  const pushes: PushRequest[] = [];
  beforeEach(() => {
    p = project("feat/x");
    pushes.length = 0;
  });
  afterEach(() => rmSync(p.root, { recursive: true, force: true }));

  const dir = () => join(p.clone, ".claude", "worktrees");
  const inTree = (name: string, ...args: string[]) =>
    execFileSync("git", args, { cwd: join(dir(), name), env: p.env, encoding: "utf8" }).trim();

  // the push the host would make: every guard first, then a plain push to the test's origin
  const landing = (
    target: Result<PushTarget> = {
      kind: "ok",
      value: { forge: "gitlab", host: "gitlab.com", project: "a/b", identity: { kind: "own" }, env: p.env },
    },
  ) => ({
    target,
    pusher: async (request: PushRequest): Promise<Done> => {
      pushes.push(request);
      for (const guard of request.guards) {
        const ok = await guard({ repo: request.repo, commit: request.commit, lease: request.lease });
        if (ok.kind === "failed") {
          return ok;
        }
      }
      execFileSync("git", ["push", "-q", "origin", `${request.commit}:refs/heads/${request.branch}`], {
        cwd: request.repo,
        env: p.env,
      });
      return { kind: "ok" };
    },
  });

  // writer-12 on factory/PROJ-1, pushed, then one more commit; writer-14 with one uncommitted file; reviewer-7 with
  // one too; writer-15 clean and fully pushed
  function plant(): string {
    p.git("worktree", "add", "-q", "-b", "factory/PROJ-1", join(dir(), "writer-12"));
    inTree("writer-12", "push", "-q", "origin", "factory/PROJ-1");
    const pushed = inTree("writer-12", "rev-parse", "HEAD");
    writeFileSync(join(dir(), "writer-12", "fix.txt"), "fix\n");
    inTree("writer-12", "add", "fix.txt");
    inTree("writer-12", "commit", "-q", "-m", "fix");
    for (const name of ["writer-14", "reviewer-7", "writer-15"]) {
      p.git("worktree", "add", "-q", "--detach", join(dir(), name));
    }
    writeFileSync(join(dir(), "writer-14", "notes.txt"), "half done\n");
    writeFileSync(join(dir(), "reviewer-7", "scratch.txt"), "scratch\n");
    return pushed;
  }

  const run = (
    log: string[],
    pushed: string,
    over: { dryRun?: boolean; landing?: ReturnType<typeof landing>; state?: Change["state"] } = {},
  ) =>
    reconcile({
      forge: forge(log, { change: { sha: pushed, sourceBranch: "factory/PROJ-1", state: over.state ?? "opened" } }),
      label: LABEL,
      repo: p.clone,
      env: p.env,
      dryRun: over.dryRun ?? false,
      landing: over.landing ?? landing(),
      sessions: async () => ({ kind: "ok", value: [] }),
    });

  it("pushes the unpushed commit on top, keeps both worktrees, labels both needs-human; removes the rest", async () => {
    const pushed = plant();
    const log: string[] = [];
    const out = await run(log, pushed);
    expect(out).toEqual({
      kind: "ok",
      value: [
        "removed worktree reviewer-7 (no live run)",
        "kept worktree writer-12 (1 unlanded commit, 0 uncommitted files; pushed 1 on top of factory/PROJ-1); !12 is needs-human",
        "kept worktree writer-14 (0 unlanded commits, 1 uncommitted file; nothing to push); !14 is needs-human",
        "removed worktree writer-15 (no live run)",
      ],
    });
    const head = inTree("writer-12", "rev-parse", "HEAD");
    expect(p.git("ls-remote", "origin", "refs/heads/factory/PROJ-1").split("\t")[0]).toBe(head);
    expect(pushes).toMatchObject([{ branch: "factory/PROJ-1", commit: head, lease: { kind: "sha", sha: pushed } }]);
    expect(["writer-12", "writer-14", "reviewer-7", "writer-15"].map((n) => existsSync(join(dir(), n)))).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect(log.filter((l) => l.startsWith("+"))).toEqual(["+needs-human !12", "+needs-human !14"]);
    const note14 = log.find((l) => l.startsWith("note !14")) ?? "";
    expect(note14).toContain("- notes.txt");
    expect(note14).toContain("never committed by reconcile: 1");
    // the uncommitted file stays uncommitted
    expect(inTree("writer-14", "status", "--porcelain")).toBe("?? notes.txt");
    expect(log.find((l) => l.startsWith("note !12"))).toContain(head.slice(0, 8));
  });

  it("a dry run keeps and pushes nothing, and says which it would keep", async () => {
    const pushed = plant();
    const log: string[] = [];
    const out = await run(log, pushed, { dryRun: true });
    expect(out).toMatchObject({
      kind: "ok",
      value: expect.arrayContaining([
        "would keep worktree writer-12 (1 unlanded commit, 0 uncommitted files)",
        "would keep worktree writer-14 (0 unlanded commits, 1 uncommitted file)",
        "would remove worktree writer-15 (no live run)",
      ]),
    });
    expect(log).toEqual([]);
    expect(pushes).toEqual([]);
  });

  it("keeps the commits in the worktree when a guard or the settings refuse the push, and says why", async () => {
    const pushed = plant();
    mkdirSync(join(dir(), "writer-12", ".factory"));
    writeFileSync(join(dir(), "writer-12", ".factory", "report.json"), "{}");
    inTree("writer-12", "add", "-f", ".factory/report.json");
    inTree("writer-12", "commit", "-q", "-m", "report");
    const log: string[] = [];
    const out = await run(log, pushed);
    expect(out).toMatchObject({
      kind: "ok",
      value: expect.arrayContaining([expect.stringContaining("not pushed: a commit touches .factory")]),
    });
    expect(p.git("ls-remote", "origin", "refs/heads/factory/PROJ-1").split("\t")[0]).toBe(pushed);
    // the marker of what a person was told: the next reconcile tells them once
    const marker = join(p.clone, ".claude", "runs", "reconcile-writer-12.txt");
    rmSync(marker);
    const unset = await run([], pushed, { landing: landing({ kind: "failed", reason: "FACTORY_PROJECT is not set" }) });
    expect(unset).toMatchObject({
      kind: "ok",
      value: expect.arrayContaining([expect.stringContaining("not pushed: FACTORY_PROJECT is not set")]),
    });
    expect(existsSync(join(dir(), "writer-12"))).toBe(true);
  });

  it("keeps a writer's worktree it cannot check, and labels nothing: unknown is never nothing to land", async () => {
    const pushed = plant();
    renameSync(join(p.root, "origin.git"), join(p.root, "gone.git"));
    const log: string[] = [];
    const out = await run(log, pushed);
    expect(out).toMatchObject({
      kind: "ok",
      value: expect.arrayContaining([
        expect.stringMatching(
          /^kept worktree writer-15 \(cannot fetch \(.+\), so cannot tell whether it holds unlanded work\)$/,
        ),
      ]),
    });
    expect(existsSync(join(dir(), "writer-15"))).toBe(true);
    expect(log.filter((l) => l.startsWith("+"))).toEqual([]);
  });
});

describe("reconcile tells a person once, and never mistakes what it cannot check (#189 review)", () => {
  let p: Project;
  const pushes: PushRequest[] = [];
  beforeEach(() => {
    p = project("feat/x");
    pushes.length = 0;
  });
  afterEach(() => rmSync(p.root, { recursive: true, force: true }));

  const dir = () => join(p.clone, ".claude", "worktrees");
  const inTree = (name: string, ...args: string[]) =>
    execFileSync("git", args, { cwd: join(dir(), name), env: p.env, encoding: "utf8" }).trim();
  const landing: Reconcile["landing"] = {
    target: {
      kind: "ok",
      value: { forge: "gitlab", host: "gitlab.com", project: "a/b", identity: { kind: "own" }, env: {} },
    },
    pusher: async (request) => {
      pushes.push(request);
      return { kind: "ok" };
    },
  };
  const run = (log: string[], change: Partial<Change>) =>
    reconcile({
      forge: forge(log, { change: { sourceBranch: "factory/PROJ-1", ...change } }),
      label: LABEL,
      repo: p.clone,
      env: p.env,
      dryRun: false,
      landing,
      sessions: async () => ({ kind: "ok", value: [] }),
    });

  // writer-12 on factory/PROJ-1, pushed, then one commit more: its sha before that commit
  function onBranch(): string {
    p.git("worktree", "add", "-q", "-b", "factory/PROJ-1", join(dir(), "writer-12"));
    inTree("writer-12", "push", "-q", "origin", "factory/PROJ-1");
    const pushed = inTree("writer-12", "rev-parse", "HEAD");
    writeFileSync(join(dir(), "writer-12", "fix.txt"), "fix\n");
    inTree("writer-12", "add", "fix.txt");
    inTree("writer-12", "commit", "-q", "-m", "fix");
    return pushed;
  }

  it("labels and notes once: a second reconcile on the same work tells no one again", async () => {
    p.git("worktree", "add", "-q", "--detach", join(dir(), "writer-14"));
    writeFileSync(join(dir(), "writer-14", "notes.txt"), "half done\n");
    const log: string[] = [];
    await run(log, {});
    const second = await run(log, {});
    expect(second).toEqual({
      kind: "ok",
      value: ["kept worktree writer-14 (0 unlanded commits, 1 uncommitted file; handed to a person already)"],
    });
    expect(log.filter((l) => l.startsWith("+") || l.startsWith("note"))).toHaveLength(2);
    // new work is news again
    writeFileSync(join(dir(), "writer-14", "more.txt"), "more\n");
    await run(log, {});
    expect(log.filter((l) => l.startsWith("note"))).toHaveLength(2);
  });

  it("labels nothing on a merged change, even when its branch is gone and its commits read as unlanded", async () => {
    const pushed = onBranch();
    p.git("push", "-q", "origin", "--delete", "factory/PROJ-1");
    const log: string[] = [];
    const out = await run(log, { sha: pushed, state: "merged" });
    expect(out).toEqual({
      kind: "ok",
      value: [
        "kept worktree writer-12 (1 unlanded commit, 0 uncommitted files; the change is merged, so nothing is labelled or pushed)",
      ],
    });
    expect(log).toEqual([]);
    expect(pushes).toEqual([]);
  });

  it("does not push when the branch moved since the writer started; says so", async () => {
    onBranch();
    const moved = "1111111111111111111111111111111111111111";
    const log: string[] = [];
    const out = await run(log, { sha: moved });
    expect(out).toMatchObject({ kind: "ok", value: [expect.stringContaining("not pushed: ")] });
    expect(pushes).toEqual([]);
    expect(log).toContain("+needs-human !12");
  });

  it("keeps a folder that is not a worktree, and never reads the clone above it as one", async () => {
    // the clone has its own uncommitted work; a writer-13 folder with no .git sits inside it
    p.write("operator.txt", "the operator's own edit\n");
    mkdirSync(join(dir(), "writer-13"), { recursive: true });
    writeFileSync(join(dir(), "writer-13", "work.txt"), "work\n");
    const log: string[] = [];
    const out = await run(log, {});
    expect(out).toEqual({
      kind: "ok",
      value: [expect.stringMatching(/^kept worktree writer-13 \(.*not one of the clone's worktrees/)],
    });
    expect(existsSync(join(dir(), "writer-13", "work.txt"))).toBe(true);
    expect(log).toEqual([]);
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
