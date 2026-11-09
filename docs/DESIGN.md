# agent-factory design

The one page that says what agent-factory is, how it works, what changes from today, and the order we build it.
Decisions and their reasons live in `docs/adr/` and on map #30. This file points at them. When the two disagree, the
ADR wins and this file is fixed.

## 1. What it is

An engine that turns a human-approved ticket into a draft pull request, safely and with no one watching. Then a human
merges it.

- **It runs alone.** With no plugin installed, it works on its own small built-in process and review rules.
- **Standards and process plug in.** A project adds its own repo files and normal Claude Code plugins
  (`name@marketplace`). The rulebook (`rulebook@chiyanram`) is one such plugin, not a dependency.
- **Safety stays in the engine.** No plugin can switch off the box, the push guards, the test checks or
  "a human merges".

Who it is for, in rollout order: a small personal project (ledger, #62), aruvii, the operator's work laptop, work
colleagues, then anyone.

## 2. Rules that never change

| # | rule | ADR |
|---|---|---|
| P1 | Code decides every routine step. No model decides what runs next | 0011 D13, 0012 S3 |
| P2 | Every run is a fresh worker. A worker is never resumed | 0001 |
| P3 | The forge and the tracker are the memory. A restart loses nothing | 0002 |
| P4 | No model holds a forge login. The host pushes and posts | 0012 S6, S14 |
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
              design review ──▶ verify pass ──▶ human approval      (lanes that need it)
                   ▼
              test-first (bug lane) ──▶ writer ──▶ cleanup           (in the box)
                   ▼
              ready check: re-run every evidence row; test checks S1-S4; lane from the real diff
                   ▼
              finder per lens ──▶ verify pass ──▶ act_on? back to the writer (3 rounds max)
                   ▼
              gate (local box · Verifier · CI) ──▶ draft PR ──▶ human merges ──▶ retro
```

- **Start.** Only a human START starts a ticket: `agent-factory start`, `/start` in Discord, or a spec PR. In the
  lanes that need approval, the approval is the START. After START, a `dispatch --once` pass every few minutes carries
  the ticket to the PR with no more typing. A sleeping laptop picks it up on the next pass.
- **Extra jobs** (retro, weekly clean-up, triage) are off until a human starts one. A schedule can be switched on per
  job later.
- **Lane.** tiny, bug, feature or one-way door. The coordinator proposes it, and code checks the planned files and the
  real diff. Code can only raise the lane, never lower it.
- **Approval by lane.**
  - tiny: none;
  - bug, feature, one-way door: always, for solo work too.

  Any human may approve, never a bot. The approval binds the spec (and design) hash, and any edit makes it stale.
- **Questions.** A worker that needs a decision stops with `asked`. The question goes to the front doors (terminal,
  Discord thread). The answer goes **into the spec**, so an approval lane approves again.
- **Limits.** Caps per run, per ticket and per project per day. A run with no output for 5 minutes is stopped. A failed
  step backs off from 10 s, doubling, up to 5 minutes.

## 4. The parts

```text
 ┌─────────────── ENGINE (this repo) ───────────────────────────────────────────┐
 │ dispatcher (fixed flow) · run records · lock · box · host push guards          │
 │ start + approval records · test checks S1-S4 · lane check · caps, stall, backoff│
 │ settings in layers · reads role cards and lanes from the process plugin         │
 └──────▲───────────────────────────────▲────────────────────────────────────────┘
        │ seams (plugins with 2+ real choices)        │ per project, from ~/.factory/projects/<p>.json
   chat      terminal · Discord bot · web app (later)  │   "plugins": ["rulebook@chiyanram", ...]
   approval  terminal · Discord · spec PR · Jira (later)│   plus the repo's own files on the default branch:
   gate      local box · Verifier · GitHub/GitLab CI    │   AGENTS.md, CLAUDE.md, .claude/rules, .claude/skills,
   runner    claude · copilot                           │   a review-only file
   box       vm (Sysbox) · srt (work laptop)            │
```

- **The process plugin** gives the lanes as data and one **role card** per step: coordinator, design-reviewer,
  test-first, writer, cleanup, finder, verify-pass, retro. A card's frontmatter (tools, inputs, hand-off, hard
  guardrails) is enforced by the engine. Its body is what the model reads. The rulebook's crq is the first process
  plugin. The engine ships a small default one.
- **The fixed contract** the engine keeps, whatever the plugins:

  | item | what it holds |
  |---|---|
  | spec | intent · lane · numbered acceptance criteria · design link · out of scope |
  | report | `.factory/report.json`: `done` with evidence per AC, `asked` with 1–5 questions, or `blocked` |
  | approval record | ticket, spec hash, design hash, by, via, at |
  | evidence row | criterion · command · result |
- **Box.** On personal projects and aruvii: the VM box, Sysbox with its own Docker and Squid egress. On the work
  laptop: `srt` with no Docker, and container tests run on GitHub CI. The host Docker socket is never mounted.
- **Settings.** Three layers, all outside the repo: team → project → user. Safety keys only get stricter in a lower
  layer, and an unknown key is an error.

## 5. What changes from today (`main` `ff95ed3`)

| today | changes to |
|---|---|
| the writer and the reviewer refuse to start without `FACTORY_RULEBOOK` | they run with no plugin, on built-in defaults |
| the review requires the rulebook's `skills/code/references/smells.md` | the baseline comes from the process plugin, or the built-in one |
| `AGENTS.md` pointers must say "(rulebook plugin)" | the repo's own files plus enabled plugins, by their standard names |
| prompts live in `prompts/*.md`, with crq rule ids typed in | role cards live in the process plugin; the engine keeps no prompt text |
| the reviewer reads the change description as the spec (`review/pack.ts:409`) | it reads the approved spec and design from the spec store (#224) |
| crq review checks never reach the reviewer | they are always sent, from the process plugin |
| a ticket starts from an approval file; the lane comes from the approval | START or approval records; the lane is checked from the diff |
| one approval kind, local, nothing on the forge (ADR-0012 S1) | approval by lane, many front doors, a bot-written copy on the forge |
| findings have no lens or evidence grade | `lens` and `evidence: cited / walked / ran` |
| one find pass for all rules (ADR-0004) | one find run per lens, one shared verify pass |
| a team template copied once (ADR-0014 P3) | live settings layers, pinned by commit |
| the box is the VM only; the laptop box is refused (`box/choose.ts:24`) | `srt` on the work laptop |
| Claude only | a runner seam: claude and copilot |
| caps per run only | caps per run, ticket and project-day, plus usage records |

ADRs to update when the work lands: 0004, 0012 S1 and S3, 0014 P3. ADR-0006 (a service account per developer) is
replaced by 0012 S14 (the developer's own login, or a bot).

## 6. Order of work

| step | what | exit check |
|---|---|---|
| 0 | eval set: the reviewer golden set (ADR-0015) and about 10 past tickets end to end | a baseline recorded |
| 1 | safety core: the reviewer gets the spec · review checks reach it · START and approval records · lane check + approval floor · test check S4 + waiver · stall + backoff · caps + usage · rebase row | planted tests: a deleted test, a skip, fewer asserts, a lower lane, and a stalled run each stop |
| 2 | plugins and settings: plugins per project · role cards read from the process plugin · hard ties removed · settings layers | a run with no plugin, with the rulebook, and with a stand-in team plugin |
| 3 | **ledger pilot** (#62) on the VM | targets fixed before it starts (merge rate, human fix minutes, cost per merged PR) |
| 4 | aruvii: Discord factory bot · Verifier gate · review lenses · cutover (#43, #44) | the same targets |
| 5 | work laptop: Copilot spike · `srt` box · Copilot runner · proxy and CA | 5 tickets with no memory kill, specs never in git |
| 6 | colleagues: Jira approval · spec PR · team template | 2–3 colleagues meet the targets |
| later | web app · signed approvals on laptops · extra jobs on schedules · an RCA agent on top | — |

Each step widens only after its exit check passes.

## 7. Open

- Whether Copilot CLI loads Claude plugins. If not, the engine passes it the plugin's skills folder (step 5 spike).
- Which plugin wins when two disagree. Proposed: the project's list order, with its own repo files last; the reviewer
  names each rule's source.
- Accepted risk on laptops: the AI runs as the developer, so deny rules are not a wall. The human merge review stays
  the hard gate.
