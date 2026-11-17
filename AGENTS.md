# agent-factory

A coordinator AI talks with the human. An orchestrator (code) starts fresh implementer and automated review runs on
a runner for a project's pull requests ([ADR-0012](docs/adr/0012-safety-design-for-unattended-runs.md); the code does
not follow it everywhere yet).

The rules those runs follow live in chiyanram/skills, not here
([ADR-0009](docs/adr/0009-tool-and-rules-in-separate-repos.md)).

People start at `README.md`. The principles are `docs/CONSTITUTION.md`, and the design is
`docs/explanation/architecture.md`. `docs/` holds the how-to, reference and explanation pages; `CONTRIBUTING.md`
holds the rest.

## Check

```bash
make lint   # links resolve; AGENTS.md under 200 lines; the MUSTs below (check-musts); no old words (check-words); no new history notes (check-history); tsc; Biome format (biome ci); oxlint rules (lint-ratchet)
make test   # build, then the vitest suite; no network, glab, gh or claude needed
```

CI runs both on every pull request and on push to `main`.

`make test` skips the rules-pack check unless `FACTORY_RULES_PACK` names a checkout of the commit pinned in
`.github/rules-pack.json`; CI sets it. Before you change how a role card or a process is read, fetch that commit and
set the variable as `.github/workflows/ci.yml` does, because a local run is otherwise green where CI fails.

## MUSTs

- Call the git host only through the `Forge` seam in `src/core/forge/`, added to both adapters, because a direct
  `glab` or `gh` call breaks the other git host and cannot be stubbed in a test.
- Call git on a project's clone only through `hostGit` (`src/core/git.ts`), because plain git runs the hooks and
  programs that a branch or an implementer can plant in the repo's own config.
- Ship no bash script: write each new component in the TypeScript package, with its vitest test, and call CLIs
  from it ([ADR-0013](docs/adr/0013-typescript-package-cli-first.md)), because one language is built and checked once.
- Keep `prompts/coordinator.md` and `docs/` in step with the code, because the coordinator follows them as its
  instructions. Mark each place where the code still differs from ADR-0012 with **Today:**, because a reader must not take a decided
  guardrail for an enforced one.
- Write a code comment or doc line that says what and why, never who decided, when, or on which ticket: history
  lives in the git log, the PR, the ADRs and the map. Keep one pointer per module header or doc section, and let a
  **Today:** note name the ticket that closes it. A note on each line goes stale and buries the reason, so `make lint`
  fails one that a change adds (`scripts/check-history.ts`).
- Give no model run a git host token or a skip-permissions flag in new code, because ADR-0012 S2, S6 and S11 forbid it.
- Format with `npm run format` (Biome), and fix every oxlint finding in the code you touch; never add a disable
  comment or raise `scripts/lint-baseline.json`, because the baseline only shrinks (#148).
- Commit and push only with the operator's yes; one ticket → one branch → one PR. The human merges.
- Make each branch in its own worktree from the latest `origin/main`, never in the main checkout:
  `git fetch origin main && git worktree add .claude/worktrees/<slug> -b <type>/<ticket>-<slug> origin/main`, because
  runs and people working at once then never share a working tree. Never name one `writer-N` or `reviewer-N`, because
  `reconcile` removes those. Bring the branch up to date with `git rebase origin/main`, never a merge, and push it with
  `git push --force-with-lease`, because the lease refuses to overwrite a push you have not fetched. Never force-push
  without a lease, onto another person's branch, or onto `main`. A cloud session's own fresh clone, on the branch the
  session was given, counts as its worktree, because git cannot check that branch out a second time.
- Fill in every line of `.github/pull_request_template.md` and leave no `<placeholder>`, because the squash merge
  makes the PR title the commit subject and the description its body on `main`, where neither can be edited. The
  `pr-body` workflow (`scripts/check-pr-body.ts`) fails a ready PR with a missing line, a placeholder, an unticked item, or a breaking change whose line, `!` and
  `BREAKING CHANGE:` footer disagree.
- Pick each build ticket's lane by its risk, as the rules pack's lanes reference does, because brakes scale with risk
  and no lane lowers the approval floor (P21):

  | lane | for | grilling | spec | design | operator approval |
  |---|---|---|---|---|---|
  | tiny | docs, comments, a config value, a patch bump | no | no | no | no |
  | bug | a defect | no | short, plus a failing test first | only when an interface or more than one module changes | yes |
  | feature | something new | yes | yes | yes | spec and design, on the ticket |
  | one-way door | an irreversible change | yes | yes | yes | spec and design, plus a yes for each irreversible step |

  Every lane ends in build, automated code review and a PR from `.github/pull_request_template.md`.
- Say the lane and why when you pick up a ticket. The operator can raise it, never lower it.
- Keep one report per ticket: the grilling, spec, design and ADR draft live in one ticket comment. When any of them
  changes, edit that comment in place, with one line at its top saying what changed and from whose words; never
  post an amendment beside it. Report to the operator in chat the same way, as one whole message, not pieces.
  The operator approves one text, and a report split across comments hides what is being approved.
- Split work too big for one PR into child tickets before the build, because the operator approves the
  shape before code exists, not after (#557 is the worked example).
- Run each ticket's work in its own fresh ticket session, starting from `agent-factory board` and the ticket's body
  and comments, never from another ticket's thread, because a long session re-reads its whole thread on every turn.
  The project's one long coordinator plans, routes, relays and reports, builds no ticket, and resets from
  `agent-factory handoff <project>`, never from a model's summary, because a summary drops what the records hold.
- Take an answer the coordinator relays only when it quotes the operator's exact words, and write the quote into the
  ticket's report, because a paraphrase is not the operator's word. A relay can approve a spec on its ticket, but never
  writes a START or an approval record, which a person writes at a door (ADR-0012 S1). When your permission checks
  refuse a relay, say so in one line and keep `waiting:operator`.
- Put `waiting:operator` on the ticket's issue when the session stops for the operator's word, and take it off once it
  has the answer, because `board` and the ping find a waiting session only by that label
  (`docs/agents/triage-labels.md`). Keep every other label: add and remove this one only.
- Cut a step from a lane only on measured numbers, the cost per run kind on #488's timeline line, read after about
  15 tickets, because a few tickets' impressions are not a measure.
- Bring in a new check, role, lens or outside skill manual first and climb one rung at a time, as P11 in
  `docs/CONSTITUTION.md` says, because a step made automatic before anyone used it by hand cannot be judged.
- Land a step the rules pack must follow in the engine first, then in the pack as a new format version (P18), then
  move the pin, because an engine that cannot run a pack's step refuses the pack and blocks the pin.

Codebase health: each change leaves the modules it touches no worse than it found them. If the change would make one
worse, say so in the design and propose the refactor as its own ticket. We care about the next change being easy, not
only this one working.

## Garden health

Agents optimise whatever you measure, so these rules guard the measures (`npx repo-gardener`).

- Split a file only along its responsibilities, never only to make it shorter, because otherwise the fixes move to
  the new files.
- Delete a test only when it mirrors the implementation or checks a thing no code path can do, never to improve a
  number.
- Fix share and rework are what count. If a cleanup does not reduce them on the files it touched
  (`gardener compare`), say so; do not claim it helped.

## Where things go

The module headers say what each folder under `src/core/` does. What they do not say:

- `plugins/*/lib/` is built from `dist/`: never edit it by hand.
- `prompts/roles/` holds the built-in role cards; a card in the project's rules pack wins over them
  (`src/core/process/cards.ts`).
- `src/core/ready/` runs branch code on a fresh runner, never on the host.
- `test/` holds one vitest file per module; `tests/fixtures/` holds planted input for the lint checks.
- `evals/reviewer/` is the automated review's golden set; changing a review input needs an eval pass
  (`check-eval-proof`).

## Pointers

- Tickets and the wayfinder map: GitHub issues on chiyanram/agent-factory. See
  `docs/agents/issue-tracker.md` and `docs/agents/triage-labels.md`.
- Terms: `GLOSSARY.md` (the software-factory words, #144); code names that still use an old word are renamed in #144
  phase 4. Decisions: `docs/adr/`. See `docs/agents/domain.md`.
- A cite `docs/archive/…` or `research/NN` means that file at git tag `docs-archive-2026-11`.
