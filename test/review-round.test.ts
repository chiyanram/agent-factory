import { FLOOR } from "../src/core/review/never.js";
import { readActOn } from "../src/core/review/act-on.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { Done } from "../src/core/forge/api.js";
import type { Change, Forge } from "../src/core/forge/types.js";
import type { Note } from "../src/core/notes.js";
import { renderPost, type Post } from "../src/core/post.js";
import { claudeArgs, readAnswer, type Model, type ModelResult, type ModelRun } from "../src/core/review/model.js";
import { reviewRound, type ReviewSetup } from "../src/core/review/round.js";
import { reviewStep, worstCase } from "../src/core/review/step.js";
import type { RoundPart } from "../src/core/dispatch/spend.js";
import type { RunInput } from "../src/core/dispatch/tick.js";
import { approveSpec, changeAt, project, RULEBOOK, specText, writeSpec, type Project } from "./review-repo.js";

let p: Project;
beforeEach(() => {
  p = project();
  approveSpec(home());
});

// where specs and approvals live: ledger/PROJ-1 is approved there
const home = (): string => join(p.root, "factory");
afterEach(() => rmSync(p.root, { recursive: true, force: true }));

const FINDING = {
  axis: "standards",
  kind: "rule",
  file: "code/svc/Main.java",
  line: 1,
  rule: "ERR1",
  category: "bug",
  severity: "blocker",
  grade: "walked",
  evidence: "add(1, 1) returns 2 at svc/Main.java:1",
  finding: "returns 2",
  fix: "return the sum",
};

type Seen = {
  readonly run: ModelRun;
  readonly files: readonly string[];
  readonly findings: string;
  readonly plain: string;
};

function walk(dir: string): readonly string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => !d.isDirectory())
    .map((d) => relative(dir, join(d.parentPath, d.name)));
}

// A model that answers from a script and records what each run was shown.
function model(script: readonly unknown[], seen: Seen[]): Model {
  return async (run): Promise<ModelResult> => {
    const findings = existsSync(join(run.folder, "findings.json"))
      ? readFileSync(join(run.folder, "findings.json"), "utf8")
      : "";
    const plainPath = join(run.folder, "code", "plain.txt");
    seen.push({
      run,
      files: walk(run.folder),
      findings,
      plain: existsSync(plainPath) ? readFileSync(plainPath, "utf8") : "",
    });
    const output = script[seen.length - 1];
    return output === undefined
      ? { kind: "failed", reason: "no scripted answer", answer: undefined }
      : { kind: "ok", value: { output, answer: { usage: { input_tokens: 10 } }, costUsd: 0.1, tokens: 10 } };
  };
}

type Log = { posts: string[]; threads: string[]; labels: string[] };

// A forge that keeps its notes: what the reviewer posts, the next round reads.
function forge(
  log: Log,
  over: {
    readonly change?: Change;
    readonly moveTo?: string;
    readonly notes?: Note[];
    readonly threadFails?: boolean;
    readonly labelFails?: boolean;
  } = {},
): Forge {
  const notes: Note[] = over.notes ?? [];
  let calls = 0;
  const text = (post: Post) => {
    const r = renderPost(post);
    return r.kind === "ok" ? r.text : r.reason;
  };
  const failed = async (): Promise<{ kind: "failed"; reason: string }> => ({ kind: "failed", reason: "not used" });
  return {
    name: "gitlab",
    mark: "!",
    me: async () => ({ kind: "ok", value: "ram" }),
    change: async () => {
      calls += 1;
      const base = over.change ?? changeAt(p.head2);
      return { kind: "ok", value: calls > 1 && over.moveTo !== undefined ? { ...base, sha: over.moveTo } : base };
    },
    defaultBranch: async () => ({ kind: "ok", value: "main" }),
    branchExists: async () => ({ kind: "ok", value: false }),
    issueBody: failed,
    openChange: failed,
    notes: async () => ({ kind: "ok", value: [...notes] }),
    setBody: async () => ({ kind: "failed", reason: "the review does not set a body" }),
    note: async ({ post }): Promise<Done> => {
      const body = text(post);
      log.posts.push(body);
      notes.push({ body, author: { name: "ram" }, at: new Date().toISOString() });
      return { kind: "ok" };
    },
    status: failed,
    ciConfig: failed,
    lineFinding: async ({ at, post }): Promise<Done> => {
      log.threads.push(`${at.file}:${at.line} ${text(post)}`);
      return over.threadFails === true ? { kind: "failed", reason: "github: HTTP 502" } : { kind: "ok" };
    },
    addLabel: async ({ label }): Promise<Done> => {
      log.labels.push(label);
      return over.labelFails === true ? { kind: "failed", reason: "github: HTTP 502" } : { kind: "ok" };
    },
    removeLabel: failed,
    claimed: failed,
    changes: failed,
    failedJobs: failed,
  };
}

const PROMPTS = {
  find: join(import.meta.dirname, "..", "prompts", "review-find.md"),
  verify: join(import.meta.dirname, "..", "prompts", "review-verify.md"),
};

function setup(f: Forge, m: Model, over: Partial<ReviewSetup> = {}): ReviewSetup {
  return {
    forge: f,
    number: 12,
    factory: "ram",
    label: "agent::claimed",
    repo: p.clone,
    env: p.env,
    home: home(),
    project: "ledger",
    plugins: [{ label: "rulebook", dir: RULEBOOK }],
    packDir: join(p.root, "packs"),
    recordsDir: join(p.root, "records"),
    runsDir: join(p.root, "runs"),
    sessions: async () => ({ kind: "ok", value: [] }),
    maxRuns: 2,
    maxFinders: 4,
    prompts: PROMPTS,
    models: { find: "sonnet", rule: "sonnet", logic: "opus" },
    maxUsd: "2",
    model: m,
    ...over,
  };
}

const findAnswer = (findings: readonly unknown[]) => ({ findings });
const verdicts = (v: readonly unknown[]) => ({ verdicts: v });
const fresh = (): Log => ({ posts: [], threads: [], labels: [] });

describe("reviewRound", () => {
  it("runs find once and verify once per kind, each fresh and read-only, then posts threads and one summary", async () => {
    const log = fresh();
    const seen: Seen[] = [];
    const logic = {
      ...FINDING,
      kind: "logic",
      axis: "spec",
      rule: "correctness",
      category: "speculative",
      finding: "AC1 not met",
    };
    const m = model(
      [
        findAnswer([FINDING, logic]),
        verdicts([{ id: "F1", bucket: "act_on", why: "real" }]),
        verdicts([{ id: "F2", bucket: "consider", why: "judgment" }]),
      ],
      seen,
    );
    const out = await reviewRound(setup(forge(log), m));
    expect(out).toMatchObject({
      kind: "ok",
      value: { kind: "posted", round: 1, head: p.head2, counts: { act_on: 1, consider: 1, noted: 0, dismissed: 0 } },
    });
    expect(seen.map((s) => s.run.model)).toEqual(["sonnet", "sonnet", "opus"]);
    expect(seen.every((s) => s.run.maxUsd === "2" && s.run.name === "reviewer-12")).toBe(true);
    expect(log.threads).toHaveLength(2);
    expect(log.threads[0]).toMatch(
      /^svc\/Main\.java:1 \[reviewer\] Act on F1 \(blocker, bug, ERR1\): returns 2\n\n- Fix: return the sum\n- Evidence: walked · add\(1, 1\) returns 2 at svc\/Main\.java:1$/,
    );
    const summary = log.posts.at(-1) ?? "";
    expect(summary.split("\n")[0]).toMatch(
      new RegExp(
        `^\\[reviewer\\] round 1 · head ${p.head2} · patch-id [0-9a-f]+ · Act on 1 · Consider 1 · Noted 0 · Dismissed 0$`,
      ),
    );
    expect(summary).toContain("- Standards · Act on F1 svc/Main.java:1 ERR1 (bug): returns 2 (real)");
    expect(summary).toContain("- Spec · Consider F2 svc/Main.java:1 correctness (speculative): AC1 not met (judgment)");
    expect(readdirSync(join(p.root, "runs"))).toEqual([]);
  });

  it("quotes the approved spec's criterion a Spec finding fails, in its thread and the summary (#219)", async () => {
    const log = fresh();
    const spec = { ...FINDING, axis: "spec", rule: "AC2", finding: "an empty order totals 1" };
    const stray = { ...FINDING, axis: "spec", rule: "AC9", finding: "names a criterion the spec lacks" };
    const standards = { ...FINDING, line: 2, rule: "AC2" };
    const m = model(
      [
        findAnswer([spec, stray, standards]),
        verdicts([
          { id: "F1", bucket: "act_on", why: "real" },
          { id: "F2", bucket: "consider", why: "maybe" },
          { id: "F3", bucket: "consider", why: "maybe" },
        ]),
      ],
      [],
    );
    await reviewRound(setup(forge(log), m));
    expect(log.threads[0]).toContain("- Criterion: 2. SPEC-AC2: an empty order totals 0.\n- Fix: return the sum");
    expect(log.threads[1]).toContain("- Criterion: AC9 is not in the approved spec");
    expect(log.threads[2]).not.toContain("Criterion");
    const summary = log.posts.at(-1) ?? "";
    expect(summary).toContain(
      "- Spec · Act on F1 svc/Main.java:1 AC2 (bug): an empty order totals 1 (real) · criterion 2. SPEC-AC2: an empty order totals 0.",
    );
    expect(summary).toContain("- Standards · Consider F3 svc/Main.java:2 AC2 (bug): returns 2 (maybe)\n");
  });

  it("shows each run the pack and the whole head, never a rule file, a symlink or a .gitattributes rewrite", async () => {
    p.git("checkout", "-q", "factory/PROJ-1");
    p.write("CLAUDE.md", "MR RULES");
    p.write(".claude/settings.json", "{}");
    p.write("other/untouched.txt", "untouched\n");
    p.write(".gitattributes", "secret.txt export-ignore\nplain.txt ident\n");
    p.write("secret.txt", "kept\n");
    p.write("plain.txt", "$Id$\n");
    p.git("add", "-A");
    p.git("commit", "-q", "-m", "rules");
    const { symlinkSync } = await import("node:fs");
    symlinkSync("CLAUDE.md", join(p.clone, "link.md"));
    p.git("add", "-A");
    p.git("commit", "-q", "-m", "link");
    p.git("push", "-q", "origin", "factory/PROJ-1");
    const head = p.git("rev-parse", "HEAD");
    p.git("checkout", "-q", "main");
    const seen: Seen[] = [];
    await reviewRound(setup(forge(fresh(), { change: changeAt(head) }), model([findAnswer([])], seen)));
    const files = seen[0]?.files ?? [];
    expect(files).toContain("pack.md");
    expect(files).toContain("code/other/untouched.txt");
    expect(files).toContain("code/secret.txt");
    expect(files.some((f) => /CLAUDE\.md|AGENTS\.md|\.claude\/|link\.md|\.gitattributes/.test(f))).toBe(false);
    // no ident rule re-encodes what the reviewer reads
    expect(seen[0]?.plain).toBe("$Id$\n");
  });

  it("keeps a finding the verify pass skipped as Consider, renumbers duplicate ids, and drops a code/ prefix", async () => {
    const log = fresh();
    const seen: Seen[] = [];
    const m = model(
      [
        findAnswer([
          { ...FINDING, id: "F1" },
          { ...FINDING, id: "F1", rule: "ERR2", finding: "second" },
        ]),
        verdicts([{ id: "F1", bucket: "dismissed", why: "no" }]),
      ],
      seen,
    );
    await reviewRound(setup(forge(log), m));
    expect(JSON.parse(seen[1]?.findings ?? "[]").map((f: { id: string; file: string }) => `${f.id} ${f.file}`)).toEqual(
      ["F1 svc/Main.java", "F2 svc/Main.java"],
    );
    expect(log.posts.at(-1)).toContain(
      "Consider F2 svc/Main.java:1 ERR2 (bug): second (the verify pass gave no verdict)",
    );
  });

  it("zero findings still posts the summary and says it is not a pass (#118)", async () => {
    const log = fresh();
    await reviewRound(setup(forge(log), model([findAnswer([])], [])));
    expect(log.posts.at(-1)).toContain("No findings. That is not a pass: the human still reviews before merge");
    expect(log.threads).toEqual([]);
  });

  it("reads its references from the project's plugins; with none, it stops with the reason and posts nothing (#232)", async () => {
    const log = fresh();
    const out = await reviewRound(setup(forge(log), model([], []), { plugins: [] }));
    expect(out).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("needs a plugin that holds its review"),
    });
    expect(log.posts).toEqual([]);
    // a plugin with no process still serves the built-in baseline's references
    const other = { label: "team@acme", dir: join(p.root, "none") };
    await reviewRound(
      setup(forge(log), model([findAnswer([])], []), { plugins: [{ label: "rulebook", dir: RULEBOOK }, other] }),
    );
    expect(log.posts.at(-1)).toContain("No findings");
  });

  it("sends the engine's floor ahead of every pass, even when the instructions file leaves the Never list out (#185)", async () => {
    const bare = join(p.root, "bare-find.md");
    writeFileSync(bare, "Find what breaks. Report each finding.\n");
    const seen: Seen[] = [];
    await reviewRound(
      setup(forge(fresh()), model([findAnswer([FINDING]), verdicts([])], seen), {
        prompts: { find: bare, verify: PROMPTS.verify },
      }),
    );
    expect(seen.map((s) => s.run.prompt.startsWith(FLOOR))).toEqual([true, true]);
    expect(seen[0]?.run.prompt).toContain("approve or merge");
    expect(seen[0]?.run.prompt.endsWith("Find what breaks. Report each finding.\n")).toBe(true);
  });

  it("a head that moved during the review posts nothing: MOVED", async () => {
    const log = fresh();
    const out = await reviewRound(
      setup(
        forge(log, { moveTo: "f".repeat(40) }),
        model([findAnswer([FINDING]), verdicts([{ id: "F1", bucket: "act_on", why: "x" }])], []),
      ),
    );
    expect(out).toMatchObject({ kind: "ok", value: { kind: "moved", from: p.head2, to: "f".repeat(40) } });
    expect(log.posts).toEqual([]);
    expect(log.threads).toEqual([]);
  });

  it("the same patch-id reuses the last verdict with no model run; with Act on open, no progress goes to the human", async () => {
    const log = fresh();
    const f = forge(log);
    await reviewRound(
      setup(f, model([findAnswer([FINDING]), verdicts([{ id: "F1", bucket: "act_on", why: "x" }])], [])),
    );
    // the same head again is left alone
    expect(await reviewRound(setup(f, model([], [])))).toMatchObject({ kind: "ok", value: { kind: "already" } });
    // a new head with the same patch (a rebase-free amend of the message only) reuses
    p.git("checkout", "-q", "factory/PROJ-1");
    p.git("commit", "-q", "--amend", "-m", "same patch, new message");
    p.git("push", "-q", "-f", "origin", "factory/PROJ-1");
    const head = p.git("rev-parse", "HEAD");
    p.git("checkout", "-q", "main");
    const seen: Seen[] = [];
    // the first round labelled already: the change edits svc/AGENTS.md, a protected file
    const labelsBefore = log.labels.length;
    const again = forge(log, {
      change: changeAt(head),
      notes: log.posts.map((body) => ({ body, author: { name: "ram" }, at: "2026-11-07T10:00:00Z" })),
    });
    const out = await reviewRound(setup(again, model([], seen)));
    expect(out).toMatchObject({ kind: "ok", value: { kind: "no-progress" } });
    expect(seen).toEqual([]);
    expect(log.labels.slice(labelsBefore)).toEqual(["needs-human"]);
    expect(log.posts.at(-1)).toMatch(new RegExp(`^\\[reviewer\\] round 1 reused · head ${head} · patch-id`));
  });

  it("the next full round rates the last round's Act on and Consider findings: acted on when a commit changed their region (#220)", async () => {
    const log = fresh();
    const far = { ...FINDING, kind: "logic", axis: "spec", file: "code/docs/design/order.md", line: 40 };
    const first = await reviewRound(
      setup(
        forge(log),
        model(
          [
            findAnswer([FINDING, far]),
            verdicts([{ id: "F1", bucket: "act_on", why: "real" }]),
            verdicts([{ id: "F2", bucket: "consider", why: "maybe" }]),
          ],
          [],
        ),
      ),
    );
    expect(first).toMatchObject({ kind: "ok", value: { kind: "posted", round: 1, acted: "none" } });
    p.git("checkout", "-q", "factory/PROJ-1");
    p.write("svc/Main.java", "class Main { int total() { return 3; } }\n");
    const head = p.commitAll("fix the sum");
    p.git("push", "-q", "origin", "factory/PROJ-1");
    p.git("checkout", "-q", "main");
    const notes = log.posts.map((body) => ({ body, author: { name: "ram" }, at: "2026-11-07T10:00:00Z" }));
    const second = await reviewRound(setup(forge(log, { change: changeAt(head), notes }), model([findAnswer([])], [])));
    expect(second).toMatchObject({
      kind: "ok",
      value: {
        kind: "posted",
        round: 2,
        acted: {
          since: p.head2,
          rows: [
            { id: "F1", lens: "rule", category: "bug", bucket: "act_on", file: "svc/Main.java", line: 1, acted: true },
            {
              id: "F2",
              lens: "logic",
              category: "bug",
              bucket: "consider",
              file: "docs/design/order.md",
              line: 40,
              acted: false,
            },
          ],
        },
      },
    });
  });

  it("a failed needs-human label posts no reuse note, so the next run tries again", async () => {
    const log = fresh();
    const first = forge(log);
    await reviewRound(
      setup(first, model([findAnswer([FINDING]), verdicts([{ id: "F1", bucket: "act_on", why: "x" }])], [])),
    );
    p.git("checkout", "-q", "factory/PROJ-1");
    p.git("commit", "-q", "--amend", "-m", "same patch");
    p.git("push", "-q", "-f", "origin", "factory/PROJ-1");
    const head = p.git("rev-parse", "HEAD");
    p.git("checkout", "-q", "main");
    const before = log.posts.length;
    const out = await reviewRound(
      setup(
        forge(log, {
          change: changeAt(head),
          labelFails: true,
          notes: log.posts.map((body) => ({ body, author: { name: "ram" }, at: "t" })),
        }),
        model([], []),
      ),
    );
    expect(out.kind).toBe("failed");
    expect(log.posts.length).toBe(before);
  });

  it("after 3 rounds it goes to the human; a [reviewer] line from another account is no round", async () => {
    const round = (n: number, sha: string) => ({
      body: `[reviewer] round ${n} · head ${sha} · patch-id ${"a".repeat(40)} · Act on 1 · Consider 0 · Noted 0 · Dismissed 0`,
      author: { name: "ram" },
      at: "t",
    });
    const three = [round(1, p.head1), round(2, p.head1), round(3, p.head1)];
    expect(await reviewRound(setup(forge(fresh(), { notes: three }), model([], [])))).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("3 review rounds"),
    });
    const stranger = [{ ...round(1, p.head1), author: { name: "eve" } }, round(2, p.head1), round(3, p.head1)];
    expect(await reviewRound(setup(forge(fresh(), { notes: stranger }), model([findAnswer([])], [])))).toMatchObject({
      kind: "ok",
      value: { kind: "posted", round: 3 },
    });
  });

  it("drops a verdict on a finding of the other kind, so the rule pass cannot dismiss a logic finding", async () => {
    const log = fresh();
    const logic = { ...FINDING, kind: "logic", axis: "spec", rule: "correctness", finding: "AC1 not met" };
    const out = await reviewRound(
      setup(
        forge(log),
        model(
          [
            findAnswer([FINDING, logic]),
            verdicts([
              { id: "F1", bucket: "act_on", why: "real" },
              { id: "F2", bucket: "dismissed", why: "the rule pass overreaches" },
            ]),
            verdicts([{ id: "F2", bucket: "act_on", why: "real" }]),
          ],
          [],
        ),
      ),
    );
    expect(out).toMatchObject({ kind: "ok", value: { counts: { act_on: 2, dismissed: 0 } } });
  });

  it("an empty change goes to the human with no model run", async () => {
    const main = p.git("rev-parse", "main");
    p.git("push", "-q", "-f", "origin", "main:factory/PROJ-1");
    const log = fresh();
    const seen: Seen[] = [];
    const out = await reviewRound(setup(forge(log, { change: changeAt(main) }), model([], seen)));
    expect(out).toMatchObject({ kind: "ok", value: { kind: "no-progress", why: "the change is empty" } });
    expect(seen).toEqual([]);
    expect(log.labels).toEqual(["needs-human"]);
    expect(log.posts).toEqual([]);
  });

  it("after 3 rounds an unchanged patch still reuses its verdict rather than refusing", async () => {
    const log = fresh();
    await reviewRound(setup(forge(log), model([findAnswer([]), verdicts([])], [])));
    const id = /patch-id ([0-9a-f]+)/.exec(log.posts.at(-1) ?? "")?.[1] ?? "";
    const round = (n: number, sha: string) => ({
      body: `[reviewer] round ${n} · head ${sha} · patch-id ${id} · Act on 0 · Consider 0 · Noted 0 · Dismissed 0`,
      author: { name: "ram" },
      at: "t",
    });
    p.git("checkout", "-q", "factory/PROJ-1");
    p.git("commit", "-q", "--amend", "-m", "same patch");
    p.git("push", "-q", "-f", "origin", "factory/PROJ-1");
    const head = p.git("rev-parse", "HEAD");
    p.git("checkout", "-q", "main");
    const notes = [round(1, p.head1), round(2, p.head1), round(3, p.head2)];
    const out = await reviewRound(setup(forge(fresh(), { change: changeAt(head), notes }), model([], [])));
    expect(out).toMatchObject({ kind: "ok", value: { kind: "reused", round: 3, actOn: 0 } });
  });

  it("refuses an unclaimed change, and a failed find posts nothing and leaves no folder", async () => {
    expect(
      await reviewRound(setup(forge(fresh(), { change: changeAt(p.head2, { labels: [] }) }), model([], []))),
    ).toMatchObject({ kind: "failed", reason: expect.stringContaining("claim it first") });
    const log = fresh();
    expect(await reviewRound(setup(forge(log), model([], [])))).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("find pass failed"),
    });
    expect(log.posts).toEqual([]);
    expect(readdirSync(join(p.root, "runs"))).toEqual([]);
  });

  it("a thread that cannot be posted fails the round, and no summary marks it done", async () => {
    const log = fresh();
    const out = await reviewRound(
      setup(
        forge(log, { threadFails: true }),
        model([findAnswer([FINDING]), verdicts([{ id: "F1", bucket: "act_on", why: "x" }])], []),
      ),
    );
    expect(out.kind).toBe("failed");
    expect(log.posts).toEqual([]);
  });

  it("lists a protected file in the box and labels needs-human once; a file listed before does not relabel", async () => {
    p.git("checkout", "-q", "factory/PROJ-1");
    p.write(".github/workflows/ci.yml", "on: push\n");
    p.write("package.json", JSON.stringify({ dependencies: { "left-pad": "1.0.0" } }));
    p.commitAll("ci");
    p.git("push", "-q", "origin", "factory/PROJ-1");
    const head = p.git("rev-parse", "HEAD");
    p.git("checkout", "-q", "main");
    const log = fresh();
    await reviewRound(setup(forge(log, { change: changeAt(head) }), model([findAnswer([])], [])));
    expect(log.labels).toEqual(["needs-human"]);
    const summary = log.posts.at(-1) ?? "";
    expect(summary).toContain("- Protected · .github/workflows/ci.yml");
    expect(summary).toContain("- Build · package.json");
    expect(summary).toContain("- New dependency · left-pad (package.json)");
    // a later round that lists the same file again does not label
    p.git("checkout", "-q", "factory/PROJ-1");
    p.write("svc/Main.java", "class Main { int total() { return 3; } }\n");
    p.commitAll("more");
    p.git("push", "-q", "origin", "factory/PROJ-1");
    const later = p.git("rev-parse", "HEAD");
    p.git("checkout", "-q", "main");
    const again = fresh();
    await reviewRound(
      setup(
        forge(again, {
          change: changeAt(later),
          notes: log.posts.map((body) => ({ body, author: { name: "ram" }, at: "t" })),
        }),
        model([findAnswer([])], []),
      ),
    );
    expect(again.labels).toEqual([]);
    expect(again.posts.at(-1)).toContain("- Protected · .github/workflows/ci.yml");
  });

  it("no line of any post starts with /: a finding cannot run a GitLab quick action", async () => {
    const log = fresh();
    const evil = { ...FINDING, finding: "x\n/approve\n/merge", fix: "\n/label ~ok" };
    await reviewRound(
      setup(forge(log), model([findAnswer([evil]), verdicts([{ id: "F1", bucket: "act_on", why: "\n/close" }])], [])),
    );
    for (const text of [...log.posts, ...log.threads.map((t) => t.slice(t.indexOf(" ") + 1))]) {
      expect(text.split("\n").some((l) => l.startsWith("/"))).toBe(false);
    }
  });
});

describe("live runs", () => {
  const ok = (names: readonly string[]) => async () => ({ kind: "ok" as const, value: names });

  it("refuses a change that already has a live writer, and a machine at its run limit; posts nothing", async () => {
    const log = fresh();
    expect(await reviewRound(setup(forge(log), model([], []), { sessions: ok(["writer-12"]) }))).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("already has a live run: writer-12"),
    });
    expect(
      await reviewRound(setup(forge(log), model([], []), { sessions: ok(["writer-1", "writer-2"]) })),
    ).toMatchObject({ kind: "failed", reason: expect.stringContaining("run limit: 2 live runs (FACTORY_MAX_RUNS=2)") });
    expect(
      await reviewRound(
        setup(forge(log), model([], []), {
          sessions: async () => ({ kind: "failed", reason: "cannot list live runs" }),
        }),
      ),
    ).toMatchObject({ kind: "failed", reason: expect.stringContaining("cannot list live runs") });
    expect(log.posts).toEqual([]);
  });

  it("holds reviewer-<n>.pid while it runs, removes it after, and is not stopped by the pid file of a dead run", async () => {
    const runs = join(p.clone, ".claude", "runs");
    mkdirSync(runs, { recursive: true });
    writeFileSync(join(runs, "reviewer-12.pid"), "999999999");
    writeFileSync(join(runs, "writer-3.pid"), String(process.pid));
    const held: string[] = [];
    const m: Model = async (run) => {
      held.push(readFileSync(join(runs, "reviewer-12.pid"), "utf8"));
      return model([findAnswer([])], [])(run);
    };
    const out = await reviewRound(setup(forge(fresh()), m, { maxRuns: 2 }));
    expect(out).toMatchObject({ kind: "ok", value: { kind: "posted" } });
    expect(held).toEqual([String(process.pid)]);
    expect(existsSync(join(runs, "reviewer-12.pid"))).toBe(false);
    // the live writer-3 counts: with a limit of 1 the machine is full
    expect(await reviewRound(setup(forge(fresh()), model([], []), { maxRuns: 1 }))).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("run limit"),
    });
  });

  it("makes each run folder inside a private folder", async () => {
    const folders: string[] = [];
    const m: Model = async (run) => {
      folders.push(run.folder);
      return model([findAnswer([])], [])(run);
    };
    await reviewRound(setup(forge(fresh()), m));
    expect(folders[0]?.startsWith(join(p.root, "runs"))).toBe(true);
    expect(statSync(join(p.root, "runs")).mode & 0o777).toBe(0o700);
  });
});

describe("pass records", () => {
  it("keeps each pass's answer with the head, and a pass that failed for its budget too", async () => {
    const budget = { type: "result", is_error: true, subtype: "error_max_budget_usd", usage: { input_tokens: 7000 } };
    const failing: Model = async () => ({ kind: "failed", reason: "error_max_budget_usd", answer: budget });
    expect(await reviewRound(setup(forge(fresh()), failing))).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("error_max_budget_usd"),
    });
    await reviewRound(setup(forge(fresh()), model([findAnswer([])], [])));
    const kept = readFileSync(join(p.root, "records", "12", p.head2, "reviewer-find.jsonl"), "utf8")
      .trim()
      .split("\n");
    expect(kept.map((l) => JSON.parse(l).usage.input_tokens)).toEqual([7000, 10]);
  });

  it("keeps the round's Act on findings with the head, for a rework run, and the Consider ones not (#171)", async () => {
    const other = { ...FINDING, id: "F2", finding: "a name could be clearer" };
    const m = model(
      [
        findAnswer([FINDING, other]),
        verdicts([
          { id: "F1", bucket: "act_on", why: "real" },
          { id: "F2", bucket: "consider", why: "judgment" },
        ]),
      ],
      [],
    );
    await reviewRound(setup(forge(fresh()), m));
    const kept = await readActOn({ recordsDir: join(p.root, "records"), change: 12, head: p.head2 });
    expect(kept).toEqual({
      kind: "ok",
      value: [
        {
          id: "F1",
          // as the repo names it: the reviewer's copy sits under code/
          file: "svc/Main.java",
          line: FINDING.line,
          rule: FINDING.rule,
          severity: FINDING.severity,
          finding: FINDING.finding,
          fix: FINDING.fix,
        },
      ],
    });
  });

  it("posts nothing when it cannot keep the Act on findings", async () => {
    const log = fresh();
    writeFileSync(join(p.root, "records"), "a file where the folder goes");
    const m = model([findAnswer([FINDING]), verdicts([{ id: "F1", bucket: "act_on", why: "real" }])], []);
    expect(await reviewRound(setup(forge(log), m))).toMatchObject({
      kind: "failed",
      reason: expect.stringMatching(/cannot keep .*act-on\.json/),
    });
    expect(log.threads).toEqual([]);
  });

  it("readAnswer gives back the CLI's answer on a failure, and never throws on one that is not JSON", () => {
    expect(
      readAnswer({
        code: 1,
        stdout: JSON.stringify({ is_error: true, subtype: "error_max_turns", usage: { input_tokens: 5 } }),
        stderr: "",
      }),
    ).toMatchObject({ kind: "failed", reason: "error_max_turns", answer: { usage: { input_tokens: 5 } } });
    expect(readAnswer({ code: 0, stdout: "<html>", stderr: "boom" })).toMatchObject({ kind: "failed", reason: "boom" });
    expect(
      readAnswer({
        code: 0,
        stdout: JSON.stringify({
          is_error: false,
          structured_output: { findings: [] },
          total_cost_usd: 0.2,
          usage: { input_tokens: 3, output_tokens: 4 },
        }),
        stderr: "",
      }),
    ).toEqual({
      kind: "ok",
      value: {
        output: { findings: [] },
        answer: {
          is_error: false,
          structured_output: { findings: [] },
          total_cost_usd: 0.2,
          usage: { input_tokens: 3, output_tokens: 4 },
        },
        costUsd: 0.2,
        tokens: 7,
      },
    });
  });
});

describe("reviewRound: the approved spec (#224)", () => {
  const packText = (): string => {
    const [only] = readdirSync(join(p.root, "packs"));
    return only === undefined ? "" : readFileSync(join(p.root, "packs", only), "utf8");
  };

  it("reviews against the ticket's approved spec from the store, named by the change's factory/<ticket> branch", async () => {
    await reviewRound(setup(forge(fresh()), model([findAnswer([])], [])));
    const text = packText();
    expect(text).toContain("## 5 · Intent and acceptance criteria (the approved spec)");
    expect(text).toContain("1. SPEC-AC1: total() returns the sum.");
    expect(text).toContain("approved by ram at t");
  });

  it("names a spec edited after approval in the pack, for the reviewer to report", async () => {
    writeSpec(home(), specText().replace("SPEC-AC2: an empty order totals 0.", "SPEC-AC2: totals 1."));
    await reviewRound(setup(forge(fresh()), model([findAnswer([])], [])));
    expect(packText()).toContain("it changed after a human approved it");
  });

  it("names a spec with no approval record in the pack", async () => {
    rmSync(join(home(), "approvals"), { recursive: true, force: true });
    await reviewRound(setup(forge(fresh()), model([findAnswer([])], [])));
    expect(packText()).toContain("has no approval");
  });

  it("runs no model and posts nothing when the store has no spec for the ticket", async () => {
    rmSync(join(home(), "specs"), { recursive: true, force: true });
    const log = fresh();
    const seen: Seen[] = [];
    expect(await reviewRound(setup(forge(log), model([findAnswer([])], seen)))).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("there is no spec for ledger/PROJ-1"),
    });
    expect(seen).toEqual([]);
    expect(log.posts).toEqual([]);
  });

  it("refuses a change that is not on factory/<ticket>: it names no spec", async () => {
    p.git("push", "-q", "origin", `${p.head2}:refs/heads/feat/y`);
    const seen: Seen[] = [];
    const change = changeAt(p.head2, { sourceBranch: "feat/y" });
    expect(await reviewRound(setup(forge(fresh(), { change }), model([findAnswer([])], seen)))).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("not factory/<ticket>"),
    });
    expect(seen).toEqual([]);
  });

  it("refuses an approval record it cannot read, rather than reading it as no approval", async () => {
    writeFileSync(join(home(), "approvals", "ledger", "PROJ-1.json"), "not json");
    expect(await reviewRound(setup(forge(fresh()), model([findAnswer([])], [])))).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("not valid JSON"),
    });
  });
});

describe("claudeArgs", () => {
  it("is restricted, with no MCP servers, Read, Grep and Glob only, a budget cap and a schema; never resumed", () => {
    const args = claudeArgs({
      folder: "/x",
      model: "opus",
      schema: "{}",
      prompt: "P",
      name: "reviewer-12",
      maxUsd: "2",
    });
    expect(args).toEqual([
      "-p",
      "-n",
      "reviewer-12",
      "--model",
      "opus",
      "--restricted",
      "--strict-mcp-config",
      "--tools",
      "Read,Grep,Glob",
      "--max-budget-usd",
      "2",
      "--output-format",
      "json",
      "--json-schema",
      "{}",
      "P",
    ]);
    expect(args.some((a) => /^--(resume|continue)$|^-c$|^-r$/.test(a))).toBe(false);
    expect(claudeArgs({ folder: "/x", model: "opus", schema: "{}", prompt: "P", name: "n", maxUsd: "" })).not.toContain(
      "--max-budget-usd",
    );
  });

  it("gives a role card's run the card's tools, which can narrow Read, Grep and Glob, never widen them (#232)", () => {
    const run = { folder: "/x", model: "opus", schema: "{}", prompt: "P", name: "n", maxUsd: "" };
    expect(claudeArgs({ ...run, tools: ["Glob", "Read"] })).toContain("Read,Glob");
    expect(claudeArgs({ ...run, tools: ["Read", "Bash"] })).toContain("Read");
    expect(claudeArgs({ ...run, tools: ["Read", "Bash"] }).join(" ")).not.toContain("Bash");
  });
});

describe("reviewStep", () => {
  const input = (number: number): RunInput => ({
    ticket: "PROJ-12",
    head: p.head2,
    change: {
      kind: "open",
      line: {
        kind: "open",
        number,
        branch: "factory/PROJ-1",
        fork: false,
        lastNoteAt: "",
        head: p.head2,
        draft: false,
        claimed: true,
        pipeline: { kind: "success" },
        needsHuman: false,
        stop: { kind: "none" },
        asks: 0,
        mergeable: "clean",
      },
    },
  });
  const env = () => ({ ...p.env, FACTORY_REPO: p.clone, FACTORY_HOME: home() });
  const plugins = [{ label: "rulebook", dir: RULEBOOK }];
  const none = async () => ({ kind: "ok" as const, value: [] });

  it("is unavailable without its settings, and refuses a bad one", () => {
    expect(reviewStep({ env: {}, forge: forge(fresh()), factory: "ram", project: "ledger", plugins })).toMatchObject({
      kind: "unavailable",
    });
    expect(
      reviewStep({
        env: { ...env(), FACTORY_MAX_RUNS: "0" },
        forge: forge(fresh()),
        factory: "ram",
        project: "ledger",
        plugins,
      }),
    ).toMatchObject({ kind: "unavailable", reason: expect.stringContaining("FACTORY_MAX_RUNS") });
  });

  it("gives the table the Act on count of a posted round, and fails when the head moved", async () => {
    const m = () => model([findAnswer([FINDING]), verdicts([{ id: "F1", bucket: "act_on", why: "x" }])], []);
    const step = reviewStep({
      env: env(),
      forge: forge(fresh()),
      factory: "ram",
      project: "ledger",
      plugins,
      model: m(),
      sessions: none,
    });
    // the round's spend goes to the run record (#131): each pass of the fake model costs $0.10 and 10 tokens
    expect(step.kind === "available" ? await step.run(input(12)) : step).toEqual({
      kind: "ok",
      value: {
        actOn: 1,
        lenses: { baseline: 1 },
        spend: { usd: 0.2, tokens: 20 },
        // and per run: the finder's by its lens, and the verify pass's (#337)
        split: { finders: { baseline: { usd: 0.1, tokens: 10 } }, verify: { usd: 0.1, tokens: 10 } },
      },
    });
    const movedStep = reviewStep({
      env: env(),
      forge: forge(fresh(), { moveTo: "f".repeat(40) }),
      factory: "ram",
      project: "ledger",
      plugins,
      model: m(),
      sessions: none,
    });
    expect(movedStep.kind === "available" ? await movedStep.run(input(12)) : movedStep).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("the head moved"),
    });
  });

  it("a round whose pass fails still gives what every pass spent, the failed one's too (#131)", async () => {
    const found = model([findAnswer([FINDING])], []);
    let calls = 0;
    const failing: Model = async (run) => {
      calls += 1;
      return calls === 1
        ? found(run)
        : {
            kind: "failed",
            reason: "error_max_budget_usd",
            answer: { subtype: "error_max_budget_usd", total_cost_usd: 0.7, usage: { output_tokens: 30 } },
          };
    };
    const step = reviewStep({
      env: env(),
      forge: forge(fresh()),
      factory: "ram",
      project: "ledger",
      plugins,
      model: failing,
      sessions: none,
    });
    expect(step.kind === "available" ? await step.run(input(12)) : step).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("pass failed"),
      spend: { usd: expect.closeTo(0.8, 9), tokens: 40 },
      // the failed verify pass's spend is its own (#337)
      split: { finders: { baseline: { usd: 0.1, tokens: 10 } }, verify: { usd: 0.7, tokens: 30 } },
    });
  });
});

describe("one finder per lens (#237)", () => {
  // the project's lenses, as its settings file holds them, with its one-way-door paths
  function lenses(oneWayDoor: readonly string[] = []): void {
    mkdirSync(join(home(), "projects"), { recursive: true });
    const lens = (name: string, reference: string) => ({
      name,
      rubric: { plugin: "rulebook", skill: "code", reference },
    });
    writeFileSync(
      join(home(), "projects", "ledger.json"),
      JSON.stringify({
        review: {
          lenses: [
            lens("errors", "errors"),
            lens("smells", "smells"),
            { name: "api", rubric: { file: "docs/review/api.md" } },
            lens("late", "errors"),
          ],
        },
        lanes: { oneWayDoor },
      }),
    );
  }

  // the lens a finder run was for: its pack's section 8, or the baseline lens with none
  const lensOf = (run: ModelRun): string =>
    /## 8 · This finder's lens: (\S+)/.exec(readFileSync(join(run.folder, "pack.md"), "utf8"))?.[1] ?? "baseline";

  type Ran = { readonly lens: string; readonly model: string; readonly pack: string; readonly findings: string };

  // the verify pass's answer: every finding it sees in Act on
  function allActOn(findings: string): unknown {
    const ids: readonly { readonly id: string }[] = JSON.parse(findings);
    return verdicts(ids.map((f) => ({ id: f.id, bucket: "act_on", why: "real" })));
  }

  // a model that answers each finder by its lens, and puts every finding the verify pass sees in Act on
  function byLens(found: Readonly<Record<string, readonly unknown[]>>, ran: Ran[]): Model {
    return async (run): Promise<ModelResult> => {
      const path = join(run.folder, "findings.json");
      const findings = existsSync(path) ? readFileSync(path, "utf8") : "";
      const lens = findings === "" ? lensOf(run) : "verify";
      ran.push({ lens, model: run.model, pack: readFileSync(join(run.folder, "pack.md"), "utf8"), findings });
      const output = findings === "" ? findAnswer(found[lens] ?? []) : allActOn(findings);
      return { kind: "ok", value: { output, answer: { usage: { input_tokens: 10 } }, costUsd: 0.1, tokens: 10 } };
    };
  }

  // the api lens's rubric, on the default branch
  function apiRubric(): void {
    p.write("docs/review/api.md", "API-RUBRIC\n");
    p.commitAll("api rubric");
    p.git("push", "-q", "origin", "main");
  }

  it("runs the lane's count of lenses, each in its own run with its rubric, on the finder's model", async () => {
    lenses();
    apiRubric();
    const ran: Ran[] = [];
    const out = await reviewRound(setup(forge(fresh()), byLens({}, ran)));
    expect(out).toMatchObject({ kind: "ok", value: { kind: "posted", lenses: { errors: 0, smells: 0, api: 0 } } });
    const finders = ran.filter((r) => r.lens !== "verify");
    expect(finders.map((r) => r.lens).toSorted()).toEqual(["api", "errors", "smells"]);
    expect(finders.every((r) => r.model === "sonnet")).toBe(true);
    expect(finders.find((r) => r.lens === "api")?.pack).toContain("API-RUBRIC");
    expect(finders.find((r) => r.lens === "errors")?.pack).not.toContain("API-RUBRIC");
  });

  it("runs every lens on the strongest model for a one-way door, and one lens for a tiny change", async () => {
    lenses(["svc/**"]);
    apiRubric();
    const door: Ran[] = [];
    await reviewRound(setup(forge(fresh()), byLens({}, door)));
    const doorFinders = door.filter((r) => r.lens !== "verify");
    expect(doorFinders.map((r) => r.lens).toSorted()).toEqual(["api", "errors", "late", "smells"]);
    expect(doorFinders.every((r) => r.model === "opus")).toBe(true);

    lenses();
    approveSpec(home(), specText().replace("\nfeature\n", "\ntiny\n"));
    const tiny: Ran[] = [];
    await reviewRound(setup(forge(fresh()), byLens({}, tiny)));
    expect(tiny.filter((r) => r.lens !== "verify").map((r) => [r.lens, r.model])).toEqual([["errors", "sonnet"]]);
  });

  it("posts one finding when two lenses report the same file:line and rule, keeping the stronger grade", async () => {
    lenses();
    apiRubric();
    const log = fresh();
    const ran: Ran[] = [];
    const cited = { ...FINDING, grade: "cited", finding: "cited one" };
    const walked = { ...FINDING, grade: "walked", finding: "walked one" };
    const other = { ...FINDING, line: 2, rule: "ERR2", finding: "only smells" };
    const out = await reviewRound(setup(forge(log), byLens({ errors: [cited], smells: [walked, other] }, ran)));
    const verified = JSON.parse(ran.find((r) => r.lens === "verify")?.findings ?? "[]");
    expect(
      verified.map((f: { lens: string; lenses: string[]; finding: string }) => [f.lens, f.lenses, f.finding]),
    ).toEqual([
      ["smells", ["errors", "smells"], "walked one"],
      ["smells", ["smells"], "only smells"],
    ]);
    expect(log.threads).toHaveLength(2);
    // the run record: each lens's verified findings no other lens reported
    expect(out).toMatchObject({ kind: "ok", value: { lenses: { errors: 0, smells: 1, api: 0 } } });
    expect(log.posts.at(-1)).toContain("- Unique findings per lens: errors 0 · smells 1 · api 0");
    const kept = readFileSync(join(p.root, "records", "12", p.head2, "reviewer-lenses.jsonl"), "utf8");
    expect(JSON.parse(kept)).toEqual({ lane: "feature", strongest: false, unique: { errors: 0, smells: 1, api: 0 } });
  });

  it("runs at most review.maxFinders finders at once; the round is one run with that many model runs", async () => {
    lenses(["svc/**"]);
    apiRubric();
    let now = 0;
    let most = 0;
    const ran: Ran[] = [];
    const inner = byLens({}, ran);
    // each finder's run waits until two are in flight, so the overlap does not hang on a runner's speed (#354); a
    // round that allowed only one gives up after 2 s and fails on 1
    const twoInFlight = async (): Promise<void> => {
      const until = Date.now() + 2_000;
      for (;;) {
        if (now >= 2 || Date.now() >= until) {
          return;
        }
        await new Promise((r) => setTimeout(r, 1));
      }
    };
    const counted: Model = async (run) => {
      if (run.part?.kind !== "finder") {
        return inner(run);
      }
      now += 1;
      most = Math.max(most, now);
      await twoInFlight();
      const out = await inner(run);
      now -= 1;
      return out;
    };
    await reviewRound(setup(forge(fresh()), counted, { maxFinders: 2 }));
    expect(ran.filter((r) => r.lens !== "verify")).toHaveLength(4);
    expect(most).toBe(2);
  });

  it("names each model run's part, each finder's lens and the verify pass, so its spend is split (#337)", async () => {
    lenses();
    apiRubric();
    const parts: (RoundPart | undefined)[] = [];
    const inner = byLens({ errors: [FINDING] }, []);
    const tagged: Model = async (run) => {
      parts.push(run.part);
      return inner(run);
    };
    await reviewRound(setup(forge(fresh()), tagged));
    const lensOfPart = (x: RoundPart | undefined): readonly string[] => (x?.kind === "finder" ? [x.lens] : []);
    expect(parts.flatMap(lensOfPart).toSorted()).toEqual(["api", "errors", "smells"]);
    // every other run is a verify pass, and there is one
    const verify = parts.filter((x) => x?.kind === "verify pass");
    expect(verify.length).toBeGreaterThan(0);
    expect(parts).toHaveLength(3 + verify.length);
  });

  it("puts a round's worst case at every finder and both verify passes at the per-run cap", () => {
    expect(worstCase(3, "0.50")).toBe(2.5);
    expect(worstCase(1, "")).toBe("unbounded");
  });

  it("refuses the round when a picked lens's rubric cannot be read, and runs no finder", async () => {
    lenses();
    const ran: Ran[] = [];
    const out = await reviewRound(setup(forge(fresh()), byLens({}, ran)));
    expect(out).toMatchObject({ kind: "failed", reason: expect.stringContaining("the rubric of the lens api") });
    expect(ran).toEqual([]);
  });
});
