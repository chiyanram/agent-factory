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
- **The process plugin** is the one listed plugin that holds `skills/<skill>/process/lanes.json`
  (`src/core/process/read.ts`). It gives the lanes, the review baseline (`review.json`) and the role cards
  (`process/roles/<role>.md`). A lanes file that drops the approval for any lane above tiny stops the run.
- **One process plugin per project.** A second listed plugin with a process is an error: `config check` names both
  plugins, and a run stops on it rather than take the first (#426).
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

## The rules pack's own format

The repos are one-way: the rules pack owns the format of its cards, lanes and findings, and publishes it as JSON
schemas in its process folder, `process/schema/<part>-v<N>.schema.json` (`card`, `lanes`, `finding`). The engine is
one user of it (`src/core/process/pack-schema.ts`, #484): before it uses a plugin's role card or lanes file, it checks
the file against the pack's own schema, then runs its own checks (the role's tools, guardrails and hand-off; the
approval floor).

The pack's format version is the highest `N` it ships. The engine reads that version and the one before; a pack with
no schema folder is version 0 and is read by the engine's own checks alone. A newer version is refused with both
versions named, so an old engine never half-reads a new pack. A pack whose card format allows a role or guardrail ID the
engine does not know is refused, so a pack never names a guardrail the engine would skip (the engine may know more).
The engine's finding values (categories, severities, grades) are the pinned pack's: CI fails when they differ. A
finding's line may be a range, read as its first line, and its rule may be null. The finding schema is read; **Today:** the finder runs
from the built-in prompt, not its card, so nothing checks a finding against it yet (#438).

This repo pins chiyanram/skills by a full commit in [`.github/rules-pack.json`](../../.github/rules-pack.json). CI
checks that commit out and reads every plugin's process and every role card the engine runs, so a pack the engine
cannot read fails CI here.

The sessions working on this repo load the same pack: [`.claude/settings.json`](../../.claude/settings.json) declares the
chiyanram marketplace at the release tag that file names (`tag`), and enables the rulebook and toolbox plugins (#580).
Claude Code pins a marketplace by tag, not by commit, so the pin is a release tag and its commit. `make lint`
(`scripts/check-plugin-pin.ts`) fails when the two files name a different tag, and CI fails when the tag no longer
points at the pinned commit. To move the pin, change the tag in both files and the commit in `rules-pack.json`, in its
own pull request. The plugins load only once the folder is trusted. **Today:** whether a cloud session loads plugins
declared this way is not confirmed.

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
| plugins other than the process plugin add rules only, and their rule IDs carry the plugin's name | two plugins that disagree in prose cannot be settled by list order |
| the finder runs from its card, with its schema; the review's verify prompt asks for a lower severity and grade (#438, after #216) | a project cannot replace the finder today |
| a plugin pin moves only when an eval result for that exact plugin hash shows no drop against the baseline (#216 first) | today `plugin update` runs `config check` only, no eval |
| with the Copilot runner (#162), `.github/skills/`, `.github/copilot-instructions.md` and `.github/instructions/` join the agent settings the host push protects | Copilot reads them; a run could plant one |
