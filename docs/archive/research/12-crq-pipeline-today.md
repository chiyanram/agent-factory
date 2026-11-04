# 12 — The /crq pipeline as it runs today: stages, issues, users (2026-10-18)

Ticket: chiyanram/agent-factory#10 (parent #1). Read-only. Sources: agent-platform `origin/master` @ `e3c9f7ff`
(`.claude/commands/crq.md` 464 lines, `dod.md`, `.claude/agents/*`, rubric skills, `AGENTS.md`), `glab mr view --comments`
for !227 !249 !253 !256 !257 !258 !259 !261 !262 !266 !267 !268 !270, branch heads of the REQ stack; chiyanram/skills
#15 #16 #30 #35 #61 #87, `review/crq-stages.html`, `research/01` `02` `04`; agent-fleet `main` @ `8738986`;
agent-factory `research/03` `04` `10`. Note: on master `/crq` is a **command** (`.claude/commands/crq.md`), not a skill;
`.claude/skills/crq/` exists only in the unpushed #643 WIP `71b5deb4`.

## 1 · The pipeline as it runs today

| stage | what happens | who does it | artefacts | gate | typical time / tokens |
|---|---|---|---|---|---|
| 0 sweep | `scripts/cleanup-finished-work.sh` (`aruvii-cleanup`), report then `--apply` | laptop: operator's session · fleet: whichever agent starts | clean tree | none ("not a place to stop") | seconds |
| 1 anchor | `glab issue view`; restate ask; check for existing REQ | laptop session · fleet: analyst | — | no issue → `/issue` first | minutes |
| 2 grill | `mattpocock-skills:grilling` + `domain-modeling`, one question at a time; outcome posted on the issue (📌 notes); label `wayfinder:grilling` | analyst (fleet) or laptop session asks; **operator answers** (Kanagaraj too on #660), mostly in Discord threads / session chat | issue comment, ADR, glossary | HUMAN: shared understanding | hours–days (#660: H1–H14, G1–G10, F1–F11 over 10-03) |
| 3 spec | REQ-`<issue>` for new behaviour / amend REQ for bug / ACs in issue for chore | analyst | `docs/spec/REQ-NNN-*.md` (565–1,115 lines in the current stack) | none (spec-review skill desc still says "stage 3") | one session |
| 4 UI design | wireframe in `.claude/wireframes/`, only if UI | analyst | HTML mockup (e.g. `session-access.html`, !249) | skip line if backend-only | — |
| 5 draft MR + refine | `glab mr create --draft`, `Closes #NNN`; `spec-design-reviewer` ‖ `architecture-reviewer` (all but F-01); fix-or-argue in thread; loop | analyst opens + runs arch-reviewer subagent; **Aruvi Spec Reviewer** agent posts spec-review notes; operator/Kanagaraj answer | draft MR, review notes with SHA, revised REQ | HUMAN: literal `/approved` naming the SHA; material change → fresh `/approved` | 2 min–7 days to token; arch run 130–180k peak ctx (fleet), $1.92 / 1.76M billed (laptop, R4); spec run $2.85 / 1.43M |
| 6 implement | seams posted on MR, confirmed by human; TDD; `make test-module`/`verify-module` | Aruvi Agent Developer (fleet) · operator session (laptop: !258 slices 1–3) | commits on same branch | precondition `/approved` on thread | hours; !258 = 406 files, +14,884/−4,905 |
| 6a deslop | `deslop` skill over merge-base diff; `verify-module` per module; red → revert | developer | one commit or "nothing to clean" line | module green | minutes + module build |
| 7 self-review | `/code-review`: `code-standards-reviewer` (86 criteria) ‖ `architecture-reviewer` (group A + F-01 vs approved SHA); `smoke-spec-reviewer` if smoke touched | laptop: subagents of the session · fleet: aruvii-qa agent posts "QA review · round N" | MR findings note | fix or argue down in thread | std $1.95 / 2.23M billed; arch $1.92 (R4 §1); #540 stage 7 = 128k |
| 8 verify | `/dod` checklist + §Done means (`make verify-full` at head, `deployed:` stamp) + cite every AC at `file:line` both ways | fleet: developer submits `fleet-verify`, posts ✅/❌; qa cites ACs · laptop: session runs make | Verifier result note with SHA + duration; AC table | green at MR head; every AC cited | Verifier ~1h00–1h09 per run, one slot, full rerun only |
| 9 undraft | refresh description, re-read title, `glab mr update --ready`; stop | developer / laptop session; **human merges** | ready MR | HUMAN: merge (master protected, 403 for agents) | waits on operator |
| 10 sweep | cleanup once, never poll | same | — | none | seconds |

Not in crq.md but running: a Discord layer (old fleet: `create-agent.sh` agents with `--channels plugin:discord`), the
Verifier (`agent-fleet/verifier/fleet-verify`, ADR 0002), `fleet-guard.py` content rules, and spec-only "map" MRs (!253).

## 2 · Issues (every one found, with evidence)

| # | issue | stage | evidence | cost | category |
|---|---|---|---|---|---|
| 1 | Specs stacked on unmerged specs: ADR-0017 !227 (draft) ← REQ-660 !253 ← REQ-666 !258 / REQ-531 !261 ← REQ-211 !266; !267 and !262 target branch `docs/660-hitl-approvals`, not master | 5 | REQ-211:8–11 "Depends on: REQ-666 (!258) · REQ-531 (!261) · REQ-660 (!253) · ADR-0017 (!227)"; !253 desc "Merge order: ADR-0017 (!227) is still a draft" | every amendment ripples across 4–6 MRs | spec stacking & re-approval |
| 2 | crq has no spec-only / map MR mode: !253 is "Relates to #660 … Stories #611 #533 … build it", undrafted, spec only — crq stage 5 assumes one issue → one MR that grows the code and opens with `Closes` | 5 | !253 desc line 1; crq.md stage 5 | approved spec cannot merge; dependents stack (#1) | spec stacking & re-approval |
| 3 | !253 approval given 5 times and still open: Kanagaraj `/approved` 10-15 01:58 + 02:41 (`fcb95f1d`), ram 10-17 05:08 (`43024447`), relayed 07:27 (`171dbc66`), ram 09:29 | 5 | !253 notes 4016979259, 4017153256, 4034011545, 4034232381, 4034425886 | 5 human round-trips + 5 spec re-checks | spec stacking & re-approval |
| 4 | REQ-531 re-opened 3× after `/approved` at `8d1bfe3e`, each for a line another spec owed it (from !258 Z2/Y1; doc-delta `8b4c5a72`; REQ-211 F9 `32d58191`) | 5 | !261 notes 10:37, 13:27, 13:42 (2026-10-17); research/10 Q1 | analyst + spec-reviewer + human per edit | spec stacking & re-approval |
| 5 | ADR-0017 approved by Kanagaraj at `086077f0` (10-15 04:57); ram's design edit `b35d30aa` (10-17) needed a fresh `/approved` | 5 | !227 notes 10-15 04:57 (drop2kanagaraj), 4034413158, 4034425840 | 2-day-old approval void | spec stacking & re-approval |
| 6 | "Materially" undefined: doc-only/wording edits still re-enter the approval loop | 5 | crq.md stage 5 "If you later change the spec or design materially…"; !261 13:27 "Doc-delta edit, no behaviour change"; research/10 Q7 (analyst, spec reviewer, qa all name it) | re-approval for no behaviour change | spec stacking & re-approval |
| 7 | Approved spec corrected during build, approvals given in session chat and recorded afterwards: 8 "session chat" notes on !258 (05:27 `ck_runs_direct`, 05:45 relayed `/approved` at `5c253c40`, 06:23, 06:32, 07:32, 07:49) | 6 | !258 notes | approval trail lives in a chat the MR cannot show | spec stacking & re-approval |
| 8 | Long REQs re-read whole for one-line deltas: REQ-666 1,115 lines, REQ-660 1,064 (on `docs/692-scoped-grant`), REQ-531 798, REQ-211 565 | 3/5 | `git show origin/<branch>:docs/spec/…  \| wc -l`; research/10 Q6 | reviewer tokens scale with REQ length | review cost/noise |
| 9 | architecture-reviewer ~130–180k peak ctx per run, 6 runs/day | 5/7 | research/10 Q6 (analyst); R4 §6 fleet 167k vs laptop 133k | ~$2/run laptop, ~$4–5 per fleet round | review cost/noise |
| 10 | Docs-only change reviewed at full price: #540, 12 doc files, 489,534 subagent tokens over two stage-5 passes at 14/21 and 13/23 N/A | 5 | `architecture-review/SKILL.md:73`; `spec-review/SKILL.md:61` | rule 4 "cheap tier" added after the fact | review cost/noise |
| 11 | Stage-7 review walked all 29 criteria because the narrowing rule had never been run — 128k tokens | 7 | crq.md stage 6 ("#540 … a 128k-token review") | 128k for one false claim | review cost/noise |
| 12 | Output/thinking is 62–66% of reviewer dollars; driven by criteria walked (standards 86, arch 30, spec 24 `###` criteria) | 5/7 | R4 §3, §5; `grep -c '^### [A-Z]+-[0-9]+'` | biggest cost lever | review cost/noise |
| 13 | Rubric preloaded then re-read in 39/57 runs, from the **main checkout** path — can read a different rubric than preloaded | 5/7 | R4 §4 | ≤4% $, plus version skew | review cost/noise |
| 14 | One-note-per-commit re-check storm: !267 8 spec notes 13:43–13:55; !258 18 spec-reviewer notes; !261 9; !267 total 7 spec + 4 architecture rounds | 5 | note timelines; research/10 Q4 | thread unreadable; each note a full context load | review cost/noise |
| 15 | "Aligned" verdict invalidated by head moves: "This supersedes my 'aligned' at `4eea0bbc`", again at `7d39757b`, `83d6b075` | 5 | !253 notes 10-03 16:10, 16:13, 10-04 23:49 | re-review per push | review cost/noise |
| 16 | Most expensive reviewer per run is spec-design-reviewer ($2.85, Opus 5); preload 33–41% of tokens | 5 | R4 §1, §3 | — | review cost/noise |
| 17 | crq.md says grilling/domain-modeling are "vendored into `.claude/skills/`"; README (#587) says third-party skills are **never copied**, served by plugin; crq Notes says wayfinder "not vendored, install from upstream" yet README lists it in the plugin; crq "no hard dependency on any externally-installed skill" is false since #587 | 2 | crq.md stage 2 + Notes; `.claude/skills/README.md` §"The rule that replaced vendoring"; `git ls-tree origin/master .claude/skills/` (no grilling dir); 55a5bc9b touched crq.md in #587 without fixing it | fresh clone misled | instruction conflicts |
| 18 | When spec review runs: crq stage 5 "spec-design-reviewer here and nowhere else" vs `spec-review/SKILL.md:3` + agent description "at /crq stage 3 when a spec is written, and again before /approved" | 3/5 | files cited | extra runs | instruction conflicts |
| 19 | "Never answer your own questions" (crq stage 2; arch-review rule 3) vs global CLAUDE.md "small or reversible → pick default" and #35 "a reversible question: take the default"; reviewers flagged picked defaults as unrecorded decisions (!266 F8, !267 F8); now marked ⟡ (REQ-211:19, five) | 2/5 | research/10 Q3 | findings on the agent's own defaults | instruction conflicts |
| 20 | dod.md allows decrypt "inside `ToolHandler.execute()` (for tools) or `SetupService`" vs AGENTS.md "Decrypt only inside `ToolHandler.execute()`"; dod hard-codes `make verify-module MOD=aruvii-api` whatever the change | 8 | dod.md §Security, §Test Coverage | wrong module gated | instruction conflicts |
| 21 | Fleet: "@here when blocked" vs 10-17 "tag the owner"; global Co-Authored-By vs repo "no AI trailers" | all | research/10 Q3 (all four); skills #61 row 10 | agents pick one silently | instruction conflicts |
| 22 | Guard blocks any `glab … note` whose text contains `/approved`, incl. "waiting for /approved from ram" | 5 | `agent-fleet/enforcement/test_fleet_guard.py:18,76`; research/10 Q3 (qa) | agents cannot state gate status on the MR | instruction conflicts |
| 23 | Personas say "`/crq` exists in this repo as a tool, not a process you're built on top of" — the opposite of G2's one process text | all | `docs/agents/personas/{analyst,developer,spec-reviewer}.md:13–15` | two process texts | role confusion |
| 24 | Verifier: ~1h05 per run, one slot, full rerun only, no test filter: !249 ❌ 1h09m37 → ✅ 1h05m34; !256 1h04m42; !257 1h00m18 | 8 | developer-agent notes on those MRs | ≥1 h per head | gate wait |
| 25 | Flake with no cause: !259 ❌ 1h08m23 (smoke-63 K03c) → ✅ same SHA `69270929` 1h04m42; 05:50 → 10:29 (~4h40m); no worker log kept | 8 | !259 notes; research/10 Q4/Q5 (qa, developer) | ~5 h on one fix | gate wait |
| 26 | Human approval latency is unbounded: !253 aligned 10-08 05:39 → `/approved` 10-15 01:58 (~6.8 d); !249 ready 10-02 17:19 → 10-03 02:32 (~9 h); !258 ready 05:03 → 05:05 | 5 | note timestamps | idle stack | gate wait |
| 27 | No CI: "There is no CI" (AGENTS.md); runner pipeline !263 (#671) draft, runner not registered, pipeline 2958342482 pending | 8 | AGENTS.md §relying on a green build; research/04 A row !263 | the only gate is the 1-h Verifier or a laptop | gate wait |
| 28 | §Done means not applied to small fixes: !268 (#714) and !270 (#715) merged 10-17 with "`make verify-full` not run — still owed for §Done means"; no grill/REQ/`/approved` notes on either (0 comments) | 8/9 | !268 §Evidence; !270 desc line 31 | rule says one thing, merges do another; no quick lane to make it legal | other |
| 29 | No single place for each REQ's head, approved-at SHA, merged state, deltas it owes others — rebuilt from 4–5 worktrees, `git fetch` + diff by SHA each time | 5 | research/10 Q5 (analyst, spec reviewer) | minutes per delta, errors | state visibility |
| 30 | MR head ↔ Verifier result ↔ review round not in one place; `glab mr view --comments` ~1,900 lines to find round/head/verdict | 7/8 | skills #61 row 13; research/10 Q5 (qa); !253 = 35 notes, !258 = 40 | reader cost | state visibility |
| 31 | 35 open MRs incl. spec-only drafts !49–!98 (last commit 2026-09-05) and !175–!179 (09-19/20) never closed | 5 | `glab mr list`; branch `git log -1` | stale "pending" specs | state visibility |
| 32 | MR type drift: !258 titled `docs(spec)` carries 406 files, +14,884/−4,905 across 12 modules; only the stage-9 title re-read guards it | 6/9 | `git diff --stat origin/master...origin/docs/666-runs-table` | wrong squash subject on master if missed (cf. `80f3bb4d`) | state visibility |
| 33 | Decisions made off-forge: "Q1–Q7 (ram, Discord thread '#531 turn journal')", "#660 Discord thread"; the MR carries only what an agent chose to record | 2/5 | !261 desc; !253 desc; crq.md stage 5 step 2 | invisible to a fresh reader | handoff |
| 34 | Hand-offs are free-text comments: "Handover to QA … Developer is stopped until QA reports" (!256); handover named only part of the ACs (#622) | 6→7 | !249, !256 notes; skills #61 row 8 | missed ACs | handoff |
| 35 | Laptop operator posts every role under one account: spec reviews (!249 10-02, !253 10-03…10-08), QA reviews (!249, !256, !257), "Analyst review note" (!227), build notes (!258) all by `chiyanram` — same account as the `/approved` author | all | note authors | agent verdict indistinguishable from human approval | role confusion |
| 36 | Who may approve is undefined: crq "the human"; analyst persona "a human with the authority"; new `fleet-spawn:232–236` counts only `FLEET_OPERATOR_LOGIN` — Kanagaraj's `/approved` would be "named and not counted" | 5 | files cited; !253/!227 approvals by `drop2kanagaraj` | second approver's work may not unlock stage 6 | role confusion |
| 37 | Two approvers, no rule for coverage: "The earlier `/approved` by @drop2kanagaraj at `fcb95f1d` does not cover `8db3f554..43024447`"; F-01 at stage 7 must pick one approval SHA among several | 5/7 | !253 note 4034015149; crq.md stage 5 "The commit you record matters" | ambiguity at F-01 | role confusion |
| 38 | Stage-5 architecture review run by the analyst (author) in its own session, not a fresh read-only context | 5 | !258 04:30 "ran as the architecture-reviewer subagent"; !227 analyst "Full architecture review" | author reviews own design (G2 Q4 independence) | role confusion |
| 39 | Old decisions never reached crq.md: last edit 2026-10-02 (`55a5bc9b`); G2/G3/G8/#35 closed 10-01..10-03; build ticket #645 has nothing | all | `git log -- .claude/commands/crq.md`; research/04 §A #645 | fleet and laptop run a text the map replaced | other |
| 40 | Hard-coded compose ports (#318) — a second stack (fleet port block 20200) cannot run; developer asked operator for a one-run go on default ports | 8 | research/10 Q5 (developer), Q4 (qa) | serialised on one stack | other |
| 41 | Master key lives in the checkout; #670 (!269) approved at `3de911c5`, branch 0 commits | 8 | research/04 §A !269 | fresh clone / worktree risk | other |

Counts: spec stacking & re-approval 7 · review cost/noise 9 · instruction conflicts 6 · gate wait 4 · state visibility 4 ·
handoff 2 · role confusion 5 · other 4 = **41**.

## 3 · How each kind of user runs /crq today

| | operator, by hand on laptop | 4 fleet agents (old fleet, Discord) | second human approver (Kanagaraj) | teammate, fresh clone |
|---|---|---|---|---|
| who runs stages | one Claude Code session plays analyst → reviewer → developer → qa; subagents for reviews | analyst 1–5 (+ arch-reviewer subagent), spec reviewer 5, developer 6/6a/8-submit/9, qa 7/8 | none; answers grill questions, reviews, approves | one session, all roles, like the operator |
| process text read | `.claude/commands/crq.md` | role persona says crq is "a tool, not a process" (#23); `worker-rules` say project rules win | MR thread + Discord | crq.md (with the stale vendoring claim #17) |
| where decisions live | session chat → "approved by ram in the session chat" notes (!258 ×8) | Discord threads → 📌 notes on issue | Discord `#660` thread: "Kanagaraj's F8 = B", "F-21 = B", "227 review B", "Key A" (!253, !227 notes) | only what reached GitLab; Discord not visible |
| stage-5 review | subagents in same context family; posted under `chiyanram` | spec reviewer agent posts per-commit notes (#14); analyst runs arch-reviewer | named reviewer on !253 (`reviewers: drop2kanagaraj`) | same agents, Opus, ~$2–3/run |
| `/approved` | ram posts, or relays from session ("Recording `/approved` relayed by @chiyanram in a Claude Code session", !253 07:27, !262 09:33) | never; guard blocks even mentioning it (#22) | posts on !253 (×2) and !227; later superseded by ram's edits (#3, #5) | crq lets any human approve; new fleet would not count it (#36) |
| gate (stage 8) | `make verify-module` on laptop; `verify-full` often "still owed" (!268, !270) | `fleet-verify submit`, ~1 h, one slot, rerun on flake (#24, #25) | not involved | `make verify-full` on own laptop; no Verifier (fleet-only), no CI (#27) |
| merge | ram | never (403) | not seen merging in the sample | needs Maintainer; master protected |
| what is missing for them | a quick lane that makes small fixes legal (#28) | REQ/approval/Verifier state in one place (#29, #30), cross-REQ tracker | rule on whose approval covers which SHA (#37); approval recognised by fleet (#36) | Discord history; the REQ stack exists only on unmerged branches (REQ-660/666/531/211 not on master); `cz` required by `.husky/commit-msg`; `make secrets` + shared Compose stack (last deploy wins); `mattpocock-skills` marketplace install |

What works on a fresh clone: crq.md, `/dod`, the four agents + rubric skills, hooks (`.claude/settings.json` PreToolUse/
PostToolUse), the glab write allow-list (!216), `enabledPlugins` for `mattpocock-skills@claude-plugins-official`, `make doctor`.

Where they differ: the laptop collapses all roles into one identity (#35) and decides in chat; the fleet splits roles
but hand-offs are free text (#34) and gate is a 1-h queue; Kanagaraj's approvals are real on GitLab but have no defined
standing (#36, #37); the teammate gets the text but none of the off-forge state or the Verifier.

## 4 · What the old map decided for /crq but never landed

| decision (chiyanram/skills) | decided | current file says | landed? |
|---|---|---|---|
| G2 #15 Q1/Q2: one process text, stages tagged by role label; Roles table in agent-platform glossary | 2026-10-01 | crq.md has no role tags; `docs/CONTEXT.md` has no Roles table; personas still "a tool, not a process" | no |
| G2 Q3: GitLab comment is the record, Discord only pings | 10-01 | decisions still made in Discord/session chat, recorded after (#7, #33) | partly (by habit) |
| G2 Q4: qa always in a fresh read-only context | 10-01 | stage-5 arch review run by the analyst (#38); laptop runs qa as subagent of the authoring session | partly |
| G8 #30: lanes quick/standard/full by type × size, floor (migration/security/API/dependency), `skip: <reason>` | 10-01 | crq.md "Never skip a stage"; no lanes; !268/!270 skip silently | no |
| G3 #16: one reviewer, two verdicts (Standards ‖ Spec), packets pushed in, references by changed path, ≤3 rounds, rounds 2–3 fix diff only; delete `standards-review` (86 criteria), arch-reviewer at stage 7, `spec-design-reviewer`, stage-8 AC pass | 10-01 | 4 rubric agents; standards 86 criteria; arch at 5 and 7; spec-design at 5; stage-8 AC pass in crq.md; unlimited rounds (!267: 7 + 4) | no |
| G17 #87: drop "Act on ≤5" cap, keep four buckets | 10-16 | buckets never built; #645 body still says "≤5" (research/04) | no (moot) |
| #35 ND-5: delete `/dod`; checklist → references' Review checks | 10-03 | `.claude/commands/dod.md` present, invoked at stage 8 | no |
| #35 Q23: roles per stage incl. new **coordinator** label for 0/10, retro worker at 10 | 10-03 | stages 0/10 run by whoever starts; no `/retro` stage | no |
| #35 approved stage text (`review/crq-stages.html`, 12 stages): rebase onto origin/master at spawn / before verify / done; `post-status` needs-decision·blocked·done; `visual-pr`; runner pipeline at head SHA; reversible question → take default | 10-03 | none in crq.md; runner pipeline !263 draft, unregistered; `post-status` not in worker image (research/03) | no |
| G23 #93: generic crq lives in skills plugin, AP keeps `docs/agents/crq.md` | 10-17 | plugin PR #107 has zero content; #643 WIP moves crq into AP `.agents/skills/` (contradicts) | no |

Build ticket for all of section 4: agent-platform #645 — nothing implemented (research/04 §A).
