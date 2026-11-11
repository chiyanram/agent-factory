# Spec, design and project knowledge

What a ticket carries into a build, where it lives, and what is decided next. The settings are in
[Settings](../reference/settings.md#settings); the commands are `agent-factory spec`, `approve` and `onboard`
([CLI](../reference/cli.md#commands)).

## What a ticket carries

```text
 spec ──▶ design (bug, feature, one-way door) ──▶ design review ──▶ human approval ──▶ build
 intent · lane · ACs     decisions, types,          design-reviewer      binds the spec hash
 design link · planned   file placement              + verify pass        and the design hash
 files                                                                    any edit = stale
                        every run also reads: brief.md · glossary.md (the project home)
```

- **The spec is the contract.** It holds the intent in the human's words, the lane, the acceptance criteria and the
  design link (`src/core/spec.ts`). A spec with no acceptance criteria, or a character that does not show, is refused.
- **Acceptance criteria** are numbered: the n-th one is `AC-n`, one observable outcome each, with a table for many
  inputs. The ready check needs an evidence row for every `AC-n`.
- **The design review** runs before the approval in lanes that need it: a design-reviewer run gives each decision
  aligned, conflict or open, then a verify pass checks it. An approval given before the review's findings does not
  start the build. It converges (P15, #489): its findings feed one grill round, and the edit is reviewed again only
  when the round kept an Act on CONFLICT. The re-review and its verify pass read `earlier.json`, every earlier round
  and the text the last one read, and the engine drops a repeat of a finding an earlier round settled. After 2 rounds
  the person is told "no further design review (round cap)" and decides. An edit that raises the lane or changes the
  Planned files is a new review whatever the count. A spec whose Planned files need a heavier lane holds the review
  until the lane is raised, and a `file:line@commit` cite that does not hold stops it at once.
- **The approval** binds the spec's and the design's hashes. Any edit to either makes it stale, and a stale approval
  stops the work (`src/core/approval.ts`).

## Where it lives

| piece | work project | personal project |
|---|---|---|
| spec | `$FACTORY_HOME/specs/<project>/<ticket>/spec.md`, never on the git host (`specStore: local`) | the git host issue's body (`specStore: issue`, #381); an edit to the issue makes the approval stale |
| design | beside the local spec | beside the local spec |
| START, approval, run records | `$FACTORY_HOME`, on the machine that ran START | the same |
| brief, glossary | the project home, `$FACTORY_HOME/projects/<project>/` | the same |

**Today:** before the PR opens, a ticket's START, approval and run records, and at work its spec too, live only on the
machine that ran START. The build must run there. After the PR opens, the branch, the PR and a copy of the approval
are on the git host. The coordinator cannot write a spec to the issue yet; the person writes or pastes it.

## Project knowledge

The onboarder writes a project's brief and glossary once, a human accepts them, and every implementer run gets them
([Settings, project knowledge](../reference/settings.md#project-knowledge)). Each `file:line` they cite is checked
against the default branch on every run; a stale one is recorded for the retro. The project's `AGENTS.md` and ADRs are
linked, never copied. **Today:** the automated review does not read them.

## What is decided next

Decided in the design audit (2026-11-10), not built:

| change | why |
|---|---|
| **Build deviations.** The implementer never edits the design. It posts a `[writer] DEVIATION:` note on the PR: what changed, why, `file:line`. The approval stays valid, and the review judges against the design plus the note. A deviation that touches an acceptance criterion is an `OPEN:` question and stops the work | the rulebook's PD7 says "record the deviation in the design", which would make the approval stale |
| **At most 3 questions per round.** The rest become marked defaults that "accept all" takes | a round with no cap floods the human |
| **"AC-n — should X when Y"** is the standard form | it gives the trigger a place, as EARS and Gherkin do |
| **Each slice names its AC-n**, and the design-reviewer flags an AC with no slice | coverage is checked before the approval, not after the build |
| **A one-screen approval digest**: intent, ACs, irreversible steps, kept findings by severity | the human reads one screen, not every file |
| **The memory before the PR.** P3 is reworded to say what is true. Before a project is shared, the approval's spec, design and hashes are copied to the ticket (the issue, or Jira at work), so another machine can continue | a lost or switched laptop loses the ticket's records today |
| **The brief holds only what an agent cannot infer**: build and test commands, gotchas; its commands are re-run each run; runs with and without it are measured | a study found context files gave no success gain and raised cost by more than 20% |
| **Each lesson carries a review-by date** ([The improvement loop](improvement-loop.md)) | lessons rot |
