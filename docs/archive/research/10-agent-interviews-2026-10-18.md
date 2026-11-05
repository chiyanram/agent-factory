# 10 — The 4 current agents on what blocks them (2026-10-18)

Ticket: chiyanram/agent-factory#3. The operator asked the 8 questions below in the fleet's Discord channel on
2026-10-18 (09:59); the analyst asked the others. Answers are summarised per agent with their own examples;
quotes are short. Agents: aruvii-analyst, Aruvi Spec Reviewer, Aruvi Agent Developer, aruvii-qa.

Questions: 1 biggest blocker · 2 waiting on the human that you could have decided · 3 ignored or contradictory
instructions · 4 what you redo because of others · 5 missing information · 6 most expensive step ·
7 remove one rule/step · 8 add one thing.

## Answers

| # | analyst | spec reviewer | developer (#592) | qa (!249 !256 !257 !259) |
|---|---|---|---|---|
| 1 blocker | specs stacked on unmerged specs: REQ-211 (#211) depends on !227 (ADR), !253, !258, !261; !261 (REQ-531) re-approved 3× in one day (c1b748d9, 8b4c5a72, 32d58191), each for one line another spec owed it | the same stacking: re-reads !258 !261 !253 + ADR-0017 per delta; heads moved underneath (REQ-531 ×3, REQ-666 ×2) | — | Verifier waits: ~1h05m per run, one slot, a fail re-runs in full; !259 spent ~5 h on a K03c fail + rerun |
| 2 waited, could have decided | #692 G1 already followed from REQ-531 Q6 + T1; mechanical #211 defaults ⟡1 (child link column), ⟡3 (finished child resumes parent). Genuinely the operator's: #211 Q3, #692 G2/G3 | nothing — deciding is not its role | — | nothing; only sees a handover when the developer mentions it with an MR id |
| 3 contradictions | CLAUDE.md "@here when blocked" vs the 10-17 "tag the owner" rule (follows the latter); "never answer your own question" vs "small and reversible → pick a default" (reviewers flagged picked defaults as unrecorded decisions, !266 F8, !267 F8 — now fixed by marking ⟡ defaults) | none blocking; follows "@here" | "@here" vs tag owner; global CLAUDE.md keeps Co-Authored-By vs repo + operator "no AI trailers" (follows repo) | "@here" vs tag owner; the fleet guard blocked an MR comment that only *mentioned* the approval token as text |
| 4 redo | mostly own gaps found in review: !267 took 7 spec-review + 4 architecture rounds; #485 vs #711 same bug filed twice; #666 slices used created_at where the spec needed queued_at | re-reading whole REQs to place a one-line delta; own miss (REQ-666 ck_runs_direct hole, caught by the build IT); fixing counts on posted notes | first Verifier run failed on smoke-63 K03c, same head passed on rerun: 1h04m lost; fleet-verify has no test filter | nothing in review; K03c flake (passed on rerun); compose files hard-code ports (#318) |
| 5 missing info | one place showing each REQ's head, approved-at, merged, and the deltas it owes other REQs (rebuilt from 4–5 worktrees each time); the ArchUnit module allow-list (learned in #692 review, not in the brief) | the REQ-531/REQ-666 heads a delta was written against (git fetch + diff by SHA each time); which doc deltas each REQ owes others | docker-compose.yml hard-codes 8088/8443/5432/9092, so its 20200 port block can't run a local stack; had to ask the operator for a one-run go on default ports | one place showing each MR head SHA against its Verifier result; K03c has no recorded cause; the job folder holds no worker log |
| 6 most expensive | architecture-reviewer runs, ~130–180k tokens each, 6 runs yesterday; re-reading 800–1000-line REQs for a one-line fix | verifying a spec's claims about existing code — where its real findings come from; keep it | the full Verifier run, ~1 h each | waiting on the Verifier, not tokens (its own review ≈ one diff read, ~12 tool calls) |
| 7 remove one | re-approval after a doc-delta-only edit → proposal (corrected after the spec reviewer's reply): a human approval stands across later heads the spec reviewer's delta note marks wording/pointer only; any behaviour change needs a fresh human token | the re-posted full review after a small revision — delta notes carry what matters. Gate stays human; its delta check is input, never approval | — | nothing; agrees the gate stays human; the Verifier result must still name the MR head; a doc-only head move needs no new run but a stated reason |
| 8 add one | a cross-REQ tracker: when REQ-A's amendment owes REQ-B a line, a checklist item opens on B's MR (would have saved !261's 3 re-approvals) | the same tracker + a header line in each REQ with the head SHAs of the specs it depends on | — | keep the failed run's worker log in the Verifier job folder + a test filter on `fleet-verify submit` |

## What the answers say (for #4)

| theme | evidence | kind |
|---|---|---|
| stacked, unmerged specs that owe each other edits → repeated re-approvals | analyst 1/8, spec reviewer 1/5/8 (REQ-211, REQ-531 ×3, REQ-666 ×2) | process / state visibility |
| the gate is slow and all-or-nothing: 1 h, one slot, full rerun only, no test filter, no failed-run log, a flake (K03c) with no cause | developer 4/6, qa 1/4/5/8 | gate |
| hard-coded compose ports block a second stack (#318) | developer 5, qa 4 | project setup |
| contradictory instructions across files (@here vs tag owner; Co-Authored-By; never-answer vs pick-a-default); a guard that blocks text merely mentioning the approval token | all four, 3 | rulebook (one source) |
| no single place for REQ heads / approvals / owed deltas, or MR head ↔ Verifier result | analyst 5, spec reviewer 5, qa 5 | state visibility |
| expensive review: architecture-reviewer 130–180k tokens per run, 6 runs/day; re-reading 800–1000-line REQs | analyst 6 | review cost |
| re-approval after doc-only changes | analyst 7, spec reviewer 7, qa 7 — all agree the gate stays human | process |

Not raised by any agent: worker isolation, unix zones, containers, a coordinator, bot identities, host config.
