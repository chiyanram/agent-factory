# 0026 · The engine owns its process; a plugin gives skills only

Status: proposed (#853 Q6, Q11, Q14). Amends ADR-0009 and P18.

## Context

ADR-0009 put the rules in chiyanram/skills. The engine then read the rulebook's process by file path:
`skills/crq/process/lanes.json`, `review.json`, `roles/*.md` and `schema/*.schema.json`, and the review fenced
`references/` files into its pack.

On skills `main`, `review.json` names `{ "skill": "code" }` with no reference, and `code/references/` is gone. The
engine refused that, so every pass and every review would stop. Only the pin at `044aa84` hid the break: a change
inside the rulebook could stop the engine.

The rulebook's skills are now many files each: a SKILL.md links the files beside it, and one skill links into another.
The rulebook plugin also ships hooks.

## Decision

| # | decision |
|---|---|
| E1 | **The engine owns its process.** Its lanes, review baseline, role cards and schemas are its own (`src/core/lane.ts`, `src/core/review/rules.ts`, `prompts/roles/`). It reads no `process/` folder from any plugin, and no plugin replaces a lane or a card. |
| E2 | **A plugin gives skills only.** The engine names a skill and never a file inside it. It finds `skills/<name>/` in the order the project lists its plugins, which is the Claude Code plugin layout. |
| E3 | **A read-only run gets no plugin.** It reads a named skill from a copy of `skills/<name>/` in its own folder, never through `--plugin-dir`, so no plugin hook, server or command runs inside it. |
| E4 | **A writer run loads plugins with `--plugin-dir`**, as before. |
| E5 | **P18 becomes one contract by name.** The pinned rules pack holds each skill the engine names, and CI checks that (`test/rules-pack.test.ts`). |

**Today:** the review still fences the rulebook's `references/` files by name, and no read-only run copies a skill
folder yet (#920).

## Consequences

- A change to a skill's files cannot stop a run. It can only change what a run reads, and the pin's eval proof
  (ADR-0020) measures that.
- A project can no longer change the engine's lanes or role cards through a plugin. A change to a card is a change to
  this repo, and its eval judges it (ADR-0021).
- The rulebook's `process/` folder and its pack-format check are read by nothing here, so the rulebook can delete them
  once the pin moves past them.

## Rejected

- **`--plugin-dir` in a read-only run.** The rulebook ships hooks, and they would run inside the review.
- **Fencing SKILL.md alone.** The rules live in the files it links.
- **Fencing whole skill folders into the pack.** `crq` and `code` together are about 155 KB on every review.
- **Keeping a plugin's process as an optional override.** The override is the path that broke; kept, the break stays
  possible.
