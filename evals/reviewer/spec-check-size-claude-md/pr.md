# fix(lint): check-size checks CLAUDE.md too (#999)

A project that keeps its rules in CLAUDE.md gets no size check today.

## Acceptance criteria

1. `make lint` fails when the root AGENTS.md or the root CLAUDE.md has 200 lines or more.
2. The message names the file that is too long.
3. A test in test/repo-lint.test.ts covers a CLAUDE.md of 200 lines next to a short AGENTS.md.
