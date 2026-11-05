Reviewed 1092b85..6a3b45c · patch-id f3aa79ff8f8f985e2c5b1022ce226cb09e95c1a5 · round 1

## Intent
#111/PR #112: make the empty rulebook plugin buildable before any rule lands: AGENTS.md/CLAUDE.md, README role, `make lint`/`test`, five checks with planted fixtures, builder de-hardcoding, SHA-pinned CI, LICENSE, icon, plugin README. `make lint`, `make test` and CI run 40292719318 pass; reproduced locally (CLI 2.1.308, no token).

## Standards

### 1. [warning] Rules check skips non-matching headings and shapes   Standards
Location   scripts/check_sizes.py:36-39
Rule       "Each rule file stays inside the ADR-0003 size limit"
Finding    Only heading `## Rules` exactly, and only `-*+`/`N.` items, are read.
Evidence   `## Rules (ours)` (research/22 G5 name) + 60-word item → exit 0. 50-word table row → exit 0. `1) <50 words>` merges into the previous item (107). No Rules section → exit 0 (ADR needs five). Nested sub-bullets count into the parent.

### 2. [warning] Hand-rolled frontmatter parser miscounts valid YAML   Standards
Location   scripts/check_skills.py:11-23
Rule       "description is at most 1024 characters"
Finding    Counts raw text, not the decoded value.
Evidence   `description: "…\"b\"c\""` decoding to 1023 chars → "1025 characters, over 1024". `name: x # c` → name mismatch. BOM → "missing name". Unclosed `---` or `--- ` → misleading "missing name".
Suggestion Use a YAML loader.

### 3. [warning] Link check misses reference links, anchors, case; has false positives   Standards
Location   scripts/check_links.py:9,30-45
Rule       "Every relative link … resolves"
Finding    Inline `[t](x)` only.
Evidence   `[r1]: missing.md` not reported. `a.md#no-such` passes. `[c](DOCS/A.md)` passes on macOS, fails on Linux. `docs/par(en).md`, `?x=1`, `//host`, links in HTML comments/indented code → false fail. `[a [b]](x)` missed.

### 4. [warning] Missing root AGENTS.md passes   Standards
Location   scripts/check_sizes.py:19-22
Rule       "root AGENTS.md under 200 lines" (ADR-0003:14)
Evidence   Repo with no AGENTS.md → exit 0 (`lines = 0`).

### 5. [warning] Makefile wiring and the real repo are untested   Standards
Location   Makefile:5-12; tests/
Rule       Tests must fail when the behaviour breaks
Evidence   13 scratch mutations of check constants/branches each failed `make test`. But deleting `check_links.py` from `lint:` → `make test` OK. Only `plugin validate` runs on the shipped plugin.

### 6. [nit] Plugin ships no LICENSE
Location   scripts/check_plugin.py:21-27
Evidence   LICENSE required at repo root only; `validate` says it "was taken from" the root; the marketplace copies only `plugins/rulebook/`.

### 7. [nit] CI hygiene
Location   .github/workflows/ci.yml:13-16
Evidence   Python unpinned (`ubuntu-latest`); checkout keeps credentials. CLI pin 2.1.308 is exact (npm `stable`), needs no token.

### 8. [nit] README drops content
Location   README.md (diff)
Evidence   Codex caveat (#90 probe) and agent-fleet#79 link removed; "other agent tools" claim has no probe behind it.

## Spec
- AGENTS.md check/tracker, existing files, CLAUDE.md = `@AGENTS.md`: met AGENTS.md:8-15,25-29; CLAUDE.md:1
- README role, no "plan only": met README.md:1-6
- `make lint`/`test`, CI same targets: met Makefile:5,14; ci.yml:20-25
- SKILL.md name/description/1024: met with defects check_skills.py:26-34 (2)
- `validate --strict` + LICENSE/README/icon: met Makefile:11-12; check_plugin.py:10-28 (6)
- One version: met check_versions.py:10-24
- Relative links: met with gaps check_links.py:30-45 (3)
- Rule size + 32 KiB chain: met with gaps check_sizes.py:19-45 (1, 4); chain = AGENTS.md root→leaf, correct per research/22:11,22
- Builders, no `/Users/`, tests: met tests/test_builders.py:12-21 (8 of 8)
- CI PR+main, SHA pins (3d3c42e = v7.0.1, API-verified), Dependabot: met ci.yml:3-17; dependabot.yml
- Ships only plugins/rulebook/: met check_plugin.py:14,23
- Unrequested code: none beyond `--profile directory` (Makefile:12), small.
- Design: ADR-0003 "≤3 MUSTs" omitted, declared in PR.

## Receipts
Rubric; #111 + comments; PR #112; ADR-0003; research/22; research/44 (grep); AGENTS.md, CLAUDE.md, README.md, plugin README, Makefile, ci.yml, dependabot.yml, scripts/*.py, tests/*.py, manifests, build.py diff, LICENSE. Ran lint/test, 13 mutations, crafted inputs in /private/tmp/claude-501/review-sk112/. Not read: ADR-0009, writing-for-agents skill (docs prose not style-reviewed).
