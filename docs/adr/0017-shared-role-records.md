# 0017 · Three shared records for what a run returns

Status: accepted 2026-11-10 (operator, design audit). Built in #425, but for the finder card and the review's verify
prompt (#438, after the first eval baseline, #216).

## Context

Each role returns its own shape (`src/core/process/cards.ts` `HAND_OFF`). A finding from a finder and a conflict from
the design-reviewer are the same concept with different fields. A question has a shape in the implementer's
`report.json` and is free text from the coordinator. The verify pass returns a bucket and a reason, with no grade or
severity (`src/core/review/verdicts.ts`), so the finder grades its own proof. The retro's actions are free text, so the
improvement loop needs a model to read them.

Vendors set the final verdict in the validator, not the finder (Anthropic Code Review, Cursor Bugbot).

## Decision

1. The engine owns three records, and every role uses them:
   - **Report**: what the build roles return (implementer, test-first, cleanup); as today.
   - **Finding**: one record for the finder and the design-reviewer.
   - **Question**: `{question, choices, recommended}`, for the coordinator, the implementer and test-first.
2. Each card's `hand_off` must name fields of its record, as `cards.ts` checks today. The finder card is used, with
   its schema.
3. The verify pass sets the final severity and grade. It may lower them, never raise them.
4. The retro returns its actions as JSON: `[{type, owner, due, ticket}]`.

## Considered

| option | why not |
|---|---|
| keep one shape per role | the same concept drifts apart; the improvement loop cannot count findings across roles |
| the finder keeps the final grade | a run grading its own proof; the grade floor (RV7) stays prose |

## Consequences

- One parser per concept; a role card that names an unknown field is refused, as today.
- The review's grade floor becomes code.
- The timeline record ([ADR-0020](0020-eval-gate-on-plugin-pins.md)) can count findings by rule across roles.
