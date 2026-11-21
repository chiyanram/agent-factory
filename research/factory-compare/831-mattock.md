# #831 — Profile: "Mattock software factory"

Map: #826. Read on 2026-11-20. Sources read: `mattpocock/sandcastle` at `1b380ca`, `mattpocock/skills` at `abeeaf9`
(shallow clones, read only), plus the web pages linked below.

## Result

No AI agent or software-factory product named "Mattock" was found. The closest match is **Matt Pocock's software
factory**: the **Sandcastle** library (`github.com/mattpocock/sandcastle`), the `software-factory` skill in
`mattpocock/skills`, and the AI Hero course "Software Factories for Real Engineers". "Mattock" reads as a contraction
of "Matt Pocock". This is *inferred*, not documented: no source uses the word "Mattock".

Evidence for the match:

| evidence | mark |
|---|---|
| Pocock on X: "I built my own software factory, and I open-sourced it. It's called Sandcastle." | *documented* (search snippet only; X was not fetched): https://x.com/mattpocockuk/status/2049506712801935611 |
| `software-factory` skill: "a system of agents that turns tickets, PRs and schedules into merged code" | *documented*: https://github.com/mattpocock/skills/pull/1316; `skills/skills/in-progress/software-factory/SKILL.md:7` |
| Course "Software Factories for Real Engineers", cohort started 2026-11-09 | *documented*: https://www.aihero.dev/cohorts/software-factories-for-real-engineers-xdy1m |
| A third party's course repo is named `Framstag/matt-pocock-software-factory` | *documented*: https://github.com/Framstag/matt-pocock-software-factory |
| This repo already borrows from Sandcastle: `hostGit` follows "Sandcastle's src/hostGitConfig.ts" | *inferred from code*: `src/core/git.ts:10` |
| This repo uses the course's words: "brakes", `wayfinder:map`, grilling | *inferred from code*: `AGENTS.md` (lanes MUST), #826 label |

## Searches run

| # | search | result |
|---|---|---|
| 1 | WebSearch `Mattock software factory AI agents` | no "Mattock" hit; generic "AI software factory" articles |
| 2 | WebSearch `"Mattock" coding agent orchestrator github` | no "Mattock" hit; closest `mattpocock/skills`, Agent Orchestrator |
| 3 | WebSearch `mattock.dev OR mattock.ai agent` | no hit; Mattermost, MATLAB, Matt Pocock pages |
| 4 | WebSearch `Matt Pocock software factory sandcastle agents` | Sandcastle, AI Hero course |
| 5 | WebSearch (extended) `"Mattock" "software factory"` | no "Mattock" hit; all hits are Matt Pocock's software factory |
| 6 | `gh search repos mattock` (30 results) | no agent tool: MattockFS (forensics), Chia plotter, Minecraft mods, MTG engine (`GrandOichii/Mattock`), Android JUnit runner, others |
| 7 | `gh search repos "mattock agent"` | 0 results |
| 8 | `gh search repos "software factory" --owner mattpocock` | 0 results (the factory lives in `sandcastle` and `skills`) |
| 9 | `gh repo list mattpocock` | `sandcastle`, `skills`, `dictionary-of-ai-coding` are relevant |
| 10 | READMEs of unnamed `mattock` repos (`bayhasoft`, `sharik31`, `haitailook`, `ejkaplan/mattock-ai-contest`) | Minecraft mod, empty, empty, contest code: none is an agent tool |
| 11 | `curl https://mattock.dev`, `mattock.ai`, `mattock.io` | `.ai` and `.io` do not resolve. `mattock.dev` is a small consultancy ("Own your tools.", Platform Engineering, Automation, Cloud & DevOps, Custom Systems) with a 7-stage client build process (Fit, Discovery, Scope, Design, Build, Go live, Upkeep). It names no agent, AI factory or repo. *documented*: https://mattock.dev |
| 12 | `gh search code mattock --owner mattpocock` | 0 results |

Open question for the operator: if "Mattock" means `mattock.dev`, it is a services firm, not a software factory
product, and it has nothing to profile on topics 1–12. The profile below is for the closest match.

## Profile of the closest match: Sandcastle + the `software-factory` skill

**What, who for, licence**
- Sandcastle: "A TypeScript library for orchestrating AI coding agents in isolated sandboxes". *documented*:
  `sandcastle/README.md:11`. npm package `@ai-hero/sandcastle` 0.14.0 (`sandcastle/package.json:2-3`).
- For engineers who run AFK (unattended) agents in parallel or build review pipelines (`README.md:17`).
- Licence MIT (`README.md:46`; GitHub API `license.spdx_id = MIT`). `skills` repo also MIT (GitHub API).
- The `software-factory` skill is a vocabulary for *designing* a factory, not code. It is under `in-progress/`
  and has `disable-model-invocation: true` (`skills/.../software-factory/SKILL.md:1-5`).

**Stack** (Sandcastle)
- Language/runtime: TypeScript on Node, built with tsup, tested with vitest (`README.md:37-42`). Uses Effect
  (`effect`, `@effect/cli`, `@effect/platform`; `package.json:103-116`) and `@clack/prompts` (`package.json:129`).
- Storage: no database. Agent sessions are the agent's own files, e.g. Claude Code's
  `~/.claude/projects/<encoded>/<id>.jsonl` (`src/SessionStore.ts:118-119`). Run logs under `.sandcastle/logs/`
  (`docs/guide/run-logs.md:27`).
- Queue: none in the library. The skill puts the queue in the **orchestrator** slot (GitHub Actions, own server +
  database, or own app) (`SKILL.md:40-42`, `:73`).
- Sandbox: Bubblewrap (Linux), Seatbelt (macOS), Docker, Podman, Daytona, E2B, Fly.io Sprites, Modal, Vercel,
  no-sandbox, or custom (`README.md:17`; `package.json` exports `./sandboxes/*`).
- LLM/agent providers: Claude Code, Codex, Cursor, OpenCode, Pi, Copilot (`src/AgentProvider.ts:980,1203,1278,1451,1657,1805`;
  `src/InitService.ts:444-518`). Model is passed per agent, e.g. `claudeCode("claude-opus-4-8")`
  (`docs/guide/core-concepts.md:9`).

**Docs and code**
- Code: https://github.com/mattpocock/sandcastle, `src/`. ADRs `docs/adr/0001-0024`.
- Docs: `docs/guide/` (one page per term, `glossary.md`), published at https://www.aihero.dev/sandcastle (`README.md:21`).
- Factory design language: https://github.com/mattpocock/skills/tree/main/skills/in-progress/software-factory
  (`SKILL.md`, plus slot surveys `TICKET-TRACKERS.md`, `GIT-HOSTS.md`, `RUNNERS.md`, `OBSERVABILITY-PLATFORMS.md`,
  `EXAMPLE-TASKS.md`).

## Topics 1–12 (first notes for the matrix)

| # | topic | note | mark |
|---|---|---|---|
| 1 | user interaction | Skill: the ticket tracker is the human interface; humans file tickets and talk in comments; a run never waits for a human. Sandcastle itself: code you call, plus terminal or log-file progress. | `SKILL.md:19,29`; `docs/guide/run-logs.md:27` |
| 2 | CLI | `sandcastle init` (scaffolds a template), `docker`/`podman build-image`/`remove-image`. Real work is `run()` / `createSandbox()` in TS. | `docs/guide/cli.md:3-47`; `src/cli.ts:1135` |
| 3 | flow | `run()` = create sandbox → agent iterations (`maxIterations`) → collect commits → land by branch strategy. Skill: trigger → run → next run, five questions per task. | `docs/guide/core-concepts.md:3-31`; `SKILL.md:15-19,88-96` |
| 4 | roles + prompts | No fixed roles. Five templates with prompt files: blank, simple-loop, sequential-reviewer (implement, review), parallel-planner (plan, implement, merge), parallel-planner-with-review. Prompts take `{{KEY}}` args and `` !`command` `` output. | `src/InitService.ts:37-56`; `src/templates/*`; `docs/guide/prompts.md:42,62` |
| 5 | handoff | Through git: commits on a branch; reviewer shares the implementer's sandbox and branch. Sessions can be resumed or forked. Skill: a run's only memory is tracker, git host, orchestrator. | `src/templates/sequential-reviewer/main.mts:1-11`; `docs/guide/agent-sessions.md`; `SKILL.md:23` |
| 6 | review | Template reviewer agent reads the branch diff, approves or fixes on the branch, capped implement→review cycles. Skill: three brakes — automated checks, automated review, human review. | `sequential-reviewer/main.mts:7-8,31`; `SKILL.md:56-62` |
| 7 | plugins | Pluggable agent providers, sandbox providers and issue trackers (github-issues, beads, custom); host/sandbox hooks (`onWorktreeReady`, `onSandboxReady`). | `docs/agents/adding-an-agent-provider.md`; `src/InitService.ts:738-760`; `docs/guide/hooks.md:1-30` |
| 8 | adapters | Sandbox providers (10 + custom) and agent providers (6). Skill names slots: ticket tracker, ticket source, git host, orchestrator, runner, observability platform. | `README.md:17`; `SKILL.md:26-46` |
| 9 | internals | Effect-based TS; worktrees under `.sandcastle/worktrees/`; branch strategies head / merge-to-head / branch; sync-in/sync-out of files; worktree locking. | `src/BranchStrategy.ts:6-46`; `docs/guide/branch-strategies.md`; `docs/adr/0007-worktree-locking.md` |
| 10 | security | Native sandboxes guard against accidents and prompt injection, not kernel escapes or host localhost; open network. AFK runs pass `--dangerously-skip-permissions` to Claude Code by default (inside the sandbox). Host git config is neutralised (`hostGitConfig.ts`). | `docs/guide/sandbox-providers.md:184-195`; `src/AgentProvider.ts:1725,1820-1826`; `src/hostGitConfig.ts` |
| 11 | docs | Diátaxis-like guide, one page per glossary term; 24 ADRs; `GLOSSARY.md`; contributor docs in `docs/agents/`. | `README.md:19-33`; `docs/adr/` |
| 12 | stack | TypeScript, Node, Effect, tsup, vitest, Biome; no DB, no queue in the library. | `package.json:103-131`; `biome.json` |

## Unknown

- Whether "Mattock" was meant as `mattock.dev`: unknown, the ticket gives no link. Needs the operator's word.
- The course's own factory code (beyond Sandcastle and the skill): unknown; course content is paid and was not read.
  `Framstag/matt-pocock-software-factory` has no description or licence (GitHub API) and was not read.
- The X post's full text: unknown; only the search snippet was read.
