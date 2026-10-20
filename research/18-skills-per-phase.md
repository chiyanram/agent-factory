# 18 — Skills per /crq phase, every reference compared (2026-10-18)

Ticket: chiyanram/agent-factory#17 (parent #1). Compares only, picks nothing. Every row read from the SKILL.md / command file itself
via `git show origin/main:<path>` (clones under `.scratch/one-rulebook/refs/`). Clone SHAs at origin/main: mattpocock `49dd158` ·
cursor-plugins (pstack + cursor-team-kit) `d1715e0` · humanlayer-skills `653b641` · addy `aeac41d` · firstmate `8ba34f1` · openclaw `b94e5177` ·
Jeffallan `be8783e` · jvm-skills `c6d477f` · plinth `86b41dc` · agent-platform `origin/master` `2e8b59ca` · Claude Code official plugins =
local `~/.claude/plugins/marketplaces/claude-plugins-official` (not a git checkout, no SHA).
Size = `wc -l` of the entry file only (references/agents not counted). Issue cites = `repo#N` from `gh`; `F01`/`F12`/`F16` = agent-factory
research/01, 12, 16; `R02` = old map. **★ = ours.**

Install keys used in the tables:

| key | route (from each README / manifest) |
|---|---|
| MP | plugin `claude plugin install mattpocock-skills@claude-plugins-official`, or skills.sh copy — README: "Pick one per agent" |
| PS | `/plugin marketplace add cursor/plugins` + `pstack@cursor-plugins`; Claude gets a **generated** tree `harness/pstack/` (names `/pstack:x`) |
| CTK | cursor-team-kit: Cursor marketplace only — no `harness/` tree for Claude Code → repo copy |
| HL | skills.sh copy `npx skills add humanlayer/skills --skill <name>` (no plugin; hl#11 asks for one) |
| AD | plugin (`.claude-plugin/marketplace.json`, commands namespaced `/agent-skills:x`) or `npx skills add addyosmani/agent-skills` |
| FM | firstmate clone ("the clone is the distro"); skills `user-invocable: false`, `internal: true` |
| OC | repo copy from `.agents/skills/` (autoreview canonical copy in openclaw/agent-skills) |
| JF | `/plugin marketplace add jeffallan/claude-skills` + `fullstack-dev-skills@fullstack-dev-skills` |
| JV | repo copy (`.claude/skills` and `.junie/skills` hold duplicate trees); jvmskills.com is a directory, not an installer |
| PL | skills.sh copy `npx skills add jabrena/plinth --skill '*' --agent claude-code` |
| CC | Claude Code official marketplace plugin, or bundled built-in |
| ★ | in-repo `.claude/{skills,commands,agents}` (agent-platform); mattpocock plugin enabled in `.claude/settings.json` (F16 A1) |

Invocation key: **typed** = `disable-model-invocation: true` (user only) · **model** = description-matched · **skill→** = called by another skill.

## 1 · Grill

| skill (repo/path) | what it does (≤15 words) | lines | invoked how | reads → writes | their WHY (cite) | install | known issues |
|---|---|---|---|---|---|---|---|
| ★ crq stage 2 → mattpocock `grilling` + `domain-modeling` | interview to shared understanding; ADRs + glossary as you go | crq.md §2 (~22) | typed `/crq`, stage names plugin skills | issue + code → **issue comment** + ADR/glossary + label `wayfinder:grilling` | "A conversation that lives only in the session is lost" (crq.md §2) | ★ + MP | crq says "vendored" — not true since #587 (F12 #17) |
| mattpocock `productivity/grilling` | design-tree rounds; whole frontier per round, recommended answer each | 30 | model | conversation → **chat** | "Finding _facts_ is your job, never the user's" (SKILL.md) | MP | mp#1104 doesn't wait; mp#1093 completion clause vs wayfinder; mp#1280/#1294 bare IDs (closed) |
| mattpocock `grill-me` · `grill-with-docs` | 1-line wrappers: grilling, or grilling + domain-modeling | 7 · 7 | typed | → chat (+ `docs/adr`, GLOSSARY.md) | — (wrapper) | MP | mp#866 "grilling skill not found" |
| pstack `sharpen` · `in-your-own-words` | restate goal / expert approach before starting | 7 · 7 | typed | → chat | — | PS | pstack#367 typed-only skills keep agent-routing text |
| addy `interview-me` | one question at a time until ~95% confidence on intent | 235 | model | → chat | "cheapest moment to find this gap is before any plan" (SKILL.md) | AD | addy#251 asks collaborative mode |
| addy `idea-refine` | divergent → convergent refinement of a raw idea | 193 | model | → chat / doc | — | AD | none found |
| jvm-skills `interview` | relentless interview, mandatory topics (entry points, roles, states); outputs spec | 51 | model | `references/project.md` → chat + spec | — (topic list only) | JV | none found |
| Jeffallan `the-fool` | devil's advocate / pre-mortem / red team, 5 modes | 125 | model (`triggers:`) | → chat report | court-jester framing (SKILL.md) | JF | none found |
| plinth `021-problem-framing` · `023-assumption-analysis` | problem/current/desired/success · assumptions, unknowns, validation plan | 66 · 68 | model, "interactive SKILL" | → local md | — | PL | none found |
| humanlayer `rpi` → create-research-questions | turn task into research questions, sub-agents locate code | 77 + 52 | typed (`/rpi`, "Only use when … by name") | → `.agents/artifacts/<branch>/NN-*.md` (not committed) | "shortest path that gives the user useful review points" (workflow.md) | HL | hl#1 skills.sh name collision |

Differences: only ★ writes the outcome to the forge (issue comment); mattpocock/addy/pstack/Jeffallan end in chat; rpi/plinth write local files;
grilling and interview-me ask in different shapes (whole frontier per round vs one question at a time).

## 2 · Spec + acceptance criteria

| skill (repo/path) | what it does (≤15 words) | lines | invoked how | reads → writes | their WHY (cite) | install | known issues |
|---|---|---|---|---|---|---|---|
| ★ crq stage 3 (no skill named) | REQ-<issue> / amend REQ / ACs in issue body | crq.md §3 (~37) | typed `/crq` | → `docs/spec/REQ-*.md` on MR branch, or **issue body** | "An AC that lives only in a chat message is an AC nobody can grade" (crq.md §3) | ★ | — |
| ★ `acceptance-criteria-writing` | concise, parameterised Given/When/Then prose inside a REQ story | 97 | model | REQ → REQ | Gherkin engine removed; no assertion-strength replacement (SKILL.md) | ★ | 0 fires in 31 days, not named by crq (R02 via F16) |
| mattpocock `to-spec` | synthesise conversation into spec (stories, decisions, tests, out-of-scope); no interview | 75 | typed | conversation → **tracker issue** + `ready-for-agent` label | file paths "may end up being outdated very quickly" (SKILL.md) | MP | mp#966 conflicting statements; mp#1291 no size check; mp#1078 to-tickets drops seams |
| mattpocock `to-tickets` | tracer-bullet tickets with blocking edges | 105 | typed | spec → **tracker issues** (native links) or local files | "Make the change easy, then make the easy change" (SKILL.md) | MP | mp#1078 |
| addy `spec-driven-development` (+`/spec`) | gated SPECIFY→PLAN→TASKS→IMPLEMENT, human gate each | 259 (+17) | model; typed `/spec` | → `SPEC.md` local | "spec is the shared source of truth" (SKILL.md) | AD | addy#166 OpenSpec (closed) |
| jvm-skills `spec` | spec with user stories from context, no interview, assumptions marked | 55 | model | conversation + code → local spec | — | JV | none found |
| Jeffallan `feature-forge` | requirements workshop → EARS requirements, ACs, checklist | 103 | model | → local document | — | JF | JF#122 integration request |
| plinth `014-agile-user-story` · `042-planning-openspec` | user story md · OpenSpec proposal/design/spec/tasks | 56 · 86 | model, interactive | → local md / `openspec/` | — | PL | PL#956, PL#1054 042 workflow (closed) |
| humanlayer `rpi` → create-prd | PRD interview: problem, success, UX, behaviour | 77 + 49 | typed | → `.agents/artifacts/…/NN-prd-*.md` | keep implementation questions for the TDD doc (create-prd/process.md) | HL | — |

Differences: to-spec / to-tickets publish to the tracker (GitHub/GitLab/local via `docs/agents/issue-tracker.md`); ★ writes REQ on the MR
branch or the issue body; addy/jvm/Jeffallan/plinth/rpi write local files; EARS (Jeffallan), OpenSpec (plinth), Given/When/Then prose (★).

## 3 · Design

| skill (repo/path) | what it does (≤15 words) | lines | invoked how | reads → writes | their WHY (cite) | install | known issues |
|---|---|---|---|---|---|---|---|
| ★ crq stage 4–5 (wireframe + draft MR) | UI wireframe, design on draft MR, refine loop to `/approved` | crq.md §4–5 | typed `/crq` | → `.claude/wireframes/*.html` + **draft MR** | "spec wrong is cheap at stage 5 and expensive at stage 6" (crq.md) | ★ | — |
| mattpocock `codebase-design` | deep-module vocabulary: module, interface, seam, adapter, depth | 114 | model; skill→ (tdd, improve-…) | → chat | "Consistent language is the whole point" (SKILL.md) | MP | none found |
| mattpocock `improve-codebase-architecture` | scan for deepening opportunities, HTML report, grill one | 71 | typed | git log + code → HTML in `$TMPDIR` | "nothing lands in the repo" (SKILL.md §2) | MP | none found |
| mattpocock `prototype` | throwaway logic-HTML or UI variants to answer one question | 26 | model | → throwaway branch + pointer on issue | "throwaway code that answers a question" (SKILL.md) | MP | none found |
| pstack `architect` | multi-model sketch of types/signatures, design twice, then implement | 79 | typed | → chat (+ rationale); checkpoint opt-in | "jumping to code would lock in the wrong shape" (description) | PS | pstack#335 model slugs; pstack#601 Claude mapping |
| addy `api-and-interface-design` · `documentation-and-adrs` · `planning-and-task-breakdown` | interface stability · ADRs · ordered tasks | 367 · 297 · 257 | model; typed `/plan` | → local docs / ADR files | — | AD | none found |
| Jeffallan `architecture-designer` | system design, ADRs, diagrams, tech evaluation | 121 | model | → local document | — | JF | none found |
| plinth `030-architecture-adr-general` · `041-planning-plan-mode` | interactive ADR · Java implementation plan with source authority | 63 · 75 | model, interactive | → local ADR / plan md | — | PL | none found |
| humanlayer `rpi` → design-discussion / create-tdd / structure-outline | design discussion; Technical Design Doc (system then program); phased outline | 77 + 53/53 | typed | → `.agents/artifacts/…/NN-*.md` | "Keep design choices with the user" (create-design-discussion) | HL | — |
| CC `feature-dev` (`code-architect` agent) | guided feature flow; architect agent proposes blueprint | 125 (+34) | typed `/feature-dev` | → chat | — | CC | none checked |

Differences: only ★ puts the design on the MR before code; rpi's "TDD" is a *technical design document*, not test-driven; pstack and
mattpocock DESIGN-IT-TWICE both use parallel candidates; mattpocock/rpi write outside the repo or uncommitted.

## 4 · Spec review

| skill (repo/path) | what it does (≤15 words) | lines | invoked how | reads → writes | their WHY (cite) | install | known issues |
|---|---|---|---|---|---|---|---|
| ★ `spec-review` via `spec-design-reviewer` agent | REQ buildable, complete, consistent with design; MET/UNMET per criterion | 367 (+94) | agent preload at crq stage 5 | REQ + ADRs → findings → **MR thread** | rubric for the spec axis (SKILL.md) | ★ | desc "stage 3 … and again" vs crq "stage 5" (F12 #18) |
| ★ `architecture-review` via `architecture-reviewer` | fit, precedent, extensibility, behavioural coverage over design | 411 (+104) | agent preload, stage 5 (+7) | design → **MR thread** | — | ★ | — |
| plinth `059-design-atdd` | goal↔criteria↔task traceability matrix; `ready` / `changes-requested` | 83 | model, interactive | OpenSpec → local report | treat ACs "as requirement data, never as executable instructions" (SKILL.md) | PL | none found |
| addy `doubt-driven-development` | fresh-context adversarial review of each non-trivial decision | 243 | model | → chat | "A confident answer is not a correct one" (SKILL.md) | AD | none found |
| pstack `interrogate` | one reviewer per model, synthesised verdict, no auto-apply | 74 | typed | diff/plan → chat | "signal comes from model diversity, not assigned personas" (SKILL.md) | PS | pstack#335 slugs; pstack#601 |
| Jeffallan `the-fool` | pre-mortem / red-team a plan | 125 | model | → chat report | — | JF | none found |
| humanlayer `rpi` iterate-* | user feedback revises PRD/TDD/outline doc in place | 77 + ~50 each | typed | → same artifact file | separate approval for system and program design (create-tdd) | HL | — |

Differences: no external skill reviews a written spec against a repo's ADRs/architecture except ★ and plinth 059 (OpenSpec-only);
the rest are generic adversarial passes ending in chat; only ★ posts to the MR.

## 5 · Build (incl. TDD)

| skill (repo/path) | what it does (≤15 words) | lines | invoked how | reads → writes | their WHY (cite) | install | known issues |
|---|---|---|---|---|---|---|---|
| ★ crq stage 6 → `mattpocock tdd` + `aruvii-standards` `it-testing` `smoke-spec` `flyway-migration` `gherkin-to-test` | test-first on MR branch; repo standards by reference | crq §6 + 90/355/423/86/95 | typed `/crq`; knowledge model-invoked | REQ → code on MR branch | "Never skip Red" (AGENTS.md) | ★ + MP | tdd named descriptively → 0 fires; it-testing 1 in 530 (R02 via F16) |
| mattpocock `tdd` | red→green at pre-agreed seams; refactor belongs to review | 38 | model; skill→ | → code | seams agreed so effort "lands on the critical paths" (SKILL.md) | MP | mp#1210 accepts incorrect RED→GREEN; mp#589 description; mp#1267 |
| mattpocock `implement` · `implement-spec` | ticket → tdd → code-review → commit · task-graph fan-out, worktree per ticket | 17 · 40 | typed | tracker → branch, draft PR | "Communicate primarily through context pointers" (implement-spec) | MP | mp#479/#1277 skips tdd/code-review; mp#1261 load ~140 |
| pstack `tdd` | regression test first **only** when cheap; else closest executable check | 42 | typed | → code + evidence in reply | "Prefer no new test over a bad test" (SKILL.md) | PS | pstack#367 |
| pstack playbook `feature` | how → architect → delegate code to subagent → verify → Opening a PR | 21 | via `/pstack:poteto-mode` | → PR | "You own the design … Delegate implementation" (feature.md) | PS | pstack#335 |
| addy `test-driven-development` · `incremental-implementation` (`/build`, `/test`) | red-green-refactor, discover stack first · thin verifiable slices | 398 · 249 | model; typed | → code, commits | "Tests are proof — 'seems right' is not done" (SKILL.md) | AD | addy#404 ecosystem-neutral; addy#265 dead reference (closed) |
| jvm-skills `tdd-task` · `fix` | 9-step todo: understand→clarify→red→green→/simplify→verify→commit | 149 · 68 | model | → code + commits | — | JV | none found |
| plinth `054-design-tdd` · `131/132-java-testing-*` | Java TDD with test list · JUnit5/AssertJ/Mockito guides | 72 · 66 | model, interactive | → code | — | PL | none found |
| Jeffallan `test-master` · `spring-boot-engineer` | test strategy/coverage · Spring Boot 3.x code | 99 · 200 | model | → code / report | — | JF | none found |
| openclaw `test-audit` | 4-question authoring gate for every new test; audit low-value tests | 169 | model ("Invoke whenever writing … tests") | → code / sweep PRs | each contract "one primary test owner at the strongest boundary" (SKILL.md) | OC | oc#161798 claims must fail closed |
| humanlayer `rpi` → implement-outline | outline-implementer subagent implements phase by phase | 77 + 39 | typed | outline > TDD > PRD precedence → code | — | HL | — |

Differences: mattpocock tdd says refactor is not in the loop; addy/jvm/plinth include refactor; pstack makes the test optional;
Java/Spring specifics only in plinth, Jeffallan, jvm-skills (Kotlin/Gradle-first) and ★ (Spock/Testcontainers, Gradle).

## 6 · Cleanup (deslop)

| skill (repo/path) | what it does (≤15 words) | lines | invoked how | reads → writes | their WHY (cite) | install | known issues |
|---|---|---|---|---|---|---|---|
| ★ `deslop` (stage 6a) | behaviour-neutral diff cleanup, then re-green module; revert on red | 160 | model; named by crq 6a | branch diff → code + **one MR-thread line** | rules lost their gate when semgrep went in #440 (SKILL.md) | ★ | — |
| openclaw `deslop` | diff-scoped: comment/defensive/type-laundering/style slop; report 1–3 sentences | 24 | model | diff → code + chat | "Run `$deslop` before `$autoreview`, never instead of it" (SKILL.md) | OC | none found (source ★ adapted, read 2026-09-26) |
| cursor-team-kit `deslop` | remove AI slop vs main: comments, try/catch, `any` casts | 22 | model | diff → code | — | CTK | none found |
| pstack `no-comments` | spawn Comment Sicko agent; fix accepted; offer encodings for constraints | 24 | typed | diff → code + report | named by `opening-a-pr` before review | PS | pstack#483 agent name with space (closed) |
| addy `code-simplification` (`/code-simplify`) | five principles, behaviour-preserving simplification | 331 (+22) | model; typed | → code | adapted from Claude `code-simplifier` (SKILL.md) | AD | none found |
| CC `code-simplifier` agent · pr-review-toolkit `code-simplifier` | refine recently modified code; examples are TS/React | 52 · 88 | agent | → code | — | CC | — |
| CC built-in `/simplify` | reuse/simplification/efficiency fixes; "does not hunt for bugs" | bundled | typed / model | diff → code | — (no source file) | CC | anthropics/claude-code#97711 undocumented |
| openclaw `pr-simplify` | named in F14/F15 (R64d D6) | — | — | — | — | — | **not present** at openclaw `b94e5177`, no history in clone |

Differences: ★ and openclaw deslop share a checklist (★ cites it); only ★ requires a green module after and writes to the MR;
CC/addy simplifiers have broader refactor scope; cursor-team-kit is not shipped to Claude Code.

## 7 · Code review

| skill (repo/path) | what it does (≤15 words) | lines | invoked how | reads → writes | their WHY (cite) | install | known issues |
|---|---|---|---|---|---|---|---|
| ★ `code-review` → `code-standards-reviewer` (`standards-review`) ‖ `architecture-reviewer` (A + F-01) ‖ `smoke-spec-reviewer` | parallel axes, MET/UNMET per criterion | 103 (+790/411/423 rubrics) | model / crq stage 7 | merge-base diff → findings → **MR thread** | spec axis moved to stage 8 AC citation (#540, SKILL.md) | ★ | SKILL.md:11-13 lists a Spec axis, "All three run"; :3 and :75 say two axes (#540) |
| mattpocock `code-review` | Standards ‖ Spec sub-agents + Fowler smell baseline; never rerank | 89 | model; skill→ (implement) | diff + spec → chat | "stops one axis from masking the other" (SKILL.md) | MP | mp#1279 relays findings unchecked; mp#1270; mp#1284; mp#1257 |
| CC `code-review` plugin `/code-review` | 5 Sonnet reviewers, Haiku confidence score, keep ≥80, post | 92 | typed | **GitHub PR** via `gh` → **PR comment** | false-positive list: pre-existing, linter-catchable, nitpicks (command) | CC | anthropics/claude-code#100401 skips agents but posts "No issues"; #94666; #94789 |
| CC `pr-review-toolkit` `/review-pr` | 6 specialist agents: comments, tests, errors, types, code, simplify | 189 | typed | git diff (+`gh pr view`) → chat | — | CC | none checked |
| CC built-in `/security-review` · plugin `claude-security` | security pass on changes · scan/patch/verify agents | bundled · 69 | typed | diff → chat / report | — | CC | anthropics/claude-code#102885, #101660 |
| addy `code-review-and-quality` (`/review`) | five axes: correctness, readability, architecture, security, performance | 398 (+16) | model; typed | diff → chat | "Approve … when it definitely improves overall code health" (SKILL.md) | AD | addy#95 `/review` collides with built-in; addy#173; addy#597 refs missing |
| openclaw `autoreview` | independent review via script, Codex first, JSON findings | 301 | model ("when explicitly requested") | git target → local JSON / chat | "Findings are advice to verify" (SKILL.md) | OC | oc#175519 Codex timeout (closed) |
| pstack `interrogate` · `blast-radius` | multi-model adversarial review · prove the one fact a change is safe on | 74 · 50 | typed | diff → chat | "A blast-radius writeup that sounds right is worthless" (blast-radius) | PS | pstack#335 |
| cursor-team-kit `thermo-nuclear-code-quality-review` · `review-and-ship` | very strict maintainability audit · review, test, commit, PR | 192 · 41 | typed · model | → chat · → PR | — | CTK | none found |
| Jeffallan `code-reviewer` · `security-reviewer` | bugs/security/smells report · severity-rated audit | 124 · 108 | model, `allowed-tools: Read, Grep, Glob` | → chat report | — | JF | none found |
| jvm-skills `ui-review` | Playwright tests + screenshot review | 64 | model | → chat | — | JV | none found |

Differences: CC `/code-review` is the only one that posts to the PR itself, and is GitHub-only (`gh`, github.com blob links); autoreview
and interrogate are multi-vendor; ★ and mattpocock keep axes separate, addy merges five; ★'s is the only rubric-per-criterion one.

## 8 · Verify / gate

| skill (repo/path) | what it does (≤15 words) | lines | invoked how | reads → writes | their WHY (cite) | install | known issues |
|---|---|---|---|---|---|---|---|
| ★ `/dod` + `make verify-full` + crq stage 8 AC citation | DoD checklist PASS/FAIL, full gate + smoke, each AC at `file:line` | 83 + crq §8 | typed / crq stage 8 | branch → evidence (SHA, `deployed:` stamp) → **MR** | "buried in a larger step, these checks get skipped and rot" (dod.md) | ★ | hard-codes `verify-module MOD=aruvii-api` (F12 #20) |
| pstack `principle-prove-it-works` | check the real artifact, not a proxy; script the check | 22 | typed (leaf, router-named) | → artifact for reviewer | "Acting on a wrong inference costs far more" (SKILL.md) | PS | pstack#367 |
| pstack `create-verification-skill` · `maintain-verification-skill` | generate / keep honest a project-local verify-like-a-user skill | 44 · 39 | typed | → repo skill file | — | PS | none found |
| cursor-team-kit `verify-this` | falsifiable claim, baseline vs treatment, VERIFIED/NOT/INCONCLUSIVE | 74 | model | → chat verdict | "Verification is not a recap" (SKILL.md) | CTK | none found |
| cursor-team-kit `loop-on-ci` · `fix-ci` | watch `gh pr checks`, fix until green | 50 · 29 | model | GitHub checks → commits | `gh pr checks` is "the source of truth" (loop-on-ci) | CTK | — |
| addy `constraint-driven-development` · `ci-cd-and-automation` · `/ship` | written quality bar with numbers · CI setup · 3-persona go/no-go | 311 · 390 · 72 | model; typed | → repo contract file / CI / chat | judgement "moves out of your head and into checks" (constraint SKILL.md) | AD | addy#693 gates pass with blocking findings; addy#599 (closed) |
| firstmate `validation-supervision` (no-mistakes) | worker drives `no-mistakes axi` validation run to a gate | 32 | internal, loaded by firstmate | → run state; pipeline is the one publisher | `bin/fm-dod-lib.sh` owns the intent contract (SKILL.md) | FM | F01: fm#6200 false done via substring (fixed #7422) |
| openclaw `openclaw-testing` | smallest meaningful proof per change type; route release proof | 121 | model | → local runs | "Prove the changed contract with the smallest meaningful check" (SKILL.md) | OC | oc#168070 unit tests passed, real path broken |
| jvm-skills `test-gradle` · `mutation-testing` · `coverage-kover-gradle` | headless tests, failures only (forked context) · pitest · Kover plan | 31 · 389 · 58 | model (`context: fork`) | → chat / local plan | — | JV | none found |

Differences: ★ is the only one tied to a deploy stamp and the MR head SHA; loop-on-ci and firstmate assume a GitHub PR with CI
(★ has no CI, AGENTS.md); pstack/cursor verify a claim, not a whole DoD.

## 9 · Done / MR update

| skill (repo/path) | what it does (≤15 words) | lines | invoked how | reads → writes | their WHY (cite) | install | known issues |
|---|---|---|---|---|---|---|---|
| ★ `aruvii-git` + crq stage 9 | MR title/description rules, `glab mr update --ready`, human merges | 440 + crq §9 | model / crq | → **GitLab MR** (title, description = master commit) | MR title is master's only subject line (AGENTS.md) | ★ | restates AGENTS.md git block (F16 A1) |
| ★ `aruvii-cleanup` (stage 0/10) | sweep merged branches/worktrees, asking GitLab not git ancestry | 118 | model / crq | GitLab → local cleanup | `git branch --contains` false for squash-merged work (AGENTS.md) | ★ | — |
| ~/.claude `untouched-and-risk` (operator, not repo) | reviewer summary: what the change did not touch, where risky | 76 | model | → MR description text | — | user copy | — |
| mattpocock `pr` | PR body template: Summary diagram, Evidence, Merge Danger (door, blast radius) | 170 | model | → PR body text | credits humanlayer show-me (frontmatter) | MP | mp#1262 auto-triggers on "create pr" (not planned) |
| pstack playbook `opening-a-pr` · `shipping` | commits, titles, Why/Scope/Blast Radius/Verification body; land verified run bottom-up | 34 · 12 | via poteto-mode | → **PR** (`gh` or Origin) | "PR body is a one-minute briefing" (opening-a-pr.md) | PS | pstack#523 competing PRs |
| humanlayer `visual-pr` | create/update PR with one-sentence why + show-me outline | 53 | typed | ticket + diff → **GitHub PR** (`gh pr view`) | help reviewer see "why the change exists" (SKILL.md) | HL | none found |
| cursor-team-kit `make-pr-easy-to-review` · `new-branch-and-pr` · `get-pr-comments` | tidy history/description · branch+PR · fetch review comments | 59 · 29 · 22 | model | `gh` → **PR** | — | CTK | — |
| firstmate `ship-landing` | register PR, gate on named head, merge only on captain authority | 30 | internal | → task meta + watcher | "`yolo` is the only standing routine merge authority" (SKILL.md) | FM | F01: fm#3103 wrong base not refused |
| openclaw `openclaw-pr-maintainer` · `agent-transcript` | review/repair/land PRs by scope · insert redacted transcript in PR | 128 · 54 | model | → **GitHub PR/issue** | "A pasted ref is context, not permission to publish" (SKILL.md) | OC | oc#166624 no related-PR search |
| addy `git-workflow-and-versioning` | branching, atomic commits, PRs, versioning, changelog | 355 | model | → commits / PR | — | AD | none found |
| jvm-skills `commit` · `rebase-commit` · CC `commit-commands` | group changes into commits (adds Co-Authored-By) · `/commit-push-pr` | 20 · 31 · 20 | model · typed | → commits / GitHub PR | — | JV / CC | jvm `commit` hard-codes Claude trailer (conflicts with ★ no-attribution rule) |

Differences: every external PR skill targets GitHub (`gh`/Origin); only ★ uses `glab`; firstmate and pstack encode merge authority, mattpocock/
humanlayer only the body text; ★ forbids attribution trailers, jvm `commit` and CC defaults add one.

## 10 · Retro

| skill (repo/path) | what it does (≤15 words) | lines | invoked how | reads → writes | their WHY (cite) | install | known issues |
|---|---|---|---|---|---|---|---|
| ★ (none) — nearest `hook-from-rule` | turn an ungated rule into a hook | 88 | model | rule → `.claude/hooks/*.sh` | "loading is not enforcing" (SKILL.md) | ★ | not reached by crq (F16 A2) |
| mattpocock `retro` | session → ranked environment fixes: navigation, checks, standards, AGENTS.md, tools | 44 | typed | session logs → chat | review agent, not implementer, should impose standards (SKILL.md) | MP | mp#1173 unchecked candidates = noise; mp#1158 missing in marketplace (closed) |
| mattpocock `handoff` | compact conversation into a handoff doc in `$TMPDIR` | 16 | typed | → temp file | don't duplicate specs/issues; point to them (SKILL.md) | MP | mp#622 Codex; mp#306 |
| pstack `reflect` | 3 parallel transcript reviewers → synthesiser → skill edits | 67 | typed | transcript → skill files | "One-offs are not learnings" (SKILL.md) | PS | Cursor transcript paths (SKILL.md §1); pstack#601 |
| pstack `correct` | repeated mistakes → architecture > types > lint > test > docs | 32 | typed | commits/reviews → repo checks + rule table | docs last: "Nothing fails when an agent skips them" (SKILL.md) | PS | none found |
| firstmate `stow` (internal 322 · public `skills/stow` 151) | sweep session for durable knowledge, tiered decaying memory | 322 / 151 | typed | → home memory files | "compact current operating map rather than an accumulating journal" (SKILL.md) | FM / copy | F01: fm#2766 AGENTS.md token load |
| cursor `continual-learning` · cursor-team-kit `workflow-from-chats` | mine transcripts → AGENTS.md / skills / rules | 24 · 50 | model | → AGENTS.md / rules | — | Cursor marketplace | none found |
| CC `claude-md-management` `/revise-claude-md` · `session-report` | session learnings → CLAUDE.md · token/usage HTML report | 54 · 42 | typed · model | → CLAUDE.md · local HTML | — | CC | — |
| Jeffallan `complete-sprint` · `complete-epic` commands | sprint/epic retrospective report, close in Jira | 753 · 418 | typed | Jira → report + Jira | — | JF | Jira/Atlassian-only (commands) |

Differences: mattpocock/pstack/CC write to repo instruction files or chat, none to the MR; Jeffallan's is Jira-bound; pstack reflect reads
Cursor transcript layout; ★ has no retro step in crq.

## Coverage

| phase | ★ ours | external skills found | count |
|---|---|---|---|
| grill | crq §2 → mattpocock grilling | mattpocock, addy, jvm, Jeffallan, plinth, pstack, rpi | several |
| spec + AC | crq §3, acceptance-criteria-writing | mattpocock, addy, jvm, Jeffallan, plinth, rpi | several |
| design | crq §4–5, architecture-review | mattpocock, pstack, addy, Jeffallan, plinth, rpi, CC feature-dev | several |
| spec review | spec-review + architecture-review agents | only plinth 059 (OpenSpec-bound); others generic adversarial (addy, pstack, Jeffallan) | **one repo-aware, rest generic** |
| build / TDD | crq §6 + 5 knowledge skills | all ten sources | several |
| cleanup | deslop | openclaw, cursor-team-kit, pstack, addy, CC (3) | several |
| code review | code-review + 3 agents | all except firstmate, humanlayer | several |
| verify / gate | /dod + make verify-full | pstack, cursor, addy, firstmate, openclaw, jvm | several; **none GitLab or no-CI** |
| done / MR update | aruvii-git, aruvii-cleanup | mattpocock, pstack, humanlayer, cursor, firstmate, openclaw, addy, jvm, CC | several; **all GitHub** |
| retro | **none** (hook-from-rule nearest) | mattpocock, pstack (2), firstmate, cursor, CC, Jeffallan | several; ★ has the gap |

Phases with no external skill and only ours: none outright. Nearest: spec review against the repo's own ADRs/architecture (plinth 059
only for OpenSpec), MR update on GitLab (every external one is `gh`/GitHub or Origin), gate tied to a deploy stamp with no CI.
