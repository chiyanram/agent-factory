# agent-factory design

This page says what agent-factory is, how a ticket goes through it, what changes from today, and the order we build it
in. Words are defined in [GLOSSARY.md](../GLOSSARY.md). Decisions and their reasons live in `docs/adr/` and on map
#30; this page points at them. When this page and an ADR disagree, the ADR wins and this page is fixed.

## 1. What it is

agent-factory is a software factory. Its engine turns a ticket that a human started into a draft PR, safely and with no
one watching. Then a human merges it.

- **It runs alone.** With no plugin installed, it works on its own small built-in process and review rules.
- **Standards and process plug in.** A project adds its own repo files and normal Claude Code plugins
  (`name@marketplace`). The rulebook (`rulebook@chiyanram`) is one such plugin, not a dependency.
- **Safety stays in the engine.** No plugin can switch off the runner's sandbox, the push guards, the test checks or
  "a human merges".

Rollout order: a small personal project (the ledger, #62), aruvii, the operator's work laptop, work colleagues, then
anyone. An RCA agent for work comes later, on top of the same engine.

## 2. Rules that never change

| # | rule | ADR |
|---|---|---|
| P1 | The engine decides every routine step. No model decides what runs next | 0011 D13, 0012 S3 |
| P2 | Every run is fresh. A run is never resumed | 0001 |
| P3 | The ticket tracker and the git host are the memory. A restart loses nothing | 0002 |
| P4 | No model holds a git host login. The host pushes and posts | 0012 S6, S14 |
| P5 | Rules and settings come from the default branch, never from the change | 0012 S12 |
| P6 | The AI never approves anything, and zero findings is not a pass | 0012 S10 |
| P7 | Every loop has a cap and a stop | 0012 S3 |
| P8 | **Nothing starts unless a human starts it** | new (2026-11-09) |
| P9 | Nothing the factory needs is committed to the product repo | new (work rule) |

## 3. How a ticket goes

```text
human START ──▶ coordinator: research, ask, spec (+ design)
                   │ the engine checks the lane from the planned files (raise only)
                   ▼
              design-reviewer ──▶ verify pass ──▶ human approval       (lanes that need it)
                   ▼
              test-first (bug lane) ──▶ implementer ──▶ cleanup          (each a run on a runner)
                   ▼
              ready check: re-run every evidence row; test checks S1-S4; the lane from the real diff
                   ▼
              automated review: finder per lens ──▶ verify pass ──▶ act_on? back to the implementer (3 rounds max)
                   ▼
              gate (local runner · Verifier · CI) ──▶ draft PR ──▶ human merges ──▶ retro
```

- **START.** Only a human START starts a ticket: `agent-factory start`, `/start` in Discord, or a spec PR. In the
  lanes that need approval, the approval is the START. After START, an orchestrator pass (`dispatch --once`, every few
  minutes) carries the ticket to the PR with no more typing. A sleeping laptop picks it up on the next pass.
- **Extra tasks** (retro, weekly clean-up, triage) are off until a human starts one. A schedule can be switched on
  per task later.
- **Lane.** tiny, bug, feature or one-way door. The coordinator proposes it, and the engine checks the planned files
  and the real diff. The engine can only raise the lane, never lower it.
- **Approval by lane.**
  - tiny: none;
  - bug, feature, one-way door: always, for solo work too.

  Any human may approve, never a bot. The approval binds the spec and design hashes, and any edit makes it stale.
- **Questions.** A run that needs a decision ends with an ask. The question goes to the front doors (terminal, Discord
  thread). The answer goes **into the spec**, so an approval lane approves again.
- **Limits.**
  - Caps per run, per ticket and per project per day.
  - A run with no output for 5 minutes is stopped.
  - A failed step backs off from 10 s, doubling, up to 5 minutes.

## 4. The parts

```text
 ┌──────────────── ENGINE (this repo) ──────────────────────────────────────────┐
 │ orchestrator (fixed flow) · run records · lock · host push guards             │
 │ START + approval records · test checks S1-S4 · lane check · caps, stall, backoff│
 │ settings in layers · enforces each role card's frontmatter                     │
 └──────▲───────────────────────────────▲────────────────────────────────────────┘
        │ seams (plugins with 2+ real choices)          │ per project, from the project home
   front door  terminal · Discord bot · web app (later)  │   "plugins": ["rulebook@chiyanram", ...]
   approval    terminal · Discord · spec PR · Jira (later)│   plus the repo's own files on the default branch:
   gate        local runner · Verifier · GitHub/GitLab CI │   AGENTS.md, CLAUDE.md, .claude/rules, .claude/skills,
   agent CLI   claude · copilot                           │   a review-only file
   runner      vm (Sysbox) · srt (work laptop)            │
```

**The process plugin** holds two things. The rulebook's crq is the first such plugin, and the engine ships a small
default one.
- **The lanes, as data.**
- **One role card per role:** coordinator, design-reviewer, test-first, implementer, cleanup, finder, verify pass, retro
  and onboarder. The engine enforces a card's frontmatter (tools, inputs, `must_not_see`, hand-off, hard guardrails).
  The card's body is what the model reads.

**The fixed contract** the engine keeps, whatever the plugins:

| item | what it holds |
|---|---|
| spec | intent · lane · numbered acceptance criteria · design link · out of scope |
| report | `.factory/report.json`: `done` with evidence per AC (and an optional `deferred` list), `asked` with 1–5 questions, or `blocked` |
| approval record | ticket, spec hash, design hash, by, via, at (also START and test-change records) |
| evidence row | criterion · command · result |
| finding | lens, file, line, rule, severity, evidence (`cited`, `walked` or `ran`), fix |

**Project knowledge** (decided 2026-11-09). Each part does what it is good at:
- **structure:** a repo map built at run time and never stored;
- **meaning:** `glossary.md`, with avoid words, plus the decision records;
- **commands and gotchas:** `brief.md`. The onboarder writes it once, and a human reviews it;
- **lessons:** proposed by the retro and accepted by a human.

All of it is kept in the project home by default, and at work it is never committed. Existing `AGENTS.md` and
`CONTEXT.md` files are linked, never copied. No counts that rot; every `file:line` is checked again on each run.

**Runners.**
- **`vm`** on personal projects and aruvii: Sysbox, with its own Docker and Squid egress.
- **`srt`** on the work laptop: no Docker; container tests run on GitHub CI.
- The host Docker socket is never mounted.

**Settings.** Three layers, all outside the repo: team → project → user. Safety keys only get stricter in a lower
layer, and an unknown key is an error.

## 5. What changes from today (`main` `ff95ed3`)

| today | changes to |
|---|---|
| the implementer and the automated review refuse to start without `FACTORY_RULEBOOK` | they run with no plugin, on built-in defaults |
| the review requires the rulebook's `skills/code/references/smells.md` | the baseline comes from the process plugin, or the built-in one |
| `AGENTS.md` pointers must say "(rulebook plugin)" | the repo's own files plus enabled plugins, by their standard names |
| prompts live in `prompts/*.md`, with crq rule ids typed in | role cards live in the process plugin; the engine keeps no prompt text |
| the review reads the change description as the spec (`review/pack.ts:409`) | it reads the approved spec and design from the spec store (#224) |
| crq review checks never reach the review | they are always sent (#226), later from the process plugin |
| a ticket starts from an approval file, and the lane comes from the approval | START or approval records; the lane is checked from the diff |
| one approval kind, local, nothing on the git host (ADR-0012 S1) | approval by lane, many front doors, a bot-written copy on the git host |
| findings have no lens or evidence grade | `lens` and `evidence: cited / walked / ran` |
| one find pass for all rules (ADR-0004) | one finder run per lens, one shared verify pass |
| a team template copied once (ADR-0014 P3) | live settings layers, pinned by commit |
| one runner kind, `vm`; the laptop is refused (`box/choose.ts:24`) | `srt` on the work laptop |
| `claude` only | an agent CLI seam: claude and copilot |
| caps per run only | caps per run, ticket and project-day, plus usage records |
| no project knowledge | the onboarder's brief and glossary in the project home |
| old words in code and docs (forge, box, dispatcher, writer) | the glossary's words (#144) |

ADRs to update when the work lands: 0004, 0012 S1 and S3, 0014 P3. ADR-0006 (a service account per developer) is
replaced by 0012 S14 (the developer's own login, or a bot).

## 6. Order of work

| step | what | tickets | exit check |
|---|---|---|---|
| 0 | eval set: the reviewer golden set (ADR-0015) and about 10 past tickets end to end | #213–#217 | a baseline recorded |
| 1 | safety core | #224 #226 #227 #228 #230 #231 #131 #103 #185 #199 #200 | planted tests: a deleted test, a skip, fewer asserts, a lower lane and a stalled run each stop |
| 2 | plugins, role cards and settings | #229 #232 (with chiyanram/skills#237) | a run with no plugin, with the rulebook, and with a stand-in team plugin |
| 3 | **ledger pilot**, with project setup by the onboarder | #62 (with #158, #130 on the VM) | targets fixed before it starts: merge rate, human fix minutes, cost per merged PR |
| 4 | aruvii | #233 #234 #218–#221 #35 #38 #40 #41 #42 #43 #44 | the same targets |
| 5 | work laptop | #162 #114 #198 | 5 tickets with no memory kill, specs never in git |
| 6 | colleagues | Jira approval · spec PR · team template | 2–3 colleagues meet the targets |
| later | web app (#120) · signed approvals on laptops · scheduled extra tasks · the RCA agent | — | — |

Each step widens only after its exit check passes. Map #30 keeps the current list.

## 7. Open

- Whether Copilot CLI loads Claude plugins. If not, the engine passes it the plugin's skills folder (the #162 spike).
- Which plugin wins when two disagree. Proposed: the project's list order, with its own repo files last. The automated
  review names each rule's source.
- **Accepted risk on laptops:** the AI runs as the developer, so deny rules are not a wall. The human merge review
  stays the hard gate.
- Acceptance criteria as Gherkin (the rulebook's GA1–GA6) or numbered lines (the spec template here). Decided in
  chiyanram/skills#237.
