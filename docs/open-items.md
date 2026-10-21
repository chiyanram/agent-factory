# Open items — everything not finished (kept current; last update 2026-10-21)

Map: [#1](https://github.com/chiyanram/agent-factory/issues/1). Design: `docs/design.md` and
[the design page](https://claude.ai/artifact/XwqdmZw23eSWjCkF9DHzC3).

## A · Design (track 1, agent-factory map #1)

| # | item | state | where it belongs | next step |
|---|---|---|---|---|
| A1 | Gate speed — why the Verifier takes ~1 h | **researched, not decided** (#15, research/17) | design §6 gate | new ticket: pick the fix (below) |
| A2 | #19 other developers' flow | Q1 + Q2 recorded; Q3 dropped | design §2 | close #19 |
| A3 | Design approval | page + docs/design.md ready | map #1 | operator: approve or name a § |
| A4 | Thin items: daily digest, glossary | decided, 1 source each | §2, §3 | watch in use; no action |
| A5 | Stacked work (change built on an unmerged change) | parked 2026-10-18 | fog on map #1 | after approval |
| A6 | Transition: old 4-agent fleet, Verifier, frozen work | out of design | first ticket after approval | — |
| A7 | Old fleet bugs (audit 10-18): post-status missing in worker image, tokens as env vars, budget pause off, fleet-watch unscheduled | evidence only | A6 transition | — |
| A8 | Graphify trial (code graph) | optional, later | research/26 | only if wanted: code-only, no hooks, 15–20 questions with/without |
| A9 | Office work, other projects | follow-up | out of this map | — |
| A10 | Uncommitted: docs/design.md, docs/open-items.md, research/21–26 | waiting | agent-factory | operator "commit" |

### A1 detail — where the gate hour goes (research/17 §1a, VM run R29, 60m45s)

| phase | VM | laptop | cause |
|---|---|---|---|
| smoke FULL (~795 tests, 2 workers) | 24.5 min (40 %) | ~8.5 min | `@llm` tests on 1 worker with CPU Ollama; host strain keeps workers at 2 |
| Gradle check (units + ITs + Checkstyle + JaCoCo) | 21.7 min (36 %) | unmeasured | aruvii-api ITs alone 18.8 min: ITs serial (`maxParallelForks = 1`) |
| deploy → healthy | ~10 min (16 %) | unmeasured | ~6.5 min health-check waits |
| UI build + unit | 2.5 min | — | — |

- The VM is ~2.7× slower per test than the laptop. Memory is not the cause.
- Target: ≤ ~25 min, from 6 merges/day × 1.5 runs with fast-forward merge (research/17 §4).
- Every option that reaches the target needs **faster cores than this VM** and **ITs running beside smoke, not before it**.
- Options: (b) GitLab runner on the VM with parallel jobs, about 35 min · (b)+#609 cut the `@llm` smoke cost, about 30 min · (c) laptop as a runner, about 25 min, only while the laptop is on · (d) a bigger box, 12–18 min · single-job retry for flakes.
- Unmeasured: Gradle total + cache (M2/M3), deploy (M5), CPU steal (M7), VM `@llm` share (M8).

## B · Agent-platform temp changes (track 2, operator's call)

| # | item | state | next step |
|---|---|---|---|
| B1 | #642 interim, draft !281: one reviewer, findings-only, review packet, 3 rounds | 19b4fe1d on origin; 48035c0d local (writer session) | review 48035c0d, then operator "push" |
| B2 | #659 PIT on every module | precondition for test-first-only-for-bugs (G12) | separate ticket in agent-platform |
| B3 | #679 seam rules S-1..S-7 into the repo | needed by other developers | separate ticket |
| B4 | !244 design doc + local WIP af68fb15 (skills tree move) | parked as evidence | redone from the approved design |
| B5 | `~/.claude/settings.json` hook points at missing `block-dangerous-git.sh` | live on the operator's laptop | operator fixes or removes the hook |

## C · Done this round (for the record)

Rulebook restored to old G1/G1b/G5/G20/G21/G23 + `npx skills add` · six seats + intake · seat runtime · coordinator
(laptop and VM, no bypass) · identity: service account per developer · review reads rules from master · glossary ·
G12 + PIT precondition · /dod gone · no unix-zone walls · Claude-only extras · placements for code graph,
verification skill, prompt trimming · transcript retention 365 days.
