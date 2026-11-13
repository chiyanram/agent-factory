# fix(post): break _www. links and GH-12 references; read trailers after any blank lines (#463) (#464)

Closes #463.

The reviewer eval pass of 2026-11-11 raised 4 Act on findings on two clean cases. All of them hold on `main`, which makes 3 distinct bugs:

| Bug | Fix |
|---|---|
| `cleanField`'s `\b(www)\.` missed `www.` after `_`, which GFM still autolinks | break every `www.` |
| `GH-12`, GitHub's other reference form, was posted live (`Fixes GH-12` closes an issue) | a joiner after the hyphen of `GH-` before a digit |
| `trailerBlock` split on one blank line, so two blank lines before `Agent:` made an agent commit a person's | split on one or more blank lines |

The test's own `LINK` pattern had the same `\b` blind spot; it now matches every `www.`. The safety explanation page names the two new breaks.

## Checks

- The 3 new test cases fail on `main` (I ran them with the `src` changes reverted) and pass with the fix.
- `make lint` and `make test` pass (1341 passed, 11 skipped).

## Follow-ups

- Move `clean-posting-template` and `clean-notes-login-and-seat` to seeded cases with these bugs as expected findings (needs the operator's yes on `cases.md`).
- #385: the worst-case cap check forced a $0.30 per-run cap, and 2 verify passes failed on `error_max_budget_usd`.
