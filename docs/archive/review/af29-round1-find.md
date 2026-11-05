Reviewed c9f402a..4365c14 · patch-id f6861555 (stable) · round 1

## Intent
PR #29 closes #28: turn the repo from a planning repo into a build repo. Instructions (AGENTS/README/DEVELOPMENT/open-items) say so; `make lint` (link + root AGENTS.md size) and `make test` (tests/*.test.sh on planted fixtures) exist; one GitHub workflow runs both, actions SHA-pinned, Dependabot on. Ran: `make lint`, `make test` pass at 4365c14; CI `lint-and-test` passes.

## Standards

### 1. [warning] Case-insensitive FS hides broken links locally        Standards
Location   scripts/check-links.sh:51 (`[ ! -e "$resolved" ]`)
Rule       Correctness (every case); DEVELOPMENT.md:0 step 5 "bash 3.2 (stock macOS) and Ubuntu"
Finding    Link case is not checked; macOS passes what Ubuntu CI fails.
Evidence   Scratch repo with `sub/x.md`; `[c](Sub/X.md)` → exit 0 on Darwin. Same input fails on Linux, so `make lint` green locally, red in CI.
Suggestion Compare against `git ls-files` output instead of `-e`.

### 2. [warning] Non-ASCII tracked file is skipped silently, exit 0        Standards
Location   scripts/check-links.sh:35 (`git ls-files` without `-z`/`core.quotePath=false`)
Rule       Correctness, error paths: swallowed error
Finding    git quotes such names; awk cannot open them; `set -e` does not see failures inside `$(links ...)`.
Evidence   `café.md` containing `[b](nope.md)` → stderr `awk: can't open file ./"caf\303\251.md"`, no broken-link line, `rc=0`. Links in that file are never checked.
Suggestion `git -c core.quotePath=false ls-files`, or fail when awk fails.

### 3. [warning] Fence tracking ignores fence char and length        Standards
Location   scripts/check-links.sh:14
Finding    Any ``` or ~~~ line toggles. A ```` block containing ``` , or ~~~ containing ``` , flips state; code is then linted as prose.
Evidence   a `~~~` fence holding a ``` line and then a link to `sub/nestfence.md` → "broken link ... sub/nestfence.md"; ```` ```` ```` block with inner ``` → "sub/four.md" flagged. Docs that show markdown examples will fail lint spuriously. Indented code blocks flagged too (`    [x](sub/indented.md)`).
Suggestion Remember opener char+length; close only on same char, >= length.

### 4. [warning] Link-target parsing mis-handles valid forms        Standards
Location   scripts/check-links.sh:20, 41-45
Evidence   All against files that exist:
 - `[a](<my dir/a b.md>)` → "broken link: my" (space cut after `<>` strip, line 43). False positive.
 - `[a](sub/a_(1).md)` → target cut at first `)`. False positive/negative.
 - `[i](![x](sub/y.png))`, `MAILTO:a@b.c`, `ftp://x/y`, `HTTP://x`, `tel:` → flagged broken (case-sensitive, only 3 schemes whitelisted at line 39).
 - `[t](x.md "Title")` works.
Suggestion Skip any `^[A-Za-z][A-Za-z0-9+.-]*:` scheme; document the unsupported forms or handle them.

### 5. [warning] Tests do not cover reference-style or root-absolute links        Standards
Location   tests/fixtures/links-ok/README.md; scripts/check-links.sh:25-29, 47
Rule       Tests: "would they fail if the behaviour broke?"
Finding    Two implemented branches can break unnoticed.
Evidence   Mutated copy: disabled the `[ref]: path` branch → `bash tests/check-links.test.sh` rc=0. Replaced root-absolute resolution (`/*)`) with a bogus path → rc=0. Mutations of fence, inline code, anchor, scheme skip, and size `>=`→`>` all failed the tests (good).
Suggestion Add a broken `[r]: x.md` case and a `/docs/guide.md` case to the fixtures.

### 6. [nit] Exclusions and `lint` ordering untested / opaque        Standards
Location   Makefile:7-8; scripts/check-links.sh:35; tests/lib.sh:8-12
Finding    fixture_repo makes the fixture the repo root, so the `tests/fixtures/` and `drafts/agent-platform/` excludes never run in `make test`. `make lint` stops at the first failing check, hiding the size result.
Evidence   Delete the excludes: `make test` stays green; only `make lint` on the real repo goes red.

### 7. [nit] Instruction duplicated in three agent-facing files; negations        Standards
Location   AGENTS.md:7-11; README.md (Build and test); docs/DEVELOPMENT.md:0 Build
Rule       writing-for-agents: single source of truth; positive phrasing
Finding    "make lint/make test", "one issue → one branch → one PR", "operator approves every commit and push" appear in AGENTS.md and DEVELOPMENT.md (and README). `make help` already lists targets (environment is source of truth). "Use no test framework", "no GNU-only flags" are negations.
Suggestion AGENTS.md keeps pointer + the two non-discoverable rules.

### 8. [nit] Stale statements left behind        Standards
Location   docs/DEVELOPMENT.md:92 ("Types in use: `docs`, `research`"); GLOSSARY.md:81 ("design work (plan, don't do)")
Finding    This PR is itself `chore(...)`, and the repo now builds; both lines contradict that. GLOSSARY.md is not in the diff but the diff makes it false.

## Spec
- Instructions: AGENTS.md:6-10 (scripts/, make lint/test, one issue→branch→PR), README.md "Build and test", docs/DEVELOPMENT.md:5-21 · met
- open-items shows map #1 closed + build tickets: docs/open-items.md:3,9,13-18 · met
- `make lint`/`make test` exist, CI same: Makefile:6-11, .github/workflows/ci.yml:16-17 · met
- lint fails on broken link and oversize, each a planted fixture run by a test: scripts/check-links.sh:51-54, scripts/check-size.sh:11-14; tests/check-links.test.sh:4, tests/check-size.test.sh:4 · met
- `make test` runs every tests/*.test.sh, fails if any fails: Makefile:11 · met (verified: one failing script → exit 1 by `status=1`)
- Workflow on PR and push to main: ci.yml:3-6 · met
- Actions pinned + Dependabot: ci.yml:15 (SHA 3d3c42e5 resolves to a commit in actions/checkout), .github/dependabot.yml · met
- Unrequested: size-ok/size-over duplicate 199/200-line fixtures (could be generated); `help` target; open-items Track 2 MR rows (#807, #783, #642, #814) updated "checked 2026-10-26", which cannot be verified from this repo; open-items scope bullet "Closed" table rows #23/#25-#27 outside the two criteria text but implied by "map #1 closed".
- Docs vs repo: all named paths exist (docs/playbooks/coordinator.md, docs/setup/identity.md, ADR-0003:14, ADR-0009). No false command found.
- `.claude/`: untracked in main checkout, no `.gitignore` exists. Out of scope for #28 (no criterion); recommend a follow-up issue, not a fix here.
- Design/principles: none named.

## Receipts
drafts/agent-platform/code-review/SKILL.md; diff c9f402a..4365c14 (all 17 files); issue #28; PR #29; ADR-0003, ADR-0009 (main); writing-for-agents skill; docs/playbooks/coordinator.md, docs/setup/identity.md, GLOSSARY.md (listing); scratch runs in /private/tmp/claude-501/review-af29/{t,mut}.
