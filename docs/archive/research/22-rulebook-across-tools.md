# 22 — The rulebook across agent tools: old decisions, tool docs, references (2026-10-20)

For chiyanram/agent-factory#1 box 5 (rulebook). Read-only. Re-checks #18 Q2 AMENDED and Q3 after research/21 flagged them.

## Old map decisions (chiyanram/skills, exact)

- G1 (sk#14): AGENTS.md index <200 lines, CLAUDE.md = @AGENTS.md; skills + references in one tree linked per harness; upstream skills are plugins, never copies.
- G1b (sk#72): directory MUSTs → <dir>/AGENTS.md (+ CLAUDE.md = @AGENTS.md); file-type MUSTs → root AGENTS.md blocks, ≤3 MUSTs each; .claude/rules deleted, because "every file-type scoping mechanism found is harness-specific".
- G5 (sk#22): each reference has Rules (ours) · When X, use Y · Good/Bad · Decided edges · Review checks; one file for writer and reviewer.
- G10 (sk#37): 16-point checklist, replay proof, "Use when…" descriptions, make lint gate.
- G20 (sk#90): root <200 lines; root→leaf chain under Codex's 32 KiB; sentinel probe via claude -p and codex exec.
- G21 (sk#91): imperative + because + the failure it prevents, ≤35 words.
- G23 (sk#93): generic skills, references and crq in chiyanram/skills as a plugin; Codex loading left open.
- ND-1: one tree .agents/skills, .claude/skills symlink. ND-13: module CLAUDE.md → AGENTS.md.
- 476-rule ledger (skills research/19): every row names a target file; the SK plugin still holds only .gitkeep.

## How each tool loads project instructions (official docs)

| tool | root file | nested by dir | path-glob scoping | skills | size |
|---|---|---|---|---|---|
| Claude Code | CLAUDE.md (AGENTS.md only when no CLAUDE.md); @imports | subdir CLAUDE.md/AGENTS.md on read | .claude/rules paths: | .claude/skills, plugins | target <200 lines |
| Codex CLI | AGENTS.md, root→cwd concatenated | root→cwd only (below cwd UNVERIFIED) | none | .agents/skills | 32 KiB |
| Cursor | AGENTS.md root + subdirs | yes | .cursor/rules globs | .agents/skills, .cursor/skills | rules <500 lines |
| Copilot | .github/copilot-instructions.md; AGENTS.md anywhere | nearest wins | *.instructions.md applyTo (cloud agent, review) | .github/.claude/.agents skills | — |
| Gemini CLI | GEMINI.md; AGENTS.md via context.fileName | ancestors + just-in-time | none | .gemini/skills, .agents/skills | — |
| agents.md | AGENTS.md, plain markdown | closest wins | none | — | — |

Sources: code.claude.com/docs/en/memory · learn.chatgpt.com/docs/agent-configuration/agents-md · cursor.com/docs/context/rules · docs.github.com (copilot add-repository-instructions, about-agent-skills) · geminicli.com/docs/cli/gemini-md · agents.md.

## References

| ref | root (lines) | rules live | generic → many projects | multi-tool |
|---|---|---|---|---|
| mattpocock | CLAUDE.md 25 (AGENTS.md symlink) | skills/ | Claude plugin + npx skills add | yes |
| openclaw | AGENTS.md 145 | root + 33 nested AGENTS.md, .agents/skills | in-repo | yes |
| humanlayer | CLAUDE.md 88 + 8 nested | — | separate repo, npx skills add | partly |
| addyosmani | AGENTS.md 92 + CLAUDE.md 60 | skills/, .claude/rules, .gemini | npx skills add + plugin | yes |
| firstmate | AGENTS.md 426 (47,958 B, over Codex cap) | .agents/skills | in-repo | yes |
| forge | AGENTS.md 35 | .agents/skills | copies | partly |
| plinth | AGENTS.md 204 | skills/ + .claude-plugin | npx skills add per agent | yes |
| pstack | none | Cursor plugin | Cursor plugin | no |

## Sub-decisions and conflicts

| sub-decision | old | new | conflict | support |
|---|---|---|---|---|
| generic vs project home | G23 two repos | #16 Q2 same | no | mattpocock, addy, humanlayer, plinth |
| delivery to each tool | plugin; Codex open | #16 Q3 enabledPlugins | Claude-only gap | npx skills add (4 refs); every tool reads .agents/skills |
| root file | G1 | #16 Q1 same | no | Codex/Cursor/Copilot/agents.md native; Claude needs shim |
| area scoping | G1b nested AGENTS.md | #18 Q2 AMENDED paths: | YES; paths: Claude-only | nested AGENTS.md read by Cursor, Copilot, Claude, Gemini; Codex root→cwd |
| skills tree | ND-1 | WIP | no | all tools read .agents/skills |
| rule format | G5 + G21 | #18 Q3 six fields ≤10 lines | YES | no tool requires a format |
| size budgets | G1, G20, G1b | none | gap | 200 lines / 32 KiB / 500 lines |
| load proof | G20 sentinel | inherited | no | extend to other tools |
| who writes the 476 rules | ledger names targets | undecided | gap | — |

Claude-only in current decisions: #18 Q2 paths:, #16 Q3 enabledPlugins, .claude/agents subagents, Claude hooks.
