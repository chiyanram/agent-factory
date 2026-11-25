# 6. Measurement

- **Fixed before the ledger pilot starts:**
  - merge rate against a baseline;
  - human minutes to fix each PR;
  - tokens and cost per merged PR;
  - rework rounds;
  - reverts within 30 days.

  For example, 7 of 10 tickets merge, and the median fix time is under 15 minutes.

  **Today:** [`agent-factory usage`](../reference/cli.md) reports tokens and cost per ticket and run kind, each
  ticket's rework rounds, and the automated review's acted-on rate. For a merged ticket, it also reports the outcome:
  clean, reverted, or fixed on the same lines within 30 days. The merge rate and the fix minutes are not computed yet.
- **The numbers never rate a person.**
- **A rule that stops paying goes on a list for the operator**, who decides; nothing is retired by itself
  ([The improvement loop](improvement-loop.md)). **Today:** nothing retires anything.
- **Evals:**
  - the automated review's golden set (ADR-0015);
  - about 10 past tickets end to end, once there is run history;
  - three scenarios per role card.

  A model, prompt, card or plugin change ships only if its evals do not get worse. **Today:** only the review prompts
  are gated, against the baseline in `evals/reviewer/baseline.json`.

## What is decided next

Decided, not built:

| change | why |
|---|---|
| fix minutes come from git host timestamps, never from a person's own report | a self-report is a guess |
| escaped defects: a bug ticket that names a factory PR's file within 30 days counts against that PR (our own rule; no primary source uses exactly this) | reverts alone miss bugs fixed forward |
| one "why" question to the human per ticket, at merge or at a rescue | the numbers say what happened, not why |
| the pilot's targets are written as counts, such as 7 of 10 tickets merge | a percentage of a few tickets hides how few they are |
