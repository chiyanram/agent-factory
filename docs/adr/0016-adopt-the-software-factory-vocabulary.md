# 0016 · Adopt the software-factory vocabulary

Status: accepted 2026-11-08 (operator, #144: term map confirmed); four clashes settled and two terms added on
2026-11-09 (#144). The words live in [GLOSSARY.md](../../GLOSSARY.md).

## Context

agent-factory grew its own words: forge, box, dispatcher, writer, reviewer, seat, MR. Design v4 and the role cards
added more (runner for the agent's program, engine, finder, verify pass), and some of them clashed. Matt Pocock's
`software-factory` skill (mattpocock/skills @4ae2317, `skills/in-progress/software-factory/`, MIT) names the same
slots: git host, runner, orchestrator, run, ticket, task, trigger, brakes. That skill ships in `toolbox@chiyanram`
(chiyanram/skills#223). A trial on #144 (2026-11-07) described every row of the trigger table in his words alone.

## Decision

Use his words as he wrote them, plus our own where he has none. `GLOSSARY.md` holds every term and an "Old words, do
not use" table.

| ours | the word now |
|---|---|
| forge | git host |
| box | runner (the disposable machine) |
| dispatcher | orchestrator |
| session (of a worker) | run |
| issue tracker, issue (for a ticket) | ticket tracker, ticket |
| writer | implementer |
| reviewer | automated review (the task); its runs are one finder per lens and one verify pass |
| MR | PR; "MR" only inside the GitLab adapter |
| seat | dropped: name the role |
| coordinator | kept: the role that talks with the human |
| lane | kept: a crq concept |
| plugin (for an engine part) | connector |
| pack (for rules or process) | plugin (a Claude Code plugin) |

The four clashes, settled on 2026-11-09:

1. **Runner** is the machine. The program that runs the model (`claude`, `copilot`) is the **agent CLI**.
2. **Implementer**, not writer. **Test-first** stays its own role.
3. **Engine** and **orchestrator** are both kept, at two sizes. The engine is all of agent-factory's code, never the
   model. The orchestrator is the part that starts runs.
4. **Automated review** and **finder + verify pass** are both kept, at two levels. Automated review is the task, and
   finder and verify pass are its runs. "Reviewer" alone and "verifier" are avoided, because "verifier" is aruvii's
   Verifier queue.

"Context pack" (`src/core/review/pack.ts`, the review's input) is a different thing and keeps its name.

## Why

- One word per idea. The old words mixed a place (box), a person's job (seat) and a run (worker), and each new
  design added synonyms.
- His vocabulary is public, and other factories use it. A reader who knows it can read ours with no translation.
- It has no word for coordinator or lane, so those stay ours, defined in the glossary.

## Consequences

- **Docs (phase 3, #144):** README.md, GUIDE.md, docs/DESIGN.md, AGENTS.md, CONTRIBUTING.md, `docs/agents/` and the
  role cards use the new words. `scripts/check-words.ts` (#347) fails on an old word in their prose, outside backticks.
- **Records keep their words:** older ADRs, CHANGELOG.md, `research/` and the golden set are left as written. Each
  older ADR that uses old words gets a one-line pointer to the glossary.
- **Code (phase 4, #144):** these are renamed, each with a thin old-name wrapper for one release:
  - the seams: `src/core/forge/` → `githost/` (`Forge` → `GitHost`), `src/core/box/` → `runner/` (`FACTORY_BOX`
    wrapped one release), `src/core/dispatch/` → `orchestrator/`, `src/core/plugin/` → `connector/`, and
    `plugins/` → `connectors/` (`agent-factory plugin` keeps an alias);
  - the AGENTS.md MUSTs that name them;
  - the code comments, the CLI help and messages, and the `[writer]`/`[reviewer]` note prefixes;
  - `prompts/review-find.md` and `prompts/review-verify.md`, which change only with an eval pass, because
    `check-eval-proof` protects them.
- **Live state (phase 5):** the labels on the git host, the branch prefixes and the orchestrator's trigger table. This
  happens only when no factory run is open.
- **Rulebook (phase 6):** the crq references in chiyanram/skills follow the same map.

## Sources

#144 (the migration plan, the trial, the term map and the clashes) · mattpocock/skills `software-factory` @4ae2317 ·
chiyanram/skills#223 · ADR-0014 (the connector model).
