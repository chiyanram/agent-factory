# Changelog

What agent-factory ships, by version. semantic-release writes this file from the commit messages on `main`;
do not edit it by hand.

## [1.0.0](https://github.com/chiyanram/agent-factory/compare/v0.34.1...v1.0.0) (2026-11-17)

### ⚠️ Breaking changes

* **dispatch** — no. `Forge` gains a `waiting` read that every adapter
implements; the bundled plugins are rebuilt from `dist/`, and a
project's git host plugin built before it answers unsupported and shows
no waiting session.
Rollback: revert this PR; no data changes. The `waiting` record lines it
wrote stay in the run records, and an older engine skips that line kind
with a warning.
Where to look: `src/core/dispatch/waiting.ts` (`waitingStep`: once per
label time), `src/core/dispatch/board.ts` (`waitingLines` and
`withWaiting`: one line per ticket, merged only where tickets are
issues), `src/core/door/read.ts` (`doorBoard`: the one read model reads
the label once), `src/core/forge/github.ts` and `gitlab.ts` (`waiting`:
since when the label went on).

## Evidence at 92a8bb6

| criterion | command or test | result |
|---|---|---|
| AC-1 the label is defined, set and cleared by the session, with no new
write command | `docs/agents/triage-labels.md`, AGENTS.md MUST;
`test/waiting.test.ts` "WAITING_LABEL" | passed |
| AC-2 `Forge.waiting` returns open issues with the label and since
when, on both adapters and the plugin protocol; an older plugin reads
none | `test/forge-github.test.ts` "waiting",
`test/forge-gitlab.test.ts` "waiting", `test/forge-plugin.test.ts`
"carries the open issues that wait under a label" and "reads no waiting
issue from a plugin built before the waiting read" | passed |
| AC-3 `board` lists them under needs you, for how long, through the
door seam's one read model; a failed read is one line; a local ticket is
never taken for an issue | `test/board.test.ts` "the board's waiting
sessions" and "waitingLines", `test/board-cli.test.ts` "lists a ticket
whose session waits for the operator" and "ticketsAreIssues" | passed |
| AC-4 a pass records, then pings once per label; no ping when the
ticket's own turn is already needs you; a failed read is logged |
`test/dispatch-tick.test.ts` "a session that waits for the operator",
`test/waiting.test.ts` "waitingStep" | passed |
| AC-5 coordinator runs `board` first and opens with the waiting
sessions; briefs set and clear the label | `prompts/coordinator.md`,
`docs/reference/cli.md`, `docs/reference/orchestrator.md`; `make lint` |
passed |
| AC-6 the label is a session's claim; nothing decides on it | no table
or `decide` change; `make test` | passed |

## Change

- A `src/core/dispatch/waiting.ts`: the label, what the operator does
for a waiting session, the once-per-label step and the ping
- M `src/core/forge/types.ts`, `ops.ts`, `github.ts`, `gitlab.ts`,
`shared.ts`, `shapes.ts`, `plugin.ts`, `serve.ts`,
`src/core/eval/forge.ts`: the `waiting` read; `plugin.ts` reads an
unsupported answer as none
- M `src/core/door/read.ts`: `doorBoard` reads the label once and passes
it to `boardOf`, so every door gets waiting sessions as ordinary
needs-you `BoardLine`s with no second path (#713's shape);
`ticketsAreIssues`
- M `src/core/dispatch/board.ts`, `src/board-cli.ts`, `src/app.ts`: each
waiting session is a needs-you line, built with the same broken-row
shape as a ticket that cannot be read, and merged with a ticket in
flight only where the project keeps its specs in issues
- M `src/core/dispatch/records.ts`: the `waiting` line, not counted as
activity
- M `src/core/dispatch/tick.ts`: `waitingPinged` on each pass that is
not a dry run
- M `src/core/dispatch/usage.ts`: a ticket with only ping lines gets no
usage row
- M `AGENTS.md`, `prompts/coordinator.md`,
`docs/agents/triage-labels.md`, `docs/reference/cli.md`,
`docs/reference/orchestrator.md`
- A `test/waiting.test.ts`; M the forge, board, board-cli, tick and loop
tests, and each fake `Forge`

## Checklist

- [x] Lane: feature, because it adds a label rule, a new read on the
`Forge` seam, a new record line with a ping, and a coordinator prompt
change.
- [x] Tests: `test/waiting.test.ts` (new); `test/board.test.ts`,
`test/board-cli.test.ts`, `test/dispatch-tick.test.ts`,
`test/forge-github.test.ts`, `test/forge-gitlab.test.ts`,
`test/forge-plugin.test.ts` each add cases that fail without the change
(the local-ticket and older-plugin cases were written first and failed);
`test/dispatch-loop.test.ts` now counts the one extra call per pass.
- [x] Docs: `prompts/coordinator.md`, `docs/agents/triage-labels.md`,
`docs/reference/cli.md`, `docs/reference/orchestrator.md` (including
* **door** — yes. After upgrading, run `agent-factory setup
coordinator` once: the orchestrator refuses to start a pass while the
coordinator's settings lack the new `agent-factory door` deny rule. A
person who types `!agent-factory approve`, `start` or `waive` inside
Claude Code is now refused, and runs it from a plain terminal.
Rollback: revert this PR, then run `agent-factory setup coordinator`
again. No record changes: `VIAS` is unchanged, and the START, approval
and waiver files are written byte for byte as before.
Where to look: `src/core/door/write.ts` (the two refusals),
`src/core/door/person.ts` (only `vouch` makes a `Person`), and the
import scans at the end of `test/door.test.ts`.

## Evidence at 35eeeea89349eb49f4fced98b5ed4a58b93ece8f

| criterion | command or test | result |
|---|---|---|
| `startAs`, `approveAs` and `waiveAs` write the vouched person's `by`
and `via`, and the records equal today's | `test/door.test.ts` "startAs,
approveAs and waiveAs write the person's by and via, as the records have
them today"; "a request that carries its own by or via does not change
who the record names" | passed |
| a door cannot claim a person it did not verify: a same-shape clone or
a copy is refused by all three writes, and no file is written; `vouch`
refuses an empty name, a control character, a line separator, a
direction mark and an unknown door | `test/door.test.ts` "a door cannot
* **door** — run `agent-factory setup coordinator` once after
upgrading. The orchestrator refuses to start a pass while the
coordinator's settings lack the new `agent-factory door` deny rule.
* **dispatch** — no
Rollback: revert this PR. The `started` line's new `folder` field is
ignored by the older code (`startedOf` builds the event field by field),
so no record needs editing. Folders kept under
`$FACTORY_HOME/box-runs/writer-*` are removed by no code, old or new:
delete each one by hand once its work is taken.
Where to look: `src/core/left.ts` `keepLeft` (what is pushed, with which
lease); `src/core/writer/step.ts` `afterRun` and `runIn` (when the
folder is kept or removed); `src/core/dispatch/tick.ts` `begin` (the
folder is named before the run)

## Evidence at 06b676a

| criterion | command or test | result |
|---|---|---|
| a pass killed mid-run with a commit in the clone: the next pass's
needs-human note names that commit, and the commit is on the branch |
`test/dispatch-tick.test.ts` › a killed writer run keeps its work › the
next pass names the commit and each uncommitted file, pushes it on top
of the branch, keeps the folder | passed (failed on main: the note said
"check what it pushed", and the branch stayed at A) |
| P3: a restart after a killed run gives one PR and one push | the same
test's second pass; › a pass killed after the push and before its record
pushes nothing new the next time: one push;
`test/non-negotiables.test.ts` › P3 (now also with a start line that
names its folder) | passed |
| the `started` line names the run folder before the run, and the run
uses that folder | `test/dispatch-tick.test.ts` › the start line names
the run folder before the run, and the run gets that folder;
`test/writer.test.ts` › runs in the folder its step made for the start
line | passed |
| a failed step writes no end, so it keeps its clone for the hand-over |
`test/writer.test.ts` › a step that fails after its run writes no end
line, so its folder, clone and commit stay for the hand-over | passed |
| an older `started` line, with no folder, still goes to a person as
before | `test/dispatch-tick.test.ts` › an older start line, with no
folder, still goes to a person to check what it pushed | passed |
* **init** — no
Rollback: revert this PR; no data changes. The only stored data it
touches is the claude token, which `setup claude` stores as before once
the call accepts it or cannot check it.
Where to look: `src/core/agent/login.ts` (the login call's argv and
environment: the stored token alone in an empty `HOME`, no git host
token, no skip-permissions flag; only a 401 counts as refused);
`src/core/token/index.ts` `saveClaudeToken` (a refused token is not
stored, and the old one stays); `src/init-cli.ts` `cloneMarket` (the
clone goes to `.partial` and is renamed once whole).

## Evidence at 1199227

| criterion | command or test | result |
|---|---|---|
| A revoked or expired token fails `init` with the fix named |
`test/init.test.ts` "fails a revoked or expired implementer's token with
the fix named, though its date on record is fine" | passed |
| Only a real call says "authorized"; only a 401 says "refused" |
`test/agent-login.test.ts` "loginOf": the scrubbed real capture from
claude 2.1.326 (401, and an accepted call), plus a 403, garbage, silence
and a call past its limit | passed |
| A login that cannot be checked prints `?` and does not fail `init` |
`test/init.test.ts` "prints ? for a login it could not check, and does
not fail init" | passed |
| The tools gate runs first; no login call without claude on PATH or
with an expired token | `test/init.test.ts` "makes no login call when
claude is not on PATH", "does not call with a token whose date already
fails" | passed |
| The call's environment holds only the model login: the stored token
alone in an empty HOME, no git host token, no FACTORY_* setting, the
token never in argv | `test/agent-login.test.ts` "checks the
implementer's token alone", "checks the read-only runs' login as those
runs get it"; `test/cli.test.ts` "hands the token to the login call in
its env, never in argv" | passed |
| The call uses the env the project's settings give its runs (a company
CA) | `test/init.test.ts` "makes each login call in the environment the
project's settings give its runs, such as a company CA" | passed |
| On macOS, `HOME` names the folder the call runs in |
`test/agent-login.test.ts` "checks the implementer's token alone", run
with `TMPDIR` set to a symlink: it fails without the real-path fix and
passes with it | passed (Linux, symlinked `TMPDIR`) |
| A refused login is never read as #707's usage limit, so a run is not
parked on it | `test/agent-login.test.ts` "a refused login is never read
as a usage limit" (the real 401 capture through `claudeUsageLimit`) |
passed |
| A hung call is stopped at its limit with everything it started |
`test/agent-login.test.ts` "stops a call that hangs at its limit, with
everything it started" (a fake `claude` Node script with a grandchild) |
passed |
| `setup claude` does not store a token Anthropic refuses, and keeps the
old one | `test/cli.test.ts` "does not store a token Anthropic refuses,
and keeps the one stored before" | passed |
| A run refused by its login names the renew fix | `test/writer.test.ts`
"a run its login refused (HTTP 401) says how to renew the token first";
`test/agent.test.ts` "names the fix first when the login was refused" |
passed |
| Every init step can be rerun after a failure | `test/init.test.ts` "a
clone of the marketplace cut off midway is not taken as done" (a fake
`git` that dies mid-clone), "a .partial left by an init that was killed
mid-clone is removed", "keeps the files it wrote when a later step
fails", "a rerun after a refused token, once it is renewed, passes" |
passed |
| The whole suite | `make lint`; `make test` with `FACTORY_RULES_PACK`
at the pinned commit | green at cde18b2 (rebased on main at 86506dc):
2058 passed, 12 skipped; 1199227 adds one test, and
`test/agent-login.test.ts` passes 14 of 14 with `make lint` green |

## Change

- A `src/core/agent/login.ts`: the login call (`claude -p "Reply with
the word ok" --restricted --strict-mcp-config --tools "" --max-turns 1`,
stream-json) in a fresh folder taken by its real path (on macOS the temp
folder sits behind a symlink, and `HOME` must name the folder the CLI
runs in), its 60 s limit, the reader `loginOf`, `refusedLogin`, and the
shared `SIGN_IN` fix
- M `src/core/agent/index.ts`: `AgentCli.login`
- M `src/core/agent/claude.ts`: a read-only run refused by its login
names `SIGN_IN` first
- M `src/core/writer/run.ts`: an implementer run refused by its login
names the renew steps first; #707's usage-limit reader still reads the
raw result event, so the two do not meet
- M `src/core/init/checks.ts`: the `?` level (`unsure`), `Probes.login`,
`loginCheck`; `tokenCheck` also says whether a box would start with the
token
- M `src/init-cli.ts`: the login calls run after the gate, both at once;
the marketplace clone is staged in `.partial`; the header says what init
reads
- M `src/core/token/index.ts`, `src/core/token/rules.ts`:
`saveClaudeToken` tries the token first (`ClaudeSaved`); `RENEW` is
exported
- M `src/app.ts`, `src/cli-common.ts`, `src/cli.ts`: `Io.system.agent`
(the agent CLI's runner, a fake in every test); `setup claude` and
init's probes call the login through it, in the project's resolved
settings env
- A `test/agent-login.test.ts`; M `test/init.test.ts`,
`test/cli.test.ts`, `test/agent.test.ts`, `test/writer.test.ts`; M the
other tests that build an `Io` (each gets an `agent` fake that starts
nothing)
- M `docs/how-to/set-up-with-init.md`,
`docs/how-to/set-up-model-login.md`, `docs/reference/cli.md`,
`docs/explanation/safety.md`

## Checklist

- [x] Lane: feature, because it adds a model call made from the host
with the stored token and changes what `setup claude` stores; spec and
* **dispatch** — no
Rollback: revert this PR, then delete each `parked` line, and the
`started` line before it, from each ticket's run record under
`$FACTORY_HOME/runs/`, and each project's `provider-notice.json` there;
older code refuses an unknown record line
Where to look: `src/core/agent/usage-limit.ts` (only the exact refusal
text counts; the reset time and its zone), the `parked` rule and
`releasable` in `src/core/dispatch/table.ts` (a park outlives a moved
head and the quiet-claim release), `parkedUntil` in
`src/core/dispatch/orchestrator-loop.ts`

## Evidence at cc40aef

| criterion | command or test | result |
|---|---|---|
| A refusal is read only from the CLI's exact text, never from the
model's words or a result that is no error |
`test/agent-usage-limit.test.ts` "reads the known refusals only…";
`test/writer.test.ts` "never parks a run whose result is no error…" |
passed |
| The reset comes from the stream's rejected rate-limit event first,
then from an ISO time or a clock time in an IANA zone, anchored to when
the run ended | `test/agent-usage-limit.test.ts` "takes the reset from
the stream's rejected rate-limit event", "reads a clock time in an IANA
zone…", "uses an ISO time as it is", "falls back to the text…" | passed
|
| A zone abbreviation, a clock time daylight saving skips or repeats, or
no time gives an unknown reset | `test/agent-usage-limit.test.ts` "gives
an unknown reset…"; `test/zone.test.ts` "is refused when daylight saving
skips or repeats the clock" | passed |
| A planted refusal parks the writer run: its work pushed on top, no
needs-human, no note, the reset kept | `test/writer.test.ts` "parks a
run the provider's usage limit refused…", "parks a refusal whatever the
exit code"; `test/finish.test.ts` "parked: pushes the work in progress…"
| passed |
| The park is a `parked` record line with its task; usage and the caps
count its spend | `test/dispatch-tick.test.ts` "a parked line ends its
run, keeps its task…"; `test/usage.test.ts` "counts what a run the
provider's usage limit parked spent…" | passed |
| Before the reset the ticket waits in the factory lane with no ping,
keeps its claim, and the loop sleeps until the reset; after it, the same
task runs again | `test/dispatch-table.test.ts` "a provider's usage
limit parks the ticket…"; `test/dispatch-tick.test.ts` "records the park
with its task, sends one notice, waits, then runs the same task after
the reset"; `test/dispatch-loop.test.ts` "sleeps until the provider's
reset…" | passed |
| An unknown reset, or a refusal again at a reset no later, goes to a
person | `test/dispatch-table.test.ts` "goes to a person when the reset
time is unknown…"; `test/dispatch-tick.test.ts` "hands a park with an
unknown reset to a person…" | passed |
| One notice per project and reset; `board` shows the reset in the
reader's zone with UTC | `test/dispatch-tick.test.ts` (one `held` ping
across three passes); `test/board.test.ts` "shows a park's reset in the
reader's zone…" | passed |
| The whole suite | `make lint` and `make test` with
`FACTORY_RULES_PACK` at the pinned rules pack | passed (2016 tests) |

## Change

- A `src/core/agent/usage-limit.ts`: the reader of Claude's limit
refusal and its reset (AO `b5f4911` `domain/usage_limit.go`,
`acp/client.go`)
- M `src/core/agent/claude-writer.ts`: the writer kind's `usageLimit`
- M `src/core/zone.ts`: `atWall`, a wall time in a zone as one moment,
or skipped / repeated
- M `src/core/dispatch/spend.ts`: the stream reader keeps the rate-limit
windows
- M `src/core/writer/run.ts`, `src/core/writer/step.ts`,
`src/core/writer/why.ts`, `src/core/report.ts`: the `parked` outcome
- M `src/core/finish.ts`: a parked run's work pushed on top, no label,
no note
- M `src/core/dispatch/records.ts`: the `parked` line, `Summary.parked`,
the repeat check
- M `src/core/dispatch/table.ts`, `src/core/dispatch/next-step.ts`: the
park rule, its factory step, no release on a park
- M `src/core/dispatch/tick.ts`, `src/core/dispatch/steps.ts`: the
`parked` line and the one notice
- M `src/core/dispatch/usage.ts`: a parked run's spend counts
- M `src/core/dispatch/orchestrator-loop.ts`: sleep until the earliest
reset
- M `src/core/dispatch/board.ts`: the reset in the reader's zone with
UTC
- M `docs/reference/orchestrator.md`,
`docs/explanation/architecture.md`, `prompts/coordinator.md`
- M `test/agent.test.ts`: the `alive` helper reads a process's `/proc`
stat once, so one that ends between the check and the read reads as gone
(it failed CI once at bee0d9d)
- M tests: `agent-usage-limit` (A), `agent-writer`, `board`,
`dispatch-loop`, `dispatch-table`, `dispatch-tick`, `finish`, `usage`,
`writer`, `zone`

## Checklist

- [x] Lane: feature, because it adds a record line, a table rule and a
loop wait across the agent seam, the writer and the dispatcher; its spec
* **runs** — no
Rollback: revert this PR; no data changes. Files kept before it
(ready.txt, verify.txt) still read as before.
Where to look: `dataFence` in `src/core/review/fence.ts` (the label, the
fence length, what it removes); `capped` in `src/core/writer/task.ts`
(closes a fence the cut leaves open); `readyOutput` and `stream` in
`src/core/ready/steps.ts` (the kept file's new layout, still under the
20,000-character task cap)

## Evidence at 08a44c8

| criterion | command or test | result |
|---|---|---|
| A finding that holds a closing fence and an instruction stays inside
its fence, under the label | `test/review-fence.test.ts` "keeps a text
that closes a fence and gives an order inside its fence, under the
label"; `test/writer-task.test.ts` "fences each Act on finding and its
fix under the label" | passed (failed on `main`) |
| Each listed place reads its text through the helper |
`test/writer.test.ts` "fences the implementer's rows under the label…";
`test/ready.test.ts` "fences the why and each stream under the label…"
and "fences the local verifier's streams under the label";
`test/onboard.test.ts` "the model reads the repo's MUSTs and commands as
data…"; `test/writer-task.test.ts` "fences a job's name and the reason
it has no log" | passed (failed on `main`) |
| CI tails lose the backtick rewrite | `test/writer-task.test.ts`
"fences a CI log tail under the label and keeps its backticks as they
were"; `test/review-fence.test.ts` "grows the fence past any backtick
run…" | passed (failed on `main`) |
| Control and invisible characters removed, line breaks and tabs kept |
`test/review-fence.test.ts` "removes terminal codes, control and
invisible characters, and keeps line breaks and tabs" | passed (failed
on `main`) |
| `make lint` and `make test` pass | `make lint`;
`FACTORY_RULES_PACK=<skills@044aa84> make test` | passed: 1999 tests, 12
skipped (the real srt and VM box tests) |

## Change

- M `src/core/review/fence.ts`: `dataFence()`, the same fence as
`fence()` under one fixed data label, with terminal codes, control and
invisible characters removed; `fence()` itself unchanged, since it also
fences the reviewer's rubric and rulebook
- M `src/core/post.ts`, `src/core/kept.ts`: export `CONTROL` and
`ESCAPE`, which `dataFence` reuses
- M `src/core/writer/task.ts`: Act on findings and each failed job
(name, then its log tail or why it has none) through `dataFence`; the
backtick rewrite gone; `capped` closes a fence its cut leaves open
- M `src/core/writer/step.ts`: `cleanupText`'s evidence rows through
`dataFence`
- M `src/core/ready/steps.ts`: the ready check's `why` and each stream
(ready and verifier) through `dataFence`; the backtick rewrite gone; the
cut note moves into the block's title
- M `src/core/onboard/run.ts`: `rules.md` and `commands.md` rows through
`dataFence`
- M `docs/reference/orchestrator.md`: what `.factory/task.md` holds is
fenced as data
- A `test/fenced.ts`, `test/review-fence.test.ts`,
`test/writer-task.test.ts`; M `test/writer.test.ts`,
`test/ready.test.ts`, `test/onboard.test.ts`

## Checklist

- [x] Lane: bug, because it is a defect against the writer's floor
* **agents** — no
Rollback: revert this PR; no data changes.
Where to look: `AGENTS.md`, the new MUST under "Say the lane and why".

## Evidence at 1bc09753d97c7769cf30d688fe9a38e85703189c

| criterion | command or test | result |
|---|---|---|
| `AGENTS.md` holds one MUST: one report per ticket, edited in place
with a top line saying what changed and from whose words, no amendment
beside it, and one whole chat message | `git diff origin/main --
AGENTS.md` | passed: 4 lines added |
| `AGENTS.md` stays under 200 lines, and its links and words pass |
`make lint` | passed |
| nothing else changes | `make test` | passed: 1985 tests, 14 skipped |

## Change

Change: M `AGENTS.md`, one MUST added after "Say the lane and why".

## Checklist

- [x] Lane: tiny, because it is one docs rule in `AGENTS.md` with no
code change.
- [x] Tests: none, because no code changes.
- [x] Docs: `AGENTS.md` only. `docs/` and `prompts/coordinator.md` are
unchanged, because the rule is for the sessions that work on this repo;
no **Today:** note.
- [x] Lint: `make lint` and `make test` green; no disable comment;
`scripts/lint-baseline.json` not raised
- [x] Rules pack and evals: neither touched.
- [x] Health: `make garden-pr` reports no touched code file and no
module worse.
* **writer** — no
Rollback: revert this PR; no data changes.
Where to look: `src/core/writer/prompt.ts` `runPrompt` and the strings
it joins (moved byte for byte; only ticket numbers dropped from
comments); `src/core/writer/step.ts` imports.

## Evidence at 04ac0aa

| criterion | command or test | result |
|---|---|---|
| `step.ts` is split along its two responsibilities: the prompt in one
file, the planner and run in another | `src/core/writer/prompt.ts` (A):
`RunMode`, `FOREGROUND`, `PROJECT_INSTRUCTIONS`, `FLOOR`, the mode task
texts, `evidenceRules`, `CLEANUP_REPORT`, `runPrompt`, `KNOWLEDGE`,
`knowledgeLines`; `step.ts` keeps the planners, `inClone` and the host's
push and post | done |
| move-only, no behaviour change; each part with its tests |
`test/writer-prompt.test.ts` (the five prompt tests, moved from
`test/writer.test.ts`), and `test/writer.test.ts` | passed |
| `make lint` and `make test` pass | `make lint`; `make test` with
`FACTORY_RULES_PACK` at the pinned commit | passed |
| `make garden-pr` shows no file worse | `make garden-pr` | "No module
number got worse": `step.ts` 899 → 815, `prompt.ts` 91, `writer.test.ts`
1863 → 1782, `writer-prompt.test.ts` 78 |

## Change

- A `src/core/writer/prompt.ts`: the run's prompt, moved from `step.ts`
- M `src/core/writer/step.ts`: the prompt moved out; imports it from
`prompt.ts`; header points there
- A `test/writer-prompt.test.ts`: the prompt's tests, moved from
`test/writer.test.ts`
- M `test/writer.test.ts`: the prompt's tests moved out; `FLOOR` and
`KNOWLEDGE` imported from `prompt.ts`
- M `docs/reference/orchestrator.md`: `FOREGROUND` and `FLOOR` now live
in `src/core/writer/prompt.ts`

## Checklist

- [x] Lane: tiny, because it is move-only with no behaviour change.
- [x] Tests: none added; the five prompt tests moved to
`test/writer-prompt.test.ts` with their assertions unchanged (one
comment lost its ticket numbers, as `check-history` asks of moved
lines).
- [x] Docs: `docs/reference/orchestrator.md`'s two file pointers; no
**Today:** note changes.
- [x] Lint: `make lint` and `make test` green; no disable comment;
`scripts/lint-baseline.json` not raised
- [x] Rules pack and evals: `make test` with `FACTORY_RULES_PACK` at the
pinned commit; no review input touched (the evals that cite `step.ts`
are pinned to their own base commits).
- [x] Health: `make garden-pr` shows no module worse. `step.ts` is still
15 lines over the 800-line limit; its third job, the host's push and
post (`finished`, `onChange`, the PR body, `handOver`), would be its own
refactor ticket. `gardener compare` needs the merged PR and days after
it, so fix share and rework cannot be shown yet; I do not claim it
helped. Before: `step.ts` had 7 fixes in 60 days, and `writer.test.ts`
8.
* **process** — no. A pack with card v1, or with no schema folder,
reads as before, and lanes and finding still read 1 and 0. Card v0
schema files are no longer read, because card now reads 2 and 1 as P18
says; no released pack ships one.
Rollback: revert this PR; no data changes.
Where to look: `src/core/process/pack-schema.ts` `PACK_FORMAT`,
`PACK_SUPPORTED` and `inUse`, which decide the versions of each part the
engine takes; `tests/fixtures/pack-schema/v2/card-v2.schema.json`, which
* **agent** — no. Every Claude argv, env and record line is
unchanged. A project file that names `agents` with `copilot` is refused,
and no file had that key before.
Rollback: revert this PR. No data changes: a record line with a
`copilot` field is written by no code yet.
Where to look: `src/core/agent/copilot.ts` (`copilotEnv` and the private
home: the S6 boundary); `src/core/project.ts` `agentsOf` (the off
switch, checked on every read of the project file);
`src/core/token/rules.ts` `checkCopilotToken` (only `github_pat_`).

## Evidence at 46f30c1

| criterion | command or test | result |
|---|---|---|
| `setup copilot` keeps only a fine-grained token, with its typed
expiry, never printed; `claude` still refuses `github_pat_` |
`test/token.test.ts` "checkCopilotToken", "copilotMeta and
* **agent** — yes. An onboarder role card that names Bash is refused
when it loads. The pinned rules pack (`044aa84`) ships no onboarder
card; a pack that ships one must drop Bash from its tools.
Rollback: revert this PR; no data changes.
Where to look: `src/core/writer/scope.ts` (the hook's check: the run's
own report and PR body pass, everything else must match every scope),
`src/core/agent/claude-writer.ts` (the deny list per guardrail must stay
byte-identical for the floor), `src/core/writer/step.ts` `inClone`
(scopes and settings built from the card).

## Evidence at 25163a7

| criterion | command or test | result |
|---|---|---|
| AC1: the writer runs through the seam; `FACTORY_CLAUDE` read only in
`src/core/agent/` | `test/agent-writer.test.ts` "runs the image's pinned
claude in vm, and FACTORY_CLAUDE in srt", "reads FACTORY_CLAUDE only in
src/core/agent/"; `test/srt-programs.test.ts` "takes an absolute agent
CLI path…" | passed |
| AC2: tools and denies from the card's guardrails; Task kept; skip-all
only in vm/srt | `test/agent-writer.test.ts` "builds the deny list from
the card's guardrails, one ID at a time", "keeps the implementer's and
cleanup's settings as they were…" | passed |
| AC3: test-first edits only `ready.testFiles`, in the run and on the
host; a card's Edit(…) only narrows | `test/writer-scope.test.ts`
(scopesOf, outsideScope, the hook, `writer-scope` command);
`test/writer.test.ts` "blocks a built-in test-first run that commits
outside ready.testFiles…", "lets it through when the project's test
files name what it committed" | passed |
| AC4: the onboarder drops Bash; its floor is read-only |
`test/cards.test.ts` "refuses an onboarder card that asks for Bash…";
`test/onboard-card.test.ts` | passed |
| AC5: argv byte-identical for every built-in card; settings unchanged
for the implementer and cleanup | `test/agent-writer.test.ts` "gives
every built-in writer card the argv it had before, test-first included,
in vm and in srt" | passed |
| AC6: docs and **Today:** notes in step | `make lint` (links, words,
history, Today notes) | passed |
| the whole suite with the pinned pack |
`FACTORY_RULES_PACK=<skills@044aa84> make test` | 1920 passed, 12
skipped |

## Change

- A `src/core/agent/claude-writer.ts`: the writer kind of the Claude
adapter, with the argv, the bin per place, the deny list per guardrail
ID, the settings file with the scope and lint hooks, and the env (moved
from `writer/run.ts` and `writer/tools.ts`)
- M `src/core/agent/index.ts`: `AgentCli.writer`; **Today:** now names
* **agent** — an onboarder role card that names Bash is refused when
it loads. The pinned rules pack ships no onboarder card; a pack that
ships one must drop Bash from its tools.
* **agent** — yes. `runner` is no longer a plugin extension point
(ADR-0022 A2), so a plugin whose `describe` declares `runner` is refused
at load. No known plugin declares it; such a plugin must drop the
capability.
Rollback: revert this PR; no data changes. If a settings layer sets one
of the six new keys (`review.finderMinutes`, `review.verifyMinutes`,
`design.minutes`, `onboard.minutes`, `retro.minutes`,
`eval.judgeMinutes`), remove it too, because older code refuses an
unknown key.
Where to look: `src/core/agent/folder.ts` `grouped`, `timed` and the
live-group watcher (the stop, and the host-exit cleanup);
`src/core/agent/claude.ts` `claudeModel` (a late run fails only when it
gave no answer); `src/core/review/round.ts` `limitFor` (finder or verify
limit per pass).

## Evidence at 33ada57

| criterion | command or test | result |
|---|---|---|
| AC-1: one `AgentCli` interface in `src/core/agent/` with a Claude
adapter; `openAgentCli` is the one place that reads `FACTORY_CLAUDE` |
`test/agent.test.ts` "calls FACTORY_CLAUDE with the argv, env and
folder…", "reads claude from the PATH when FACTORY_CLAUDE is unset";
`grep -rn 'FACTORY_CLAUDE ?? "claude"' src` outside `src/core/agent/`
finds none | passed; failed before (no module) |
| AC-2: every read-only run and `claude agents --json` go through it |
the five call sites (`review/settings.ts`, `design/settings.ts`,
`onboard/settings.ts`, `retro-cli.ts`, `eval-cli.ts`) and `loop-cli.ts`
reconcile call `openAgentCli`; `test/agent.test.ts` "runs FACTORY_CLAUDE
agents --json with the claude env" | passed |
| AC-3: a wall-clock limit per read-only run kind from settings, default
20, at most 60, a value set but not valid refused | `test/agent.test.ts`
"limitOf" (each of the 6 keys); `test/settings.test.ts` "the read-only
runs' time limits" (cap keys, `paths`, `evalSettings`);
`test/design-step.test.ts` "designSetup's time limits";
`test/onboard.test.ts` "gives the run its time limit";
`test/retro-cli.test.ts` "refuses a time limit that is not valid"; each
run kind carries its limit: `review-round`, `design-step`, `onboard`,
`retro-draft`, `eval` tests | passed; each failed before |
| AC-4: a run past its limit is stopped with everything it started and
recorded as failed with the reason, its stream kept |
`test/agent.test.ts` "stops a <kind> run that never exits at its limit…"
for finder, verify pass, design-reviewer, onboarder, retro draft, eval
judge (a `FACTORY_CLAUDE` stub that never exits and holds a grandchild);
"fails closed when the list hangs past its limit"; "keeps the answer of
a CLI that exited in time…"; "ends a live run's group when this process
exits or is signalled" | passed; failed before |
| AC-5: argv and env byte-identical | `test/agent.test.ts` "calls
FACTORY_CLAUDE with the argv, env and folder each call site gave before
the seam, byte for byte", `claudeArgs` tests moved unchanged from
`review-round.test.ts`, "puts no limit in the argv" | passed |
| AC-6: ADR-0022 amends ADR-0014 P7; `runner` leaves `EXTENSION_POINTS`
| `docs/adr/0022-agent-cli-adapter-in-core.md`; `test/agent.test.ts`
"has no runner extension point"; `make lint` (`check-adrs`) | passed |
| AC-7: docs list the keys; `safety.md` keeps **Today:** only for "on
the host" | `docs/reference/settings.md`, `docs/explanation/safety.md`,
`docs/explanation/architecture.md`; `make lint` (links, history) |
passed |

## Change

- A `docs/adr/0022-agent-cli-adapter-in-core.md`: the adapter in core,
`runner` dropped, the limits
- M `docs/adr/0014-plugin-model.md`: header points P7 to ADR-0022
- M `docs/explanation/architecture.md`, `docs/explanation/safety.md`,
`docs/reference/settings.md`
- A `src/core/agent/index.ts`: `AgentCli`, `openAgentCli`
- A `src/core/agent/claude.ts`: from `review/model.ts`, `claudeArgs`,
`readAnswer`, `claudeEnv` (from `review/settings.ts`), `claudeModel`
with the limit, `claudeSessions` and `sessionNames` (from
`review/live.ts`)
- A `src/core/agent/folder.ts`: `runInFolder` with a stop that ends the
process group, `timed`, the live-group cleanup on exit, SIGINT and
SIGTERM
- A `src/core/agent/limits.ts`: `limitOf` for the six keys
- M `src/core/review/model.ts`: only the CLI-neutral `Model` types, with
`limit: RunLimit` on `ModelRun`
- M `src/core/review/settings.ts`, `round.ts`, `live.ts`;
`src/core/design/settings.ts`, `step.ts`;
`src/core/onboard/settings.ts`, `run.ts`; `src/core/retro/draft.ts`;
`src/core/eval/harness.ts`, `judge.ts`; `src/retro-cli.ts`,
`src/eval-cli.ts`, `src/loop-cli.ts`; `src/core/lint-edit.ts`: each
passes its limit, and builds its model through the seam
- M `src/core/settings/variables.ts`: six `cap` keys;
`src/core/plugin/contract.ts`: no `runner`; `scripts/check-musts.ts`:
one spawn-seam entry for `agent/folder.ts`
- A `test/agent.test.ts`; M the call sites' tests

Deviations from the approved design:
- `ModelRun` carries `limit: { minutes, setting }`, not a bare
`minutes`, so the reason names the variable, as the spec's reason text
needs.
- `sessionNames` moved into the Claude adapter too: it parses `claude
agents --json`, so it is the adapter's (code review finding).
- `evalSettings` now returns a `Result`, so a bad limit refuses the eval
before it spends.
- The stoppable call goes over `spawn`, because `execFile` ignores
`detached`. While a run's group is live, the host ends it on exit,
SIGINT or SIGTERM, so a Ctrl-C no longer leaves a detached run running
unwatched (code review finding).

## Checklist

- [x] Lane: bug, because it fixes a defect against ADR-0012 S7 and P7
(no time limit on a read-only run); with a design, because an interface
and more than one module change.
- [x] Tests: `test/agent.test.ts` (new); limit assertions and refusals
in `review-round`, `design-step`, `onboard`, `retro-draft`, `retro-cli`,
`eval`, `settings` tests; each new test failed before the change (no
`src/core/agent/`, no limit). The `claudeArgs` and `runInFolder` tests
moved unchanged from `review-round.test.ts`.
- [x] Docs: ADR-0022 (new), ADR-0014 header,
`docs/reference/settings.md` (the six keys),
`docs/explanation/safety.md` (the limit is enforced; **Today:** stays
* **agent** — a plugin that declares the `runner` capability is
refused at load; the agent CLI adapter lives in core (ADR-0022).
* **post** — no
Rollback: revert this PR; no data changes.
Where to look: `cleanField` and its `scrubbed` helper in
`src/core/post.ts` (every template field goes through it); `cleanBody`
in `src/core/pr-body.ts` (scrub after hidden characters go, before the
inert rules); `cleanedPost` in `src/core/forge/plugin.ts` (what a forge
plugin is handed).

## Evidence at a76f069

| criterion | command or test | result |
|---|---|---|
| AC-1: every model text the host posts goes through `scrubSecrets`
before it is posted or handed to a plugin | `test/post.test.ts`
"renderPost: no secret in posted text"; `test/pr-body.test.ts` "no
secret in the posted PR body"; `test/forge-github.test.ts`,
`test/forge-gitlab.test.ts` "note and lineFinding post no secret,
anchored or not"; `test/forge-plugin.test.ts` "hands the plugin a note
and a line finding with no secret in them"; `test/finish.test.ts` "posts
no secret in a question, a blocker or a deviation" | passed; each failed
before the fix |
| AC-2: a token-shaped string (`ghp_`, `sk-ant-`, `glpat-`,
`NAME=value`, a PEM key, a URL login, one split by a hidden character)
becomes `[scrubbed]` in each path | the same tests, plus "scrubs a token
that a hidden character splits" | passed |
| AC-3: nothing engine-written changes | every existing `post`,
`pr-body`, `forge-*`, `finish` and `spec` test unchanged and green;
"leaves the engine's own words as they were" | passed |
| AC-4: cleaning stays idempotent | `test/pr-body.test.ts` "cleanBody
scrubs a token in a table, in code, a PEM key…" (`clean(out) === out`) |
passed |
| Q1: a spec body that holds a secret is refused, never scrubbed |
`test/spec.test.ts` "refuses a body that holds something shaped like a
secret" | passed |
| suite | `make lint`; `make test` with `FACTORY_RULES_PACK` at 044aa84
| green: 1859 passed, 12 skipped (hardware-only box tests and the CI-env
check) |

## Change

- M `src/core/post.ts`: `cleanField` scrubs first, and a secret split by
a hidden character too
- M `src/core/pr-body.ts`: `cleanBody` scrubs once hidden characters are
gone
- M `src/core/forge/plugin.ts`: `cleanedBody` becomes `cleanedPost`,
which scrubs title, fields, items and the change title for `note`,
`lineFinding`, `setBody` and `openChange`
- M `src/core/finish.ts`: `sameWords` keeps a word boundary, so a
question that starts with a token still reads back
- M `src/core/spec.ts`: `postableSpec` refuses a body with anything
shaped like a secret
- M `src/core/scrub.ts`: header names posting as a user
- M `docs/CONSTITUTION.md` (P4 how it's checked),
`docs/explanation/architecture.md`, `docs/reference/connectors.md`,
`prompts/coordinator.md`
- M `test/post.test.ts`, `test/pr-body.test.ts`,
`test/forge-github.test.ts`, `test/forge-gitlab.test.ts`,
`test/forge-plugin.test.ts`, `test/finish.test.ts`, `test/spec.test.ts`

Deviation from the spec: the spec named an edit to ADR-0012 S13's
cleaner sentence; `check-adrs` keeps an accepted ADR's decision as
written, and scrubbing applies P4 rather than changing S13, so P4's
check line and `architecture.md` say it instead.

Automated review (high): 7 findings. Fixed: a token split by a
zero-width character passed `cleanField`; a broken header comment. Not
fixed here: the `NAME=value` rule in `scrubSecrets` over-scrubs prose (a
spec body with `TOKEN=…` is refused, a Markdown closer after a value is
eaten, "password: field" in a finding is rewritten), which the operator
* **coordinator** — no. The settings shape gains `hooks`, and existing
coordinator settings now fail `checkWall` until the person runs
`agent-factory setup coordinator` again, as the refusal tells them.
Rollback: revert this PR; no data changes. Running `agent-factory setup
coordinator` afterwards writes the old settings back.
Where to look: `src/core/edit-scope.ts` (`real`, `within`: a path that
passes here is written with no prompt); `hookProblems` in
`src/core/coordinator.ts` (what the orchestrator accepts as a standing
hook).

## Evidence at 685bb13

| criterion | command or test | result |
|---|---|---|
| AC-1: Edit and Write outside `$FACTORY_HOME/specs/**` are denied, not
asked; inside, they run with no prompt; `..` and symlinks that lead out
are denied | `test/edit-scope.test.ts` (all 5 tests);
`test/coordinator.test.ts` "lets it edit spec drafts with no prompt; the
edit-scope hook refuses any other edit before the rules", "quotes the
hook's paths…"; `test/cli.test.ts` "agent-factory edit-scope … denies an
edit outside the specs folder with exit 2…" | passed |
| AC-2: WebFetch and WebSearch are denied | `test/coordinator.test.ts`
"denies WebFetch and WebSearch: outside context comes only through
fetch" | passed |
| AC-3: `wallProblems` refuses settings without these denies or without
the hook | `test/coordinator.test.ts` "names a missing WebFetch or
WebSearch deny, and a missing, changed or switched-off edit-scope hook";
`make lint` (check-coordinator on the template) | passed |
| AC-4: Copilot (1A): flags unchanged; its **Today:** says the edit and
web denies do not hold there | `docs/how-to/set-up-coordinator.md` |
done |
| AC-5: the **Today:** at `safety.md:76-77` is removed; the docs match
the code | `docs/explanation/safety.md`,
`docs/how-to/set-up-coordinator.md`, `prompts/coordinator.md`,
`docs/reference/cli.md`; `test/cli-doc.test.ts` | passed |

## Change

- A `src/core/edit-scope.ts`: the PreToolUse hook's decision. It follows
the path through symlinks as far as the path exists, and denies (exit 2)
anything outside the specs folder. A dangling or looping link, a `..`, a
relative path, or input that is not a tool call is denied too.
- M `src/core/coordinator.ts`:
- `claudeSettings` gains the `hooks.PreToolUse` edit-scope hook, run as
`node '<pkg>/dist/cli.js' edit-scope '<home>/specs'`, and denies
`WebFetch` and `WebSearch`.
  - `wallProblems` gains `hookProblems` and the two web denies.
- M `src/loop-cli.ts`, `src/app.ts`: the hidden `edit-scope <specs
folder>` command, next to `lint-edit`.
- M `test/coordinator.test.ts`, `test/cli.test.ts`; A
`test/edit-scope.test.ts`.
- M `docs/explanation/safety.md`, `docs/how-to/set-up-coordinator.md`,
`docs/reference/cli.md`, `prompts/coordinator.md`.

## Checklist

- [x] Lane: bug, because the coordinator's settings were looser than
ADR-0012 S2 decided. The spec carries a short design, because a new hook
command changes an interface across modules.
- [x] Tests: `test/edit-scope.test.ts` (new) and the new tests in
`test/coordinator.test.ts` and `test/cli.test.ts`. Each failed before
the fix, and the dangling-symlink test failed before its fix.
- [x] Docs: **Today:** removed at `safety.md` ("an edit outside the spec
drafts asks you"). In `set-up-coordinator.md`: the Copilot **Today:** is
* **notify** — no
Rollback: revert this PR, then delete the `"kind":"turn"` lines from
`$FACTORY_HOME/runs/<project>/*.jsonl` (with the loop stopped), because
older code refuses a record line kind it does not know; every other line
is unchanged
Where to look: `src/core/dispatch/turn-ping.ts` (the rule and the ping's
text), `src/core/dispatch/records.ts` (the `turn` line, `seedTurn` for
records with no turn line, `isActivity`), `src/core/dispatch/tick.ts`
`forgeThenTurn`/`turnPinged`

## Evidence at aeb3b6d

| criterion | command or test | result |
|---|---|---|
* **board** — no. `board --json` stays one array. Each row gains a
`lane` field (`needs-you`, `ready-to-merge` or `factory`), rows now come
in lane order, and every row has one key order. No reader in the repo
* **repo** — no
Rollback: revert this PR; no data changes.
Where to look: `docs/explanation/safety.md` (Today notes re-pointed to
* **coordinator** — no
Rollback: revert this PR; no data changes.
Where to look: `prompts/coordinator.md` (the new last bullet of **Your
limits**): the anchor `#the-coordinator-runs-these` must match the
heading at `docs/reference/cli.md:33`, which the link check does not
verify.

## Evidence at 97a3a9c

| criterion | command or test | result |
|---|---|---|
| The link is in `prompts/coordinator.md` | `grep -n
'cli.md#the-coordinator-runs-these' prompts/coordinator.md` | passed:
one line, under **Your limits** |
| `make lint` (links resolve) passes | `make lint` | passed |
| The suite stays green | `make test` with `FACTORY_RULES_PACK` at the
pinned `044aa84` | passed: 1815 passed, 12 skipped |

## Change

Change: M `prompts/coordinator.md`: one new bullet at the end of **Your
limits** links `docs/reference/cli.md#the-coordinator-runs-these` and
says the read commands sit under **You run these** on that page.

## Checklist

- [x] Lane: tiny, because it adds one doc link to a prompt and changes
no code.
- [x] Tests: none, because no code changes; `test/cli-doc.test.ts`
already keeps the linked page complete.
- [x] Docs: `prompts/coordinator.md` only; no `docs/` page changes, and
no **Today:** note is added or removed.
- [x] Lint: `make lint` and `make test` green; no disable comment;
`scripts/lint-baseline.json` not raised
- [x] Rules pack and evals: `make test` with `FACTORY_RULES_PACK` set at
the pinned commit; no review input touched.
- [x] Health: `make garden-pr` shows no module worse (no code file
touched).
* **agents** — no
Rollback: revert this PR; no data changes.
Where to look: `docs/agents/issue-tracker.md` line 15

## Evidence at e039562

| criterion | command or test | result |
|---|---|---|
| The doc names no map, and gives the command that lists the open ones |
`docs/agents/issue-tracker.md` line 15: `gh issue list --label
wayfinder:map --state open` | passed |
| `make lint` passes | `make lint` | passed |

## Change

Change: M `docs/agents/issue-tracker.md`, one sentence: the map pointer
now lists the open `wayfinder:map` tickets instead of naming one,
because more than one map can be open at once.

## Checklist

- [x] Lane: tiny, because it changes one docs line.
- [x] Tests: none, because only a docs line changes and no code reads
it.
- [x] Docs: `docs/agents/issue-tracker.md`; `prompts/coordinator.md`
unchanged, because it names no map; no **Today:** note.
- [x] Lint: `make lint` and `make test` green; no disable comment;
`scripts/lint-baseline.json` not raised
- [x] Rules pack and evals: neither touched.
- [x] Health: no code module touched, so `make garden-pr` has nothing to
compare.
* **config** — no
Rollback: revert this PR; no data changes.
Where to look: `src/core/origin.ts` `mismatch` (the host and path
compare), `src/app.ts` `onePass` and `loopPasses` (the check runs before
each pass's setup)

## Evidence at 361fd3c

| criterion | command or test | result |
|---|---|---|
| AC-1: `config check` exits 1 on a clone whose origin is not the
project's repo, naming the clone, the origin URL and the expected
`host/project` | `test/settings.test.ts` "config check refuses a clone
whose origin is not the project's repo, naming both URLs";
`test/origin.test.ts` "names both URLs when the clone's origin is
another repo, or a fork", "names both hosts when the origin is on
another git host" | passed |
| AC-2: each `dispatch` pass stops before its setup on a failed check,
with the same text | `test/origin.test.ts` "runs a pass's setup only
once the clone is the project's repo" (`checkedSetup`, which `onePass`
and the loop's `setup` call) | passed |
| AC-3: a matching origin passes in https, `ssh://` and scp form, with
or without `.git`, without letter case | `test/origin.test.ts` "passes a
matching origin, ignoring a .git suffix and letter case in the host and
owner", "matches a self-hosted GitLab's full group path on its
configured host", "matches a gitHostProject written with a .git suffix"
| passed |
| AC-4: a clone with no origin, or one git cannot read, fails, naming
the clone | `test/origin.test.ts` "refuses a clone with no origin,
naming the clone", "says the clone cannot be read, not that it lacks an
origin, when the folder is no git repo" | passed |
| AC-5: nothing is checked when `clone` or `gitHostProject` is not set |
`test/origin.test.ts` "checks nothing when the clone or the project on
the git host is not set" | passed |
| all | `make lint`, `make test` | passed (1813 tests, 14 skipped) |

## Change

- A `src/core/origin.ts`: `originProblem` reads the clone's fetch URL
for `origin` through `hostGit`, parses it with `parseRemote`, and
compares it with `gitHost`'s host and `gitHostProject`; `checkedSetup`
runs it before a pass's setup
- M `src/settings-cli.ts`: `config check` adds the mismatch as an error
- M `src/app.ts`: `onePass` and the orchestrator loop's `setup` go
through `checkedSetup`; `board` does not
- M `docs/reference/settings.md`: the check, and that where the clone
pushes is checked at each push (`src/core/push.ts`)
- A `test/origin.test.ts`, M `test/settings.test.ts`

Out of scope, as agreed on the ticket: `reconcile`, `review`, `usage`,
`retro` and the spec cite check still read the clone unchecked.

## Checklist

- [x] Lane: bug, because it fixes a missing check in code, with no
change to how a person uses a command; more than one module changes, so
the spec carried a short design.
- [x] Tests: `test/origin.test.ts` (new, 9 tests) and one case in
`test/settings.test.ts`, each failing on `main` (commit c150a77 shows
them red against a stub). The `dispatch` wiring is covered through
`checkedSetup` only, because no CLI test gets `dispatch` past the
coordinator check.
- [x] Docs: `docs/reference/settings.md`; `prompts/coordinator.md`
unchanged, because no coordinator step changes; no **Today:** note.
- [x] Lint: `make lint` and `make test` green; no disable comment;
`scripts/lint-baseline.json` not raised
- [x] Rules pack and evals: neither touched (no role card, process read
or review input changes).
- [x] Health: `make garden-pr` shows `src/app.ts` one line worse on size
(1713 → 1714, over the 800 limit) for the new import; its split is
* **repo** — no
Rollback: revert this PR; no data changes.
Where to look: `breaking`, `footerAgrees` and `titleAgrees` in
`scripts/check-pr-body.ts`; the two paragraphs added under "Commit
messages" in `CONTRIBUTING.md`.

## Evidence at 19505e6

| criterion | command or test | result |
|---|---|---|
| A yes with the footer and the title's `!` passes | `npx vitest run
test/check-pr-body.test.ts` | passed, 9 tests |
| A yes without the footer or the `!`, and a footer or `!` without a
yes, each fail with their own message | the same file | passed |
| With no PR_TITLE, only the footer is checked | the same file | passed
|
* **adr** — no
Rollback: revert this PR; no data changes, docs only.
Where to look: the end of the S3 cell in
`docs/adr/0012-safety-design-for-unattended-runs.md:38`, which
`scripts/check-adrs.ts` must cut out as a Today note, not read as a
changed decision.

## Evidence at a29288e

| criterion | command or test | result |
|---|---|---|
| S3 gets a Today note: a conflict sends the writer to merge the default
* **repo** — no
Rollback: revert this PR; no data changes. To switch the check off
alone, delete `.github/workflows/pr-body.yml`.
Where to look: the `problems` rules in `scripts/check-pr-body.ts`; the
worktree and rebase MUSTs in `AGENTS.md`.

## Evidence at 8c57208

| criterion | command or test | result |
|---|---|---|
| A filled description passes; the template as it stands fails on each
placeholder and each checklist item | `npx vitest run
test/check-pr-body.test.ts` | passed, 6 tests |
| A missing or empty label line, a placeholder left and an unticked item
are each named | the same file | passed |
| Angle brackets the template does not hold, such as `<details>`, pass |
the same file | passed |
| The repo stays green | CI's `lint-and-test`, `install-test` and
`test-macos` on this head | lint-and-test and install-test passed;
test-macos running |

## Change

```
M .github/pull_request_template.md   the rulebook's PR readiness lines, then this repo's checklist
A .github/workflows/pr-body.yml      runs the check on a ready PR; skips drafts and Dependabot
M AGENTS.md                          worktree, rebase with lease, and filled-in template MUSTs
M CONTRIBUTING.md                    the worktree, rebase and remove steps; merge onto a rebased branch
A scripts/check-pr-body.ts           the description rule
A test/check-pr-body.test.ts         its cases
```

## Checklist

- [x] Lane: tiny, because it changes docs, CI and a repo check, and no
engine code.
- [x] Tests: `test/check-pr-body.test.ts`, new, with a case per rule.
- [x] Docs: `AGENTS.md` and `CONTRIBUTING.md`; `prompts/coordinator.md`
needs nothing, because no engine step changes.
- [x] Lint: tsc, oxlint, Biome and `lint-ratchet` green; no disable
comment; `scripts/lint-baseline.json` not raised.
- [x] Rules pack and evals: neither touched.
- [x] Health: two new files; no engine module touched.

### 

* **adr** — mark where S3 and D14 say rebase but the code merges · [#645](https://github.com/chiyanram/agent-factory/issues/645) (PR [#646](https://github.com/chiyanram/agent-factory/pull/646))
* **agents** — keep one report per ticket, edited in place, never an amendment beside it · [#716](https://github.com/chiyanram/agent-factory/issues/716) (PR [#717](https://github.com/chiyanram/agent-factory/pull/717))
* **agents** — list the open wayfinder maps instead of naming a closed one · [#649](https://github.com/chiyanram/agent-factory/issues/649) (PR [#650](https://github.com/chiyanram/agent-factory/pull/650))
* **coordinator** — link the commands it may run in docs/reference/cli.md · [#673](https://github.com/chiyanram/agent-factory/issues/673) (PR [#681](https://github.com/chiyanram/agent-factory/pull/681))
* **repo** — breaking-change marks agree, the body rule matches the squash, and a cloud clone is a worktree · [#643](https://github.com/chiyanram/agent-factory/issues/643) (PR [#647](https://github.com/chiyanram/agent-factory/pull/647))
* **repo** — clarity pass over guides, explanations and references · [#651](https://github.com/chiyanram/agent-factory/issues/651) (PR [#680](https://github.com/chiyanram/agent-factory/pull/680))
* **repo** — work in a worktree, rebase with a lease, and check the pull request description · [#643](https://github.com/chiyanram/agent-factory/issues/643) (PR [#644](https://github.com/chiyanram/agent-factory/pull/644))
* **writer** — the run's prompt moves from step.ts to prompt.ts · [#694](https://github.com/chiyanram/agent-factory/issues/694) (PR [#709](https://github.com/chiyanram/agent-factory/pull/709))

### ✨ Features

* **agent** — the Copilot adapter: setup copilot and the read-only run, kept off until a real run is checked · [#690](https://github.com/chiyanram/agent-factory/issues/690) (PR [#701](https://github.com/chiyanram/agent-factory/pull/701))
* **board** — agent-factory board, a read-only view of every ticket in flight · [#487](https://github.com/chiyanram/agent-factory/issues/487) (PR [#590](https://github.com/chiyanram/agent-factory/pull/590))
* **board** — group tickets by whose turn it is: needs you, ready to merge, factory · [#671](https://github.com/chiyanram/agent-factory/issues/671) (PR [#682](https://github.com/chiyanram/agent-factory/pull/682))
* **cli** — agent-factory trace lists a ticket's traces and prints one · [#487](https://github.com/chiyanram/agent-factory/issues/487) (PR [#538](https://github.com/chiyanram/agent-factory/pull/538))
* **design** — design-review and onboarder runs keep their traces; traces print inert · [#487](https://github.com/chiyanram/agent-factory/issues/487) (PR [#540](https://github.com/chiyanram/agent-factory/pull/540))
* **design** — the design review converges: one grill round, a re-review only for an Act on conflict, at most 2 rounds · [#489](https://github.com/chiyanram/agent-factory/issues/489) (PR [#511](https://github.com/chiyanram/agent-factory/pull/511))
* **dispatch** — a fail is a fail, a person's quarantine, hermetic git calls and a macOS CI job · [#485](https://github.com/chiyanram/agent-factory/issues/485) (PR [#507](https://github.com/chiyanram/agent-factory/pull/507))
* **dispatch** — a held ticket tells the person once; three unanswered blocker reads go to a person · [#494](https://github.com/chiyanram/agent-factory/issues/494) (PR [#518](https://github.com/chiyanram/agent-factory/pull/518))
* **dispatch** — a merge's timeline line, written once with no model: rounds that ran, findings and acted-on per rule ID, spend per run kind, rescues · [#488](https://github.com/chiyanram/agent-factory/issues/488) (PR [#624](https://github.com/chiyanram/agent-factory/pull/624))
* **dispatch** — a spec's blocked by holds the first build until each blocker is merged · [#494](https://github.com/chiyanram/agent-factory/issues/494) (PR [#516](https://github.com/chiyanram/agent-factory/pull/516))
* **dispatch** — a writer run at the provider's usage limit parks the ticket until its reset, then runs again · [#707](https://github.com/chiyanram/agent-factory/issues/707) (PR [#719](https://github.com/chiyanram/agent-factory/pull/719))
* **dispatch** — board lists ticket sessions that wait on the operator, and pings once · [#712](https://github.com/chiyanram/agent-factory/issues/712) (PR [#725](https://github.com/chiyanram/agent-factory/pull/725))
* **dispatch** — each writer run keeps its whole output as a trace · [#487](https://github.com/chiyanram/agent-factory/issues/487) (PR [#536](https://github.com/chiyanram/agent-factory/pull/536))
* **dispatch** — only a real answer closes a question, and it reaches the next run as a typed field · [#486](https://github.com/chiyanram/agent-factory/issues/486) (PR [#510](https://github.com/chiyanram/agent-factory/pull/510))
* **dispatch** — stop starting the cleanup run automatically · [#639](https://github.com/chiyanram/agent-factory/issues/639) (PR [#641](https://github.com/chiyanram/agent-factory/pull/641))
* **dispatch** — the board: each ticket in flight, its step and what it waits on · [#487](https://github.com/chiyanram/agent-factory/issues/487) (PR [#586](https://github.com/chiyanram/agent-factory/pull/586))
* **dispatch** — traces older than 30 days are deleted, and a trace holds no long line · [#487](https://github.com/chiyanram/agent-factory/issues/487) (PR [#537](https://github.com/chiyanram/agent-factory/pull/537))
* **door** — the door seam in core: front doors write a person's word only through it, and ADR-0023 · [#713](https://github.com/chiyanram/agent-factory/issues/713) (PR [#726](https://github.com/chiyanram/agent-factory/pull/726))
* **eval** — check-eval-proof keeps a change only past the noise: hold, aim, and no errored run · [#488](https://github.com/chiyanram/agent-factory/issues/488) (PR [#610](https://github.com/chiyanram/agent-factory/pull/610))
* **forge** — a branch's change state and an issue's state through the git host seam · [#494](https://github.com/chiyanram/agent-factory/issues/494) (PR [#515](https://github.com/chiyanram/agent-factory/pull/515))
* **forge** — setIssueBody replaces an issue's body, in both adapters · [#542](https://github.com/chiyanram/agent-factory/issues/542) (PR [#572](https://github.com/chiyanram/agent-factory/pull/572))
* **garden** — make garden-pr prints the module numbers a change moves and which got worse · [#573](https://github.com/chiyanram/agent-factory/issues/573) (PR [#636](https://github.com/chiyanram/agent-factory/pull/636))
* **garden** — the module numbers of a change and which got worse · [#573](https://github.com/chiyanram/agent-factory/issues/573) (PR [#635](https://github.com/chiyanram/agent-factory/pull/635))
* **init** — init writes the coordinator's settings, a clean-machine install test, and a stuck check · [#485](https://github.com/chiyanram/agent-factory/issues/485) (PR [#508](https://github.com/chiyanram/agent-factory/pull/508))
* **init** — pin the chiyanram rules pack at the engine's tested commit, never skills HEAD · [#607](https://github.com/chiyanram/agent-factory/issues/607) (PR [#613](https://github.com/chiyanram/agent-factory/pull/613))
* **init** — prove each claude login with one real call; setup claude tries a token before storing it · [#665](https://github.com/chiyanram/agent-factory/issues/665) (PR [#718](https://github.com/chiyanram/agent-factory/pull/718))
* **loop** — the coordinator posts its numbered round with agent-factory grill · [#517](https://github.com/chiyanram/agent-factory/issues/517) (PR [#520](https://github.com/chiyanram/agent-factory/pull/520))
* **notify** — ping once when a ticket enters a person's turn, again only after it leaves · [#672](https://github.com/chiyanram/agent-factory/issues/672) (PR [#683](https://github.com/chiyanram/agent-factory/pull/683))
* **outcome** — what became of a merged ticket's change, read from the project's clone · [#487](https://github.com/chiyanram/agent-factory/issues/487) (PR [#576](https://github.com/chiyanram/agent-factory/pull/576))
* **process** — the engine reads card format v2, where the test-first card names edit-scope, with format versions per part · [#696](https://github.com/chiyanram/agent-factory/issues/696) (PR [#702](https://github.com/chiyanram/agent-factory/pull/702))
* **process** — the engine reads the rules pack's own card, lanes and finding format, checked in CI · [#484](https://github.com/chiyanram/agent-factory/issues/484) (PR [#500](https://github.com/chiyanram/agent-factory/pull/500))
* **request** — spec.body, a kept write of an issue store spec · [#542](https://github.com/chiyanram/agent-factory/issues/542) (PR [#591](https://github.com/chiyanram/agent-factory/pull/591))
* **retro** — agent-factory retro lists the failures seen on two or more merges, with no model · [#488](https://github.com/chiyanram/agent-factory/issues/488) (PR [#626](https://github.com/chiyanram/agent-factory/pull/626))
* **retro** — retro --draft runs the retro card once, read-only and capped, and the engine writes the lesson drafts · [#488](https://github.com/chiyanram/agent-factory/issues/488) (PR [#628](https://github.com/chiyanram/agent-factory/pull/628))
* **review** — each review pass streams, and keeps its stream as a trace · [#487](https://github.com/chiyanram/agent-factory/issues/487) (PR [#539](https://github.com/chiyanram/agent-factory/pull/539))
* **review** — each round records its findings per rule ID and bucket, and each acted-on row its rule ID · [#488](https://github.com/chiyanram/agent-factory/issues/488) (PR [#616](https://github.com/chiyanram/agent-factory/pull/616))
* **spec** — a spec may name the tickets it is blocked by, one per line · [#494](https://github.com/chiyanram/agent-factory/issues/494) (PR [#514](https://github.com/chiyanram/agent-factory/pull/514))
* **spec** — agent-factory spec --show prints a ticket's spec text in either store · [#542](https://github.com/chiyanram/agent-factory/issues/542) (PR [#545](https://github.com/chiyanram/agent-factory/pull/545))
* **spec** — the spec.body policy point and the check of a body to send · [#542](https://github.com/chiyanram/agent-factory/issues/542) (PR [#581](https://github.com/chiyanram/agent-factory/pull/581))
* **usage** — a merged ticket's outcome, under its block in usage · [#487](https://github.com/chiyanram/agent-factory/issues/487) (PR [#578](https://github.com/chiyanram/agent-factory/pull/578))
* **usage** — each ticket's touches, waits, rework rounds and cost, in the reader's zone · [#487](https://github.com/chiyanram/agent-factory/issues/487) (PR [#541](https://github.com/chiyanram/agent-factory/pull/541))
* **usage** — the approve and rescue touches, from the START and approval records · [#487](https://github.com/chiyanram/agent-factory/issues/487) (PR [#543](https://github.com/chiyanram/agent-factory/pull/543))
* **usage** — the merge touch, from Forge.landed and the merged record line · [#487](https://github.com/chiyanram/agent-factory/issues/487) (PR [#544](https://github.com/chiyanram/agent-factory/pull/544))

### 🐛 Fixes

* **adr** — a Today note runs to the end of its paragraph or cell, and the text before it stays frozen · [#605](https://github.com/chiyanram/agent-factory/issues/605) (PR [#606](https://github.com/chiyanram/agent-factory/pull/606))
* **agent** — the agent CLI seam for the read-only runs, with a time limit per run · [#687](https://github.com/chiyanram/agent-factory/issues/687) (PR [#692](https://github.com/chiyanram/agent-factory/pull/692))
* **agent** — writer runs behind the agent CLI seam; denies from the card's guardrails; test-first edits only test files · [#688](https://github.com/chiyanram/agent-factory/issues/688) (PR [#693](https://github.com/chiyanram/agent-factory/pull/693))
* **answers** — a round that does not hold the questions it names stays open; a letter followed by words is words · [#517](https://github.com/chiyanram/agent-factory/issues/517) (PR [#519](https://github.com/chiyanram/agent-factory/pull/519))
* **config** — check that each project clone's origin is the project's repo · [#640](https://github.com/chiyanram/agent-factory/issues/640) (PR [#648](https://github.com/chiyanram/agent-factory/pull/648))
* **coordinator** — deny edits outside the specs folder, WebFetch and WebSearch · [#676](https://github.com/chiyanram/agent-factory/issues/676) (PR [#684](https://github.com/chiyanram/agent-factory/pull/684))
* **dispatch** — a killed writer run keeps its work: the start line names its folder, the hand-over pushes its commits · [#704](https://github.com/chiyanram/agent-factory/issues/704) (PR [#724](https://github.com/chiyanram/agent-factory/pull/724))
* **dispatch** — the approval floor by lane name, a torn record line, the eval's cap while running · [#483](https://github.com/chiyanram/agent-factory/issues/483) (PR [#499](https://github.com/chiyanram/agent-factory/pull/499))
* **finish** — the writer's round is checked to read back before it is posted · [#522](https://github.com/chiyanram/agent-factory/issues/522) (PR [#531](https://github.com/chiyanram/agent-factory/pull/531))
* **init** — setup friction from the ledger pilot: release version, first-pin counts, profile export lines, no install script · [#482](https://github.com/chiyanram/agent-factory/issues/482) (PR [#502](https://github.com/chiyanram/agent-factory/pull/502))
* **post** — break _www. links and GH-12 references; read trailers after any blank lines · [#463](https://github.com/chiyanram/agent-factory/issues/463) (PR [#464](https://github.com/chiyanram/agent-factory/pull/464))
* **post** — scrub secrets from every model text the host posts · [#678](https://github.com/chiyanram/agent-factory/issues/678) (PR [#685](https://github.com/chiyanram/agent-factory/pull/685))
* **process** — read the rules pack's format version per part, so lanes-v2 no longer refuses the pack · [#600](https://github.com/chiyanram/agent-factory/issues/600) (PR [#604](https://github.com/chiyanram/agent-factory/pull/604))
* **retro** — retro <project> --json prints JSON, not text · [#488](https://github.com/chiyanram/agent-factory/issues/488) (PR [#627](https://github.com/chiyanram/agent-factory/pull/627))
* **runs** — every outside or model-written text a run reads sits in a labelled data fence · [#705](https://github.com/chiyanram/agent-factory/issues/705) (PR [#720](https://github.com/chiyanram/agent-factory/pull/720))
* **spec** — spec --show escapes terminal control characters · [#542](https://github.com/chiyanram/agent-factory/issues/542) (PR [#579](https://github.com/chiyanram/agent-factory/pull/579))
* **usage** — one fetch of the default branch per usage run, not one per merged ticket · [#487](https://github.com/chiyanram/agent-factory/issues/487) (PR [#585](https://github.com/chiyanram/agent-factory/pull/585))

Install: `npm i -g https://github.com/chiyanram/agent-factory/releases/download/v1.0.0/chiyanram-agent-factory-1.0.0.tgz`

## [0.34.1](https://github.com/chiyanram/agent-factory/compare/v0.34.0...v0.34.1) (2026-11-11)

### 🐛 Fixes

* **ready** — the box's git copy fetches the default branch even when it is git's own default · [#62](https://github.com/chiyanram/agent-factory/issues/62) (PR [#461](https://github.com/chiyanram/agent-factory/pull/461))

Install: `npm i -g https://github.com/chiyanram/agent-factory/releases/download/v0.34.1/chiyanram-agent-factory-0.34.1.tgz`

## [0.34.0](https://github.com/chiyanram/agent-factory/compare/v0.33.1...v0.34.0) (2026-11-11)

### ✨ Features

* **writer** — post the ready check's re-run beside each claim, and the build's deviations as notes the review reads · [#430](https://github.com/chiyanram/agent-factory/issues/430) (PR [#457](https://github.com/chiyanram/agent-factory/pull/457))

### 🐛 Fixes

* **dispatch** — a fix run after a new START that changes no code still goes to the ready check · [#62](https://github.com/chiyanram/agent-factory/issues/62) (PR [#459](https://github.com/chiyanram/agent-factory/pull/459))

Install: `npm i -g https://github.com/chiyanram/agent-factory/releases/download/v0.34.0/chiyanram-agent-factory-0.34.0.tgz`

## [0.33.1](https://github.com/chiyanram/agent-factory/compare/v0.33.0...v0.33.1) (2026-11-10)

### 🐛 Fixes

* **coordinator** — use the rulebook's rt4 types for retro actions · [#425](https://github.com/chiyanram/agent-factory/issues/425) (PR [#449](https://github.com/chiyanram/agent-factory/pull/449))
* **writer** — tell the implementer to quote evidence patterns with single quotes · [#62](https://github.com/chiyanram/agent-factory/issues/62) (PR [#458](https://github.com/chiyanram/agent-factory/pull/458))

Install: `npm i -g https://github.com/chiyanram/agent-factory/releases/download/v0.33.1/chiyanram-agent-factory-0.33.1.tgz`

## [0.33.0](https://github.com/chiyanram/agent-factory/compare/v0.32.2...v0.33.0) (2026-11-10)

### ✨ Features

* **process** — one process plugin per project: a second one fails config check and the run · [#426](https://github.com/chiyanram/agent-factory/issues/426) (PR [#442](https://github.com/chiyanram/agent-factory/pull/442))
* **process** — one shared finding record, the verify pass lowers grades only, retro actions as json · [#425](https://github.com/chiyanram/agent-factory/issues/425) (PR [#439](https://github.com/chiyanram/agent-factory/pull/439))
* **process** — role cards: guardrail ids from a closed list, an edit path scope checked on the run's commits, next dropped · [#424](https://github.com/chiyanram/agent-factory/issues/424) (PR [#440](https://github.com/chiyanram/agent-factory/pull/440))

### 🐛 Fixes

* **dispatch** — the loop runs the next pass at once after a step it ran itself · [#445](https://github.com/chiyanram/agent-factory/issues/445) (PR [#446](https://github.com/chiyanram/agent-factory/pull/446))
* **ready** — safe read-only evidence programs by default, refuse evidence that cannot prove its criterion, keep a reworked ticket moving · [#444](https://github.com/chiyanram/agent-factory/issues/444) (PR [#447](https://github.com/chiyanram/agent-factory/pull/447))

Install: `npm i -g https://github.com/chiyanram/agent-factory/releases/download/v0.33.0/chiyanram-agent-factory-0.33.0.tgz`

## [0.32.2](https://github.com/chiyanram/agent-factory/compare/v0.32.1...v0.32.2) (2026-11-10)

### 🐛 Fixes

* **box** — give each srt run a short temp folder, so srt's sockets fit macOS's limit · [#62](https://github.com/chiyanram/agent-factory/issues/62) (PR [#437](https://github.com/chiyanram/agent-factory/pull/437))
* **dispatch** — pick test-first from the lanes file's test_first, not the lane name "bug" · [#417](https://github.com/chiyanram/agent-factory/issues/417) (PR [#436](https://github.com/chiyanram/agent-factory/pull/436))

Install: `npm i -g https://github.com/chiyanram/agent-factory/releases/download/v0.32.2/chiyanram-agent-factory-0.32.2.tgz`

## [0.32.1](https://github.com/chiyanram/agent-factory/compare/v0.32.0...v0.32.1) (2026-11-10)

### 🐛 Fixes

* **box** — every srt run gets its own writable TMPDIR inside its private home · [#62](https://github.com/chiyanram/agent-factory/issues/62) (PR [#415](https://github.com/chiyanram/agent-factory/pull/415))

Install: `npm i -g https://github.com/chiyanram/agent-factory/releases/download/v0.32.1/chiyanram-agent-factory-0.32.1.tgz`

## [0.32.0](https://github.com/chiyanram/agent-factory/compare/v0.31.0...v0.32.0) (2026-11-10)

### ✨ Features

* **spec** — on a personal project the git host issue is the spec · [#381](https://github.com/chiyanram/agent-factory/issues/381) (PR [#399](https://github.com/chiyanram/agent-factory/pull/399))

### 🐛 Fixes

* **dispatch** — a writer run that stops records and logs why, even before a PR exists · [#62](https://github.com/chiyanram/agent-factory/issues/62) (PR [#408](https://github.com/chiyanram/agent-factory/pull/408))
* **onboard** — the engine owns the project rules and drops a false absence claim instead of refusing the brief · [#383](https://github.com/chiyanram/agent-factory/issues/383) (PR [#403](https://github.com/chiyanram/agent-factory/pull/403))

Install: `npm i -g https://github.com/chiyanram/agent-factory/releases/download/v0.32.0/chiyanram-agent-factory-0.32.0.tgz`

## [0.31.0](https://github.com/chiyanram/agent-factory/compare/v0.30.2...v0.31.0) (2026-11-10)

### ✨ Features

* **settings** — every command reads the project's git host and clone from the project file · [#382](https://github.com/chiyanram/agent-factory/issues/382) (PR [#394](https://github.com/chiyanram/agent-factory/pull/394))

### 🐛 Fixes

* **onboard** — the brief carries the repo's AGENTS.md MUSTs and a verified line must be backed by its cite · [#383](https://github.com/chiyanram/agent-factory/issues/383) (PR [#393](https://github.com/chiyanram/agent-factory/pull/393))

Install: `npm i -g https://github.com/chiyanram/agent-factory/releases/download/v0.31.0/chiyanram-agent-factory-0.31.0.tgz`

## [0.30.2](https://github.com/chiyanram/agent-factory/compare/v0.30.1...v0.30.2) (2026-11-10)

### 🐛 Fixes

* **forge** — back off on a GitHub rate limit instead of retrying, and spend fewer points per pass · [#62](https://github.com/chiyanram/agent-factory/issues/62) (PR [#388](https://github.com/chiyanram/agent-factory/pull/388))

Install: `npm i -g https://github.com/chiyanram/agent-factory/releases/download/v0.30.2/chiyanram-agent-factory-0.30.2.tgz`

## [0.30.1](https://github.com/chiyanram/agent-factory/compare/v0.30.0...v0.30.1) (2026-11-10)

### 🐛 Fixes

* **process** — a role card's hand-off may name a question's fields · [#62](https://github.com/chiyanram/agent-factory/issues/62) (PR [#379](https://github.com/chiyanram/agent-factory/pull/379))

Install: `npm i -g https://github.com/chiyanram/agent-factory/releases/download/v0.30.1/chiyanram-agent-factory-0.30.1.tgz`

## [0.30.0](https://github.com/chiyanram/agent-factory/compare/v0.29.0...v0.30.0) (2026-11-10)

### ✨ Features

* **setup** — agent-factory init sets up a laptop and a project in one guided run · [#369](https://github.com/chiyanram/agent-factory/issues/369) (PR [#377](https://github.com/chiyanram/agent-factory/pull/377))

Install: `npm i -g https://github.com/chiyanram/agent-factory/releases/download/v0.30.0/chiyanram-agent-factory-0.30.0.tgz`

## [0.29.0](https://github.com/chiyanram/agent-factory/compare/v0.28.0...v0.29.0) (2026-11-10)

### ✨ Features

* **box** — the srt runner allows back toolchain managers read-only · [#371](https://github.com/chiyanram/agent-factory/issues/371) (PR [#372](https://github.com/chiyanram/agent-factory/pull/372))

Install: [build and install the packed tarball](https://github.com/chiyanram/agent-factory/blob/v0.29.0/GUIDE.md#install-a-pinned-version)

## [0.28.0](https://github.com/chiyanram/agent-factory/compare/v0.27.0...v0.28.0) (2026-11-10)

### ✨ Features

* **box** — run the implementer inside srt on the work laptop · [#114](https://github.com/chiyanram/agent-factory/issues/114) (PR [#360](https://github.com/chiyanram/agent-factory/pull/360))

### 🐛 Fixes

* **box** — the srt runner hides the whole home and allows back only the agent CLI and Node · [#114](https://github.com/chiyanram/agent-factory/issues/114) (PR [#362](https://github.com/chiyanram/agent-factory/pull/362))

Install: `npm i -g github:chiyanram/agent-factory#v0.28.0`

## [0.27.0](https://github.com/chiyanram/agent-factory/compare/v0.26.0...v0.27.0) (2026-11-10)

### ✨ Features

* **dispatch** — a human's command starts the orchestrator loop, which ends by itself; no cron · [#305](https://github.com/chiyanram/agent-factory/issues/305) (PR [#311](https://github.com/chiyanram/agent-factory/pull/311))
* **dispatch** — cap spend per ticket, per project-day and per window share · [#131](https://github.com/chiyanram/agent-factory/issues/131) (PR [#294](https://github.com/chiyanram/agent-factory/pull/294))
* **dispatch** — flag a late orchestrator in status, and merge the default branch in on a conflict · [#103](https://github.com/chiyanram/agent-factory/issues/103) (PR [#259](https://github.com/chiyanram/agent-factory/pull/259))
* **dispatch** — record every run's tokens and cost, and add the usage command · [#131](https://github.com/chiyanram/agent-factory/issues/131) (PR [#286](https://github.com/chiyanram/agent-factory/pull/286))
* **dispatch** — run the design review before the approval and the cleanup run after the implementer · [#236](https://github.com/chiyanram/agent-factory/issues/236) (PR [#313](https://github.com/chiyanram/agent-factory/pull/313))
* **dispatch** — runs at once and run hours for the orchestrator · [#299](https://github.com/chiyanram/agent-factory/issues/299) (PR [#308](https://github.com/chiyanram/agent-factory/pull/308))
* **dispatch** — the run record keeps each lens's unique findings, and ADR-0004 says what is built · [#237](https://github.com/chiyanram/agent-factory/issues/237) (PR [#333](https://github.com/chiyanram/agent-factory/pull/333))
* **dispatch** — usage shows spend by run kind · [#337](https://github.com/chiyanram/agent-factory/issues/337) (PR [#338](https://github.com/chiyanram/agent-factory/pull/338))
* **dispatch** — usage splits a review round into finder and verify pass · [#337](https://github.com/chiyanram/agent-factory/issues/337) (PR [#340](https://github.com/chiyanram/agent-factory/pull/340))
* **egress** — agent-factory egress check runs the live egress checks in a real runner · [#130](https://github.com/chiyanram/agent-factory/issues/130) (PR [#292](https://github.com/chiyanram/agent-factory/pull/292))
* **egress** — plan and read the live egress checks, with a Node probe for the runner · [#130](https://github.com/chiyanram/agent-factory/issues/130) (PR [#291](https://github.com/chiyanram/agent-factory/pull/291))
* **egress** — refuse a git host on the egress allowlist · [#130](https://github.com/chiyanram/agent-factory/issues/130) (PR [#290](https://github.com/chiyanram/agent-factory/pull/290))
* **eval** — CI proof check for a change to a reviewer input · [#217](https://github.com/chiyanram/agent-factory/issues/217) (PR [#289](https://github.com/chiyanram/agent-factory/pull/289))
* **lint** — check each AGENTS.md MUST that code can check · [#221](https://github.com/chiyanram/agent-factory/issues/221) (PR [#284](https://github.com/chiyanram/agent-factory/pull/284))
* **onboard** — stage a project's brief and glossary in the project home for a human, and hand them to every run · [#235](https://github.com/chiyanram/agent-factory/issues/235) (PR [#314](https://github.com/chiyanram/agent-factory/pull/314))
* **plugin** — add plugin update <project> <name@marketplace>, which shows the change, runs config check, then moves the pin · [#232](https://github.com/chiyanram/agent-factory/issues/232) (PR [#293](https://github.com/chiyanram/agent-factory/pull/293))
* **plugin** — fetch a plugin version from its marketplace's clone into the factory home's store, by its hash · [#232](https://github.com/chiyanram/agent-factory/issues/232) (PR [#288](https://github.com/chiyanram/agent-factory/pull/288))
* **plugin** — hand the pinned plugins to the writer with --plugin-dir and record their hashes · [#232](https://github.com/chiyanram/agent-factory/issues/232) (PR [#297](https://github.com/chiyanram/agent-factory/pull/297))
* **plugin** — pin each listed plugin by commit and hash in the factory home, and check the hash before every run · [#232](https://github.com/chiyanram/agent-factory/issues/232) (PR [#287](https://github.com/chiyanram/agent-factory/pull/287))
* **plugin** — read the lanes and the review baseline from the process plugin, with a built-in default · [#232](https://github.com/chiyanram/agent-factory/issues/232) (PR [#261](https://github.com/chiyanram/agent-factory/pull/261))
* **review** — a finding carries its lens, grade and evidence, and a lane its lens count · [#237](https://github.com/chiyanram/agent-factory/issues/237) (PR [#321](https://github.com/chiyanram/agent-factory/pull/321))
* **review** — a Spec finding quotes the approved spec's criterion it fails · [#219](https://github.com/chiyanram/agent-factory/issues/219) (PR [#309](https://github.com/chiyanram/agent-factory/pull/309))
* **review** — add a Martian category to each finding, and keep its severity · [#218](https://github.com/chiyanram/agent-factory/issues/218) (PR [#304](https://github.com/chiyanram/agent-factory/pull/304))
* **review** — one finder run per picked lens, merged, then one verify pass · [#237](https://github.com/chiyanram/agent-factory/issues/237) (PR [#332](https://github.com/chiyanram/agent-factory/pull/332))
* **review** — pick a round's lenses by blast radius, and merge their findings by file:line and rule · [#237](https://github.com/chiyanram/agent-factory/issues/237) (PR [#310](https://github.com/chiyanram/agent-factory/pull/310))
* **review** — pin the reviewer's and the judge's models to full ids, and refuse an alias · [#213](https://github.com/chiyanram/agent-factory/issues/213) (PR [#303](https://github.com/chiyanram/agent-factory/pull/303))
* **review** — record the automated review's acted-on rate, and show it in usage · [#220](https://github.com/chiyanram/agent-factory/issues/220) (PR [#312](https://github.com/chiyanram/agent-factory/pull/312))
* **review** — send the engine's floor ahead of every find and verify pass, whatever instructions replace the default · [#232](https://github.com/chiyanram/agent-factory/issues/232) (PR [#302](https://github.com/chiyanram/agent-factory/pull/302))
* **review** — the project's lenses in the settings, and what each finder is given · [#237](https://github.com/chiyanram/agent-factory/issues/237) (PR [#331](https://github.com/chiyanram/agent-factory/pull/331))
* **settings** — every module reads the resolved settings through one adapter · [#254](https://github.com/chiyanram/agent-factory/issues/254) (PR [#258](https://github.com/chiyanram/agent-factory/pull/258))
* **writer** — ask every open question at once, as one round of choices with a recommendation · [#320](https://github.com/chiyanram/agent-factory/issues/320) (PR [#325](https://github.com/chiyanram/agent-factory/pull/325))
* **writer** — post the implementer's PR body as cleaned Markdown · [#335](https://github.com/chiyanram/agent-factory/issues/335) (PR [#336](https://github.com/chiyanram/agent-factory/pull/336))

### 🐛 Fixes

* **dispatch** — count a failed review round's spend toward the caps · [#131](https://github.com/chiyanram/agent-factory/issues/131) (PR [#300](https://github.com/chiyanram/agent-factory/pull/300))
* **onboard** — read the project's plugins and the pinned model, and drop ownHelper, so main builds again · [#235](https://github.com/chiyanram/agent-factory/issues/235) (PR [#318](https://github.com/chiyanram/agent-factory/pull/318))
* **release** — leave git trailers out of breaking-change release notes · [#343](https://github.com/chiyanram/agent-factory/issues/343) (PR [#349](https://github.com/chiyanram/agent-factory/pull/349))
* **review** — name the rulebook setting through settingName, so main's no-direct-read test passes · [#254](https://github.com/chiyanram/agent-factory/issues/254) (PR [#283](https://github.com/chiyanram/agent-factory/pull/283))

Install: `npm i -g github:chiyanram/agent-factory#v0.27.0`

## [0.26.0](https://github.com/chiyanram/agent-factory/compare/v0.25.0...v0.26.0) (2026-11-09)

### ✨ Features

* **plugin** — rename the connector map to connectors and add the plugins list key · [#232](https://github.com/chiyanram/agent-factory/issues/232) (PR [#257](https://github.com/chiyanram/agent-factory/pull/257))

Install: `npm i -g github:chiyanram/agent-factory#v0.26.0`

## [0.25.0](https://github.com/chiyanram/agent-factory/compare/v0.24.0...v0.25.0) (2026-11-09)

### ✨ Features

* **dispatch** — set the lane by code from the planned files and the diff, raise only, with an approval floor · [#230](https://github.com/chiyanram/agent-factory/issues/230) (PR [#253](https://github.com/chiyanram/agent-factory/pull/253))

Install: `npm i -g github:chiyanram/agent-factory#v0.25.0`

## [0.24.0](https://github.com/chiyanram/agent-factory/compare/v0.23.0...v0.24.0) (2026-11-09)

### ✨ Features

* **ready** — judge files (S4), fewer test cases (S1), and a human waiver scoped to the head · [#231](https://github.com/chiyanram/agent-factory/issues/231) (PR [#252](https://github.com/chiyanram/agent-factory/pull/252))

Install: `npm i -g github:chiyanram/agent-factory#v0.24.0`

## [0.23.0](https://github.com/chiyanram/agent-factory/compare/v0.22.0...v0.23.0) (2026-11-09)

### ✨ Features

* **eval** — agent-factory eval reviewer with the judge, the results file and the $100 cap · [#215](https://github.com/chiyanram/agent-factory/issues/215) (PR [#251](https://github.com/chiyanram/agent-factory/pull/251))
* **settings** — resolve team, project and user layers where safety keys only get stricter · [#229](https://github.com/chiyanram/agent-factory/issues/229) (PR [#250](https://github.com/chiyanram/agent-factory/pull/250))

Install: `npm i -g github:chiyanram/agent-factory#v0.23.0`

## [0.22.0](https://github.com/chiyanram/agent-factory/compare/v0.21.0...v0.22.0) (2026-11-09)

### ✨ Features

* **ready** — keep a failed ready check's output, so the rework run sees why it failed · [#199](https://github.com/chiyanram/agent-factory/issues/199) (PR [#249](https://github.com/chiyanram/agent-factory/pull/249))

Install: `npm i -g github:chiyanram/agent-factory#v0.22.0`

## [0.21.0](https://github.com/chiyanram/agent-factory/compare/v0.20.1...v0.21.0) (2026-11-09)

### ✨ Features

* **dispatch** — START and approval records; nothing starts without a human, and the AI can never approve · [#227](https://github.com/chiyanram/agent-factory/issues/227) (PR [#248](https://github.com/chiyanram/agent-factory/pull/248))

Install: `npm i -g github:chiyanram/agent-factory#v0.21.0`

## [0.20.1](https://github.com/chiyanram/agent-factory/compare/v0.20.0...v0.20.1) (2026-11-09)

### 🐛 Fixes

* **plugin** — keep a UTF-8 character whole when a plugin's output splits it · [#246](https://github.com/chiyanram/agent-factory/issues/246) (PR [#247](https://github.com/chiyanram/agent-factory/pull/247))

Install: `npm i -g github:chiyanram/agent-factory#v0.20.1`

## [0.20.0](https://github.com/chiyanram/agent-factory/compare/v0.19.0...v0.20.0) (2026-11-09)

### ✨ Features

* **review** — the review pack always carries the baseline review checks · [#226](https://github.com/chiyanram/agent-factory/issues/226) (PR [#244](https://github.com/chiyanram/agent-factory/pull/244))

Install: `npm i -g github:chiyanram/agent-factory#v0.20.0`

## [0.19.0](https://github.com/chiyanram/agent-factory/compare/v0.18.0...v0.19.0) (2026-11-09)

### ✨ Features

* **writer** — stop a silent run at the stall time; a failed step backs off before it retries · [#228](https://github.com/chiyanram/agent-factory/issues/228) (PR [#243](https://github.com/chiyanram/agent-factory/pull/243))

Install: `npm i -g github:chiyanram/agent-factory#v0.19.0`

## [0.18.0](https://github.com/chiyanram/agent-factory/compare/v0.17.0...v0.18.0) (2026-11-09)

### ✨ Features

* **review** — the reviewer reads the approved spec and design from the spec store · [#224](https://github.com/chiyanram/agent-factory/issues/224) (PR [#242](https://github.com/chiyanram/agent-factory/pull/242))

Install: `npm i -g github:chiyanram/agent-factory#v0.18.0`

## [0.17.0](https://github.com/chiyanram/agent-factory/compare/v0.16.0...v0.17.0) (2026-11-09)

### ✨ Features

* **notify** — Discord pings when a ticket needs a person · [#119](https://github.com/chiyanram/agent-factory/issues/119) (PR [#211](https://github.com/chiyanram/agent-factory/pull/211))

### 🐛 Fixes

* **writer** — every writer prompt says to run subagents and commands in the foreground · [#192](https://github.com/chiyanram/agent-factory/issues/192) (PR [#210](https://github.com/chiyanram/agent-factory/pull/210))

Install: `npm i -g github:chiyanram/agent-factory#v0.17.0`

## [0.16.0](https://github.com/chiyanram/agent-factory/compare/v0.15.1...v0.16.0) (2026-11-08)

### ✨ Features

* **writer** — a completion window: a writer that hangs after a valid report is decided from the report · [#182](https://github.com/chiyanram/agent-factory/issues/182) (PR [#208](https://github.com/chiyanram/agent-factory/pull/208))

Install: `npm i -g github:chiyanram/agent-factory#v0.16.0`

## [0.15.1](https://github.com/chiyanram/agent-factory/compare/v0.15.0...v0.15.1) (2026-11-08)

### 🐛 Fixes

* **writer** — the writer loads no settings from the branch, and the push refuses a change to them · [#110](https://github.com/chiyanram/agent-factory/issues/110) (PR [#207](https://github.com/chiyanram/agent-factory/pull/207))

Install: `npm i -g github:chiyanram/agent-factory#v0.15.1`

## [0.15.0](https://github.com/chiyanram/agent-factory/compare/v0.14.1...v0.15.0) (2026-11-08)

### ✨ Features

* **ready** — the floor guard: a diff that weakens tests or silences a checker fails the ready check · [#190](https://github.com/chiyanram/agent-factory/issues/190) (PR [#203](https://github.com/chiyanram/agent-factory/pull/203))

Install: `npm i -g github:chiyanram/agent-factory#v0.15.0`

## [0.14.1](https://github.com/chiyanram/agent-factory/compare/v0.14.0...v0.14.1) (2026-11-08)

### 🐛 Fixes

* **loop** — reconcile keeps a writer's worktree that holds unlanded work · [#189](https://github.com/chiyanram/agent-factory/issues/189) (PR [#201](https://github.com/chiyanram/agent-factory/pull/201))

Install: `npm i -g github:chiyanram/agent-factory#v0.14.1`

## [0.14.0](https://github.com/chiyanram/agent-factory/compare/v0.13.0...v0.14.0) (2026-11-08)

### ✨ Features

* **writer** — rework and ci runs in the box, with the project's lint hook · [#171](https://github.com/chiyanram/agent-factory/issues/171) (PR [#193](https://github.com/chiyanram/agent-factory/pull/193))

Install: `npm i -g github:chiyanram/agent-factory#v0.14.0`

## [0.13.0](https://github.com/chiyanram/agent-factory/compare/v0.12.0...v0.13.0) (2026-11-08)

### ✨ Features

* **plugin** — the forge as a plugin, and the kit's write-fidelity check ([#134](https://github.com/chiyanram/agent-factory/issues/134) part C) · PR [#194](https://github.com/chiyanram/agent-factory/pull/194)

Install: `npm i -g github:chiyanram/agent-factory#v0.13.0`

## [0.12.0](https://github.com/chiyanram/agent-factory/compare/v0.11.0...v0.12.0) (2026-11-08)

### ✨ Features

* **writer** — every writer commit carries "Agent: writer"; the host push refuses one without it · [#128](https://github.com/chiyanram/agent-factory/issues/128) (PR [#191](https://github.com/chiyanram/agent-factory/pull/191))

Install: `npm i -g github:chiyanram/agent-factory#v0.12.0`

## [0.11.0](https://github.com/chiyanram/agent-factory/compare/v0.10.0...v0.11.0) (2026-11-08)

### ✨ Features

* **plugin** — the write policy, request and confirm, and project init ([#134](https://github.com/chiyanram/agent-factory/issues/134) part B) · PR [#184](https://github.com/chiyanram/agent-factory/pull/184)

Install: `npm i -g github:chiyanram/agent-factory#v0.11.0`

## [0.10.0](https://github.com/chiyanram/agent-factory/compare/v0.9.0...v0.10.0) (2026-11-08)

### ✨ Features

* **plugin** — the plugin contract, a pinned registry and the contract test kit ([#134](https://github.com/chiyanram/agent-factory/issues/134) part A) · PR [#174](https://github.com/chiyanram/agent-factory/pull/174)

Install: `npm i -g github:chiyanram/agent-factory#v0.10.0`

## [0.9.0](https://github.com/chiyanram/agent-factory/compare/v0.8.0...v0.9.0) (2026-11-08)

### ✨ Features

* **writer** — the dispatcher's writer runs test-first and fix in the box, and the host pushes and posts · [#113](https://github.com/chiyanram/agent-factory/issues/113) (PR [#173](https://github.com/chiyanram/agent-factory/pull/173))

Install: `npm i -g github:chiyanram/agent-factory#v0.9.0`

## [0.8.0](https://github.com/chiyanram/agent-factory/compare/v0.7.0...v0.8.0) (2026-11-08)

### ✨ Features

* **coordinator** — the coordinator's wall as harness settings, set up and started by agent-factory · [#106](https://github.com/chiyanram/agent-factory/issues/106) (PR [#172](https://github.com/chiyanram/agent-factory/pull/172))

Install: `npm i -g github:chiyanram/agent-factory#v0.8.0`

## [0.7.0](https://github.com/chiyanram/agent-factory/compare/v0.6.0...v0.7.0) (2026-11-07)

### ✨ Features

* **box** — box build, one egress proxy per project, and the vm box on the dispatcher · [#113](https://github.com/chiyanram/agent-factory/issues/113) (PR [#170](https://github.com/chiyanram/agent-factory/pull/170))
* **push** — the host push refuses any commit that touches CI config · [#115](https://github.com/chiyanram/agent-factory/issues/115) (PR [#169](https://github.com/chiyanram/agent-factory/pull/169))

### 🐛 Fixes

* **git** — hgit and hostGit skip the system config when GIT_CONFIG_NOSYSTEM is set · [#167](https://github.com/chiyanram/agent-factory/issues/167) (PR [#168](https://github.com/chiyanram/agent-factory/pull/168))

Install: `npm i -g github:chiyanram/agent-factory#v0.7.0`

## [0.6.0](https://github.com/chiyanram/agent-factory/compare/v0.5.0...v0.6.0) (2026-11-07)

### ✨ Features

* **cli** — the loop commands, the lint hook and the repo checks in TypeScript ([#138](https://github.com/chiyanram/agent-factory/issues/138) part 3) · PR [#166](https://github.com/chiyanram/agent-factory/pull/166)

Install: `npm i -g github:chiyanram/agent-factory#v0.6.0`

## [0.5.0](https://github.com/chiyanram/agent-factory/compare/v0.4.0...v0.5.0) (2026-11-07)

### ✨ Features

* **forge** — openChange: the host opens a draft change after a ticket's first push · [#164](https://github.com/chiyanram/agent-factory/issues/164) (PR [#165](https://github.com/chiyanram/agent-factory/pull/165))

Install: `npm i -g github:chiyanram/agent-factory#v0.5.0`

## [0.4.0](https://github.com/chiyanram/agent-factory/compare/v0.3.0...v0.4.0) (2026-11-07)

### ✨ Features

* **cli** — the ready check and the local verifier, in a fresh box ([#138](https://github.com/chiyanram/agent-factory/issues/138) part 2; [#91](https://github.com/chiyanram/agent-factory/issues/91)) · PR [#163](https://github.com/chiyanram/agent-factory/pull/163)

Install: `npm i -g github:chiyanram/agent-factory#v0.4.0`

## [0.3.0](https://github.com/chiyanram/agent-factory/compare/v0.2.0...v0.3.0) (2026-11-07)

### ✨ Features

* **box** — the vm box: factory-box image and a Box over the docker CLI, run under Sysbox · [#113](https://github.com/chiyanram/agent-factory/issues/113) (PR [#160](https://github.com/chiyanram/agent-factory/pull/160))

Install: `npm i -g github:chiyanram/agent-factory#v0.3.0`

## [0.2.0](https://github.com/chiyanram/agent-factory/compare/v0.1.0...v0.2.0) (2026-11-07)

### Features

* **cli:** port the reviewer to TypeScript ([#138](https://github.com/chiyanram/agent-factory/issues/138) part 1; [#117](https://github.com/chiyanram/agent-factory/issues/117), [#118](https://github.com/chiyanram/agent-factory/issues/118)) ([#159](https://github.com/chiyanram/agent-factory/issues/159)) ([36c670d](https://github.com/chiyanram/agent-factory/commit/36c670dc52d0cd4f9cf9ac80a4a78ff777a0d625)), closes [#91](https://github.com/chiyanram/agent-factory/issues/91)

## [0.1.0](https://github.com/chiyanram/agent-factory/compare/v0.0.0...v0.1.0) (2026-11-07)

### Features

* **cli:** the dispatcher: one decision table with a stop on every row, run records, one locked pass ([#103](https://github.com/chiyanram/agent-factory/issues/103)) ([#154](https://github.com/chiyanram/agent-factory/issues/154)) ([756a6a5](https://github.com/chiyanram/agent-factory/commit/756a6a5ff215e85deffda7adc8999ef188be07cc)), closes [#113](https://github.com/chiyanram/agent-factory/issues/113) [#138](https://github.com/chiyanram/agent-factory/issues/138)
* **setup:** agent-factory setup stores the box's model-only claude token; a box never starts with an expired one ([#136](https://github.com/chiyanram/agent-factory/issues/136)) ([#155](https://github.com/chiyanram/agent-factory/issues/155)) ([45d7420](https://github.com/chiyanram/agent-factory/commit/45d7420560137f32a3270bdb4eaabb7ad228f30e))
