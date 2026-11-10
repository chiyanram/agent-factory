# agent-factory design

This page says what agent-factory is, how a ticket goes through it, what changes from today, and the order we build it
in. Words are defined in [GLOSSARY.md](../../GLOSSARY.md). Decisions and their reasons live in `docs/adr/` and on map
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
- **The orchestrator** carries the ticket from approval to the PR. The human's command starts a loop that carries
  their tickets and exits when none is in flight (`dispatch`, or `start` and `approve` in the background). No cron
  and no launchd job: nothing runs when nothing is in flight, and a loop never waits on a cap or a step that is not
  set up: it exits and says when to run it again. A sleeping laptop stops the loop; `dispatch` again
  carries on from the records. `dispatch --once` is one pass by hand.
- **Extra tasks** (full retro, weekly clean-up, triage) are off until a human starts one. A schedule can be switched on
  per task later.
- **Lane:** tiny, bug, feature or one-way door.
  - The coordinator proposes it. The engine checks the planned files before the build, and the real diff in the ready
    check, and can only raise it.
  - One-way-door paths are a project setting.
  - A raise that needs an approval the ticket lacks stops and asks.
  - The engine acts on a lane's properties, never on its name.
- **Questions.** A run that needs a decision ends with an ask. By default it asks **every open question at once, in one
  numbered round**; each question carries 2 to 4 short choices and one recommended choice, so a person answers with
  taps, "1A 2B", or "accept all". The project setting `questions` can be `one-at-a-time` instead. Never a guess. The
  round goes to the front doors (terminal, Discord thread, spec PR). The answer goes **into the spec**, so an approval
  lane approves again (the operator, [2026-11-09](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6744864148); #320).
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
- **Updating is deliberate.** An update shows the change, runs `config check`, and then moves the pin. **Today:** it
  runs no eval set ([Plugins and role cards](plugins-and-roles.md#what-is-decided-next)).
- **One ticket, one set of versions.** Run records carry the hash of the spec, the design, each plugin and each rubric
  used, so an update applies to the next ticket only.
- **Order.** One process plugin per project: a second plugin with a process is a `config check` error, and a run stops
  on it (#426). Decided: other plugins add rules only, and their rule IDs carry the plugin's name
  ([Plugins and role cards](plugins-and-roles.md#what-is-decided-next)). **Today:** their rule IDs carry no plugin
  name.

**The process plugin** holds the lanes, as data, and one role card per role. The rulebook's crq is the first such plugin,
and the engine ships a small default one.
- **The approval floor:** a lanes file can make a lane stricter, never drop the approval for any lane above tiny.
- **The roles:** coordinator, design-reviewer, test-first, implementer, cleanup, finder, verify pass, retro and
  onboarder.
- **A role card's frontmatter**: the engine enforces `role`, `tools` (with an `Edit(…)` path scope), `must_not_see`,
  `hand_off` and `enforced_guardrails` (IDs from a closed list); `input`, `steps` and `rules` are text the model reads ([Plugins and role cards](plugins-and-roles.md#what-a-role-card-controls)).

**Connectors** are the engine's swappable parts (ADR-0014). Each has a dry mode that shows what it would write and writes
nothing. Each passes the shared test kit: approve, stale after an edit, refuse a bot.

**The fixed contract** the engine keeps, whatever the plugins:

| item | what it holds |
|---|---|
| spec | intent · lane · acceptance criteria (numbered `AC-n`, [Spec, design and project knowledge](spec-and-knowledge.md)) · design link · out of scope · planned files (optional) |
| report | `.factory/report.json`: `done` with evidence per AC (and an optional `deferred` list), `asked` with questions, or `blocked` |
| PR body | the engine's own lines (spec hash, approval, deferred list), then `.factory/pr.md`, written by the implementer and posted by the host only through the cleaner (#335; ADR-0012 S13) |
| approval record | ticket, spec hash, design hash, by, via, at; also START and test-change records |
| evidence row | criterion · command · result |
| finding | id, lens, axis, kind, file, line, rule, category (bug, security, test_gap…), severity (blocker, warning, nit), grade (how strong the proof is: `cited`, `walked` or `ran`), evidence (the proof itself), finding (the plain description), fix; the finder gives all but the lens, which the engine adds (decided on #30, 2026-11-09) |
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

**Spec home** is a setting (`specStore`, [Settings](../reference/settings.md#settings)):
- a local folder, which is the default and what work uses (`local`);
- the issue on the git host, for personal projects (`issue`, #381): its body is the spec, hashed the same way, so an
  edit to the issue makes the approval stale; the approval itself stays local;
- a shared place, or Jira, later;
- a repo commit, for personal projects that opt in.

**Runners.**
- **`vm`** on personal projects and aruvii: Sysbox, with its own Docker and Squid egress.
- **`srt`** on the work laptop: no Docker; container tests run on git host CI.
- The host Docker socket is never mounted.
- The egress allowlist refuses git host names.

**Toolchains: the project declares, the runner provides** (operator, 2026-11-10, #371). The hybrid model:

| part | model | in agent-factory |
|---|---|---|
| engine | Jenkins-like: defaults, layered config, plugins | built-in defaults, the settings layers, connectors and plugins pinned by hash |
| shared config | Renovate-like presets | the team layer, pinned by commit |
| toolchains | GitHub Actions and devcontainers: the project declares, the runner provides | the repo's `mise.toml`, `.tool-versions` or `.sdkmanrc`; `srt` allows back the detected manager's install folders read-only (mise, SDKMAN!, asdf, nvm) plus `srt.readOnly`; `vm` builds them into `box.Dockerfile` |

- The home stays hidden (#114). A folder allowed back is read-only, under the home, never the home itself, and never a
  credential path or a folder that holds one. A manager's config and shims never come back.
- Each folder allowed back is a risk line in `setup status`.
- Rejected for now: Nix or devbox, too heavy for colleagues to adopt.

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
- `agent-factory init` writes the user layer and the project file from one guided round (#369). The project's
  identity, its git host, its project there and its clone, lives in the project file; their variables still win.

**Audit.** Every action in the run records names the agent's role, the human who started the ticket, and the run id.
