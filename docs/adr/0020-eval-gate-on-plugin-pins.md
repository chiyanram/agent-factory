# 0020 · A plugin pin moves only with an eval proof

Status: accepted 2026-11-10 (operator, design audit). Not built; needs the first baseline (#216).

## Context

`agent-factory plugin update` shows the change, runs `config check`, then moves the pin (`src/plugin-pin-cli.ts`). It
runs no eval. `scripts/check-eval-proof.ts` gates changes to the review prompts only, and refuses them all until
`evals/reviewer/baseline.json` exists. A rule change in the plugin can therefore lower review quality with no check.
Some systems let the agent write lessons into its own skills; that lets a model change the rules that judge it.

## Decision

1. Record the first baseline (#216) on the 29 approved golden cases.
2. `plugin update` moves a pin only when an eval result exists for that exact plugin hash and shows no drop against
   the baseline. A human runs the eval, since it spends money; the pin move checks the proof.
3. A lesson is one skills PR with three parts: the rule, a new golden case or role scenario built from the failure,
   and a review-by date. A lesson PR may not change the judge or the existing cases.
4. A held-out slice of cases, which the lesson's author never sees, runs only at the gate.
5. The engine writes a timeline record per merge, with no model, as the loop's input.
6. Nothing here is automated: a human starts the retro, accepts the lesson, runs the eval and moves the pin.

## Considered

| option | why not |
|---|---|
| move pins on `config check` alone | a worse rule ships unseen |
| let the agent update its own rules | the judge and the judged become one; rules drift |
| run the eval in CI on every plugin change | it spends up to $100 a pass; a human decides when |

## Consequences

- Every rule change carries a test that would have caught the failure it fixes.
- The pin history is the eval history.
- See [The improvement loop](../explanation/improvement-loop.md).
