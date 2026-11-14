# The factory stack

Where agent-factory sits on a common map of a software factory, and what it still lacks. The map comes from a vendor's
article, "How to choose your software factory stack"; we use it as a checklist, not as a recommendation.

## The three layers

- **The DevOps platform:** CI/CD, observability, incidents, issue tracking. agent-factory uses the project's own: its
  git host, its CI and its issue tracker.
- **The factory platform:** governance, human in the loop, orchestration, code context, SDLC context, engineering
  intelligence, an AI registry. This is the engine.
- **The AI infrastructure:** models, harness, environments, agents, an AI gateway, observability and evals.

A factory is built, bought with its agents, or bought as agent-agnostic infrastructure. agent-factory is built, in the
agent-agnostic shape: the engine is separate from the rules pack
([ADR-0009](../adr/0009-tool-and-rules-in-separate-repos.md)) and from the agent, and each outside tool goes through one
port ([P17](../CONSTITUTION.md#p17-one-port-per-outside-tool)). Approvals, run records, traces, the timeline and the
eval baseline live in our files, not in an agent product.

## The components

| component | agent-factory | state |
|---|---|---|
| Governance | the [ADR-0012](../adr/0012-safety-design-for-unattended-runs.md) guardrails, the plugin policy points, settings in layers | in place |
| Human in the loop | START, approval bound to the spec and design hashes, `confirm` on a policy point | in place |
| Orchestration | the dispatch loop and the lanes | in place |
| Engineering intelligence | `usage`, `trace`, `board`, the timeline line, `retro` | in place |
| AI observability and evals | run traces; the automated review's eval set and [ADR-0021](../adr/0021-keep-a-change-only-by-experiment.md) | in place |
| Environments | the runner: `vm` (a runner under Sysbox) or `srt` (an OS sandbox on a laptop) | partly. **Today:** the runner and gate are finished in #493 |
| Code context | the onboarder's brief and glossary in the project home | partly |
| AI registry | the pinned rules pack: skills, role cards, versions | partly: runs load no MCP server, so there is no server list |
| AI gateway | the egress proxy and its allowlist; spend caps per run, ticket and project-day | partly. **Today:** no model routing; #562 adds it |
| Agent swap | the coordinator runs under Claude Code or Copilot CLI; the implementer and review run Claude Code only | partly. **Today:** the Copilot runner comes in #493 |
| **SDLC context** (owners, deploys, incidents) | the `context.read` extension point is declared, and nothing reads it | gap |
| **More than one line** (security, incident) | one line: a ticket to a PR | gap, later |

The two gaps are on the [roadmap](roadmap.md#8-order-of-work) at the step where each is needed.

## A deliberate difference

The article's factory is always on. Ours starts nothing until a person starts it
([P8](../CONSTITUTION.md#p8-a-person-starts-everything)): an unattended run is one a person started and nobody
watches, not one that starts itself.
