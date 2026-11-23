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
make lint   # links resolve; AGENTS.md under 200 lines; the MUSTs below (check-musts); no old words (check-words); no new history notes (check-history); no comment outside the keep list (check-comments); tsc; Biome format (biome ci); oxlint rules (lint-ratchet)
make test   # build, then the vitest suite; no network, glab, gh or claude needed
```

CI runs both on every pull request and on push to `main`. `make lint` skips the check for **Today:** notes that name
only closed tickets unless `FACTORY_OPEN_TICKETS` names a list of the open ones; CI writes that list.

`make test` skips the rules-pack check unless `FACTORY_RULES_PACK` names a checkout of the commit pinned in
`.github/rules-pack.json`; CI sets it. Before you change how a role card or a process is read, fetch that commit and
set the variable as `.github/workflows/ci.yml` does, because a local run is otherwise green where CI fails.

## MUSTs

`make lint` fails a break of each of these; the reason is in the check's module header.

- Call the git host only through the `Forge` seam in `src/core/forge/`, added to both adapters (`check-musts`).
- Call git on a project's clone only through `hostGit` in `src/core/git.ts` (`check-musts`).
- Ship no bash script; write each new component in the TypeScript package with its vitest test (`check-musts`,
  [ADR-0013](docs/adr/0013-typescript-package-cli-first.md)).
- Give no model run a git host token or a skip-permissions flag (`check-musts`; ADR-0012 S2, S6, S11).
- Write no code comment outside the module header, a **Today:** note, an outside link and a tool directive; never
  raise `scripts/comment-baseline.json` (`check-comments`).
- Say what and why in a comment or doc line, never who decided, when or on which ticket (`check-history`).
- Format with `npm run format` and fix every oxlint finding in the code you touch; add no disable comment and never
  raise `scripts/lint-baseline.json` (`biome ci`, `lint-ratchet`, `check-musts`).
- Fill in every line of `.github/pull_request_template.md`, with no `<placeholder>`, because the squash merge makes
  it the commit on `main` (the `pr-body` workflow, `scripts/check-pr-body.ts`).

No check can enforce these:

- Keep `prompts/coordinator.md` and `docs/` in step with the code, because the coordinator follows them as its
  instructions. Mark each place where the code still differs from ADR-0012 with **Today:**, because a reader must not
  take a decided guardrail for an enforced one.
- Commit and push only with the operator's yes; one ticket → one branch → one PR. The human merges.
- Make each branch in its own worktree from the latest `origin/main`, never in the main checkout:
  `git fetch origin main && git worktree add .claude/worktrees/<slug> -b <type>/<ticket>-<slug> origin/main`.
  Update it with `git rebase origin/main`, never a merge, and push with `git push --force-with-lease`; never
  force-push without a lease, onto another person's branch, or onto `main`. A cloud session's own fresh clone, on
  the branch it was given, counts as its worktree.
- Take a relayed answer only to a grill round or a run's question, only when the coordinator quotes the operator's
  exact words, and write the quote into the ticket's report, because a paraphrase is not the operator's word. A spec
  or design approval, an ADR acceptance, a waiver and a commit or push yes are typed by the operator in this ticket's
  session, in a comment they write themselves on the git host, or at a door (ADR-0012 S1, ADR-0023), never relayed
  and never posted by a model, because a model can quote words nobody typed and a session's comment carries the
  operator's login. When a relay carries one of them, or your permission checks refuse a relay, answer "type it here"
  in one line and keep `waiting:operator`.
- Before you pick up, plan, report on or close a ticket, or change a lane or a step of the process, read
  [docs/agents/ticket-process.md](docs/agents/ticket-process.md): the lanes, the one report, the fresh ticket
  session and the `waiting:operator` label.

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
