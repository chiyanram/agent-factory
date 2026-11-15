Why: <the reason for this change, in one sentence>. Spec: #<the approved spec; in the tiny lane, the ticket>

Breaking change: <no; or yes, and what callers must change>
Rollback: <revert this PR; no data changes. Or how to switch it off>
Where to look: <one to three places where a mistake would cost most>

## Evidence at <commit>

| criterion | command or test | result |
|---|---|---|
| <AC-1, as the spec words it> | <the test by name, or the command> | <passed> |

## Change

<each changed file marked A, M or D, or a call tree; for one file, a single "Change:" line>

## Checklist

- [ ] Lane: <tiny, bug, feature or one-way door>, because <why>. A one-way door adds a "## One-way door" section.
- [ ] Tests: <the vitest tests added or changed, each failing without the change; or none, and why>
- [ ] Docs: <the pages of `docs/` and `prompts/coordinator.md` changed, and each **Today:** note; or none, and why>
- [ ] Lint: `make lint` and `make test` green; no disable comment; `scripts/lint-baseline.json` not raised
- [ ] Rules pack and evals: <`make test` with `FACTORY_RULES_PACK` set, or the eval pass of a review input; or neither touched>
- [ ] Health: <`make garden-pr` shows no module worse; or which got worse, and the refactor ticket>

Closes #<ticket>
