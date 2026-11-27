# Plugins and role cards

How standards and process reach a run, what the engine controls and what is only text, and what is decided next.
The settings keys are in [Settings](../reference/settings.md#the-project-file); connectors, the other kind of
swappable part, are in [Connectors](../reference/connectors.md).

## How a plugin reaches a run

```text
 project file "plugins": ["rulebook@chiyanram"]          a locked key: a user layer cannot drop or swap it
        │
        ▼  agent-factory plugin update <project> <name@marketplace> [<commit>]      a human runs it, after
        │  agent-factory eval pin … when the change needs a proof (ADR-0020)
 $FACTORY_HOME/marketplaces/<marketplace>   ──copy──▶  $FACTORY_HOME/plugins/<marketplace>/<name>/<sha256>/
        │                                               pin: commit + hash in projects/<project>.plugins.json
        ▼  each dispatch pass
 hash checked again ──▶ an implementer, test-first or cleanup run: copied into its clone as .factory/plugins/<n>
        │                  (read-only) ──▶ claude --plugin-dir; any other run: the engine reads the card and rubrics
        │
        ▼
 run record "started": each plugin and its hash, the agent CLI and the model it asked for
```

- **The engine owns its process** ([ADR-0026](../adr/0026-the-engine-owns-its-process.md)). Its lanes, review
  baseline and role cards (`prompts/roles/`) are the only ones; no plugin replaces them, and the engine reads no
  `process/` folder in a plugin.
- **A plugin is a normal Claude Code plugin, and it gives skills only.** The engine names a skill and never a file
  inside it (`skillDir` in `src/core/process/read.ts`), in the order the project lists its plugins. The rulebook
  (`rulebook@chiyanram`, from [chiyanram/skills](https://github.com/chiyanram/skills)) is one plugin, not a dependency.
  `retro --draft` reads the `crq` skill. The review copies its baseline skills, `crq` and `code`, whole into each
  run folder and tells the run to read `skills/<name>/SKILL.md` first, so a read-only run loads no plugin and runs no
  plugin hook. **Today:** a rulebook pointer in a project's AGENTS.md, and the built-in test-integrity lens, still
  name a reference file inside a skill.
- **A plugin that is not pinned**, or whose stored copy no longer has its hash, stops the pass.

## What a role card controls

A card is frontmatter, then a body the model reads (`src/core/process/cards.ts`). The cards are the engine's own, in
`prompts/roles/`.

| field | the engine | how |
|---|---|---|
| `role` | enforces | the card must name the role it is read for |
| `tools` | enforces the tool names, and an `Edit` path scope | the run gets only the card's tools, each one the engine gives that role. `Edit(src/test/**)`, in Claude Code's permission syntax, is a path scope: the host checks the run's commits after it stops, and an edit outside the scope blocks the run (`src/core/writer/scope.ts`). Only `Edit` takes a scope. A note with a space, such as "Edit (test files only)", is text. Test-first may edit only the project's test files (`ready.testFiles`), whatever its card says: a hook refuses an edit outside them in the run, and the host blocks a run whose commits touch one. Its card's own `Edit(…)` scope only narrows them. The onboarder gets Read, Grep and Glob alone |
| `must_not_see` | enforces | those inputs are left out of the run, on top of the role's own floor, which no card can drop |
| `hand_off` | enforces | every field it names must be a field of the engine's schema for the role; what the run returns is read with that schema |
| `enforced_guardrails` | enforces | a `[list]` of IDs from the engine's closed list (`src/core/process/guardrails.ts`): `read-only`, `no-push`, `no-web`, `no-credentials`, `judge-files-locked`, `edit-scope`. Each ID names the code that enforces it: the agent CLI's adapter builds an implementer run's deny list from the IDs the run carries (`src/core/agent/claude-writer.ts`). The role's floor always applies; a card may add an ID its role can have, never drop one. An unknown ID, or one the role cannot have, refuses the card. **Today:** plain text, the old form, is still read and ignored for one release |
| `input`, `steps`, `rules` | reads no meaning | text the model reads. `next` is dropped, because the lanes hold the flow. **Today:** a card that still has it is read for one release |

The engine starts a run from a card for seven roles: implementer, test-first, cleanup, design-reviewer, verify pass,
onboarder and retro. Every run record carries the card's hash. A person starts the retro run, with
`agent-factory retro <project> --draft`; no pass starts one. **Today:** no orchestrator rule starts a cleanup run; a person
runs cleanup by hand.

## The contract with the rules pack

The engine names skills, and the pinned rules pack must hold each skill the engine names (P18). The engine owns its
lanes, role cards and finding values, so it reads no format from the pack. `test/rules-pack.test.ts` checks that the
pinned pack holds `skills/<name>/SKILL.md` for each name the engine uses (the review baseline's skills and the retro's
`crq`).

This repo pins chiyanram/skills by a full commit in [`.github/rules-pack.json`](../../.github/rules-pack.json). CI
checks that commit out and checks that it holds each skill the engine names, so a pack that drops one fails CI here. The npm package ships the file, and `agent-factory init` pins each `chiyanram` plugin at
that commit, not at the skills `HEAD`, so a new user gets the pack CI tested.

The sessions working on this repo load the same pack: [`.claude/settings.json`](../../.claude/settings.json) declares the
chiyanram marketplace at the release tag that file names (`tag`), and enables the rulebook and toolbox plugins.
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
| verify pass | one bucket per finding: act on, consider, noted, dismissed; it may set a lower severity or grade, never a higher one | yes (`src/core/finding.ts`): a verdict that raises either is refused, and the finding is Consider. **Today:** only the design review's card asks for it; the review's verify prompt does not (#674) |
| onboarder | the brief and the glossary | yes (`src/core/onboard/answer.ts`) |
| finder | a **Finding** each, with lens, rule, `file:line`, grade | yes (`src/core/review/verdicts.ts`). **Today:** its card is not used; the review runs `prompts/review-find.md` (#674) |
| coordinator | a **Question** per ask: the question, 2 to 4 choices, the recommended one; the retro's actions as JSON | no: its prompt asks for the shape |

## What is decided next

Decided, not built:

| change | why |
|---|---|
| `tests-read-only` and `own-hunks` join the guardrail IDs with the code that enforces them; plain-text `enforced_guardrails` and `next` are refused one release after the closed list of IDs | each ID lands with the code that enforces it. **Today:** no open ticket builds that code yet (#674) |
| plugins add rules only, and their rule IDs carry the plugin's name | two plugins that disagree in prose cannot be settled by list order |
| the finder runs from its card, with its schema; the review's verify prompt asks for a lower severity and grade | a project cannot replace the finder. **Today:** no open ticket builds this yet (#674) |
| a plugin pin moves only when an eval result for that exact plugin hash shows no drop against the baseline | a worse rule must not ship unseen. **Today:** the eval is sized by what the move changes; a change no eval can prove yet (the implementer card, with no implementer eval until #824) moves on a typed reason and shows as unproven, and no held-out slice runs (#599) |
| with the Copilot runner (#493), `.github/skills/`, `.github/copilot-instructions.md` and `.github/instructions/` join the agent settings the host push protects | Copilot reads them; a run could plant one |
