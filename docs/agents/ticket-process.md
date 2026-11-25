# Ticket process

How a session picks up, plans, reports on and closes a ticket, and how a lane or a step of the process changes.
`AGENTS.md` sends a session here before any of that.

## Pick the lane

Pick each build ticket's lane by its risk, as the rules pack's lanes reference does, because brakes scale with risk
and no lane lowers the approval floor (P21):

| lane | for | grilling | spec | design | operator approval |
|---|---|---|---|---|---|
| tiny | docs, comments, a config value, a patch bump | no | no | no | no |
| bug | a defect | no | short, plus a failing test first | only when an interface or more than one module changes | yes |
| feature | something new | yes | yes | yes | spec and design, on the ticket |
| one-way door | an irreversible change | yes | yes | yes | spec and design, plus a yes for each irreversible step |

Every lane ends in build, automated code review and a PR from `.github/pull_request_template.md`.

Say the lane and why when you pick up a ticket. The operator can raise it, never lower it.

## Report

Keep one report per ticket: the grilling, spec, design and ADR draft live in one ticket comment. When any of them
changes, edit that comment in place, with one line at its top saying what changed and from whose words; never post an
amendment beside it. Report to the operator in chat the same way, as one whole message, not pieces. The operator
approves one text, and a report split across comments hides what is being approved.

Split work too big for one PR into child tickets before the build, because the operator approves the shape before code
exists, not after.

## Sessions

Run each ticket's work in its own fresh ticket session, starting from `agent-factory board` and the ticket's body and
comments, never from another ticket's thread, because a long session re-reads its whole thread on every turn. The
project's one long coordinator plans, routes, relays and reports, builds no ticket, and resets from
`agent-factory handoff <project>`, never from a model's summary, because a summary drops what the records hold.

Put `waiting:operator` on the ticket's issue when the session stops for the operator's word, and take it off once it
has the answer, because `board` and the ping find a waiting session only by that label
([triage-labels.md](triage-labels.md)). Keep every other label: add and remove this one only.

## Change the process

Cut a step from a lane only on measured numbers, the cost per run kind on the run timeline, read after about 15
tickets, because a few tickets' impressions are not a measure.

Bring in a new check, role, lens or outside skill manual first and climb one rung at a time, as P11 in
[CONSTITUTION.md](../CONSTITUTION.md) says, because a step made automatic before anyone used it by hand cannot be
judged.

Land a step in the engine first. When the step needs a new skill, land the skill in the rules pack, then move the pin,
because the pinned pack must hold each skill the engine names (P18).
