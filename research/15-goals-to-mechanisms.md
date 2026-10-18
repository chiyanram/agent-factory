# 15 — Goals → mechanisms: what the coherent setups use for O1–O10, why, and what ours has (2026-10-18)

Ticket: chiyanram/agent-factory#13 (parent #1, blocks #4; goals from #4 comment "Goals (operator 2026-10-18)"). Describes and compares only.
Cite keys: `F01`–`F14` = agent-factory `research/NN-*` · `R00`–`R68`, `R64a`–`R64e`, `CP1`–`CP12` (= R64) = `~/workspace/skills/research/NN-*` ·
`ADR-NNNN` = rameezk-forge `docs/adr/` · `AGENTS.md` = agent-platform root · `#`/`!` = agent-platform GitLab · `sk#` = chiyanram/skills · `G1`–`G32` = old-map decisions (F13).
Product keys (CC-*, GH-*, CDX-*, FAC-MA, JUL…) as in F02 / R64e. Confirmed in the reference clones: firstmate `AGENTS.md:382` (intent = acceptance criteria),
forge ADR-0065:22 ("does not take the agent's word for it"), pstack `shipping.md:7` (verdict only from a non-author).
"Ours" column: **has** / **partial** / **lacks**, with the evidence cite. WHY = the reference's own stated reason, ≤20 words.

## O1 · Solves the asked problem (no deviation from intent)

| mechanism | who · cite | their WHY | ours |
|---|---|---|---|
| human's ask pasted verbatim into the brief; reviewer reads it as acceptance criteria | firstmate `AGENTS.md:382`, R64b D4 | widening is barred "because the reviewer treats that subsection as acceptance criteria" | **partial** — G9e brief field "HUMAN'S WORDS" written, wiring parked (F13 G9e); laptop `/crq` has none (F12 §1) |
| fixed brief fields (GOAL, ACCEPTANCE, VERIFY…); missing field → refuse to spawn | pstack `orchestrate.md:38-57`, R64a D4 | "a worker cannot ask you a question"; an unfillable field = unscoped unit | **partial** — 9-field brief content built, not wired (F13 G9e) |
| interview before spec; "yes" accepts the proposed answer | mattpocock grilling, R64c D5; CC-BP, R64e D5 | facts are the agent's job; agreeing used to mean "No, but yes to the recommendation" (#1193) | **has** — `/crq` stage 2 grilling (F12 §1) |
| fetch the ticket and state its title before acting | mattpocock PR #1196, R64c D4 | a bare `#2` bound "to whichever numbered list is nearest in context, silently" | **partial** — stage 1 `glab issue view` (F12 §1); no title restated in hand-offs (F12 #34) |
| validation contract written before features, judged by fresh validators | Factory Missions, F02 FAC-MA | counters self-evaluation bias; 21 fix features = 34.4% of work | **partial** — REQ ACs + stage-8 AC↔`file:line` cite both ways (F12 stage 8), run by the authoring session |
| plan / design approved before code | Jules, F02 JUL; humanlayer System Design first, R64c D12 | INFERENCE (hl): code shape is wasted while the design still moves | **has** — `/approved` on spec+design SHA (F12 stage 5) |
| every "no" written once with its reason | mattpocock `.out-of-scope/`, R64c D2 | #573 closed but "the reasoning was recorded nowhere" | **lacks** — rejections in review pages, no single record (CP4) |

Unmet (ours): hand-off named only part of the ACs (#622, F12 #34) · #666 slices used `created_at` where the spec needed `queued_at` (F10 analyst q4) ·
!258 titled `docs(spec)` carries 406 files / +14,884 (F12 #32) · decisions made in Discord, MR shows only what an agent recorded (F12 #33).

## O2 · Correct

| mechanism | who · cite | their WHY | ours |
|---|---|---|---|
| done = PR ready + required checks green at the pushed head, read by the orchestrator | forge ADR-0065:22; firstmate `fm-dod-lib.sh:564`; pstack ledger by SHA, R64a D7 | "does not take the agent's word for it"; "Workers are supervised, not trusted" | **partial** — Verifier `summary.json` SHA pasted by an agent (R37 §1); no CI (AGENTS.md); runner !263 draft (F12 #27) |
| only a verdict from an agent that did not write the code counts | pstack `shipping.md:7`; Copilot requester cannot approve, R64e D6 | "an author checks what it meant to build" | **partial** — fleet splits roles; laptop one session reviews its own work (F12 #35, #38) |
| prove a test fails on a real defect (invert one condition / two imagined edits / diff after mutation) | addy #618; pstack D12; mattpocock #1209, R64c D7 | one dropped `!` left "all 127 tests" green | **partial** — G12 PIT on touched classes decided, #659 unbuilt (F13) |
| reproduce the bug end to end / failing test first | forge `AGENTS.md:22`, R64d D12; CC-BP, R64e D12 | tests are the oracle the agent optimises against (CCC) | **has** — TDD rule, test-first for bugs (AGENTS.md, G12) |
| run the change as a user would (live UI, browser) | pstack verdict ladder `live-ui-verified`; LRA, R64e D12; Cursor, F02 CUR | agents "mark a feature as complete without proper testing" (LRA) | **partial** — smoke FULL in §Done means (AGENTS.md); "still owed" on !268, !270 (F12 #28) |
| re-run checks on the merge result when trunk changed a caller | pstack `autopilot-full.md:19`, R64a D7 | stated in the rule itself | **lacks** — "rebase before verify" approved in #35, not landed (F12 §4) |

Unmet: REQ-666 `ck_runs_direct` hole caught only by the build IT (F10 spec reviewer q4) · #485 and #711 the same bug filed twice (F10 analyst q4) ·
!214 agent run "715 passed · 46 failed · 7 flaky" (F08 §3) · ProblemDetail claimed, used nowhere (R29 via F13) · !268/!270 merged without `verify-full` (F12 #28).

## O3 · Maintainable + readable

| mechanism | who · cite | their WHY | ours |
|---|---|---|---|
| standards read at review, not during implementation | mattpocock `retro/SKILL.md:31-35`, R64c D1 | implementation agent has "the most context pressure" | **partial** — standards rubric 86 criteria at stage 7 (F12 #12) and rules always-on (R34) |
| the rule is a lint/type check, prose is the fallback | hl-fold PR #51; addy #608, R64d D2; CP1 | rule in a doc: "Nothing links to it. Nothing enforces it." | **partial** — Checkstyle gates approved rules, not on every module (R59 via F13); semgrep deleted (AGENTS.md) |
| author's simplify pass before review + change-size stage rule (~800 lines) | openclaw `pr-simplify`, R64d D6 | agent PRs "keep growing past the smallest fix" | **partial** — `deslop` stage 6a (F12 §1); no size rule (CP8) |
| fixed smell baseline, repo standard overrides | mattpocock code-review Fowler list, R64c D6 | smells are always judgement calls; axes reported separately | **partial** — seam S-1..S-7 only in operator `~/.claude/CLAUDE.md` (F08 §4), #679 |
| examples correct and neutral | pstack #700, F01 §2 | "Agents copy the example" | **partial** — neutral pairs 68a–f exist, not shipped (F13 G23) |

Unmet: Java rules stated 4–5×, 5 contradictions (R01 via F13) · "Nothing gates the CLAUDE.md rules Checkstyle and ESLint miss" (AGENTS.md) ·
!258 one MR across 12 modules, +14,884/−4,905 (F12 §1 stage 6).

## O4 · Consistent across people and agents

| mechanism | who · cite | their WHY | ours |
|---|---|---|---|
| rules come from the repo, never the user's machine | Claude Code cloud, F02 CC-ENV; forge per-run empty `CLAUDE_CONFIG_DIR`, ADR-0057 | run behaves "as it would for a developer in that repository" | **lacks** — rules in repo + `~/.claude` + fleet `worker-rules.md` (F14 diff 8) |
| one owner per rule; move verbatim, leave a pointer | firstmate `AGENTS.md:431`; openclaw #173363; addy #580, R64d D2 | "keeping two would let them drift apart" | **partial** — G1/Q-1 decided; souls shipped twice (F13 contradictions) |
| one process text the whole fleet runs | pstack one hub; firstmate one contract, R64b D1 | one place where decisions happen (R64a D3) | **lacks** — personas: `/crq` "a tool, not a process" (F12 #23); G2 unbuilt (F12 §4) |
| delivery of each rule tested per harness (size caps, truncation) | firstmate #7298; openclaw #163325; pstack #597, CP2 | rules "arrived as fragments"; evaluated reminder "was never injected" | **lacks** — G20 probe decided, unbuilt; AGENTS.md 32,775 B > Codex 32 KiB (R34) |
| packaged install = subscribe to updates | pstack `/add-plugin`, mattpocock plugin, F14 §1 | plugin = updates; skills.sh = editable copy (matt README:27) | **partial** — `enabledPlugins` mattpocock; own generic plugin empty (F13 G23) |

Unmet: 6 instruction conflicts (F12 #17–22) · "@here" vs "tag the owner", Co-Authored-By vs none (F10 q3) · laptop collapses roles, fleet splits them (F12 §3) ·
"the pipeline is followed by different people at different stages" (#4 comment, 2.6) · developer skips `/dod`, stage 7, deslop (R00 via F13).

## O5 · Proportionate effort

| mechanism | who · cite | their WHY | ours |
|---|---|---|---|
| path picked by task type/size | humanlayer 4 flows, R64c D3; openclaw stage by size, R64d D6 | "Use the shortest path that gives the user useful review points" | **lacks** — 11 stages, "Never skip a stage"; G8 lanes not landed (F12 §4) |
| scoped proof locally, broad proof in CI | forge ADR-0064; openclaw `AGENTS.md:87`, R64d D7 | 33% of 3,133 box runs exited 0; 1,040 lane-hours vs ~9 min PR CI | **partial** — `verify-module` loop; gate ~1 h, one slot, full rerun only (F12 #24) |
| one fresh-context reviewer, advisory | Anthropic CC-BP; Copilot GH-CR, R64e D6; pstack 2 | reviewers asked to find gaps "will usually report some" | **lacks** — 4 rubric agents, unlimited rounds; G3 unbuilt (F12 §4) |
| effort/model per role, measured | pstack `SKILL.md:97`, R64a D10; hl-ace SlopCodeBench, R64c D10 | XHigh 2–4× cost, "not a reliable way to buy more strict passes" | **lacks** — effort per role not decided (CP11) |
| hard budget per run, fails closed | forge ADR-0044/0045, R64d D10 | "A budget cannot be silently bypassed by a model forge cannot price" | **lacks** — no per-run cost view (F14 diff 25); G14 report-only |
| cut text that changes no behaviour, A/B tested | pstack #634/#571, R64a D2; CC-BP | agents "follow just as well without the text" | **partial** — no-op test in checklist (CP3); no eval |

Unmet: #540 docs-only change, 489,534 review tokens (F12 #10) · architecture-reviewer 130–180k tokens × 6 runs/day (F10 q6) · !267 7 spec + 4 architecture rounds (F12 #14) ·
re-approval for wording-only edits (F12 #6) · 35-h session, 35% on one-line approvals (R35) · 86K-token baseline before the first word (F11 §3).

## O6 · Visible + traceable

| mechanism | who · cite | their WHY | ours |
|---|---|---|---|
| status derived from state, never hand-maintained; board of needs-input/working/ready | pstack `orchestrate.md:32`; CC agent view, F02 CC-AV; forge dashboard | without it the human "relearns what each one was about" (firstmate VISION.md:12) | **lacks** — REQ head/approval/gate rebuilt from 4–5 worktrees (F12 #29–30) |
| the forge thread/ticket is the record; blocks posted there | forge #529, F01 §5; firstmate inbox appended verbatim, R64b D4 | block note sat "where the operator does not look" | **partial** — G16/G19 decided; decisions still in Discord/chat (F12 #7, #33) |
| every run fingerprinted; runs compared as cohorts | forge ADR-0034, R64d D9 | "runs have to be compared" to tell if config changes help | **lacks** — G11 fingerprint decided, never measured (F13) |
| per-task spend ledger | firstmate #5354, R64b D10 | 26.5% of spend was cold pipeline agents, unattributed | **lacks** — 89% usage warning seen by chance (F11 #39) |
| one identity per actor | Copilot `copilot/` branch; forge App bot commits, ADR-0051 | requester marked co-author "for traceability" (GH-RISK) | **partial** — fleet bots; laptop agent verdicts posted as `chiyanram` (F12 #35) |

Unmet: ~1,900-line MR thread to find round/head/verdict (F12 #30) · 35 open MRs incl. drafts dead since 09-05 (F12 #31) · flake list kept in Discord (F08 §3) ·
K03c fail with no worker log (F10 qa q5).

## O7 · Reliable + honest (nothing fails silently or looks falsely green)

| mechanism | who · cite | their WHY | ours |
|---|---|---|---|
| done is a checkable fact about a commit (see O2) | firstmate #6200→#7422, F01 §1 | substring `*PR*` matched "PROD", turned a monitor task into done | **partial** — as O2 |
| a stuck worker is reported (blocked-on-prompt, bounded doorbells) | firstmate #6682, #6518, R64b D5 | a modal "is indistinguishable from a healthy idle composer" | **lacks** — liveness by tmux screen-scrape (F11 #55) |
| refuse when a protection cannot apply; fail loud on identity faults | firstmate #6750, R64b D11; hl-fold #60/#61, R64c D11 | "never degrade silently"; resume "must not silently resume from a new empty… log" | **partial** — `TEST=` matching nothing fails; `make doctor` exits 1 (AGENTS.md) |
| exit 0 is not success | firstmate #7317; mattpocock #1209 (`diff` not `grep`) | v1.84 "exits 0 and prints `○ daemon not running`" | **partial** — advisory hook on `\| tail` (AGENTS.md) |
| fix the flake's cause, no retries | forge #445, F01 §5 | flaky browser tests turned main red twice | **lacks** — rerun on flake, same SHA passes (F12 #25) |
| PR discloses what was not driven live | firstmate PR #6682/#6442, R64b D12; hl "tests read vs checks run" | honest disclosure of what was not tested | **has** — "report only what is knowingly failing, skipped, or unverified" (AGENTS.md) |

Unmet: no CI — 100 pipelines, 98 failed, 0 passed (AGENTS.md, F11 #66) · 116 OOM kills read as "box capacity" (F11 #1) · git guard hook points at a missing file (F08 §4) ·
`dod` hard-codes `MOD=aruvii-api` whatever changed (F12 #20) · `STALE` banner works only if read (F11 §3) · rules moved to "review only" when semgrep was deleted (AGENTS.md).

## O8 · Safe

| mechanism | who · cite | their WHY | ours |
|---|---|---|---|
| authority declared, enforced below the prompt; agent cannot approve/merge | Copilot GH-RISK; firstmate role gate #7172, R64b D8 | "autonomy exists only as an explicit grant, never as a default" | **partial** — master 403 (AGENTS.md); fleet-guard regex on `/approved` text (F12 #22) |
| sandbox + per-run empty config | forge ADR-0024/0057, R64d D11 | "no host state or earlier run reaches it" | **partial** — container + egress + zones built, not started (F14 §8); old fleet `--dangerously-skip-permissions` (F11 #72) |
| network off / allow-list by default | Codex, Copilot firewall, CC sandbox, R64e D11 | lethal trifecta: private data + untrusted content + external comms (LT) | **partial** — egress allow-list built, not running (F14 §8) |
| only owners' comments count; others' text is data | forge ADR-0063; pstack `babysit.md:6`, R64a D11 | a stranger's comment would "become text the worker acts on" | **partial** — new fleet counts only `FLEET_OPERATOR_LOGIN` (F12 #36), not running |
| attribution / policy forced in config, not prose | forge ADR-0074; CC managed settings, F02 CC-MS | written rules "lose to the harness's own system prompt often enough to leak" | **partial** — commit-msg hook; Co-Authored-By conflict live (F10 q3) |

Unmet: 3 of 4 agents on the operator's PAT (F11 #40) · master key in the checkout, #670 0 commits (F12 #41) · agent verdicts under the approver's account (F12 #35) ·
decrypt-site rule "checked by nothing"; no CVE scan (AGENTS.md).

## O9 · Portable (any project, any agent tool, laptop or VM)

| mechanism | who · cite | their WHY | ours |
|---|---|---|---|
| one install unit carries everything | firstmate "the cloned repo is the distro"; pstack / matt plugins, F14 §1 | plain files keep the system introspectable (VISION.md:61) | **partial** — repo carries `/crq`, hooks, `make`; seam rules, `cz`, `glab`, secrets outside (F08 §4) |
| setup script → snapshot, run before the agent | Claude/Codex/Cursor/Devin/Jules, F02 same-way 2 | "env setup is the #1 friction" | **partial** — `make doctor` checks only; `mise.toml` #713 not built (F14 §1) |
| repo installs its own deps | forge ADR-0072, R64d D7 | missing `node_modules` read as "cannot run" | **lacks** — fresh worktree lacks `node_modules` (F11 #32) |
| harness behind one adapter seam | forge ADR-0055; hl rpi PR #13; pstack #637, F01 §2 | "runner, fingerprint, store and frontend know nothing" of the harness | **partial** — G4 adapters decided; #643 WIP moves skills to `.agents/` (F12 header) |
| declarative host | forge OpenTofu + NixOS, ADR-0001 | standing up the VM "is the slice's whole point" | **lacks** — scripts edit sudoers/sshd (F06 §1) |
| forge-neutral words, one forge adapter | pstack #613 dropped Graphite, R64a D3; G19 | INFERENCE: forge neutrality (Origin + gh) | **partial** — GitLab; most products need GitHub (F02 CC-WEB, F09) |

Unmet: #4 area 1 problems 1.1–1.4, rising with 3 more developers (#4 comment) · 18 env rows (F11) · fixed ports, one stack per machine (#318, F11) ·
second developer's 18 drafts unreviewed 29–63 d (F08 §4).

## O10 · Learns (a repeated mistake becomes a check or a rule)

| mechanism | who · cite | their WHY | ours |
|---|---|---|---|
| mechanism ladder: architecture → types/lint → test → docs last | pstack `/correct`, R64a D9 | "Operators correct agents for the same mistakes again and again"; docs: "Nothing fails" | **partial** — G18 decided; `hook-from-rule` skill; #310 closed with rules unconverted (AGENTS.md) |
| change a rule only on an observed failure, evidence attached | mattpocock `SCOPE.md:9`, Before/After in every PR, R64c D2 | hypotheticals fail the bar; +1s don't count | **partial** — rules change by numbered decisions G1–G32 (F14 diff 28) |
| eval before/after a prose change; ledger of rejected changes | pstack eval playbook, R64a D2; addy `evals/skill-impact.md`, #678 | a cut is tested, not assumed (#419, #633) | **lacks** — no eval (F14 diff 28) |
| field incident → regression test / ADR citing the failed run | firstmate VISION.md:75; forge ADRs 0062–0072, R64d D9 | "field incidents become regression coverage" | **partial** — `check-migration-version.sh` born from #500 V99 (AGENTS.md) |
| retro → environment change or written rejection | mattpocock `/retro`, R64c D9; firstmate learnings routed to owner, R64b D9 | a lesson becomes an environment change, never a memory | **lacks** — no `/retro` stage (F12 §4, #35 Q23) |

Unmet: old decisions never reached `crq.md`, last edit 10-02 (F12 #39) · build ticket #645 — nothing implemented (F12 §4) ·
~4.5k lines built before the pilot sk#67 ran (F13 contradictions) · "a closed ticket is not an enforced rule" (#310, AGENTS.md).

## What makes their setups coherent

Each reference has **one artefact that every step reads and writes**; the mechanisms above hang off it.

```
pstack     brief(9 fields: ACCEPTANCE, VERIFY, REPORT head SHA) ─refuse if empty─► 1 writer / worktree
             ─► LEDGER keyed PR+SHA ◄── non-author verifier, ladder live-ui > unit > type
             ─► ship contiguous verified run, read merged state back ─► status.md derived from LEDGER ─► /ketchup
             lessons ─► /correct ladder ─► eval before prose ships            (R64a D3–D9)
firstmate  captain's words verbatim ─► BRIEF FILE "Captain's intent" = acceptance criteria ─► spawn refuses bad base
             ─► worker in worktree, reports only to firstmate ─► per-task status + inbox on disk
             ─► no-mistakes owns review/test/PR ─► DoD lib: pushed HEAD + native check ─► merge refuses unproved
             "Everything that matters survives the death of any conversation" (VISION.md:43; R64b)
forge      human label forge:ready ─► frontier snapshot ─► declared worker, empty sandbox ─► PR
             ─► revision brief lists every feedback item (FORGE STORE owns the cursor, ADR-0062)
             ─► done = ready + required checks green, read by forge (ADR-0065) ─► human merge
             every run fingerprinted ─► cohort compare ─► ADR cites the failed run (ADR-0034, R64d D9)
mattpocock grill ("yes" = recommendation) ─► TICKET, one decision each (map = index, not store)
             ─► /implement fetches ticket + states title ─► subagent per ticket, tdd at agreed seams
             ─► review: 2 axes, standards found by search ─► /retro ─► env change or .out-of-scope record
             runtime + gate left to the harness; "a repo with no guardrail is itself a finding" (R37 §1)
Copilot    issue assigned ─► ephemeral env (setup-steps) ─► push only copilot/ branch ─► ONE PR
             ─► Actions run after a write-user approves ─► AI review advisory ─► human non-requester merges
             permissions enforced by the platform, not prose (F02 GH-RISK, R64e D6–D8)
```

| link in the chain | pstack | firstmate | forge | mattpocock | Copilot |
|---|---|---|---|---|---|
| intent captured as | brief ACCEPTANCE | verbatim intent | ticket | decision ticket | issue text |
| intent reused as acceptance test by | non-author verifier | reviewer | required checks | Spec axis | human reviewer |
| checked at | head SHA | pushed HEAD | PR head | — (harness) | PR head |
| done read from | ledger | DoD lib + forge | GitHub, by forge | — | PR state |
| state lives in | ledger | disk files | forge store + labels | ticket | PR |
| lesson lands in | `/correct` → check | test / refusal | ADR + code | env change / `.out-of-scope` | — |

Ours, the same chain, with the breaks marked:

```
issue ─► grill ✗ answers in Discord / session chat, noted later (F12 #7, #33)
      ─► REQ 565–1,115 lines ─► draft MR ─► /approved @SHA ✗ stacked on unmerged specs, re-approved 3×/day,
         "materially" undefined, who may approve undefined (F12 #1–6, #36–37)
      ─► implement ✗ laptop: same session is analyst, reviewer, developer, qa, one account (F12 #35)
      ─► 4 rubric reviews, unlimited rounds (F12 #12–14) ─► stage-8 AC cite = prose in the authoring session
      ─► gate ✗ no CI; Verifier ~1 h result pasted by an agent; laptop verify-full "still owed" (F12 #24–28)
      ─► done ✗ not read from the forge at a SHA ─► operator merges 77 of 78 (F08 §2)
state ✗ rebuilt from 4–5 worktrees + ~1,900-line threads (F12 #29–30)
lesson ─► decision G1–G32 ✗ never reached crq.md; #645 nothing built (F12 §4, #39)
```

The break pattern: ours has most links as **text** (`crq.md`, rubrics, REQ, `/approved` note) but no single artefact that each step reads
and writes, so intent → acceptance → gate → done are not joined by anything a machine checks (F12 #29, R37 §1).

## Basic foundations none of O1–O10 names

| foundation | how the coherent setups hold it | ours |
|---|---|---|
| **a unit of work with one identity, end to end** | issue → branch → one PR, every product (F02 same-way 1); one ticket per session (mattpocock, R64c D3); ticket → workload (ADR-0016) | issue → MR, broken by spec-only map MRs and stacks !227←!253←!258/!261←!266 (F12 #1–2); 21 `claude/*` branches renamed before push (F08 §1) |
| **small units** | DORA "massive pull requests" raise instability; GSC small CLs; Copilot "Break complex tasks" (R64e D8); openclaw ~800-line stage (R64d D6) | no size rule (CP8); !258 406 files (F12 #32) |
| **one source of truth for state, one owner per fact** | ledger (pstack), status file + inbox (firstmate), forge store + labels; "whoever owns the state writes the brief" (ADR-0062, R64d L5) | none; MR head ↔ Verifier ↔ round not in one place (F12 #29–30); local master stale (F11 #43) |
| **who decides what (decision rights)** | escalation only for "a decision only a human can make" (firstmate VISION.md:16); human only for irreversible / product calls (pstack D5); only OWNER/COLLABORATOR count (ADR-0063) | approver undefined, 2nd approver "named and not counted" (F12 #36–37); "never answer your own question" vs "pick the default" (F12 #19) |
| **a definition of done per kind of work** | forge: dispatch / revision / conflict each own a success check (R64d D3); humanlayer 4 flows (R64c D3); wayfinder research → push, "open no PR" (R64c D8) | one §Done means for all kinds; small fixes skip it (F12 #28); no spec-only mode (F12 #2) |
| **lifecycle: start fresh, end clean** | fresh worker per task, never resume-chained (pstack D4); one phase per context (hl, R64c D3); idle `--bg` stopped ~1 h (F02 CC-AV); "end each session in a clean state" (LRA) | sessions 100–410 h per epic (F08 §1); old agents ~100-turn, "3 days silent" (F11 #49) |
| **human attention as a budget** | "human attention is the scarce resource" (MF-HAR, R64e D5); "a wrong decision usually costs less than blocking" (pstack D5) | one approval/merge point; !253 aligned → `/approved` ~6.8 d (F12 #26); W41: 1 merge while operator away (F08 §3) |
| **who owns each shared resource** | deploy never interrupts a workload (ADR-0035); capacity cap after 21.9M retry tokens (firstmate #4237); per-worker VM (F02 same-way 2) | one Compose stack, last deploy wins; one gate slot (F11 #11, #14; F12 #24) |
| **measurement / a baseline** | run fingerprint + cohort (ADR-0034); spend ledger (firstmate #5354); evals ledger (addy); 180-run eval (pstack #633) | G11 five numbers "never measured" (F13); laptop gate timings missing (F14 facts missing) |

Every coherent setup above names its unit of work and its state store first; the goals O1–O10 are written about qualities of the output
and the factory, and none of them names the unit, the store, decision rights, or a per-kind definition of done (#4 goals comment).
