# Refs refresh — 2026-10-18 (after research/64a–64e, pins in refs/README.md)

Method: `git fetch` on clones; openclaw via `gh api` (compare capped at 250 of 1,512 commits → filtered by path).
Issues: `gh issue/pr list --search` over last ~60 days; items already cited in 64a–64e skipped unless status changed.
Quotes ≤15 words. "open" = no fix yet.

## Delta since pin

| ref | pin → head | new commits | touching our topics |
|---|---|---|---|
| firstmate | 5f2b81b → 8ba34f1 | 23 | ~12 (supervision, liveness, DoD, locks) |
| cursor/plugins (pstack) | f713f14 → d1715e0 | 30 (5 pstack) | 5 (Claude Code port, skill names, docs drift) |
| mattpocock/skills | 49dd158 | 0 | issues only |
| humanlayer/skills | 653b641 | 0 | issues only |
| rameezk/forge | 57f3619 → 7399b2c | 27 | ~10 (done check, conflict worker, block reporting) |
| openclaw | d8faf8876 → d3dc09e4a | 1,512 (2 days) | 4 AGENTS.md lines + mass test pruning |
| addyosmani/agent-skills | aeac41d | 0 | ~25 open PRs, issues |

## 1. firstmate (kunchenguid/firstmate)

**Changes**
- #7317 (fixes #7310): daemon "up" only if output says running. Why: v1.84 "exits 0 and prints `○ daemon not running`".
- #6958 / #6919: watcher consults operator "evidence guards" before wedge escalation. Why: quiet-but-healthy lanes were escalated (#4482, #5229 still open).
- #7444: away-mode supervision may relaunch in-flight tasks. Why: two dead workers' relaunch "refused" — rule allowed only queued work.
- #5939: orphaned Stop-hook claim no longer blocks re-arm. Why: home "stays unsupervised until the captain next speaks".
- #7415: lock re-anchored on `/clear`. Why: new session id → session "read its own lock as another session's".
- #7422 (fixes #6200): CI-ready note needs a real PR ref. Why: glob `*PR*` matched "PROD", turned monitoring task into done.
- #7409 (fixes #1130): tmux target check by exact membership. Why: gone window reported alive; keys typed "into a prefix-named neighbour".
- #7394: remote second-mate convergence bounded (75 s), re-read nudge only on change.
- #7096: contribution records store only classified fields. Why: raw review payload >1 MiB → "every `pending` read fails for the whole home".
- #5881: crew-state overrides ignored for other tasks (leaked snapshot env read another task's records).

**Issues (open unless marked)** — 1,001 issues in 60 days, 701 open total.
| issue | failure | fix / why |
|---|---|---|
| #7105 | worker parked on permission prompt; "looks quiet until the stale-liveness timer fires" | open |
| #7042 | workers wait on Claude's Chrome-extension startup prompt | open |
| #7280 | watcher says "stuck-busy" while worker is acting on message | open |
| #6034, #7366 | unsubmitted inject counted delivered → later escalations deferred | open |
| #4795 | parked worker polled gate: "~900 commands and 79% context spent while waiting" | open |
| #7322 | supervision loops ">100,000 process starts per day" (EDR flagged) | open |
| #5175 | AGENTS.md ~77 KB > 32 KiB caps; crewmates "run on a truncated rulebook" | open (AGENTS.md now 7,244 words) |
| #2766 | AGENTS.md ~15.6k tokens every session, restates docs | open |
| #6854 | worktrees never reclaimed: "12 GB accumulated" | open |
| #3058 | spawn cuts from origin/<default>, "silently dropping" local commits | open |
| #6347 | second-mate retirement deletes home incl. reports and notes | open |
| #3103 | PR targeting wrong base branch not refused | open |
| #5723 | project `.claude/settings.json` redirects workers' API endpoint | open |
| #6200 (closed) | false done via substring | #7422, see above |

**Size**: 702 files. md 119 files / 25k lines (AGENTS.md 7,244 words, 48 skill files). Code: bin/ 228 files / 129k lines shell, tests/ 288 files / 239k lines, ts 11k, py 5k. ≈ **7% markdown, 93% code**.

## 2. pstack (cursor/plugins)

**Changes**
- #637: Claude Code install from a *generated* tree + adapter mapping Cursor tool/model names. Why: skills "name Cursor tools … that Claude Code calls by other names".
- #702 (closes #237, open since 2026-08-21; #701): skill `name` must equal folder; generator fails otherwise. Why: "Poteto Mode" parsed as "unknown commands `/pstack:Make`".
- #705: adapter now says which step was skipped. Why: model "wrote several paragraphs about what it could not do".
- #704: docs-vs-tree check. Why: README claimed behaviours neither skill nor docs back.
- #700: example built a brand with `as`, which the same skill forbids. Why: "Agents copy the example".

**Issues**
| issue | failure | fix / why |
|---|---|---|
| #237/#701 | skill name breaks loading on other harnesses | #702 (8 weeks; 3 duplicate fix PRs #239–#241, #596, #703) |
| #523 | "Competing open PRs for the same issue require manual comparison" | open |
| #449 / #470 | worktree-cleanup treats untracked/ignored files as disposable (`rm -rf`); audit buckets unpushed work "safe" | open; fix PRs #459, #492 unmerged |
| #335 | hard-coded model slugs: "Invalid model selection" on subagent spawn | open |
| #531 | CI validates manifests only; skills, hooks, agents unchecked | open (partial: #702 generator `--check`) |
| #367/#527 | typed-only skills still carry agent-routing text / hide routed leaves | #527 closed via #577 (64a) |

**Size** (pstack/ only): 170 files. md 135 / 7.9k lines; ts 15 / 6.8k (eval/scripts), sh 168. ≈ **53% md by lines**, plus generated Claude Code copy.

## 3. mattpocock/skills (no commits; 330 issues in 60 days)

| issue | failure | fix / why |
|---|---|---|
| #1261 | implement-spec: 6–7 parallel subagents, "load average hit ~140", false flaky failures | open; reporter capped at 3, merges queued |
| #1263 | chief-of-staff "kept polling and reporting no change" while events arrived | not planned: local adaptation, harness's job |
| #1257 | code-review subagents inherit parent conversation on Codex | closed: "It is the harness's business!" |
| #1279 | code-review relays sub-agent findings verbatim; unchecked claim reaches user | open |
| #1270 | reviewers spawned without model/effort choice | open |
| #1277 | `/implement` doesn't run `/code-review` | open |
| #1262 | `pr` auto-triggers on every "create pr" | not planned; maintainer: model-invoked "adds nothing" |
| #1293 | git-guardrails hook "fails open when jq is missing" | open (triage verified) |
| #1272 | research: interrupted agent "leaves nothing on disk" | open |
| #1282/#1283 | wayfinder maps hide decision context from fresh sessions | #1283 closed |
| #1280/#1294 | grilling questions use bare IDs / names user never saw | #1294 closed |
| #1274/#1275 | rewriting CLAUDE.md clobbers generator marker blocks / symlinks | open |

**Size**: 190 files. md 132 / 7.8k lines; sh 361, json 1.5k. ≈ **95% md**. No runtime.

## 4. humanlayer/skills (no commits; 5 issues total)

- #12 (open): asks to drop `disable-model-invocation` from show-me, reversing PR #9. Why: other skills should "build on" it.
- #1 (open, since April): README install "installs a skill from 'slopfiles'" — name collision on skills.sh.
- #11 (open): install as auto-updating plugin.
**Size**: 102 files. md 83 / 5.6k; ts 1.3k, yml 0.8k. ≈ **75% md**. RPI workflow (#13) is the whole orchestration.

## 5. rameezk/forge

**Changes** (implementing ADR-0065…0074, already decided at pin)
- #518 (#433): dispatch done only if PR ready **and** required checks green. Why: drafts and red PRs "all counted as done".
- #524 (#467): same bar for conflict resolutions.
- #513/#526 (#466, #469): conflict resolution as its own worker (`on.conflict`). Why: "merging one forge pull request regularly leaves another conflicting".
- #529 (#483): worker posts a block as PR/ticket comment; installs deps. Why: note sat "where the operator does not look"; missing `node_modules` read as a stop.
- #512 (#462): failed revision gives its feedback back. Why: cursor moved at start, so rerun "ended ok without a worker".
- #509 (#461) / #511: crashed revision and failed start get a recorded reason. Why: "the only trace was the journal".
- #520 (#446): CI prints the failing build. Why: shadowed `nix` gave "Invalid BuildResult status" and nothing else.
- #489/#492 (closed): forge's `gh` first on PATH; Claude attribution off, proven by CLI contract check.

**Issues**
| issue | failure | fix / why |
|---|---|---|
| #490 | revision "could not answer either review comment" (dev shell `gh` hid forge's) → feedback dropped | #489 + manual recovery |
| #438 | "token can't rerun jobs and agents push empty commits to re-trigger" | open |
| #435 | failed dispatch leaves its PRs open | open (ADR-0066) |
| #445 | flaky browser tests turned main red twice | closed: fix the cause, "Do not add retries" |
| #470/#464 | automatic conflict resolution | open (manual slice shipped) |

**Size**: 475 files. md 107 / 5.5k (74 ADRs, 28 skill files); ts 166 / 41k, nix 28 / 4.9k. ≈ **10% md, 90% code**.

## 6. openclaw

**Changes** (AGENTS.md, since d8faf8876)
- #174533: "ClawSweeper reviews each PR automatically only once"; re-review by comment. Why: "Agents wait for a review that never comes."
- #175759: stable prompt prefix is an invariant. Why: separate correct security fixes "together … busted the provider prompt cache".
- #174837: cache keys include every answer-changing input. Why: agents keep shipping caches that "serve another agent's or account's data".
- #173903: Solid skill made mandatory reading. Why: agents "keep reaching for React and Solid 1 patterns".
- 18 of 250 visible commits are "remove low-value tests (batch dNNN)" — an agent campaign replayed onto pinned main.

**Issues** (49k items in 60 days; dev-process ones)
| issue | failure | fix / why |
|---|---|---|
| #168070 | agent changes ship fundamental mistakes; "Unit tests passed for all of them" | open; live runs + source audit caught them |
| #166624 | contributors don't search related issues/PRs before opening | open |
| #164006 | AGENTS.md past `bootstrapMaxChars`: middle rules "silently stop reaching the prompt" | open |
| #161707 | Codex reuses first-turn AGENTS.md snapshot; "edits never reach it" | open |
| #129411 | worktree sessions inject shared AGENTS.md, not worktree's | open |

**Size**: 59,474 files; 2,094 md vs 50,618 code. Agent layer: AGENTS.md 21 KB, `.agents/` 293 files (178 md, 53 skills, 76 mjs, 26 yaml), 118 workflows. ≈ **4% md**; agent layer itself ~60% md.

## 7. addyosmani/agent-skills (no commits; 198 items in 60 days)

| item | failure | fix / why |
|---|---|---|
| #693 | quality-gate examples "can pass CI with blocking Semgrep or axe findings" | open; PR #694 |
| #686 | `npm install` "can exit 0 without the platform-native binary" | open PR |
| #681 | /review and /test don't invoke the personas docs claim | #682 (64d) |
| PRs #683–#698 | ~10 skill examples don't type-check or misbehave | open PRs |
| #654 | rubric change needs re-running executor | open: record once, regrade |
| PR #687 | no skill for agent sandbox/permissions | open PR |
**Size**: 217 files. md 113 / 14.4k; js 34 / 5.1k, sh 1.6k, json 1.4k. ≈ **63% md**.

## Problems everyone hits

| failure kind | cites | refs |
|---|---|---|
| **Stuck worker looks healthy / healthy worker looks stuck** — liveness read from quiet or exit code | fm #7105, #7280, #4482, #5229, #7409; matt #1263; forge #511, #509 | 3 |
| **Block reported where nobody looks** | forge #529/#483; fm #7105, #6034; oc #174533 (waits for review that never comes) | 3 |
| **"Done" claimed on a weak signal** | fm #6200→#7422; forge #518, #524, #512 (rerun "ended ok without a worker") | 2 |
| **Checks that fail open** (exit 0 ≠ success) | fm #7310; matt #1293; addy #686, #693; forge #520 | 4 |
| **Rules not reaching the agent** (size cap, snapshot, name, harness port) | fm #5175, #2766; oc #164006, #161707, #129411; pstack #237/#702, #637, #705; hl #1 | 4 |
| **Lost work on cleanup / base selection** | pstack #449, #470; fm #3058, #6347, #6854; forge #490, #435 | 3 |
| **Runaway cost / load while waiting or fanning out** | fm #4795, #7322; matt #1261 (load 140), #1263 | 2 |
| **Review noise / unchecked reviewer claims** | matt #1279, #1270, #1277; addy #681; pstack #523 (duplicate PRs) | 3 |
| **Examples teach the forbidden pattern** | pstack #700; addy #683–#698 | 2 |
| **Harness differences leak** (subagent context, model slugs, tool names) | matt #1257; pstack #335, #637; fm #6380, #7216 | 3 |
| **Duplicate work on same issue** | pstack #523 (#239–#241); oc #166624 | 2 |
| **Model-invoke vs user-invoke flip-flop** | matt #1262; hl #12 vs #9; pstack #506/#527 | 3 |
| **Agent tests pass, real path broken** | oc #168070; addy #693 | 2 |

## Simplest shape that works

| ref | minimum pieces they actually run |
|---|---|
| firstmate | 1 AGENTS.md contract (~7k words) + trigger-loaded skills · coordinator in a tmux/herdr pane · workers in pooled worktrees · per-task status file + inbox · watcher daemon (wake/wedge) · DoD lib reading pushed HEAD. Heavy: 129k lines of shell to keep it alive. |
| pstack | 1 hub skill + playbooks + one-idea leaves · coordinator writes briefs, drains completion queue · 1 writer per worktree · fresh verifier per head · eval playbook before prose changes. No daemon. |
| mattpocock | skills only, mostly user-invoked · `implement-spec`: one subagent per ticket in own worktree (no cap — #1261) · code-review subagents. Orchestration = the harness. |
| humanlayer | 7 skills; RPI = research → plan → implement as files between fresh sessions. Nothing else. |
| forge | NixOS box · systemd unit per workload (dispatch / revision / conflict) · GitHub App, empty per-run config · done = PR ready + required checks green, read from GitHub · worker writes all GitHub comments · dashboard reads one store. |
| openclaw | AGENTS.md (21 KB) + 53 skills · bot reviewer (ClawSweeper) once per PR · CI lanes as proof · scripted landing. Humans merge. |
| addy | skills + slash commands + 3 personas + session-start hook + evals ledger. No fleet. |
