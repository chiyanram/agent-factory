# 0007 · Test-first for bugs only, mutation testing for features

Status: accepted 2026-10-21 (#1 "Box 4", "G12 precondition"; old G12, chiyanram/skills#68)

## Context

#16 phase 5 first named TDD as the build loop for every change. The old map had decided otherwise in G12
(chiyanram/skills research/43).

## Decision

```
bug fix  ─▶ failing test that proves the bug first (mattpocock tdd)
feature  ─▶ code and tests in any order ─▶ PIT on touched classes with decisions ─▶ every surviving mutant listed on the MR
module without PIT ─▶ stays test-first until agent-platform #659 (PIT on every module)
```

## Why

- An agent writes tests cheaply after the code, so test-first forces nothing extra (skills research/43).
- Seams are agreed at design, so test-first adds no design pressure.
- The red step can be faked (mattpocock tdd.md; agent-platform #554 junk tests passed a TDD loop).
- 3–8.5× tokens with no mutation-score gain (Böckeler; thin: small sample).
- A mutation score proves a test can fail; it replaces the red step.

## Alternatives rejected

| option | why rejected |
|---|---|
| strict TDD for every change (#16 phase 5) | the reasons above; corrected by #1 "Box 4" |
| no test-first at all | still earns its place for bugs; every strict source keeps a bug rule (skills research/43) |

Watch: escaped bugs, in the usage and output measurement (map #1).

## Sources

#1 "Box 4 build order DECIDED", "G12 precondition DECIDED" · #16 phase 5 · chiyanram/skills#68, research/43
