# 46 — Old-fleet retro, week 43 (2026-10-23 to 10-30), against the design

Source: the four old-fleet agents' own retros, written 2026-10-30 on the VM (`/home/agent-*/retro-2026-10-30.md`:
Analyst, Developer, QA, Spec Reviewer), and the Verifier job folders `/var/lib/fleet-verify/fleets/aruvii/jobs/`
(counts below re-checked from those folders). Compared with `docs/adr/0001`–`0009`, `docs/design.md`,
`docs/ARCHITECTURE.md`, `docs/playbooks/coordinator.md`, #25 Q2/Q5/RESOLUTION, #27 (old-fleet policy, Q2), and
map #30 tickets T2–T16 as of 2026-10-30. Read-only: nothing in the design was changed.

## 0 · At a glance

```
40 findings in 4 reports ─▶ 31 themes after merging duplicates
                            ├─ 13  covered by the design      → evidence, no ticket          (§2)
                            ├─ 14  gaps the design leaves     → a requirement on a ticket    (§3: 10 + 4 smaller)
                            └─  4  old fleet only             → fix if cheap, else wait T14  (§4)
```

The old fleet is in maintenance only until cutover (#27, operator 2026-10-24): fixes for current problems, nothing
new. So no finding here asks for new Verifier features; each one is either proof for the design or a requirement
on a map #30 ticket.

## 1 · Baseline for the pilot (T13 #43, "how we'll know")

The pilot records rounds, bucket counts and tokens per ticket. These are the old-fleet numbers for the same week.

| measure | week 43, old fleet | source |
|---|---|---|
| Verifier jobs | 73 (70 from the Developer), 38.7 h busy | job folders |
| full gates, failed or error vs passed | 17.1 h vs 13.8 h | job folders |
| one master flake before it got a ticket | `HttpClientPoolSpec`: 5 jobs on 3 branches before #829 | job folders; Analyst §1 |
| a docs-only MR | !295 (#750): 4 full gates, merge slipped a day | Analyst §1 |
| one story, gates | #821: 7 gates, 3 failed on master flakes | Developer §1 |
| waiting on a re-approval | #821: ~40 h finished but unmergeable | Developer §2 |
| hung job | `20261025-061651-cbe50b`: 4h00m, queue blocked | QA §2 |
| cache-read tokens (context re-read) | Analyst 677M · Developer 377M · Spec Reviewer 342M · QA 56M (QA's own estimate: ~90M) | transcript usage fields |
| Analyst session compactions | 7 in 4 days (one 95 MB session) | Analyst §8 |
| asks to the human not understood | 9 (Analyst) + 3 (QA) | Analyst §5; QA §6 |
| Developer Discord replies | 560; "status?" from the human 5× in 2 h | Developer §7 |
| QA round-1 clean | 4 of 10 MRs | QA numbers |

## 2 · Covered by the design (evidence, no ticket)

| finding (report §) | design answer | where |
|---|---|---|
| long sessions compact and lose state (Analyst §8; QA §3) | fresh worker per job, never resumed | ADR-0001 |
| ~70 % of QA's Discord inbound was not for QA, each a full-context turn (QA §3) | workers never talk to the human or read Discord | ADR-0001; playbook §Roles |
| steering files contradict each other: delivery format, home channel vs thread, stale VERIFY section (Spec Reviewer §4; QA §7) | one rulebook, one file per rule serves writer and reviewer; MR note is the record | ADR-0003; design §3 |
| the rubric is re-read 44× (~265k tokens) (Spec Reviewer §3) | one context pack per head; verdict reuse by patch-id; delta-only review | ADR-0004 |
| the architecture axis is invisible to the spec reviewer (Spec Reviewer §5) | one reviewer, Standards + Spec, architecture A–E merged | ADR-0004; design §4 |
| a docs-only MR runs the full gate (Analyst §1) | docs kind → lint + rule-load only | ADR-0005; #25 RESOLUTION |
| no cancel; a 4 h hung job (QA §2; Analyst §9; Developer §3) | GitLab cancel, `interruptible`, job timeouts (30 min default, 90 min IT/smoke in !263); a run at its time cap is marked interrupted | research/39 §1; playbook §Triggers |
| no queue position or ETA (Developer §3, §9) | pipelines and job durations are on the MR in GitLab | ADR-0005 |
| status asked 5× in 2 h; 560 replies (Developer §7) | status lives on the MR; one `[coordinator]` line; daily digest | ADR-0002; playbook |
| handover thread ids tracked by hand (Spec Reviewer §8) | the issue + MR is the thread; Discord optional | ADR-0002 |
| review pages private, unread (QA §8); artifact watch limit (Analyst §10) | the MR note is the record; comments arrive as GitLab notes | ADR-0002 |
| throwaway branches made inside the feature worktree (Developer §5) | own worktree per run, swept on exit | T9 #39 done-when |
| commit trailer decided three ways (Developer §4) | every agent commit carries `Co-authored-by: <human>` | design §2 |

## 3 · Gaps → a requirement on a ticket

| # | gap | evidence | requirement | ticket |
|---|---|---|---|---|
| G1 | "is this failure a known flake?" is not answered at failure time. Q5 writes each failure to the flake history and reruns once, but `flake-history.jsonl` is a per-pipeline artifact; nothing looks across branches before the coordinator picks "rerun" or "writer". | `HttpClientPoolSpec` failed 5 jobs on 3 branches, matched by hand (Analyst §1; QA §1; Developer §1) | the gate (or `poll`) reports, per failed test, "also failed on N other MRs in 7 days" from the history of all pipelines; the playbook's "a flaky job gets a rerun" reads that line | T11 #41 + T9 #39 |
| G2 | no per-job memory figure. #25 Q2 measures once with the diagnose brief; nothing records it per run. | #760 memory ACs written against lifetime cgroup values only (Analyst §6; Developer §3) | each heavy job records peak memory and the `oom_kill` delta in its log or artifact; the Q2 "raise to 3" check reads it | T11 #41 |
| G3 | an `/approved` older than the last description edit still looks like an approval. | QA checked it by hand on every review and missed it once (!336) (QA §4) | the `/approved` trigger counts only when the note is newer than the last description change (skills research/41 candidate rule) | T6 #36 (`poll`) |
| G4 | a story waiting on the human holds the writer's slot. | #821 blocked ~40 h; the human said "work another ticket" on 10-30, written nowhere (Developer §2) | playbook: an MR waiting on a human releases its run; the queue moves on | playbook §Triggers |
| G5 | asks to the human lack context. The playbook has "recommendation first, worded so yes accepts it", not the rest. | 12 asks not understood; "ok keep" to an A/B; "what is A and B" 3 days later (Analyst §5; QA §6; Developer §2) | every ask restates what is decided, the live state of each option, and one concrete example from the product; a two-option ask accepts only "A" or "B" | playbook step 2 |
| G6 | the coordinator is one long session, so it compacts; unanswered asks get lost. | an A/B on #760 unanswered 5 days (Analyst §8) | `poll` lists open asks to humans (a `needs-human` label or an open-question note) on every run, so a restart or compaction re-reads them | T6 #36 |
| G7 | a note can be posted against a head that already moved. | one wrong public note (!303), three discarded drafts (!324) (Spec Reviewer §2) | `status` and the reviewer post refuse when the source branch head is not the SHA the run started at ("results for old SHAs ignored", ARCHITECTURE.md) | T6 #36 + T9 #39 |
| G8 | GitLab 429s on many single-issue calls. | 43 × HTTP 429 in a week; one public count correction (Analyst §7) | the one GitLab seam batches reads (GraphQL) and retries with `Retry-After` | T6 #36 |
| G9 | rules name skills that are not installed. | `resolving-merge-conflicts` "Unknown skill" ×6; `wayfinder` unknown; a mandated step skipped silently (Analyst §3; Developer §4) | `make lint` (or the rule-load probe) fails when a rule or hook names a skill that does not resolve | skills#111 + T8 #38 |
| G10 | where the failing-first test of a bug fix runs. ADR-0007 keeps it for bugs; it does not say where. | 4 red runs as Verifier jobs; the human called them waste twice (Developer §4) | rule: the failing-first run is local and records SHA + result on the MR; never a gate job | skills testing rules (new issue) |

Smaller, for the same tickets (no evidence of large cost):

- **Mechanical review checks.** Baseline-drift greps (Spec Reviewer §7) and smoke anti-pattern greps (QA §5) → the
  reviewer's context pack or `make lint`, per design §3 "mechanical rules go to `make lint` or CI" (T10 #40).
- **The reviewer cannot answer an empirical question.** It cannot run one test at the head (Spec Reviewer §6).
  Operator question for T10 #40: may the verify pass run one named test?
- **Gate staleness after a merge from master.** Each sync is a new head and a new pipeline (Analyst §2). This costs
  runner time, not a human. Consider: carry the gate result when the patch-id is unchanged and no shared file changed.
- **Stale checkout.** A subagent read a working tree 35 commits behind (Analyst §4). The coordinator reads code for
  specs, so its brief says `git show origin/master:<path>`.

## 4 · Old fleet only (maintenance, until T14)

| item | report | fix now? |
|---|---|---|
| Verifier job timeout is 4 h | QA §2 | yes, one config line (~100 min) |
| "force-removed 4 leftovers" on 51 of 73 jobs | QA §9 | yes if the teardown fix is small |
| fleet-guard blocks `git merge-base` / `branch --contains`, and the message names no token | Spec Reviewer §1 | yes, one regex in the recipe |
| `block-commit-on-master` ignores a leading `cd X &&`; `pkill -f`; lint-staged noise | Developer §5, §6, §8 | agent-platform side; only if cheap |
| Verifier cancel, ETA, known-flake line, memory per job, `glab-note-at-head`, `qa-intake.sh`, Discord filter | several | no; replaced by G1, G2, G3, G7 and the design |

## 5 · The operator's five open decisions, by where they land

| decision | old fleet, until cutover | design |
|---|---|---|
| start the next ticket while a story waits for re-approval | Developer CLAUDE.md line | G4 |
| red runs local by default | Developer CLAUDE.md line | G10 |
| question format for asks to the human | recipe steering line | G5 |
| the spec reviewer may submit Verifier steps | Verifier trust boundary | §3 "empirical question" |
| commit trailer | align the recipes with design §2 | decided: `Co-authored-by: <human>` |

## Not established

- Costs in the four reports are the agents' own estimates, except the job counts and hours in §1, which come from
  the job folders.
- Token figures are cache-read totals from the transcripts' usage fields, not a meter reading.
- Ticket comments were read only for #25 and #27; a later comment on another T-ticket may already cover a gap.
