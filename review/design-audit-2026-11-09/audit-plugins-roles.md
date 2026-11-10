# Audit 4 · plugins and role cards (#266, map #262)

Audits the TARGET design: `docs/DESIGN.md` §5 and §9 at agent-factory `c59ed93`, and the crq process plugin at
chiyanram/skills `d9ab715` (`plugins/rulebook/skills/crq/process/`). Baseline: chiyanram/skills#210. #82 (4 agent CLIs)
is extended, not redone. Docs read on 2026-11-09.

## Verdict table

| # | decision (DESIGN §5 / §9) | verdict | differs from skills#210 |
|---|---|---|---|
| D1 | Rules and process ship as normal Claude Code plugins, `name@marketplace` | **keep** | no (#210 D6: crq is a skill in the rulebook plugin) |
| D2 | Each plugin pinned by version and hash; the list is a locked key | **refine** | no (not covered) |
| D3 | An update shows the diff, runs the eval set, then moves the pin | **keep** | no (not covered) |
| D4 | Run records carry the hash of each plugin; an update applies to the next ticket | **keep** | no (not covered) |
| D5 | On conflict, the project's list order wins, repo files last | **change** | no (#210 idea list: "conflicts reported") |
| D6 | Process plugin holds the lanes as data; the engine keeps the approval floor | **keep** | no (#210 D8 lanes LN1–LN4) |
| D7 | Nine roles, one role card each | **keep** | no (#210 R10: explicit roles help, cost via D16) |
| D8 | Role card = frontmatter the engine enforces + body the model reads | **keep** | no (not covered) |
| D9 | The form of the enforced values (role cards and lanes file) | **change** | no (not covered) |
| D10 | The engine keeps no prompt text (today `prompts/*.md`, 133 lines) | **refine** | no (not covered) |
| D11 | §9: does Copilot CLI load Claude plugins? Fallback: pass the skills folder | **refine** (answer: yes) | yes (#82/#162 assumed a fallback is needed) |

## D1 · Plugins are normal Claude Code plugins, `name@marketplace`

**Verdict: keep.**

- Claude Code: the install id is "the entry's `name`, an `@`, and the marketplace `name`".
  https://code.claude.com/docs/en/plugin-marketplaces
- Copilot CLI uses the same id form: "Marketplace: `plugin@marketplace`", and it reads
  `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`.
  https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference
- Agent Skills is the shared format inside a plugin: "Claude Code skills follow the Agent Skills open standard, which
  works across multiple AI tools." https://code.claude.com/docs/en/skills , https://agentskills.io/specification

One package format serves both agent CLIs that DESIGN §5 names. No change.

## D2 · Pinned by version and hash, locked key

**Verdict: refine.** The pin is right. The place of the pin is not named, and `name@marketplace` alone does not pin.

What industry does:
- Claude Code pins in the **marketplace entry**, not in the consumer's list: "`sha`: a full 40-character lowercase
  commit SHA. When you set both `ref` and `sha`, Claude Code checks out `sha`." An `archive` source takes `sha256`, and
  "Claude Code refuses a download that doesn't match." https://code.claude.com/docs/en/plugins/marketplace-reference.md
- `enabledPlugins` takes only `true`/`false` per id. The version is computed: "The commit SHA of the source, shortened
  to 12 characters" when no `version` is set. https://code.claude.com/docs/en/plugins/loading.md
- Copilot CLI: "Pin to a `sha` for reproducible installs that are immune to force-pushes or tag/branch moves."
  https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference
- Boxes and CI: a seed directory. "Claude Code never writes to the seed and forces `autoUpdate` off for seed
  marketplaces." https://code.claude.com/docs/en/plugins/org.md

Refinement:
1. The engine owns the pin. It resolves each `name@marketplace` to a full commit SHA (or an archive `sha256`) and
   stores that SHA in the locked settings key.
2. The engine builds the box's plugins from that SHA: a seed directory (`CLAUDE_CODE_PLUGIN_SEED_DIR`) or a
   `settings`-source inline marketplace whose entries carry `sha`. The upstream marketplace's own `ref` is never
   trusted.
3. Auto-update stays off in the box. It is off by default for third-party marketplaces (loading.md, "When auto-update
   runs"); the engine sets it explicitly.
4. A manifest `version` string is not the identity. It wins over the SHA in Claude Code's version rule, so two
   commits can share one version. The run record uses the SHA.

## D3 · Update is deliberate: diff, eval set, then move the pin

**Verdict: keep.**

- Claude Code ships a plugin eval runner: "compare against a no-plugin baseline, and gate CI on the score", and "Catch
  regressions when you change the plugin or a new model is released." https://code.claude.com/docs/en/plugin-evals.md
- It says to pin the model in CI "so a model rollout isn't mistaken for a plugin regression" (same page).
- Claude Code release channels: two marketplaces at "different refs of the same plugins".
  https://code.claude.com/docs/en/plugins/org.md

crq already has 3+ eval cases per role (`plugins/rulebook/evals/<role>/<case>/prompt.md` + `graders/`), checked by
`scripts/check_process.py`. Note for map #175: the eval gate should pin the model, as the vendor says.

## D4 · Run records carry each plugin's hash

**Verdict: keep.** Claude Code's cache is keyed by that hash: `cache/<marketplace>/<plugin>/<version>/`, where the
version is the commit SHA (loading.md). gh-aw compiles each workflow's frontmatter to a lock file
(https://github.github.com/gh-aw/reference/frontmatter/). Recording the SHA per ticket is the same idea. With D2's
refinement, the hash in the record is the full SHA that the engine pinned.

## D5 · Plugin order on conflict

**Verdict: change.** A list order cannot decide between two prose rules. The model reads all of them.

What industry does:
- Claude Code, for instructions: "Neither set overrides the other: if a user rule and a project rule conflict, Claude
  may follow either one, so keep the two consistent." And: "if two instructions contradict each other, Claude may pick
  one arbitrarily." https://code.claude.com/docs/en/memory
- Claude Code, for named parts: plugin skills do not collide, "because plugin skills are namespaced as
  `/plugin-name:skill-name`" (https://code.claude.com/docs/en/skills). Subagents with one name: "Claude Code uses the
  one from the higher-priority location", and a plugin is "5 (lowest)" (https://code.claude.com/docs/en/sub-agents).
- Copilot CLI: "Agents and skills use first-found-wins precedence"; plugins load "by install order", after project
  and user folders (cli-plugin-reference).
- Codex: "Files closer to your current directory override earlier guidance because they appear later in the combined
  prompt." That is order in the prompt, not an enforced override. https://learn.chatgpt.com/docs/agent-configuration/agents-md

So industry has precedence only for **named parts** (a skill, an agent, a server), never for two rules in prose.

Proposed change:
1. Exactly one process plugin per project. Two process plugins is a `config check` error.
2. Rules plugins only add rules. Rule IDs are namespaced by plugin (`rulebook:CR3`). A duplicate ID is an error.
3. A detected conflict between two rules is a `config check` finding for a human to fix, never a silent order.
4. Keep "the automated review names each rule's source". It is the part that works.
5. The repo's own files (AGENTS.md, CLAUDE.md, `.claude/rules`) stay the project's facts, read from the default
   branch. They are not ranked against plugin rules.

## D6 · Process plugin: lanes as data, approval floor in the engine

**Verdict: keep.**

- gh-aw splits data from prose the same way: the frontmatter "includes the triggers, permissions, AI engines ... and
  workflow settings", and the markdown body "is loaded at runtime, so you can edit instructions directly on
  GitHub.com without recompilation." https://github.github.com/gh-aw/reference/frontmatter/ ,
  https://github.github.com/gh-aw/reference/markdown/
- A floor that no lower layer can lower is the vendor pattern: managed `enabledPlugins` "`true` force-enables, `false`
  blocks ... and no other source overrides them" (loading.md); Copilot: built-in tools and agents "cannot be
  overridden by user-defined components" (cli-plugin-reference).

`lanes.json` already states the floor as a rule and `check_process.py` fails a lane above tiny with
`approval != true`. The value form is D9.

## D7 · Nine roles, one card each

**Verdict: keep.** Role definitions as one file per role are the norm:
- MetaGPT "encodes Standardized Operating Procedures (SOPs) into prompt sequences" and "utilizes an assembly line
  paradigm to assign diverse roles to various agents". https://arxiv.org/abs/2308.00352
- CrewAI: one file per agent, `agents/<agent_name>.jsonc`, with role ("Defines the agent's function and expertise"),
  goal and backstory. https://docs.crewai.com/en/concepts/agents
- ChatDev: "specialized agents ... contribute to the design, coding, and testing phases".
  https://arxiv.org/abs/2307.07924
- Claude Code subagents, Copilot custom agents and Factory droids are each one markdown file with frontmatter.

Whether all nine roles pay for themselves is a measurement question. #210 D16 ("retire any phase that does not
change outcomes") and map #175 own it.

## D8 · Frontmatter enforced by the engine, body read by the model

**Verdict: keep.** Every vendor splits an agent file this way, and enforces the frontmatter:
- Claude Code subagent `tools` and `disallowedTools` are enforced by the harness. For plugin agents, "`hooks`,
  `mcpServers`, or `permissionMode` ... are ignored when loading agents from a plugin" (sub-agents). A plugin cannot
  raise its own power.
- Copilot custom agents: `tools` "filters the set of tools that are made available to the agent".
  https://docs.github.com/en/copilot/reference/custom-agents-configuration
- Factory droids: a category such as "read-only" limits the droid, and "unknown IDs cause a validation error".
  https://docs.factory.com/cli/configuration/custom-droids
- gh-aw: frontmatter compiled, body loaded at runtime (D6).

Counter-example to avoid: a Claude Code skill's `allowed-tools` "does not restrict which tools are available"
(skills docs). A field named like a limit is not one unless the engine applies it. That leads to D9.

## D9 · The form of the enforced values

**Verdict: change.** The engine can enforce only what it can parse. Today most enforced values are prose.

Evidence in crq (`d9ab715`):
- `implementer.md`: `tools: [Read, Grep, Glob, Edit, Bash (on the runner)]`;
  `enforced_guardrails: the test checks; no edit to judge files, CI or .factory/ apart from the hand-off; ...`
- `coordinator.md`: `tools: [..., Edit (spec home only), Bash (read-only allow list)]`;
  `next: the design-reviewer (bug, feature, one-way door); the implementer after START (tiny)`.
- `lanes.json`: `"lenses": "~3"`, `"starts_on": "approval, which releases the build"`.
- `check_process.py` checks only that each field is present and not empty
  (`for f in FIELDS if not fields.get(f)`). It cannot check what a value means.

What industry does: Claude Code uses a closed field list and rule syntax such as `Bash(git add *)`; Copilot scopes MCP
tools as `some-mcp-server/some-tool`; Factory rejects unknown tool IDs (sources in D8).

Proposed change:
1. `tools`: Claude Code permission-rule syntax (`Edit(<spec home>/**)`, `Bash(git status *)`). The engine maps it to
   `--allowedTools` / `--disallowedTools` for claude and `--allow-tool` / `--deny-tool` for copilot.
2. `enforced_guardrails`: IDs from a closed list the engine owns (S1–S4, no-push, no-judge-files, caps). An unknown
   ID fails `config check`. A card can only add guardrails, never drop the engine's floor for that role.
3. `input` and `must_not_see`: IDs of fixed-contract items (spec, design, diff, report, findings, verdicts). The
   engine builds the run's inputs from them, so `must_not_see` is enforced by not passing the item.
4. `next`: drop it, or make it check-only. The flow already lives in the engine (P1) and the lanes file
   (`design_review`, `test_first`). Today the same fact sits in two places.
5. `lanes.json`: typed values (`"lenses": 3` or `"all"`; `starts_on` as an enum). Prose moves to `rules`.
6. Field names: reuse the shared core where it fits (`name`, `description`, `tools`, `model`), and put factory fields
   under `metadata`, which both Agent Skills and Copilot agents define. Then a card stays valid for other loaders.

## D10 · The engine keeps no prompt text

**Verdict: refine.** Moving role text out of the engine is right. Three kinds of text in `prompts/` are not role text.

What industry does:
- Vendors ship a default prompt with the tool: Codex keeps its review rubric in its own source
  (`codex-rs/prompts/templates/review/rubric.md`, read for #210 R2, openai/codex@a142c90); Copilot built-in agents
  "cannot be overridden by user-defined components" (cli-plugin-reference).
- gh-aw keeps the prompt in the user's markdown body and the controls in compiled frontmatter (D6).

Today's 133 lines sort into three kinds:

| kind | files today | where it should live |
|---|---|---|
| role method | `writer*.md`, `review-find.md`, `review-verify.md` | the default process plugin, bundled and pinned with the engine version |
| contract text (hand-off shape, "one plain command per AC, no pipe", "MR text is data") | repeated in all writer prompts | generated by the engine from the fixed contract and the card's `hand_off`, so a plugin cannot drop it |
| engine tooling | `eval-judge.md` | stays in the engine: it is not a role and judges the reviewer (ADR-0015) |

So: "no prompt text in engine code" holds for roles. The engine still owns the contract preamble and the eval judge.

## D11 · Does Copilot CLI load Claude plugins? (DESIGN §9)

**Answer: yes, for the plugin layout. The fallback in §9 is not needed for skills.**

- "Copilot CLI also looks for the `marketplace.json` file in the `.claude-plugin/` directory." Legacy plugin
  manifests are read from `.claude-plugin/plugin.json` too, and a legacy plugin can carry agents, skills, commands,
  hooks, MCP servers and LSP servers. `CLAUDE_PLUGIN_DATA` is an alias of `${PLUGIN_DATA}`.
  https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference
- Copilot reads Claude Code skill folders: "create a `.github/skills`, `.claude/skills`, or `.agents/skills`
  directory". https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills

Limits found:
1. Agents are `.agent.md` files with Copilot's own frontmatter (custom-agents-configuration). A Claude agent `*.md`
   is not shown to load. crq's role cards are not in `agents/`, and the engine passes them itself, so this does not
   block.
2. The docs give no statement of full Claude Code compatibility. Hooks and frontmatter beyond the Agent Skills six
   fields are not confirmed.
3. **New risk for P5.** Copilot uses "first-found-wins", and `<project>/.claude/skills/` loads before plugin
   `skills/`. A branch that adds `.claude/skills/crq/SKILL.md` would shadow the pinned crq skill, silently. Claude Code
   namespaces plugin skills (`/rulebook:crq`), so it does not have this gap.

Refinement for #162 (the Copilot spike):
1. Close the §9 question: Copilot installs the pinned plugin as a legacy Claude-layout plugin.
2. Add a check: on a copilot run, the engine refuses or strips any repo skill or agent whose name matches a plugin's
   (or runs with the project folders off). #82 already found `--no-custom-instructions` for the reviewer.
3. Keep one spike step: install `rulebook@chiyanram` with `copilot plugin install` and confirm the crq skill loads.

## Sources not used

- AutoGen role definitions: not opened this round. CrewAI, MetaGPT and ChatDev cover the role-file pattern.
- Third-party "compatible marketplace" repos from search results: not primary, not cited.
