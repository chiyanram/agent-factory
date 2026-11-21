# #844 — Report: the factory against Devin, Agent Orchestrator, Pocock's factory and peers

Map: #826 (compare the factory, topic by topic, to a build spec). Step 3 of the map. Written 2026-11-20.

This report gives one approach per topic, how it works underneath, the gap between ours and the best reference, and
an adopt / adapt / skip call for each reference idea. It ends with the top 10 gaps exactly as round 2 (#843, the
top-10 and skips round) ranked them, the open items for the operator, and the sources.

This is a report only. It holds no design and no code. The operator approves it before the Design step starts.

## Header

### What it compares

Ours against seven sources, on 14 topics. Topics 3 (flow), 4 (roles and prompts), 5 (handoff) and 10 (security) are
the focus topics (#833, round 1 on topics and sources).

### Sources and pins

| source | what | pin |
|---|---|---|
| **Ours** | chiyanram/agent-factory | `origin/main` `39f7b68`. The map names `1d681d7`, an ancestor 6 commits older (#827 profile). Rules pack chiyanram/skills `044aa84e03ce9ef641e599bcc76bbb120e29fd0a` (tag `rulebook--v3.1.0`). The #842 matrix states `1d681d7` for ours; its cells were re-read at `39f7b68` here only where a gap cites them. |
| **Devin** | Cognition, closed SaaS | public docs at docs.devin.ai, read 2026-11-20 (#828 profile) |
| **Devin SF** | Devin Bot template "Software Factory" | public page and Bot docs, read 2026-11-20; the prompt is only in the logged-in app (#829 profile) |
| **AO** | OrchestratorInc/agent-orchestrator | `cab1f8d1570ea64eab9aeb8daa1ffd992a2b2425` (#830 profile; #654, the AO lessons map, read `b5f4911`) |
| **Pocock SF** | Matt Pocock's software factory ("Mattock", round 1 confirmed) | mattpocock/sandcastle `1b380ca`, mattpocock/skills `abeeaf9` (#831 profile) |
| **Optio** | jonwiggins/optio | `8d116d80c45d3ebc15776672e0028b80fb439ec9` (#835 profile) |
| **Symphony** | openai/symphony | `be10a1b79df723d6d7612b5651c8522704dafb2e` (#836 profile) |
| **Factory.ai** | closed SaaS, one row (#833); open review action Factory-AI/droid-action | docs.factory.com read 2026-11-20; droid-action `f79c81da0300f133b19f825cdd962998fdd9841b` |

### Marks

The marks come from the matrix files, unchanged.

- **D** = documented: a doc page or a repo doc, with a link or `path:line`.
- **C** = inferred from code: `path:line` at the pin.
- **unknown** = not found; the matrix cell gives the reason. This report keeps "unknown" as unknown.
- A cell reference such as **#838 3.8** means matrix file 838, row 3.8.

### Matrix files

| file | topics |
|---|---|
| [837-matrix-ui-cli.md](837-matrix-ui-cli.md) | 1 user interaction, 2 CLI |
| [838-matrix-flow-handoff.md](838-matrix-flow-handoff.md) | 3 flow, 5 handoff (focus) |
| [839-matrix-roles-review.md](839-matrix-roles-review.md) | 4 roles and prompts (focus), 6 review |
| [840-matrix-internals-security-cost.md](840-matrix-internals-security-cost.md) | 9 internals, 10 security (focus), 13 cost and limits |
| [841-matrix-plugins-adapters-stack.md](841-matrix-plugins-adapters-stack.md) | 7 plugins, 8 adapters, 12 stack |
| [842-matrix-docs-evals.md](842-matrix-docs-evals.md) | 11 docs, 14 evals and learning |

Source profiles: [827](827-own-design.md), [828](828-devin.md), [829](829-devin-software-factory.md),
[830](830-agent-orchestrator.md), [831](831-mattock.md), [832](832-alternatives.md), [835](835-optio.md),
[836](836-symphony.md).

### Fixed rules for every call below

| rule | source | effect on the calls |
|---|---|---|
| No git host token in a model run; the host pushes and posts | ADR-0012 S2, S6; P4 | skip every idea where the run pushes, posts or holds a git credential |
| No skip-permissions flag for a model run in new code | ADR-0012 S11; AGENTS.md MUST | skip Optio's and Sandcastle's default bypass |
| No model approves or merges | ADR-0012 S10; P6 | skip Optio auto-merge, Devin Autoapprover, Symphony `land` |
| Code decides each step | P1 | skip a model orchestrator that routes work |
| Every run is fresh, never resumed | P2; resume dropped on #654 (2026-11-17, per #810) | skip session resume and fork |
| Skipped in round 2 | #843 | microVM isolation, Linear and Jira connectors, an IDE plug-in, a public REST API |
| Kept in round 2 | #843 | the eval gate on prompt changes, the reviewer golden set, hash-pinned plugins |
| Personal deployment | #833 | team and SaaS features rank low; #794 (team factory on one VM) stays outside |
| Reuse tickets | #826 Notes | each gap names an open ticket where one fits |

---

## Topic 1 — User interaction

**High-level idea:** Keep one coordinator AI per project as the talking front, and keep code-only doors for each
gate word. Add one "needs you" list that every door reads the same way. The web page (#714) is the last door, not a
new centre.

**Internals:** The board already derives a lane per ticket from the decision table (C `src/core/dispatch/next-step.ts:1-17`).
A "needs you" list is that lane, filtered and sorted first, read through the shared door read
(`src/core/door/read.ts`, D `docs/explanation/architecture.md` §4). Each item names the one command that settles it.
Gate words still go only through the door seam (ADR-0023).

**Gap:**

| sub-aspect | ours | best reference |
|---|---|---|
| visual app and phone (#837 1.1, 1.7) | none; web door decided, built last (D `docs/adr/0023-front-doors-are-engine-commands.md:31`); phone: none (C grep) | Optio web + iOS + Android (D `README.md:66`); AO desktop + Expo phone (D `fd/configuration/remote-access.mdx:6-18`) |
| "needs you" queue (#837 1.9) | `waiting:operator` label, `board`, `waiting` pings (D `docs/reference/cli.md:28,49`) | Optio `needs_you` sorted first (D `docs/tasks.md:63-76`); Devin SF "Needs you" cards (D [bots](https://docs.devin.ai/work-with-devin/bots.md)) |
| API, MCP (#837 1.8) | `--json` on 3 read commands only (D `docs/reference/cli.md:27-30`) | Optio REST + controller MCP (D `docs/controller-mcp.md:3-12`) |
| IDE (#837 1.6) | none (C grep) | Devin ACP, Factory.ai 5 editors (D) |
| gate word (#837 1.10) | ours leads: hash-bound, door seam only, refused in a model run (D ADR-0023 D1–D4) | Devin SF approval cards (D) |

**Approach:**

| reference idea | source | call | why |
|---|---|---|---|
| "Needs you" list sorted first, one action per item | Optio, Devin SF | adopt | it is a view over facts we already derive; no new state |
| Decision card with a recommended option | Devin SF (D `bots:65`) | adopt | our question rounds already carry one recommended choice (D `architecture.md:91-95`); render it the same in each door |
| Web app as the main surface | Optio, AO | adapt | stays a read-only door first (#714), actions later (#715), per P19 |
| Phone app | AO, Optio | skip | Discord already reaches the phone (#548); personal deployment |
| Public REST API or MCP server | Optio, Devin, Factory.ai | skip | round 2 skip |
| IDE plug-in | Devin, Factory.ai | skip | round 2 skip |
| Chat front end that drafts work and asks before each write | Optio Agent (D `docs/optio-assistant.md:3-12`) | adopt (already ours) | our coordinator does this and is denied every gate word |

**Existing tickets:**

- #714 — read-only local web page over the board
- #715 — START, approve, waive from the web page
- #813 — a ticket's diff view in the web page
- #548 — coordinator in Discord, door for start and approve
- #729 — hand test: Discord replies land in thread
- #744 — guided Discord setup command
- #748 — keep the Discord coordinator up
- #815 — `agent-factory` alone opens the guide
- #812 — `board --since`: what entered your turn
- #820 — a question names its kind
- #821 — coordinator asks an implementer's question
- #822 — unanswered question asked again daily
- #823 — one Discord thread per ticket
- #554 — spot a stuck coordinator or run

---

## Topic 2 — CLI

**High-level idea:** Keep one binary with three command groups, and finish the clean-up that #497 (one way per job)
started. Add a read-only doctor and run control that reads, never steers.

**Internals:** One command registry gives help, completion and the reference page from one list (#598, one command
registry). A doctor reads settings, logins, runner probes and the egress check through the existing seams and writes
nothing. Run control stays as `trace`, `board` and a door-seam stop (#770); no attach to a live run, because a run is
headless and fresh (P2).

**Gap:**

| sub-aspect | ours | best reference |
|---|---|---|
| diagnostics (#837 2.7) | `init`, `setup status`, `config check`, `egress check` (D `docs/reference/cli.md:16,19,30,35`) | AO `ao doctor` over config, DB, daemon, git, auth (D `fd/cli.mdx:69-88`) |
| run and session control (#837 2.6) | `trace`, `board`, `dispatch --once`, no attach or steer (D `cli.md:21,26,28,62`) | AO `session interrupt`, `send` (D `fd/cli.mdx:18-25`); Optio `task message/retry/cancel` (C `apps/cli/src/commands/task/`) |
| headless output (#837 2.3) | `--json` on 3 commands (D `cli.md:27-30`) | AO `--json` on most commands (D `fd/cli.mdx`) |
| remote runs (#837 2.5) | this host only; records stay here (D `safety.md:132-134`) | Devin `--cloud`, `/handoff` (D); Optio `local up` (D) |
| config layers (#837 2.4) | ours leads: 4 layers outside the repo, a class per key, `config show` with `file:line` (D `docs/reference/settings.md:202-215`) | Devin, Factory.ai lock org keys (D) |

**Approach:**

| reference idea | source | call | why |
|---|---|---|---|
| `doctor`, read-only | AO | adopt | already decided as #768 |
| `--json` on every read command | AO, Optio | adopt | cheap; feeds the web door and scripts without an API |
| interrupt or message a live run | AO, Optio | skip | a run is headless and fresh (P2); a person stops through the door seam (#770) |
| hand a local session to the cloud | Devin `/handoff` | skip | no cloud; personal deployment |
| config as code in the product repo | Symphony `WORKFLOW.md`, Optio `apply` | skip | breaks P5 and ADR-0012 S12 (config never from the branch) |
| shell completion from the command list | Devin, Factory.ai CLIs | adopt | decided as #776 |

**Existing tickets:**

- #497 — one way per job, delete old commands
- #768 — `agent-factory doctor`, read-only
- #769 — `project ls`, one line per project
- #770 — `stop` through the door seam
- #776 — shell completion from the command list
- #814 — `config set` with the key's check
- #816 — setup checklist, resume at first failure
- #818 — CLI docs in AO's shape
- #593–#598 — split `app.ts` into per-group CLI files
- #509 — `init` runs the model login itself
- #653 — `init` asks which add-ons to install

---

## Topic 3 — Flow (focus)

**High-level idea:** Keep the pure decision table as the only thing that picks a step (P1). Grow the flow by adding
rows that read new facts, each with its own cap and a stop at a person. The next rows are: a person's PR review
starts a capped rework run; the same problem twice goes to a person at once; and cleanup starts from the table, not
by hand.

**Internals:**

```text
poll (git host facts: PR, notes, reviews, CI) ─┐
records (JSONL per ticket)  ───────────────────┼──▶ decide(facts) ──▶ one Action per ticket per pass
START / approval files      ───────────────────┘        (pure)          │
                                                                      ▼
                                        runner starts a fresh run, or the host pushes/posts, or needs-human
```

- A new input is a new **fact** that `poll` or the records give to `decide()`. `decide()` stays pure: no clock, no
I/O, no model (C `src/core/dispatch/table.ts:1-3`; checked by `test/non-negotiables.test.ts`, P1).
- Each new repeating row gets its own counter in the records and its own cap, then `needs-human` with a summary of
at most 3 lines (P7).
- A "same problem twice" check compares a stable signature of the failure (row, finding id or CI job) across rounds
in the records. ADR-0024 removed CI failure signatures; this one is for the stop only, never for a re-run.
- Optio's shape confirms ours: observe a snapshot, a pure decision, one typed action, applied with compare-and-swap
(D Optio `docs/reconciliation.md:3`; C `reconcile-repo.ts:11-18`). Our lock per project (C
`orchestrator-loop.ts:13-14`) plays the CAS role for one machine.

**Gap:**

| sub-aspect | ours | best reference |
|---|---|---|
| review feedback from a person (#838 3.8) | Act on rounds only; "human comments never reach the implementer" (D `docs/explanation/build-path.md:52`) | Optio: changes requested → **code** resumes the agent (C `reconcile-executor.ts:598-604`); AO forwards unresolved comments (D `guides/review-loop.mdx`); Symphony sweeps every comment (D `elixir/WORKFLOW.md:171-186`) |
| who decides the next step (#838 3.4) | ours leads: **code**, 22 ordered rules (C `table.ts:727-749,817-819`) | Optio the same (D `reconciliation.md:3,58-69`); Devin, AO, Factory.ai use a **model** |
| gate before the build (#838 3.3) | ours leads: spec + design review + hash-bound human approval (C `src/core/approval.ts:1-10`) | Factory.ai Spec Mode (D `specification-mode`); Optio optional plan review (C `task-worker.ts:1248-1256`) |
| caps and escalation (#838 3.10) | ours leads on count: 3 ready, 3 review, 2 CI, 1 conflict (C `table.ts:61-73,159-163`) | AO auto-spawn breaker on 3 **same** failures (C `auto_spawn_breaker.go:17-24`) |
| who merges (#838 3.11) | ours leads: **human** only (C `table.ts:57-59`) | Optio auto-merge by **code** on a model approval (C `reconcile-repo.ts:521-533`) |
| cleanup step | **Today:** the engine starts no cleanup run (D `build-path.md:26`) | n/a — no source has a separate cleanup role |
| auto-split of large work (#838 "behind" item 4) | split into child tickets by hand (AGENTS.md MUST, #557) | Devin managed Devins (D `advanced-capabilities`); Factory.ai Missions (D `missions/overview`) |
| restart and recovery (#838 3.13) | JSONL; **Today:** pre-PR records on the START machine only (D `spec-and-knowledge.md:42-44`) | Optio Postgres + CAS (D `reconciliation.md:19-48`); AO SQLite outbox (C `internal/domain/report.go:106-114`) |
| intake (#838 3.2) | a person's command starts a loop; no tracker intake (C `orchestrator-loop.ts:1-12`) | Symphony poll tick (D `SPEC.md:735-775`); Optio 15 trigger types (D `docs/tasks.md:139`) |

**Approach:**

| reference idea | source | call | why |
|---|---|---|---|
| A person's "changes requested" or unresolved inline comment starts a capped rework run | Optio, AO, Symphony | adapt | only a project member's review counts; comments go in as fenced data (P5); 3 rounds then needs-human; the run still holds no login (#799) |
| A typed `/rework` note sends the writer back | ours (#825) | adapt | the small first step of the same row; #799 and #825 must share one counter, or a person can double the cap |
| Pure reconcile + one typed action + CAS | Optio | adopt (already ours) | matches P1; the CAS idea returns only if #498 brings a shared store |
| Breaker on the same failure 3 times | AO | adapt | stop on the **second** same failure, as #753 asks; no cooldown restart, because P8 says a person restarts |
| Engine starts cleanup after a done run | ours, decided (D `build-path.md:26`) | adopt | P11 manual rung is passed (cleanup is run by hand today); the card exists (D `prompts/roles/cleanup.md`) |
| Auto-split a goal into child sessions | Devin, Factory.ai, Sandcastle parallel-planner | skip | the AGENTS.md MUST wants the operator to approve the shape before code (#557); a model split breaks P1 |
| Optional plan-only run before the build | Optio planning mode | skip | our spec, design and design review already gate the build |
| Auto-merge when checks pass | Optio | skip | ADR-0012 S10, P6; observe-only data stays on #807 |
| Tracker poll that starts work on a label | Symphony, Optio, AO | skip | P8: a person's START starts every build |
| Model merges after a human's tracker move | Symphony `land` | skip | ADR-0012 S10 |

**Existing tickets:**

- #799 — a person's PR review starts rework
- #825 — `/rework` note sends the implementer back (waiting:operator)
- #753 — same problem twice goes to a person
- #755 — security and design findings to a person
- #618 — code review converges across rounds
- #675 — test-first sees its test fail on base
- #708 — review or design run parks at usage limit
- #657 — interactive workers that pause and ask
- #532 — maintenance loops from a check's output
- #807 — observe auto-merge, record only
- Cleanup started by the table: no open ticket. The Design step proposes one (operator rule: reuse first).

---

## Topic 4 — Roles and prompts (focus)

**High-level idea:** Keep a short fixed chain of roles, each a card the engine enforces in part, with a pack card
that wins over the built-in one. Close the gap between the cards we ship and the prompts we run: the review must run
the pack's finder and verify-pass cards. Keep every prompt change behind an eval gate.

**Internals:**

```text
role card (Markdown + YAML frontmatter)
enforced by code: role · tools (+ Edit path scope) · must_not_see · hand_off schema · enforced_guardrails (closed IDs)
read by the model: input · steps · rules
resolution: pack card (pinned by commit + sha256)  >  prompts/roles/*.md (built in)
gate: a change to a reviewer input needs an eval results file that holds the baseline and beats it on its aim
```

- The engine already reads the card frontmatter and enforces the closed list (C `src/core/process/cards.ts:1-21`,
`src/core/process/guardrails.ts:10-35`).
- The review round today runs `prompts/review-find.md` and `prompts/review-verify.md`, not the cards (D
`docs/explanation/code-review.md:76-77`). The switch is a change to a review input, so `check-eval-proof` gates it
(C `scripts/check-eval-proof.ts:1-22`). The baseline it needs now exists (D `evals/reviewer/README.md:3-7`, baseline
2026-11-12).
- A role's system prompt and its task travel apart: the card as the system prompt, the task as the first message
(#706). This keeps fixed parts first and changing parts last (P14).
- Every card carries one line that outside text is data (D `prompts/roles/design-reviewer.md:32`).

**Gap:**

| sub-aspect | ours | best reference |
|---|---|---|
| role set (#839 4.1) | 7 engine roles + coordinator + finder (pack card, not used) + eval judge (C `cards.ts:52-103`) | Factory.ai review: candidate pass, validator pass, security droid (C `da:src/core/review/prompts/candidates.ts:2`, `validator.ts:124`) |
| who picks the role (#839 4.2) | ours leads: **code** (C `table.ts:1-3`) | Optio, Sandcastle: **code** too (C) |
| what the engine enforces (#839 4.5) | ours leads: tools, guardrails, must_not_see, hand_off (C `cards.ts:6-21`) | AO reviewer allowlist in code (C `reviewer_policy.go:36-56`) |
| injection line in prompts (#839 4.8) | ours leads: every card (D `design-reviewer.md:32`; `pack:roles/finder.md:37-38`) | Factory.ai review prompts (C `candidates.ts:178-179`); AO trust line (C `prompt.go:238`) |
| gate on prompt change (#839 4.9) | ours alone: eval pass in CI (C `check-eval-proof.ts:1`; D ADR-0015) | unknown or none in every other source |
| cards in use | **Today:** finder and verify-pass cards not used (D `code-review.md:76-77`); the note still cites #216, which is closed | Factory.ai ships the same two-pass shape as open prompts (C droid-action) |
| evidence bar in the finder | grades cited / walked / ran (D `prompts/review-find.md:31-34`) | AO: "A concrete input or condition reaches it" (C `internal/review/prompt.go:100-106`) |
| implementer eval | none (pack evals exist but are not wired to the pin, D `improvement-loop.md:31`) | none in any source (#842 14.3) |

**Approach:**

| reference idea | source | call | why |
|---|---|---|---|
| Two-pass review: candidates, then a validator per finding | Factory.ai droid-action | adopt (already designed) | it is our finder + verify-pass shape; run the pack cards, behind an eval pass |
| Reviewer tools held by an allowlist and exact command shapes in code | AO | adopt | #662 already plans it; closes the `git diff --output=` trap |
| "A concrete input reaches it" as the evidence test | AO | adapt | add as a rule line to the finder card in the pack, eval-gated |
| Prompt precedence repo → workspace → deployment | Optio | skip | a repo-level prompt breaks P5 (judge from the change) |
| Repo-owned `WORKFLOW.md` as the prompt, hot reload | Symphony | skip | breaks P5 and ADR-0012 S12 |
| Skills as the unit of reuse (`SKILL.md`) | Devin, Factory.ai | adopt (already ours) | the rules pack is a Claude Code plugin with skills |
| Single linear agent, no role chain | Devin | skip | our chain keeps each run small and its view known (P2, P14) |
| Custom subagent as a tool boundary checked at load | Factory.ai | adapt | our card frontmatter already is one; extend the closed guardrail list only through P18 |
| System prompt from the card, task as the first message | ours (#706) | adopt | P14 order; better cache reuse |
| Smaller model for the implementer per lane | ours (#774) | adapt | only on measured numbers (P11, P14), from #561's benchmark |
| An eval for the implementer | ours (#824) | adopt | manual rung first (P11); no source has one |

**Existing tickets:**

- #662 — review contract, reviewer locked by allowlist
- #706 — role card as system prompt
- #774 — implementer's model per lane
- #824 — implementer eval, manual rung first
- #601 — breaker role, shadow mode
- #622 — design review reads the constitution
- #699 — move pin to card-v2 release
- #820 — a question names its kind
- #611 — `pinned.ts` change needs eval pass
- #679 — stale doc lines and Today notes (the `#216` cite in `code-review.md:77`)
- The switch to the pack's finder and verify-pass cards: no open ticket; #216 (eval judge and first baseline) is
closed. See open item 2.

---

## Topic 5 — Handoff (focus)

**High-level idea:** Every handoff stays a typed file the next run reads, never chat and never a resumed session. Add
three typed paths that are missing: a person's PR review into the rework task, the last run's own report into the
next rework run, and a typed event feed from runs to the person and the coordinator, read from the records.

**Internals:**

```text
run ends ──▶ .factory/report.json (done | asked | blocked) + .factory/pr.md
             │
             ├─▶ host: records line (JSONL) ── turn lines ──▶ board --since (#812) ──▶ person / coordinator
             ├─▶ next rework run: .factory/task.md  ← Act on · CI tail · ready failure · person's review (#799)
             │                                       ← last report.json + pr.md, verbatim, fenced (#810 B1)
             └─▶ review: context pack (spec, design, diff, rules from default branch) — no writer report (stays cold)
```

- Each new input enters `.factory/task.md` inside a data fence it cannot close (C `src/core/review/fence.ts:1-10`),
with a size cap like `MAX_TASK_CHARS` (C `writer/task.ts:1-6,17`).
- The feed is **pull**, not push: code writes a typed line per event (`started`, `ended`, `asked`, `blocked`,
`needs-human`) and `board --since` reads them. No run writes to the coordinator, and the coordinator starts
nothing (P8, ADR-0012 S2).
- The coordinator still resets from `agent-factory handoff`, built by code (C `src/core/handoff.ts:1-14`), never a
model summary.

**Gap:**

| sub-aspect | ours | best reference |
|---|---|---|
| reviewer → implementer (#838 5.5) | ours leads on shape: typed findings, `act-on.json` per head, fenced (C `src/core/review/act-on.ts:1-4`) | Devin findings to the PR's own session first (D `devin-review:250-256`) |
| a person's review → implementer (#839 6.10) | **no** (D `build-path.md:52`) | Optio resume prompt from review comments (C `reconcile-executor.ts:392-441`); Symphony (D `WORKFLOW.md:180-182`) |
| how a run ends (#838 5.3) | ours leads: typed `done/asked/blocked`, anything else is blocked (C `src/core/report.ts:1-16`) | AO `ao report` typed kinds (C `internal/domain/report.go:47-125`) |
| run → coordinator channel (#838 5.10) | none: code starts runs; coordinator relays answers only (D `prompts/coordinator.md:47-64`) | AO report outbox, batched, retried (C `report.go:11-17,47-57`); Devin parent woken when a child ends (D `advanced-capabilities`) |
| rework run knows why the last run built it | no: task holds the failure only (C `src/core/writer/task.ts:1-7`, per #810) | Symphony workpad comment edited in place (D `WORKFLOW.md:142-169`); Factory.ai workers record done and open work (D, per #810) |
| continuity between runs (#838 5.11) | fresh run each time (D `architecture.md:43`) | Devin, AO, Optio resume a session (D/C) |
| context reset note (#838 5.12) | ours leads: code-built, 32k cap (C `handoff.ts:1-14`) | AO handoff note on a fork, built by code (C `handoff_note.go:37-60`) |
| trust of handed-off text (#838 5.15) | ours leads: answers, task, findings fenced; note counts only with seat prefix (C `answers.ts:17-18`, `notes.ts:4-8`) | AO trust line, prompt only (C `prompt.go:238`) |
| person answers a question (#838 5.7) | ours leads: "1A 2B" parsed by code; AC change goes into the spec (C `src/core/answers.ts:1-18`) | Devin SF Decision card (D `bots:65`) |
| memory across tickets (#838 5.14) | brief + glossary, human-accepted; lessons from a person's retro (D `architecture.md:191-199`) | Devin memory repo, daily "Dreaming" (D `product-guides/memory`) |
| audit before the PR (#838 5.13) | JSONL on one machine (C `records.ts:1-27`; D #498 Today) | Optio `task_events` with user (C `schema.ts:274`) |

**Approach:**

| reference idea | source | call | why |
|---|---|---|---|
| Person's review comments into the agent's next task | Optio, Symphony, AO | adapt | as fenced data with file and line, member-only, via the `Forge` seam on both adapters (#799) |
| Persistent workpad (plan, done, open) the next run reads | Symphony | adapt | as `approach` and `open` fields in `report.json`, handed verbatim to the next rework run (#810 B1, B2); never posted from the run |
| Report outbox from worker to coordinator | AO | adapt | as typed record lines read by `board --since` (#812); pull, not push; no run talks to the coordinator |
| Wake the parent when a child ends | Devin | skip | needs a model parent that routes work (breaks P1) |
| Resume or fork the same session | Devin, AO, Optio, Sandcastle | skip | P2; dropped on #654 |
| `/handoff` of branch + diff + conversation | Devin CLI | skip | P2; no conversation crosses a run |
| Memory written by the agent, merged daily | Devin | skip | P12: a lesson is a PR a person merges; agent-written memory has no approver (#842 14.9) |
| Shared folder for plans and notes | Factory.ai Workstreams | skip | the spec store and project home already hold these (D `spec-and-knowledge.md:35-39`) |
| Typed report kinds `checkpoint / needs_input / stuck / done` | AO | adapt | ours has `done / asked / blocked`; a `checkpoint` kind is not needed because a run is short and fresh |

**Existing tickets:**

- #810 — rework run reads the last report
- #799 — a person's PR review starts rework
- #825 — `/rework` note sends the implementer back
- #812 — `board --since` from the turn lines
- #498 — home repo for specs and records
- #773 — session cap ending in a handoff note
- #614 — waivers and pushes as record events
- #771 — one run-kind list, tested mapping
- #534 — split `records.ts` by event type
- #663 — files or SQLite for the records
- #820–#823 — the question path (kind, terminal ask, daily re-ask, thread per ticket)

---

## Topic 6 — Review

**High-level idea:** Keep the review as code-driven lenses, read-only finders and a verify pass, where the AI never
approves. Run it on a runner, not the host. Feed a person's review into rework, and make each later round read the
earlier findings.

**Internals:** The review pack is built by code from the default branch and the store (C `src/core/review/pack.ts:1-12`).
The finder and verify runs move into the same `Box` the writer uses (C `src/core/box/types.ts:65-75`), with no git
host login and the read-only tool list from the card. A later round gets the earlier rounds' verdicts as a typed
field (#618). A person's review enters as a separate fact in `poll`, not as a finding.

**Gap:**

| sub-aspect | ours | best reference |
|---|---|---|
| where the reviewer runs (#839 6.6) | **Today:** on the host with read-only tools (D `code-review.md:76-78`; cite #674) | AO probes the Codex read-only sandbox and refuses without it (C `codexappserver/driver.go:44-52`) |
| person's comments reach the agent (#839 6.10) | no (D `build-path.md:52`) | Optio, Symphony, AO yes (C/D) |
| can the AI approve (#839 6.11) | ours leads: never (D `code-review.md:14-15`) | Optio and Devin Autoapprover approve (C `prompt-template.ts:208`; D `review:545`) |
| test-integrity checks (#839 6.3) | ours leads: S1–S4 + a lens (C `src/core/ready/floor.ts:4-14`) | none in code elsewhere |
| review structure (#839 6.5) | lenses by lane → finder → verify pass by kind → 4 buckets (D `code-review.md:19-41`) | Factory.ai candidates → validator + security droid (C droid-action) |
| validation against the running app (#839 6.1) | evidence rows re-run only (D `build-path.md:28`) | Factory.ai Missions QA validators (D `missions/planning:13`) |
| convergence | **Today:** the next round gets no earlier findings (D CONSTITUTION P15, #618) | Devin incremental re-review carries findings forward (D `review:340`) |

**Approach:**

| reference idea | source | call | why |
|---|---|---|---|
| Reviewer in a sandbox, refuse to start without it | AO | adopt | closes ADR-0012 S5 Today; same runner as the writer |
| Reviewer approves on the git host | Optio, Devin Autoapprover | skip | P6, ADR-0012 S10 |
| `REVIEW.md` in the product repo | Devin | skip | P5: rules come from the default branch or the pack, and the PR's own instruction files are stripped |
| Learn review guidelines from comments authors acted on | Factory.ai (C `review-guidelines/action.yml:2`) | adapt | as a retro input; a lesson is still a PR a person merges (P12) |
| Incremental re-review carries findings forward | Devin | adopt | it is P15's convergence clause (#618) |
| QA validators against the real app | Factory.ai Missions | adapt | through #565 (Playwright) and #805 (project smoke run), after the pilot |
| Severity P0–P2 with stable ids | Factory.ai, AO | skip | ours already has id, severity and grade (D `review-find.md:31-34`) |
| Security findings go to a person | ours (#755) | adapt | grill first; a writer should not fix a finding it cannot see the risk of |

**Existing tickets:**

- #799 — a person's PR review starts rework
- #618 — review converges across rounds
- #662 — review contract and reviewer allowlist
- #674 — Today gaps whose cited ticket is closed (review on host)
- #493 — the runner and gate
- #496 — a person runs the same review on their PR
- #739 — eval recall per stage
- #800 — review recall at three stages
- #801 — "pre-existing" grade for old bugs
- #803 — checklist items triggered by the diff
- #754 — flag test weakening the floor misses
- #755 — security and design findings to a person
- #565 — UI verification in a real browser
- #805 — project-declared smoke run in ready check

---

## Topic 7 — Plugins

**High-level idea:** Keep two plugin kinds, both pinned by hash, run with no shell and a capped env, and checked by a
contract kit. Make a bundled connector one command to turn on. Run an eval when a plugin pin moves.

**Internals:** A pin is a commit plus a sha256 of the tree, re-checked each pass (C `src/core/process/pins.ts:4-6`,
`src/core/plugin/pin.ts:1-7`). A pin move first runs `config check`, then the reviewer eval set (ADR-0020, decided;
**Today:** not built, D `architecture.md` §5). A bundled connector ships pinned in the release, so `connect` only
writes the project setting.

**Gap:**

| sub-aspect | ours | best reference |
|---|---|---|
| pinning (#841 7.4) | ours leads: commit + sha256 (C `pins.ts:4-6`) | Devin and Factory.ai allow a floating branch (D DV-plug, FA-plug); Optio floating ref (C `skill-sync-worker.ts:9-17`) |
| trust (#841 7.6) | ours leads: env allowlist, forbidden token names, copy run (C `contract.ts:31-35`); **Today:** interpreter and called CLI not pinned (D `connectors.md:24-31`) | Factory.ai `--ignore-scripts` (D FA-plug) |
| conformance kit (#841 7.8) | ours leads: `plugin test` with write fidelity (C `src/core/plugin/kit.ts:324`) | Symphony conformance checklist (D `SPEC.md:2204-2250`) |
| install (#841 7.3) | local or bundled only, `plugin add` per project (D `connectors.md:16-21`) | Devin, Factory.ai marketplace install with scopes (D) |
| MCP in runs (#841 7.1, 8.9) | none; `context.read` declared, unused (D `factory-stack.md:31,34`) | Optio, Factory.ai, Devin give runs MCP tools (D) |
| eval on pin move | **Today:** none (D `architecture.md` §5; ADR-0020) | no source has one |

**Approach:**

| reference idea | source | call | why |
|---|---|---|---|
| Hash pins, env allowlist, contract kit | ours | keep | round 2 keep; no source has all three |
| Floating branch or ref sync | Devin, Optio, Factory.ai | skip | breaks the round 2 keep |
| Org allow / forbid manifest | Devin, Factory.ai | skip | team governance; personal deployment (#833) |
| `--ignore-scripts` on install | Factory.ai | adopt | cheap; fits our no-shell rule (a check for the next connector built from npm) |
| One-command enable of a bundled connector | Devin, Factory.ai | adopt | decided as #811 |
| MCP servers inside runs | Optio, Devin, Factory.ai | adapt | only as a connector with `context.read`, read-only, through the egress allowlist; manual rung first (P11) |
| Compiled-in adapters, no third-party code | AO | skip | we want rules packs and connectors from outside (ADR-0009, ADR-0014) |

**Existing tickets:**

- #811 — bundled connector needs no `plugin add`
- #551 — key proxy for paid API in tests
- #796 — is "box" safe as an extension point
- #703 — how-to: use your own rules pack
- #699 — pin to card-v2 release
- #653 — `init` asks which add-ons
- Eval on a pin move (ADR-0020): no open ticket found; #599 (held-out slice of the golden set) is the nearest.

---

## Topic 8 — Adapters

**High-level idea:** Keep one port per outside tool (P17). Finish the agent CLI seam so the coordinator goes through
it too, then turn on Copilot one run kind at a time. Do not add tracker connectors in this map.

**Internals:** `AgentCli` has `readOnly`, `sessions`, `writer`, `login` (C `src/core/agent/index.ts:22-34`). Each
adapter owns its argv, env allowlist, model host list and usage-limit parser (ADR-0022). A run record line names the
CLI and its version (#691 item 2). Copilot's read-only kind turns on from real output (#697), then the writer kind
(#698).

**Gap:**

| sub-aspect | ours | best reference |
|---|---|---|
| agent CLIs live (#841 8.3) | Claude Code only; Copilot read-only built, off (C `src/core/agent/switch.ts:8-11`) | AO ~40 (C `internal/adapters/agent/`); Optio 8 + LiteLLM (C `packages/agent-adapters/src/index.ts:2-16`) |
| agent SPI (#841 8.2) | `AgentCli`, coordinator still outside it (D #691) | AO `ports.Agent` + refinements (C `internal/ports/agent.go:225-250`) |
| VCS host (#841 8.4) | `Forge`, 22 operations, GitHub + GitLab (C `src/core/forge/types.ts:118-171`) | Devin, Factory.ai: 4 hosts (D) |
| tracker (#841 8.5) | git host issues only; `tracker.*` points have no connector (C `contract.ts:18-26`) | Symphony 5 trackers (C `tracker.ex:13-27`); Optio 5 (C `ticket-providers/src/types.ts:3-30`) |
| runner (#841 8.8) | `Box`: `vm`, `srt` (C `src/core/box/types.ts:65-75`) | Sandcastle 10 providers (C `SandboxProvider.ts:204-291`) |
| git host reads | full poll each pass | AO polls with ETags (D `architecture.mdx:71`) |

**Approach:**

| reference idea | source | call | why |
|---|---|---|---|
| Many agent CLIs behind one port | AO, Optio, Sandcastle | adapt | Copilot only, kind by kind, each with its own guardrails; more CLIs only on measured need |
| LiteLLM proxy for any model | Optio | skip | adds a host with keys; the model-only token rule (ADR-0012 S6) is simpler per CLI |
| CLI auth probe before spawn | AO `agent ls --refresh` | adopt | part of #768 doctor and `init` |
| Linear, Jira, Asana trackers | Symphony, Optio, Devin | skip | round 2 skip |
| Tracker tools run host-side, tokens unset in the child | Symphony (C `app_server.ex:207,240-251`) | adopt (already ours) | our host posts; no run holds a tracker token (P4) |
| ETag reads on the git host | AO | adopt | decided as #793 |
| More runner providers (E2B, Modal, …) | Sandcastle, Devin Outposts | skip | cloud runners and microVMs are round 2 skips; personal deployment |

**Existing tickets:**

- #691 — coordinator behind the seam, CLI version
- #689 — Copilot spike by hand
- #697 — Copilot read-only runs on
- #698 — Copilot writer runs
- #793 — ETag reads in the GitHub adapter
- #493 — the runner and gate
- #566 — Jira as a ticket store (open on map #460; round 2 skips Jira here, see open item 6)
- #659 (one seam per agent CLI) is **closed**; its open children are #689, #691, #697, #698.

---

## Topic 9 — Internals

**High-level idea:** Keep a stateless CLI over plain files: store facts, derive status when read. Add a durable home
for the pre-PR records only when #498 lands, and keep the decision pure whatever the store.

**Internals:** Facts are JSONL lines, one file per ticket (C `src/core/dispatch/records.ts:1-8`). Status is derived
each pass (C `table.ts:119-138`), as AO also does for its Kanban (C `pkg/contract/kanban.go:8-34`). A store change
(#663) swaps where lines live, not what `decide()` reads. A started line with no ended line goes to a person, never a
re-run (C `records.ts:6-7`).

**Gap:**

| aspect | ours | best reference |
|---|---|---|
| runtime (#840 9 runtime) | a loop a person starts, ends when idle (C `orchestrator-loop.ts:1-14`) | Optio API + Postgres + BullMQ (D `README.md:126`) |
| crash recovery (#840 9 crash) | ours leads on safety: never guess if it pushed (C `records.ts:6-7`) | Optio durable turn receipts (D `security-review-2026-10.md:16`) |
| state off this machine | **Today:** before the PR, records on one machine (#498) | Optio Postgres; AO SQLite |
| stall (#840 9 stall) | 5 min no output (C `src/core/writer/run.ts:63-69`) | AO reaper: interrupt, two idle reads, kill (C, commit `77aeb0458`) |
| concurrency (#840 9 concurrency) | one loop per project, 1 run at once by default (C `caps.ts:60-61`) | Symphony 10 + per-state caps (D `SPEC.md:448-458`) |
| failure codes | records give started / ended / spent (C `records.ts:1-27`) | AO review-run state machine with failure reason codes (C `review/run_lifecycle.go`) |

**Approach:**

| reference idea | source | call | why |
|---|---|---|---|
| Derive status on read, store only facts | AO | adopt (already ours) | make it an invariant (#792) |
| Pure decision + CAS on a shared DB | Optio | adapt | CAS only if #498 or #663 picks a shared store |
| Postgres + queue | Optio | skip | personal deployment; one runtime dep is a strength (#841 12.7) |
| Hypervisor snapshot and resume | Devin | skip | microVM skip; P2 |
| Typed failure reasons on each ended line | AO, Symphony (11 phases, D `SPEC.md:678-690`) | adopt | lets #753 and the retro count the same failure; fits #771's run-kind list |
| Stuck-on-a-prompt detection | AO reaper | adopt | decided as #554 |

**Existing tickets:**

- #663 — files or SQLite for the records
- #498 — home repo for specs and records
- #792 — "store facts, derive status" invariant
- #534 — split `records.ts` by event type
- #771 — one run-kind list in shared words
- #721 — hand-over to a person in its own module
- #710 — split `writer/step.ts` along push and post
- #485 — replay real records, simulated loop
- #554 — spot a stuck coordinator or run

---

## Topic 10 — Security (focus)

**High-level idea:** Keep ADR-0012 as the frame: no login in any run, the whole process in a box, a host-name egress
allowlist, the host as the only one who pushes and posts, and a person as the only one who approves and merges. Close
the open Today rows first: review on the host, `srt` only tested on a fake. Then add two output checks that no run can
skip: a secret scan on every push, and caps on by default.

**Internals:**

```text
run (in box, no git login, model-only token, env allowlist, private HOME)
│ writes commits + .factory/*
▼
host push guard ── refuses: CI files · agent settings · .factory · protected paths      (exists)
              ── NEW: secret scan of the pushed diff, fail-closed, before --force-with-lease
▼
host posts ── one template: no /, @, #, links; PR body cleaner; scrub                    (exists)
```

- The secret scan runs in the **host** push path, after the run, on the diff the host is about to push. A run
cannot turn it off. It climbs P11's rungs: observe first (log what it would block, #802), then enforce.
- Caps are cap-class keys, so a lower layer only lowers them (D `architecture.md` §5 settings). A shipped default
makes "unset" mean the default, not "none" (C `caps.ts:41-42`: "a cap left unset is no cap").
- The writer gets a turn cap beside `--max-budget-usd` (C `claude-writer.ts:87`), as Optio passes `--max-turns`
(C `task-worker.ts:1657`).
- The reviewer, the design reviewer and the onboarder move into the `Box` with no login (ADR-0012 S5).

**Gap:**

| aspect | ours | best reference |
|---|---|---|
| git host credential in run (#840 10) | ours leads: **none**; host pushes (D `safety.md:47,87-88`) | Optio repo-scoped helper still in the run (C `git-credential-scope.ts:6-32`) |
| isolation strength (#840 10) | Sysbox container or `srt`; **Today:** `srt` tested only on a fake (D `safety.md:48-49`; #674) | Devin microVM, own kernel (D `cog:cloud`) |
| what runs in a box | **Today:** review, design review, onboarder on the host (D `safety.md:23,62,99`) | AO reviewer refuses without a sandbox (C `driver.go:44-52`) |
| egress (#840 10) | host-name allowlist; an allowed host can receive data (D `safety.md:50,60`) | Devin host + CIDR allowlist (D `dvn:sec-prof`); no source closes the content gap |
| skip flags (#840 10) | skip-all only inside `vm`/`srt`, deny list and hooks kept (C `claude-writer.ts:59-64`) | Factory.ai `block` rules hold at every level (D `fai:auto`) |
| config planted in repo (#840 10) | ours leads: `--setting-sources user`, `hostGit`, protected files (C `claude-writer.ts:74-79`) | Factory.ai settings protected (D `fai:sandbox`) |
| prompt injection (#840 10) | data fence; review strips `CLAUDE.md`/`AGENTS.md` (C `fence.ts:1-10`, `code.ts:1-2`) | Devin guardrails screen messages and PR comments (D `dvn:guard`) |
| secret in commits (#840 threats) | **partly**: scrub on records, traces, posts (C `src/core/scrub.ts:1-3`); no scan on commits | Factory.ai Droid Shield on staged diffs, fail-closed (D `fai:safety`) |
| forged approval (#840 threats) | **partly**: hash-bound; on a laptop the deny list is no wall (D `safety.md:82-86`) | Devin SF "a grant never exceeds the giver" (D `dvn:bot-acc`) |
| model approves and merges (#840 threats) | ours leads: never (C `approval.ts:1-12`) | AO, Symphony human step |
| caps (#840 13) | unset = no cap (C `caps.ts:41-42`); writer has no turn cap (C `claude-writer.ts:71-91`) | Optio budgets + `--max-turns` 250/10 (C `schema.ts:427-428`) |

**Approach:**

| reference idea | source | call | why |
|---|---|---|---|
| Fail-closed secret scan before push | Factory.ai Droid Shield | adapt | in the host push path, not in the run; observe rung first (#802), then enforce |
| Reviewer refuses to start without a sandbox | AO | adopt | the probe-then-refuse shape closes ADR-0012 S5 for review |
| Run holds a repo-scoped git credential | Optio | skip | ADR-0012 S2, S6; P4 |
| Skip permissions because "the pod is the sandbox" | Optio, Sandcastle | skip | ADR-0012 S11: we keep the deny list and hooks inside the box |
| microVM per run | Devin | skip | round 2 skip |
| CIDR rules in the egress allowlist | Devin | skip | host names hold for a personal VM; it does not close the content gap |
| Classifier on PR comments and ticket text | Devin guardrails | skip for now | the data fence holds; revisit when #799 brings a person's comment text into runs (open item 7) |
| Hooks that forward prompts to a DLP API | Factory.ai | skip | sends prompt text to another party; see #787 |
| Org grant cannot exceed the giver | Devin SF | adapt | as #806: approvers and "the starter does not approve" in the door seam |
| Tracker token unset in the child | Symphony | adopt (already ours) | P4 |
| Default-deny network policy shipped off | Optio | skip | ours refuses an unset `FACTORY_BOX` (C `src/core/box/choose.ts:1-6`); keep fail-closed |
| A table that maps each guard to its test | ours (#786) | adopt | turns "Today" lines into a checked list |

**Existing tickets:**

- #493 — the runner and gate
- #674 — Today gaps whose cited ticket is closed
- #786 — map each runner guard to its test
- #789 — tests for escape attacks not yet tested
- #797 — project commit hooks inside the runner
- #787 — what leaves the machine, and why
- #796 — is "box" safe as an extension point
- #751 — git guardrail hook on the operator's machine
- #806 — approvers and "starter does not approve"
- #760 — ADR-0023 acceptance re-confirmed by typing
- #738 — narrow the Bearer scrub rule
- #802 — every new check: off, observe, enforce
- #551 — key proxy for paid APIs
- #773 — session turn and token cap (closest to the caps gap; covers chat sessions, not runs)
- Secret scan on commits: no open ticket. Round 2 says it gets one only at the Design step.
- Caps on by default and a writer turn cap: no open ticket. Round 2 says the same.

---

## Topic 11 — Docs

**High-level idea:** Keep the Diátaxis split, the constitution, ADRs, glossary and `make lint`. Add a doc map that
ties each doc to the code it describes, with a check that fails on drift. Generate counts; never write them by hand.

**Internals:** A doc map lists each doc, its source of truth and the check that catches drift (AO
`docs/documentation-map.md:52-60`, per #667). A check reads a fact from the code (a count, a command list, a key
list) and compares it with the doc line. The command reference comes from the command registry (#598), and the
settings page from the key list.

**Gap:**

| sub-aspect | ours | best reference |
|---|---|---|
| how docs are checked (#842 11.8) | links, AGENTS.md size, MUSTs, old words, history notes, Today tickets (C `Makefile:9-24`) | Sandcastle test ties pages, TOC and glossary (D `sc:AGENTS.md:27`); AO codegen drift job (C `ao:.github/workflows/go.yml:199`) |
| drift marked (#842 11.9) | Today notes, each names a ticket (C `scripts/check-today.ts:1-5`) | AO `docs/STATUS.md` (D) |
| drift seen in ours | `improvement-loop.md:30` says 29 cases, 2 drafts; `cases.md` holds 30 and 0 (#842); `code-review.md:77` cites #216, which is closed | — |
| generated knowledge (#842 11.6) | brief + glossary written once, human-accepted; **Today:** review does not read them (D `spec-and-knowledge.md:47-52`) | Factory.ai AutoWiki refreshed per push (D); Devin DeepWiki (D) |
| run policy as a file (#842 11.4) | ours leads: pack data, never from the branch (D ADR-0012 S12) | Symphony `WORKFLOW.md` from the branch (D) |

**Approach:**

| reference idea | source | call | why |
|---|---|---|---|
| Doc map with drift checks | AO | adopt | decided path on #667; `docs check` (#669) runs it on any project |
| Docs test tying pages, TOC and glossary | Sandcastle | adopt | the same check shape, in vitest |
| Generated wiki refreshed per push | Factory.ai, Devin | skip | a model-written page with no approver breaks P12; our brief is human-accepted |
| `llms.txt` index | Devin, Factory.ai | skip | no docs site; agents read the repo |
| One normative spec with a conformance list | Symphony | skip | our ADRs and constitution serve this; P16 one home |
| Stack table with status and reason | ours (#809) | adopt | answers topic 12 in one place |

**Existing tickets:**

- #667 — doc map with drift checks
- #669 — `docs check` runnable on any project
- #670 — onboard reports missing kit files
- #679 — stale lines and Today notes
- #674 — Today gaps whose cited ticket is closed
- #782–#784 — ADR format, bar and cleanup
- #785 — each MUST names its exceptions
- #787 — what leaves the machine
- #792 — "store facts, derive status" invariant
- #795 — open to new modes, P19 and P17
- #809 — stack table with reasons
- #818 — CLI docs in AO's shape
- #703 — how-to: use your own rules pack

---

## Topic 12 — Stack

**High-level idea:** Keep a Node TypeScript CLI with one runtime dependency, plain files and shell-outs to the tools
a developer already has. Change the stack only when a measured need asks for it.

**Internals:** No change in mechanism. Each tool stays behind its port (P17). A store change goes through #663's
decision, not by drift.

**Gap:**

| sub-aspect | ours | best reference |
|---|---|---|
| footprint (#841 12.7) | ours leads: 1 runtime dep (C `package.json:45-47`) | Sandcastle 2 + optional peers (C) |
| storage (#841 12.4) | plain files, no DB (C `src/cli-common.ts:53`) | AO SQLite (C `go.mod:35`); Optio Postgres + Redis (D) |
| process shape (#841 12.3) | a CLI, no daemon (D `cli.md:8-70`) | AO daemon + apps (C); Symphony one service (C) |
| isolation (#841 12.5) | Docker + Sysbox + Squid, or `srt` (D `safety.md:39-49`) | Devin own hypervisor (D) |
| release (#841 12.6) | GitHub release tarball, not on npm (C `package.json:5,27`) | Symphony single binaries (D); Sandcastle npm (C) |

**Approach:**

| reference idea | source | call | why |
|---|---|---|---|
| SQLite for records | AO | adapt | only if #663 finds a need (pause, resume, events) |
| Postgres + BullMQ + K8s | Optio | skip | team scale; personal deployment |
| Daemon + desktop + phone apps | AO | skip | P8 and "not always on" (CONSTITUTION, What it is not) |
| Single-binary release | Symphony | skip | Node is already a dependency of the target users |
| Effect library | Sandcastle | skip | a large dependency for little gain at our size |

**Existing tickets:**

- #663 — files or SQLite for the records
- #809 — stack table with reasons
- #493 — the runner and gate
- #612 — nightly canary with the pin at HEAD

---

## Topic 13 — Cost and limits

**High-level idea:** Every run and every session has a cap on by default, set from measured runs (P7, P14). Usage
names the model and the CLI version, so a cost figure can be trusted.

**Internals:** Each cap is a cap-class key with a shipped default; "none" becomes an explicit value a person must set,
never the result of leaving a key empty. The writer gets `--max-turns`. A review or design run that meets the
provider's usage limit parks like the writer does (C `src/core/agent/usage-limit.ts:1-18`; #708). Each record line
names model and CLI version (#691).

**Gap:**

| aspect | ours | best reference |
|---|---|---|
| spend budgets (#840 13) | per ticket, project-day, window; **unset = no cap** (C `caps.ts:41-42`) | Optio monthly budgets, "Pause new work" (D `docs/usage.md:44-62`); Devin ACU budget tree (D `dvn:usage`) |
| per-run cap (#840 13) | `--max-budget-usd` when set (C `claude-writer.ts:87`) | Devin `max_acu_limit` (D `dvn:create`) |
| turn limit (#840 13) | writer: none (C `claude-writer.ts:71-91`) | Optio 250 / 10 (C `schema.ts:427-428`); Symphony 20 (D `SPEC.md:451`) |
| provider usage limit (#840 13) | **Today:** writer only parks (#708) | AO parses refusals (C `usage_limit.go:42`) |
| usage reporting (#840 13) | per ticket and run kind; **Today:** records do not name the model (D `models-and-sharing.md:10,15-17`) | Optio `usage_ledger` with model (D `usage.md:22-36`) |
| chat session caps | none (per #773) | unknown in every source |

**Approach:**

| reference idea | source | call | why |
|---|---|---|---|
| Budgets on by default | Optio, Devin | adapt | as shipped defaults on our existing cap keys, values from the pilot (open item 1) |
| `--max-turns` per run kind | Optio, Symphony | adopt | a cheap stop that P7 asks for |
| Pause new work at the budget | Optio | adopt (already ours) | our caps hold the next run (C `caps.ts` header) |
| Usage ledger with the model per run | Optio | adopt | #691 item 2 |
| Kill a run mid-way at the cap | none | skip | ours holds the next run; a kill mid-push breaks P3 |
| Rate limit on automation runs per hour | Devin | skip | no automation triggers (P8) |

**Existing tickets:**

- #773 — turn and token cap per chat session
- #708 — review or design run parks at limit
- #691 — CLI version per run, subagent tokens
- #774 — implementer's model per lane
- #561 — writer benchmark across models
- #563 — automation rate and cycle time
- Caps on by default and a writer turn cap: no open ticket (round 2: ticket at the Design step).

---

## Topic 14 — Evals and learning

**High-level idea:** Keep the lead: a reviewer golden set, a baseline and an eval gate on every change to a review
input. Add the outcome numbers a gate needs to trust (merge rate, model per run), recall per review stage, and a
cheap per-run score. Every lesson stays a PR a person merges.

**Internals:** The eval runs the real review round on approved cases and a judge matches findings (D
`evals/reviewer/README.md:3-7,64-73`). Recall per stage reads the same run at three points: raw, after verify, Act on
(#800). Outcome after merge comes from git (C `src/core/outcome.ts:1-11`). A held-out slice runs only at the gate
(#599). A run scorer reads the scrubbed trace and writes one record line with pattern ids (#560).

**Gap:**

| sub-aspect | ours | best reference |
|---|---|---|
| reviewer golden set (#842 14.2) | ours alone: 30 cases, baseline 2026-11-12, $41.24 (D `evals/reviewer/README.md`) | none in any source |
| eval gate (#842 14.4) | ours alone (C `check-eval-proof.ts:1-22`); plugin-pin gate decided, not built (D ADR-0020) | none |
| outcome metric (#842 14.1) | **Today:** merge rate and fix minutes not computed (D `measurement.md:3-14`) | Optio success rate (C `analytics-service.ts:59-68`); Factory.ai Agent Effectiveness (D) |
| learning (#842 14.7) | person-started retro (D `improvement-loop.md:9-24`) | Devin Session Insights per session (D) |
| retiring a rule (#842 14.10) | **Today:** nothing retires (D `improvement-loop.md:24`) | Devin Dreaming removes stale notes (D) |
| implementer eval (#842 14.3) | pack evals not wired to the pin (D `improvement-loop.md:31`) | none |

**Approach:**

| reference idea | source | call | why |
|---|---|---|---|
| Eval gate on prompt changes, golden set | ours | keep | round 2 keep |
| Success rate over non-cancelled runs | Optio | adapt | as merge rate in `usage` from our records (#563) |
| Per-session insights that rewrite the prompt | Devin | skip | a model edit with no approver breaks P11 and P12 |
| Per-run scorer over the trace | ours (#560) | adopt | read-only judge, its prompt eval-gated |
| Agent memory written by the agent | Devin, Optio | skip | P12 |
| Ratchet: a check only gets stricter | Pocock SF (D `EXAMPLE-TASKS.md:51`) | adapt | fits P11; pair it with our retire rule, so a dead lens still leaves |
| Learn guidelines from comments authors acted on | Factory.ai | adapt | retro input after #799 lands |

**Existing tickets:**

- #599 — held-out slice of the golden set
- #739 — eval recall per stage
- #800 — review recall at three stages
- #824 — implementer eval, manual first
- #560 — run scorers over the trace
- #561 — writer benchmark across models
- #563 — automation rate and cycle time
- #625 — timeline counts acted-on per rule
- #611 — `pinned.ts` change needs eval pass
- #614 — waivers and pushes as events
- #802 — check modes off, observe, enforce

---

## Top 10 gaps

Exactly as round 2 (#843, the top-10 and skips round) ranked them, by impact divided by effort. Impact and effort
are this report's estimate.

| # | gap | impact | effort | existing ticket | rationale |
|---|---|---|---|---|---|
| 1 | Caps are off by default, and the writer has no max-turns | high | S | none; closest #773 (turn and token cap per chat session) | P7 says every loop has a cap; today an unset key is no cap (C `caps.ts:41-42`), and Optio ships 250/10 turns (C `schema.ts:427-428`) |
| 2 | Human PR comments do not reach the implementer | high | M | #799 (a person's PR review starts rework); also #825 (`/rework` note sends writer back) | Optio, AO and Symphony all route comments back (#839 6.10); today a person must fix by hand or START again (D `build-path.md:52`) |
| 3 | Records lack the model and CLI version, and there is no merge rate | medium | S | #691 (CLI version per run); #800 (review recall at three stages, as round 2 named it) | P11 and P14 need trusted numbers; a cost or quality figure with no model cannot pick a model (D `models-and-sharing.md:10`). Merge rate itself sits nearer #563 (automation rate and cycle time), see open item 4 |
| 4 | No doc-to-code drift check | medium | M | #667 (doc map with drift checks) | a count drift is already there (#842: 29 vs 30 cases); the coordinator follows docs as instructions (AGENTS.md MUST) |
| 5 | Review, design review and onboarder run on the host | high | L | #674 (Today gaps whose ticket is closed) | ADR-0012 S5 Today; these runs read untrusted PR text on the host (D `safety.md:23,62,99`). #674 is a docs pointer whose done-when wants its own ticket, see open item 3 |
| 6 | No progress channel from a worker to the coordinator | medium | M | #810 (rework reads last report); #812 (`board --since` from turn lines) | the coordinator learns only from `board` and the ping (#838 5.10); a pull feed keeps P1 and P8 |
| 7 | No secret scan on commits | high | S | none (round 2: ticket at Design step) | Factory.ai scans staged diffs fail-closed (D `fai:safety`); our scrub covers records and posts, not the pushed diff (C `scrub.ts:1-3`) |
| 8 | The finder and verify cards are not live | medium | S | none open; #216 (eval judge, first baseline) is closed | the baseline now exists, so the eval-gated switch can run; the Today note still cites #216 (D `code-review.md:77`), see open item 2 |
| 9 | Records sit on one machine before the PR | medium | L | #498 (home repo for specs and records) | a lost machine loses the ticket (P3 Today); Optio and AO keep one durable store (#838 3.13) |
| 10 | One agent CLI only | medium | L | #659 (one seam per agent CLI) is closed; open children #689, #691, #697, #698 (Copilot spike, rest, read-only, writer) | a provider outage or limit stops all work; AO and Optio drive 8–40 CLIs (#841 8.3) |

---

## Open items for the operator

Each item has a recommended answer. "Yes" accepts it.

1. **Default cap values (gap 1).** Today an unset cap is no cap (C `caps.ts:41-42`), and P14 says caps come from
 measured runs. Recommended: caps ship on by default (per run, per ticket, per project-day, and a writer turn cap),
 with the values taken from the pilot's measured runs (#492, pilot and cutover); "none" must be set on purpose.
 Yes?
2. **Where the switch to the finder and verify-pass cards lives (gap 8).** #216 (eval judge, first baseline) is closed,
 and no open ticket holds the switch. #662 (review contract and reviewer allowlist) changes the same review inputs
 and needs the same eval pass. Recommended: add the switch to #662 as one more step, and fix the `#216` cite in
 `code-review.md:77` under #679 (stale doc lines). Yes?
3. **Where "review on a runner" lives (gap 5).** #674 (Today gaps whose ticket is closed) is a docs pointer; its
 done-when asks each row to get its own ticket. #493 (the runner and gate) owns the runner. Recommended: carry
 "review, design review and onboarder on a runner" as an item on #493, and point the #674 row and its Today notes
 there. Yes?
4. **Where merge rate lives (gap 3).** Round 2 named #800 (review recall at three stages), but #800 measures recall,
 not merge rate. #563 (automation rate and cycle time) counts merged tickets. Recommended: model and CLI version on
 #691, merge rate on #563, and #800 stays as it is. Yes?
5. **Shape of the progress channel (gap 6).** #810 (rework reads last report) hands the last report to the next run,
 not to the coordinator. #812 (`board --since`) reads turn lines. Recommended: the channel is pull only: typed
 record lines read by `board --since` (#812), plus #810's `approach` and `open` fields; no run writes to the
 coordinator (P1, P8). Yes?
6. **#566 (Jira as ticket store and intake).** It is open on map #460, and round 2 skips Jira for this map.
 Recommended: leave #566 on #460 as it is, and keep it out of this build spec. Yes?
7. **Injection screening.** Devin screens messages and PR comments with a classifier (D `dvn:guard`); ours has a data
 fence only. Recommended: no classifier now; revisit when #799 (a person's PR review starts rework) brings comment
 text into runs, and start it at P11's manual rung. Yes?
8. **Auto-split of large work.** Devin, Factory.ai and Sandcastle split a goal into child runs by a model (#838 3.3,
 5.10). Recommended: skip it; keep the AGENTS.md MUST that a person approves the child-ticket split before the
 build (#557, the worked example), because a model split breaks P1. Yes?

---

## Sources

- Map and rounds: #826 (the map: Notes, Decisions so far, Out of scope), #833 (round 1: topics, sources, focus,
personal deployment), #843 (round 2: top 10, skips, #794 outside, report home), #844 (this task).
- Source profiles in this folder: `827-own-design.md`, `828-devin.md`, `829-devin-software-factory.md`,
`830-agent-orchestrator.md`, `831-mattock.md`, `832-alternatives.md`, `835-optio.md`, `836-symphony.md`.
- Matrices in this folder: `837-matrix-ui-cli.md`, `838-matrix-flow-handoff.md`, `839-matrix-roles-review.md`,
`840-matrix-internals-security-cost.md`, `841-matrix-plugins-adapters-stack.md`, `842-matrix-docs-evals.md`.
- Ours at `39f7b68`: `docs/CONSTITUTION.md` (P1–P21), `docs/explanation/architecture.md`,
`docs/explanation/build-path.md:20-30,45-55`, `docs/explanation/code-review.md:77`,
`docs/explanation/improvement-loop.md:30`, `src/core/dispatch/caps.ts:1-45`,
`src/core/agent/claude-writer.ts:87`, ADR-0012, ADR-0015, ADR-0020, ADR-0022, ADR-0023, ADR-0024; other paths as
cited in the matrices.
- Rules pack chiyanram/skills at `044aa84e03ce9ef641e599bcc76bbb120e29fd0a`.
- AO `cab1f8d1570ea64eab9aeb8daa1ffd992a2b2425`: https://github.com/OrchestratorInc/agent-orchestrator;
https://docs.orchestrator.inc/plugins/agents/.
- Sandcastle `1b380ca`: https://github.com/mattpocock/sandcastle; skills `abeeaf9`: https://github.com/mattpocock/skills.
- Optio `8d116d80c45d3ebc15776672e0028b80fb439ec9`: https://github.com/jonwiggins/optio.
- Symphony `be10a1b79df723d6d7612b5651c8522704dafb2e`: https://github.com/openai/symphony.
- Factory-AI/droid-action `f79c81da0300f133b19f825cdd962998fdd9841b`; Factory.ai docs index https://docs.factory.com/llms.txt.
- Devin docs index https://docs.devin.ai/llms.txt; Devin SF template https://devin.ai/bots/templates/software-factory;
Cognition blog https://cognition.com/blog/what-we-learned-building-cloud-agents.
- Open tickets read for the "Existing tickets" lists: `gh issue list --state open` on 2026-11-20; bodies read for
#498, #554, #560, #563, #662, #667, #674, #691, #773, #799, #800, #810, #825; state checked for #216, #659 (both
closed).
