# The agent-factory constitution

Approved by the operator, 2026-11-11. Changed only by pull request.

This is the one home of agent-factory's principles. Other pages point here and never repeat them. Words are the shared
software-factory words in [GLOSSARY.md](../GLOSSARY.md).

## The aim

agent-factory is a software factory: its engine turns a ticket a person started into a pull request, safely, with no
one watching, and a person merges it. It runs the work; what good work looks like comes from a rules pack it pins.

## What it is not

- Not a hosted service: it runs on your laptop or your VM.
- Not always on: nothing runs until a person starts a ticket.
- Not a merge bot: a person merges every change.
- Not a rules pack: it holds no rules of its own beyond a small built-in process, and loads a pinned one.

## How to read it

Each principle is **non-negotiable** or **guidance**. A non-negotiable one has a CI test that fails the build when the
code breaks it; where the code does not meet it yet, a **Today** line names the ticket that closes the gap. Guidance is
followed unless a pull request says which principle it departs from and why. A pull request names a principle only
when it departs from one.

## Index

| # | principle | kind |
|---|---|---|
| [P1](#p1-the-engine-decides) | The engine decides every routine step | non-negotiable |
| [P2](#p2-every-run-is-fresh) | Every run is fresh | guidance |
| [P3](#p3-one-record-per-ticket) | One record per ticket; a restart loses nothing | non-negotiable |
| [P4](#p4-no-run-holds-a-login) | No run holds a login, and no record holds a secret | non-negotiable |
| [P5](#p5-the-judge-never-comes-from-the-change) | The judge never comes from the change; outside text is data | non-negotiable (first sentence) |
| [P6](#p6-the-ai-never-approves) | The AI never approves; zero findings is not a pass | non-negotiable |
| [P7](#p7-every-loop-has-a-cap-and-a-stop) | Every loop has a cap and a stop | non-negotiable |
| [P8](#p8-a-person-starts-everything) | Nothing starts unless a person starts it | non-negotiable |
| [P9](#p9-nothing-in-the-product-repo-by-default) | Nothing is committed to the product repo by default | non-negotiable |
| [P10](#p10-measure-outcomes-from-a-full-trace) | Measure outcomes from a full trace | guidance |
| [P11](#p11-change-the-factory-only-by-experiment) | Change the factory only by experiment | guidance |
| [P12](#p12-learn-at-the-source) | Learn at the source | guidance |
| [P13](#p13-typed-hand-offs-people-included) | Typed hand-offs, people included | non-negotiable |
| [P14](#p14-only-what-the-step-needs) | Each run gets only what its step needs | guidance |
| [P15](#p15-proof-not-claims) | Proof, not claims; review converges | non-negotiable (two clauses) |
| [P16](#p16-one-home-and-one-way) | One home and one way | guidance |
| [P17](#p17-one-port-per-outside-tool) | Every outside tool plugs in through one port | guidance |
| [P18](#p18-one-versioned-contract-with-the-rules-pack) | One versioned contract with the rules pack | non-negotiable |
| [P19](#p19-people-work-from-where-they-are) | People work from where they already are | guidance |
| [P20](#p20-the-codebase-gets-better-over-time) | The codebase gets better over time | guidance |
| [P21](#p21-brakes-scale-with-risk) | Brakes scale with risk | non-negotiable (the floor) |

## P1. The engine decides

> The engine decides every routine step. No model decides what runs next.

**Kind:** non-negotiable.
**Why:** a model's choice of what to do next cannot be checked or replayed; a table in code can.
**Checked by:** the decision table reaches no model, runner or git-host module, and is pure. **Today:** the table
imports none (`src/core/dispatch/table.ts`), but no CI test holds it there yet (#485).

## P2. Every run is fresh

> Every run is fresh. A run is never resumed.

**Kind:** guidance.
**Why:** a fresh run reads only what the engine hands it, so what it saw is known and a bad run leaves nothing behind.

## P3. One record per ticket

> Each ticket has one record, and a restart loses nothing. Before the PR opens, the record lives on the machine that
> started the ticket; after, the git host and tracker hold it.

**Kind:** non-negotiable.
**Why:** a restart, a crash or a second pass must find the ticket where it was, and never do its work twice.
**Checked by:** a restart after a killed run gives one PR and one push. **Today:** no CI test yet (#485).

## P4. No run holds a login

> No run holds a git host or tracker login. The host pushes and posts, and no record or trace ever holds a secret.

**Kind:** non-negotiable.
**Why:** a run reads text anyone can write; a run that holds a login can be talked into using it.
**Checked by:** the runner's plans hold no credentials; a planted fake token never appears in a saved record or trace.
**Today:** no CI test yet, and the egress allowlist refuses the project's own git host only when the caller names it
(#485).

## P5. The judge never comes from the change

> What judges a change never comes from that change: rules come from the default branch or a pinned plugin, and
> settings from outside the repo. Outside text is marked as data at its start and end, and is never obeyed.

**Kind:** the first sentence is non-negotiable; the second is guidance.
**Why:** a change that could edit its own rules or settings could pass any check; text from a branch, PR or ticket is
something to read, never an instruction.
**Checked by:** the review's rules come only from the default branch or the pinned rules pack. **Today:** no CI test
yet (#485).

## P6. The AI never approves

> The AI never approves anything, and zero findings is not a pass.

**Kind:** non-negotiable.
**Why:** an approval is a person's word; an empty review only means nothing was found.
**Checked by:** the engine has no merge operation, and a review round with zero findings never writes an approval.
**Today:** the git host seam has no merge operation (`src/core/forge/ops.ts`), but no CI test names it yet (#485).

## P7. Every loop has a cap and a stop

> Every loop has a cap and a stop, and ends at a person, with a short summary.

**Kind:** non-negotiable.
**Why:** a loop with no end spends without limit; a person handed a stop must see why at a glance.
**Checked by:** every path reaches a cap or a person, with a summary of at most 3 lines. **Today:** no CI test yet
(#485).

## P8. A person starts everything

> Nothing starts unless a person starts it.

**Kind:** non-negotiable.
**Why:** the factory spends money and writes to shared places; a person decides when it does.
**Checked by:** no run starts without a person's START. **Today:** no CI test yet (#485).

## P9. Nothing in the product repo by default

> Nothing is committed to the product repo by default. Work: never. Personal and aruvii projects may opt in, for the
> spec, the brief and the glossary, and may get proposed edits to the project's agent instruction file (AGENTS.md or
> CLAUDE.md), each as a PR a person merges. A spec PR's empty commit carries no files and is allowed everywhere.

**Kind:** non-negotiable.
**Why:** a work repo belongs to its team; a personal project may choose to keep its knowledge beside its code.
**Checked by:** with the work setting, nothing commits to the product repo (`src/core/settings/resolve.ts` refuses it).
**Today:** no CI test names it yet (#485).

## P10. Measure outcomes from a full trace

> Every ticket records its outcome: cost, waiting time, rework rounds, the person's touches, and whether the change
> held up after merge. Every run keeps its full trace, so it can be inspected and replayed.

**Kind:** guidance.
**Why:** a count of PRs is not a measure; what a change cost and whether it held up is. A trace says why a run failed,
which skills it read and where its tokens went.
**How:** traces stay on the machine beside the ticket's records for 30 days. The outcome is reported at 2 weeks after
merge, and a revert or a fix to the same lines up to 30 days updates it (#487).

## P11. Change the factory only by experiment

> A change to a prompt, card, rule, model or cap is kept only if it is no worse than the baseline on what it must hold,
> and better by more than the noise on what it aims at (quality or cost), measured on cases it was not tuned on. Where
> no eval exists yet, it is measured on the next pilot tickets, and its PR says "untested by an eval". Changing which AI
> jobs a lane runs, or how much one run does, is tested before it is kept.

**Kind:** guidance.
**Why:** an unmeasured tweak can make things worse without anyone seeing; a change that only lowers cost must still be
allowed.

## P12. Learn at the source

> For every merge the engine writes a timeline record, with no model. A retro runs only when a person starts it. Each
> lesson becomes one PR, fixed at the highest level that holds, and a person merges it.

**Kind:** guidance.
**Why:** the same review comment forever is a failure of the factory, not of the run. A mistake counts as repeated
after two sightings; how a lesson is found and fixed lives in the rules pack's retro reference.

## P13. Typed hand-offs, people included

> Every hand-off between steps is a typed field the next run reads, the person's answers included. A question closes
> only on a real answer: a reply that names a choice for every open question. An answer is recorded as its own event,
> tied to the spec version it answered, and the approval holds; an answer that adds, drops or changes an acceptance
> criterion goes into the spec instead, and the approval goes stale. A person can pause or take over a ticket.

**Kind:** non-negotiable.
**Why:** an answer lost between runs is work done twice, and any note read as an answer lets a run go on unanswered.
**Checked by:** a reply that answers only some questions (`1A` to two questions) keeps the rest open, and the next run
receives every answer as a field. **Today:** any note after a question counts as its answer (#486).

## P14. Only what the step needs

> Each run gets only what its step needs, fixed parts first and changing parts last. Each step has its own model and
> effort, the lane sets the review depth, and every cap is set from measured runs.

**Kind:** guidance.
**Why:** a run that reads less is cheaper and less confused, and a cap guessed too low or too high stops the wrong run.

## P15. Proof, not claims

> A run proves each criterion with a command the host re-runs; the writer cannot change what judges it; a blocking
> finding needs proof; every result says plainly what happened; the proof travels with the PR and shows at approval;
> and review converges: a later round looks only at what changed and never repeats an answered finding.

**Kind:** non-negotiable for "the writer cannot change what judges it" and "a blocking finding needs proof"; the rest
is guidance.
**Why:** a claim a run makes about its own work is not evidence; a person approving must see what was proved.
**Checked by:** a weakened assertion, a deleted or skipped test, and an edited eval, rule or CI file each stop the run;
an Act on finding graded only `cited` settles as Consider. **Today:** the test checks count assertion lines, so a
weakened assertion passes, and a finding's grade does not change its bucket (#485).

## P16. One home and one way

> Each fact lives in one place and others point to it; each job is done one way.

**Kind:** guidance.
**Why:** two copies drift, and two ways to do one job double what must be kept working.

## P17. One port per outside tool

> Every outside tool plugs in through one port with a contract test kit; the core never names a tool.

**Kind:** guidance.
**Why:** the same engine runs on GitHub and GitLab, with Jira or issues, on a laptop or a VM; a tool named in the core
breaks the others.

## P18. One versioned contract with the rules pack

> One versioned contract between the engine and its rules pack: the rules pack publishes the format of its cards,
> lanes and findings; the engine's CI checks the pinned rules pack against it, and the engine reads this version and
> the one before.

**Kind:** non-negotiable.
**Why:** the two repos change on their own schedules; a pack the engine cannot read must fail in CI, not in a run.
**Checked by:** CI validates each card of the pinned rules pack against the pack's own schema. **Today:** not built
until #484 lands.

## P19. People work from where they are

> People work from where they already are, through one engine with thin front doors, and setup stays proven by a
> fresh-install test.

**Kind:** guidance.
**Why:** a new app nobody opens is no front door; a setup no test runs breaks unnoticed.

## P20. The codebase gets better over time

> The long view is written where runs read it, and improvement work comes as its own tickets a person starts.

**Kind:** guidance.
**Why:** each change working is not enough; the next change must stay easy. Tidying inside an unrelated change hides
it from review.

## P21. Brakes scale with risk

> The change sets its lane, not who wrote it; a lane can only be raised, and no lanes file can lower the approval
> floor.

**Kind:** non-negotiable (the floor).
**Why:** risk is in the change, not its author; a lanes file that could drop an approval would undo every other brake.
**Checked by:** every lanes file (one lane, all lanes, missing lanes, `approval: false` on each, unknown names, any
order) leaves bug, feature and one-way door needing approval, and a lane can only be raised. **Today:** the first lane
listed skips the floor check until #483 lands.

## How changes are made

- **One written order.** When two sources disagree, the person's decision on the ticket wins, then the project's own
  rules, then the team's rulebook. A lasting rule change lands as a rule PR, never only in chat or a run's memory.
- **Numbers live only as settings keys.** Memory ceilings, machine sizes, ports and timeouts are settings keys
  ([settings](reference/settings.md)); rule text names the key, never the number.
- **This page changes only by pull request**, with the operator's yes. A principle's text names no ADR, article or
  other source; [where the principles come from](explanation/principles-map.md) lists the inputs each one covers.
- **A changed decision is a new ADR**, never an edit of the old one, which then names the new one in its status
  (`scripts/check-adrs.ts`).
