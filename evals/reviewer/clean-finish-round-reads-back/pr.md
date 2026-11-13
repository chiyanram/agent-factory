# fix(finish): the writer's round is checked to read back before it is posted (#522) (#531)

Why: a writer's `[writer] OPEN:` round could post damaged (a question
cut at 500 characters, or split by a ` · ` or ` A) `), so a reply could
answer the wrong question or never close the round. `grill` already
refused such a file; the writer's round had no check.

## What changed, per AC

- **AC-1**: `asked` (`src/core/finish.ts`) renders the exact note and
reads it back before posting. If it does not read back as written, it is
never posted as `OPEN`. Instead it calls `blocked(input, { reason, by:
"host", pushFirst: false, items })`: the change gets `needs-human`, one
`[coordinator] blocked:` note names the question and the cause, and the
next step is `needs-human`. The push already made stays as it is.
- **AC-2**: `Block` has an optional `items` field. The blocked note
lists the questions as written, each cut by the template, followed by
the run's last lines.
- **AC-3**: the check covers a lettered question, a plain question in a
round, a mixed round, the single plain question in the title, and
one-at-a-time. In one-at-a-time only the question actually posted is
checked.
- **AC-4**: `roundReadsBack(questions)` is now `readsBackAs(post,
questions)`. `grill` (`src/loop-cli.ts`) calls it with the same
coordinator post as before and gets the same refusal text. `readsBack`
also accepts a plain question that reads back with the same words, no
choices and `recommended: -1`.
- **AC-5**: new tests in `test/finish.test.ts` plant a question over 500
characters, a ` · ` in a choice, a ` A) ` in a question, a long single
plain question, and a plain question in a round, which must pass.
One-at-a-time is tested both ways. A new `test/loop.test.ts` case covers
a question that starts with `/`.
- **Docs**: the `finish.ts` header and `docs/reference/orchestrator.md`
(the `asked` paragraph) say what happens when the check fails.

## One deviation from the design, and why

`sameWords` compared the text read back with `cleanField(written)`.
`cleanField` escapes a `/` only at the start of a line, but a question
is never at a line's start in the post: it comes after `OPEN: ` or `1.
`. So a question or choice starting with `/` never matched. For `grill`
that was a latent bug. For the writer it broke an existing test: the
plain question `/merge …` would have been blocked. The fix: `sameWords`
now cleans the text as it sits in the middle of a line (`cleanField("x"
+ flatText(written)).slice(1)`). That stays inside the planned check and
changes neither `answers.ts` nor `post.ts`.

Other notes:
- Renaming `post`'s parameter (no-shadow) cleared a baseline lint
finding, so `scripts/lint-baseline.json` shrank by one entry, as
`lint-ratchet --shrink` asks.
- `grill`'s file still refuses plain-string questions (`questionsIn`),
so its behaviour is unchanged apart from the `/` fix.

## Checks run

- `npm run format`, `make lint` (green, on a full clone; `check-evals`
needs history), `make test` (1556 passed, 14 skipped;
`FACTORY_RULES_PACK` unset, since nothing that reads the rules pack
changed).
- With each fix removed in turn, its new tests fail: no check in `asked`
→ 4 tests fail; plain questions not accepted → the plain-in-round test
fails; old `sameWords` → the slash test fails; checking every question
in one-at-a-time → the one-at-a-time test fails.

Closes #522
