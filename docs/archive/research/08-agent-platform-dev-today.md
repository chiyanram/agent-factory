# 08 · How agent-platform development works today (agent-factory#7)

Snapshot 2026-10-18. Read-only sweep of: GitLab `ai-agent-build-platform/agent-platform` (via `glab api`),
`~/workspace/agent-platform` (+30 worktrees), 45 local Claude Code transcripts (metadata only),
agent-fleet @`080aabb`, `~/workspace/skills/research/{00-fleet-self-reports,38-vm-gate-runner}.md`, chiyanram/skills#61.
Window for MR stats: merged 2026-09-18 → 2026-10-18 (30 days).

## 1. Who starts work

| actor | where it runs | how work starts | evidence |
|---|---|---|---|
| operator (`chiyanram`) | Claude Code desktop, laptop | opens a session, usually `/crq <issue>` in a worktree | 45 sessions in 17 project dirs; 28 sessions invoke `/crq` |
| fleet: analyst | VM, tmux + Discord plugin | Discord @mention / GitLab comment → grill → REQ + draft MR | GitLab user `aruvii-analyst-agent`; self-report 00 |
| fleet: spec-reviewer | VM | woken by MR mention → stage-5 REQ review rounds | `aruvii-spec-reviewer-agent` |
| fleet: developer | VM | approved story → TDD → `fleet-verify` → MR | `aruvii-developer-agent`, 8 merged MRs |
| fleet: qa | VM | MR mention → REVIEW (≤3 rounds) → VERIFY | `aruvii-qa-agent`; early rounds posted under operator's account (see !214, !230) |
| second human (`drop2kanagaraj`) | own machine | spec-only draft MRs | 1 merged (!190); 18 open drafts |

Fleet provisioning (agent-fleet @080aabb): `scripts/create-agent.sh` (one Discord-connected Claude agent per
`agents/<name>/agent.yaml`, tmux, rerunnable), `update-agent.sh` (re-render CLAUDE.md/persona/skills, restart),
`fleet-say.sh` (type a message into an agent's session, prefixed "relayed via the fleet terminal"),
`verifier/fleet-verify` (submit/wait/status queue; one job per branch, SUPERSEDED if newer queued).
Handoffs: "Discord @mention + GitLab issue/MR comment. No labels anywhere." (00-fleet-self-reports).

### Operator sessions (laptop transcripts, metadata only)

| measure | value |
|---|---|
| sessions / project dirs | 45 / 17 (main checkout + 16 `.claude/worktrees/*`) |
| active days | 19 of 36 (2026-09-13 → 10-18) |
| busiest day | 2026-10-17: 7 sessions (5 started within 5 h); 2026-09-27: 6 |
| max concurrent (open spans) | 6 |
| gap | 2026-10-04 → 10-16: zero sessions, 1 merge (W41) |
| long-lived sessions | several span 100–410 h (one session per epic, resumed over days) |
| sample titles | "CRQ 666", "Pstack integration into CRQ pipeline", "Fix failing stack-env.spec.ts AC-11" |

Desktop sessions create worktrees on `claude/<adjective-name>` or `claude/crq-NNN-xxxx` branches (21 such local
branches); none reached GitLab under that name: all 78 merged MRs use `fix/ chore/ docs/ refactor/ feat/` (branch
renamed or a new `<prefix>/NNN-slug` branch pushed).

## 2. Flow per change

```
GitLab issue (#NNN)
  → worktree .claude/worktrees/<prefix>+<rest>   (or claude/* by desktop, renamed before push)
  → /crq: 0 cleanup · 1 issue · 2 grill · 3 spec REQ · 4 design · 5 review (spec-design-reviewer + architecture-reviewer)
  → draft MR (spec+design only) ── human posts /approved ──►
  → 6 TDD implement · 6a deslop · 7 code-standards-reviewer + architecture-reviewer (A + F-01) · 8 /dod (ACs ↔ file:line)
  → gate: laptop `make verify` / `make verify-full` (deploy + smoke FULL)   |  VM: fleet-verify job (~61 min)
  → MR ready → operator merges (ff + squash; master protected)
```

| stage | who/what | repo artefact |
|---|---|---|
| review agents | 4 subagents, thin over rubrics | `.claude/agents/{spec-design,architecture,code-standards,smoke-spec}-reviewer.md` |
| rubrics | `spec-review`, `architecture-review`, `standards-review`, `smoke-spec` | skills tree (`.claude/skills` on master; `.agents/skills` on !244) |
| gate | `make verify` (no smoke), `make verify-full` (= DoD), `make smoke FULL=1` | `Makefile`, no CI (deleted #440) |
| VM gate | `fleet-verify submit/wait`, result.md + Discord | agent-fleet `verifier/fleet-verify` |
| merge | operator only | 77/78 merged_by `chiyanram`, 1 by `drop2kanagaraj` |

### Last 30 days of merged MRs (n = 78)

| measure | value |
|---|---|
| merged | 78 (W38 15 · W39 27 · W40 29 · W41 1 · W42 6) |
| by type | fix 32 · chore 23 · docs 16 · refactor 4 · feat 3 |
| open → merge | median 8.2 h · p90 80 h · ≤4 h: 28 · >48 h: 13 · max 984 h (!78, REQ-055 #189) |
| author | operator 68 · `aruvii-developer-agent` 8 · `aruvii-analyst-agent` 1 (!168) · drop2kanagaraj 1 (!190) |
| fleet-touched (any agent comment) | 23 of 78 (lower bound: QA posted under operator's token early) |
| zero human comments | 26 of 78 (straight push → merge, mostly chore/docs) |
| explicit `/approved` note | 10 of 78 |
| pushes per MR | median 3.5 · max 38 |
| source branch `claude/*` | 0 |

Fleet-developer MRs: !184 (workspace-scoped collection reads, 16 h), !226 (compose memory bounds, 10 h), !230 (#554 REQ-075 S1,
22 h, 3 QA rounds, 5 Verifier jobs), !241 (5 h), !248 (12 h), !256 (5 h), !257 (67 h), !259 (6 h).

Review rounds visible in notes: !214 (#517 provider pin) 3 dev/QA rounds + isolated `qa-517` stack rebuild;
!230 rounds 1–3 of 3; !258 (REQ-666 runs table, still open) 40 comments, multiple "delta check" re-reviews.

## 3. Where it stalls and what it costs

| pattern | evidence | cost |
|---|---|---|
| Verifier wall time | R29 (research/38): job `133306-d28641` 60m45s = smoke FULL 24m33 (40 %) · Gradle 21m40 (one serial IT task 18m50) · deploy ~10 m | any red re-runs ~61 min; no job split |
| Verifier noise / reruns | !230: FAIL "only known flakes", one ERROR at 0s, one INCOMPLETE, then resubmit on operator's go-ahead | 5 jobs for one MR; ~2 days (self-report) |
| known-flake list lives in Discord | !230 QA note cites flake list "ram set in Discord" | gate status unreadable from MR alone |
| no queue position / cancel / dedupe | skills#61 row 1 (dup job `ddf23e`, #638) | invisible waits |
| spec re-review loops | !258 (40 notes, still draft), !261 (18), !253 (#660 HITL, 35 notes, 14 d open), !239 (#603, 26 notes, 16 d) | days per spec; findings arrive "one round at a time" (self-report) |
| long-open drafts | 35 open MRs; 11 drafts by drop2kanagaraj at 63 d with 0 comments (!49 … !72), !84 56 d, !98 (#312) 54 d, !175–!179 29 d | dead inventory; second developer's work never reviewed |
| failing smoke on agent MR | !214 agent run "715 passed · 46 failed · 7 flaky" | full stack rebuild by QA |
| env drift on VM | self-report: JAVA_HOME/DOCKER_HOST/locale unset, husky `npx: not found`, OOM from 2nd Gradle beside Verifier | per-agent rediscovery; fixed by machine.env (ND-15) |
| stale local master | skills#61 row 4: `git show origin/master` ×7 | wrong diffs in review |
| review token cost | QA round 1 on !230: subagents ~135k + ~167k tokens | per round, per MR |
| operator as single merge/approval point | 77/78 merges, all `/approved` by operator | fleet idle when operator absent (W41: 1 merge) |

## 4. Laptop setup for a second developer

### In the repo (cloned = has it)

| item | path | needed? |
|---|---|---|
| agent instructions | `AGENTS.md` (`CLAUDE.md` = `@AGENTS.md`) | needed |
| path-scoped rules | `.claude/rules/*.md` (7, `paths:` frontmatter) | needed |
| hooks (3 block, rest advise, SessionStart output rules) | `.claude/hooks/*.sh`, wired in `.claude/settings.json` | needed |
| always-on output rules | `.claude/always-on/agent-output.md` | team style |
| review subagents | `.claude/agents/*.md` (4) | needed for /crq 5/7 |
| skills + commands (`crq`, `dod`, `issue`, `refine`, rubrics) | `.claude/skills` / `.claude/commands` (→ `.agents/skills` on !244) | needed |
| plugins declared | `.claude/settings.json` `enabledPlugins`: context7, gitlab, github, pr-review-toolkit, redis-development, jdtls-lsp, typescript-lsp, semgrep, mattpocock-skills, i-have-adhd | mixed: mattpocock-skills needed (triage/to-spec/wayfinder referenced in `docs/agents/`); i-have-adhd personal; semgrep stale (rules deleted) |
| MCP | `.mcp.json` (context7 only) | optional |
| machine check | `make doctor` → `scripts/doctor.sh` (docker, memory, java vs `.sdkmanrc`, node vs `.nvmrc`, gradlew, podman, chromium, foreign stacks, repo state) | needed |
| guide | `docs/guides/DEVELOPING.md` (prereqs, first hour, daily loop, worktrees, handing off) | needed |
| per-repo agent answers | `docs/agents/*.md` | needed |
| commit gate | `.husky/commit-msg` (needs `cz`) | needed |

### Only on the operator's machine

| item | path | personal / needed |
|---|---|---|
| global rules (ADHD reporting, no commit w/o approval, SOLID seams S-1..S-7) | `~/.claude/CLAUDE.md` (72 lines) | reporting = personal; seam rules = **needed**, repo-bound only via #679 |
| orientation hook | `~/.claude/hooks/always-on-orientation.sh` + `~/.claude/always-on/orientation.md` | personal |
| herdr state hook | `~/.claude/hooks/herdr-agent-state.sh` | personal (tool integration) |
| git guard hook | `~/.claude/settings.json` → `block-dangerous-git.sh` — **file missing**, hook points at nothing | needed in spirit; repo has `block-commit-on-master.sh` |
| user plugins | frontend-design, playwright, claude-md-management, claude-code-setup, hookify, commit-commands, cyclomatic-complexity, (+ dup of jdtls/ts-lsp, mattpocock, i-have-adhd, context7) | personal/optional; cyclomatic-complexity backs the ≤5 rule |
| user skills | `~/.claude/skills/{show-me,untouched-and-risk,wiki,improve-claude-md}` | personal (`untouched-and-risk` used for MR summaries) |
| MCP servers | `~/.claude.json`: user `playwright`, `idea`; project `pg-aruvii` (needs `uvx`) | optional |
| local permissions | `.claude/settings.local.json` (gitignored) | personal |
| statusline, model, effort, autoMode | `~/.claude/settings.json` | personal |
| glab auth to GitLab group | `glab auth` token | needed |
| secrets / master key | `make secrets` output (shared postgres volume; never per worktree) | needed, per machine |
| fleet access (VM, Discord, Verifier) | agent-fleet provisioning, not in this repo | needed only to use fleet/Verifier |

Short read: the repo carries the process (`/crq`, rubrics, hooks, `make`); what a second developer lacks is the seam
standard (still only in `~/.claude/CLAUDE.md`), `cz` + `glab` setup, and any way to get reviewed — the 18 drafts by
`drop2kanagaraj` sitting 29–63 days with no comments are the live example.
