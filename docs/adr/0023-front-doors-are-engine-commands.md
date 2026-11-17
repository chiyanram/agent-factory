# 0023 · Front doors are engine commands on one door seam, not plugins

Status: accepted 2026-11-17 (operator, #713: "713 approve", relayed by the coordinator; grilling Q1–Q3 = A). Amends
ADR-0014's picture. Refines ADR-0012 S1: its front doors write through one door seam.

## Context

A person gives their word (a START, an approval, a waiver) through a front door: the terminal today, a Discord bot
next, and a web UI last. [ADR-0012](0012-safety-design-for-unattended-runs.md) S1 says every door
writes the same local records, `via` names the door, and the AI never writes them.

[ADR-0014](0014-plugin-model.md)'s plugin contract is one request and one response (`describe`, then `call`), from an
executable outside the engine. A door does not fit it:
- it is long-running and inbound;
- the one thing it does that matters, deciding who a person is and writing their word, must stay in pinned and tested
  engine code.

[ADR-0022](0022-agent-cli-adapter-in-core.md) kept the agent CLI adapter in core for the same kind of reason: the code
that sets a trust boundary must not be a plugin.

## Decision

| # | decision |
|---|---|
| D1 | **A front door is an engine command, not an ADR-0014 extension point.** Each door is built in core (`agent-factory door <name>`; the terminal's door is the CLI itself) and names its `via`. ADR-0014 has no `door` extension point, and none is added. |
| D2 | **One seam, `src/core/door/`.** It holds one read model, `board`'s lines (and, once #712 lands, the tickets that wait on a person), and one write API: START, approve and waive. The write API takes a `Person` that only a door's own identity check can make (`vouch`), refuses any other object, and fills `by` and `via` from it. There is no `--by` or `--via` flag. |
| D3 | **The write API refuses inside a model run**, by the run's environment: `CLAUDECODE`, which Claude Code sets for every command it runs, or `AGENT_FACTORY_MODEL_RUN`, which the agent adapter sets for every run it starts. A model can change its environment, so this backs up the walls and is not one. The walls stay S1's: the coordinator's deny list, which covers `agent-factory door` too, and on the VM the `factory` OS user. |
| D4 | **The Discord chat is Claude Code's official channel plugin.** It writes no record. Its words are data (P5), and an answer that changes the spec makes the approval stale (P13). START and approve are commands to the separate, code-only door bot (#548), whose check maps a Discord user id to a person from an allowlist the factory user owns, and refuses a bot or an unknown id. |
| D5 | **Pings stay with the `notify` plugin.** A door reads and writes a person's word; it does not ping. |

**Today:** only the terminal door is built. The Discord door is #548; the web UI (#714, #715) comes last. The
coordinator does not start through the agent adapter yet (#691), so for it the model-run refusal sees only
`CLAUDECODE`.

## Considered

| option | why not |
|---|---|
| a door as an ADR-0014 plugin | the plugin would decide who a person is and hand the core a `by`, outside pinned engine code (S1) |
| `--by` / `--via` flags on the CLI | any caller, the AI included, could claim another person or door |
| a plain `by` string on the write API, with a doc rule | a door could pass any name; the `Person` makes the rule hold in the code |
| each door with its own read of the records | three doors would drift; one read model keeps them in step (P19) |

## Consequences

- A new door is a new file in `src/core/door/` and a new release, never a plugin a project installs.
- Adding a `via` value (for example `ui`, with #715) is a change older engines refuse: they read such a record as
  unreadable, which fails closed. That change's PR says what a rollback does.
- A person who types `!agent-factory approve` inside Claude Code is refused, and gives their word from a plain terminal.
- ADR-0014's picture loses `discord` as a door; `discord` stays there only as a `notify` plugin.
