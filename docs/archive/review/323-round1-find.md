Reviewed df0e4f1117d6da9a5e9627b2017c217a0475b51f..262c60be136c6800259ac681a84a44f0c45c699c · patch-id 5e91baf09a84e0372e88e7e303506a8762990b66 · round 1

Head confirmed: `origin/chore/814-heavy-run-lock` = `262c60be`. One commit. 6 files, +176 / -52.

## Intent

**#814** — one heavy run per machine, and force-with-lease for writers (its MR is **!323**). From the issue: two heavy
runs at once ran the 9 GB VM out of memory. `make verify`, `verify-full`, `verify-module` and `it-module` must take a
machine-wide heavy-run lock through the same mechanism as `scripts/stack-lock.sh` (#717). A second heavy run waits or
exits 75 with the holder named. `make status` shows the holder. Deploy/smoke locking stays unchanged. `rules.md` gets
the rebase + `--force-with-lease` rule. Approved design (option A): one script, a lock-name parameter, two lock files
(`stack` default, `heavy`).

## Standards

### 1. [warning] rules.md says the lease means a rebase "never" erases a reviewer's commit — false after any fetch          Standards
Location   .claude/skills/aruvii-git/references/rules.md:11-13
Rule       correctness of agent-facing guidance; writing-for-agents "relevance" (a line must bear true on the task)
Finding    Bare `--force-with-lease` compares against the local remote-tracking ref. Any `git fetch` that runs after the
           reviewer's push (by the agent, an IDE, or a background job) moves that ref, and the lease then passes. The
           line promises a guarantee the flag does not give, so an agent will trust it.
Evidence   input: reviewer pushes C to `origin/feat/x`. Writer runs `git fetch origin` (updates `origin/feat/x` to C),
           then `git rebase origin/master` (C is not in the writer's local branch). Writer runs
           `git push --force-with-lease`. State: lease expects C, remote is C → push accepted. Wrong result: C is erased,
           which the line says "never" happens. `git push` docs name this case and add `--force-if-includes` (git ≥ 2.30;
           this machine has 2.56) for it.
Suggestion Say `git push --force-with-lease --force-if-includes`, and drop "never" or bound it ("refuses when the
           remote has a commit your branch has not seen").

### 2. [warning] No test proves the four make targets go through the heavy lock          Standards
Location   scripts/stack-lock.test.sh:155-213; scripts/memory-limits.test.sh:104-106; Makefile:219, 230, 444
Rule       Tests lens — "would they fail if the behaviour broke?"; issue AC-1 "(a script test proves it)"
Finding    The new cases call `stack-lock.sh --lock heavy` directly with a label string. Only `verify` has a wiring
           check (memory-limits.test.sh:105). Remove `$(HEAVY_LOCK) run … --` from `it-module` (Makefile:219),
           `verify-module` (Makefile:230) or `verify-full` (Makefile:444), or the `$(HEAVY_LOCK) status` line
           (Makefile:142), and every test still passes. AC-1 names `make verify-module` itself.
Evidence   `grep -n "verify-module\|it-module\|verify-full" scripts/*.test.sh` → only label strings passed to the
           script (stack-lock.test.sh:160, 172, 197, 199). Stale-reclaim and INT/TERM release are also tested for
           the stack lock only (stack-lock.test.sh:124-146); the `--lock heavy` path of `reclaim` (message
           "reclaimed a stale heavy lock") has no case.
Suggestion Add `make -n <target>` contains-checks for `it-module`, `verify-module`, `verify-full`, as
           memory-limits.test.sh:105 does for `verify`; add one heavy stale-reclaim case.

### 3. [nit] The #738 dry-run regression check no longer covers `make verify`          Standards
Location   scripts/memory-limits.test.sh:104-110
Rule       Tests lens — a test that cannot fail for the defect it is named after
Finding    "a dry run of verify prints the plan and runs nothing (#738)" now asserts on `make -n _verify-locked`. The
           check on `make -n verify` (line 105) is only `expect_contains` on the lock line. If someone inlines
           `$(MAKE) …_verify-locked` into the `verify` recipe (Makefile:410), make executes that line under `-n`, so
           `stack-lock.sh` takes the real heavy lock in the git common dir (the test sets no
           `ARUVII_STACK_LOCK_DIR`). Make still echoes the line, so line 105 still passes.
Evidence   input: `make -n verify` with an inlined `$(MAKE)` → state: recipe line marked recursive, run despite `-n`
           → wrong result: the dry run takes the machine-wide lock; the test stays green.
Suggestion Assert that `make -n verify` output does not contain the lock's own stderr, or that no lock file is left
           in a temp `ARUVII_STACK_LOCK_DIR`.

### 4. [nit] DEVELOPING.md splits the lock concept across two sections and overstates verify-full          Standards
Location   docs/guides/DEVELOPING.md:244-256, 754-766
Rule       writing-for-agents — co-location; single source of truth
Finding    The stack lock is explained at :244 (§queue). The heavy lock goes in at :754, under "## There is no CI",
           and the busy/exit-75 rule appears three times (:246, :756, :764). The reclaim-a-stale-holder rule is at
           :254 for the stack lock only. ":762 `verify-full` holds the heavy lock and the stack lock together" is true
           only during its smoke phase.
Evidence   the two hunks quoted; Makefile:448-450 (verify runs first with heavy only, then smoke takes stack).
Suggestion Move the heavy-lock bullet into the :244 lock section as a second lock. Say "takes the stack lock as well
           for its smoke run".

### 5. [nit] rules.md cites a guard this repo does not have, and the rebase rule has two homes          Standards
Location   .claude/skills/aruvii-git/references/rules.md:11-14; .claude/skills/aruvii-git/SKILL.md:24, 96
Rule       writing-for-agents — relevance (sediment), single source of truth
Finding    "a regex guard missed `-f`, `-uf` and `+refspec` (#814)" names the old fleet's guard (agent-fleet #92). An
           agent here cannot act on it, and the `#814` reference sends it to the wrong place. "Rebase your own branch"
           does not say how. SKILL.md:24 and :96 say rebase with `glab mr rebase <id>` (server-side), and that path needs
           no force-push at all.
Evidence   the hunk; SKILL.md:24 table row "`git rebase origin/master` → `glab mr rebase <id>`".
Suggestion Drop the guard clause or cite agent-fleet #92. Add "(prefer `glab mr rebase`; force-push only after a local
           rebase)".

Checked and not a finding:
- bash 3.2 (`/bin/bash` 3.2.57, forced through PATH): `${!TOKEN_VAR:-}` and `export "$TOKEN_VAR=…"` work; the suite
  passes 56/0. No `flock` and no `setsid` used (#779 risk absent).
- Argument parsing: `--lock` alone → `shift 2` fails → usage, rc 1. `--lock heavy` alone → usage, rc 1. `--lock nope`
  → rc 1. `--lock heavy --lock stack` → usage, rc 1.
- Re-entry: verify-full exports `ARUVII_HEAVY_LOCK`; nested `verify` re-enters with an empty token and releases
  nothing (stack-lock.sh:147, 177). Smoke takes stack with its own variable. Tested, and the test fails if one
  shared variable is used (stack-lock.test.sh:203-205).
- Deadlock: no acquirer waits; a conflict exits 75. Nothing under the stack lock takes heavy. No cycle is possible.
- Exit paths, two-acquirer reclaim race, TERM deferred until the child ends, SIGKILL of the wrapper leaving the
  child running: all are in `cmd_run`/`reclaim` lines the diff did not change (#717 code) — out of scope by §4.
- `stack-lock.test.sh:38` unsets `ARUVII_HEAVY_LOCK`, so running it inside `make verify` (which holds heavy) is safe.

## Spec

- AC-1 "A second `make verify-module` … waits or exits 75 with the holder named (a script test proves it)" — **met in
  part**. Makefile:230 wires it; stack-lock.sh:147-148 refuses and names the holder. But `make verify-module` exits
  **2** ("make: *** [verify-module] Error 75", observed rc=2 with a live heavy holder); only the script exits 75. The
  test proves the script, not the target (Standards #2). The MR description says "a future CI … can read exit 75 as
  retry later"; through `make` it cannot — it sees 2, the same as any failure.
- AC-2 "`make status` names the heavy-run holder" — met, Makefile:142 → stack-lock.sh:159-167 (observed
  "heavy lock held: … (pid …)").
- AC-3 "Deploy/smoke locking (#717) is unchanged" — met, stack-lock.sh:46, 55-59 (default `stack`, #717 strings), and
  `--lock` is accepted only as argument 1, so `global-setup.ts`'s `acquire` call is unaffected. The #717 cases pass.
- AC-4 "rules.md carries the force-with-lease rule" — met, rules.md:11-14 (wording issue: Standards #1).
- Issue "Change" — `verify` (Makefile:410), `verify-full` (:444), `verify-module` (:230), `it-module` (:219) take
  heavy — met.
- Unrequested code: `_verify-locked` / `_verify-full-locked` hidden targets (Makefile:423, 448) — needed so one lock
  spans a multi-line recipe. The DEVELOPING.md and memory-limits.test.sh edits support the change. Nothing outside the
  issue's scope.
- Design (option A): one script with a lock-name parameter, two files `aruvii-stack.lock` / `aruvii-heavy.lock`
  (stack-lock.sh:46-77), stack default, four targets on heavy, `make status` shows both, rule in rules.md — all
  built as approved. `.claude/hooks/guard-concurrent-build.sh` left in place, as the MR says.

## Receipts

- /Users/chiyanram/workspace/agent-factory/drafts/agent-platform/code-review/SKILL.md
- mattpocock-skills:writing-for-agents SKILL.md
- `glab mr view 323 --output json`; `glab issue view 814 --comments`
- /private/tmp/claude-501/review-323/diff.patch (merge-base..head, full)
- head 262c60be: scripts/stack-lock.sh (full), scripts/stack-lock.test.sh (full), scripts/memory-limits.test.sh:95-125,
  scripts/lib/common.sh (helpers), Makefile (hunks + :38, 142, 219, 230, 409-450), docs/guides/DEVELOPING.md:236-256,
  735-775, .claude/skills/aruvii-git/references/rules.md:1-40, `git grep` over SKILL.md / glab.md for rebase/fetch/force,
  `git grep` for `stack-lock` / `ps -eo` / `make -n verify` references (incl. aruvii-ui/playwright/global-setup.ts:217-220)
- master (origin/master worktree, removed): AGENTS.md, CLAUDE.md, .claude/rules/smoke.md, .claude/rules/ (listing),
  .claude/hooks/guard-concurrent-build.sh
- Runs: stack-lock.test.sh under brew bash and forced /bin/bash 3.2 (56/0 both); `make -n verify-full`,
  `make -n verify-module`, `make -n it-module`; edge-argument probes; live-holder probe of `make verify-module` (rc 2)
  and `make status`, all against a temp `ARUVII_STACK_LOCK_DIR`.
- Not run: `make verify-full` (MR says it has not run at this head either).
