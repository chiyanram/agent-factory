# The improvement loop

How the factory gets better: a human reads what went wrong, turns it into a rule and a test case, and an eval proves
the change before it ships. The model's weights never change; the rules, the role cards and the cases do. Every step
that changes a rule is started and accepted by a human.

## The loop

```text
 ① signal           ② retro              ③ lesson               ④ eval gate                 ⑤ ship           ⑥ retire
 what the engine    a human starts it    one skills PR:         no drop against the         a human moves    a human drops
 recorded, per      and reads ①          the rule, a new case   baseline; the judge and     the plugin pin   a rule that
 merge, no model                         from the failure, a    the cases never change                       stopped paying
                                         review-by date         in a lesson PR
```

| step | today | decided, not built |
|---|---|---|
| ① signal | run records per ticket; `agent-factory usage` (spend per run kind, acted-on rate per lens, category and bucket); a **timeline line** per merge, written by the engine with no model: rounds, findings per rule ID and bucket, acted-on per rule ID, spend per run kind, rescues (hand-overs a person took back) | rescues from waivers and a person's own pushes, which the run records do not hold yet (#614) |
| ② retro | a person runs `agent-factory retro <project>`: code lists the failures seen on two or more merges and every escaped defect, with no model. `--draft` runs the rules pack's retro card once, read-only and capped at $10, and the engine writes one lesson draft per failure under `<home>/retro/` (RT1–RT10; #488) | code that reads the retro's JSON actions (the coordinator posts them since #425), so ① and ③ need no model |
| ③ lesson | a rule change with the ticket as its origin (RT3) | one lesson is one skills PR with three parts: the rule at its strongest level (RT6), a new golden case or role-eval scenario built from the failure, and a review-by date |
| ④ eval gate | `scripts/check-eval-proof.ts`: a change to the review prompts must carry a results file that holds the baseline within the noise and beats it by more than the noise on what it aims at, quality or cost ([ADR-0021](../adr/0021-keep-a-change-only-by-experiment.md)) | the gate also covers plugin pins; a held-out slice of cases the lesson author never sees runs only at the gate; a lesson PR may not change the judge or the existing cases |
| ⑤ ship | `agent-factory plugin update` shows the change, runs `config check`, then moves the pin | the pin moves only when an eval result for that exact plugin hash shows no drop; a human runs the eval (it spends money) and the move; never automated |
| ⑥ retire | the design says a lens is retired after 20 PRs with no unique verified finding. **Today:** nothing retires anything | after 20 PRs, a rule with no acted-on hit goes on a list for the operator, who decides. Security and one-way-door rules stay while they still catch their seeded golden bugs |

## The evals

| set | what it measures | state |
|---|---|---|
| the automated review's golden set (`evals/reviewer/`, ADR-0015) | each case is a real commit, a change and the findings a good review must report; `agent-factory eval reviewer` runs the real review round and a judge matches its Act on findings | 29 cases approved, 2 drafts; no baseline yet (#216: hand-check the judge, then record it) |
| role scenarios | three scenarios per role card, in the process plugin | in chiyanram/skills; not wired to the pin |
| past tickets end to end | about 10 real tickets, replayed | once there is run history |

An eval pass costs money: `agent-factory eval reviewer` has a $100 cap and only a human starts it.

## Why a human starts each step

Some systems let the agent write its lessons straight into its own skills. That lets a model grade its own output
and change the rules that judge it, and the rules drift. Here the signal is written by code, a lesson is a reviewed
PR with a test case, the gate compares against a fixed baseline with a fixed judge, and a human moves the pin.
