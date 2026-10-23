# Development — how to work in this repo

This repo plans. It does not build. No code, no merges, no VM changes come from here (map #1 Notes: "Plan, don't do").

## 1 · The map and its tickets

```
#1 map (wayfinder:map)
├─ R · research ticket   (wayfinder:research)  → one file research/NN-slug.md
├─ G · grilling ticket   (wayfinder:grilling)  → questions to the operator, one at a time
├─ T · task ticket       (wayfinder:task)
└─ L1…L7 · low-level design tickets (wayfinder:grilling), after the 2026-10-22 approval
```

| label | use |
|---|---|
| `wayfinder:map` | the map issue only (#1) |
| `wayfinder:research` · `grilling` · `prototype` · `task` | the ticket's type |
| `needs-triage` · `needs-info` · `ready-for-agent` · `ready-for-human` · `wontfix` | triage roles; map tickets use only `wayfinder:*` |

Commands: `docs/agents/issue-tracker.md`. Labels: `docs/agents/triage-labels.md`.

## 2 · How a decision is recorded

```
question ──▶ recommendation first ──▶ operator "yes" ──▶ comment on the ticket ──▶ resolution comment
                                                                                   ──▶ close ticket
                                                                                   ──▶ one line in #1 "Decisions so far"
```

1. Ask one question at a time. Give the state, the options and a recommendation.
2. Record the answer as a ticket comment: `Q3 DECIDED (operator 'yes', 2026-10-23; research/37): …`.
3. When all questions are answered, post one `RESOLUTION` comment.
4. Close the ticket.
5. Add one line with a link to the map's "Decisions so far".

To change a decision, never edit the old comment. Post a new comment: `CORRECTED`, `AMENDED`, `SUPERSEDED` or
`WITHDRAWN`, with the date and the reason. Example: #18 Q6 CORRECTED; #23 Q1 SUPERSEDED.

A piece enters the design only if it traces to an issue we hit or a practice that 2 or more independent sources share
(CP4, map #1 Notes). A piece with one source is marked **thin**.

## 3 · Research files

- One research ticket → one file `research/NN-slug.md`. `NN` is the next free number.
- The ticket's resolution links the file.
- Each claim cites a `file:line` or a URL. Quotes are 15 words or fewer.
- A source read only from a search summary is marked `NOT OPENED`.
- Research is read-only. It describes; the operator decides on the ticket.
- Briefs for agents that run elsewhere (for example on the VM) go in `docs/briefs/`.

## 4 · Review pages for human decisions

When the operator must tick many items, publish one review page (a claude.ai artifact). Record the verdicts as a
ticket comment with the page link.

| page | for |
|---|---|
| https://claude.ai/artifact/XwqdmZw23eSWjCkF9DHzC3 | the high-level design (approved 2026-10-22, #1) |
| https://claude.ai/artifact/BtUQtRyEctKMdHNfVmZxU8 | drafted reasons and MUST picks (#21, 2026-10-23) |
| https://claude.ai/artifact/Pqxf9rebUf7NJb1Zpk3vAr | the L1 file plan (#21 resolution) |

`review/` holds builders for pages made from files in this repo.

## 5 · Commits

- Commit and push only when the operator says "commit" in this session.
- Subject: `type: subject`, lower case, no period. Types in use: `docs`, `research`.
- Every commit has a body that says why.
- This repo uses the trailer `Co-Authored-By: Claude <model> <noreply@anthropic.com>`. agent-platform does not.

## 6 · Session handoff

```
session ends ──▶ docs/handoff-YYYY-MM-DD.md ──▶ next session reads it first
                 rules · decisions · open threads · frozen work · where things live
```

A handoff carries state. It decides nothing new. `docs/open-items.md` is the running list of what is not finished;
update it when a ticket closes. Latest handoff: `docs/handoff-2026-10-18.md`.

## 7 · Reporting to the operator

Diagram or table first, then about three lines. One thing per reply. Every issue or MR number carries 2–6 words of
context. Never a bare "A or B?". Source: `docs/handoff-2026-10-18.md` "Operator rules".
