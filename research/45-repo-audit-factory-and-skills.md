# 45 — agent-factory and chiyanram/skills as they are (2026-10-25)

## Method

I ran `git fetch -q` in both clones and read `origin/main` with `git show` and `git ls-tree`. agent-factory is at
`5136b90`. skills is at `1092b85`. Both local clones are on `main`, equal to `origin/main`, and `git status --short`
is empty. I queried GitHub with `gh api` and `gh issue/pr list`. I checked each relative link in the root docs
against the `origin/main` tree with a script. I ran `claude plugin validate --strict` (Claude Code 2.1.308) on a
`git archive` export of skills `origin/main`. I read the `npx skills` CLI source from the local npx cache
(`skills` 1.5.22, `~/.npm/_npx/5606f1555d02ef53/node_modules/skills/dist/cli.mjs`). I changed nothing except this file.

## 1 · chiyanram/agent-factory

### 1.1 Tree

```
agent-factory/
├─ AGENTS.md  CLAUDE.md (= "@AGENTS.md", 1 line)  README.md  GLOSSARY.md
├─ docs/      ARCHITECTURE.md DEVELOPMENT.md design.md open-items.md learnings.md handoff-2026-10-18.md
│  ├─ adr/        0001…0008
│  ├─ agents/     domain.md issue-tracker.md triage-labels.md
│  ├─ briefs/     vm-gate-diagnose.md
│  ├─ playbooks/  coordinator.md
│  └─ setup/      identity.md
├─ drafts/agent-platform/   AGENTS.md  code-review/SKILL.md  design-review/SKILL.md
├─ research/  01…43 (NN-slug.md, plus 07 .html, 34 .json)
└─ review/    build-side-by-side.py  side-by-side-template.html  side-by-side.html
```

| folder | purpose, from README.md layout |
|---|---|
| `docs/adr/` | "decision records 0001…" (README.md:49) |
| `docs/briefs/` | "briefs for agents that run elsewhere" (README.md:53) |
| `docs/agents/` | "answers for the mattpocock skills: issue tracker, labels, domain docs" (README.md:54) |
| `research/` | "one numbered file per research ticket (NN-slug.md)" (README.md:55) |
| `review/` | "builders for review pages" (README.md:56) |
| `drafts/`, `docs/playbooks/`, `docs/setup/`, `docs/learnings.md` | absent from the layout — checked README.md:41-57. No folder README. |

No `.gitignore` — checked `git ls-tree origin/main`.

### 1.2 Agent instructions

- `AGENTS.md` is 19 lines. `CLAUDE.md` is 1 line, `@AGENTS.md` (regular file, mode 100644).
- AGENTS.md:3 calls it a "Planning repo". AGENTS.md:4: "Plan, don't do — nothing is built until the design is approved."
- AGENTS.md:5 says read README, ARCHITECTURE, open-items first. AGENTS.md:7-19 hold the mattpocock skill answers.
- README.md:3 "It holds no code." README.md:28 build row: "not started | plan, don't do".
- DEVELOPMENT.md:3 "This repo plans. It does not build. No code, no merges, no VM changes come from here".
- These four lines must change. Map #1 closed 2026-10-25 with "Building starts from here, outside this map"
  (#1 last comment, 2026-10-25T05:44Z).
- README.md:27 still says L1–L7 "in progress". open-items.md:1 says "last update 2026-10-23" and lists #23, #25,
  #26, #27 as open (open-items.md:17-20). All four are closed (#23 2026-10-23, #25 2026-10-24, #26 2026-10-23,
  #27 2026-10-25).

### 1.3 Code present

| file | size | test |
|---|---|---|
| `review/build-side-by-side.py` | 42 lines, 2080 B | none. Inputs come from argv (lines 2, 41-42). |

No shell, JS or other Python. No test files — checked `git ls-tree -r` for `*test*`.

### 1.4 Gates

- No Makefile, justfile or package.json. No markdownlint, shellcheck, prettier or editorconfig. No `.github/`.
  `gh api repos/chiyanram/agent-factory/actions/workflows` → `total_count 0`.
- Branch protection: `gh api …/branches/main/protection` → **HTTP 403** "Upgrade to GitHub Pro or make this
  repository public". Rulesets → same 403. The repo is private on Free, so main cannot be protected. No required checks.
- Merge settings: squash only, delete branch on merge.

### 1.5 Open issues and PRs

0 open issues, 0 open PRs. All 27 issues are closed, map #1 included.

### 1.6 Hygiene

All absent — checked the tree: PR or issue templates, CODEOWNERS, LICENSE (`license: null`), CHANGELOG, tags (0),
commit hook (no `.husky`, no commitlint, `core.hooksPath` unset, `.git/hooks` holds samples only).
Commit rule is prose only: DEVELOPMENT.md:68 "`type: subject` … Types in use: `docs`, `research`". The log already
drifts from it: `fix(drafts): …`, `docs(glossary): …`.

### 1.7 Broken now

- Relative links in AGENTS.md, README.md, DEVELOPMENT.md, ARCHITECTURE.md, open-items.md: all resolve. Three misses
  are not links: `research/NN-slug.md` (placeholder, DEVELOPMENT.md:45), `create-agent.sh` (ARCHITECTURE.md:64,
  says it is not needed), `block-dangerous-git.sh` (open-items.md:59, laptop file).
- Stale status: README.md:27 and open-items.md:17-20, above.

### 1.8 What the docs already DECIDE about each repo

| decision | quote (≤15 words) | cite |
|---|---|---|
| project rulebook layout | "AGENTS.md (root, <200 lines, file-type blocks ≤3 MUSTs)" | adr/0003:14 |
| rule bodies location | ".agents/skills/<domain>/references/*.md rule bodies, five sections (.claude/skills → symlink)" | adr/0003:16 |
| skills repo role | "generic rules: chiyanram/skills → Claude plugin + `npx skills add` for other tools" | adr/0003:17; design.md:49 |
| skills repo layout | "plugins/rulebook/skills/<domain>/references/*.md neutral rules that point to docs/agents/<domain>.md" | ARCHITECTURE.md:142 |
| delivery | "reaches Claude as a plugin; reaches other tools by `npx skills add`" | ARCHITECTURE.md:143 |
| generic vs project | "generic rule in chiyanram/skills; Aruvii-only rule in the nearest nested AGENTS.md" | ARCHITECTURE.md:154 |
| lint gate | "`make lint` checks the sizes; a sentinel probe proves each tool loads the rules." | adr/0003:21-22 |
| size check | "`make lint` checks <200 lines and the root→leaf chain <32 KiB" | ARCHITECTURE.md:152 |
| mechanical rules | "goes to `make lint` or CI; the reviewer skips it" | ARCHITECTURE.md:151 |
| gate for skills/docs | "docs, skills, markdown \| lint + rule-load check" | ARCHITECTURE.md:122 |
| hard rules | "Every hard rule also lives in `make lint` or CI." | ARCHITECTURE.md:179 |
| writing order | "one MR per target file, each rule cites its ledger row" | ARCHITECTURE.md:155 |
| rejected | "generic rules copied into each project \| copies drift" | adr/0003:38 |
| first build | "the FIRST build is the rulebook — the L1 writing MRs, one rule file at a time" | #1 comment 2026-10-24T05:07Z |
| agent-factory role | "This repo plans. It does not build." | DEVELOPMENT.md:3 |
| agent-factory commits | "Commit and push only when the operator says 'commit'" | DEVELOPMENT.md:67 |
| skills tree, per file | "chiyanram/skills plugins/rulebook/skills/<domain>/references/*.md, written neutral" | research/34-l1-file-plan.md:10 |

Not decided anywhere — checked adr/0001-0008, ARCHITECTURE.md, DEVELOPMENT.md, design.md, open-items.md: where the
factory's own code (coordinator playbook, router, CI templates) lives once built, and whether agent-factory stays
plan-only.

## 2 · chiyanram/skills

### 2.1 Tree

```
skills/
├─ AGENTS.md  CLAUDE.md (symlink → AGENTS.md)  README.md  Makefile  .gitignore
├─ map.md  requirements.md  design-overview.md
├─ .claude-plugin/marketplace.json
├─ plugins/rulebook/
│  ├─ .claude-plugin/plugin.json
│  └─ skills/.gitkeep                ← the only file; 0 skills
├─ docs/agents/   domain.md issue-tracker.md triage-labels.md
├─ issues/        01…36 local wayfinder tickets
├─ p1/            README.md lead-judgment.md report-spec.md report-standards.md
├─ refs/README.md
├─ research/      00…68f, plus repos/ (INDEX.md, 10 per-repo reports)
└─ review/        8 build-*.py, templates, built .html, .json inputs
```

| folder | purpose, quoted | cite |
|---|---|---|
| `plugins/rulebook/` | "generic skills, references and the `/crq` workflow" | README.md:14-15 |
| `issues/` | "Tickets are markdown files in issues/ (local wayfinder tracker)" | README.md:9 |
| `refs/` | "Reference clones — read-only inputs for the one-rulebook map (#9)" | refs/README.md:1 |
| `p1/` | "scoped-reviewer prototype on agent-platform !230" | p1/README.md:1 |
| `research/repos/` | "Per-repo deep reports — index (2026-10-01)" | research/repos/INDEX.md:1 |
| `docs/agents/` | "How the engineering skills should consume this repo's domain documentation" | docs/agents/domain.md:3 |
| `research/`, `review/` | "not part of it" (the plugin); no own README | README.md:16 |

### 2.2 Agent instructions

- `AGENTS.md` is 15 lines; `CLAUDE.md` is a symlink to it (mode 120000). It holds only the mattpocock answers
  (AGENTS.md:3-15). It says nothing on how to work, commit, or lint.
- README.md:4: "Planning only: nothing here is wired into a project yet."
- README.md:5: the result "is split into the three projects (agent-platform, aruvii-agent-fleet, agent-fleet)".
  This conflicts with adr/0003:17 and ARCHITECTURE.md:141-143, which make this repo the generic plugin. Issue #81
  body also says "chiyanram/skills = map + research".
- Tracker conflict: README.md:9 and map.md:3 say a local markdown tracker in `issues/`. AGENTS.md:7 and
  docs/agents/issue-tracker.md:3 say GitHub issues.
- AGENTS.md:15 names "one `CONTEXT.md` + `docs/adr/`". Both are absent — checked `git cat-file` and `ls-tree`.

### 2.3 Code present

| file | lines | test |
|---|---|---|
| review/build.py | 52 | none |
| review/build-planning.py | 52 | none |
| review/build-good-rewrites.py | 52 | none |
| review/build-neutral.py | 63 | none |
| review/build-g9c-mg.py | 67 | none |
| review/build-spring.py | 51 | none |
| review/build-g9b.py | 50 | none |
| review/build-reasons.py | 42 | none |

All input files they read exist in the tree. Three hardcode the laptop path `/Users/chiyanram/workspace/skills/…`:
build.py:3,50-51; build-planning.py:3,50-51; build-good-rewrites.py:3,50-51. No test files — checked the tree.

### 2.4 Gates

- Makefile:4-6, one target `lint`: `claude plugin validate --strict .` and `… plugins/rulebook`. Run on the export:
  both pass, exit 0.
- The rulebook check reports 2 directory-refusal problems (README_MISSING, LICENSE_MISSING) and 1 warning
  (ICON_MISSING). They do not fail `--strict`.
- No size check, no sentinel probe, no markdownlint, shellcheck or prettier — checked the tree and Makefile.
- No `.github/`; `actions/workflows` → `total_count 0`.
- Branch protection and rulesets: **HTTP 403**, same as agent-factory (private repo on Free). No required checks.
- Squash only, delete branch on merge. Remote has one stray branch `claude/pensive-franklin-55076e`, 1 commit ahead of
  main, dated 2026-10-17, subject matching an already-merged #82 commit.

### 2.5 Plugin packaging

- marketplace.json:2 `name: chiyanram`; plugins[0] `rulebook`, `source: ./plugins/rulebook` (lines 7-8).
- plugin.json: name `rulebook`, version `0.1.0`, no `license`, no `skills` list.
- `npx skills add` discovery (cli.mjs:1142-1150, 842-866): it walks the repo root, `skills/`, the agent project dirs
  (`.agents/skills`, `.claude/skills` …), and each marketplace plugin's `<source>/skills`. Plugin dirs walk depth 1,
  so it finds `plugins/rulebook/skills/<name>/SKILL.md`. With 0 hits it falls back to a depth-5 walk (cli.mjs:1172).
- A skill needs `name` and `description` in frontmatter or it is skipped (cli.mjs:1066-1072).
- **Skill count: 0.** `plugins/rulebook/skills/` holds only `.gitkeep`. There is no SKILL.md to validate.
- Plan gap: research/34-l1-file-plan.md:20-63 puts references under `code/`, `testing/`, `obs/` etc. Only `deslop/`
  has a SKILL.md (research/34:35). A domain folder with references and no SKILL.md is not found by either loader.
- The operator's global CLAUDE.md cites `plugins/rulebook/skills/code/references/smells.md`. Absent on origin/main.

### 2.6 Open issues and PRs

19 open issues, 0 open PRs.

| # | title (short) | foundation? |
|---|---|---|
| #81 | split repos when their trigger fires — skills, coordinator, crq | yes, repo role |
| #65 | skills repo as source of truth for common skills, installable anywhere | yes, packaging |
| #67 | pilot — one real bug end-to-end through the new pipeline | yes, first build proof |
| #62 | the VM as gate runner (>1 h vs <30 min) | gate, but for agent-platform |
| #21 | D1 role boxes — Agent SDK + AG-UI | no |
| #34 | G9c content: migrations, delivery, review packet | content |
| #79 | R35 agent-engineering rules | content |
| #85, #80, #75, #74, #71, #57, #56, #55, #54, #53, #52, #51 | `after-v1` content research | no |

Map #9 is closed (2026-10-18). #90 (delivery probe, cited at README.md:41) is closed (2026-10-16), but no probe is in
the tree.

### 2.7 Hygiene

All absent — checked the tree: PR or issue templates, CODEOWNERS, LICENSE (`license: null`), CHANGELOG, tags (0),
commit hook, commitlint. Versioning is only `plugin.json` `0.1.0`, never bumped or tagged. Log style is
`type: subject (#N)` with no scope; no doc states it.

### 2.8 Broken now

- AGENTS.md:15 → `CONTEXT.md`, `docs/adr/`: absent.
- README.md:37 `bake-plugins.sh`: lives in agent-fleet, not here — not a broken link.
- map.md misses (`issues/NN-*.md`, `SOUL.md`, `pstack/`) are placeholders or other repos.
- README.md:40-41 says Codex is unproven "until the G20 delivery probe (#90)"; #90 is closed with no probe.

## 3 · Gaps against a buildable repo

| gap | repo | evidence |
|---|---|---|
| instructions say plan only | factory | AGENTS.md:4; README.md:3,28; DEVELOPMENT.md:3 |
| instructions say plan only | skills | README.md:4 |
| repo role contradicts ADR | skills | README.md:5 vs adr/0003:17, ARCHITECTURE.md:141-143 |
| status stale after map close | factory | README.md:27; open-items.md:1,17-20; #1 closed 2026-10-25 |
| tracker named two ways | skills | README.md:9, map.md:3 vs AGENTS.md:7 |
| AGENTS.md names absent files | skills | AGENTS.md:15 (CONTEXT.md, docs/adr/) |
| no how-to-work section | skills | AGENTS.md:1-15 holds only skill config |
| no `make lint` at all | factory | no Makefile in tree |
| lint lacks size check + sentinel probe | both | adr/0003:21-22, ARCHITECTURE.md:152 decide it; skills Makefile:4-6 only validates manifests |
| no markdownlint / shellcheck / prettier | both | absent in tree |
| no CI workflow | both | no `.github/`; workflows total_count 0 |
| main cannot be protected | both | protection API 403 (private, Free) |
| no tests for scripts | both | 1 + 8 Python builders, 0 tests |
| hardcoded laptop paths | skills | review/build.py:3,50-51; build-planning.py:3,50-51; build-good-rewrites.py:3,50-51 |
| zero skills in plugin | skills | plugins/rulebook/skills/.gitkeep only |
| domains planned without SKILL.md | skills | research/34:20-63; only deslop has one (research/34:35) |
| no LICENSE (plugin directory refuses) | both | license null; validate → LICENSE_MISSING |
| no plugin README / icon | skills | validate → README_MISSING, ICON_MISSING |
| no version tags / CHANGELOG | both | 0 tags; plugin.json 0.1.0 |
| commit convention unenforced | both | no hook; factory log drifts from DEVELOPMENT.md:68 |
| no PR/issue templates, CODEOWNERS | both | absent in tree |
| no `.gitignore` | factory | absent in tree |
| layout omits folders | factory | README.md:41-57 omits drafts/, playbooks/, setup/ |
| Codex delivery unproven | skills | README.md:40-41; #90 closed, no probe in tree |
| stray remote branch | skills | `claude/pensive-franklin-55076e`, 1 commit ahead |
| home of factory code undecided | factory | absent in adr/0001-0008, ARCHITECTURE.md, DEVELOPMENT.md |
