# 44 — How the references set up their own repos (2026-10-25)

Method. I ran `git fetch -q` on each clone under
`agent-platform/.claude/worktrees/crq-597-b837e3/.scratch/one-rulebook/refs/` and read every file with
`git show origin/HEAD:<path>`. I did not change any checkout. The SHAs I read: mattpocock-skills `5beb35b`,
cursor-plugins `99b609a`, addyosmani-agent-skills `aeac41d`, humanlayer-skills `653b641`, rameezk-forge
`397eafa`, kunchenguid-firstmate `3c1e468`, Jeffallan-claude-skills `9e7dbd6`, jabrena-plinth `a46375a`.
The openclaw-openclaw fetch did not finish (index-pack of about 2M objects was still running after 10 min), so I
read its local HEAD `b94e5177`. Seven clones are shallow (`git rev-parse --is-shallow-repository` = true). Only
jabrena-plinth has full history. In the shallow clones, history before the graft is absent, so section 8 for those
repos covers only what the graft holds. A citation reads `<repo>/<path>:<line>@<sha>`. "Absent" lists the paths I
checked. rameezk-forge is a consumer of `rameezk/skills`, not the skills repo itself. `rameezk/skills` is not cloned
here, so its own foundation is unknown.

---

## 1 · mattpocock-skills (`5beb35b`)

**1. CI.** Three workflows. None runs on a pull request.

| file | trigger | job | runs |
|---|---|---|---|
| `release.yml` | push to `main` | `Version` | `changesets/action@v1`: `npm run version`, publish `npx changeset tag` (mattpocock-skills/.github/workflows/release.yml:3-33@5beb35b) |
| `triage-label.yml` | issue opened | `label` | `gh issue edit --add-label needs-triage` (…/triage-label.yml:6-19@5beb35b) |
| `needs-info.yml` | cron `30 1 * * *` | `close` | `actions/stale@v10`, closes `needs-info` issues after 14 days (…/needs-info.yml:8-27@5beb35b) |

Required checks: not visible in the repo.

**2. Lint/format.** Absent — checked the full tree for `.markdownlint*`, `.prettier*`, `.shellcheckrc`, `.editorconfig`,
lint scripts in `package.json`. The only prose rule is "No em-dashes anywhere in this repo's prose"
(mattpocock-skills/CLAUDE.md:25@5beb35b). Nothing checks it.

**3. Tests.** Absent — checked for `test/`, `tests/`, `evals/`, `*.test.*`. The one match, `skills/engineering/tdd/tests.md`,
is skill content.

**4. Validation.** Partial and manual. CLAUDE.md tells the agent to "Run `claude plugin validate . --strict` after touching
either manifest" (mattpocock-skills/CLAUDE.md:11@5beb35b). `scripts/sync-plugin-version.mjs --check` reports drift
between `package.json` and `.claude-plugin/plugin.json` (…/scripts/sync-plugin-version.mjs:22-27@5beb35b), exposed as
`npm run check-plugin-version` (…/package.json:14@5beb35b). No workflow calls either one. No frontmatter or link check.

**5. Agent instructions.** `AGENTS.md` is a symlink (mode `120000`) to `CLAUDE.md`. CLAUDE.md is a list of repo invariants:
the bucket layout, every promoted skill in README and in `plugin.json`'s `skills` array (…/CLAUDE.md:9@5beb35b), a docs
page per promoted skill (…:17), the `ask-matt` router kept current (…:21), and `scripts/link-skills.sh` for local
install (…:23). `CONTRIBUTING.md` is absent, although `needs-info.yml:37` links to it.

**6. Hygiene.** Issue forms `bug.yml`, `idea.yml`, blank issues off, questions sent to Discussions
(…/.github/ISSUE_TEMPLATE/config.yml:1-5@5beb35b). PR template, CODEOWNERS, commitlint: absent. Commits are free-form
(`Add issue triage workflows`). Release: changesets with `@changesets/changelog-github`, tags on
(`privatePackages.tag: true`, …/.changeset/config.json:8@5beb35b), one `CHANGELOG.md`. `npm run version` runs
`changeset version` then copies the version into `plugin.json` (…/package.json:13@5beb35b). ADR 0002 makes the
plugin version track `package.json` (…/.agents/adr/0002-ship-as-a-claude-code-plugin.md:28@5beb35b).

**7. Front door.** `package.json` scripts: `changeset`, `version`, `check-plugin-version`. Two shell helpers:
`scripts/link-skills.sh`, `scripts/list-skills.sh`. No Makefile.

**8. History and why.**
- 2026-06-17 `a032401` "set up changesets": a version PR on push to main, "no npm publish".
- 2026-06-17 `bddb833`: add `publish: npx changeset tag` "so merging a Version PR creates a git tag and GitHub release".
- 2026-08-05 `f3554ac`: sync the plugin version on release, because "`plugin.json` was manually bumped to 1.2.1 while
  `package.json` stayed at 1.2.0".
- 2026-10-05 `423ed08`: issue triage workflows. 2026-10-06 `f0588cd`: `SCOPE.md`, issue forms, `.out-of-scope/` records.

---

## 2 · cursor-plugins, with pstack inside (`99b609a`)

**1. CI.** One workflow, `validate-plugins.yml`, on `pull_request` filtered to manifests, `schemas/**`, `pstack/**`,
`harness/**`, `scripts/**` (cursor-plugins/.github/workflows/validate-plugins.yml:3-13@99b609a). Job `validate`:

| step | runs |
|---|---|
| Validate plugin definitions | `node scripts/validate-plugins.mjs` (…:28-29) |
| Check generated pstack harness trees | `node scripts/generate-pstack-harness-trees.mjs --check` (…:31-32) |
| Test pstack skill scripts | `node --test pstack/skills/*/scripts/test/*.test.mjs` (…:34-35) |

No push trigger. Required checks: not visible.

**2. Lint/format.** Absent — checked for markdownlint, prettier, eslint, shellcheck configs at the root. `.gitattributes`
marks `harness/pstack/**` as `linguist-generated=true`.

**3. Tests.** `node --test` over pstack skill scripts in CI. Other plugins carry their own tests
(`orchestrate/skills/orchestrate/scripts/__tests__/*.test.ts`, `harness/pstack/claude-code/skills/poteto-mode/scripts/*.test.ts`),
but the workflow glob runs only `pstack/skills/*/scripts/test/*.test.mjs`. Evals: absent.

**4. Validation.**
- `validate-plugins.mjs` checks `.cursor-plugin/marketplace.json` and each `plugin.json` against JSON Schemas with Ajv
  (cursor-plugins/scripts/validate-plugins.mjs:16-49@99b609a), that a source directory exists (…:57-62), that the
  marketplace name equals the plugin name (…:88-92), the same for the Claude marketplace (…:100-117), and that all
  manifest versions of one plugin agree (…:119-145). The plugin name pattern is kebab-case
  (cursor-plugins/schemas/plugin.schema.json:13@99b609a).
- The harness generator fails when a pstack `SKILL.md` frontmatter `name` differs from its folder, or the folder is not
  kebab-case or longer than 64 characters (cursor-plugins/scripts/generate-pstack-harness-trees.mjs:93-97@99b609a).
- `scripts/check-pstack-docs.mjs` checks README and guide against the tree: slash commands, relative links and anchors,
  counts, model names (…/scripts/check-pstack-docs.mjs:3-5@99b609a). No workflow or doc calls it (`git grep
  check-pstack-docs` outside `scripts/` returns nothing).

**5. Agent instructions.** Root `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`: absent. The pstack README tells a contributor
to regenerate the harness tree, and "ci fails while the generated copy is out of date" (cursor-plugins/pstack/README.md:32@99b609a).

**6. Hygiene.** PR template, issue templates, CODEOWNERS, commitlint: absent. Commits are mixed (`feat(third_party): …`,
`Add PitchBook …`). Per-plugin `CHANGELOG.md` in some plugins. pstack version is a hand-set field
(cursor-plugins/pstack/plugin.json:4@99b609a), kept equal across manifests by the validator.

**7. Front door.** None. Plain `node scripts/*.mjs`.

**8. History and why.**
- 2026-10-16 `182f2ce` (#637): Claude Code install from a generated tree, plus "check Claude Code marketplace entries and
  manifest version sync". **Removed:** the CI step for `claude plugin validate`: "#629 also reverted it in 6bcc06b, so the
  comment that says CI runs `claude plugin validate` is dropped too". `6bcc06b` is outside the shallow graft, so its own
  reason is unknown.
- 2026-10-17 `a968159` (#702): "name every skill after its folder".
- 2026-10-17 `019a6a2` (#704): add `check-pstack-docs.mjs`; one fix says a link pattern "never checked" titled links,
  "and a broken one passed".

---

## 3 · addyosmani-agent-skills (`aeac41d`)

**1. CI.** One workflow, `test-plugin-install.yml`, on `push`, `pull_request`, `workflow_dispatch`
(addyosmani-agent-skills/.github/workflows/test-plugin-install.yml:3-6@aeac41d).

| job | runs |
|---|---|
| `Validate skill content` | `validate-skills.js`, `node --test` skill-lint, `validate-versions.js` + test, eval-runner test, `run-evals.js --min-rank1 95`, `validate-reference-links.js` + test, floor-guard test, `bash hooks/session-start-test.sh` (…:9-50) |
| `Validate command parity and description sync` | `validate-commands.js` + test, `validate-artifact-paths.js` + test (…:52-73) |
| `Validate tooling (macos-latest, windows-latest)` | all unit tests and validators again (…:76-120) |
| `Hook regression tests` | `bash hooks/sdd-cache-test.sh`, `bash hooks/simplify-ignore-test.sh` (…:122-132) |
| `Validate plugin structure` | `claude plugin validate .` (…:134-145) |
| `Test plugin installation` | `claude plugin marketplace add ./`, `claude plugin install agent-skills@addy-agent-skills` (…:147-167) |

A comment keeps Ubuntu "check names" stable (…:75), which suggests required checks; the ruleset is not visible.

**2. Lint/format.** No markdownlint, prettier or shellcheck — checked root and `.github/`. The custom skill linter is the
lint layer (below).

**3. Tests.** Every validator has a `*-test.js` run with `node --test`. Hooks have bash regression tests. Evals in three
tiers (addyosmani-agent-skills/evals/README.md:16-20@aeac41d): structural (CI), trigger and routing by TF-IDF over
descriptions (CI, `--min-rank1 95`), and behavioral through headless `claude` (on demand, spends tokens). `claude plugin
eval` cases live under `evals/plugin/` and "never in CI" (…/evals/README.md:49). One case file per skill is a CI error
when missing (…:99).

**4. Validation.** `scripts/lib/skill-lint.js` (addyosmani-agent-skills/scripts/lib/skill-lint.js:10-23@aeac41d): frontmatter
with `name` and `description`, `name` equals folder, kebab-case, description ≤ 1024 characters (…:31), a "Use when"
trigger, required sections, non-empty subdirectories; warnings for unknown cross-skill references and a 500-line budget
(…:37). It rejects top-level keys outside `name, description, license, compatibility, metadata, allowed-tools`
(…:45-52). `validate-versions.js` makes five manifests share one version
(addyosmani-agent-skills/scripts/validate-versions.js:7-30@aeac41d). Links: `validate-reference-links.js` checks
`references/` links and `#anchor` fragments.

**5. Agent instructions.** `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, and a path-scoped `.claude/rules/skills-contributing.md`.
Both root files say they configure agents "working on the … repository itself" (…/AGENTS.md:5, …/CLAUDE.md:5@aeac41d).
CONTRIBUTING.md is "the single source of truth for this workflow" (…/CLAUDE.md:39). Pre-flight: search the catalog, check
open PRs, check the rejection ledger, justify the gap (…/CONTRIBUTING.md:13-18). Each new skill needs an eval case file
(…:44). CLAUDE.md still says "`npm test` — Not applicable" (…/CLAUDE.md:43); commit `b7c1cb1` says this line "is left for later".

**6. Hygiene.** One issue form `skill-gap.yml`. PR template, CODEOWNERS, commitlint, CHANGELOG: absent. Commits look
conventional (`fix(validator): …`) but nothing enforces it. Release: manual manifest bump (`2686b62` "chore(release):
bump plugin manifests to 0.6.11") and git tags `0.6.9` … `0.6.13`.

**7. Front door.** None. `node scripts/*.js` direct. No `package.json` at the root.

**8. History and why.**
- 2026-09-02 `4b9395b`: wire hook tests into CI "so the coverage actually guards the hooks".
- 2026-09-15 `a598aab`: **removed** the plugin `SessionStart` hook (`hooks/hooks.json`). It "stacks a second router on the
  native one", "~3.5k wasted cache-creation tokens per session in #569".
- 2026-09-20 `95801ad`: run validators on macOS and Windows.
- 2026-09-21 `6fa76fa`: reject invalid YAML frontmatter. A Cursor parse failure "takes the rest of the chat's context with it".
- 2026-09-25 `0898b52`: reject non-spec top-level keys. "Nothing enforced it; a skill with model: at the top level passed CI."
- 2026-10-03 `b7c1cb1`: the onboarding doc listed three validators; "CI runs six validators … on three operating systems".

---

## 4 · humanlayer-skills (`653b641`)

**1. CI.** Absent — `.github/` does not exist.

**2. Lint/format.** Absent — checked the full tree (21 files outside skill bodies).

**3. Tests.** Three Bun scripts, not wired to anything (no `package.json`, no workflow; `git grep test-rpi` finds no caller):
- `scripts/test-rpi.ts` reads `plugins/rpi`, parses frontmatter with `Bun.YAML`, asserts `name` is `rpi`
  (humanlayer-skills/scripts/test-rpi.ts:27-29@653b641).
- `scripts/test-rpi-workflows.ts` builds git fixtures in a temp dir and runs live `codex exec` sessions against the skill
  (humanlayer-skills/scripts/test-rpi-workflows.ts:99@653b641). This is a live eval with no runner.
- `scripts/sync-rpi-references.ts --check` fails on host-specific `/rpi ` text in templates
  (…/scripts/sync-rpi-references.ts:7-20@653b641).

**4. Validation.** Only `test-rpi.ts` above, for one plugin. Manifest, link, size checks: absent.

**5. Agent instructions.** `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`: absent.

**6. Hygiene.** All absent. Commits are lower-case free text (`add visual-pr skill`). Versions are hand-set per plugin in
`marketplace.json` (humanlayer-skills/.claude-plugin/marketplace.json:16,76@653b641). Install is `npx skills add
humanlayer/skills --skill SKILLNAME` (…/README.md:8).

**7. Front door.** None.

**8. History and why.** 2026-10-06 `04ecf04` added "static checks and live Codex fixture tests". No CI or lint change in the window.

---

## 5 · rameezk-forge (`397eafa`)

Note: this is the operator platform that consumes `rameezk/skills`. Its skills are vendored into `.agents/skills/`
and pinned by `.agents/skills.lock` (rameezk-forge/.agents/skills.lock:1-2@397eafa).

**1. CI.** `ci.yml` on `pull_request` and push to `main` (rameezk-forge/.github/workflows/ci.yml:3-7@397eafa).

| job | runs |
|---|---|
| `changes` | `scripts/markdown-only.sh BASE HEAD` → output `markdown-only` (…:21-37) |
| `check-no-vm` | skipped when markdown-only; `nix develop --command … make check-no-vm` (…:39-66) |
| `vm-tests` / `vm-test` | list then build each NixOS VM test in a matrix (…:68-105) |
| `ci` | aggregate, `if: always()`, `jq` passes only when every job succeeded or was skipped for markdown-only (…:107-124) |

`sync-skills.yml`: daily cron, calls the reusable `rameezk/skills/.github/workflows/sync-skills.yml@main`
(…/sync-skills.yml:3-20@397eafa). README says the `ci` job "is the only check a ruleset on `main` needs to require"
(rameezk-forge/README.md:159@397eafa).

**2. Lint/format.** Absent — checked for shellcheck, shfmt, markdownlint, prettier, treefmt in the tree and in `flake.nix`
(the `checks` output at flake.nix:146 holds NixOS assertions, not lint).

**3. Tests.** Bash tests for repo scripts: `tests/markdown-only.sh` (git fixtures, `assert_decision`,
rameezk-forge/tests/markdown-only.sh:37-48@397eafa), `tests/failed-build-log.sh`, `tests/repo-generic.sh`,
`tests/template-scaffold.sh`, run by Make targets (rameezk-forge/Makefile:27-37@397eafa). TypeScript packages use
`node --test`. Skill evals: absent.

**4. Validation.** Skill frontmatter, manifest, link checks: absent.

**5. Agent instructions.** `AGENTS.md` is for agents working in the repo: "Never write code comments" (…/AGENTS.md:5),
"Never run the full `make check-no-vm` locally" (…:30), the scoped command per area (…:31-39), end the report with
"full suite: CI" (…:40-41), no em dash (…:52), no agent attribution (…:53-55). `CONTRIBUTING.md`: absent.

**6. Hygiene.** `CODEOWNERS` is `* @rameezk` (rameezk-forge/.github/CODEOWNERS:1@397eafa). Dependabot for
github-actions, weekly. PR template, issue templates, commitlint, CHANGELOG: absent. Commits are conventional
(`feat:`, `ci:`) with PR numbers; nothing enforces it. Actions pinned to SHAs (…/ci.yml:27).

**7. Front door.** `Makefile`: `check`, `check-no-vm`, `vm-tests`, `tofu-test`, `test-*` (…/Makefile:1-37).

**8. History and why.** Commit bodies are empty, so the reasons are in ADRs.
- 2026-10-04 `30c3d8b` (#262): full suite with VM tests in CI.
- 2026-10-05 `a340f09` (#276) → ADR-0042: agents leave VM tests to CI, behind the required `ci` check
  (rameezk-forge/docs/adr/0042-agents-leave-the-nixos-vm-tests-to-ci.md:17@397eafa).
- 2026-10-05 `65ff29e` (#286) → ADR-0043: markdown-only changes skip checks. The run "takes about 10 minutes, and it runs
  even for changes such as ADRs … or skills, which no check reads" (…/0043-…:9). A second stub workflow named `ci` was
  rejected as "fragile and confusing" (…/0043-…:12).
- 2026-10-13 `7c844e0` (#356) → ADR-0053: a symlink to markdown counts as markdown-only (…/0053-…:17).
- 2026-10-15 `f0e9ae0` (#444) → ADR-0064: scoped local pass, full suite in CI (…/0064-…:17).
- 2026-10-16 `5be860d` (#480): CODEOWNERS for every path. 2026-10-21 `b54a975` (#580): daily skill sync.

---

## 6 · kunchenguid-firstmate (`3c1e468`)

Note: a shell-script coordinator, the closest match to `agent-factory`'s coordinator scripts. `bin/` holds the scripts;
`tests/` holds 322 files.

**1. CI.** Three workflows.
- `ci.yml` on push and PR to `main` (kunchenguid-firstmate/.github/workflows/ci.yml:3-7@3c1e468). Jobs: `Lint 1`/`Lint 2`
  (pinned ShellCheck and actionlint, `bin/fm-lint.sh --partition`, …:38-83), `Test coverage guard`
  (`bin/fm-test-run.sh --check-coverage`, …:88-97), `Behavior portable parallel 1/2`, `Behavior portable serial 1..9`,
  `Behavior tests (Herdr)`, `Behavior timing aggregate`, `Stock macOS Bash snapshot compatibility` (runs tests under
  `/bin/bash` 3.2 and asserts exact `ok -` counts, …:425-517), `Repo invariants` (CLAUDE.md must be the exact
  `@AGENTS.md` pointer and `.claude/skills` must link to `../.agents/skills`, personal paths untracked, …:519-546).
  Per-PR concurrency cancels superseded runs (…:21-23).
- `no-mistakes-required.yml` on PR events: job `PR must be raised via no-mistakes` checks a signed attestation
  (…/no-mistakes-required.yml:22-33@3c1e468).
- `windows-herdr-spike.yml`: `workflow_dispatch` only, a measurement.

Required checks are named in CONTRIBUTING (kunchenguid-firstmate/CONTRIBUTING.md:47@3c1e468), set in the main ruleset,
"not activated by committing workflow YAML" (…:41).

**2. Lint/format.** ShellCheck at one exact pinned version with `--norc`, default severity, extended analysis
(kunchenguid-firstmate/bin/fm-lint.sh:4-16@3c1e468); full canonical set `bin/*.sh bin/backends/*.sh tests/*.sh` in CI,
changed files locally (…:25-36). actionlint for workflows through `bin/fm-lint-workflows.sh`, "so a malformed GitHub
workflow, including a self-broken ci.yml, fails locally" (…:19-21). Pinned installers verify sha256
(…/bin/fm-install-shellcheck.sh:69-74@3c1e468). `.shellcheckrc`, shfmt, markdownlint: absent.

**3. Tests.** Plain bash `tests/*.test.sh` plus a few `.py`/`.ts` tests, run through `bin/fm-test-run.sh` with lanes,
families and a coverage proof that the shards equal the inventory. The lint tool has its own tests
(`tests/fm-lint.test.sh`, `tests/fm-lint-workflows.test.sh`). Skill evals: absent.

**4. Validation.** Skill frontmatter and manifest checks: absent — `git grep frontmatter` in `tests/` and `bin/` returns
nothing. The repo-invariant job checks the CLAUDE.md pointer and the skills symlink.

**5. Agent instructions.** `AGENTS.md` (434 lines) is the product's operating identity ("Firstmate"), not contributor
guidance. `CLAUDE.md` is a two-line `@AGENTS.md` import (kunchenguid-firstmate/CLAUDE.md:1-2@3c1e468). `CONTRIBUTING.md`
is the contributor guide: PRs "must be raised through `no-mistakes`" (…/CONTRIBUTING.md:6), `bin/fm-lint.sh` "is the
single owner of the lint definition" (…:72), the pre-push command list (…:102-114). `.no-mistakes.yaml` pins the gate's
lint to the same owner: `lint: 'bin/fm-lint.sh && …'` (kunchenguid-firstmate/.no-mistakes.yaml:35-36@3c1e468).

**6. Hygiene.** PR template, issue templates, CODEOWNERS, commitlint, CHANGELOG, release workflow: absent. The no-mistakes
attestation takes the place of a PR template. AGENTS.md says "Never add an agent name as a commit co-author" (…/AGENTS.md:53).

**7. Front door.** `bin/fm-lint.sh` and `bin/fm-test-run.sh`. No Makefile, no `package.json` at the root.

**8. History and why.** Few commits in the graft.
- `ci.yml` comment: per-PR supersession because of "the September 12 Actions starvation report" (…/ci.yml:12-18).
- 2026-10-02 `d719ef3` (#6443): retry ShellCheck roots that hit the memory ceiling without `--external-sources`, with the
  retry bounded by the root's remaining deadline so it "can no longer outlast the CI job".
- 2026-10-14 `33503ab` (#7260): a fork can skip the push run and the macOS job by repository variable.

---

## 7 · Jeffallan-claude-skills (`9e7dbd6`)

**1. CI.** Four workflows.

| file | trigger | jobs |
|---|---|---|
| `ci.yml` | push/PR to `main`, `dev` | calls `validate.yml` (Jeffallan-claude-skills/.github/workflows/ci.yml:3-12@9e7dbd6) |
| `validate.yml` | `workflow_call` | `Validate Skills & Docs`: `validate-skills.py`, `validate-markdown.py --check`, `update-docs.py --check`, `test-build-plugin-dist.sh`; `Lint & Format Check`: `pre-commit/action`, prettier on `.astro` and on `*.md` (…/validate.yml:7-51) |
| `release.yml` | tag `v*` | validate, extract notes from CHANGELOG with `awk`, build docs site, GitHub Pages, `softprops/action-gh-release` (…/release.yml:3-90) |
| `publish-plugin.yml` | tag `v*` | rebuild the orphan `plugin` branch from `scripts/build-plugin-dist.sh` (…/publish-plugin.yml:3-69) |

**2. Lint/format.** pre-commit: ruff + ruff-format, prettier 3.5.3 for site/assets and for `*.md` (except `commands/`),
pyright on `scripts/*.py` (Jeffallan-claude-skills/.pre-commit-config.yaml:1-36@9e7dbd6). `.prettierrc`: single quotes,
trailing commas, width 120. `ruff.toml` selects `E W F I UP B SIM RUF`, ignores `E501`. `.editorconfig` sets LF, final
newline, trim whitespace except in Markdown. Shellcheck: absent.

**3. Tests.** `scripts/test-build-plugin-dist.sh` (CI) and `scripts/test-makefile.sh` (`make test`). Evals: absent.

**4. Validation.** `validate-skills.py`: YAML, required fields, name format, description ≤ 1024 characters
(Jeffallan-claude-skills/scripts/validate-skills.py:138,537-556@9e7dbd6), metadata enums, reference paths, section
order, a warning for SKILL.md outside 80–100 non-blank lines (…:199-200), and count consistency across `plugin.json`,
`marketplace.json`, README and others (…:210-217). `validate-markdown.py`: HTML comments in tables, unclosed fences,
table separators, column counts (…/validate-markdown.py:5-9). Plugin-schema check: absent.

**5. Agent instructions.** `CLAUDE.md` (355 lines): skill authorship standards, a contribution acceptance procedure
with a `docs(changelog): record #N …` commit (…/CLAUDE.md:171-182), a release checklist (…:193-345).
`CONTRIBUTING.md`: fork, branch, validate, and a pre-commit setup section (…/CONTRIBUTING.md:93-104).

**6. Hygiene.** Issue forms `claude-issue.yml`, `new-skill.yml`. Dependabot for github-actions. Actions pinned to SHAs.
PR template, CODEOWNERS, commitlint: absent. Commit convention: CONTRIBUTING shows `Add: …` (…:73) while recent commits
are conventional; nothing enforces either. Release: `version.json` holds version and counts; Keep a Changelog;
tag push builds the GitHub release from the CHANGELOG section and the `plugin` branch.

**7. Front door.** `Makefile`: `validate`, `test`, `lint`, `format`, `dev-link`, `dev-unlink`, `site-*`
(Jeffallan-claude-skills/Makefile:1-72@9e7dbd6).

**8. History and why.**
- 2026-10-03 `7558052`: publish from a CI-built `plugin` branch. The repo root "shipped as the plugin, including the docs
  site, scripts …", which the plugin directory "held for review (BINARIES_NOT_INSPECTED)".
- 2026-10-03 `970a5b2`: document the contribution acceptance procedure.
- 2026-10-15 `344e0b5`: pin actions to SHAs and add Dependabot. It "Raises the plugin-scanner lint score that the
  awesome-ai-plugins listing requires".
- 2026-08-07 `882ef55`: the README banner count "stayed at 66 skills through the v0.4.16 release"; `update-docs.py` now rewrites it.

---

## 8 · jabrena-plinth (`a46375a`, full history)

**1. CI.** Three workflows.
- `maven.yaml` on push to `main` and every PR (jabrena-plinth/.github/workflows/maven.yaml:3-7@a46375a). Jobs:
  `Detect Validation Scope` (Markdown changed? generated skills changed?, …:10-69), `Validate Markdown Files` (JBang
  `MarkdownValidator`, only if Markdown changed, …:71-89), `Validate Agent Skills with scanners` (only if generated skills
  changed, …:91-98), `Pre-commit` (all files, plus the HEAD commit message through `conventional-pre-commit`, …:100-117),
  `Package Commands, Agents, and Skills` (zip artifacts, …:119-149).
- `skill-scanners.yml` (`workflow_call`): `skill-check@latest` on generated skills, `cisco-ai-skill-scanner` with
  `--policy strict --fail-on-severity high`, NVIDIA SkillSpector report, Snyk Agent Scan, VirusTotal upload
  (jabrena-plinth/.github/workflows/skill-scanners.yml:14-273@a46375a).
- `examples-build.yaml` on push to `examples/**`: Maven builds with expected exit codes.

**2. Lint/format.** pre-commit: `check-yaml` and `conventional-pre-commit` with `--force-scope` and eleven types
(jabrena-plinth/.pre-commit-config.yaml:9-31@a46375a). Markdown through the JBang validator. Shellcheck, prettier: absent.

**3. Tests.** JUnit tests for the generators and for the Markdown validator
(`markdown-validator/src/test/java/…`, including `RemoteLinkValidatorTest`, `ArchitectureTest`). Skill acceptance:
Gherkin features plus a prompt list; run only the prompt for a changed skill, by hand (jabrena-plinth/AGENTS.md:134-140@a46375a).

**4. Validation.** Frontmatter and structure through `skill-check`. Security scanners as above. Links: the Markdown
validator checks remote links (`RemoteLinkValidator`, `PublicAddressPolicy`). Manifest validation: absent. The
marketplace says `"version": "0.14.0-SNAPSHOT"` (jabrena-plinth/.claude-plugin/marketplace.json:11@a46375a) while the
latest tag is `0.19.0`. Nothing checks the drift.

**5. Agent instructions.** `AGENTS.md` is a "Contributor Quickstart Guide" (…/AGENTS.md:1): tech stack, which folders are
WRITE and which are generated READ only (…:52-67), commands (…:69-130), Conventional Commits with a required scope
(…:150-170), "On-demand commits only" (…:152), Always/Never boundaries (…:200-204). Internal scripts must be Java with
JBang; "Do not add new Python or ad hoc shell scripts" (…:29). `CONTRIBUTING.md` points to AGENTS.md and says PRs "must be
opened by human contributors" (jabrena-plinth/CONTRIBUTING.md:22@a46375a). Also `DEVELOPER.md`, `CONTRIBUTORS.md`.

**6. Hygiene.** PR template with four headings: rationale, changes, tests, user-facing changes
(jabrena-plinth/.github/PULL_REQUEST_TEMPLATE.md:1-15@a46375a). `CODEOWNERS` `* @jabrena`. Dependabot daily for Maven
and actions. Actions pinned to SHAs. Conventional Commits enforced by hook and CI. Release: Keep a Changelog
(…/CHANGELOG.md:1-8), tags `0.16.0` … `0.19.0`, a blog post per release, `-P release` to refresh `skills/`
(ADR-006). No release workflow.

**7. Front door.** `./mvnw` (Maven wrapper) and `jbang`. No Makefile.

**8. History and why.**
- 2026-04-05 `2e4430a` (#609): add pre-commit hooks.
- 2026-06-04 ADR-006: normal install "made routine XML-side edits produce release-visible changes", so `skills/` refreshes
  only through an explicit `release` profile (…/documentation/adr/ADR-006-…:13-17,39-40).
- 2026-09-26 `17743ed` (#1197), from a security report #1191: pin actions to SHAs, harden link validation against SSRF,
  and **removed** the Codex workflows `.github/workflows/sf/create-spec-with-codex.yaml` and
  `update-issue-with-codex.yaml` ("finding 4").
- 2026-07-31 `a8e5189` (#1106): remove legacy cursor rules.

---

## 9 · openclaw-openclaw (local HEAD `b94e5177`; fetch not finished)

Late note: the fetch finished after this section was written. `origin/HEAD` is now `c409abe1885` (2026-10-24). Between `b94e5177` and that commit, `AGENTS.md` changed by 206 lines, `CONTRIBUTING.md` by 55, and 116 files changed in total across `AGENTS.md`, `CONTRIBUTING.md` and `.github/workflows`. The citations below are for `b94e5177` and may be stale.

Scope as asked: root `AGENTS.md`, `CONTRIBUTING.md`, workflow names.

- **Workflows** (115 files). Names that match our topics: `ci.yml`, `workflow-sanity.yml`, `docs.yml`,
  `docs-external-links.yml`, `dependency-audit.yml`, `codeql*.yml`, `security-review.yml`, `labeler.yml`, `stale.yml`,
  `plugin-init-scaffold-validation.yml`, `plugin-npm-release.yml`, `openclaw-release-*.yml`. I did not read their bodies.
  `.github/` also holds `CODEOWNERS`, `ISSUE_TEMPLATE/`, `pull_request_template.md`, `actionlint.yaml`, `zizmor.yml`, `dependabot.yml`.
- **AGENTS.md** (145 lines): "Update instructions at their owner instead of adding competing rules here"
  (openclaw-openclaw/AGENTS.md:8@b94e5177). "New lint rules need a meaningful invariant and a clean owner scope" (…:78).
  "CI is expensive; do not spend it on proof" (…:91). New tests state their measured cost (…:93). "Use concise Conventional
  Commits" and "omit agent-attribution trailers" (…:124, …:112). CHANGELOG is release-owned (…:142).
- **CONTRIBUTING.md** (284 lines): 20 open PRs per author (openclaw-openclaw/CONTRIBUTING.md:44@b94e5177), PR template
  required (…:89), no refactor-only or test-only PRs for known red `main` (…:21-22, …:109-110), "Do not edit the generated
  `CHANGELOG.md`" (…:92), agents run the `autoreview` skill before a PR (…:107).

---

## 10 · Synthesis

### 10.1 Practice × repo

Legend: ✓ present and run · partial (see note) · ✗ absent · – not checked (openclaw: names only).

| practice | mattpocock | cursor/pstack | addyosmani | humanlayer | rameezk-forge | firstmate | Jeffallan | plinth | openclaw |
|---|---|---|---|---|---|---|---|---|---|
| CI on PR | ✗ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ (name) |
| markdown lint | ✗ | ✗ | partial ¹ | ✗ | ✗ | ✗ | ✓ | ✓ | – |
| shell lint | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | – |
| script tests | ✗ | ✓ | ✓ | partial ² | ✓ | ✓ | ✓ | ✓ | – |
| skill frontmatter validation | ✗ | partial ³ | ✓ | partial ² | ✗ | ✗ | ✓ | ✓ | – |
| plugin manifest validation | partial ⁴ | ✓ | ✓ | ✗ | ✗ | ✗ | partial ⁵ | ✗ | – |
| link check | ✗ | partial ⁶ | ✓ | ✗ | ✗ | ✗ | partial ⁷ | ✓ | ✓ (name) |
| evals | ✗ | ✗ | ✓ | partial ² | ✗ | ✗ | ✗ | partial ⁸ | – |
| AGENTS.md/CONTRIBUTING for contributors | ✓ | ✗ | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ |
| PR template | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ ⁹ | ✗ | ✓ | ✓ |
| conventional commits enforced | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ ¹⁰ |
| release automation | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✓ (name) |

¹ structural skill lint, not markdownlint. ² Bun scripts exist; nothing runs them. ³ name = folder, ≤ 64 chars, pstack
only, inside the generator check. ⁴ `claude plugin validate --strict` as an instruction; version-drift script not in CI.
⁵ count consistency only. ⁶ `check-pstack-docs.mjs` exists, not in CI. ⁷ reference paths inside skills. ⁸ Gherkin prompts,
run by hand per changed skill. ⁹ the no-mistakes attestation check stands in its place. ¹⁰ stated in AGENTS.md:124; I did
not check for a hook.

### 10.2 Practices with ≥2 independent references (CP4-eligible)

| practice | repos |
|---|---|
| CI runs on every PR | cursor-plugins, addyosmani, rameezk-forge, firstmate, Jeffallan, plinth (openclaw by name) |
| Tests for repo scripts, run in CI | cursor-plugins, addyosmani, rameezk-forge, firstmate, Jeffallan, plinth |
| SKILL.md frontmatter check in CI (name, description) | addyosmani, Jeffallan, plinth; partial: cursor-plugins |
| Description ≤ 1024 characters | addyosmani (`skill-lint.js:31`), Jeffallan (`validate-skills.py:138`) |
| Skill `name` equals its folder | addyosmani, cursor-plugins |
| Plugin manifest check in CI | cursor-plugins (Ajv schema), addyosmani (`claude plugin validate .`) |
| One version across all manifests, checked | cursor-plugins, addyosmani; mattpocock syncs it on release |
| Markdown structure lint | Jeffallan, plinth |
| Link check in CI | addyosmani, plinth; partial: Jeffallan |
| Contributor-facing AGENTS.md/CLAUDE.md/CONTRIBUTING | mattpocock, addyosmani, rameezk-forge, firstmate, Jeffallan, plinth, openclaw |
| CLAUDE.md as a pointer to AGENTS.md (one source) | mattpocock (symlink), firstmate (`@AGENTS.md`, checked in CI) |
| Skip heavy CI for markdown-only changes | rameezk-forge (ADR-0043), plinth (`Detect Validation Scope`) |
| One aggregate check, or named checks, set in the ruleset | rameezk-forge (`ci` job), firstmate (CONTRIBUTING:41-47) |
| Pin actions to SHAs + Dependabot for actions | rameezk-forge, Jeffallan, plinth |
| CODEOWNERS | rameezk-forge, plinth (openclaw has one) |
| Issue forms | mattpocock, addyosmani, Jeffallan (openclaw has a folder) |
| Release automation | mattpocock (changesets), Jeffallan (tag → release) |
| Keep a Changelog + tags | Jeffallan, plinth; mattpocock uses changesets' CHANGELOG |
| Make as the front door | rameezk-forge, Jeffallan |
| Generated output checked against source in CI | cursor-plugins (`--check`), Jeffallan (`update-docs.py --check`) |
| No agent attribution in commits | rameezk-forge (AGENTS.md:53), firstmate (AGENTS.md:53), openclaw (AGENTS.md:112). plinth asks for the opposite (AGENTS.md:172-180) |
| Ship only the plugin paths, not the repo | Jeffallan (`plugin` branch), cursor-plugins (generated `harness/` tree) |

### 10.3 Practices only one repo has (list only, not recommended)

- Shell lint (ShellCheck pinned + actionlint): firstmate.
- Bash 3.2 (stock macOS) compatibility job: firstmate.
- Test-shard coverage proof: firstmate.
- PR must come through a signed gate (no-mistakes): firstmate.
- Trigger/routing evals by TF-IDF, behavioral evals, `claude plugin eval`: addyosmani.
- Real `claude plugin install` in CI: addyosmani.
- Validators on macOS and Windows: addyosmani.
- Rejection ledger for skill changes: addyosmani.
- Security scanners over skills (skill-check, Cisco, SkillSpector, Snyk, VirusTotal): plinth.
- Conventional Commits enforced by hook and in CI: plinth.
- PR template: plinth (openclaw also has one, but I read only its name).
- Changesets: mattpocock.
- Issue triage bots (`needs-triage`, `needs-info` auto-close): mattpocock.
- prettier / ruff / pyright through pre-commit: Jeffallan.
- Live Codex fixture runs against a skill: humanlayer.
- Daily vendored-skill sync PR: rameezk-forge.

### 10.4 Tried and removed, with reason

| repo | removed | reason (their words) | evidence |
|---|---|---|---|
| addyosmani | plugin `SessionStart` hook (`hooks/hooks.json`) | it "stacks a second router on the native one", "~3.5k wasted cache-creation tokens per session" | `a598aab` |
| cursor-plugins | CI step running `claude plugin validate` | "#629 also reverted it in 6bcc06b"; the reason sits in `6bcc06b`, outside the shallow graft | `182f2ce` |
| plinth | Codex workflows `sf/create-spec-with-codex.yaml`, `sf/update-issue-with-codex.yaml` | security report #1191, "finding 4" | `17743ed` |
| plinth | Markdown into `skills/` on every install | "routine XML-side edits produce release-visible changes" | ADR-006:13-17 |
| Jeffallan | repo root as the shipped plugin | the directory "held for review (BINARIES_NOT_INSPECTED)" | `7558052` |
| rameezk-forge | full CI on markdown-only changes | about 10 minutes "even for changes such as ADRs … or skills, which no check reads" | ADR-0043:9 |
| mattpocock | hand-bumped plugin version | `plugin.json` at 1.2.1 while `package.json` stayed at 1.2.0 | `f3554ac` |

Drift seen but not removed: plinth marketplace version `0.14.0-SNAPSHOT` vs tag `0.19.0`; mattpocock `needs-info.yml`
links a `CONTRIBUTING.md` that does not exist; addyosmani CLAUDE.md still says `npm test` is not applicable.
