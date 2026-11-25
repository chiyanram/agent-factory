# The orchestrator

What the orchestrator (code, no model) does with a ticket once a person has STARTed it: how a run ends, the decision
table it follows, the ready check, and what each rework run is handed. The coordinator's own instructions are
[prompts/coordinator.md](../../prompts/coordinator.md); the decisions behind this page are ADR-0012 and the
[constitution](../CONSTITUTION.md). The code is the source of truth; this page follows it (#486).

## How a run ends

A run ends with a report (#109, [`src/core/report.ts`](../../src/core/report.ts)). The implementer writes `.factory/report.json` (never committed)
and exits: `status` `done` with `evidence` rows (criterion, command, result), `asked` with one to twenty `questions`
(`MOST_QUESTIONS`), or `blocked` with a `blocker`. The host checks it, then acts (`src/core/finish.ts`):

- `done` → push, post the evidence, run the ready check.
- `asked` → push, post the questions in one `[writer] OPEN:` note, wait (the answers that close it, and how the next
  run receives them, are under [Answers](#answers)). A note that would not read back as written (a question cut at
  500 characters, or split by a ` · ` or ` A) ` in its text) is never posted as `OPEN:`: the change gets
  `needs-human` and one `[coordinator] blocked:` note naming the question, with the questions as written listed.
- `blocked` → label `needs-human` first, push the work in progress only on top of the branch, post `blocked: <reason>`
  (with the implementer's prefix when the implementer said it).
- **parked** (the host's, never the report's) → the provider's usage limit refused the run, so its work in progress is
  pushed only on top of the branch, with no label and no note, and a `parked` record line keeps the reset time and
  the run's task. See [The provider's usage limit](#the-providers-usage-limit).

A missing, unreadable or malformed
report, any other field, a non-zero exit, a timeout, a stall or a failed runner is `blocked` with the reason; a
reason never quotes the report. Its record line also names how it ended (see
[How a run record says why the run ended](#how-a-run-record-says-why-the-run-ended)). The host decides from the report only after the runner has stopped, never through a
symlink, and refuses to push when any new commit touches `.factory` (`excludeFactory` keeps it out of `git add`).
While the implementer runs, the host looks for a report the schema accepts every 5 s; once one is there, the
implementer has a 60 s completion window. An implementer still running at its end (a child such as `gh` or an MCP
server can keep it from exiting) is stopped, and the run is decided from its report, read again after the stop; its
note then says the implementer hung, and so does the run record (#182). The runner's own timeout firing inside the
window counts the same. A run with no valid report waits out its timeout and is `blocked`; past the timeout and a
30 s grace the host stops the runner itself, since the runner's timeout stops counting once `claude` exits and a child holding stdout open would keep the pass waiting. The window's
edge is not exact: a run that exits as the window closes may still read as hung.
The implementer streams its output (`--output-format stream-json`). A run with no valid report that prints nothing for
the stall time (`FACTORY_WRITER_STALL_MINUTES`, 5 minutes) is stopped and `blocked`, so it goes to `needs-human`;
its note shows its last five output lines, each cleaned by `post.ts` (#228). Time the machine spends asleep does not
count: each 5 s poll adds at most 10 s of silence.
The host reads the stream's last line, the result event, for the run's cost and tokens (`total_cost_usd` and every
`usage` token, cache reads and writes too), and keeps them as `spend` on the run's `writer-ended` record; a review
round's `review-ended` record keeps what its passes spent the same way (#131). A run stopped before its result event
has no `spend`: `usage` counts it as unmeasured, never as free. The dollar figure is the CLI's own; on a
subscription it need not be what you are charged, so count tokens there.
A run that ends `blocked` or `asked` says why, even before its PR exists (#62): its `writer-ended` record carries
`why` (the implementer's blocker or questions, or the host's reason, such as `the run exited 1` or `the run wrote no
.factory/report.json`, followed by `the run said: …`, the CLI's last words), and the pass logs
`<ticket>: writer blocked: <why>` in place of `done`, with `there is no open change to say so on` when no PR exists
yet, and the ping on the pass after it says it too. A run the host blocked also keeps the last 40 lines of its stdout and stderr in
`$FACTORY_HOME/runs/<project>/<ticket>/writer-<time>.log`, named as `output` in the record and the log line. Every
reason and kept line has what looks like a token or key scrubbed (`src/core/writer/why.ts`). To read why a run
stopped, read that record line and that file; on a PR, the run's note says the same.
Every implementer run also keeps its whole stream-json output as its trace (#487), written as it comes, one line at a
time, each scrubbed: `$FACTORY_HOME/runs/<project>/<ticket>/writer-<time>.jsonl`, private to you. Its `writer-ended`
record names it as `trace`; a run that failed after it spent names it in its `spent` line's `traces`. A trace stops
at 50 MB, and its last line then says it was cut. A run that printed nothing, such as one whose runner never started,
keeps none. A line still being printed that is past the room left cuts the trace at once, and nothing after a cut is
held. Each orchestrator pass first deletes the project's traces older than 30 days, by the time in the name, as
`agent-factory trace` does. `agent-factory trace <project> <ticket>` lists them; with a trace's name it prints it
(`src/core/dispatch/trace.ts`).
Each pass of an automated review round streams too (`--output-format stream-json --verbose`), and its answer is the
stream's last result event. Each finder keeps its stream as `finder-<lens>-<time>.jsonl` and each verify pass as
`verify-<time>.jsonl`, in the same folder, named in the round's `review-ended` line, or its `spent` line when a pass
failed, as `traces` (`src/core/review/step.ts`). A design review's two runs keep theirs as `design-review-<time>.jsonl`
and `design-verify-<time>.jsonl`, named as `trace` on their `design-ended` line; the onboarder's goes in
`$FACTORY_HOME/runs/<project>/onboarder/`, named in its `spent` line's `traces`. `agent-factory trace` names whichever
line names a trace. A line of a trace that is not JSON has every terminal control character but the tab escaped as
`\u00XX`, so printing it moves no cursor; a JSON line is escaped already.
The caps then hold before each run, never during one (`src/core/dispatch/caps.ts`): per run, `FACTORY_MAX_USD` is
the CLI's `--max-budget-usd`; per ticket, a ticket at its cap goes to `needs-human` with its spend shown; per project
and day, and at the window share, the pass starts no run, records each held one as unavailable, and sends one notice
per day or window. A run already going is never stopped for a cap, so a cap can be passed by the run that reaches it.
A review round that fails (a pass at its budget, say) writes a `spent` line with what every pass spent, the failed
one's too: its start still reads as a run that never ended, so a person looks, and its spend counts toward the caps and
`usage`.
Every implementer prompt also says to run subagents and commands in the foreground and wait for them (#192, `FOREGROUND`
in `src/core/writer/prompt.ts`), so nothing is left in the background when the run ends.
Every build run starts from its role card (#232): test-first, the implementer (fix, rework, CI and merge runs) or
cleanup, from the engine's `prompts/roles/`. The prompt is the card's
body, then the run's task in the engine's words, then the engine's floor (`FLOOR` in `src/core/writer/prompt.ts`),
which no card can drop. The engine enforces the card's frontmatter (`src/core/process/cards.ts`): its `tools` are
the run's only tools (`claude --tools`, with the task list, skills and subagents, which add no reach); its
`must_not_see` leaves those inputs out of the run, on top of the role's own floor, and a card that leaves out what
the run needs (the spec, its task) stops the run for a person; each field its `hand_off` names must be one the
engine's schema for the role has, and what the run returns is read with that schema. A card that fails a check
stops the run for a person. The design review's runs follow the same card rules. **Today:** the automated review's find
and verify passes still read `prompts/review-find.md` and `prompts/review-verify.md`, not the finder and verify-pass
cards: they and `prompts/eval-judge.md` stay until the automated review's eval has a baseline
(`scripts/check-eval-proof.ts`).

## What a run record names

Each model run's record names the agent CLI that ran it, the CLI's version and the model (`src/core/agent/ran.ts`).
A model run is an implementer run (any build run), an automated review round, or a design review's design-reviewer or
verify run; a ready check and the local verifier run no model, so their lines name none of this.

- The `started` line names `cli` and `asks`: the model each part of the run asked for. An implementer run names
  `{"writer": <id>}`, or `default` when `FACTORY_WRITER_MODEL` is unset; a review round names its three settings,
  `{"find", "rule", "logic"}`; a design run names `{"design": <id>}`.
- The end line (`writer-ended`, `review-ended`, `design-ended`, `spent` or `parked`) names `runs`: one entry per model
  run, each with `cli`, `asked`, and the `version` and `model` the CLI's own init event reported
  (`claude_code_version` and `model`). A review round's entries also name their `part`: the finder's lens, or
  `verify` for a verify run, one per kind of finding, so a round can hold two.
- A run whose stream has no init event keeps `cli` and `asked` and has no `version` or `model`: read that as
  unreported, never as a guess. A run that died before its end line keeps its init event only in its trace.
- Every Claude run starts with `DISABLE_AUTOUPDATER=1`, so no run updates its CLI mid-run.

The fields are optional. A line without them reads as before, and a value of the wrong shape is dropped on read, not
failed, since no count, cap or decision reads them. `board`, `usage` and every other print show none of them yet.

**Rollback:** nothing to delete: older code reads past `cli`, `asks` and `runs`.

**Today:** only Claude runs name these. A Copilot run's `-s` output has no init event, so it records no version or
model until #697 turns that run on.

## How a run record says why the run ended

Each line that ends a run names how it ended in `reason`, one value from a closed list (`src/core/end-reason.ts`):

| reason | the run |
|---|---|
| `done` | finished its task; a check ran to its result, pass or fail |
| `asked` | asked a question |
| `blocked` | says it cannot go on, with its why |
| `setup_refused` | never started: a refused step, an implementer hand-over, or a failure before the runner |
| `launch_failed` | its CLI or runner did not start, or the CLI exited with an error before it answered |
| `timed_out` | ran out of time |
| `stalled` | printed nothing for the stall time |
| `usage_limit` | was refused by the provider and parked |
| `output_invalid` | gave an answer or a report that is missing or fails its schema |
| `oom_killed` | went over its runner's memory cap |
| `stopped` | was stopped by a person |
| `unknown` | ended in a way nothing classifies, or is an old line that cannot be told apart |

- The lines are `writer-ended`, `design-ended`, `review-ended`, `ready-ended`, `verify-ended`, `parked` and `spent`.
  `outcome`, `passed`, `actOn`, `hung` and `why` still decide what the table does; `reason` only records. An
  implementer run that finished and whose push a guard then refused stays `outcome: "blocked"` with `reason: "done"`.
- Each outcome takes only some reasons, and a line with any other pair fails the read with its line number. An
  implementer's `done` and `asked` take only their own word, and its `blocked` takes any reason but `usage_limit`. A
  design run's `done` takes `done`, and its `failed` takes any reason but `done`, `asked`, `blocked` and
  `usage_limit`. A review, ready or verify line takes `done`, `parked` takes `usage_limit`, and `spent` takes any
  reason.
- An implementer, review, ready or verify run that fails always writes its `spent` line, with its `reason`, and with
  `spend` only when the run was measured. The line ends nothing, so the ticket still reads as a run that never ended
  and goes to a person.
- A step that cannot run writes `{"kind": "setup-refused", "phase", "why"}`, once per cause: not again while the
  ticket's newest refusal since its last `started` line names the same phase and why. A step held by a cap or the run
  hours writes none. The pass tries the step again as before.
- Neither a `setup-refused` line nor a `spent` line with no `spend` counts as activity or as spending, so `board`,
  `usage` and the merge timeline print what they printed before.
- Every line the code writes carries `reason`. A line written without one reads through a mapping from its old fields, never from its `why`: an implementer's
  `done` and `asked` keep their word and its `blocked` is `unknown`; a design run's `done` is `done` and its `failed` is
  `unknown`; a review, ready or verify line is `done`; `parked` is `usage_limit`; `spent` is `unknown`. A `reason`
  not on the list fails the read with its line number.

**Rollback:** before older code reads the ledger again, remove every `setup-refused` line and every `spent` line
without `spend` from `$FACTORY_HOME/runs/*/*.jsonl`. Older code refuses both, and it reads past `reason`.

**Today:** nothing writes `oom_killed` (#855) or `stopped` (#770).

## Answers

A `[writer] OPEN:` note asks one numbered round, each question with its lettered choices (one marked recommended) or
"(no choices: answer in words)" ([`src/core/answers.ts`](../../src/core/answers.ts)). Only a project member's notes after it count, and
a note that ends with `?` counts for nothing. The round closes once those notes name an answer for every question:
`1A 2C` or `1A2C` on a line of answers alone, one per line as `1: A` or `1. B` (with words after the letter if they
like, after punctuation: `1: A, cheaper`), `1: <words>` for a question with no choices, or `accept all` for the
recommended choices. A whole reply answers only a round of one question with no choices. Prose never reads as a
choice: `we ship 2 a day` answers nothing, and neither does `1. a bit risky`, since a letter followed by words is words
(#517). Replies add up, and a later valid answer to a question replaces an earlier one. A round whose title names a
number of questions its items do not hold, none included, never closes: `poll` shows it as `malformed_asks=N`, and
the way on is to delete that note (#517).

The answers come only from the newest `[writer] OPEN:` round; a `[coordinator] OPEN:` note holds the change open but
gives the implementer nothing. Each answer reaches the next implementer run as a typed field with the question, the
chosen choice's own text and the person's words, marked as data with `<` and `>` escaped, and is recorded as an
`answered` event with the spec's hash first. The answers ride on every run until one ends `done`, so a run that is
blocked after the answer does not lose them.

## The decision table and the loop

The orchestrator's decision table is code: [`src/core/dispatch/table.ts`](../../src/core/dispatch/table.ts) (#103, ADR-0012 S3,
[review 9](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6682943767)). Its header lists every row and every stop; the code is the source of truth. `agent-factory dispatch
<project> --once` runs one pass: it decides each ticket with a START or an approval record (and each change on a
`factory/<ticket>` branch),
posts and labels as the project's identity, and starts at most `FACTORY_MAX_RUNS` runs (default 1), one after another,
and none outside `FACTORY_RUN_HOURS`. A lock keeps two passes apart, and
`--dry-run` prints the decisions and acts on none.

No cron or launchd job runs the orchestrator: a human's command starts the **orchestrator loop**, and it ends by
itself (#305). `agent-factory dispatch <project>` without `--once` runs one pass, then the next, while any ticket
with a START or an approval is in flight. After a pass that ran a step itself (an implementer, ready check, review, local
verifier or design run) or wrote to the git host, the next pass starts at once ("next pass now"); it waits
`FACTORY_POLL_MINUTES` (default 5) only when each ticket waits on something outside the factory (CI, a person, a hold), and names
it ("in flight: 4 (waiting on CI); next pass in 5 min"). A step that fails the same way twice in a row falls back to
that wait, so a broken step never spins (#445). It ends when each such ticket is
finished (merged or closed), has asked a person, stopped at `needs-human`, or waits on a human (an approval, a merge,
a `/stop`), and each person's turn is pinged; a loop with nothing in flight ends after its first pass. It never waits on what only a person can change:
a pass that starts no run because each run it could start is held back ends the loop after that pass, with why and
what to do. A step that is not set up says so, and says to run `agent-factory dispatch <project>` again once it is; the project-day cap says to run it again tomorrow; the window's share says when the
window has room ("the window is full until HH:MM UTC"); outside the run hours it says when they are. Three
failed passes in a row end it too. A pass that fails on the git host's rate limit says until when ("rate limited until
<time>"), and the next pass waits for that time, never asking the git host again before it. When every ticket
in flight is parked at the provider's usage limit, the next pass waits until the earliest reset, never less than
`FACTORY_POLL_MINUTES` ("the provider's usage limit lasts until <time>; next pass in 300 min, when it resets"). A pass in which
nothing happened reads the git host's changes once, not twice. `agent-factory start` and `approve` start it in
the background when none runs (`--no-loop`: they do not), with its output in `$FACTORY_HOME/runs/<project>/loop.log`.
While it runs it holds `$FACTORY_HOME/runs/<project>/loop.pid`, so a second loop for the project is refused. Caps, and
the runs a pass may start, hold in each pass. A laptop that sleeps stops the loop; run `dispatch` again and it carries
on from the records.

**Pings.** One rule says when a person is pinged ([`turn-ping.ts`](../../src/core/dispatch/turn-ping.ts)). Each
pass reads whose turn each ticket is from its decision (`whoseTurn`, as `board` groups it) and pings once when a ticket
enters **needs you** or **ready to merge**: a hand-over, a question, a manual CI job, CI skipped, a person's push, a
`/stop`, a spec changed after its approval, a START or approval it waits for, a design note, a green gate. The pass
writes a `turn` line first, so a ping goes once even when the post fails; a change of step inside the lane pings
nothing. When the ticket goes back to the factory (a run, CI), the pass writes `turn` `factory`, which re-arms the
ping. Leaving sends nothing, since a Discord post cannot be taken back. A person's turn no pass has pinged yet keeps the
ticket in flight, so a run that ends on a person is pinged by the next pass, which starts at once. A ticket with no
`turn` line takes its turn from its older lines (`pinged`, `blocked`, `design-noted`, a verify pass's
`design-ended`, a `writer-ended` that asked or was blocked, unless a run `started` after it), so no wait is pinged
twice. The `pinged` line is the once-per-head record of the "ready for you" note. A build held by its blockers and the
project at a cap inform and ask nothing, so they keep their own checks: `held` pings again only when what it waits on
changes, the cap notice once per cap and period. A ticket whose Claude session waits for the operator's word carries
the `waiting:operator` label on its issue ([`waiting.ts`](../../src/core/dispatch/waiting.ts)); each pass reads the
open issues with it through the `Forge` seam, writes a `waiting` line with the time the label went on, then pings once.
A label taken off and put on again has a newer time and pings again; a ticket whose own turn is already needs you is
recorded with no second ping; that holds only where ticket 12 is issue 12 (the project keeps its specs in issues). A
project's protocol 1 git host plugin may answer it unsupported, and shows no waiting session. The label is a session's claim, not a human record: nothing decides on it. A read that
fails is logged and pings nothing. The orchestrator loop ends once no ticket is in flight, and a waiting session does not keep it
running, so when no loop runs `agent-factory waiting <project>` sends the same record and ping
([`waiting-pass.ts`](../../src/core/dispatch/waiting-pass.ts)) under the pass lock, deciding each ticket as a pass does
and acting on none. The coordinator runs it when a ticket session tells it it waits; `board` shows the wait at once. Each pass reads the label once more: one more call on GitHub,
and on GitLab one more plus one per labelled issue. `board` never pings. It never opens a ticket: the ticket list is the START and approval records and the
`factory/<ticket>` changes. Each pass keeps its
records in `$FACTORY_HOME/runs/<project>/<ticket>.jsonl`, so a restart loses nothing: a run that started and never
ended goes to a person. An implementer run's folder, `$FACTORY_HOME/box-runs/writer-XXXXXX`, is made before its
`started` line, which names it as `folder`. The run's step removes the folder once the run has an end. A step that
fails writes no end, so it leaves its clone there. When such a run never ends (the step failed, or the pass was
killed), the next pass labels the PR `needs-human` and saves the work before the note (`src/core/left.ts`). It
pushes the folder's commits since the run's start head on top of the PR's branch, with a blocked run's guards and a
lease on the head the run started from, so a branch that moved since is left for a person. Its note names the
folder, the commits, the push and every uncommitted file. It commits no file and deletes no folder: once you have
taken the work, delete the folder by hand. A first run with no PR yet pushes nothing, and its `blocked` line names
the folder. An older `started` line with no `folder` still says "check what it pushed". START and approval are each one file a new one replaces, so a pass records each one once as a
`begun` or `approved` line, at the record's own time, keeping it for the ticket's touches (`usage`, #487). When a
pass reconciles a merged change, it first records the merge once as a `merged` line: the git host's merged-at, the
commit it landed as and who merged it (`Forge.landed`). A merge the git host cannot answer for is logged, and the claim
still comes off.

After the `merged` line, the pass writes the merge's `timeline` line once, from the ticket's own lines and with no
model (`src/core/dispatch/timeline.ts`, #488): the review rounds that ran, every finding per rule ID and bucket,
acted-on per rule ID, what each run kind spent, and each rescue (a hand-over a person took back, with its why).

**Today:** a waiver or a person's own push is not a rescue in the run records yet, so the timeline does not count it
(#614).

A ticket's change is the one on `factory/<ticket>` in this repository; a fork's branch of that
name is ignored, and two changes on it go to a person. Two rules hold over every row: a wait on a claimed change that
has been quiet (no record, no comment) for `FACTORY_QUIET_MINUTES` releases the claim; and a stop that went to a person
(`needs-human`, the claim released, one note) is not posted again when the label is removed: to go on, the human
STARTs again or approves the spec again; the newer of the two records starts every count afresh (#227). A stop whose
reason no longer holds, such as a rework that changed only its evidence rows (the ready check runs them, #444), goes on
once the label is removed. The build
begins only on a human's word: a START in the tiny lane, a START and an approval in the others. A spec's `## Blocked by`
holds the first build (no implementer run yet and no change open) until each blocker is merged, read through the git host seam: its
`factory/<ticket>` change merged, or, for a ticket that is a git host issue, the issue closed as completed (on GitLab,
which keeps no close reason, only when a merged PR closes or mentions it). A blocker closed with no merge,
the ticket itself or a cycle in the `Blocked by` sections goes to `needs-human`: with no change to label yet, the pass records the stop and pings the person once. A held ticket is recorded (`held`)
and pings the person once with what it waits on, and again only when that changes. A pass on which the git host does
not answer for a blocker waits and is counted (`blockers-unread`); such passes are a poll interval apart. On the third in
a row the ticket goes to `needs-human` with the first error and when the outage began, told once per outage; the
passes after it keep counting quietly, and a pass that reads the blockers again starts the count afresh. The build then
starts from the default branch, never another ticket's branch (#494). An approval with no
START waits, since nothing runs without one. In a lane with a design review, the design-reviewer and its verify pass
run first, at the spec's and design's hashes, and the build waits for an approval given after them; a design run that
fails is tried again after the same backoff, three times, then waits for a person (#236), and one that fails for good
(a `file:line@commit` cite that does not hold) stops at once. The review converges (P15, #489): at new hashes it runs
again only when the last round kept an Act on CONFLICT (at most 2 rounds), or the edit raised the lane or changed the
Planned files to a pair no earlier round read (a new review past those rounds, at most 2 more; an edit back to a pair
already read is none). The re-review and its verify pass read `earlier.json`: every earlier round's hashes,
lane, Planned files, findings, kept and dismissed items, and the spec and design text the last round read. The engine
drops a repeat of a finding an earlier round dismissed or the person answered. After 2 rounds the person is told once,
in the record (`design-noted`) and a ping, "no further design review (round cap)", and decides. A spec whose Planned
files need a heavier lane runs no design review: the person is told once to raise the lane, and the ticket waits. After the implementer's
done run, the ready check runs that run's evidence rows, and the host posts the implementer's own PR body,
`.factory/pr.md`, cleaned after each implementer run that ended done. The orchestrator starts no cleanup run: a
person runs cleanup by hand. A cleanup run in an older ledger still reads, and the same-patch check leaves it alone.
Each approval also gets one shared copy on the ticket's PR, posted by the project's identity
(`approved by … via …, spec …, design …`); it is for
people to see and starts nothing. The pass refuses to start while the coordinator's settings are missing or looser than
its wall (#105). A failed ready check, a review with Act on findings and a failed local verifier
each record when the implementer may try again (`nextTry`, #228): 10 s after the step's first failure, doubling each time,
never more than 5 minutes; until then the pass waits on that ticket, and the caps still hold. The ready check first runs the floor guard (#190, #231): it reads the change's diff
from its merge base with the default branch, on the host and with git only, and fails the check at once, with each
`file:line`, when the diff lowers the bar (VB6, CR4). The test checks (S1–S4):
- a test file deleted, or moved out of the test files (a move inside them is followed), or fewer test cases in a test
  file that stays (`@Test` and its kin, a Spock feature, `it(`, `test(`, `def test_`, `func Test`; a renamed case is
  silent);
- a skip or focus marker added in a test file (`@Disabled…`, `@Ignore…`, `@Requires({ false })`, `.skip`, `.only`,
  `xit(`, `fit(`, `pytest.mark.skip`, `xfail`, `t.Skip` and the like);
- more assertion lines removed than added in a test file (`assert…`, `expect(`, `assertThat`, `verify(`, Go's
  `t.Error` and `t.Fatal`), every statement of a Spock `then:` or `expect:` block counting, or a value check turned
  into a presence check (`assertEquals(x, 5)` to `assertNotNull(x)`, `toEqual(5)` to `toBeDefined()`);
- a judge file added, changed, moved or deleted: a build file or dependency manifest, a file the project's `verify`
  command names or its program reads (`Makefile` for `make`, `package.json` for `npm`), jest, vitest or playwright
  config, `junit-platform.properties`, `pytest.ini`, `conftest.py`, and the project's `ready.judgeFiles`.

and the code checks:
- a suppression added with no reason comment on the line above (`@SuppressWarnings`, `eslint-disable`,
  `@ts-ignore`, `NOSONAR`, `noqa` and the like), in any file;
- a `catch` or `except` left empty: added so, or with its body removed.

A test check hit goes to a person at once (`needs-human`, with the hits listed), never back to the implementer; a code
check hit sends the implementer back like any failed ready check. A person who agrees with a test check hit runs
`agent-factory waive <project> <ticket> <head>` and removes `needs-human`: the ready check runs again at that head and
clears it. On a later head the test checks look again only at the files changed since the waiver's head, so a cleared
file is flagged again only if it changes again. A line only moved or re-indented is not new, and a submodule bump is not read. A guard that cannot read the diff
or the waiver fails the step, so the check is never passed and a person looks. **Today:** with no mutation command set (#495), the guard counts assertions per file and says it is the weaker check,
so swapping one for another trivial one it does not know, or moving assertions to another file, fools it or fails it;
and Spock `where:` rows are not counted.

The ready check then reads the lane the real diff needs, the same way (#230; `src/core/ready/lane.ts`): only docs,
comments or the values of config keys that stay may be tiny; any other change, a moved file among them, needs at least
bug; a path under the project's `lanes.oneWayDoor` needs the one-way door. The lane is only ever raised: a diff that
needs a heavier lane than the one a human approved, or STARTed in the tiny lane, goes to `needs-human`, and the way on
is a raised `## Lane` in the spec and a human's approval of it. The same check runs before the build, on the spec's
`## Planned files`: a planned file under a one-way-door path holds the ticket until the spec is raised and approved.
Every lane above tiny needs an approval (the approval floor); a lanes value from a plugin or a settings layer that
drops it is refused (`lanesOf`). **Today:** a config file's change counts as values when its changed lines keep the
same keys, so a dependency's major bump in `package.json` still reads as tiny; the automated review's LN2 check is
what catches it (#674). Each acceptance criterion must also have an evidence row: the n-th criterion is `AC-n`, and a row
names it when its `criterion` starts with that id; a criterion with no row fails the check and counts towards its 3
tries. A row may start with a read-only program (`grep`, `test`, `wc`, `ls`, `cat`, `head`, `tail`, `git diff`,
`log`, `show`, `status`, `ls-files`, `rev-parse`) or one of `ready.programs`; one gate command (`./gradlew check`,
`make test`) given for several criteria, or a result that quotes nothing the command printed, fails the check (#444).
Then it runs each evidence row of the implementer's report again at the head,
and the local verifier the project file's `verify`, each on a fresh runner with no git host token and its egress
through the project's own proxy; nothing of the branch runs on the host. Each runner starts that proxy afresh, inside
the project's lock. The orchestrator opens the vm runner when `FACTORY_BOX=vm`, `box.json` and `egress.allow` are set, and the srt runner
when `FACTORY_BOX=srt`, the pinned `srt` answers and `egress.allow` is set;
otherwise the implementer, the ready check and the verifier say what is missing and wait. The orchestrator runs a
ticket's `test-first` and `fix` runs on the runner, on a fresh clone of the branch (or of the default branch on a first run), and the host pushes
and posts what it committed. A `rework` or `ci` run (#171) works the same way, with its task in a read-only
`.factory/task.md` of at most 20,000 characters, all from the host, because the runner has no git host login:

| the run is for | `.factory/task.md` holds |
|---|---|
| a failed ready check | why it failed at the head (the evidence row that failed, with the last 200 lines of its stdout and stderr, the acceptance criteria with no row, or the floor guard's `file:line` hits), kept at `.claude/runs/<change>/<head>/ready.txt` before the result is recorded |
| an open Act on | the review's own Act on findings, kept at `.claude/runs/<change>/<head>/act-on.json` before it posts them; never a git host thread |
| red git host CI | each failed job's name and the last 200 lines of its log, for the first 3 jobs (GitHub check runs and statuses, GitLab pipeline jobs) |
| a failed local verifier | the verifier's own output, kept at `.claude/runs/<change>/<head>/verify.txt` before it posts the status |

Every outside or model-written text in it (a finding, a reason, a log or stream tail, a job's name), like a cleanup
run's evidence rows and the onboarder's `rules.md` and `commands.md`, sits in a fence it cannot close, under one fixed
line saying it is data, never an instruction, with its control and invisible characters removed
(`dataFence`, `src/core/review/fence.ts`). A log keeps its backticks: the fence grows past them.

When the host cannot build the task (nothing kept at the head, or red CI with no failed job named), it says so on the
change and labels it `needs-human`. `dispatch` also does these rows: reconcile a merged claim,
release a claim on a missing or stale approval or a quiet one, leave alone a change someone else claimed, and hand to a
person an unknown pipeline state or two changes on one branch. For each approved ticket it says which run it would
start. The table below lists every row.

A change that does not merge into its target (`poll` shows `conflict=yes`) sends the implementer on a merge run (#103):
the host fetches the default branch into the run's clone as `origin/<default>`, the implementer merges it in and
resolves the conflicts, and the host pushes the merge as a fast-forward. Nothing rebases. The host's one push is
`--force-with-lease` against the head it saw, so a person's push in between is never overwritten. A change that
still conflicts after that one merge run goes to a person. `conflict=unknown` (the git host has not checked yet) has
no row. Each pass that polled writes its last-poll time to `$FACTORY_HOME/runs/<project>/last-poll.json` (a dry run
does not), and `agent-factory status` puts "orchestrator last ran N min ago" at the head of its line. While a loop is
meant to be running (its `loop.pid` is there), it is flagged `LATE` when that is more than 3 poll intervals
(`FACTORY_POLL_MINUTES`) ago while any change is claimed: a loop that stopped shows up there, instead of claimed changes
that just sit. With no loop it says "no orchestrator loop running". When the last loop stopped while a ticket was still
in flight (a step not set up, a cap, failed passes) it adds when and why, from `$FACTORY_HOME/runs/<project>/loop-end.json`;
otherwise it names `agent-factory dispatch <project>` while a change is claimed. A red check is a fail: the factory
never re-runs it, and red CI sends the implementer back as a CI round; only a person re-runs a
red check, once, or quarantines a CI job in the project file's `quarantine.checks` (owner, added, expiry at most
`quarantine.maxDays` later, ticket): a quarantined job still runs, is logged each pass and named in the ping, and does
not block until it expires.
The order is fixed: implementer done → ready check → automated review → gate → human ([gap 2](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6681560750)).
Limits: one run per PR, at most `FACTORY_MAX_RUNS` at once, and at most one
heavy run (a build, an IT suite or a deploy) per machine.

## The table

What the orchestrator does at each state the git host shows. A person acts only where a row says so; the coordinator
runs none of these steps (its settings deny `dispatch`, `review` and `setup`).

| when the git host shows | do |
|---|---|
| the PR's ticket is approved (`agent-factory approval <project> <ticket>` exits 0), with `asks=0`, `needs_human=no` and no `stop` newer than the approval | `agent-factory dispatch <project>` (`approve` starts it): it claims the change and starts the implementer on a runner; in a lane with `test_first` (bug by default), the test-first run first |
| a test-first run (a lane with `test_first`, bug by default) ended with a pushed `test:` commit and `asks=0` | the orchestrator loop starts the fix run |
| the implementer's report is `done` and the host pushed and posted it | the ready check runs its evidence rows at the head on a runner, then `agent-factory review <project> <pr>` |
| an open Act on thread, or the gate is red, with `needs_human=no` | the orchestrator loop starts a rework run; after 3 rounds, label `needs-human`; a red job is never re-run by the factory |
| the evidence fails at the head | the orchestrator loop starts a rework run; after 3 failures, label `needs-human` |
| the project's gate is `local` and the verifier has not run at this head | the local verifier runs `verify` on a runner and posts `agent-factory/verify` at the head; it failing sends the implementer back, as red CI does |
| the gate is green and no Act on is open | assign a maintainer, `status "ready"`, ping the human; **never undraft**: only a human undrafts, and zero findings is not a pass ([Q5b](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6681168344)) |
| the PR is merged | reconcile the claim; a retro runs only when a person starts it (#488) |
| the project is at its day cap or its window share | the pass starts no run and sends one notice; the ticket keeps its records and goes on when the cap allows |
| a run ends `blocked` (a cap, a timeout, a failed runner), or started and never ended | the ticket goes to a person: `needs-human`, one note naming why, and its work kept on top of the branch ([How a run ends](#how-a-run-ends)) |
| you restart | the next pass reads the records, the git host and the run folders again; a claim this loop holds on a change that went quiet is released after `FACTORY_QUIET_MINUTES`. **Today:** a claim label this loop did not add holds its PR until a person removes the label on the git host (#497 item 7) |
| `poll` shows `stop=<time>` newer than the ticket's approval (a maintainer's `/stop`), or a human pushes to the branch | stand off that PR; approving again lifts the stop |
| a merge conflict (`conflict=yes`) | `dispatch` sends the implementer to merge the default branch in; if it still conflicts, `needs-human`. Never rebase or force-push |
| a claimed PR with no live run has a stale approval (`agent-factory approval` exits 3) or `asks` above 0 (a `[coordinator] OPEN:` or a `[writer] OPEN:` note) | the pass releases the claim and takes the next approved PR; it claims the PR again when the human answers |
| the usage limit is near | pause every run |

## The provider's usage limit

When the subscription's window is used up, the agent CLI refuses mid-run and exits non-zero (#707). The adapter
reads that refusal only from the CLI's own words ([`src/core/agent/usage-limit.ts`](../../src/core/agent/usage-limit.ts)):
the text of its last error result event, or its stderr's first line when there is none, must start with a refusal
Claude Code prints ("You've hit your", "You've reached your", …) or say "usage limit reached". A run that writes about
limits is never parked.

The reset time is read in this order:

1. the stream's `rate_limit_event` lines: the latest window the provider rejected with no overage in use, its
   `resetsAt` in epoch seconds, within 31 days. An epoch time has no time zone to misread.
2. the refusal's text: an ISO time after "resets", or a clock time ("resets 3pm (Europe/London)") that names UTC or
   an IANA zone. A clock time is anchored to when the run ended, and one that daylight saving skips or repeats is not
   guessed.
3. else unknown.

The run is **parked**:

- its work is pushed on top of the branch, no label goes on, and no failure or round is counted;
- the record gets a `parked` line with the reset and the task;
- the project gets one notice per reset time, so tickets parked on the same reset send one between them.

**While the reset is ahead,** the ticket waits in the factory lane, with no ping, and `board` shows the reset in the
reader's zone with UTC beside it. **After the reset,** the same task runs again as a fresh run, from the branch the parked run pushed.

**It goes to a person (`needs-human`)** when:

- the reset time is unknown;
- the provider refuses again at a reset no later than the one before;
- the push of the parked run's work fails.

A `/stop`, `needs-human` and the ticket's cap still come first.

**Today:** only implementer runs park: a review round or a design run hit by the limit still goes to a person (#708).
Copilot's refusal text is not known yet (#689 item 5), so a Copilot run is never parked.

**Rollback:** after reverting, delete each `parked` line, and the `started` line before it, from
`$FACTORY_HOME/runs/<project>/<ticket>.jsonl`, and `$FACTORY_HOME/runs/<project>/provider-notice.json`. Older code
refuses an unknown record line.
