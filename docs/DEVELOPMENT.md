# Development — how to work in this repo

This repo builds the factory: the coordinator scripts and their tests (ADR-0009). Map #1 closed 2026-10-25; its
decisions are the design.

## 0 · Build

```
issue #NNN ──▶ branch <type>/NNN-slug ──▶ make lint + make test ──▶ PR (one per issue) ──▶ operator merges
```

1. Start from one issue. Make one branch and one PR for it.
2. Put a script in `scripts/`. Put its test in `tests/<script>.test.sh`.
3. Write a test as plain bash. It exits non-zero on a failed assertion. Use no test framework. Shared helpers are in
   `tests/lib.sh`.
4. Put bad input that a test needs in `tests/fixtures/<case>/`. `make lint` skips that folder.
5. Write scripts for bash 3.2 (stock macOS) and Ubuntu: POSIX tools only, no GNU-only flags. The coordinator scripts
   also need `glab` and `jq`. Every GitLab call goes through `gl_api` in `scripts/lib/gitlab.sh`; a test points
   `FACTORY_GLAB` at the stub from `glab_stub` in `tests/lib.sh`, so it needs no network.
6. Run `make lint` and `make test`. Both must exit 0. CI (`.github/workflows/ci.yml`) runs the same two targets on
   every pull request and on every push to `main`.
7. Pin every action in a workflow to a full commit SHA. Dependabot (`.github/dependabot.yml`) proposes the updates.

`make lint` runs two checks:

| check | fails when |
|---|---|
| `scripts/check-links.sh` | a relative link in a tracked `.md` file names no file. It skips web links, `#anchor` links and code. It skips `tests/fixtures/` and `drafts/agent-platform/`, whose links resolve in agent-platform. |
| `scripts/check-size.sh` | the root `AGENTS.md` has 200 lines or more (ADR-0003 Decision: "root, <200 lines") |

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

- The operator approves every commit and every push. Commit only when the operator says "commit" in this session.
- Subject: `type(area): subject`, lower case, no period. Types in use: `docs`, `research`, `chore`, `fix`, `feat`.
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
