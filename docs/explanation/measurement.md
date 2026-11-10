# 6. Measurement

- **Fixed before the ledger pilot starts:**
  - merge rate against a baseline;
  - human minutes to fix each PR;
  - tokens and cost per merged PR;
  - rework rounds;
  - reverts within 30 days.

  For example, 7 of 10 tickets merge, and the median fix time is under 15 minutes.
- **The numbers never rate a person.**
- **A rule that stops paying goes on a list for the operator**, who decides; nothing is retired by itself
  ([The improvement loop](improvement-loop.md)). **Today:** nothing retires anything.
- **Evals:**
  - the automated review's golden set (ADR-0015);
  - about 10 past tickets end to end, once there is run history;
  - three scenarios per role card, in the process plugin.

  A model, prompt, card or plugin change ships only if its evals do not get worse. **Today:** only the review prompts
  are gated, and no baseline exists yet (#216).
