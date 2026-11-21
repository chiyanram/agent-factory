# #827 — Profile: the factory's own design

Research for map #826 (compare the factory with Devin, Agent Orchestrator, Mattock and peers). This file profiles
agent-factory the same way the reference profiles do, and seeds the comparison matrix.

**Read at:** `origin/main` `39f7b68` (worktree `.claude/worktrees/factory-compare`). The map names `1d681d7`; `main`
has 6 more commits since then (#555, #764, #722, #766, #750, #767). The one that changes the design: #766 (`a0bb67d`)
deletes the `claim`, `release`, `block` and `reconcile` commands and denies `dispatch`, `review` and `setup` to the
coordinator. Rules pack: chiyanram/skills at `044aa84e03ce9ef641e599bcc76bbb120e29fd0a` (tag `rulebook--v3.1.0`,
`.github/rules-pack.json`).

**Evidence marks:** *doc* = documented, with the path. *code* = inferred from code, with `file:line`. All paths are
relative to the repo root unless they start with `skills:` (the rules pack at the pinned commit).

## 1. What it is, who it is for, licence

| fact | value | mark |
|---|---|---|
| what | A software factory. The engine takes a ticket a person started and turns it into a draft PR with no one watching. A person merges it. | *doc* `docs/explanation/architecture.md:9-10`, `docs/CONSTITUTION.md:10-11` |
| shape | Code decides each step from a fixed table (no model picks the next step). Each run is fresh and runs on a runner with no git host login. The host pushes and posts. | *doc* `README.md:25-29`; *code* `src/core/dispatch/table.ts:1-3` |
| who for | A developer or a small team who wants agent-built PRs on their own GitHub or GitLab repos, with each run sandboxed and capped. | *doc* `README.md:35-36` |
| what it is not | Not a hosted service, not always on, not a merge bot, not a rules pack. | *doc* `docs/CONSTITUTION.md:13-19`, `README.md:36-37` |
| status | A pilot on one small personal project (the ledger, #62). Rollout order: ledger, aruvii, work laptop, colleagues, anyone. | *doc* `README.md:69`, `docs/explanation/architecture.md:26-27` |
| licence | MIT, open source (engine and rules pack). Engine `package.json` is `"private": true`, so it is not on the npm registry; it ships as a release tarball on GitHub. | *doc* `LICENSE`, `README.md:79-81`, `README.md:46-47`; *code* `package.json:5-6`; rules pack: GitHub API `license.spdx_id` = `MIT` |
| design style | Agent-agnostic infrastructure that is built, not bought: engine separate from the rules pack and the agent. | *doc* `docs/explanation/factory-stack.md:14-18`, ADR-0009 |

## 2. Tech stack

| part | value | mark |
|---|---|---|
| language | TypeScript, one package; no bash scripts (ADR-0013). About 50k lines in `src/`, 152 test files. | *doc* ADR-0013, `AGENTS.md` MUSTs; *code* `package.json:2-4`, `find src -name '*.ts'` |
| runtime | Node >= 26, ESM. One runtime dependency: `yaml`. Vitest, Biome, oxlint, TypeScript 7 for dev. | *code* `package.json:7-9`, `package.json:31-48` |
| CLI binding | One binary `agent-factory` → `dist/cli.js`; `src/cli.ts` binds `runCli` in `src/app.ts` to the process. | *code* `package.json:10-12`, `src/cli.ts:52-104` |
| storage | Plain files under `$FACTORY_HOME` (default `~/.factory`): `starts/`, `approvals/`, `waivers/`, `specs/`, `projects/<p>.json`, `plugins/`, `marketplaces/`, `context/`. No database. | *code* `src/cli-common.ts:53`, `src/core/project.ts:1`; *doc* `docs/reference/cli.md:20-23`, ADR-0012 S1, S18 |
| run records | One append-only JSON-lines file per ticket: `<FACTORY_HOME>/runs/<project>/<ticket>.jsonl`; counts summed from it each pass, so a restart loses nothing. | *code* `src/core/dispatch/records.ts:1-8` |
| shared state | The git host itself (PR, labels, notes, CI status) is read every pass by `poll`. Before the PR opens, records live only on the machine that ran START (**Today**, #498). | *doc* ADR-0002, `docs/explanation/safety.md:132-134`; *code* `src/core/dispatch/table.ts:1-3` |
| queue | None. A human's command starts a loop that runs passes of the table and exits when nothing is in flight; no cron, no launchd, no broker. One loop per project, held by a lock. | *code* `src/core/dispatch/orchestrator-loop.ts:1-12`; *doc* `docs/explanation/architecture.md:70-75` |
| sandbox | Two runners: `vm` (Sysbox container, own Docker, `--internal` network, one Squid egress proxy per project) and `srt` (Anthropic sandbox runtime on a laptop, whole home hidden). No default: an unset `FACTORY_BOX` is refused; ladder `none < srt < vm`. | *code* `src/core/box/choose.ts:1-6`; *doc* `docs/explanation/safety.md:45-54`, ADR-0012 S7, S8 |
| egress | Allowlist by host name: model API and package registries; git host names always refused. TLS is never opened. | *doc* `docs/explanation/safety.md:50`, `:60`; *code* `src/core/egress/squid.ts:3-5` (cited by safety.md) |
| LLM providers | Claude Code CLI (`claude -p`) for every run today. Copilot CLI: coordinator only; the read-only run kind is built but switched off in code; writer kind not built. Model login is a model-only token (`claude setup-token`). | *code* `src/core/agent/index.ts:1-10`, `src/core/agent/switch.ts:1-8`; *doc* ADR-0012 S6, ADR-0022, `README.md:37-39` |
| model choice | Claude's default unless `FACTORY_WRITER_MODEL` is set; review verify uses two pinned models (rule vs logic findings). No model routing (#562). | *doc* `docs/explanation/models-and-sharing.md:10`, `docs/explanation/code-review.md` step 5, `docs/explanation/factory-stack.md:32` |
| observability | No platform. Run records, per-run traces (30 days, scrubbed), a timeline line per merge, `usage`, `trace`, `board`, `retro`. | *doc* `GLOSSARY.md:82-83`, `docs/explanation/architecture.md:247-249`, `docs/explanation/factory-stack.md:27-28` |
| release | semantic-release, GitHub release tarball. | *code* `package.json:21-22`, `release.config.mjs`; *doc* `README.md:43-48` |

## 3. Where its docs and code live

| what | where | mark |
|---|---|---|
| engine code and docs | github.com/chiyanram/agent-factory: `src/` (CLI files at top, `src/core/<module>/`), `prompts/`, `plugins/` (bundled connectors: discord, github, gitlab), `test/`, `evals/reviewer/` | *doc* `AGENTS.md` "Where things go" |
| principles | `docs/CONSTITUTION.md` (P1–P21, each non-negotiable or guidance, with its check) | *doc* `docs/CONSTITUTION.md:21-52` |
| design | `docs/explanation/architecture.md` (overview) and 11 more explanation pages; ADR wins over the page | *doc* `docs/explanation/architecture.md:3-5` |
| decisions | `docs/adr/0001`–`0024` | *doc* `docs/adr/` |
| how-to and reference | `docs/how-to/`, `docs/reference/` (cli, settings, connectors, orchestrator) | *doc* `README.md:72-77` |
| terms | `GLOSSARY.md` (software-factory words, ADR-0016) | *doc* ADR-0016 |
| tickets and maps | GitHub issues on chiyanram/agent-factory; wayfinder labels | *doc* `AGENTS.md` Pointers, `docs/agents/issue-tracker.md` |
| rules pack | github.com/chiyanram/skills, a Claude Code marketplace with plugins `rulebook` (skills `crq`, `code`, `testing`, `planning`, …) and `toolbox`. Process data at `skills:plugins/rulebook/skills/crq/process/` (`lanes.json`, `lanes-v2.json`, `review.json`, 8 role cards, JSON schemas). | *doc* `docs/explanation/plugins-and-roles.md:22-31`; GitHub tree at `044aa84` |

## 4. First note per topic (seeds the matrix)

| # | topic | what agent-factory offers | mark |
|---|---|---|---|
| 1 | user interaction | A long project **coordinator** (Claude Code or Copilot CLI session, in a terminal or a Discord channel) talks a ticket through and writes the spec. Questions go out as one numbered round with 2–4 choices and a recommendation. Each ticket runs in its own fresh ticket session. Human gates: START, approve, merge. Front doors: terminal, Discord door bot (code only); web app and spec-PR door still to build. | *doc* `docs/explanation/architecture.md:54-95`, ADR-0023; `prompts/coordinator.md` |
| 2 | CLI | One `agent-factory` binary, three groups: commands a person runs (`init`, `coordinator`, `start`, `approve`, `waive`, `board`, `usage`, `trace`, `retro`, `config`, `plugin`, `eval`, …), commands the coordinator runs (`poll`, `status`, `grill`, `handoff`, `waiting`, `request`, `confirm`), and commands the orchestrator and hooks run (`dispatch`, `review`, `lint-edit`, `edit-scope`, …). | *doc* `docs/reference/cli.md:8-70` |
| 3 | flow + state machine | Lanes tiny / bug / feature / one-way door, picked by risk, only ever raised by the engine. One pure decision table in code (`src/core/dispatch/table.ts`) gives one action per ticket per pass: `wait`, `writer`, `ready`, `review`, `verify`, `design`, `held`, `needs-human`, `release`, `ping`, `reconcile`, …. Every repeating row has a stop (3 rework rounds, 2 CI rounds, 1 merge failure), then `needs-human`. Backoff 10 s doubling to 5 min; stall at 5 min of no output. | *code* `src/core/dispatch/table.ts:14-66`, `:141-157`; *doc* `docs/explanation/build-path.md:9-39` |
| 4 | roles + prompts | Roles: coordinator, design-reviewer, test-first, implementer, cleanup, finder, verify pass, retro, onboarder. Built-in cards in `prompts/roles/`; a process plugin's cards win. Card frontmatter the engine enforces: `role`, `tools` (with an `Edit(…)` path scope), `must_not_see`, `hand_off`, `enforced_guardrails` (closed ID list); `input`, `steps`, `rules` are text only. | *doc* `docs/explanation/plugins-and-roles.md:33-48`; *code* `src/core/process/guardrails.ts:1-12`; `skills:plugins/rulebook/skills/crq/process/roles/implementer.md:1-10` |
| 5 | handoff | Typed files, not chat: a run ends with `.factory/report.json` (`done` with evidence rows per `AC-n`, `asked` with questions, or `blocked`) and `.factory/pr.md`; findings and verdicts have fixed fields. The project coordinator resets from `agent-factory handoff`, a note built by code from the records, never a model summary. | *doc* `docs/explanation/architecture.md:174-184`, P13; *code* `src/core/handoff.ts:1-6`, `src/core/report.ts` |
| 6 | review | Ready check first (re-runs every evidence row at the head on a fresh runner, test checks S1–S4, lane from the real diff). Then automated review: context pack with the PR's own `CLAUDE.md`/`AGENTS.md`/`.claude/` removed → one read-only finder per lens (count by lane) → merge → verify pass per kind → buckets Act on / Consider / Noted / Dismissed. The AI never approves; zero findings is not a pass. Reviewer eval set gates prompt changes (ADR-0015). | *doc* `docs/explanation/code-review.md:7-40`, ADR-0004, ADR-0015; *code* `src/core/review/lenses.ts:1-17` |
| 7 | plugins | Two kinds. (a) Claude Code plugins (`name@marketplace`), pinned by commit and sha256, a locked settings key, copied read-only into the run and passed by `--plugin-dir`; exactly one may carry a process (lanes + cards). (b) Connectors: executables with `describe` / `call` JSON protocol, pinned by hash, run with no shell, a timeout and a capped env, checked by a contract test kit. | *doc* `docs/explanation/plugins-and-roles.md:7-31`, `docs/reference/connectors.md:1-20`, ADR-0014; *code* `src/core/plugin/contract.ts:1-9` |
| 8 | adapters | Git host: one `Forge` seam, GitHub (`gh`) and GitLab (`glab`) adapters, or a connector plugin. Agent CLI: one adapter in core (ADR-0022), Claude live, Copilot partial. Runner: `vm` / `srt`. Front door: terminal / Discord on one door seam (ADR-0023). Spec store: `local` or `issue`. Gate: local verifier or git host CI. | *code* `src/core/forge/index.ts:1-12`, `src/core/agent/index.ts:1-10`, `src/core/box/choose.ts`, `src/core/door/write.ts:1-6`; *doc* ADR-0010, `docs/explanation/architecture.md:129-142`, `:201-206` |
| 9 | internals | Pure decision table, sealed result types (`{kind: …}`), append-only JSONL run records, settings in three layers outside the repo (team → project → user, plus env) with a class per key (ladder, cap, allow-list, deny-list, locked, preference). All git on a clone goes through `hostGit` with hooks and planted config off. | *code* `src/core/dispatch/table.ts:141-157`, `src/core/dispatch/records.ts:1-12`, `src/core/git.ts`; *doc* `docs/explanation/architecture.md:230-245` |
| 10 | security | ADR-0012 S1–S18: no git host token in any run; whole-process sandbox; egress allowlist; host push refuses CI files, agent settings and `.factory`; config never from the branch; posted text through one template that cannot ping, link, close or run a command; START and approval hash-bound and denied to the coordinator. Threat model = the lethal trifecta per run kind. | *doc* `docs/explanation/safety.md:8-55`, ADR-0012 |
| 11 | docs | Diátaxis split (how-to, reference, explanation) plus constitution, ADRs and glossary. `make lint` checks links, MUSTs, old words, history notes and that each **Today:** note names an open ticket. | *doc* `README.md:72-77`, `AGENTS.md` Check; *code* `scripts/check-today.ts` (cited by `docs/explanation/safety.md:4-6`) |
| 12 | stack | Node 26 TypeScript CLI that shells out to `claude`, `copilot`, `gh`, `glab`, `git`, `docker`, `srt`; files for state; Sysbox + Squid or `srt` for isolation. See section 2. | *code* `src/core/agent/index.ts:6-7`, `src/core/forge/index.ts:5-6`; *doc* `docs/reference/settings.md:15` |

## 5. Today: gaps against ADR-0012

Each row is a place where the code does not yet do what ADR-0012 decided. Source: the **Today:** notes.

| ADR-0012 row | gap today | closing ticket | mark |
|---|---|---|---|
| S1 front doors | Terminal and Discord doors built; web app and spec-PR door not. On a laptop the developer user can read the door bot's token, so `via: discord` is a record, not proof. | #714, #715 | *doc* ADR-0012 S1 Today, `docs/explanation/architecture.md:105-107` |
| S2 coordinator wall | On a laptop the deny list matches commands as typed and is no wall (accepted risk; the merge review is the hard gate). | #674 | *doc* `docs/explanation/safety.md:53`, `:61`, `:85-86` |
| S2 coordinator wall | It holds no git host login only by its settings; running as its own OS user on the VM is not built. | #493 | *doc* `prompts/coordinator.md:26-27` |
| S2 / ADR-0022 | The coordinator builds its own argv, not through the agent adapter, so only `CLAUDECODE` marks it as a model run for the door seam. | #691 | *code* `src/core/agent/index.ts:9`, `src/core/door/write.ts:5-6` |
| S2 (Copilot) | Copilot CLI has no read or edit rule by path that was tried; its settings folder's read-only mode is no wall. | none named | *doc* `docs/how-to/set-up-coordinator.md:56-65` |
| S3 decision table | No orchestrator rule starts a cleanup run; a person runs it by hand. | none named | *doc* `docs/explanation/build-path.md:26`, `docs/explanation/plugins-and-roles.md:47-48` |
| S3 | A claim label this loop did not add holds its PR until a person removes it. | #497 | *doc* `docs/reference/orchestrator.md:332` |
| S3 | Only implementer runs park on the provider's usage limit; a review or design run goes to a person. | #708 | *doc* `docs/reference/orchestrator.md:372` |
| S5 what runs in a box | The automated review, the design review and the onboarder run on the host (read-only tools), not on a runner. | #674 | *doc* `docs/explanation/safety.md:23`, `:62`, `:99` |
| S6 network | The egress proxy sees host names only; an allowed host (the model API) can still receive uploaded data. Accepted for the pilot. | not built | *doc* `docs/explanation/safety.md:60` |
| S6 / S15 Copilot token | The Copilot model-only token is stored, but no run uses it; Copilot read-only kind off, writer kind not built, `.github/` agent files not protected. | #697, #698 | *doc* `docs/explanation/safety.md:63`; *code* `src/core/agent/switch.ts:6-11` |
| S7 / S8 runner | The `srt` runner is tested only on a fake `srt`; the egress proxy only on a fake docker. The runner and gate are not finished. | #674, #493 | *doc* `docs/how-to/check-the-runner.md:39`, `:68-69`, `docs/explanation/factory-stack.md:29` |
| S8 (work) | The vm runner does not pass the company CA (`NODE_EXTRA_CA_CERTS`). | #674 | *doc* `docs/reference/settings.md:47` |
| S12 config never from the branch | `.git/hooks` and `.git/config` are read-only inside `srt`, not checked on the vm runner. | #674 | *doc* `docs/explanation/safety.md:123` |
| S16 budget | A cap left unset is no cap. Run records do not name the model. | none named | *doc* `docs/explanation/models-and-sharing.md:10`, `:15-16` |
| S17 stages | Stage B (laptop box, coordinator check, CI failure signatures) incomplete; ADR-0024 removed failure signatures and re-runs of red checks. | #493 | *doc* ADR-0012 S17, ADR-0024 |
| S1 / P3 records | Before the PR opens, START, approval, run records (and at work, the spec) live only on the machine that ran START. | #498 | *doc* `docs/explanation/safety.md:132-134`, `docs/explanation/spec-and-knowledge.md:42` |

Related gaps outside ADR-0012 that a comparison will touch: the finder and verify-pass cards are not used (the review
runs `prompts/review-find.md` and `review-verify.md`, #674, #216); test-first checks only that the commit exists, not
that the test fails on the base (`docs/explanation/build-path.md:24`); plugin rule IDs carry no plugin name
(`docs/explanation/architecture.md:152-154`); plugin pin moves run no eval (`docs/explanation/architecture.md:147-148`);
nothing retires a lens (`docs/explanation/improvement-loop.md:24`).

## 6. Inconsistencies seen while reading

| what | where | note |
|---|---|---|
| bug lane design review | `AGENTS.md` lanes table: design "only when an interface or more than one module changes"; `skills:plugins/rulebook/skills/crq/process/lanes.json`: bug `design_review: true` | the pinned pack always reviews a bug's design; the repo's own table says only sometimes |
| card format v2 | `docs/explanation/plugins-and-roles.md:58-61` says the engine reads card v2 (adds `edit-scope`) | the pinned pack has only `card-v1.schema.json` (GitHub tree at `044aa84`); v2 is only in the pack's test fixtures |
| coordinator ask list | module header says "Today, the old loop commands" are on the ask list (`src/core/coordinator.ts:11-13`) | the code denies `dispatch`, `review`, `setup` (`src/core/coordinator.ts:73`, `:93`), per #766; the header is stale |
| `reconcile` | #766 deleted the `reconcile` command; `AGENTS.md` still says "`reconcile` removes those" (`writer-N` worktrees); the table still has a `reconcile` action | *code* `src/core/dispatch/table.ts:15`, `:157` |

## 7. Unknown

| item | why unknown |
|---|---|
| does the `srt` policy hold on a real laptop | only tested on a fake `srt`; the hand check is not recorded (`docs/how-to/check-the-runner.md:68-69`) |
| do Discord replies land in their ticket thread | hand test #729 not done (`docs/explanation/architecture.md:81-82`) |
| does Copilot CLI load Claude Code plugins | open question, #493 spike (`docs/explanation/roadmap.md:39-40`) |
| does a cloud session load the plugins declared in `.claude/settings.json` | not confirmed (`docs/explanation/plugins-and-roles.md:81-82`) |
| real cost per run kind and success rate | no measured numbers in the repo; the pilot (#62) and #488's timeline line hold them, not read here |
| GitLab status checks on a live project | tested against GitHub's API shape only (`docs/reference/settings.md:80`) |

## Sources

- chiyanram/agent-factory at `39f7b68`: `README.md`, `AGENTS.md`, `package.json`, `LICENSE`, `GLOSSARY.md`,
  `docs/CONSTITUTION.md`, `docs/explanation/{architecture,safety,build-path,code-review,plugins-and-roles,factory-stack,roadmap,models-and-sharing}.md`,
  `docs/reference/{cli,connectors,settings,orchestrator}.md`, `docs/how-to/{set-up-coordinator,check-the-runner}.md`,
  `docs/adr/0012-safety-design-for-unattended-runs.md` (and the ADR list 0001–0024 by title), `prompts/coordinator.md`,
  module headers in `src/core/` cited above.
- chiyanram/skills at `044aa84e03ce9ef641e599bcc76bbb120e29fd0a`, read through the GitHub API: the file tree,
  `plugins/rulebook/skills/crq/process/lanes.json`, `review.json`, `roles/implementer.md`; repo licence.
- Issues #826 (map) and #827 (this ticket).
