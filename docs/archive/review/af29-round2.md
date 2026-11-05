Reviewed 4365c14..69e3680 · round 2 · patch-id 85c3d05e (was f6861555) · merge-base c9f402a

Interdiff: 6 files, +23/-3. scripts/check-links.sh (quotePath, "cannot read" exit), tests + 2 fixtures, docs/DEVELOPMENT.md:92.
Scratch: /private/tmp/claude-501/r2/ (worktrees af-old, af-new; case-* repos).

## Round-1 Act on

| # | fixed? | evidence |
|---|---|---|
| 2 non-ASCII silent skip | yes | case-nonascii `café.md` `[b](nope.md)`: old rc=0 (awk can't open), new rc=1 "broken link: café.md:1: nope.md". Revert quotePath → test "non-ASCII file name" FAIL. |
| 5 untested ref-def / root-abs | yes | drop ref-def block → "reference-style" FAIL; root-abs `continue` → "root-absolute" FAIL; round-1 mutation (bogus prefix) → links-ok FAIL. New script + old tests → green (tests are what changed). |
| 8a stale commit rule | yes | DEVELOPMENT.md:92 now `type(area): subject`, types incl chore/fix/feat. No other live doc says `type: subject` (research/45 is historical). |

## New findings (interdiff only)

| # | bucket | finding | evidence |
|---|---|---|---|
| N1 | Consider | "cannot read" guard (check-links.sh:36-39) has no test | remove guard, keep quotePath → all 5 tests green. Guard still reachable: names with newline/tab/`"` (git quotes them even with quotePath=false) and deleted-but-tracked files. Fix: fixture with a tab or `"` in the name, expect_fail "cannot read". |
| N2 | Consider | deleted-but-tracked file aborts the whole run | case-deleted: tracked a.md removed from disk, b.md has broken link. Old: reports b.md, rc=1. New: "cannot read a.md", exit 1, b.md never checked. Loud, local-only (CI checkout never has it). |
| N3 | Consider | root-abs "resolve as relative" mutation survives | delete `/*)` line → all green, because fixture README sits at repo root where `/docs/x` and `docs/x` coincide. Fix: put the root-abs link in a sub-dir file. |
| D1 | Dismissed | empty repo | rc=0, no output. Correct. |
| D2 | Dismissed | names with spaces | `my doc.md`: broken link reported, `%20` target resolves. Correct. |
| D3 | Dismissed | names with newline/tab/quote | were silent rc=0, now loud rc=1 "cannot read". Improvement, not a defect. |

Verify pass: each row re-run on a fresh mutation from clean 69e3680; `make test` rc=0, `make lint` rc=0 at head.

Verdict: ready to merge (Consider items optional).
