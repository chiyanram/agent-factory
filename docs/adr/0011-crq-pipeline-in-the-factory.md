# 0011 · The factory side of the /crq pipeline

Status: accepted 2026-11-06 (operator, chiyanram/skills#210, D1–D17). Amends ADR-0001 and ADR-0004.

## Context

The rulebook now ships the whole change pipeline as its `crq` skill: lanes, phases, how a review runs, proof of done,
pull request readiness and retro (skills ADR-0008). Before it was approved, it was compared with Matt Pocock's
software factory and Sandcastle, sixteen coding-agent orchestrators (GitHub Agentic Workflows, Composio, OpenHands,
ccpm, Sculptor, ralph and others) and the measured failures of multi-agent coding systems (MAST: 1,642 traces,
failure rates of 41–86.7%). The comparison confirmed this factory's shape and found gaps in it.

## Decision

```
you ⇄ coordinator ──▶ scripts ──▶ forge (issue + pull request = the record)
                          ├─ start-writer   one fresh writer per pull request; may post [writer] OPEN and stop
                          ├─ ready check    re-runs the evidence at the pushed commit before review
                          ├─ start-reviewer find over the whole head copy, then verify
                          └─ rails          caps, breaker, blocked label, protected files, dry run
```

| # | change | replaces |
|---|---|---|
| D10 | The writer may post `[writer] OPEN: <question>` and stop. `poll` counts it as an open ask, like a coordinator ask. | "a worker cannot ask" (ADR-0001) |
| D11 | One fresh writer per pull request. Slices are commits in it; work over the size budget becomes separate tickets. | the draft's writer per slice |
| D12 | A script re-runs the evidence commands and the red-first check at the pushed commit before review starts, and refuses review when they fail. For a bug, a separate run writes the failing test from the bug spec before the fix writer starts. | the writer marking the change ready |
| D13 | A deterministic `dispatch` script runs the trigger table, fed by `poll`. The coordinator keeps the conversation, open questions and exceptions. After the pilot shows the table is stable. | the coordinator deciding each routine step |
| D14 | Rails: an `agent::blocked` label with the reason and a log path; a failed writer pushes its work-in-progress branch; caps on turns, wall-clock time and daily spend, set per lane; a no-progress breaker (an empty or unchanged patch-id goes to `needs-human`); CI failure signatures, so the same failure is not sent back again; protected files (CI config, build files, `CODEOWNERS`, agent instruction files) go to the human; `FACTORY_DRY_RUN` prints forge writes instead of making them; `reconcile` re-checks liveness before it releases a claim. | none |
| D15 | The find pass reads the whole head copy, not only the diff, and may report unchanged code the change breaks. | the diff-only find pass (ADR-0004) |
| D16 | Every run records its tokens by phase on the pull request, transcripts are kept per head, and the pilot compares against a single-session `/crq` at the same token budget. A phase that does not change outcomes is retired. | none |
| D17 | The writer's session lints on every edit and has a quick command for the touched tests. | none |

Amended 2026-11-06 (#79): a blocked run gets the `needs-human` label, not a new `agent::blocked` label, because
`poll` and every trigger already stop on `needs-human`; `scripts/block.sh` adds it with a `[coordinator] blocked:` note.
`FACTORY_DRY_RUN` covers the coordinator's own scripts; `start-writer` and `start-reviewer` refuse it.

## Why

- A writer that cannot ask guesses; failing to ask for clarification is 6.8% of multi-agent failures (MAST, FM-2.2).
- Every hand-off between agents loses decisions (MAST inter-agent misalignment, 32.3%; Anthropic's multi-agent
  research system), so one writer per pull request.
- A writer's "done" is a report, not proof: 0 of 15 test-passing agent pull requests were mergeable as they stood
  (METR, 2025), and OpenHands' resolver and ralph trust the agent's own last message.
- When one agent writes the code and its tests, test accuracy falls from 87.8% to 61.0% (AgentCoder), and only 94 of
  213 agent-written reproduction tests held against the real fix (Agentless).
- "A deterministic loop … is faster, cheaper, and more reliable, because no agent makes the orchestration decisions"
  (Matt Pocock, implement-spec); Agentless and Google's LLM migrations ran inside fixed pipelines.
- Caps, protected files and a dry run come from GitHub Agentic Workflows; failure signatures from Composio's
  orchestrator; the no-progress breaker from ralph-claude-code; the work-in-progress push from OpenHands.
- Superficial verification is 8.2% of multi-agent failures (MAST, FM-3.2); a diff-only reviewer cannot see a broken
  caller.
- Multi-agent setups use about 15× the tokens of chat, and the edge shrinks as models get stronger (Anthropic;
  arXiv 2505.18286, 2604.02460), so every phase must earn its cost.

## Alternatives rejected

| option | why rejected |
|---|---|
| the reviewer edits code (Sandcastle) | the judge would be the writer (ADR-0004) |
| feedback sent into the same live writer session (Composio) | that session drifts; every round stays fresh (ADR-0001) |
| a swarm of role agents (MetaGPT, ChatDev, Ruflo) | they fail 60–67% of easy coding tasks (MAST) |
| a bespoke board or desktop app (vibe-kanban, Crystal, Terragon) | all three wound down in 2026; the forge stays the record (ADR-0002) |
| auto-approving agent permissions (claude-squad `--autoyes`, ralph) | removes the sandbox the guardrails rely on |

## Sources

chiyanram/skills#210: the design, the decisions and the research notes, with every cite at `path:line@commit` or
URL and section. chiyanram/skills ADR-0008. ADR-0001, 0002, 0004, 0006.

## Amended 2026-11-06 (map #30)

By [ADR-0012](0012-safety-design-for-unattended-runs.md) and [ADR-0013](0013-typescript-package-cli-first.md):
- **D10:** the writer writes its question to `.factory/report.md` and exits. The host posts it as `[writer] OPEN:`
  ([gap 3](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6681622159)).
- **D12:** the order is kept: ready check → reviewer → gate ([gap 2](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6681560750)). The ready check runs in the box
  (S5).
- **D13:** decided now, not after the pilot. The dispatcher is code and holds the bot login. The coordinator is denied
  it and the start scripts ([Q15](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6681316890)). It is built first, in TypeScript, before the pilot
  ([gap 4](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6681648337)).
- **D14:** the host, not the writer, pushes a failed writer's work-in-progress branch. Protected files also include
  new dependencies, and every PR gets the script-made box ([Q5b](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6681168344)).
- **D17:** the lint hook loads from the default branch or the factory, never from the branch ([Q7](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6681210370)).
- **Rejected auto-approve:** auto-approve stays rejected on the laptop. Skip-all is allowed only in a strong box: `FACTORY_BOX=vm` or `srt`
  ([Q6](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6681210370)).
