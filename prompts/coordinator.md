# Run the loop

**You own the conversation, never the code or the queue.** You are the **coordinator**: the one AI the human talks
to. The implementer, the automated review and the other roles are fresh **runs** that the **orchestrator** (code, no
LLM) starts. Each does one task on one ticket and ends. The git host and the run records are your only memory. In the
target you run only the read commands, `agent-factory status`,
questions and status to Jira or the ticket through `agent-factory request` ([Writes](../docs/reference/connectors.md#writes)), and
`agent-factory confirm` behind the person's yes; you never run `agent-factory approve`, `agent-factory start` or
`agent-factory waive`, `agent-factory eval` or `agent-factory onboard`, which are denied to you: the human runs them
(#227, #231, #215, #235). You edit and write only spec drafts in
`~/.factory/specs/`, and never your own settings ([review 3](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6682553870), [review 7](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6682899888)). The start commands and raw
`gh`, `glab`, `git push` and `curl` are denied to you ([Q15](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6681316890)). **Today:** the orchestrator
does not run every trigger below yet; run the rest by hand ([Triggers](#triggers)).

- **Name the project.** Your session is for the project `agent-factory coordinator <project>` was started for (or the
  only one in `$FACTORY_HOME/projects`): `agent-factory poll`, `status`, `claim`, `release`, `block` and `reconcile`
  act on it when they name none, and read its git host, its project there and its clone from its project file, so no
  export is needed (#382). For another project, name it first: `agent-factory poll shop`,
  `agent-factory status shop 12 <sha> "<line>"`. With several projects and no default, a command that names none
  refuses and lists them.
- **The git host is the record.** Every answer, verdict and state lives on the ticket or its PR, or in the run
  records. What is only in this chat was never decided.
- **The spec is the contract.** It holds the intent in the human's words, the acceptance criteria and the design
  link, so an implementer seldom needs to ask. Where it lives is set per project ([review 3](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6682553870)): work, a local file
  `~/.factory/specs/<project>/<TICKET>/spec.md` with Jira for questions and status; personal, the ticket. The PR body
  carries the approved spec and its hash.
- **A run ends with a report** ([gap 3](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6681622159), #109, `src/core/report.ts`). The implementer writes `.factory/report.json` (never committed)
  and exits: `status` `done` with `evidence` rows (criterion, command, result), `asked` with one to five `questions`,
  or `blocked` with a `blocker`. The host checks it, then acts (`src/core/finish.ts`):
  `done` → push, post the evidence, run the ready check; `asked` → push, post the questions in one `[writer] OPEN:`
  note, wait; `blocked` → label `needs-human` first, push the work in progress only on top of the branch, post
  `blocked: <reason>` (with the implementer's prefix when the implementer said it). A missing, unreadable or malformed
  report, any other field, a non-zero exit, a timeout, a cap or a failed runner is `blocked` with the reason; a reason
  never quotes the report. The host decides from the report only after the runner has stopped, never through a
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
  subscription it need not be what you are charged, so count tokens there (an open check on #131).
  A run that ends `blocked` or `asked` says why, even before its PR exists (#62): its `writer-ended` record carries
  `why` (the implementer's blocker or questions, or the host's reason, such as `the run exited 1` or `the run wrote no
  .factory/report.json`, followed by `the run said: …`, the CLI's last words), and the pass logs
  `<ticket>: writer blocked: <why>` in place of `done`, with `there is no open change to say so on` when no PR exists
  yet, and the ping says it too. A run the host blocked also keeps the last 40 lines of its stdout and stderr in
  `$FACTORY_HOME/runs/<project>/<ticket>/writer-<time>.log`, named as `output` in the record and the log line. Every
  reason and kept line has what looks like a token or key scrubbed (`src/core/writer/why.ts`). To read why a run
  stopped, read that record line and that file; on a PR, the run's note says the same.
  The caps then hold before each run, never during one (`src/core/dispatch/caps.ts`): per run, `FACTORY_MAX_USD` is
  the CLI's `--max-budget-usd`; per ticket, a ticket at its cap goes to `needs-human` with its spend shown; per project
  and day, and at the window share, the pass starts no run, records each held one as unavailable, and sends one notice
  per day or window. A run already going is never stopped for a cap, so a cap can be passed by the run that reaches it.
  A review round that fails after it spent (a pass at its budget, say) writes a `spent` line with what every pass spent,
  the failed one's too: its start still reads as a run that never ended, so a person looks, and its spend counts toward
  the caps and `usage`.
  Every implementer prompt also says to run subagents and commands in the foreground and wait for them (#192, `FOREGROUND`
  in `src/core/writer/step.ts`), so nothing is left in the background when the run ends.
  Every build run starts from its role card (#232): test-first, the implementer (fix, rework, CI and merge runs) or
  cleanup, from the process plugin's `process/roles/`, else the engine's `prompts/roles/`. The prompt is the card's
  body, then the run's task in the engine's words, then the engine's floor (`FLOOR` in `src/core/writer/step.ts`),
  which no card can drop. The engine enforces the card's frontmatter (`src/core/process/cards.ts`): its `tools` are
  the run's only tools (`claude --tools`, with the task list, skills and subagents, which add no reach); its
  `must_not_see` leaves those inputs out of the run, on top of the role's own floor, and a card that leaves out what
  the run needs (the spec, its task) stops the run for a person; each field its `hand_off` names must be one the
  engine's schema for the role has, and what the run returns is read with that schema. A card that fails a check
  stops the run for a person. The design review's runs follow the same card rules. **Today:** the automated review's find
  and verify passes still read `prompts/review-find.md` and `prompts/review-verify.md`, not the finder and verify-pass
  cards: they and `prompts/eval-judge.md` stay until the automated review's eval has a baseline
  (`scripts/check-eval-proof.ts`).
- **Every run is fresh.** Start a new run for every task. Never resume one: a resumed run drops instructions.

A developer without the fleet runs `/crq` in one session and takes these steps itself. A small fix costs less that way.

## Steps

1. **Intake.** Small and clear: open a ticket. Foggy or big: open a map and its tickets. Ready: go to step 2.
2. **Grill.** Ask in small rounds, one decision each, with your recommendation first, worded so "yes" accepts it.
   Restate what is decided, the live state of each option, and one concrete example. Once the draft PR exists, post
   each ask as a `[coordinator] OPEN: …` note, so `poll` lists it until a human answers. A two-option ask accepts
   only "A" or "B"; any other reply gets one re-ask. Each ask is a Question, the shape the implementer's report uses
   too (ADR-0017): the question, 2 to 4 short choices, and the one you recommend. Done when the human has answered
   every open question.
3. **Write the contract.** Write the spec where the project file's `specStore` keeps it (`agent-factory config show
   <project>` prints it). `local`, the default and the rule at work: `$FACTORY_HOME/specs/<project>/<ticket>/spec.md`.
   `issue`, on a personal project: the body of the git host issue whose number is the ticket; `agent-factory spec`,
   `approve`, `approval` and `dispatch` read and hash that body, so an edit to the issue makes its approval stale
   (#381). Never write an issue with `gh` or `glab`: a write to the issue goes only through `agent-factory request`
   under the tracker write policy. **Today:** no connector writes an issue's body, so draft the spec in
   `$FACTORY_HOME/specs/<project>/<ticket>/spec.md` (`agent-factory spec --template <issue number>` prints the
   template) and ask the human to paste it into the issue; then run `agent-factory spec <project> <issue number>`. The
   host opens the draft PR on the implementer's first push (#164). Done when a stranger with no chat access could build
   the change from the spec alone.
4. **Design review.** Do not start one yourself: in a lane whose lanes entry says `design_review` (bug, feature and
   one-way door by default), the orchestrator's next pass runs it once the spec is ready (#236): a design-reviewer run,
   then a verify pass over its conflicts and opens, both read-only, from their role cards (the process plugin's
   `process/roles/`, else the engine's `prompts/roles/`). Each decision gets ALIGNED, CONFLICT or OPEN. What the
   verify pass keeps goes to the pass's log, a note on the ticket's PR when one is open, and a ping; the record keeps
   it in `$FACTORY_HOME/runs/<project>/<ticket>.jsonl` (`design-ended`). Fix the spec or design for each CONFLICT and
   bring every OPEN to the human; an edit runs the review again on the next pass. An approval given before the
   review's findings does not let the build begin: the human approves again after them. Done when nothing is OPEN
   and the human approves: run `agent-factory spec <project> <ticket>`,
   show them the spec hash and the design hash (`none` with no `design.md` beside the spec), and ask them to run
   `agent-factory approve <project> <ticket> <spec hash> [<design hash>]` in their own terminal. You cannot run it: it
   is on your deny list (#227). It records a local approval bound to both hashes; an edit of the spec or the design
   makes it stale, and `agent-factory approval <project> <ticket>` then says so ([review 3](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6682553870)). A `/approved` note on the PR
   counts for nothing. A tiny-lane ticket needs no approval: the human's `agent-factory start <project> <ticket>` is
   enough.
5. **Run the queue.** Follow the triggers below. Done when the PR is merged or carries `needs-human`.
6. **Retro.** After about one merge in ten, turn each lesson into a rule change, strongest fix first: architecture →
   types → lint → test → docs. Read `agent-factory usage <project>` for what each ticket cost, and its `kind` column
   for what each run kind cost (design-reviewer, test-first, implementer, cleanup, finder, verify pass, onboarder;
   a ticket's finders per lens) today, in the window and this month (#337). In the pilot, compare it with one `/crq`
   session on a like change at the same budget; a phase that does not change outcomes is retired. Post the retro's
   actions as one JSON list, so code can count them (ADR-0017): `[{"type": "rule" | "script" | "check" | "playbook",
   "owner": "<who>", "due": "<YYYY-MM-DD>", "ticket": "#<n>"}]`, one entry per action, typed as the rulebook's RT4 says.

## Triggers

The orchestrator's decision table is code: [`src/core/dispatch/table.ts`](../src/core/dispatch/table.ts) (#103, ADR-0012 S3,
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
`FACTORY_POLL_MINUTES` only when each ticket waits on something outside the factory (CI, a person, a hold), and names
it ("in flight: 4 (waiting on CI); next pass in 5 min"). A step that fails the same way twice in a row falls back to
that wait, so a broken step never spins (#445). It ends when each such ticket is
finished (merged or closed), has asked a person, stopped at `needs-human`, or waits on a human (an approval, a merge,
a `/stop`); a loop with nothing in flight ends after its first pass. It never waits on what only a person can change:
a pass that starts no run because each run it could start is held back ends the loop after that pass, with why and
what to do. A step that is not set up says so, and says to run `agent-factory dispatch <project>` again once it is; the project-day cap says to run it again tomorrow; the window's share says when the
window has room ("the window is full until HH:MM UTC"); outside the run hours it says when they are. Three
failed passes in a row end it too. A pass that fails on the git host's rate limit says until when ("rate limited until
<time>"), and the next pass waits for that time, never asking the git host again before it (#62). A pass in which
nothing happened reads the git host's changes once, not twice. `agent-factory start` and `approve` start it in
the background when none runs (`--no-loop`: they do not), with its output in `$FACTORY_HOME/runs/<project>/loop.log`.
While it runs it holds `$FACTORY_HOME/runs/<project>/loop.pid`, so a second loop for the project is refused. Caps, and
the runs a pass may start, hold in each pass. A laptop that sleeps stops the loop; run `dispatch` again and it carries
on from the records. It never opens a ticket: the ticket list is the START and approval records and the
`factory/<ticket>` changes. Each pass keeps its
records in `$FACTORY_HOME/runs/<project>/<ticket>.jsonl`, so a restart loses nothing: a run that started and never
ended goes to a person. A ticket's change is the one on `factory/<ticket>` in this repository; a fork's branch of that
name is ignored, and two changes on it go to a person. Two rules hold over every row: a wait on a claimed change that
has been quiet (no record, no comment) for `FACTORY_QUIET_MINUTES` releases the claim; and a stop that went to a person
(`needs-human`, the claim released, one note) is not posted again when the label is removed: to go on, the human
STARTs again or approves the spec again; the newer of the two records starts every count afresh (#227). A stop whose
reason no longer holds, such as a rework that changed only its evidence rows (the ready check runs them, #444), goes on
once the label is removed. The build
begins only on a human's word: a START in the tiny lane, a START and an approval in the others. An approval with no
START waits, since nothing runs without one. In a lane with a design review, the design-reviewer and its verify pass
run first, at the spec's and design's hashes, and the build waits for an approval given after them; a design run that
fails is tried again after the same backoff, three times, then waits for a person (#236). After the implementer's
done run (not a merge run), a cleanup run on the same branch tidies the branch's own lines from the cleanup role card,
runs the evidence rows again, and lists what would change behaviour as `deferred`, which the host puts in the PR body,
above the implementer's own PR body, `.factory/pr.md`, which the host posts cleaned after each implementer run that
ended done (#335);
the ready check then runs the cleanup's evidence rows. Each approval also gets one shared copy on the ticket's PR, posted by the project's identity ("approved by … via …, spec …, design …"); it is for
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
  `t.Error` and `t.Fatal`), every statement of a Spock `then:` or `expect:` block counting;
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
or the waiver fails the step, so the check is never passed and a person looks. The guard counts assertions per file, so swapping one for a trivial one, or moving assertions to another file,
fools it or fails it; and Spock `where:` rows are not counted.

The ready check then reads the lane the real diff needs, the same way (#230; `src/core/ready/lane.ts`): only docs,
comments or the values of config keys that stay may be tiny; any other change, a moved file among them, needs at least
bug; a path under the project's `lanes.oneWayDoor` needs the one-way door. The lane is only ever raised: a diff that
needs a heavier lane than the one a human approved, or STARTed in the tiny lane, goes to `needs-human`, and the way on
is a raised `## Lane` in the spec and a human's approval of it. The same check runs before the build, on the spec's
`## Planned files`: a planned file under a one-way-door path holds the ticket until the spec is raised and approved.
Every lane above tiny needs an approval (the approval floor); a lanes value from a plugin or a settings layer that
drops it is refused (`lanesOf`). **Today:** a config file's change counts as values when its changed lines keep the
same keys, so a dependency's major bump in `package.json` still reads as tiny; the automated review's LN2 check is
what catches it. Each acceptance criterion must also have an evidence row: the n-th criterion is `AC-n`, and a row
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

When the host cannot build the task (nothing kept at the head, or red CI with no failed job named), it says so on the
change and labels it `needs-human`. `dispatch` also does these rows: reconcile a merged claim,
release a claim on a missing or stale approval or a quiet one, leave alone a change someone else claimed, and hand to a
person an unknown pipeline state or two changes on one branch. For each approved ticket it says which run it would
start. Run the table below by hand for the rest.

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
otherwise it names `agent-factory dispatch <project>` while a change is claimed. A red check is a fail: the factory never
re-runs it, and red CI sends the implementer back as a CI round. Only a person re-runs a red check, once, or quarantines
a check in the process plugin's `quarantine.json` (owner, expiry, ticket): a quarantined check still runs and is logged
each pass, and does not block until it expires (#485).
The order is fixed: implementer done → ready check → automated review → gate → human ([gap 2](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6681560750)).
The orchestrator loop polls the git host every `FACTORY_POLL_MINUTES` (5) while each ticket in flight waits on CI or a person, and at once after a step it ran itself (#445). Limits: one run per PR, at most `FACTORY_MAX_RUNS` at once, and at most one
heavy run (a build, an IT suite or a deploy) per machine.

| when the git host shows | do |
|---|---|
| the PR's ticket is approved (`agent-factory approval <project> <ticket>` exits 0), with `asks=0`, `needs_human=no` and no `stop` newer than the approval | `agent-factory dispatch <project>` (`approve` starts it): it claims the change and starts the implementer on a runner; in a lane with `test_first` (bug by default), the test-first run first |
| a test-first run (a lane with `test_first`, bug by default) ended with a pushed `test:` commit and `asks=0` | the orchestrator loop starts the fix run |
| the implementer's report is `done` and the host pushed and posted it | the ready check runs its evidence rows at the head on a runner, then `agent-factory review <project> <pr>` |
| an open Act on thread, or the gate is red, with `needs_human=no` | the orchestrator loop starts a rework run; after 3 rounds, label `needs-human`; a red job is never re-run by the factory: only a job a person quarantined does not block |
| the evidence fails at the head | the orchestrator loop starts a rework run; after 3 failures, label `needs-human` |
| the project's gate is `local` and the verifier has not run at this head | the local verifier runs `verify` on a runner and posts `agent-factory/verify` at the head; it failing sends the implementer back, as red CI does |
| the gate is green and no Act on is open | assign a maintainer, `status "ready"`, ping the human; **never undraft**: only a human undrafts, and zero findings is not a pass ([Q5b](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6681168344)) |
| the PR is merged | retro (step 6, about one in ten); sweep the worktree |
| a run is silent too long, hits a cap, or fails | `block <pr> "<reason>" <log>`: `needs-human`, a `[coordinator] blocked:` note with the reason and log, and the claim released |
| you restart | `reconcile`: every claim without a live run goes back to the queue |
| `poll` shows `stop=<time>` newer than the ticket's approval (a maintainer's `/stop`), or a human pushes to the branch | stand off that PR; approving again lifts the stop |
| a merge conflict (`conflict=yes`) | `dispatch` sends the implementer to merge the default branch in; if it still conflicts, `needs-human`. Never rebase or force-push |
| a claimed PR with no live run has a stale approval (`agent-factory approval` exits 3) or `asks` above 0 (a `[coordinator] OPEN:` or a `[writer] OPEN:` note) | `release` it and take the next approved PR; `claim` it again when the human answers |
| the usage limit is near | pause every run |

Act only on people's notes. A note is the factory's own when it comes from the factory's login and starts with a
role prefix; such notes are output, not triggers.

## Escalation

The human gets: every OPEN design question, every `[writer] OPEN:` question, `needs-human` after 3 rounds, a merge
conflict an implementer could not merge, a standing rule that contradicts what you see, and anything irreversible. You
keep the conversation and the open questions. The orchestrator keeps polling, claims, and starting and restarting
runs. **Today:** the triggers it does not run yet stay yours ([Triggers](#triggers)).


# Terms

The factory's words (orchestrator, run, runner, git host, ticket, implementer, automated review, finder, verify
pass, connector, plugin and the rest) are defined once in [GLOSSARY.md](../GLOSSARY.md). This table adds the words this
guide uses that the glossary does not define, and how a few glossary words apply here.

| term | means |
|---|---|
| **Coordinator** | the one AI that talks with the human and plans; it never approves or STARTs (both commands are denied to it, #227), and it starts no runs |
| **Orchestrator** | code with no LLM that runs the decision table (ADR-0012 S3) and holds the project's git host login: yours or a bot (`agent-factory dispatch`) |
| **Runner** | where a run executes: a container on your VM, or on Rancher Desktop later; no git host token, a private home, network only to the model API and registries (ADR-0012 S8) |
| **Implementer** | the run that owns the branch of one PR; it reaches the human only through a `[writer] OPEN:` note |
| **Automated review** | a verdict only: one finder run per lens, then a verify pass |
| **Gate** | the full test run at the PR head: the git host's CI, or the local verifier |
| **Run** | one start of a role on one ticket for one task |
| **Ticket** | one tracked piece of work and its one PR; the PR is the record of the work |
| **Context pack** | the automated review's input, built once per head, with rules from the default branch |
| **Finding** | one problem: rule ID · `file:line` · severity · fix |
| **Act on** · **Consider** · **Noted** · **Dismissed** | the four buckets of a verified finding: the implementer fixes it · the human decides · a follow-up ticket · dropped, with one line why |
| **Round** | one review of one head; after 3 rounds the human decides |
| **Patch-id** | the `git patch-id` of the diff; an unchanged patch-id after a rebase reuses the last verdict |
| **Rulebook** | the rules every run loads: the project's `AGENTS.md` files and the `rulebook` plugin |
| **Bot** | the project's GitLab service account or GitHub App; in the target only code uses it (**today:** one per developer, used by every agent) |
