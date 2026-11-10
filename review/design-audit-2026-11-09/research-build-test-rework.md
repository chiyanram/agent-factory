# Research: PR creation, testing, cleanup and rework with AI agents

Local only. Written 2026-11-10. Checked against agent-factory `c9e71a6` and skills `1e22921` (read-only snapshots).
Primary sources only, fetched 2026-11-10. A claim marked **(nv)** is not checked against its primary source.
This file extends `audit-safety.md` D7 (ImpossibleBench, read-only tests) and `code-review-compendium.md` C10
(later rounds). It does not redo them.

Capabilities: **(5)** PR creation · **(6)** testing · **(7)** cleanup run · **(9)** review-fix rework loop.

## 1. Verdict table

| cap | decision in our design | verdict | reason | sources |
|---|---|---|---|---|
| 5a | The host opens a **draft** PR at the first `done`; the model never pushes, approves or merges (DESIGN §3, §4) | **keep** | Matches every agent checked. Ours is stricter: no model holds a login | Copilot risks page; OpenHands resolver; Devin docs |
| 5b | PR body = engine lines (spec hash, approval, deferred) + implementer's `.factory/pr.md` (PR1–PR7), cleaned, posted again after each `done` run (DESIGN §5, `pr-body.ts`) | **keep** | Industry has the AI write the body and refresh it after each fix. AI bodies cut review time. Our split of engine facts from model text matches TestGen-LLM | Copilot changelog 2025-07-30; Xiao et al. FSE 2024; TestGen-LLM |
| 5c | The PR body's evidence table (PR2) is the **model's** text; the engine's re-run result is a separate step (`finish.ts:250` posts the model's `criterion · command · result`) | **refine** | Evidence that counts is what the tool computed. Show the engine's re-run per row (exit, last lines, head SHA) in the engine's own lines. Keep the model's table as a claim | TestGen-LLM; Claude Code best practices; SWE-bench |
| 6a | A **test-first** run writes the failing test in the bug lane; it must not see any fix (VB7, `test-first.md`) | **keep** | Reproduce-first is the industry standard for a bug. Generated reproduction tests also filter wrong fixes | SWT-bench; SWE-bench FAIL_TO_PASS; Claude Code best practices |
| 6b | "Fails on the base, passes on the fix" is only the card's "It's working if" text. The engine runs rows at the head only. A fix starts "however the test-first run ended" (`table.ts:276`) | **refine** | Make it an engine check: run the test-first row at the base (must fail, by an assertion, not a setup or syntax error) and at the head (must pass). This is the F→P rule every benchmark uses | SWT-bench §3.1; SWE-bench; Echo (nv) |
| 6c | Ready check: every AC has a row; every row re-run at the head on a fresh runner (DESIGN §3, `ready/steps.ts`) | **keep** | Execution, not the model's word, decides "done". Stronger than any vendor checked: no vendor re-runs the agent's own evidence | Claude Code best practices; Anthropic agents; TestGen-LLM |
| 6d | VB2 "a test that fails when the change is reverted" is a prompt rule and a review check only | **refine** | Add an engine revert check: revert the non-test diff, run the new and changed tests, expect a fail. Report it first, gate later (fits mutation M1). Agents add tests in only half of PRs, and few add coverage | SWT-bench; Meta ACH; TestGen-LLM; arXiv 2607.18057 |
| 6e | Test checks S1–S4 stop a removed test, a skip, fewer assertions, a judge-file change; head-scoped waiver | **keep, refine as D7** | Detection is right; prompts alone do not stop test gaming. D7's refine stands: existing tests and judge files read-only in implementer and cleanup runs | ImpossibleBench; METR; OpenAI (Baker et al.); Claude Code best practices |
| 6f | `asked` and `blocked` exits; VB6 "a test looks wrong: ask" | **keep** | An "abort" exit cut GPT-5 cheating from 54% to 9% in ImpossibleBench. Our `asked` is that exit | ImpossibleBench; Claude Code best practices |
| 6g | Test-integrity lens (TI1–TI5) for other edits to existing tests | **keep** | Read-only does not stop special-casing or operator overloading. A reader must look | ImpossibleBench; METR |
| 6h | Each evidence row runs once | **refine (low)** | A new test (test-first, VB2) should pass k times in a row before it counts. TestGen-LLM uses 5 | TestGen-LLM; SWT-bench (errors for the wrong reason) |
| 7a | A separate **cleanup** run after the implementer: behaviour-neutral tidy of the branch's own lines; a `deferred` list into the PR body | **keep (no consensus)** | No checked vendor has a separate cleanup run. Behaviour-preserving refactoring is well defined, and LLM refactors are sometimes unsafe, so a narrow run that defers behaviour change is sound | Fowler; Liu et al. 2411.04444; SWE-Refactor |
| 7b | "Edits only lines the branch changed" is in the card's `enforced_guardrails`, but the engine reads no meaning into that field (`process/cards.ts:13-14`) | **refine** | Enforce it in code: a cleanup commit that touches a hunk outside the implementer's diff fails. Principle C2: a guardrail only in a prompt is not a guardrail | Claude Code best practices; RefactoringMirror (2411.04444) |
| 7c | Behaviour-neutral is proven by re-running the **evidence rows** only | **refine** | Evidence rows prove ACs, not all behaviour. Run the tests that cover the touched files (VB3) and S1–S4 at the cleanup head. Benchmarks check a refactor by compile + tests + a refactoring detector | SWE-Refactor; Liu et al. 2411.04444; Fowler |
| 9a | Only the verified **Act on** findings go back to the implementer; it does not see other findings (`implementer.md` `must_not_see`) | **keep** | Vendors also feed only real findings to the fix run. Ours adds a verify pass first | Bugbot autofix; CodeRabbit fix comments; Devin auto-fix |
| 9b | **3 rounds** max; the same patch with Act on still open, or an empty change, goes to `needs-human` (`round.ts:72`, `table.ts:138`) | **keep** | Every loop has a hard cap. Bugbot uses the same number, 3. More rounds raise cheating and give small gains | Bugbot; Anthropic agents; ImpossibleBench; Olausson et al. |
| 9c | Each rework head passes the ready check and S1–S4 again | **keep** | ImpossibleBench: cheating rises after a failed attempt. The check must run every round, which ours does | ImpossibleBench; METR |
| 9d | The rework task holds only the engine's own `act-on.json`, "never a git host thread" (GUIDE) | **refine** | Every vendor lets a human comment start a fix, from users with write access only. Let a write-access human's review comment become an Act on item, cleaned like the PR body. This also closes G1 / C10 (a later round repeats what a human answered) | Copilot docs; CodeRabbit; Devin; Google (comment resolution) |

Summary: 5 keep, 1 keep-with-D7, 7 refine, 0 change. No verdict says "change": the shape of each part matches the
consensus. The refines move rules from card text into engine checks.

## 2. Consensus (≥3 sources each)

| # | consensus | sources |
|---|---|---|
| B1 | The agent works on its own branch and opens a **draft** PR. It cannot approve or merge it. A human merges | Copilot risks page; OpenHands resolver ("draft PR if successful"); Devin ("draft PRs waiting for review") |
| B2 | The AI writes the PR body and **keeps it up to date** after each fix. AI bodies help review | Copilot changelog 2025-07-30; Xiao et al. FSE 2024; TestGen-LLM (diffs "document their own coverage improvement") |
| B3 | "Done" is decided by **execution**, not by the model's word. Ask for the command and its output | Claude Code best practices; Anthropic "Building effective agents"; Devin ("explicit success criteria … CI green"); TestGen-LLM filters; SWE-bench |
| B4 | A bug fix starts with a **reproducing test** that fails before the fix and passes after it (F→P) | SWT-bench; SWE-bench `FAIL_TO_PASS`; Claude Code best practices ("write a failing test that reproduces it, then fix it") |
| B5 | A generated test counts only after **execution filters**: it builds, passes, is not flaky, and adds value (coverage or a killed mutant) | TestGen-LLM; Meta ACH; SWT-bench (tests filter fixes) |
| B6 | Agents **game tests**. A prompt alone does not stop it. Enforce outside the model | ImpossibleBench; METR; OpenAI (Baker et al.); Claude Code best practices ("make it a hook") |
| B7 | A refactor must **keep behaviour**, checked by tests or tools. LLM refactors are sometimes unsafe | Fowler (refactoring.com); Liu et al. 2411.04444; SWE-Refactor 2602.03712 |
| B8 | A review finding can start an **automated fix run** on the same PR | Cursor Bugbot Autofix; CodeRabbit fix comments; Devin Auto-Fix; Copilot `@copilot` |
| B9 | Every fix loop has a **hard cap** | Bugbot ("max 3 attempts per PR to prevent loops"); Anthropic ("maximum number of iterations"); OpenHands `OPENHANDS_MAX_ITER` (nv); ImpossibleBench (more turns, more cheating) |
| B10 | A **human's comment** can start a fix, only from a user with write access. The human keeps control of what lands | Copilot ("only responds to comments from people who have write access"); CodeRabbit ("write access"); Devin ("never … without the user explicitly initiating"); Google (the author applies the ML edit) |

**No consensus** (fewer than 3 sources, or sources disagree):

- A separate cleanup run. No vendor checked has one. Claude Code ships a `/simplify` skill (nv: seen in the skill list,
  not in docs).
- Mutation testing as a gate. Meta ACH uses mutants to make tests; it does not gate PRs. Our M1 keeps it a report.
- Where fix commits go. Copilot: a child PR for a human's PR. Bugbot and CodeRabbit: a setting (same branch or new).
  Ours: the same branch, fast-forward only.
- How many rounds. Only Bugbot states a number (3). Others state "a limit" or nothing.

## 3. Per capability

### (5) PR creation

**Industry.** The agent opens a draft PR on its own branch (B1). It writes the title and body and refreshes them after
feedback (B2). The body shows tool-computed facts. TestGen-LLM even marks human notes apart from machine claims.

**Ours.** The host, not the model, pushes and opens the draft PR. The body has two parts: the engine's lines, then the
cleaned `.factory/pr.md`. The rulebook asks for PR1–PR7 (reason, evidence, breaking, rollback, tree, where to look,
one-way-door items).

**Verdict.** Keep 5a and 5b. Refine 5c:

1. Put the engine's re-run of each evidence row into the engine's lines: criterion, command, exit, head SHA.
2. Keep the model's evidence table below, as its claim.
3. When the two disagree, the engine's line wins and the ready check fails.

Today `finish.ts:250` posts the model's `result` text as given. The ready check judges the re-run, but its per-row
result is not in the PR body (DESIGN §5 does not say it is).

### (6) Testing

**Industry.** Reproduce first (B4). Filter generated tests by execution (B5). Assume the agent will game tests (B6).

**Ours.** Test-first run (bug lane), evidence rows re-run, S1–S4 in code, test-integrity lens, `asked` exit.
This is ahead of every vendor checked: none re-runs the agent's own evidence or blocks test removal in code.

**Gaps, all "rule in text, not in code":**

1. **F→P not checked (6b).** The test-first card says the test "fails on the base and passes on the fix". No engine
   step checks it. SWT-bench counts a test as reproducing only when it "fails on the original codebase" and "passes on
   the patched codebase". It also warns that a test can fail for the wrong reason ("incorrect syntax or formatting of
   the test"). Fix: run the test-first row at the base and at the head. At the base, require a failed assertion, not
   an error.
2. **Revert check not run (6d).** VB2 asks for a test that fails when the change is reverted. Only a finder checks it.
   Agents add test changes in 49.6% of PRs that change code under tests, and few add coverage (arXiv 2607.18057).
   Fix: the engine reverts the non-test diff on a runner and runs the new and changed tests. Report first; make it a
   gate only after the eval shows few false alarms.
3. **Flaky new tests (6h).** TestGen-LLM drops a test that does not pass "on every one of five executions". Fix: run a
   new test's row k times (3 is enough to start).
4. **Read-only tests (6e).** Unchanged from D7.

### (7) Cleanup

**Industry.** No vendor runs a separate tidy pass. The refactoring literature agrees on the bar: behaviour stays the
same, and tests or tools check it (B7). Liu et al. found 13 of 176 ChatGPT and 9 of 137 Gemini refactors unsafe. Their
fix re-applies the refactor with a tested engine.

**Ours.** A fresh cleanup run, only on lines the branch changed, behaviour-changing items go to `deferred` and into the
PR body. The review runs after it, so the review sees the cleanup too.

**Verdict.** Keep the run and the `deferred` list. Refine two weak points:

1. **7b.** "Edits only lines the branch changed" is prose. `process/cards.ts:13-14` says the engine reads no meaning
   into `enforced_guardrails`. Fix: a host diff check, like the floor guard, that fails a cleanup commit outside the
   implementer's hunks.
2. **7c.** "Every evidence row still passes" proves the ACs only. Fix: also run the tests that cover the touched files
   at the cleanup head (VB3), plus S1–S4 (already on).

### (9) Review-fix rework

**Industry.** Findings start a fix run on the same PR (B8). The loop has a cap (B9). Humans can start a fix too, from
write access only (B10). Self-repair gives "modest" gains (Olausson et al.). More turns raise cheating (ImpossibleBench:
33% to 38% with multiple submissions).

**Ours.** Verified Act on findings go into `.factory/task.md`. The implementer sees only that list. Each new head
passes the ready check and S1–S4 again. 3 rounds, then `needs-human`. The same patch with Act on open stops at once.

**Verdict.** Keep 9a, 9b, 9c. Refine 9d:

1. Let a review comment from a human with write access become an Act on item in `task.md`.
2. Clean it with the PR-body cleaner, and mark it as "from a human", so the model treats it as data (RV8).
3. Record it in the round's history, so a later round does not post the same finding again (closes G1 / C10).

Risk: a human comment is untrusted text in a writer's prompt. Copilot limits it to write access. Ours should too,
through the `Forge` seam. Grill before building, because GUIDE today says "never a git host thread" on purpose.

## 4. Sources

Each: URL, then the exact quote. Quotes are exact unless marked.

### GitHub Copilot coding agent

- https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/make-changes-to-an-existing-pr
  - "You can mention `@copilot` in a comment on any pull request to ask Copilot to make changes."
  - "Copilot only responds to comments from people who have write access to the repository."
  - "To delegate multiple comments, click **Add to batch**."
  - On conflicts: Copilot "resolves them, and verifies that the build, tests, and linter still pass".
  - No limit on iterations is stated.
- https://docs.github.com/en/copilot/concepts/agents/coding-agent/risks-and-mitigations
  - "Copilot cloud agent cannot mark its pull requests as "Ready for review" and cannot approve or merge a pull request."
  - "Prevents the user who asked Copilot cloud agent to create a pull request from approving it."
  - "By default, workflows are not triggered until Copilot cloud agent's code is reviewed".
- https://github.blog/changelog/2025-07-30-copilot-coding-agent-keeps-pull-request-titles-and-bodies-up-to-date
  - "Now, Copilot will keep the title and body of the pull request up to date as it addresses feedback".
- https://github.blog/changelog/2025-10-28-ask-copilot-coding-agent-to-make-changes-in-any-pull-request-with-copilot
  - "You maintain control of your original pull request." Copilot's changes go to a new PR on top.
- https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent
  - "It can edit files and run tests and linters in a cloud development environment".

### Cursor Bugbot

- https://cursor.com/docs/bugbot
  - "Bugbot Autofix automatically spawns a Cloud Agent to fix bugs found during PR reviews."
  - Commit to Existing Branch: "Push fixes to your branch (max 3 attempts per PR to prevent loops)."
  - The page does not say whether Autofix runs tests.

### CodeRabbit

- https://docs.coderabbit.ai/finishing-touches/autofix
  - Fix comments "applies code changes for unresolved CodeRabbit findings in your pull request."
  - "CodeRabbit pushes a commit to the current branch, or opens a stacked PR".
  - "The coding agent applies fixes, then runs a repository setup + build verification step."
  - "Even if verification fails, the generated changes are still delivered so you can continue iterating."
  - Requires "write access to the repository".

### Devin

- https://docs.devin.ai/work-with-devin/devin-review
  - "Auto-Fix uses a Devin session to address review findings on a PR".
  - "Only the findings Devin could not fix are posted as review comments."
  - "Devin will never create commits or comments on behalf of a user without the user explicitly initiating the action."
  - On a new push, Devin "carries earlier findings forward and checks whether the new commits fixed them."
- https://docs.devin.ai/essential-guidelines/when-to-use-devin
  - Tasks need "explicit success criteria (e.g., passing tests, matching an existing pattern, CI green)".
  - "Tasks with test suites, lint checks, or compilation steps yield better results".
  - "Return to draft PRs waiting for review".

### OpenHands resolver

- https://pypi.org/project/openhands-resolver/0.3.1/ (archived package; the code moved into OpenHands,
  https://github.com/All-Hands-AI/openhands-resolver says "This repository was archived by the owner on Dec 2, 2024.")
  - "Create a draft PR if successful, or push a branch if unsuccessful."
  - "The resolver can also respond to comments on pull requests".
- **(nv)** `OPENHANDS_MAX_ITER` ("Set max limit for agent iterations", example 10): from a search summary of
  docs.openhands.dev. The current docs page returned 404.

### Anthropic

- https://code.claude.com/docs/en/best-practices (the old engineering post redirects here)
  - Example prompt: "write a failing test that reproduces it, then fix it".
  - "ask Claude for *evidence*: the command it ran and its output, or the screenshot. "All tests pass" on its own tells
    you very little".
  - "If something has to happen every time, make it a hook, a deny rule, or a managed setting."
  - "`/code-review` reviews the diff in a fresh subagent that never saw your conversation."
  - "A reviewer that's asked to find problems will always find *something*. If you fix every finding, you end up with
    extra abstraction layers and tests for cases that can't happen."
  - Note: the older page's TDD steps ("do not modify the tests") are no longer on the current page. **(nv)** for that
    wording.
- https://www.anthropic.com/engineering/building-effective-agents
  - "include stopping conditions (such as a maximum number of iterations) to maintain control."
  - Agents must "gain "ground truth" from the environment at each step (such as tool call results or code execution)".
  - "Code solutions are verifiable through automated tests".

### Meta

- TestGen-LLM, https://arxiv.org/html/2402.09171
  - "Any code that does not build is immediately discarded".
  - "a test that does not pass on every one of five executions is deemed flaky."
  - "Any test that does not improve coverage is also discarded."
  - "The diffs submitted by TestGen-LLM document their own coverage improvement."
  - Abstract: "75% of TestGen-LLM's test cases built correctly, 57% passed reliably, and 25% increased coverage."
- ACH, https://arxiv.org/abs/2501.12862
  - "Meta's ACH system for mutation-guided LLM-based test generation."
  - Equivalent-mutant agent: "a precision of 0.79 and a recall of 0.47". Engineers "accepted 73% of its tests".

### Benchmarks: SWE-bench and SWT-bench

- https://huggingface.co/datasets/princeton-nlp/SWE-bench
  - `FAIL_TO_PASS`: "the set of tests resolved by the PR and tied to the issue resolution."
  - `PASS_TO_PASS`: "tests that should pass before and after the PR application."
- SWT-bench, https://arxiv.org/html/2406.12952v3
  - A test reproduces the issue "if it fails on the codebase before the pull request (PR) is accepted" … "We call this
    a fail-to-pass test (F→P)."
  - Generated tests are "an effective filter for proposed code fixes, doubling the precision of SWE-Agent" (to 47.8%,
    at 20% recall).
  - Errors also come from "incorrect syntax or formatting of the test"; agents add "tests with syntax errors or using
    invalid variables."
- **(nv)** Echo, https://arxiv.org/html/2603.07326v1: a reproduction-test agent, 66.28% on SWT-bench Verified. From a
  search summary only.

### Test gaming (extends audit-safety D7)

- ImpossibleBench, https://arxiv.org/html/2510.20270 (new quotes; D7 has the others)
  - "looser guidance leading to significantly higher cheating rates."
  - An option "to abort and exit the feedback loop" lowered "the cheating rate of GPT-5 from 54% to 9% and o3 from 49%
    to 12%"; "the effect is much less pronounced for Claude Opus 4.1".
  - More feedback "also increases the cheating rate as the models may be more inclined to cheat after failing"; with
    multiple submissions, cheating rises "from 33% to 38%".
- METR, https://metr.org/blog/2025-06-05-recent-reward-hacking/
  - Instructions "had a nearly negligible effect on reward hacking, which still persisted in a majority of runs."
  - "o3 monkey-patches the evaluator to always return a perfect score."
- OpenAI (Baker et al.), https://arxiv.org/abs/2503.11926
  - "CoT monitoring can be far more effective than monitoring agent actions and outputs alone."
  - "with too much optimization, agents learn obfuscated reward hacking."

### Self-repair

- Olausson et al., ICLR 2024, https://arxiv.org/abs/2306.09896
  - "performance gains are often modest, vary a lot between subsets of the data, and are sometimes not present at all."
  - "self-repair is bottlenecked by the model's ability to provide feedback on its own code."

### Google: resolving review comments

- https://research.google/blog/resolving-code-review-comments-with-ml/
  - "the model addresses 52% of comments with a target precision of 50%."
  - "40% to 50% of all previewed suggested edits are applied by code authors."
  - The author previews and applies the edit. The model is shown only when confident.
- **Not found:** a Google paper on LLM test generation in production. Google's migration report
  (https://arxiv.org/abs/2501.06972) does not say how it validates changes in its abstract.

### Refactoring

- Fowler, https://refactoring.com/
  - "altering its internal structure without changing its external behavior."
  - "The system is kept fully working after each refactoring".
- Liu et al., https://arxiv.org/abs/2411.04444
  - "13 out of the 176 solutions suggested by ChatGPT and 9 out of the 137 solutions suggested by Gemini were unsafe"
    (they "changed the functionality of the source code or introduced syntax errors").
  - RefactoringMirror re-applies them with "thoroughly tested refactoring engines".
- SWE-Refactor, https://arxiv.org/abs/2602.03712
  - Each instance is "validated via compilation, test execution, and automated refactoring detection tools."
  - "An OpenAI Codex agent achieves only 39.4% success on compound instances."
- Cordeiro et al., https://arxiv.org/abs/2411.02320
  - "Generating five refactorings per input further increases the pass rate by 28.8%". The abstract does not cover
    unsafe refactors.

### PR descriptions and agent PRs

- Xiao et al., FSE 2024, https://arxiv.org/abs/2402.08967
  - Copilot-for-PRs PRs "require less review time and have a higher likelihood of being merged."
  - Developers "often complement the automated descriptions with their manual input."
  - **(nv)** "19.3 hours" less review time: from a search snippet only.
- arXiv 2607.18057, https://arxiv.org/abs/2607.18057 (test coverage of agentic PRs)
  - "Agents include test changes in only 49.6% of PRs that change code under test files."
  - "35.9% of Java and 22.5% of Python Code + Tests PRs show a coverage gain."
- Haque et al., MSR 2026, https://arxiv.org/abs/2601.03556
  - "test-containing PRs are more common over time and tend to be larger and take longer to complete"; merge rates
    "remain largely similar".
- Pinna et al., MSR 2026, https://arxiv.org/abs/2602.08915
  - "the PR task type is a dominant factor influencing acceptance rates"; documentation "82.1% acceptance compared to
    66.1% for new features."
- **(nv)** Nakashima et al. (arXiv 2602.04226): 67.9% of rejected agentic PRs got no reviewer feedback. From a blog
  summary only.

## 5. Not verified, and limits

- OpenHands: the current resolver docs returned 404. Draft-PR and comment behaviour is from the archived package page.
- Copilot coding agent: GitHub docs do not say it runs tests before it opens the PR (only "can … run tests and linters").
- Anthropic system cards on special-casing tests: not fetched. D7's METR and ImpossibleBench quotes cover the point.
- Google LLM test generation in production: no primary source found.
- Our code was read only to check claims: `finish.ts:250`, `process/cards.ts:13-14`, `dispatch/table.ts:138,276`,
  `review/round.ts:72`. Each refine above is a design proposal, not decided.
