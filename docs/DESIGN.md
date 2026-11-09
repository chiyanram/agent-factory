# agent-factory design

This page says what agent-factory is, how a ticket goes through it, what changes from today, and the order we build it
in. Words are defined in [GLOSSARY.md](../GLOSSARY.md). Decisions and their reasons live in `docs/adr/` and on map
#30, and this page points at them. When this page and an ADR disagree, the ADR wins and this page is fixed.

## 1. What it is

agent-factory is a software factory. Its engine takes a ticket a human started, and turns it into a draft PR, safely and
with no one watching. A human then merges it.

- **It runs alone.** With no plugin installed, it uses its own small built-in process and review rules.
- **Standards and process plug in.** A project adds its own repo files and normal Claude Code plugins
  (`name@marketplace`), listed in the project's settings. The rulebook (`rulebook@chiyanram`) is one such plugin, not a
  dependency.
- **Safety stays in the engine.** No plugin, connector or settings layer can switch off any of these:
  - the runner's isolation;
  - the push guards;
  - the test checks;
  - the approval floor;
  - "a human merges".

Rollout order: a small personal project (the ledger, #62), aruvii, the operator's work laptop, work colleagues, then
anyone. An RCA agent for work comes later, on the same engine.

## 2. Rules that never change

| # | rule | ADR |
|---|---|---|
| P1 | The engine decides every routine step. No model decides what runs next | 0011 D13, 0012 S3 |
| P2 | Every run is fresh. A run is never resumed | 0001 |
| P3 | The ticket tracker and the git host are the memory. A restart loses nothing | 0002 |
| P4 | No model holds a git host login. The host pushes and posts | 0012 S6, S14 |
| P5 | What judges a change never comes from that change: rules come from the default branch or a pinned plugin, and settings from outside the repo | 0012 S12 |
| P6 | The AI never approves anything, and zero findings is not a pass | 0012 S10 |
| P7 | Every loop has a cap and a stop | 0012 S3 |
| P8 | **Nothing starts unless a human starts it** | new (2026-11-09) |
| P9 | **Nothing is committed to the product repo by default.** Work: never. Personal and aruvii may opt in, for the spec, the brief and the glossary. A spec PR's empty commit carries no files and is allowed everywhere | new (2026-11-09) |

## 3. How a ticket goes

```text
human START ──▶ coordinator: research, ask, spec (+ design)           the engine checks the lane from the planned files
                   ▼
              design-reviewer ──▶ verify pass                         (lanes with a design review)
                   ▼
              human approval  ─────────────────────────────────────── (bug, feature, one-way door; tiny needs START only)
                   ▼
              test-first (bug lane) ──▶ implementer ──▶ cleanup         each a fresh run on a runner
                   ▼                       │ first finish: the host pushes and opens the draft PR
              ready check: every evidence row re-run · every AC has a row · test checks S1-S4 · lane from the real diff
                   ▼
              automated review: finder per lens ──▶ verify pass ──▶ act_on? back to the implementer (3 rounds max)
                   ▼
              gate (local runner · Verifier · git host CI) ──▶ ping the human ──▶ human merges
                   ▼
              timeline record (engine, every merge) · retro run (only when a human starts it)
```

- **START** opens a ticket: the coordinator researches, asks, and writes the spec, plus the design and its review
  where the lane needs them.
  - Front doors for START: `agent-factory start`, `/start` in Discord, a spec PR.
  - If a `factory/<ticket>` branch already exists on the git host, START asks first. Several factories may work on one
    project, so a phase may run on one machine and the build on another. The build begins only where a human said
    START.
- **Approval** lets the build begin, in the bug, feature and one-way-door lanes. Tiny needs START only.
  - Any human may approve, never a bot. A team may name its approvers.
  - The approval binds the spec and design hashes, and any edit makes it stale.
  - A one-way door lists each irreversible step, and the approval covers each one.
  - For team agreement, the developer opens a draft spec PR: the spec in its description, one empty commit. The PR's
    approval is the record (`via: "pr"`).
- **The orchestrator** carries the ticket from approval to the PR, with one `dispatch --once` pass every few minutes
  and no more typing. A sleeping laptop picks the ticket up on the next pass.
- **Extra tasks** (full retro, weekly clean-up, triage) are off until a human starts one. A schedule can be switched on
  per task later.
- **Lane:** tiny, bug, feature or one-way door.
  - The coordinator proposes it. The engine checks the planned files before the build, and the real diff in the ready
    check, and can only raise it.
  - One-way-door paths are a project setting.
  - A raise that needs an approval the ticket lacks stops and asks.
  - The engine acts on a lane's properties, never on its name.
- **Questions.** A run that needs a decision ends with an ask. The question goes to the front doors (terminal, Discord
  thread, spec PR). The answer goes **into the spec**, so an approval lane approves again.
- **Limits:**
  - **caps** per run, per ticket and per project per day. A ticket at its cap goes to needs-human with the spend shown.
    A day at its cap starts no new runs and sends one notice; nothing is killed mid-run.
  - **stall:** a run streams its output, and 5 minutes with no output stops it and shows its last output. Time asleep
    does not count.
  - **backoff:** a failed step waits from 10 s, doubling, up to 5 minutes. The next-try time is kept in the run record.

## 4. How the AI is kept from approving

- `agent-factory approve` and `start` are on the coordinator's **deny** list, and the coordinator never runs in
  bypass-permissions mode.
- The deny list also covers:
  - the user and team settings;
  - the plugin list;
  - the START and approval records;
  - the project home;
  - local rubric folders.
- On the VM, START and approval files are written only by the separate `factory` OS user.
- The Discord factory bot is code only, with no AI.
  - It runs as its own OS user, with its token in a 0600 file, and connects out with no open port.
  - Bots are refused, and a bot cannot press another bot's button.
  - A Discord user id maps to a person for `by`.
- The shared copy of an approval on the git host is for visibility only. It never starts anything, and it is trusted
  only when the project's factory bot posted it.
- **Accepted risk (decided 2026-11-09):** on a laptop the AI runs as the developer, so the deny list is not a wall.
  The human merge review stays the hard gate. Signed approvals come later.

## 5. The parts

```text
 ┌──────────────── ENGINE (this repo) ───────────────────────────────────────────┐
 │ orchestrator (fixed flow) · run records · lock · host push guards              │
 │ START + approval records · test checks · lane check · approval floor           │
 │ caps, stall, backoff · settings in layers · enforces each role card's frontmatter│
 └──────▲────────────────────────────────▲──────────────────────────────────────────┘
        │ connectors (2+ real choices)          │ plugins, per project (locked key, pinned)
   front door  terminal · Discord bot · web app   │   "plugins": ["rulebook@chiyanram", ...]
   approval    terminal · Discord · spec PR · Jira│   plus the repo's own files on the default branch:
   gate        local runner · Verifier · CI       │   AGENTS.md, CLAUDE.md, .claude/rules, .claude/skills,
   agent CLI   claude · copilot                   │   a review-only file
   runner      vm (Sysbox) · srt (work laptop)    │
```

**Plugins.** A project lists its plugins in its settings by `name@marketplace`.
- **The list is pinned and locked.** Each plugin is pinned by version and hash. The list is a locked settings key, so
  a user layer cannot drop or swap the process plugin.
- **Updating is deliberate.** An update shows the change, runs the eval set, and then moves the pin.
- **One ticket, one set of versions.** Run records carry the hash of the spec, the design, each plugin and each rubric
  used, so an update applies to the next ticket only.
- **Order.** Proposed: when two plugins disagree, the project's list order wins, with its own repo files last, and the
  automated review names each rule's source.

**The process plugin** holds the lanes, as data, and one role card per role. The rulebook's crq is the first such plugin,
and the engine ships a small default one.
- **The approval floor:** a lanes file can make a lane stricter, never drop the approval for any lane above tiny.
- **The roles:** coordinator, design-reviewer, test-first, implementer, cleanup, finder, verify pass, retro and
  onboarder.
- **A role card's frontmatter** (role, steps, input, `must_not_see`, hand-off, tools, enforced guardrails, rules,
  next) is enforced by the engine. Its body is what the model reads.

**Connectors** are the engine's swappable parts (ADR-0014). Each has a dry mode that shows what it would write and writes
nothing. Each passes the shared test kit: approve, stale after an edit, refuse a bot.

**The fixed contract** the engine keeps, whatever the plugins:

| item | what it holds |
|---|---|
| spec | intent · lane · acceptance criteria (the form is open, see section 9) · design link · out of scope |
| report | `.factory/report.json`: `done` with evidence per AC (and an optional `deferred` list), `asked` with questions, or `blocked` |
| PR body | `.factory/pr.md`, written by the implementer and posted by the host (who owns it is open, see section 9) |
| approval record | ticket, spec hash, design hash, by, via, at; also START and test-change records |
| evidence row | criterion · command · result |
| finding | id, lens, axis, kind, file, line, rule, severity, evidence (`cited`, `walked` or `ran`), fix |
| verdict | id, bucket (`act_on`, `consider`, `noted`, `dismissed`), why |

**Tests are judged twice:**
- **The engine's test checks** stop a removed test, an added skip, fewer assertions or a changed judge file (S1–S4).
  A human may clear one with a waiver scoped to the head; a new head re-checks only the new interdiff.
- **A test-integrity lens** reviews every other edit to an existing test.

**Project knowledge** (decided 2026-11-09). Each part does what it is good at:
- **structure:** a repo map built at run time, never stored;
- **meaning:** `glossary.md`, with avoid words, plus the decision records;
- **commands and gotchas:** `brief.md`, written once by the onboarder, which writes only to the project home, and
  reviewed by a human;
- **lessons:** proposed by the retro and accepted by a human.

These live in the project home. Existing `AGENTS.md` and `CONTEXT.md` files are linked, never copied. Nothing that
rots, such as counts, goes in, and every `file:line` is checked again on each run.

**Spec home** is a setting:
- a local folder, which is the default and what work uses;
- a shared place, later;
- the issue or Jira;
- a repo commit, for personal projects that opt in.

**Runners.**
- **`vm`** on personal projects and aruvii: Sysbox, with its own Docker and Squid egress.
- **`srt`** on the work laptop: no Docker; container tests run on git host CI.
- The host Docker socket is never mounted.
- The egress allowlist refuses git host names.

**Work setup.** A company proxy and CA, a package mirror, the allowed models, and a separate home (`~/.factory-work`)
so work and personal logins never mix.

**Settings.** Three layers, all outside the repo: team, then project, then user, with env vars as a machine layer.
- **Every key has a class:**

  | class | rule |
  |---|---|
  | ladder | the strictest value wins |
  | cap | the lowest value wins |
  | allow-list | team entries stay |
  | deny-list | all layers add |
  | locked | the highest layer wins |
  | preference | the lowest layer wins |
- Safety keys only get stricter in a lower layer.
- An unknown key is an error.
- The commands are `config show`, `config check` and `team update`.

**Audit.** Every action in the run records names the agent's role, the human who started the ticket, and the run id.

## 6. Measurement

- **Fixed before the ledger pilot starts:**
  - merge rate against a baseline;
  - human minutes to fix each PR;
  - tokens and cost per merged PR;
  - rework rounds;
  - reverts within 30 days.

  For example, 7 of 10 tickets merge, and the median fix time is under 15 minutes.
- **The numbers never rate a person.**
- **A lens that adds no unique verified finding after 20 PRs is retired.**
- **Evals:**
  - the automated review's golden set (ADR-0015);
  - about 10 past tickets end to end, once there is run history;
  - three scenarios per role card, in the process plugin.

  A model, prompt, card or plugin change ships only if its evals do not get worse.

## 7. What changes from today (`main` `ff95ed3`)

| today | changes to |
|---|---|
| the implementer and the automated review refuse to start without `FACTORY_RULEBOOK` | they run with no plugin, on built-in defaults |
| the review requires the rulebook's `skills/code/references/smells.md` | the baseline comes from the process plugin, or the built-in one |
| `AGENTS.md` pointers must say "(rulebook plugin)" | the repo's own files plus enabled plugins, by their standard names |
| prompts live in `prompts/*.md`, with crq rule ids typed in | role cards live in the process plugin; the engine keeps no prompt text |
| the review reads the change description as the spec (`review/pack.ts:409`) | it reads the approved spec and design from the spec store (#224) |
| crq review checks never reach the review | they are always sent (#226), later from the process plugin |
| a ticket starts from an approval file, and the lane comes from the approval (`dispatch/table.ts:44`) | START opens it, approval releases the build, and the lane is checked from the diff |
| one approval kind, local, nothing on the git host (ADR-0012 S1) | approval by lane, many front doors, a bot-written copy on the git host |
| the floor guard (`ready/floor.ts`) checks skips, deleted test files, fewer asserts, bare suppressions and empty catches, with no waiver | plus judge files (S4), test-case removal within a file, and a waiver scoped to the head (#231) |
| findings have no lens or evidence grade (`review/verdicts.ts`) | `lens` and `evidence: cited / walked / ran` |
| design findings skip the verify pass | they go through the verify pass |
| one find pass for all rules (ADR-0004) | one finder run per lens, one shared verify pass |
| `report.json` has no `deferred` list | an optional `deferred` list (cleanup) |
| the PR body is built by the host | the host posts the implementer's `.factory/pr.md` |
| a team template copied once (ADR-0014 P3) | live settings layers, pinned by commit |
| one runner kind, `vm`; the laptop is refused (`box/choose.ts:24`) | `srt` on the work laptop |
| `claude` only | an agent CLI connector: claude and copilot |
| caps per run only | caps per run, ticket and project-day, plus usage records |
| no project knowledge | the onboarder's brief and glossary in the project home |
| old words in code and docs (forge, box, dispatcher, writer, plugin for a connector) | the glossary's words (#144) |

**ADRs to update** as the work lands:
- 0004: a finder per lens;
- 0011: lanes and phases become plugin data;
- 0012:
  - S1: approval;
  - S2: the deny list;
  - S3: new rows;
  - S8, S11 and S17: the `srt` runner on the laptop;
  - S14: role markers in posts and commits;
- 0014: connectors vs plugins; P3 becomes settings layers;
- 0015: the implementer's evals.

ADR-0006 (a service account per developer) is already replaced by 0012 S14.

## 8. Order of work

| step | what | tickets | exit check |
|---|---|---|---|
| 0 | eval set: the automated review's golden set (ADR-0015); 10 past tickets once there is run history | #213–#217 | a baseline recorded |
| 1 | safety core | #224 #226 #227 #228 #230 #231 #131 #103 | planted tests: a deleted test, a skip, fewer asserts, a lower lane and a stalled run each stop |
| 1, alongside | fixes found on the way | #185 #199 #200 #138 | `make lint` and `make test` |
| 2 | plugins, role cards and settings | #229 #232 (with chiyanram/skills#237) | a run with no plugin, with the rulebook, and with a stand-in team plugin |
| 3 | **ledger pilot**, with project setup by the onboarder | #62 (with #158, #130 on the VM) | the targets in section 6 |
| 4 | aruvii: tiny and docs tickets first, then bug, then feature | #233 #234 #35 #38 #40 #41 #42 #43 #44; the automated review changes of ADR-0015 #218–#221 | the same targets |
| 5 | work laptop | #162 #114 #198 | the same targets on the small laptop; specs never in git |
| 6 | colleagues | Jira approval · spec PR · team template | the same targets with 2–3 colleagues |
| later | web app (#120) · signed approvals on laptops · scheduled extra tasks · the RCA agent | — | — |

Each step widens only after its exit check passes. Map #30 keeps the current list.

## 9. Open

- **Acceptance criteria form:** Gherkin (the rulebook's GA1–GA6) or numbered lines (the spec template here). Decided in
  chiyanram/skills#237.
- **Questions:** asked one at a time, or as one numbered round. Proposed: a project setting.
- **The PR body:** the implementer writes it, as crq gives the PR phase to the build. To be confirmed.
- **Copilot CLI and Claude plugins:** whether Copilot CLI loads them. If not, the engine passes it the plugin's skills
  folder (the #162 spike).
