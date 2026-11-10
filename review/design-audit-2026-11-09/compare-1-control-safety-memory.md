# Compare 1 · control flow, safety, memory, principles (checker 1 of 3)

Checked against:
- agent-factory `fa354ef` (main, after #313). PR #336 (#335, PR body as cleaned Markdown) is open and not checked.
- chiyanram/skills `3d63201`.

Path keys: `af:` is agent-factory. `crq/` is skills `plugins/rulebook/skills/crq/`. `ev/` is skills `plugins/rulebook/evals/`.
Scope: every verdict in audit-control-flow.md (CF), audit-safety.md (SAF), audit-memory.md (MEM); README P1–P9, R1,
R4–R10, C1, C3; HumanLayer factors 5, 6, 8, 12 (12F).

| id | finding | agent-factory evidence | skills evidence | status now | note |
|---|---|---|---|---|---|
| CF#1 | P1: code decides every routine step | `af:src/core/dispatch/table.ts:1-3`, `decide` at :603 (pure) | `crq/process/glossary.md:10` engine is "never the model" | holds | Decision table is pure; the model decides only inside a run. |
| CF#2 | P2 fresh; refine: name the hand-off as one record | `af:src/core/writer/task.ts:1-7` (.factory/task.md, #171 #193); `af:src/core/writer/step.ts:128-138` spec.md every run | `crq/process/roles/implementer.md:4-6` input and hand_off named | partly fixed; research partly wrong | task.md existed before the research. Rework run gets no previous report.json; one hand-off per kind, not one record. |
| CF#3 | P7 caps per run, ticket, project-day; state the overshoot | `af:src/core/dispatch/caps.ts:4-24`; `table.ts:137-141` round caps; DESIGN.md:92 | `crq/references/review-process.md:25` RV9 three rounds | holds (built #294, #300) | Overshoot is said in caps.ts:23 and DESIGN.md:92, not in the usage notice. |
| CF#4 | P8: nothing starts unless a human starts it | `af:src/core/start.ts:1-14`; `af:src/core/dispatch/orchestrator-loop.ts:1-9` (#311, no cron) | `crq/process/glossary.md:28` START; `crq/process/lanes.json:5` | holds; strengthened by #311 | Only the terminal door is built (ADR-0012:30 **Today:**). |
| CF#5 | Approval by lane, bound to hashes, stale on edit | `af:src/core/approval.ts:242-245` stale check; `af:src/core/human-record.ts:13` vias | `crq/process/glossary.md:30`; `crq/references/lanes.md:14` LN4 | holds | "A team may name its approvers": no `approvers` key found (grep src). |
| CF#6 | Lane by code, raise only | `af:src/core/lane.ts:1-12`, `heavier` :163, `plannedRaise` :179 | `crq/process/lanes.json:3`; `crq/references/lanes.md:8` LN1 no longer says "either way" | holds | Open question "may a human lower a code raise?" is answered nowhere. |
| CF#7 | Stall 5 min kills a silent 10-min Bash test run | `af:src/core/writer/run.ts:47` STALL_MS; `af:src/core/writer/settings.ts:46-58` lower only; BASH_MAX_TIMEOUT_MS: grep src, images, scripts: none | none (grep stall, timeout, foreground in crq/) | gap | Worse: `af:src/core/writer/step.ts:106-107` tells every command to run in the foreground. |
| CF#8 | Backoff: add jitter; say it is for steps, not model API | `af:src/core/dispatch/records.ts:80-86` no jitter; DESIGN.md:95 silent on API layer | n/a — engine only | gap | grep jitter/random in dispatch: none. |
| SAF-D1 | Runners: srt read-open, srt silent start, Sysbox shared kernel | `af:src/core/box/choose.ts:24-26` laptop refused, no srt (grep srt: none); `choose.ts:19` names Sysbox risk | n/a — engine only | partly fixed; research partly wrong | Sysbox risk already printed at setup (#145). srt items wait for the laptop runner. |
| SAF-D2 | Egress: allowed hosts accept uploads; check content | `af:src/core/egress/squid.ts:3-5, 19-25` CONNECT by host only, TLS never opened | n/a — engine only | gap | `choose.ts:20` already warns "can still carry data out"; ADR-0012 S6 does not. |
| SAF-D3 | P4: no model holds a git host login | `af:src/core/token/rules.ts:88-92` box gets only the model token; `af:src/core/egress/allowlist.ts:8,17` git host refused | n/a — engine only | holds | Forge seam has no merge or approve method (`af:src/core/forge/types.ts:105-138`). |
| SAF-D4 | P5: the judge never comes from the change | `af:src/core/review/rules.ts:1`; `af:src/core/writer/clone.ts:12-14`, `agent-settings.ts:11`; `af:src/core/writer/run.ts:107-108`; `af:src/core/plugin/pin.ts:1-5` | n/a — engine only (grep "default branch", pinned in crq/: none) | holds | Nested `git init` in the box: not verified. |
| SAF-D5 | P6 locked; add "requester is not the only merger" | `af:src/core/review/never.ts:6-14` floor (#302); `af:src/core/review/round.ts:747` | `crq/process/glossary.md:57` finder never approves | partly fixed | Never-approve is locked. Requester rule: grep requester in both repos: none. |
| SAF-D6 | Laptop deny list; add OS sandbox, denyWrite, /dev/tty | `af:src/core/coordinator.ts:195,290` bypass disabled and checked (#172); grep denyWrite, allowUnsandboxed, /dev/tty: none | n/a — engine only | partly fixed; research partly wrong | disableBypassPermissionsMode existed before the research. Sandbox layer and tty confirm missing. |
| SAF-D7 | Test checks: add prevention, tests read-only | `af:src/core/ready/floor.ts:1-28` detection S1–S4; `af:src/core/writer/clone.ts:57,167` read-only = settings and .git only | `crq/process/roles/implementer.md:8` "no edit to judge files" (prose); `crq/references/verify-done.md:19` VB6; `ev/implementer/test-cannot-pass` | gap | Detection built (#252); prevention by mount not built. |
| MEM-M1 | P3 false: START, approval, spec on one host | `af:src/core/start.ts:6`, `approval.ts` local files; `af:src/core/dispatch/shared.ts:1-7` copy only on the PR | `crq/process/glossary.md:22,35` project home, spec home | gap | Spec is local only today (see missed item 2). |
| MEM-M2 | Repo map at run time, never stored | none in src (grep "repo map", repomap); only `af:prompts/roles/onboarder.md:21`, DESIGN.md:171 | `crq/process/roles/onboarder.md:25` | holds (design only) | No run-time repo map is built yet. |
| MEM-M3 | Glossary with avoid words, plus decision records | `af:src/core/onboard/brief.ts:145` `_Avoid_:`; `answer.ts:16` | `crq/process/roles/onboarder.md:27-28`; `ev/onboarder/existing-glossary-linked` | holds (built #314) | — |
| MEM-M4 | Brief: re-run commands, no overview, measure it | `af:src/core/onboard/cites.ts:1-4` re-checks cites, not commands; `af:prompts/roles/onboarder.md:20-21` stack and modules | `crq/process/roles/onboarder.md:3` brief refresh step, :17-18 modules | gap | Refresh exists as a step. No command re-run; no with/without measure (grep: none). |
| MEM-M5 | Lessons: add expiry and re-validation | none (grep lesson, timeline, retro run in src: only comments) | `crq/references/retro.md:9-21` RT1–RT7, no expiry (grep expir: none) | gap | Engine has no timeline record or retro run yet. |
| MEM-M6 | Link, never copy; re-check every file:line each run | `af:src/core/onboard/cites.ts:1-4`; `af:src/core/writer/step.ts:400` stale cites to run record; `brief.ts:5` linked | `crq/process/roles/onboarder.md:21,31` | holds (built #314) | Covers the brief only; no lessons exist to re-check. |
| MEM-M7 | P9: nothing committed by default; name an opt-in store | `af:src/core/settings/keys.ts:208-230` work, repoCommits; `af:src/core/settings/resolve.ts:341-347` refused at work | `crq/process/roles/onboarder.md:8` "unless the project opts in" | holds | repoCommits has no consumer. No memory branch store (grep: none). |
| MEM-M8 | Spec home: copy spec to tracker before another machine builds | `af:src/core/spec.ts:49-53` issue store typed; `af:src/core/approval.ts:102` local only | `crq/process/glossary.md:35` | gap | Issue store is not wired to any caller. |
| P1 | The engine decides every routine step | as CF#1 | as CF#1 | holds | — |
| P2 | Every run fresh, never resumed | grep --resume, --continue, session-id in src: none; `af:src/core/writer/clone.ts:1-6` new clone per run | `crq/process/glossary.md:14-15` run, runner | holds | — |
| P3 | Tracker and git host are the memory | as MEM-M1; `af:src/core/dispatch/table.ts:18,167` dead run → needs-human | — | gap | Same-host restart is fine; host loss loses specs and approvals. |
| P4 | No model holds a git host login | as SAF-D3 | n/a — engine only | holds | — |
| P5 | Judge never from the change | as SAF-D4 | `crq/process/lanes.json:3-4` | holds | — |
| P6 | AI never approves; zero findings not a pass | `af:src/core/review/never.ts:13`; `af:src/core/review/status.ts:7` | `crq/process/glossary.md:30,57` | holds | — |
| P7 | Every loop has a cap and a stop | as CF#3; `af:src/core/dispatch/orchestrator-loop.ts:22-23,47` | `crq/references/review-process.md:25` | holds | — |
| P8 | A human starts everything | as CF#4 | `crq/references/retro.md:21` RT7 | holds | — |
| P9 | Nothing committed to the product repo by default | as MEM-M7 | as MEM-M7 | holds | — |
| R1 | A started ticket becomes a draft PR unattended | `af:src/core/forge/github.ts:362` draft: true; `af:src/core/forge/gitlab.ts:367-377` Draft: | `crq/SKILL.md:35-36` PR by implementer, human merges | holds | — |
| R4 | A question and its answer go into the spec | `af:src/core/report.ts:110` one round (#325); `af:src/core/writer/settings.ts:60-67` | `crq/process/roles/coordinator.md:60`; `crq/process/glossary.md:36` | partly fixed | Round built (#325). "Answer into spec" is a card rule; no engine check. |
| R5 | Never start without a human, never approve, never merge | `af:src/core/dispatch/table.ts:5-8`; `af:src/core/forge/types.ts:105-138` no merge, approve, undraft | `crq/process/glossary.md:52` | holds | — |
| R6 | No model login; change never judges itself | as SAF-D3, SAF-D4; Copilot only in `af:src/core/coordinator.ts` | n/a | holds | Writer is claude only (grep copilot in src), so the Copilot hole is not reachable yet. |
| R7 | Isolation, push guards, test checks, approval floor locked | `af:src/core/settings/keys.ts:200-206` approval.floor locked; `af:src/core/lane.ts:19-22`; `af:src/core/process/read.ts:9` | `crq/process/lanes.json:4` | holds; egress gap stays | See SAF-D2. |
| R8 | Every loop capped per run, ticket, project-day | `af:src/core/dispatch/caps.ts:4-11` | n/a | holds (built #294, #300) | — |
| R9 | A restart loses nothing | as MEM-M1, P3 | — | gap | Loop restarts from records on the same host (orchestrator-loop.ts:13-15). |
| R10 | Work and personal never mix; no specs in git at work | `af:src/core/settings/resolve.ts:341-347`; `~/.factory-work` only in DESIGN.md:192 | n/a | partly fixed | Separate work home is design only (grep factory-work in src: none). |
| C1 | No run holds private data, untrusted input and a way out | none in docs (grep "rule of two": none); `af:src/core/box/choose.ts:20-21` names two legs | none (grep rule of two, trifecta) | gap | Writer still holds all three legs (SAF-D2). |
| C3 | Prevent before you detect | prevention exists for CI and settings: `af:src/core/agent-settings.ts:1-5`; tests detect only (`floor.ts`) | `crq/references/retro.md:19` RT6 strongest level first | gap | Not adopted as a principle in DESIGN §2. |
| 12F-5 | Unify execution and business state | as MEM-M1 | — | gap | Same root as M1. |
| 12F-6 | Launch, pause, resume | `af:src/core/poll.ts:11,29` /stop; `af:src/core/dispatch/orchestrator-loop.ts:13-15` loop resumes from records | `crq/process/glossary.md:14` | changed | Ticket-level pause and resume is built (#311); run resume stays "no" (P2). |
| 12F-8 | Own your control flow | as CF#1 | as CF#1 | holds | — |
| 12F-12 | Agent as a stateless reducer | `af:src/core/dispatch/table.ts:603` decide(state) pure | n/a — engine only | holds | — |

## Things the research missed

1. The writer prompt tells every command to run in the foreground (`af:src/core/writer/step.ts:106-107`, #192). This
   makes CF#7 sure to hit a long test run.
2. The spec "issue" store is typed but never wired (`af:src/core/spec.ts:53`; every caller uses `localStore`,
   e.g. `af:src/core/approval.ts:102`). Today every spec is local to one host. This makes M1 and M8 worse.
3. A run whose dispatcher died goes to needs-human (`af:src/core/dispatch/table.ts:18,167`). A restart mid-run does
   lose the run's outcome. P3 and R9 should say so.
4. Setup already prints the egress and Sysbox risks (`af:src/core/box/choose.ts:17-21`, #145). D1 and D2 point 3 are
   half done in code, but ADR-0012 S6 does not say it.
5. `disableBypassPermissionsMode` is set and checked (`af:src/core/coordinator.ts:195,290`, #172). D6 proposed it as new.
6. A failed orchestrator pass retries at the fixed poll interval, 3 times (`af:src/core/dispatch/orchestrator-loop.ts:22-23,47`).
   No backoff or jitter there either (CF#8).
7. The engine ships its own default role cards (`af:prompts/roles/*.md`). Its onboarder still asks for stack and
   modules (`onboarder.md:20-21`), against M4 refine 2. The skills card does the same (`crq/process/roles/onboarder.md:25`).
8. The engine writes no timeline record and has no retro run (grep timeline in src: none). Skills RT1
   (`crq/references/retro.md:9`) assumes the engine writes it. M5 lessons have no path yet.
9. The writer runs with `--dangerously-skip-permissions` (`af:src/core/writer/run.ts:109`), allowed by
   `af:scripts/check-musts.ts` ALLOW "only in a box". The srt laptop runner must drop it (ADR-0012 S11).
10. The CF#6 open question is now unasked in skills too: LN1 (`crq/references/lanes.md:8`) dropped "change it either way".
