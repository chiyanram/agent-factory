# agent-factory: design review notes (one place)

Local only. Nothing here is decided until the operator says so. Started 2026-11-09. Keep this file the single index:
every finding, requirement, comparison and open question goes here, with a pointer to its detail file.

```
README.md                     this file: the index and the summary
audit-<area>.md (6)           the design audit research: control-flow, safety, connectors, plugins-roles, review, memory
code-review-compendium.md     how 15 vendors and in-house systems do AI code review
research-improvement-loop.md  how agents improve over time: the eval loop, who gates it, the R14 proposal
compare-1/2/3-*.md            the full comparison: every item × both repos at fa354ef / 3d63201 (§11)
research-spec-design.md       capabilities 2, 3: spec, design, design review (§13)
research-build-test-rework.md capabilities 5, 6, 7, 9: PR creation, testing, cleanup, rework (§13)
research-models-measure-share.md  capabilities 16, 17, 19: models + cost, measurement, setup + sharing (§13)
map-262.md · tickets.md       the closed wayfinder map #262 and its 12 ticket questions
```

The audit files are also on GitHub branches `research/audit-<area>` (kept, never merged). Map #262 and its tickets are
closed: the work stays local until a decision.

**Read this first: what each part was checked against.** The research was written against agent-factory `main`
`c59ed93`–`6137393` and skills `44d4a13` (2026-11-09). Both repos change daily, so a status below can be out of date.
Before any decision, run the full comparison in §8. A status is only trusted when it names a `file:line` or a PR.

---

## 1. What the operator wants (in the operator's words, 2026-11-09)

- One fixed process that everyone follows, the same pattern for all.
- Rules and standards inside that process, as a plugin.
- A spec, someone to review it, proper tests written, run and moved along.
- Proper AI usage, with principles, guardrails and security.
- For: the operator's personal projects, work projects, a personal project with a friend, then work colleagues.
- It evolves: a way to improve it with evals and feedback. For now, improvement is started by a human, not automated
  by AI (open: check how others do it).

## 2. Requirements

| # | requirement | from | status |
|---|---|---|---|
| R1 | a ticket a human started becomes a draft PR, with no one watching | DESIGN §1 | built |
| R2 | runs alone on built-in rules; standards and process plug in | DESIGN §1, §5 | plug-in built (#232); **runs alone: no** — review still needs the rulebook (`review/rules.ts:13-18`, `pack.ts:133-137`, GUIDE.md:443 Today:) |
| R3 | one flow on GitHub + GitLab, vm + srt runners, claude + copilot | DESIGN §5 | partly (srt, copilot: steps 5) |
| R4 | a question and its answer go into the spec | DESIGN §3 | design |
| R5 | never start without a human (P8), never approve (P6), never merge | DESIGN §2, §4 | built |
| R6 | no model holds a login (P4); the change never judges itself (P5) | DESIGN §2 | built; Copilot gap (audit D11) |
| R7 | isolation, push guards, test checks, approval floor cannot be switched off | DESIGN §1 | built; egress gap (audit D2) |
| R8 | every loop capped: per run, ticket, project-day | DESIGN §3 | built (#131) |
| R9 | a restart loses nothing (P3) | DESIGN §2 | **false today** (audit M1, 12-factor 5) |
| R10 | work and personal never mix; specs never in git at work (P9) | DESIGN §5 | design |
| R11 | measured: merge rate, human fix minutes, cost per merged PR | DESIGN §6 | not yet (pilot) |
| R12 | a model, prompt or plugin change ships only if its evals do not drop | DESIGN §6 | partly (reviewer eval #215) |
| R13 | **shareable:** a second person sets it up and runs it without the operator | operator | mechanism yes, ease no (see §6) |
| R14 | **improves under control:** feedback → a human starts a retro → a human accepts a lesson → new plugin version → evals do not drop → the pin moves | operator | parts exist, no loop (see §6) |

## 3. Principles

**Ours (DESIGN §2):** P1 the engine decides · P2 fresh runs · P3 tracker + git host are memory · P4 no model login ·
P5 the judge never comes from the change · P6 the AI never approves; zero findings is not a pass · P7 caps ·
P8 a human starts · P9 nothing committed to the product repo by default. The audit: all held up except P3.

**Candidates, not adopted:**

| # | candidate | from |
|---|---|---|
| C1 | no run holds all three: private data, untrusted input, a way out | audit D2, D11; Meta Rule of Two; lethal trifecta |
| C2 | a guardrail only in a prompt is not a guardrail: enforce in code or call it advice | audit D9, D7; #221 |
| C3 | prevent before you detect | audit D7; ImpossibleBench |
| C4 | put less into the prompt; let the agent look up | Karpathy "cognitive core"; arXiv 2602.11988 |
| C5 | nothing changes unless its eval does not drop | DESIGN §6 |
| C6 | human time goes to decisions, never to lines | operator's review split |

Recommended first: C1, C2.

## 4. Comparisons

### Matt Pocock (`mattpocock/skills` `software-factory`; Sandcastle)

Method: a factory = services (slots, bought) + tasks (built). "Buy the services and build the tasks." Start slow: three
brakes (automated checks, automated review, human review), one trigger at a time, cap every loop. A run never waits for
a human. Each task answers 5 questions: trigger · reads/writes · triggers next · where a human re-enters · what stops two
runs doing the same work. Sandcastle: a TS library, `sandcastle.run()` in a sandbox on a branch; you write the
orchestration.

| | Matt | agent-factory |
|---|---|---|
| services | buy | **build** (orchestrator, box, egress): the root of our complexity and of every audit security gap |
| tasks | build | build (9 role cards) |
| brakes | checks · review · human | ready check · review · human, plus approval before the build |
| start slow | throttle triggers | human START; no cron (#311) |

Not done: apply his 5 questions to each of our tasks.

### HumanLayer 12-factor agents

9 fit, 2 partly (6 resume: no by design P2; 11 trigger from anywhere: Discord, audit P1), 1 gap (5 unify execution and
business state = audit M1).

### Buy vs build

GitHub-only parts (gh-aw safe outputs, Copilot coding agent, Anthropic managed Code Review) do not fit GitLab. Fits:
srt (the planned laptop runner — **not built**: no srt in `src/`, `box/choose.ts:22-26` refuses the laptop; an earlier
reply here said "already the laptop runner", which was wrong), Claude Code code-review plugin as an eval baseline.
GitLab Duo: not checked beyond review (it does not learn from feedback). The table also missed one service we build:
the ticket tracker side (START and spec records are local files).

### Published whole factories

None. Big companies publish parts (review: Google AutoCommenter, Meta MetaMateCR, ByteDance BitsAI-CR, Uber, Atlassian
RovoDev). No study compares whole factories on outcomes; our pilot numbers (R11) would be among the first.

## 5. The design audit: 10 change verdicts, by risk

| risk | change | detail |
|---|---|---|
| highest | egress: data leaves through an allowed host (`api.anthropic.com` `/v1/files`) | audit-safety D2 |
| high | Copilot loads a repo's `.claude/skills/crq` before the pinned plugin (P5 hole) | audit-plugins-roles D11 |
| high | role-card enforced fields are prose | audit-plugins-roles D9 |
| medium | stall stop 5 min vs a 10-min silent test run (`settings.ts:37-47`, `BASH_MAX_TIMEOUT_MS` unset) | audit-control-flow #7 |
| medium | P3 false: START, approval, spec on one host | audit-memory M1 |
| lower | plugin conflicts by list order · Discord bot as a connector · MCP bridge pinning · near-duplicate findings · lens retirement by silence | plugins-roles D5 · connectors P1, P4 · review D3, D9 |

Plus about 15 refine verdicts in the audit files.

## 6. Code review: consensus and our gaps

From `code-review-compendium.md` (main `6137393`). Agreed by ≥3 sources and **we match**: generate then filter; the AI
never approves; rules are repo files and comments name their rule; the ticket/spec is in the context (ours is better:
the approved spec).

**Our gaps:**

| # | gap | today |
|---|---|---|
| G1 | later rounds do not read human replies, so they may repeat a dismissed finding | `review/history.ts` reads only its own notes |
| G2 | no live **acted-on rate** (see below) | **partly fixed by #312**: kept per kind (rule/logic), category, bucket — not per rule id or #237 lens; rated only when a next round runs, so the last round is never counted |
| G3 | no threshold per rule, no suppression from feedback | 4 buckets only; lens retirement by silence (audit D9) |
| G4 | ~~a role card replaces the default review text~~ **research wrong**: a project's prompt file replaces the default (`review/settings.ts:106-110`); role cards are not used by the review until the eval baseline exists (#216) | still: project text replaces, not adds |
| G5 | no skip for generated/lock files, no size cap | **partly research wrong**: "CI catches it → Dismissed" is in crq `review-process.md:41`, which reaches the pack |
| G6 | near-duplicates not merged by meaning | exact `file:line` + rule, before verify (`lenses.ts:98-130`); audit D3 |

**G2, the acted-on rate:** of the findings the reviewer posts, the share that a later commit fixes at that place.
Example: 10 findings posted, the implementer or a human changes the code at 6 of those lines → 60%. Bugbot reports 78%,
Uber 65%, Google ~40%, Atlassian 38.7%. It is the main live number every in-house system uses, and the number R14's
improvement loop needs.

Vendor surprises: Bugbot dropped voting (weakens audit D1); Copilot reads rules from the PR's own branch (we forbid it,
P5); Anthropic's managed review is GitHub only; GitLab Duo does not learn from feedback.

## 7. R13 shareable and R14 improving: what the design covers

| | the design has | missing |
|---|---|---|
| R13 | settings layers (team@commit, project, user); pinned plugins; onboarder writes the brief (#235, not built); rollout step 6: Jira approval, spec PR, team template | a short setup path: GUIDE today needs identity, box login, box image, egress check, project file, plugin add by hand |
| R14 | retro only when a human starts it; lessons accepted by a human; plugin update shows the diff, runs evals, moves the pin; reviewer eval (#215); role evals (skills#236) | the chain between them; the live acted-on rate (G2, PR #312 in flight) as its input; how others run this loop: researched, see below and `research-improvement-loop.md` |

### R14: the improvement loop (`research-improvement-loop.md`)

```
① SIGNAL → ② READ DATA → ③ NAME FAILURES → ④ CASE FROM FAILURE → ⑤ CHANGE → ⑥ RE-RUN EVALS → ⑦ SHIP if no drop ─┐
 auto        HUMAN          HUMAN (taxonomy+count)   HUMAN approves      human/opt.   auto (CI)       HUMAN gate      │
 └────────────────────── watch ①, retire stale rules ◀─────────────────────────────────────────────────────────────┘
```

- Human-gated: Google AutoCommenter, ByteDance BitsAI-CR, every eval guide (Anthropic, OpenAI, Husain/Shankar).
  Automated: Bugbot, Copilot Memory (90-day expiry), CodeRabbit (admin approval off by default).
- Full automation risk: Darwin Gödel Machine deleted the markers of its own hallucination check; ACE's paper shows a
  rewritten context collapse from 18,282 to 122 tokens.
- **"It is a retro": partly right.** A retro is ② and ③, the most important part. It lacks: a regression golden case per
  lesson (main gap), an eval gate, a live number (G2), an expiry step.
- **Proposed loop:** 1. the engine records the acted-on rate (G2) per rule. 2. A human starts a retro on ~10 merged
  tickets and reads the traces. 3. Each lesson is a plugin PR: the rule at its strongest level + a new golden case + a
  review-by date. 4. A human accepts. 5. Reviewer eval #215 + role evals skills#236 + a held-out slice; recall ≥
  baseline, 0 findings on clean cases. 6. A human moves the pin. 7. After 20 PRs, a rule with no acted-on hit goes to a
  human to retire.
- Automate later: ①–③ (cluster findings, draft the lesson and its case). Never automate: the accept, the pin move, a
  baseline raise. Never change the judge or the cases in the same PR as a lesson.

## 8. Waiting

The operator waits for the open PRs to merge, then runs the full comparison (operator, 2026-11-09).

**Merged since the research** (check their effect): #297, #307, #308 (#299), #302, #303 (#213), #304 (#218),
#309 (#219), #310 (#237), #318 (#235). agent-factory `origin/main` was `ec2ec94` when this list was made.

**Still open** (2026-11-09, late):

| PR | issue | what | touches |
|---|---|---|---|
| #312 | #220 | record the review's acted-on rate, show it in usage | G2 |
| #321 | #237 | a finding carries lens, grade, evidence; a lane its lens count | audit review D5, D6; plugins-roles D9 |
| #313 | #236 | design review before approval; cleanup after the implementer | walkthrough ③, ⑥ |
| #311 | #305 | a human starts the loop, it ends by itself; no cron | walkthrough ⑤; DESIGN.md:72, GUIDE.md:569 |
| #325 | #320 | ask every open question at once, one round | DESIGN §9 questions |
| #316, #317, #319 | #138 | port bash to TS; drop git.sh and tokens.sh | AGENTS.md MUSTs |
| #324 | — | CI on the merge queue | — |

skills: no open PRs; local clone 74 commits behind `origin/main` (read from `origin/main`).

**The full comparison, when it runs:**

```
every finding (6 audits · compendium · improvement loop · Matt · 12-factor · R1–R14 · C1–C6 · G1–G6)
   ▼ checked against BOTH repos at origin/main, never from memory
   agent-factory file:line or "none"  |  skills file:line or "none"
   ▼
   status: holds · gap · fixed by PR #n · not verified
```

Rules: no status without a `file:line` or a PR number; "not verified" is allowed, a guess is not; check every finding
against both repos. Then design the retro additions (RT8–RT10: golden case per lesson, eval gate, expiry) from the
matrix.

## 7b. The skills repo (chiyanram/skills, origin/main `44d4a13`)

```
marketplace chiyanram
 ├─ rulebook   the product
 │   ├─ skills/<domain>/SKILL.md   router: reference · rule IDs · "read it when"   (code, testing, planning,
 │   │   └─ references/*.md        Rules · When X use Y · Good/Bad · Decided edges ·  obs, migrations, agent,
 │   │                             Review checks  ◀ what the reviewer reads           meta, deslop, crq)
 │   ├─ skills/crq/                the process: phases table, references CR RV VB PR TI RT LN
 │   │   └─ process/               lanes.json · review.json (baseline) · glossary · 9 role cards
 │   └─ evals/<role>/<case>/       3 scenarios per role: prompt.md + graders/*.md (LLM-graded)
 ├─ toolbox    software-factory (Matt's), grilling, correct, diagram-brief, loop-me
 └─ upkeep     make index · make lint (check_*.py: routers, provenance, sizes…) · evals/routing/*.json
               provenance only in docs/rulebook/approved-rules.md (the ledger)
```

Links to this review:
- The audit's `"lenses": "~3"` (D9, prose values) is in `crq/process/lanes.json`, not `review.json`. Confirmed.
- crq `retro` RT1–RT7 already covers the loop's ② ③ ⑤: trace past "the agent got it wrong" (RT2), tune or add the
  check with this ticket as origin (RT3), fix at the strongest level (RT6), human-started only (RT7). Missing against
  §7: a golden case or eval scenario per lesson, the eval gate, an expiry date. RT4's due date is for the action, not
  the rule.
- Each reference ends in "Review checks" naming rule IDs: the reviewer's checks already exist per rule, so G3
  (threshold per rule) and G2 (acted-on rate per rule) have a natural key: the rule ID.

## Log

| date | what | status |
|---|---|---|
| 2026-11-09 | design audit: 6 areas, 10 change verdicts (§5) | recorded, not decided |
| 2026-11-09 | operator wants: one fixed process as a plugin, shareable, improving under human control (§1) | recorded |
| 2026-11-09 | R13 shareable, R14 improving loop added to the requirements (§2) | operator agreed in principle |
| 2026-11-09 | code review: consensus of 15 sources; our gaps G1–G6 (§6) | recorded, not decided |
| 2026-11-09 | improvement loop: "it is a retro" is partly right; a retro lacks a golden case per lesson, an eval gate, a live number (G2) and an expiry (§7) | recorded |
| 2026-11-09 | recommended first decision: G2, the live acted-on rate, since the review gaps and the R14 loop both need it | recommendation, not decided; G2 now in flight as PR #312 |
| 2026-11-09 | skills repo read (§7b): crq retro RT1–RT7 already covers most of the loop; missing: golden case per lesson, eval gate, expiry | recorded |
| 2026-11-09 | operator: keep both repos in view; compare all research with both, not one item at a time; no assumptions | method recorded in §8 |
| 2026-11-09 | operator: wait for the open PRs, then run the full comparison | done |
| 2026-11-09 | full comparison on `fa354ef` / `3d63201`: 146 rows, 35 gaps, 10 research corrections (§11) | recorded, not decided |

## 11. Full comparison result (agent-factory `fa354ef`, skills `3d63201`, 2026-11-09)

Detail, one row per item with `file:line` in both repos: `compare-1-control-safety-memory.md` (46 rows),
`compare-2-connectors-plugins.md` (44 rows + Matt's 5 questions × 10 tasks), `compare-3-review-loop.md` (56 rows).
In flight, not checked: #336 (#335 PR body).

```
                 holds  gap  partly  fixed  changed  research wrong  not verified
1 ctrl/safe/mem   24    13     6       –      1      3 (partly)        0
2 conn/plugins    32     1     5       2      1      2                 1
3 review/loop     21    21     5       1      2      5 (partly)        1
total 146 rows    77    35    16       3      4     10                 2
```

Spot-checked by hand (all confirmed): `writer/run.ts:46` stall 5 min · `egress/squid.ts:3-5` TLS never opened ·
`writer/run.ts:110` skip-permissions in the box · `coordinator.ts:50-56` HUMAN_ONLY lacks `plugin update` ·
`lenses.ts:137` Noted counts as unique · `table.ts:276-279` test-first by lane name · `box/choose.ts:22-26` laptop
refused · `plugin-pin-cli.ts:1-5` no evals on update.

**Gaps by theme (both repos):**

| theme | gaps |
|---|---|
| safety | egress by host name only (SAF-D2) · writer holds all 3 legs (C1) · tests detected, never read-only (SAF-D7, C3) · writer has skip-permissions in the box; srt must drop it · `plugin update` not in HUMAN_ONLY · test-first card claims a guard (test files only) that no push guard has; engine drops "(test files only)" from tools (`process/cards.ts:110-118`) |
| state (P3) | START, approval, spec on one host (M1, R9, 12F-5) · "issue" spec store typed, unused (`spec.ts:53`) · a run whose dispatcher died goes to needs-human (`table.ts:167`) |
| control | stall 5 min vs foreground commands (CF#7, worse: `step.ts:106`) · no jitter; failed pass retried at a fixed interval · lanes file `test_first` ignored, lane name used (vs DESIGN:84) · "may a human lower a raised lane?" answered nowhere |
| plugins | DESIGN:147 says every card field is enforced; code enforces 4 (`cards.ts:7-14`) · first plugin wins on conflict (D5 not done) · pins per machine, not in a settings layer — a team cannot pin one rulebook (hurts R13) · connector dry mode + kit cases not built · ADR-0014 P1, P2, P4 changes open |
| review | G1 human replies · G3 per-rule threshold · G6 merge by meaning · size cap / generated skip · no thumbs · no human baseline rate · Noted counts as unique · up to 2 verify passes, docs say 1 |
| improve (R14) | no retro run, no timeline record in the engine (RT1) · no golden case per lesson · 0 of 33 golden cases approved → no baseline → eval gate blocked by data, not code · `plugin update` runs no evals (DESIGN:136 says it does) · nothing stops a lesson PR changing the judge · crq RV5 conflicts with lens retirement (DESIGN §6) |
| measure (R11) | only spend measured: no merge rate, fix minutes, cost per merged PR |
| docs drift | DESIGN:136 (evals on update) · DESIGN:147 (all fields enforced) · DESIGN:150 (connector kit) · DESIGN:246 + ADR-0004:49 (one verify pass) · DESIGN:162 (`ran` grade, no Today: mark) |

**Research corrected:** R2 "runs alone" not true · srt not built · G4 wrong mechanism · G5 lint/CI part exists ·
CF#2 task.md hand-off existed · Sysbox risk already shown · coordinator bypass already disabled · severity kept (#304
amended ADR-0015 R2) · CR-C2 crq RV2 already in the pack.

**Matt's 5 questions:** no doc answers them for any task. From the code: coordinator Q5 (no session lock), onboarder
Q5 (no lock), retro Q1–Q5 (no engine run) have no answer.

## 12. Capabilities and research coverage (2026-11-10)

Two questions, kept apart: ① is the DESIGN right (research vs DESIGN.md, ADRs, crq process)? ② is the CODE built as
designed (§11)? The operator asked for ① first, grouped by capability.

```
group          capability                                  coverage before 2026-11-10   research file
FLOW           1 factory: orchestration, loop, caps        strong                       audit-control-flow
               2 intake: spec + design (coordinator)       weak → R-A                   research-spec-design
               3 design review                             none → R-A                   research-spec-design
               4 lanes + human gates                       good                         audit-control-flow
BUILD          5 implementer + PR creation                 weak → R-B                   research-build-test-rework
               6 testing (test-first, evidence, S1–S4)     weak → R-B                   research-build-test-rework
               7 cleanup                                   none → R-B                   research-build-test-rework
REVIEW         8 code review of the PR                     strong                       audit-review, compendium
               9 review fixes (rework rounds)              weak → R-B                   research-build-test-rework
RULES + ROLES 10 prompts, role cards, plugins              good                         audit-plugins-roles
              11 project knowledge                         good                         audit-memory
SAFETY        12 security: runner, egress, injection       strong                       audit-safety
              13 guardrails: human-only, push guards       good                         audit-safety, control-flow
IMPROVE       14 evals                                     good                         research-improvement-loop
              15 improvement loop, retro                   good                         research-improvement-loop
RUN           16 cost + model choice per role              weak → R-C                   research-models-measure-share
              17 measurement                               weak → R-C                   research-models-measure-share
              18 connectors: git host, front doors         good                         audit-connectors
              19 setup + sharing (R13)                     weak → R-C                   research-models-measure-share
```

Snapshots for R-A, R-B, R-C: agent-factory `c9e71a6`, skills `1e22921`. Since §11: srt built (#360), 29 golden cases
approved and 4 rejected (#356).

## 13. Question ①: is the DESIGN right? (all 19 capabilities, 2026-11-10)

Design only (DESIGN.md, ADRs, crq process and cards). Code status is §11. Each verdict has ≥2 primary sources in its
research file. "Prose → engine" means a rule the design states only as card or prompt text, which the research says to
enforce in code (root cause A).

| # | capability | keep · refine · change | what the research would change in the DESIGN | file |
|---|---|---|---|---|
| 1 | orchestration, loop, caps | 5 · 2 · 1 | stall time vs foreground commands; backoff jitter | audit-control-flow |
| 2 | spec + design | 9 · 4 · 1 | PD7 build deviation vs stale approval (V12, the one real gap); question cap per round; "should X when Y"; DESIGN:290 "AC form open" is stale | research-spec-design |
| 3 | design review | 4 · 2 · 0 | each slice names its AC-n, reviewer flags an AC with no slice; a one-screen approval digest | research-spec-design |
| 4 | lanes + human gates | keep | "may a human lower a raised lane?" undecided | audit-control-flow |
| 5 | PR creation | 2 · 1 · 0 | engine's re-run results in the PR body, beside the model's claim | research-build-test-rework |
| 6 | testing | 5 · 3 · 0 | prose → engine: F→P check for test-first, revert check (VB2), tests read-only (D7); new test passes k times | research-build-test-rework, audit-safety |
| 7 | cleanup | 1 · 2 · 0 | prose → engine: diff stays inside the branch's hunks; run covering tests | research-build-test-rework |
| 8 | code review | most keep | merge by meaning (D3); retire for noise not silence (D9); read human replies (G1); per-rule threshold (G3); size cap, skip generated files | audit-review, compendium |
| 9 | review fixes (rework) | 3 · 1 · 0 | a human reviewer's comment may become an Act on item (closes G1; GUIDE excludes it on purpose) | research-build-test-rework |
| 10 | prompts, role cards, plugins | 6 · 3 · 2 | card fields as machine values (D9); conflicts not by list order (D5); Copilot repo-skill override (D11) | audit-plugins-roles |
| 11 | project knowledge | 4 · 3 · 1 | P3 two stores (M1); brief only non-inferable facts; lessons expire; spec copied at approval | audit-memory |
| 12 | security | 2 · 4 · 1 | egress by content, not host name (D2); srt defaults; laptop OS layer | audit-safety |
| 13 | guardrails | keep | principle C1 (no run holds all 3 legs) and C2 (prose is not a guardrail) not adopted | audit-safety |
| 14 | evals | keep | held-out slice; judge and cases never change in a lesson PR | research-improvement-loop |
| 15 | improvement loop | refine | retro + golden case per lesson + eval gate + expiry (RT8–RT10) | research-improvement-loop |
| 16 | model choice + cost | 4 · 4 · 1 | models: allow-list class, not preference (M2); pin the implementer's model, record the model id; effort per role; default caps on | research-models-measure-share |
| 17 | measurement | 5 · 4 · 0 | fix minutes from git-host data, never self-report; add escaped defects; one "why" question per ticket; pilot targets with counts | research-models-measure-share |
| 18 | connectors | 9 · 1 · 2 | inbound front door is not a describe/call connector (P1); MCP bridge pinning (P4) | audit-connectors |
| 19 | setup + sharing | 5 · 1 · 2 | plugin pins in the team layer as a locked key (S4); one setup path ending in a check (S5); stable/early channels | research-models-measure-share |

Counts: rows 2 and 3 split R-A's 13 · 6 · 1 between the two capabilities by hand; rows 4, 8, 13, 14, 15 give no
count because their files do not grade them one by one.

**Overall:** the design shape holds in every capability. Ahead of industry: approval bound to hashes, design review
required per lane, one-way-door pre-mortem, rules never from the branch, execution decides "done". Most refines are one
pattern: a rule written as prose that the research says to enforce in code (A). The changes cluster in safety (12),
plugins (10), sharing (19), models (16), state (11).

## 9. Open questions

1. Where was "v1: a human runs the loop, no cron" decided? Now: #305 / PR #311.
2. Confirm R13, R14 wording.
3. Adopt C1, C2?
4. ~~Research: how others run the improvement loop (R14).~~ Done: §7. Decide: adopt the proposed loop?
5. Apply Matt's 5 questions to each task.
6. Ledger (#62): rulebook references not pointed at (code/modern-java, code/security, testing/unit-tests) — on purpose?
7. Compare our reviewer with the Claude Code code-review plugin on the golden set (map #175).

## 10. How the pieces work (walkthrough, before #311)

```
setup: install · identity · box login · image · egress · settings · plugin add · onboarder
① start ② coordinator: spec (+design) ③ design review ④ approve (not tiny)
⑤ dispatch pass (trigger: #311) ⑥ writer run → report.json ⑦ ready check (evidence rows, S1–S4, lane)
⑧ review find ▶ verify ▶ act_on → ⑥ (3 rounds) ⑨ gate → ping ⑩ human reviews architecture, merges
```

The reviewer has two axes (`prompts/review-find.md`): standards (rules) and spec (ACs and design drift). Rules reach it
from §4 always (crq review-process, code-review, verify-done, code/smells) and §3 only by AGENTS.md pointer. Ledger: 8
of ~60 rulebook references; aruvii: its own `.claude/rules`. Architecture not written as a rule or ADR: only the human
catches it.
