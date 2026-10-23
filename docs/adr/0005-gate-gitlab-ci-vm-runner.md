# 0005 · Gate: GitLab CI on the VM runner, done by kind

Status: accepted 2026-10-18 (#4 Q4, Q5a); speed decided 2026-10-22 (#20)

## Context

The full gate took about an hour on the VM, then 1h35m. It had one slot, full rerun only, and no failed-run log
(research/17, 30). The rule "verify-full for every change" was skipped in practice (#4 Q4). No paid CI, no new machine
(#20 Question).

## Decision

```
MR push ─▶ GitLab CI on the VM's own project runner ─▶ result on the MR ("Pipelines must succeed")
           docs → lint + rule-load · quick/standard code → touched tests + smoke core · floor/full → full gate
speed:     agent-platform #738 → #748 (parallel IT forks) → smoke diet; ITs beside deploy + smoke
```

Writers never deploy the shared stack. Until the runner exists, the writer runs the same `make` target and records
SHA + result on the MR.

## Why

- The VM is not overloaded. ITs ran 30 minutes on one core with 7 idle (research/30 §2).
- Speed comes from splitting work across cores and from the cache (Gradle docs, firstmate, openclaw; research/30 §4).
- GitLab's own runner is free; only shared runners are metered (#4 Q5a).

## Alternatives rejected

| option | why rejected |
|---|---|
| the Verifier queue | submit and paste by hand, one slot (#4 Q5a) |
| a bigger machine | no switching machines for money; the VM is idle, not slow (#20) |
| laptop as the runner | works only while the laptop is on (research/17) |
| full gate for every change now | ~1 h; skipped in practice (#4 Q4) |

## Sources

#4 Q4, Q5a, Q5b · #20 resolution · research/17, 27, 28, 30
