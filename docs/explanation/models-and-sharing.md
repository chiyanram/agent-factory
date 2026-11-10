# Models, cost and sharing

Which model each run uses, what bounds the spend, and how the factory moves from one person to a friend and then to a
team. The keys are in [Settings](../reference/settings.md#settings).

## Models and cost

| run | model | set by |
|---|---|---|
| implementer, test-first, cleanup | **Today:** Claude's default unless `FACTORY_WRITER_MODEL` is set; run records do not name the model | the lowest settings layer (a preference) |
| automated review: rule finder and verify | `claude-sonnet-5-5` | pinned in `src/core/review/pinned.ts`; an alias is refused |
| automated review: logic finder and verify | `claude-opus-5-5` | the same |
| eval judge | `claude-sonnet-5-5` | the same |

Spend is bounded by caps per run, per ticket, per project per day, and a share of a subscription window
(`src/core/dispatch/caps.ts`). **Today:** a cap left unset is no cap, and `agent-factory usage` reports spend per
ticket and per run kind.

## Sharing

```text
 step 4  you and a friend      one rulebook pin, each person on their own model login
 step 5  your work laptop      srt runner, local specs, Claude plan or (later) Copilot (#162)
 step 6  colleagues            a team layer: shared settings and plugin pins, caps on by default
```

- **Settings layers:** team, project, user, machine. A team layer is a git repo read at the commit the project pins;
  safety keys only get stricter in a lower layer (`src/core/settings/`).
- **Setup:** `agent-factory init` sets up a laptop and a project in one guided run and prints the commands only a
  person runs (#369).
- **Plugin pins:** the plugin list is a locked team key. **Today:** the pin itself (commit and hash) is kept per
  machine in `$FACTORY_HOME/projects/<project>.plugins.json`, so two people can run different versions.
- **Logins:** each person uses their own model login, never a shared one.

## What is decided next

Decided in the design audit (2026-11-10), not built:

| change | why |
|---|---|
| model keys become an allow-list: the team lists the allowed models, a person picks inside it, a model outside it refuses the run | vendors let an org lock the allowed set; a preference lets anyone pick anything |
| the implementer's model is a full model id, never the CLI default, and every run record names the model it used | a default that changes under you changes results with no trace |
| an effort setting per role | tune effort before changing models |
| no cheaper-model routing per lens yet; revisit on the golden set after the baseline (#216) | routing gains are shown on question benchmarks, not on agent coding |
| plugin pins (commit and hash) move into the team layer as a locked key; moving one is a PR on the team repo with its eval proof | everyone on a team runs the same rules |
| `setup status` ends with one table, a row per item with its fix, and the orchestrator refuses to run until every row passes | `init` checks pieces; nothing yet refuses to run on a failed one |
| caps on by default from the team layer; a person may lower them, never raise them | an unset cap is no cap |
| one rulebook version for now; stable and early channels only when colleagues join | channels are a cost with one or two users |
