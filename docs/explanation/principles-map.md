# Where the principles come from

The principles in [the constitution](../CONSTITUTION.md) (P1–P21) and the rules pack's own principles (K1–K9, in
chiyanram/skills `PRINCIPLES.md`) name no source. This page lists, for each input they were checked against, the
general principles it states and the P or K that covers each. It comes from the coverage records on #460 (step 1,
2026-11-11); the claim sheets with every row are there.

## By input

| input | general principles it states | covered by |
|---|---|---|
| 12-factor agents (humanlayer/12-factor-agents) | below, factor by factor | P1–P4, P6–P8, P10, P11, P13, P14, P16, P19 |
| Continuous engineering (a manifesto) | the factory, not the code, is the asset; measure outcomes; learn from every run | P1, P3, P6–P8, P10–P13, P15, P16, P18, P21, K1, K5 |
| Building effective agent automations | code decides, the model fills in; scoped credentials outside the sandbox; caps and stops | P1–P9, P14, P11, P19 |
| Which model should you build with? | a model and an effort per step; measure before you switch | P14, P11 |
| Automating eval design and hillclimbing | a baseline, beyond noise, on cases not tuned on | P11 |
| Seeing like an agent | give the run what it needs and nothing more; typed tools | P10, P11, P13, P14, P19, K6 |
| Context engineering for current models | load only what a step needs; say only what the model would not do; checks over prose | P13, P14, P15, P16, P21, K4, K5, K6 |
| How we use skills | short skills that point to references; lessons from real failures; give the goal and the limits | P10, P15, K1, K4, K5, K6, K7 |
| How the Claude Code team does code review | proof before a blocking finding; review converges; capped rounds | P6, P7, P10, P11, P12, P15, P21 |
| A production software factory (Warp) | one factory definition; traces; front doors where people are | P1, P2, P4, P7, P8, P10–P14, P16, P17, P19 |
| Seven criteria for a software factory (Warp) | factories as code; benchmarks; proof at PR time; full traces | P3, P8, P10–P12, P15–P17, P19, K3 |
| Nine lessons from working with coding agents | ask what the agent does not know; a measurable goal; you are the strategist; mutation testing; short skills | P8, P11, P12, P13, P14, P15, P20, K4, K6, text is data (P5) |
| Tactical vs strategic programming (a talk) | keep the design improving; refactor as its own work | P20 |

## 12-factor agents, factor by factor

| factor | what it says | covered by |
|---|---|---|
| 1 | natural language becomes a structured object; code acts on it | P1, P13 |
| 2 | own your prompts | P11 |
| 3 | own your context window; context includes past state and results | P14, P13 |
| 4 | tools are structured outputs that trigger code, and code decides whether to run them | P1, P4 |
| 5 | unify execution and business state; keep secrets out of the record | P3, P16, P4 |
| 6 | launch, pause and resume with simple APIs; webhooks resume work | P19, P8 |
| 7 | contact people with a structured call; the reply joins what the next step reads | P13 |
| 8 | own your control flow; break for people and high-stakes acts; trace it | P1, P6, P8, P10 |
| 9 | compact errors into the context; cap consecutive errors, then escalate | P13, P7 |
| 10 | small, focused agents; grow scope only as fast as quality holds | P1, P2, P11, P10 |
| 11 | trigger from anywhere and reply in the same channel; quick contact allows riskier tools | P19, P8, P4, P6 |
| 12 | the agent as a stateless reducer | P2, P3 |
| 13 | pre-fetch the context the model will need | P14 |

## What no principle covers

- Runners on other operating systems for native simulators: no project needs them.
- Codebase health measured over time: P20 stands, and a measure is chosen once real numbers exist (#495).
- An AI judge scoring real runs: P10's outcome signals are the measure while volume is low.
- Who may approve, and trusted authors, in a team: deferred until a team uses the factory.
