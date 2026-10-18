# 16 — The project's coding-agent setup end to end: agent-platform today vs references and industry (2026-10-18)

Ticket: chiyanram/agent-factory#14 (parent #1). Describes and compares only. agent-platform read at `origin/master` @ `1c01c421`
(`git show`), never the #643 WIP worktree except where marked. Reference clones: `.scratch/one-rulebook/refs/` (SHAs per row; F01 records
newer heads for firstmate/pstack/forge/openclaw). Cite keys: `F01`–`F15` = agent-factory `research/NN-*` · `R01` `R02` `R03` `R07`(=08-standards)
`R12`(=14-disposition) `R34` `R64a`–`R64e` = `~/workspace/skills/research/` · `G1` sk#14 · `G1b` sk#72 · `G5` sk#22 · `G10` sk#37 · `G20` sk#90 ·
`G21` sk#91 · `G23` sk#93 (sk = chiyanram/skills) · `#`/`!` = agent-platform GitLab · `~CM` = operator `~/.claude/CLAUDE.md`. Sizes `wc -lc`.

## A · agent-platform today, as one system

### A1 · Inventory

Load rules (Claude Code): root CLAUDE.md + `~CM` at launch, every session and subagent; a `paths:` rule and a module CLAUDE.md on first
**read** of a matching file (not on create — #500, AGENTS.md); skill/command/agent `description:` at launch (listing), body on invoke;
agent `skills:` frontmatter preloads the rubric into the subagent (R01 §1, R02 pt 4).

| file | kind | lines / bytes | when it loads | who reads it | overlaps / duplicates with |
|---|---|---|---|---|---|
| `CLAUDE.md` (root) | always-on rulebook, 17 `<important if>` blocks | 482 / 32,775 | always (launch; survives compaction) | every session, every subagent, every /crq stage | restates most `.claude/rules` (R01 §3: Java block = `java-standards.md:12-28`); >Codex 32 KiB cap by 7 B (R34 §0) |
| `AGENTS.md` | symlink → `CLAUDE.md` (git mode 120000) | 0 / 9 | via target | Codex, other harnesses | **F08 §4 says the reverse** (`CLAUDE.md = @AGENTS.md`); that flip exists only in #643 WIP `71b5deb4` |
| `aruvii-{agents,api,providers,shared,tools,worker}/CLAUDE.md` | module rulebooks | 77–181 each; 782 / 48,644 total | on read of a file in that module | session working in that module; reviewers if they read there | not linked from root (R34 §1); G1b decided rename → nested `AGENTS.md` — not done |
| `.claude/always-on/agent-output.md` | reply-shape rules | 103 / 5,674 | always, `SessionStart` hook (startup/resume/clear/compact) | every session | `~CM` "How to explain" (aligned block vs "Tables for anything compared", R01 §3); `show-me` ×2; `i-have-adhd` plugin |
| `~CM` (operator only) | user global; headings: *How to explain things to me* · *How I want code designed* | 72 / 5,427 (R01: 4,445) | always, laptop only; fleet overwrote it with role file (R01 §1) | operator's sessions only | output rules ↑; seam rules S-1..S-7 exist nowhere in repo (#679, F08 §4); "pick the default" vs crq "never answer your own questions" (F12 #19) |
| `.claude/rules/java-standards.md` · `observability.md` | path rule `**/*.java` | 67/5,133 · 53/3,738 | first `.java` read | stage 6 author; reviewers when they open Java | CLAUDE.md Java + logging blocks; `standards-review`; `aruvii-standards` refs (4–5 copies, R01 §3) |
| `.claude/rules/it-testing.md` | `*IT.java/groovy`, `*Spec.groovy` | 105 / 5,546 | on read | stage 6 | CLAUDE.md tests block; `it-testing` skill; AssertJ vs Spock split (R01 §3) |
| `.claude/rules/dependencies.md` | `pom.xml`, `*.gradle.kts`, `libs.versions.toml`, `package.json`, `renovate.json` | 193 / 13,678 | on read | stage 6 | CLAUDE.md imports block (condition still says "pom.xml"; repo is Gradle, R34 §0) |
| `.claude/rules/migrations.md` · `smoke.md` · `angular-ui.md` | `**/db/migration/**` · `smoke-*.spec.ts` · `aruvii-ui/**` | 123/8,407 · 33/1,842 · 16/646 | on read | stage 6 | `flyway-migration`, `smoke-spec`, CLAUDE.md blocks |
| `.claude/commands/crq.md` | pipeline command | 464 / 28,263 (R01: 27,838) | `/crq` | main session = every role (laptop); fleet roles read it (F12 §3) | stage 2 "vendored into `.claude/skills/`" vs `skills/README.md` "never copied" (F12 #17); personas "a tool, not a process" (F12 #23) |
| `.claude/commands/dod.md` · `issue.md` · `refine.md` · `v1-status.md` | commands | 83/4,729 · 109/5,360 · 106/6,201 · 134/6,716 | on `/x` | dod: stage 8; issue: before stage 1; refine: pre-/crq epics | dod decrypt "or `SetupService`" vs CLAUDE.md; dod hard-codes `verify-module MOD=aruvii-api` (F12 #20) |
| `.claude/agents/{architecture,code-standards,spec-design,smoke-spec}-reviewer.md` | subagents, `model: opus`, read-only tools, `skills:` preload | 104/7,155 · 75/4,812 · 94/6,046 · 97/6,142 | on spawn | stage 5: spec-design ‖ architecture; stage 7: code-standards ‖ architecture (A + F-01); smoke when a smoke spec changed | spec-review desc "stage 3 … and again" vs crq "stage 5 and nowhere else" (F12 #18) |
| rubric skills `architecture-review` · `standards-review` · `spec-review` (+`MEMORY.md` 16/902) · `smoke-spec` | rubrics (30 · 86 · 24 `###` criteria) | 411/33,145 · 790/46,227 · 367/23,856 · 420/29,416 | preload only (51 preloads, 0 model calls, R02 pt 4) | the four reviewers | standards-review restates CLAUDE.md though it says it does not (R01 §3); G5 decided "no central rubric" — still central |
| workflow skills `aruvii-git` (+2 refs) · `aruvii-cleanup` · `code-review` · `deslop` · `flyway-migration` · `hook-from-rule` | procedures | 440/19,288 · 118/5,888 · 103/6,521 · 160/7,914 · 86/4,693 · 88/4,319 | on invoke | stages 0/10 cleanup; 5/9 git; 6a deslop; 7 code-review; 6 flyway | `aruvii-git` restates CLAUDE.md git block (R01 rows 22–26) |
| knowledge skills `aruvii-standards` (+23 refs, 152,737 B) · `it-testing` · `gherkin-to-test` · `acceptance-criteria-writing` · `show-me` | examples / standards | 90/8,675 · 355/25,102 · 95/5,882 · 97/4,515 · 121/4,280 | on invoke; refs one at a time | stage 6 (named descriptively → rarely fires: `it-testing` 1 in 530, R02 pt 3) | gherkin/AC-writing: 0 fires in 31 days, not named by crq (R02); `show-me` also in `~/.claude/skills` (differs, R01 §3) |
| `.claude/skills/README.md` | provenance + plugin rule (#587) | 89 / 6,175 | when read | maintainers | contradicts crq.md stage 2 + Notes (F12 #17) |
| `.claude/hooks/*.sh` (9) | 3 block (`block-migration-edit`, `check-migration-version`, `block-commit-on-master`), 5 advise, 1 context | 13–158 each | by hook: PreToolUse Edit/Write, PreToolUse Bash, PostToolUse Write, SessionStart | harness, every session + subagent | CLAUDE.md:56 "Two `SessionStart` hooks" — settings has one (R34 §0, still stale) |
| `.claude/settings.json` | permissions allow (26), hooks, `enabledPlugins` (10), 1 marketplace | 117 / 3,358 | launch | harness | R01's dangling `warn-decrypt-outside-handler` entry is **gone** today; `semgrep` plugin still enabled though rules deleted (F08 §4) |
| `.claude/settings.local.json` · `~/.claude/settings.json` | per-dev | gitignored · operator | launch | harness | operator's `block-dangerous-git.sh` points at a missing file (F08 §4) |
| plugins | `mattpocock-skills` (grilling, domain-modeling, tdd, wayfinder, research, triage, to-spec…), `i-have-adhd`, context7, gitlab, github, pr-review-toolkit, redis, 2 LSP, semgrep | — | descriptions at launch; body on invoke | stage 2 (grilling + domain-modeling), stage 6 (tdd, named descriptively → 0 fires R02), `/refine` (wayfinder) | personas list `i-have-adhd` + `show-me` (R01 §4) |
| `.mcp.json` | context7 MCP | 8 / 120 | launch | any session | duplicate of `context7` plugin |
| `docs/agents/{domain,issue-tracker,triage-labels}.md` | per-repo answers for mattpocock skills | 53 · 55 · 20 | when the plugin skill reads them | `/issue`, `/refine`, wayfinder, triage, to-spec | the #587 replacement for vendoring |
| `docs/agents/personas/{analyst,developer,qa,spec-reviewer}.md` | role prompts | 81 · 107 · 77 · 71 | `make agent ROLE=` → `claude -p` system prompt (`Makefile:484-488`, since `a8480e26`); fleet SOUL source | fleet roles; not the laptop /crq | R01 said "never by Claude Code" — `make agent` predates it; "a tool, not a process" vs crq (F12 #23) |
| `.husky/commit-msg` · `pre-commit` | git hooks | 73 · 2 | on `git commit` | any committer; needs `cz` | CLAUDE.md commit block |
| `.claude/SPRINTS.md` · `.claude/manual-test-cases.csv` | legacy | 4,333/281,171 · 85/15,975 | never (no reference anywhere) | nobody | — |

Fixed launch cost today: CLAUDE.md 32.8 KB + agent-output 5.7 + `~CM` 5.4 + repo descriptions ~10.3 = **~54 KB ≈ 13.5k tokens** before plugin listings
(R01 §5 measured ≈53 KB). A stage-7 standards reviewer starts at ≈84 KB (CLAUDE.md + agent + 46 KB rubric).

**Differs from the old map's measurements:** repo skills 34 (R01, incl. 19 vendored) → **15** after #587 · `smoke-spec` 23,988 → 29,416 B ·
`~CM` 4,445 → 5,427 B · R01's settings bug fixed · F08 §4 / F14 §5 describe the #643 WIP shape (`.agents/skills`, AGENTS.md primary, "18 skills"), not master ·
G1b (rules → nested AGENTS.md), G20 (static load check in `make lint`; no `@AGENTS`/32 KiB check in `scripts/` or `Makefile`), G23 (crq in the
skills plugin) — none landed; #643 WIP moves crq into `.agents/skills/crq` instead (F12 §4).

### A2 · How /crq stages 0–10 invoke the pieces

```
always loaded ─ CLAUDE.md 32.8K · agent-output (hook) · ~CM (laptop) · descriptions · hooks fire on every tool call
                                                                       │ path rules + module CLAUDE.md join on first matching READ
/crq <id>  (.claude/commands/crq.md)
 0 sweep ────── aruvii-cleanup ─► scripts/cleanup-finished-work.sh (asks GitLab)         crq.md:47
 1 anchor ───── glab issue view ; no issue → /issue (docs/agents/*, wayfinder)            crq.md:68
 2 grill  HITL─ mattpocock-skills:grilling + :domain-modeling (plugin) ─► issue comment   crq.md:77   ✗ says "vendored"
 3 spec ─────── docs/spec/REQ-<issue> | amend REQ | ACs in issue    (no skill named)      crq.md:99   ✗ AC-writing skill unused
 4 UI ───────── .claude/wireframes/*.html                                                  crq.md:136
 5 draft MR HITL aruvii-git ─► glab mr create --draft
             ├─ spec-design-reviewer ⟵ preload spec-review (+MEMORY.md)                   crq.md:209
             └─ architecture-reviewer ⟵ preload architecture-review (all but F-01)        crq.md:214
             └─ human posts /approved @SHA                                                 crq.md:231
 6 implement ── mattpocock-skills:tdd (descriptive) · aruvii-standards · it-testing · smoke-spec · flyway-migration
                make test-module / verify-module ; hooks: migration block, JUnit/IT/Mockito warn   crq.md:251
 6a deslop ──── deslop skill ─► make verify-module                                         crq.md:294
 7 self-review /code-review ─┬─ code-standards-reviewer ⟵ standards-review (86)            crq.md:334
                             ├─ architecture-reviewer ⟵ group A + F-01 vs approved SHA
                             └─ smoke-spec-reviewer ⟵ smoke-spec (if smoke touched)
 8 verify ───── /dod (dod.md) + make verify-full / smoke FULL=1 / smoke-open + deployed-stamp ; AC cite both ways   crq.md:364
 9 undraft HITL glab mr update --ready ; human merges (block-commit-on-master, 403)         crq.md:410
10 sweep ────── cleanup-finished-work.sh once                                              crq.md:429
not reached by crq: gherkin-to-test · acceptance-criteria-writing · hook-from-rule · show-me · personas · v1-status (named at 8 only as an aside)
```

### A3 · Local dev setup, and how an agent session uses it

| piece | what it is | how an agent session uses it |
|---|---|---|
| `Makefile` (538 lines, 60+ targets) | front door; CLAUDE.md "never hand-assemble a gate" | loop: `test-module`/`it-module`/`verify-module MOD=` (stage 6/6a); gate: `verify-full`, `smoke [FULL=1] [DEPLOY=0]`, `smoke-open` (stage 8); `deploy ONLY=`, `dev`, `status`, `next`, `lint`, `doc-drift`; `agent ROLE=` for personas. `Bash(make *)` is allow-listed |
| `make doctor` → `scripts/doctor.sh` | read-only probes: JDK vs `.sdkmanrc`, Node vs `.nvmrc`, Docker, memory, `cz`, ports, secrets, foreign stacks (Makefile:73-77, F08 §4) | pre-sprint step; silent unless a blocker; `cz` missing = blocker |
| hooks around make | `guard-concurrent-build` (another `make verify` running), `warn-piped-gate` (`| tail`) | advise only; ITs contend for Docker if two builds run |
| worktrees | `.claude/worktrees/<prefix>+<rest>`, one branch each; `scripts/link-worktree-stack-files.sh` | every /crq runs in one; fresh worktree lacks `node_modules` (F11 #32); never `make secrets` in a worktree |
| shared Compose stack | one stack for all worktrees; last deploy wins; `make status` / smoke banner print `STALE`; `scripts/deployed-stamp.sh` | stage-8 evidence must carry `deployed: <branch> @ <sha>` = MR head; stack is a queue, never deploy over a running smoke; hard-coded ports block a 2nd stack (#318, F12 #40) |
| toolchain files | `.sdkmanrc` `java=25.0.3-tem` · `.nvmrc` `22` | read by sdkman/nvm in the dev's shell and by doctor; `mise.toml` #713 not built (F14 §1) |
| `.husky` | `commit-msg` (cz shape + body gate) · `pre-commit` (`aruvii-ui` lint-staged) | refuses bodyless commits; needs `cz` on PATH |
| outside the repo | `glab auth`, `make secrets` master key, marketplace plugins, `~CM` | not in a clone; a second dev lacks them (F08 §4) |

## B · How references and industry wire a project's agent setup (summary; reuses R03, R34, F14 §1/§2/§5)

| ref @ clone SHA | files by kind (count) | root file (lines / bytes) | when it loads | who reads it — how the pipeline invokes skills/agents | overlaps / dup handling | local dev setup |
|---|---|---|---|---|---|---|
| **pstack** (cursor-plugins @2eb7ed4) | 47 skills (46 `disable-model-invocation`, only `setup-pstack` model-invocable) · 2 agents · playbooks under `poteto-mode/` · no root file | none in the plugin; per-machine `pstack-models.mdc` written by `/setup-pstack` | typed-only: router `poteto-mode` names leaf `principle-*` skills, read in full on use (R64a D1–D2) | coordinator chat runs a playbook; `orchestrate.md` authors a 9-field brief per unit, spawns cloud worker + non-author verifier (orchestrate.md:11-17) | one idea per leaf; router names, never restates (R03 pattern 2) | none local; workers in cloud (F14 §1) |
| **firstmate** (@549e07f) | `AGENTS.md` + `CLAUDE.md`=`@AGENTS.md` · 29 skills `.agents/skills` (`.claude/skills` symlink) · hooks: `.claude/settings.json` (SessionStart, PreToolUse, UserPromptSubmit, Stop) + `.codex/hooks.json` · adapters `.cursor .pi .opencode .omp .grok` · `bin/` 200+ scripts · `.no-mistakes.yaml` · `.tasks.toml` | 426 / 47,958 (F01: 7,244 words at newer head, ceiling 9,000) | always; skills "only at its stated trigger" via `agent-skill-trigger-index` (R64b D1) | firstmate (coordinator, never codes) writes brief §11 (AGENTS.md:379), spawns crewmate in worktree; `no-mistakes` owns review/test/PR | prune over append; one owner per schema (`docs/configuration.md`, AGENTS.md:55) | "the clone is the distro"; toolchain check, installs after consent (README:39,65) |
| **forge** (@43d360e) | `AGENTS.md` · 15 skills `.agents/skills` (`.claude/skills` dir copy) · `docs/adr` (37 here) · `Makefile` (`check` = flake-check, tofu-test…) · `flake.nix` | 35 / 1,695 here (R64d: 54 at newer head) — code style + writing only | always; forge appends its own text to the harness prompt, empty `CLAUDE_CONFIG_DIR` per run (ADR-0057) | **service, not prose**: label `forge:ready` → workload (dispatch/revision/conflict) (ADR-0016, R64d D3) | process lives in code + ADRs, not in agent text | workload runs in the repo's flake devshell (ADR-0027); repo installs its own deps (ADR-0072) |
| **mattpocock** (@d81f3a1) | `CLAUDE.md` ← `AGENTS.md` symlink · 37 skills in buckets · `docs/` · `.out-of-scope/` · `.agents/adr` | 25 / 3,850 — repo invariants only | always; skills user- or model-invoked (that choice decides listing cost, R03) | human types grilling → to-spec → to-tickets → implement; review subagents 2 axes (R64c D6) | single source per meaning; per-repo answers written by `setup-matt-pocock-skills` into `docs/agents/*.md` | none; harness's job (F14 §1) |
| **humanlayer rpi** (humanlayer @99abe67) | `CLAUDE.md` + 8 nested `CLAUDE.md` · 27 commands · 6 read-only agents (`codebase-locator/analyzer`, `thoughts-*`…) · settings: 1 allowlisted script, `MAX_THINKING_TOKENS` | 88 / 3,176 | root always; nested on read | `/research_codebase` → `/create_plan` → `/implement_plan` → `/validate_plan`, fresh session per phase, files in `thoughts/` between (implement_plan.md:7) | 4 nested files are one Bun template copied (R34 §1) | `Makefile` `setup`/`check`/`test`/`worktree` (`hack/create_worktree.sh`) |
| **openclaw** (@b94e5177) | `AGENTS.md` + 34 nested `AGENTS.md` + 4 `CLAUDE.md` · 51 skills `.agents/skills` (`.claude/skills` link) · 11 agents · `.agents/setup`, `.agents/resume` | 145 / 27,918 (long lines) | root always; "Read the nearest scoped AGENTS.md" (AGENTS.md:5-7) | "task defines scope; its chosen workflow owns execution" (AGENTS.md:3); workflow skills (`openclaw-pr-maintainer`, `-release-validation`…) | "Update instructions at their owner instead of adding competing rules here" (AGENTS.md:8); each nested file opens with an ownership line (R34 §1) | `.agents/setup` script; Crabbox/Testbox for large suites (R37 §1) |
| **Claude Code docs** (R64e D1, F02) | CLAUDE.md (or AGENTS.md when no CLAUDE.md) · `.claude/rules` · skills · agents · hooks · settings · managed policy | target <200 lines per file (CC-MEM) | ancestors at launch, subdirs on demand; root survives compaction; descriptions listed, body on invoke | subagents (own context, optional worktree), `/batch`, agent teams; hooks `Stop`/`SubagentStop`/`TaskCompleted` exit 2 = refuse | "context, not enforced configuration" → hooks for must-happen | `.worktreeinclude`, SessionStart hook for deps; cloud: setup script → snapshot (F02 CC-WT/CC-ENV) |
| **Codex docs** (R64e D1, F02) | AGENTS.md chain · `.codex/agents/*.toml` · `.codex/hooks.json` | 32 KiB `project_doc_max_bytes` for the whole chain | concatenated root → cwd at launch, closer overrides; no `paths:` rules | subagents when asked or when AGENTS.md "requests delegation" (CDX-SUB) | precedence differs from Claude Code (concat vs replace) | OS sandbox modes; cloud setup script, secrets only in setup (F02 CDX-CL) |

THEIR WHY (≤20 words each, from the cited source)
- pstack: descriptions "sat in the skill list of every session" → typed-only; "the brief is the product" (R64a D1; orchestrate.md:11).
- firstmate: "every agent's context stays lean"; "Everything that matters survives the death of any conversation" (R64b D1; VISION.md:43).
- forge: a run behaves "as it would for a developer in that repository"; shared config lets a workload change later runs (ADR-0057, R64d D11).
- mattpocock: implementer has the most context pressure → standards belong to review; a document restating the environment "is a cache" (R64c D1, R34 §1).
- humanlayer: one phase per context; "shortest path that gives the user useful review points" (R64c D3).
- openclaw: 20,000-char bootstrap cap truncated the root → rules moved to owners (R64d D1).
- Anthropic/OpenAI: context rot; bloated CLAUDE.md "cause Claude to ignore your actual instructions"; verification beats instruction (R64e D1, cross-cutting 1–2).

Ours on the same columns: 1 root (482 / 32,775) restating 7 path rules + 6 unlinked module files; 15 skills + 5 commands + 4 agents all
model-listed (only rubrics effectively preload-only); process = 464-line prose command run by one session; local setup = Makefile + doctor +
one shared stack. Closest analogues: rulebook shape → firstmate (big root, skills at triggers); pipeline shape → humanlayer (phases as commands);
neither has its artefact/state layer (Part C).

## C · Where the foundations (F15) live in each setup, and where ours lacks them

| foundation (F15 §coherent, §basic) | pstack | firstmate | forge | mattpocock | humanlayer rpi | openclaw | Claude Code / Codex | **agent-platform** |
|---|---|---|---|---|---|---|---|---|
| **one artefact every step reads/writes** | brief (9 fields: ACCEPTANCE, VERIFY, REPORT head SHA), `orchestrate.md:11` | brief file, "Captain's intent" verbatim = acceptance criteria (AGENTS.md:379-395, :382) | ticket + revision brief listing every feedback item (ADR-0016; ADR-0062 via F15) | decision ticket, one decision each (R64c D4) | `thoughts/shared/plans/*.md` with phases + success criteria (implement_plan.md:7) | the task / PR; workflow skill owns it (AGENTS.md:3) | none prescribed; session + PR are the carrier (F02) | **absent** — a different artefact per stage (`crq.md:19-33` table: issue comment, REQ, wireframe, MR, notes); intent→acceptance→gate not joined (F15 §coherent) |
| **unit of work, one identity** | unit row id → branch → PR → head SHA (`orchestrate.md:27`, `units.tsv`) | task id, `state/<id>.status` (AGENTS.md:63) | ticket → workload (ADR-0016) | one ticket per session (R64c D3) | ticket file `thoughts/…/tickets/eng_1234.md` (create_plan.md:30) | task; one owner per directory | issue → branch → one PR (F02 same-way 1) | **stated, broken** — CLAUDE.md "One issue → one branch → one MR" + `crq.md:35`; spec-only map MRs + stacks !227←!253←!258 (F12 #1–2); `!258` `docs(spec)` with 406 files (F12 #32) |
| **one source of truth for state** | `units.tsv` / orch store (`scripts/orch/store.ts`) | `data/` + `state/` + `bin/fm-crew-state.sh` owns reconciliation (AGENTS.md:53-66); backlog via `.tasks.toml` | forge store + labels (ADR-0062) | the issue tracker, configured in `docs/agents/issue-tracker.md` | `thoughts/` + Linear (`linear.md`) | nested AGENTS.md ownership lines | harness session list / PR state | **absent** — MR notes, Verifier notes (fleet), `wayfinder:grilling` label, worktrees; only `aruvii-cleanup` reads forge state (F12 #29–30) |
| **done, per kind of work** | verifier ladder live-ui > unit > type (R64a D7) | DoD lib + `no-mistakes` (`.no-mistakes.yaml`); scout vs ship outcomes (AGENTS.md:241-252) | dispatch / revision / conflict each own a success check (R64d D3, ADR-0065) | research "open no PR" (R64c D8); else harness | automated vs manual success criteria per plan (implement_plan.md:52-54) | per-workflow skill (release, PR, QA) | `Stop`/`TaskCompleted` hook = one check, any kind | **one for all** — CLAUDE.md §Done means; `dod.md` single checklist, `aruvii-api` hard-coded (F12 #20); kinds exist only for the spec decision (`crq.md:109-111`); small fixes merge without it (F12 #28) |
| **who decides what** | coordinator decides; human only for irreversible/product (`principle-never-block-on-the-human`, R64a D5) | §7 *Intake and authority* (:164), §9 *Escalation* (:307), *Captain instruction precedence* (:412) | human label `forge:ready`; only OWNER/COLLABORATOR count (ADR-0063 via F15) | facts = agent, decisions = human (grilling, R64c D5) | human reviews between phases (R64c D3) | "Explicit user instructions take precedence" (AGENTS.md:4-5) | managed settings / permissions (F02 CC-MS) | **scattered over 5 files, one outside the repo** — `crq.md` Notes ("agent never gives itself either"), crq stage 2 "never answer your own questions", `~CM` "pick the default" + "no structural change without go-ahead" (F12 #19), personas "a human with the authority", `fleet-spawn` counts one login (F12 #36–37) |

Where each foundation sits **in the setup files**: references put the artefact and state layer in one named file or service
(pstack `orchestrate.md` + `units.tsv`, firstmate AGENTS.md §2/§7/§11 + `bin/`, forge ADRs + service, humanlayer `thoughts/` + commands) and keep
the always-on rulebook for conventions. agent-platform's always-on CLAUDE.md and `crq.md` carry conventions, process and incident history
together (R34 §0: 17 issue refs), while unit/state/done/decision rights have no file of their own — the only machine-checked links are
the 3 blocking hooks, `.husky/commit-msg`, and GitLab's 403 on master (A1; F15 §coherent "most links as text").
