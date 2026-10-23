# Open items — everything not finished (kept current; last update 2026-10-23)

Map: [#1](https://github.com/chiyanram/agent-factory/issues/1). Design: `docs/ARCHITECTURE.md`, `docs/design.md` and
[the design page](https://claude.ai/artifact/XwqdmZw23eSWjCkF9DHzC3). High-level design approved 2026-10-22.

```
approved 2026-10-22 ─▶ L1 ✓ ─▶ L2 ✓ ─▶ L3 … ─▶ L4 ✓ ─▶ L5 … ─▶ L6 … ─▶ L7 …
                       #21     #22     #23      #24     #25      #26      #27
```

## A · Track 1 — design (map #1)

### Open tickets

| # | ticket | state | next step |
|---|---|---|---|
| [#23](https://github.com/chiyanram/agent-factory/issues/23) | L3 · coordinator playbook | Q2 trigger list decided; Q1 superseded by #1 CORRECTION 2026-10-23 | write the playbook text: how it starts writer and reviewer, copies answers, recovers |
| [#25](https://github.com/chiyanram/agent-factory/issues/25) | L5 · gate pipeline by kind | not started | `.gitlab-ci.yml` shape: jobs per kind, ITs beside deploy + smoke, single-job retry (input: research/17, 30) |
| [#26](https://github.com/chiyanram/agent-factory/issues/26) | L6 · identity setup | not started | checklist: service account, role, tokens, trailer, seat tag, team rule (input: research/24) |
| [#27](https://github.com/chiyanram/agent-factory/issues/27) | L7 · agent-platform adoption + transition | not started | AGENTS.md split, retire the old fleet and the Verifier, frozen work, interim !281 |

### Closed since the last update

| # | ticket | closed with |
|---|---|---|
| [#19](https://github.com/chiyanram/agent-factory/issues/19) | other developers' flow | same pipeline; reviewer assignment on undraft; daily digest (thin) |
| [#20](https://github.com/chiyanram/agent-factory/issues/20) | gate speed | keep the VM runner; speed via agent-platform #738 → #748 → smoke diet (research/30) |
| [#21](https://github.com/chiyanram/agent-factory/issues/21) | L1 · rulebook files | file plan approved (research/34; page https://claude.ai/artifact/Pqxf9rebUf7NJb1Zpk3vAr) |
| [#22](https://github.com/chiyanram/agent-factory/issues/22) | L2 · reviewer | find + verify passes, context pack from master, models per step (research/35) |
| [#24](https://github.com/chiyanram/agent-factory/issues/24) | L4 · `/crq` router | phase → skill table; coordinator owns intake to design and retro (correction 2026-10-23) |

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

State as of 2026-10-21 unless a date is given. Not re-checked for this update.

| item | state | next step |
|---|---|---|
| #642 interim, draft !281: one reviewer, findings-only, review packet, 3 rounds | 19b4fe1d on origin; 48035c0d local | review 48035c0d, then operator "push" |
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
