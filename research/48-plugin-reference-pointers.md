# 48 — How a nested AGENTS.md pointer reaches a reference in the installed rulebook plugin (#45)

Question (#45): a pointer in an agent-platform nested `AGENTS.md` must reach a reference inside the installed
`rulebook@chiyanram` plugin. Which pointer form works in Claude Code (laptop and worker container) and through
`npx skills add` (Codex)? Proof is a G20-style probe: a real `claude -p` run, with every tool call traced.

Inputs: Claude Code 2.1.314 docs (`code.claude.com/docs/en/skills`, `…/plugins-reference`), the `vercel-labs/skills`
docs (`docs/creating-skills.md`, `docs/agents.md`) and source (`src/installer.ts`), and 23 probe runs in a scratch
project against chiyanram/skills `plugins/rulebook` at `9ecdb09`.

## 0 · Answer

```
agent-platform svc/AGENTS.md                      chiyanram/skills plugins/rulebook/skills/testing/
  "use the `testing` skill (rulebook   ──names──▶   SKILL.md   router: one row per reference, "read it when"
   plugin) and read its `llm-tests`                 references/llm-tests.md   ◀── relative link from SKILL.md
   reference"
```

- **The pointer names a skill and a reference, never a path:** "use the `<domain>` skill (rulebook plugin) and read
  its `<reference>` reference".
- **chiyanram/skills ships one `SKILL.md` router per domain** (`testing`, `code`, `migrations`, `obs`, and later
  `planning`, `meta`). Each router lists every reference in its folder by a relative link (`references/<name>.md`),
  with the README's "read it when" line.
- **This is the shape `skills/research/00-reference-format.md:12` already decided**, and today only `deslop` ships it.
  Without a router, nothing in the plugin reaches an agent (§2, T4 and T5).

## 1 · What the docs say

| fact | source |
|---|---|
| A plugin skill is `skills/<name>/SKILL.md`, invoked as `/plugin-name:skill-name`; the bare `/name` also works when no other command has that name | skills doc, "Where skills live" table |
| A folder with no `SKILL.md` loads nothing: the default scan is "one `<name>/SKILL.md` per skill" | plugins-reference, "Standard layout" |
| Supporting files load on demand: "Reference supporting files from `SKILL.md` so Claude knows what each file contains and when to load it", by relative link | skills doc, "Add supporting files" |
| `${CLAUDE_SKILL_DIR}` and `${CLAUDE_PLUGIN_ROOT}` are substituted only in skill, command and agent content, never in `AGENTS.md`/`CLAUDE.md`, and are absent from the Bash tool's environment | skills doc; plugins-reference, "Where each variable resolves" |
| `${CLAUDE_PLUGIN_ROOT}` is the plugin's installed version folder and "changes when the plugin updates" | plugins-reference, "Environment variables" |
| `npx skills add` reads skills declared in `.claude-plugin/marketplace.json` or `plugin.json`, else walks `skills/` up to three levels for `SKILL.md` | vercel-labs/skills `docs/creating-skills.md` |
| It copies the whole skill folder recursively (`copyDirectory`, excluding only `metadata.json`, `.git`, `__pycache__`), into `.agents/skills/<name>/` for Codex, Cursor and Gemini, and `.claude/skills/<name>/` for Claude Code | `src/installer.ts`; `docs/agents.md` |

So a filesystem path in `AGENTS.md` cannot work: it is per machine and per version, and nothing substitutes it. A
skill name can: Claude Code resolves it from the plugin, and `npx skills add` installs the same folder under the same
name for the other tools. A relative link inside `SKILL.md` resolves in both, because the references travel with it.

## 2 · Probes

Setup: a copy of `plugins/rulebook` loaded with `--plugin-dir`, a scratch git project (`CLAUDE.md` = `@AGENTS.md`, a
nested `svc/AGENTS.md` and `svc/CLAUDE.md`), and `claude -p --output-format stream-json`. The probe counts the `Skill`
and `Read` tool calls in the transcript, so delivery is proven by what the agent opened, not by what it says.

A first sentinel line planted in `strategy.md` ("end your reply with ds-…") was read and then refused as an injected
instruction by both models. So the probe traces tool calls instead: a sentinel the model must repeat cannot prove
delivery.

**Probe 1: does any form deliver the testing rules?** Task: "Add a Spock unit test for `PriceCalc.total` in `svc/`".

| run | plugin | `svc/AGENTS.md` pointer | model | `Skill` call | testing references read |
|---|---|---|---|---|---|
| T1 | router `SKILL.md` | skill + reference | sonnet, haiku | `rulebook:testing` | strategy, unit-tests |
| T2 | router `SKILL.md` | none | sonnet, haiku | `rulebook:testing` | strategy, unit-tests |
| T3 | router, description "Rule references." | skill + reference | sonnet, haiku | `rulebook:testing` | strategy, unit-tests |
| T6 | router, description "Rule references." | none | sonnet, haiku | `rulebook:testing` | strategy, unit-tests |
| T4 | **no `SKILL.md`** (today) | path `skills/testing/references/strategy.md` | sonnet | none of ours | **none** |
| T5 | **no `SKILL.md`** (today) | `${CLAUDE_PLUGIN_ROOT}/skills/testing/references/strategy.md` | sonnet | none of ours | **none** |

With a router, the skill loads on its own: the skill name `testing` matches the task, even under a neutral
description. Without one (the plugin as it ships today), neither a path nor `${CLAUDE_PLUGIN_ROOT}` reaches the
reference, and the agent wrote the test from a general Spock skill.

**Probe 2: does the pointer pick the right reference?** Router listing all 13 testing references; task: "Add a Spock
test for `OrderAssistant.ask` in `svc/`", where the class calls a model port. The right reference is `llm-tests`.

| run | router links | `svc/AGENTS.md` | model | references read |
|---|---|---|---|---|
| R-noptr ×2 | `${CLAUDE_SKILL_DIR}/references/…` | none | sonnet | unit-tests, spock (**no llm-tests**, 0/2) |
| R-ptr ×2 | `${CLAUDE_SKILL_DIR}/references/…` | "load `rulebook:testing` and read its `llm-tests` reference" | sonnet | spock, unit-tests, **llm-tests** (2/2) |
| R3-noptr | relative `references/…` | none | sonnet | unit-tests, spock (**no llm-tests**) |
| R3-ptr ×2 | relative `references/…` | "use the `testing` skill (rulebook plugin) and read its `llm-tests` reference" | sonnet | unit-tests, spock, **llm-tests** (2/2) |

The router decides **whether** the rules arrive; the pointer decides **which** reference the agent reads where the
task alone does not tell it. Relative links resolve from the installed plugin. The tool-neutral wording (bare skill
name, no `rulebook:` prefix) works in Claude Code.

## 3 · What is not proven

- **Codex:** neither `codex` nor `npx skills` could run in this container. The path is proven only on paper: the
  installer copies the folder with `references/` (§1), and Codex reads `.agents/skills`. One sentinel run on the
  operator's laptop closes it: `npx skills add chiyanram/skills --skill testing -a codex`, then the R3-ptr task under
  `codex exec`, checking that `llm-tests.md` was opened.
- **Marketplace install:** the probes used `--plugin-dir`. A marketplace install loads the same folder from the plugin
  cache, so the loader is the same; the T8 sentinel on the worker container confirms it.
- **Bare-name clash:** a project skill also called `testing` would win the bare name. The pointer names the plugin in
  words, and `rulebook:testing` stays the exact name in Claude Code.

## 4 · What follows

| for | change |
|---|---|
| chiyanram/skills (new task) | One `skills/<domain>/SKILL.md` router per domain that has references: a `description` that says when to use it, and one row per reference (relative link + "read it when"). A `make lint` check fails when a reference is missing from its router. |
| chiyanram/agent-factory#46 | The routers carry the per-domain index. The plugin README can link to the routers instead of repeating every row, which ends the shared-table conflict #46 is about. |
| chiyanram/agent-factory#38 (T8) | Pointer wording: "use the `<domain>` skill (rulebook plugin) and read its `<reference>` reference", one line per reference the directory needs. |
| G20 sentinel probe | The probe traces `Skill` and `Read` tool calls, not a sentinel string the model must echo. |
