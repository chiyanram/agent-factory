# Open items — everything not finished (kept current; last update 2026-10-31)

Build map: [#30](https://github.com/chiyanram/agent-factory/issues/30) (open; its sub-issues are the live build list).
Map [#1](https://github.com/chiyanram/agent-factory/issues/1) closed 2026-10-25. Design: `docs/ARCHITECTURE.md`,
`docs/design.md` and [the design page](https://claude.ai/artifact/XwqdmZw23eSWjCkF9DHzC3).

```
approved 2026-10-22 ─▶ L1 ✓ ─▶ L2 ✓ ─▶ L3 ✓ ─▶ L4 ✓ ─▶ L5 ✓ ─▶ L6 ✓ ─▶ L7 ✓ ─▶ map #1 closed 2026-10-25 ─▶ build
                       #21     #22     #23     #24     #25     #26     #27
```

## A · Track 1 — build

### Build tickets

| # | ticket | state |
|---|---|---|
| [#28](https://github.com/chiyanram/agent-factory/issues/28) | step 0: this repo becomes a build repo (instructions, `make lint` / `make test`, script tests, CI) | closed (#29) |
| [#31](https://github.com/chiyanram/agent-factory/issues/31) | T1: skills testing/ rule files | closed |
| [#34](https://github.com/chiyanram/agent-factory/issues/34) | T4: skills migrations/ and obs/ rule files, re-sourced from industry (research/47) | closed |
| T2–T3, T5–T16 | the rest of map #30 | see map #30 |
| [chiyanram/skills#111](https://github.com/chiyanram/skills/issues/111) | step 0: a buildable rulebook plugin repo | open |

### Design tickets closed (L1–L7)

| # | ticket | closed with |
|---|---|---|
| [#19](https://github.com/chiyanram/agent-factory/issues/19) | other developers' flow | same pipeline; reviewer assignment on undraft; daily digest (thin) |
| [#20](https://github.com/chiyanram/agent-factory/issues/20) | gate speed | keep the VM runner; speed via agent-platform #738 → #748 → smoke diet (research/30) |
| [#21](https://github.com/chiyanram/agent-factory/issues/21) | L1 · rulebook files | file plan approved (research/34; page https://claude.ai/artifact/Pqxf9rebUf7NJb1Zpk3vAr) |
| [#22](https://github.com/chiyanram/agent-factory/issues/22) | L2 · reviewer | find + verify passes, context pack from master, models per step (research/35) |
| [#23](https://github.com/chiyanram/agent-factory/issues/23) | L3 · coordinator playbook | `docs/playbooks/coordinator.md`; loop scripts are built in this repo |
| [#24](https://github.com/chiyanram/agent-factory/issues/24) | L4 · `/crq` router | phase → skill table; coordinator owns intake to design and retro (correction 2026-10-23) |
| [#25](https://github.com/chiyanram/agent-factory/issues/25) | L5 · gate pipeline by kind | stages and kinds of work decided, generic and per project (#25 RESOLUTION 2026-10-24) |
| [#26](https://github.com/chiyanram/agent-factory/issues/26) | L6 · identity setup | 9-step checklist in `docs/setup/identity.md` |
| [#27](https://github.com/chiyanram/agent-factory/issues/27) | L7 · agent-platform adoption + transition | order of steps to cutover; old fleet retires after 3 tickets run end to end |

### Other open items

| item | state | where |
|---|---|---|
| writing the L1 rules | after L1: one MR per target file; each rule cites its ledger row; any rule can be vetoed in its MR | #21 RESOLUTION |
| TR4a (OpenTelemetry tracing rule) | on hold until agent-platform #55 decides tracing | #21 fit scan |
| stacked work (a change built on an unmerged change) | parked as fog | map #1 "Not yet specified" |
| thin items: daily digest, glossary per project | decided, one source each; watch in use | #19, #1 "Shared language" |
| measurement: tokens/$ per review, rounds per MR, bucket counts, escaped bugs | decided; transcripts kept 365 days | map #1 "How we'll know it's better" |
| Graphify trial (code graph) | optional, later | research/26 |
| office work, other projects | follow-up, out of this map | — |

## B · Track 2 — agent-platform temporary changes (operator's call)

MR rows checked 2026-10-26. Other rows: state as of 2026-10-21 unless a date is given.

| item | state | next step |
|---|---|---|
| #807 one stage-5 design reviewer, !316 | merged | — |
| #783 root AGENTS.md as blocks of MUSTs and pointers, !318 | merged | — |
| #642 one stage-7 reviewer with two verdicts, draft !281 | in review | operator review |
| #814 one heavy run per machine, force-with-lease for writers, draft !323 | in review | operator review |
| #738 IT pre-setup standard (incl. `fsync=off` in IT Postgres) | gate-speed step 1 (#20, 2026-10-22) | re-measure on the VM with `docs/briefs/vm-gate-diagnose.md` |
| #748 parallel IT forks, a template DB per fork | gate-speed step 2 (#20) | after #738 |
| #746, #607, #609 smoke diet | gate-speed step 3 (#20) | after #748 |
| #659 PIT on every module | precondition for test-first for bugs only (ADR-0007) | separate ticket |
| #679 seam rules S-1..S-7 into the repo | needed by other developers (#19 Q1) | separate ticket |
| #662 errors as ProblemDetail | the rule changes in the same MR as the code (#21 Q6) | separate ticket |
| !244 design doc + local WIP af68fb15 (skills tree move) | parked as evidence | redone from L1 |
| temporary `/dod` | stays until the gate runs (ADR-0008) | removed in L7 #27 |
| `~/.claude/settings.json` hook points at missing `block-dangerous-git.sh` | live on the operator's laptop | operator fixes or removes the hook |

## C · Transition evidence (goes to L7 #27)

Old 4-agent fleet and Verifier still live · agent-fleet PR #84/#85 frozen · agent-platform !263 !269 #713 frozen · VM
zone users from `fleet-zones apply` · old fleet bugs from the 2026-10-18 audit: post-status missing in the worker image,
tokens as env vars, budget pause off, fleet-watch unscheduled (`docs/handoff-2026-10-18.md`).
