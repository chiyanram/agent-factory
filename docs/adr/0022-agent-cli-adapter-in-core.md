# 0022 · The agent CLI adapter lives in core, and owns each run's time limit

Status: accepted 2026-11-16 (operator, #659 Q1 = A; #687 spec and design). Amends ADR-0014 P7.

## Context

ADR-0014 P7 made the agent CLI a plugin: "A runner plugin builds the argv and parses the output. The box plugin runs
that argv." Nothing was built for it, so `runner` stayed an extension point that no code calls. Meanwhile each run kind
builds its own `claude` argv, and the read-only runs share one call that had no time limit: a hung run held its slot
until a person killed it, against ADR-0012 S7 and Constitution P7 (every loop has a cap and a stop).

The adapter decides the trust boundary of a model run:
- the argv, and so its tools and its deny list, and whether skip-all is passed, which only a runner may get (S11);
- the environment the CLI gets: an allowlist with one model-only token and no git host token (S6, S15);
- how its output is read: the answer, the tokens and the cost;
- how long the run may take, and how it is stopped.

An executable outside the core must not own any of that. P7's own rejected option already warned that one plugin
that forgets the box runs an agent on the host.

## Decision

| # | decision |
|---|---|
| A1 | **One seam in core, like `Forge`** ([ADR-0010](0010-one-forge-seam-two-adapters.md)). `src/core/agent/` holds the `AgentCli` interface and a built-in adapter per agent CLI, Claude Code first and Copilot next (#690). Each model run the factory starts goes through it. `FACTORY_CLAUDE` is read there and nowhere else. |
| A2 | **`runner` leaves the plugin extension points.** A plugin that declares it is refused when it is described. Plugins stay for outside integrations: the tracker, the git host, notify, context and the box. |
| A3 | **The adapter keeps each run's time.** A run carries its wall-clock limit. Past it, the adapter stops the CLI and everything the CLI started (SIGTERM to the process group, then SIGKILL after a grace). The run answers failed with the reason, and what it streamed is kept as its trace. |
| A4 | **The limits are settings, keyed on the run kinds the setups already have.** Each key has a default and a maximum, and is a `cap`, so a lower layer can only lower it. Each setup picks its own key, so the adapter names no run kind. For the read-only runs the keys are `review.finderMinutes`, `review.verifyMinutes`, `design.minutes`, `onboard.minutes`, `retro.minutes` and `eval.judgeMinutes`: each 20 minutes by default, 60 at most. The implementer keeps `implementer.minutes`. |
| A5 | **The sessions list has a limit too.** `claude agents --json` that does not answer in 60 s fails as "cannot list live runs", which already fails closed: no claim is released on an unknown list. |

**Today:** only the read-only runs and the sessions list go through the seam. The writer runs move in #688, and the
coordinator in #691. The read-only runs still run on the host, not on a runner (ADR-0012 S5; #674, #493).

## Considered

| option | why not |
|---|---|
| a `runner` plugin, as ADR-0014 P7 decided | the plugin would own the trust boundary (skip-all, the token, the deny list, the limit), which the core must enforce for every CLI |
| the adapter in core, with `runner` kept as a later plugin door that only builds the argv | nothing needs that door now; it can come back as its own decision with its own guardrails |
| one limit key for every read-only run | a whole-repo design review and a short verify pass do not take the same time; one key per run kind costs nothing more |

## Consequences

- A new agent CLI is a new adapter in core and a new release, never a plugin a project installs.
- A run that hangs is stopped at its limit and recorded as failed with the reason. It no longer holds its slot.
- A plugin built against ADR-0014 P7 that declares `runner` is refused at load. None is known.
