# Plugins and role cards

How standards and process reach a run, what the engine controls and what is only text, and what is decided next.
The settings keys are in [Settings](../reference/settings.md#the-project-file); connectors, the other kind of
swappable part, are in [Connectors](../reference/connectors.md).

## How a plugin reaches a run

```text
 project file "plugins": ["rulebook@chiyanram"]          a locked key: a user layer cannot drop or swap it
        │
        ▼  agent-factory plugin update <project> <name@marketplace> [<commit>]      a human runs it
 $FACTORY_HOME/marketplaces/<marketplace>   ──copy──▶  $FACTORY_HOME/plugins/<marketplace>/<name>/<sha256>/
        │                                               pin: commit + hash in projects/<project>.plugins.json
        ▼  each dispatch pass
 hash checked again ──▶ copied into the run's clone as .factory/plugins/<n> (read-only) ──▶ claude --plugin-dir
        │
        ▼
 run record "started": each plugin and its hash
```

- **The engine runs alone.** With no plugin, it uses its built-in lanes, review baseline and role cards
  (`prompts/roles/`).
- **A plugin is a normal Claude Code plugin.** Its skills and references are what the runs read. The rulebook
  (`rulebook@chiyanram`, from [chiyanram/skills](https://github.com/chiyanram/skills)) is one plugin, not a dependency.
- **The process plugin** is the first listed plugin that holds `skills/<skill>/process/lanes.json`
  (`src/core/process/read.ts`). It gives the lanes, the review baseline (`review.json`) and the role cards
  (`process/roles/<role>.md`). A lanes file that drops the approval for any lane above tiny stops the run.
- **A plugin that is not pinned**, or whose stored copy no longer has its hash, stops the pass.

## What a role card controls

A card is frontmatter, then a body the model reads (`src/core/process/cards.ts`).

| field | the engine | how |
|---|---|---|
| `role` | enforces | the card must name the role it is read for |
| `tools` | enforces the tool names | the run gets only the card's tools, each one the engine gives that role. **Today:** a path scope such as "(test files only)" is dropped |
| `must_not_see` | enforces | those inputs are left out of the run, on top of the role's own floor, which no card can drop |
| `hand_off` | enforces | every field it names must be a field of the engine's schema for the role; what the run returns is read with that schema |
| `input`, `steps`, `rules`, `next`, `enforced_guardrails` | reads no meaning | text the model reads; **Today:** `enforced_guardrails` enforces nothing |

The engine starts a run from a card for six roles: implementer, test-first, cleanup, design-reviewer, verify pass and
onboarder. Every run record carries the card's hash.

## What each role returns

| role | returns | checked by the engine |
|---|---|---|
| implementer, test-first, cleanup | `.factory/report.json`: `done` with evidence rows, `asked` with questions, or `blocked` | yes (`src/core/report.ts`) |
| design-reviewer | one verdict per design decision: aligned, conflict or open | yes (`src/core/design/findings.ts`) |
| verify pass | one bucket per finding: act on, consider, noted, dismissed | yes (`src/core/review/verdicts.ts`); it has no grade or severity field |
| onboarder | the brief and the glossary | yes (`src/core/onboard/answer.ts`) |
| finder | findings with lens, rule, `file:line`, grade | **Today:** its card is not used; the review runs `prompts/review-find.md` until its eval has a baseline |
| coordinator, retro | free text | no |

## What is decided next

Decided in the design audit (2026-11-10), not built:

| change | why |
|---|---|
| `enforced_guardrails` becomes a list of IDs from a closed list the engine owns (for example `tests-read-only`); an unknown ID is refused. `tools` keeps path scopes in Claude Code's permission syntax (`Edit(src/test/**)`). `next` is dropped: the lanes hold the flow | a guardrail only in text is advice, not a guardrail |
| one process plugin per project: a second plugin with a process is a `config check` error; other plugins add rules only, and their rule IDs carry the plugin's name | two plugins that disagree in prose cannot be settled by list order |
| three shared records the engine owns: **Report** (the build roles), **Finding** (finder and design-reviewer), **Question** (coordinator, implementer, test-first); the finder card is used with its schema | today one concept has three shapes |
| the verify pass sets the final severity and grade; it may lower them, never raise them | the finder grades its own evidence today |
| the retro's actions become JSON | the improvement loop can read them without a model |
| a plugin pin moves only when an eval result for that exact plugin hash shows no drop against the baseline (#216 first) | today `plugin update` runs `config check` only, no eval |
| with the Copilot runner (#162), `.github/skills/`, `.github/copilot-instructions.md` and `.github/instructions/` join the agent settings the host push protects | Copilot reads them; a run could plant one |
