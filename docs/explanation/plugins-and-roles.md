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
| `tools` | enforces the tool names, and an `Edit` path scope | the run gets only the card's tools, each one the engine gives that role. `Edit(src/test/**)`, in Claude Code's permission syntax, is a path scope: the host checks the run's commits after it stops, and an edit outside the scope blocks the run (`src/core/writer/scope.ts`). Only `Edit` takes a scope. A note with a space, such as "Edit (test files only)", is text. **Today:** the built-in test-first card has that note, not a scope, so its edits are not limited |
| `must_not_see` | enforces | those inputs are left out of the run, on top of the role's own floor, which no card can drop |
| `hand_off` | enforces | every field it names must be a field of the engine's schema for the role; what the run returns is read with that schema |
| `enforced_guardrails` | enforces | a `[list]` of IDs from the engine's closed list (`src/core/process/guardrails.ts`): `read-only`, `no-push`, `no-web`, `no-credentials`, `judge-files-locked`, `edit-scope`. Each ID names the code that enforces it. The role's floor always applies; a card may add an ID its role can have, never drop one. An unknown ID, or one the role cannot have, refuses the card. **Today:** plain text, the old form, is still read and ignored for one release |
| `input`, `steps`, `rules` | reads no meaning | text the model reads. `next` is dropped, because the lanes hold the flow. **Today:** a card that still has it is read for one release |

The engine starts a run from a card for six roles: implementer, test-first, cleanup, design-reviewer, verify pass and
onboarder. Every run record carries the card's hash.

## What each role returns

| role | returns | checked by the engine |
|---|---|---|
| implementer, test-first, cleanup | `.factory/report.json`: `done` with evidence rows, `asked` with questions, or `blocked` | yes (`src/core/report.ts`) |
| design-reviewer | a **Finding** per design decision, with its verdict: aligned, conflict or open | yes (`src/core/design/findings.ts`) |
| verify pass | one bucket per finding: act on, consider, noted, dismissed; it may set a lower severity or grade, never a higher one | yes (`src/core/finding.ts`): a verdict that raises either is refused, and the finding is Consider. **Today:** only the design review's card asks for it; the review's prompt waits for #438 |
| onboarder | the brief and the glossary | yes (`src/core/onboard/answer.ts`) |
| finder | a **Finding** each, with lens, rule, `file:line`, grade | yes (`src/core/review/verdicts.ts`). **Today:** its card is not used; the review runs `prompts/review-find.md` until its eval has a baseline (#438) |
| coordinator | a **Question** per ask: the question, 2 to 4 choices, the recommended one; the retro's actions as JSON | no: its prompt asks for the shape |

## What is decided next

Decided in the design audit (2026-11-10), not built:

| change | why |
|---|---|
| `tests-read-only` joins the guardrail IDs with #422, and `own-hunks` with #423; plain-text `enforced_guardrails` and `next` are refused one release after #424 | each ID lands with the code that enforces it |
| one process plugin per project: a second plugin with a process is a `config check` error; other plugins add rules only, and their rule IDs carry the plugin's name | two plugins that disagree in prose cannot be settled by list order |
| the finder runs from its card, with its schema; the review's verify prompt asks for a lower severity and grade (#438, after #216) | a project cannot replace the finder today |
| a plugin pin moves only when an eval result for that exact plugin hash shows no drop against the baseline (#216 first) | today `plugin update` runs `config check` only, no eval |
| with the Copilot runner (#162), `.github/skills/`, `.github/copilot-instructions.md` and `.github/instructions/` join the agent settings the host push protects | Copilot reads them; a run could plant one |
