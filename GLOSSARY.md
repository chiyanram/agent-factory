# Glossary

One word per idea. Use these words, and only these, in docs, role cards, code comments and tickets. When you reach for
a word under _Avoid_, use the term instead.

The factory words are Matt Pocock's `software-factory` vocabulary (mattpocock/skills @4ae2317,
`skills/in-progress/software-factory/`, MIT). The term map was confirmed on #144 on 2026-11-08, and four clashes were
settled on 2026-11-09 ([ADR-0016](docs/adr/0016-adopt-the-software-factory-vocabulary.md)). Code names that still use an old word are renamed in #144 phase 4. Until then, the alias column
says what they mean.

## The factory

**Software factory**: a system of agents that turns tickets into merged code. agent-factory is one.

**Engine**: agent-factory's own code: the orchestrator plus every check the host runs (ready check, push guards,
approval records, settings). Never the model.
_Avoid_: the system, the code (for the engine)

**Orchestrator**: the part of the engine that receives triggers, starts runs on runners, and records which runs are
queued, in flight or finished. In code: `src/core/dispatch/`, `agent-factory dispatch`.
_Avoid_: dispatcher, scheduler, control plane

**Orchestrator loop**: `agent-factory dispatch <project>` without `--once`: one pass, then another after the poll
interval, while any ticket a human STARTed or approved is in flight. A human's command starts it (`dispatch`, or
`start` and `approve` in the background); it ends by itself when no ticket is in flight. No cron job runs it. In
code: `src/core/dispatch/orchestrator-loop.ts`.
_Avoid_: daemon, cron job, scheduler

**In flight** (a ticket): the orchestrator carries it on without a person: a run is due or backing off, a ping is due,
or CI is running. A ticket that is merged or closed, has asked a person, stopped at `needs-human`, or waits on a
human (a START, an approval, a merge, a `/stop`) is not. In code: `inFlight` in `src/core/dispatch/table.ts`.

**Task**: a kind of work the factory does, defined once and run many times: implement, automated review, rework,
retro. Each task answers five questions: what triggers it, what it reads and writes, what it triggers next, where a
human re-enters, and what stops two runs doing the same work.
_Avoid_: job, workflow, action

**Trigger**: the event that starts a run. Here a ticket's first run is triggered only by a human START, its build only
by a human approval (in the lanes that need one), and later runs by the orchestrator from the run before.

**Extra task**: a task outside a ticket's flow: full retro, weekly clean-up, triage. Off until a human starts one; a
schedule can be switched on per task later.

**Run**: one execution of a task on one runner, from its trigger to its end. A run never waits for a human: it ends,
and the human's later change triggers a new run.
_Avoid_: session

**Runner**: the disposable machine a run executes on. Nothing on it survives the run. Kinds: `vm` (a Sysbox container
with its own Docker) and `srt` (Anthropic's sandbox runtime, on a laptop). In code: `src/core/box/`, `FACTORY_BOX`.
_Avoid_: box, sandbox, server, host, compute

**Agent CLI**: the program that runs the model inside a run: `claude` or `copilot`. It is chosen per role.
_Avoid_: runner (for the program), agent (alone)

**Brakes**: the three things that slow a factory down enough to trust it: automated checks, automated review and human
review. Every loop of runs is capped at a few tries before a human.

## Services

**Ticket tracker**: where tickets live: GitLab or GitHub issues, Jira.
_Avoid_: issue tracker, project board
Here, unlike Pocock's design, the tracker is not where humans talk to the factory. That is a front door.

**Ticket**: one tracked piece of work.
_Avoid_: issue (for a ticket), story

**Ticket source**: anything outside the factory that creates tickets: a monitor, an error tracker, a feedback button.
None is wired up yet.

**Git host**: where branches, PRs and reviews live: GitHub or GitLab. In code: `src/core/forge/`, the `Forge` seam.
_Avoid_: forge, code host, repo

**PR**: a pull request. "MR" appears only inside the GitLab adapter.
_Avoid_: MR, merge request (outside the GitLab adapter)

**Observability platform**: where runs send logs and status for a human to read. Today: none; the run records and
notes are enough.

**Connector**: one of the engine's swappable parts, a small program behind a fixed contract (ADR-0014): front door,
approval, gate, agent CLI, runner. Each has a dry mode. In code: `src/core/plugin/`, `plugins/`.
_Avoid_: plugin (for a connector)

**Plugin**: a normal Claude Code plugin a project installs, `name@marketplace`, for rules or process. Listed in the
project's settings, pinned, and a locked key.
_Avoid_: pack

**Front door**: a place a human talks to the factory: the terminal, a Discord thread per ticket, a web app later, a
spec PR, or Jira's status (later). Every front door writes the same START, approval and answer records.
_Avoid_: interface, channel

## A ticket's way through

**START**: a human's instruction to open a ticket: the coordinator researches, asks and writes the spec, and the
design and its review run where the lane needs them. Nothing runs without one. If a `factory/<ticket>` branch exists,
START asks first.

**Lane**: how much process a change gets: tiny, bug, feature or one-way door. The coordinator proposes it, and the
engine checks it from the planned files and the real diff, and can only raise it.
_Avoid_: size, type, category

**Spec**: the approved contract, one file with `## Intent`, `## Lane`, `## Acceptance criteria` (numbered), `## Design`
(a link or `none`), what is out of scope, and optionally `## Planned files`, which the lane is checked against.
_Avoid_: requirements, story (for this file)

**AC**: one acceptance criterion: a numbered line in the spec, referred to as AC-n, decidable by a test.
_Avoid_: requirement, condition

**Design**: the chosen shape, one rejected alternative, and the slices. It is linked from the spec.
_Avoid_: plan (alone), architecture doc

**Slice**: one thin end-to-end piece of the design, with the command that proves it.
_Avoid_: task (for a slice), chunk

**Approval**: a human's yes to a spec and its design, bound to their hashes, that lets the build begin (bug, feature,
one-way door; tiny needs START only). Any later edit makes it stale. The AI never approves, and no setting or plugin
can drop approval above tiny (the approval floor).

**Spec home**: where a project keeps its specs: a local folder (default), a shared place, the issue or Jira, or a repo
commit (personal projects that opt in).

**Needs-human**: the label that stops a ticket for a person. The person removes it and STARTs or approves again.

**Ask**: a run that needs a decision ends with status `asked` and every open question at once, as one numbered round.
Each question carries 2 to 4 short choices and one recommended choice, so a person answers with taps, "1A 2B", or
"accept all". The project setting `questions` can be `one-at-a-time` instead. Never a guess. The answer goes into the
spec.
_Avoid_: clarify inline, assume

**Evidence row**: `{criterion, command, result}`: one AC and the plain command that proves it.
_Avoid_: proof, output

**Hand-off**: the file a role leaves for the next role.
_Avoid_: summary, notes

**Ready check**: the engine re-running every evidence row at the head, checking every AC has a row, plus the test
checks and the lane check.
_Avoid_: verify (for this step)

**Test checks**: what the engine stops without a model: a test removed (S1), a skip added (S2), fewer assertions (S3),
a judge file changed (S4). A hit goes to needs-human with the hits listed. A human may clear one with a waiver scoped
to the head (`agent-factory waive`, a `test-change` record); a later head is checked again only where it changed
since. In code: the floor guard (`src/core/ready/floor.ts`), which also stops bare suppressions and empty catches for
the writer, and `src/core/waiver.ts` (#231).

**Judge files**: tests, test config, the gate command and what it runs.
_Avoid_: test setup, harness

**Gate**: the full test run before the human is pinged: git host CI, aruvii's Verifier queue, or a local run on a
runner.

**Finding**: one problem at `file:line`, with the rule it breaks.
_Avoid_: comment, remark

**Lens**: one rubric a fresh finder applies.
_Avoid_: perspective, reviewer type

## Roles and plugins

**Role card**: one markdown file per role. Its frontmatter (tools, inputs, hand-off, hard guardrails) is enforced by
the engine, and its body is what the model reads.

**Roles**: coordinator, design-reviewer, test-first, implementer, cleanup, finder, verify pass, retro, onboarder.

**Coordinator**: the role that talks with the human: research, questions, spec and design. It never approves and
never starts a run.

**Implementer**: the role that builds the spec, proves each AC and writes the PR body (`.factory/pr.md`), which the
host posts cleaned (#335).
_Avoid_: writer

**Test-first**: in the bug lane, the separate run that writes the failing test before the implementer runs.

**Design-reviewer**: the run that gives every decision in a design one verdict (aligned, conflict, open) before
approval; a verify pass checks its findings.

**Cleanup**: the run that tidies the branch's own lines without changing behaviour; what would change behaviour goes
in `deferred`.

**Retro**: the engine writes a timeline record for every merge, with no model. A full retro run, which traces each
rescue to a rule, check or step, is an extra task a human starts.

**Automated review**: the task that reviews a PR: one **finder** run per lens, then one **verify pass** run that tries
to refute each finding and gives it a bucket (act_on, consider, noted, dismissed). Design review has the same shape: a
design-reviewer run, then a verify pass. In code and ADR-0015: "the reviewer".
_Avoid_: reviewer (alone, since it can't be told apart from a human), verifier (that is aruvii's Verifier queue)

**Onboarder**: the role that writes a project's brief and glossary once, for every other role to read. It writes only
to the project home.

**Factory bot**: the code-only bot (no AI) behind the Discord front door, with its own OS user and token.

**Process plugin**: a plugin that holds the lanes file and the role cards. The rulebook's crq is the first. The engine
ships a small default.
_Avoid_: pack, process pack

**Project home**: outside the product repo: the settings file `~/.factory/projects/<project>.json` and the folder
`~/.factory/projects/<project>/` with the brief and glossary.

## Old words, do not use

| old | use |
|---|---|
| forge | git host |
| box | runner |
| dispatcher | orchestrator |
| session (of a worker) | run |
| issue (for a ticket) | ticket |
| writer | implementer |
| reviewer | automated review (the task), finder or verify pass (the runs) |
| MR | PR |
| seat | the role's name |
| runner (for claude or copilot) | agent CLI |
| pack (for rules or process) | plugin ("context pack" in `review/pack.ts` is the review's input, a different thing) |
| plugin (for an engine part) | connector |
| fresh worker | run |
