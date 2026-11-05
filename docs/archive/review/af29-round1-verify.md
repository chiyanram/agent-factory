Verified af29 round 1 · head 4365c14 · patch-id f6861555

Repo uses none of: `](<`, space/paren in target, `[x]: ` defs, `~~~`, 4-backtick fences, non-http schemes, root-abs links, non-ASCII filenames.

| # | bucket | one line why | fix (Act on only) |
|---|---|---|---|
| 1 | Consider | Reproduced: `[c](Sub/X.md)` rc=0 on APFS. CI (Ubuntu) is the gate and catches it; only local/CI disagreement. | — |
| 2 | Act on | Reproduced: `café.md` with `[b](nope.md)` → awk "can't open", rc=0. Lint passes a broken link silently = the exact failure #28 forbids. (Location is :32, not :35.) | scripts/check-links.sh:32 `git -c core.quotePath=false -C "$root" ls-files ...` |
| 3 | Consider | Reproduced: `~~~` + inner ``` → false positive; ```` + inner ``` → real broken link after block MISSED (rc=0); indented code flagged. No such forms in repo. | — |
| 4 | Consider | Reproduced all: `<my dir/a b.md>`→"my", `a_(1).md` cut, MAILTO/ftp/HTTP/tel flagged. False positives only; forms unused here. | — |
| 5 | Act on | Reproduced: disabling ref-def branch (line 23) or root-abs branch (line 47) → tests stay green. Implemented behaviour no test can catch. | add cases to tests/fixtures/links-broken |
| 6 | Consider | Excludes guarded: dropping them → `make lint` red (22 broken) in CI. Lint stops at first check: real nit. | — |
| 7 | Dismissed | #28 AC requires all three files to state make lint/test and one issue→branch→PR; duplication is mandated. Negations = style (§4). | — |
| 8a | Act on | docs/DEVELOPMENT.md:92 "Types in use: `docs`, `research`" + format `type: subject`; adjacent line edited in this diff, and the PR itself is `chore(repo):`. AC: DEVELOPMENT.md describes a build repo. | rewrite line 92 |
| 8b | Noted | GLOSSARY.md:81 not in diff and not in #28's named files; "plan, don't do" there describes track 1 historically. Follow-up: glossary sweep. | — |
| S1 | Dismissed | size 199/200 fixtures are the planted fixtures AC asks for; `help` target trivial. | — |
| S2 | Consider | open-items Track 2 rows "checked 2026-10-26" (#807, #783, #642, #814) unverifiable from this repo; operator confirms. | — |
| S3 | Noted | `.claude/` untracked, no `.gitignore`; no #28 criterion. Follow-up issue. | — |

## Fix list for the writer

1. **#2 silent skip.** Red first: add `tests/fixtures/links-nonascii/café.md` containing `[b](nope.md)`; in tests/check-links.test.sh `expect_fail "non-ASCII file is checked" "nope.md" ... links-nonascii` (fails today: rc=0). Fix: scripts/check-links.sh:32 → `git -c core.quotePath=false -C "$root" ls-files -- ...`.
2. **#5 untested branches.** Red first (prove with the two mutations): add to tests/fixtures/links-broken/README.md `[r]: docs/ref-missing.md` and `[a](/docs/abs-missing.md)`; add two `expect_fail` lines matching `ref-missing.md` and `abs-missing.md`. Add passing `[r]: docs/guide.md` and `[a](/docs/guide.md)` to links-ok. No script change.
3. **#8a stale commit rule.** docs/DEVELOPMENT.md:92 → `Subject: \`type(area): subject\`, lower case, no period. Types in use: \`docs\`, \`research\`, \`chore\`, \`fix\`, \`feat\`.` Doc only.
