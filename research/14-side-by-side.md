# 14 — Side by side: our setup today vs references and products, with their stated WHY (2026-10-18)

Ticket: chiyanram/agent-factory#12 (parent #1, feeds #4). Describes only; no evaluation. "unknown" = not in any source read.
Cite keys: `F01`–`F13` = agent-factory `research/NN-*` · `R00` `R34` `R37` `R38` `R39` `R64a`–`R64e` = `~/workspace/skills/research/NN-*` ·
`ADR-NNNN` = rameezk-forge `docs/adr/NNNN-*` @43d360e (refs clone) · `AGENTS.md` = agent-platform root file · `#`/`!` = agent-platform GitLab ·
`af#` = chiyanram/agent-fleet · product keys (CC-*, CDX-*, GH-*, DEV-*, JUL, AMP, GL-*) as defined in F02 / F09.
"Ours" = agent-platform + agent-fleet as running 2026-10-18: laptop operator sessions, the old 4-agent Discord fleet on the VM, and the
merged-but-not-started new fleet (F03, F06).

## 1 · Replication — how a new developer gets the setup on a laptop or a VM

| | OURS today | pstack | firstmate | forge | mattpocock | humanlayer rpi | openclaw | Claude Code | Codex | Copilot coding agent | other |
|---|---|---|---|---|---|---|---|---|---|---|---|
| install unit | clone repo: AGENTS.md, 7 `.claude/rules`, hooks, 4 review agents, skills + commands, `make doctor` (F08 §4) | `/add-plugin pstack` (pstack `README.md:15-19`) | `git clone`; "the cloned repo is the distro" (firstmate `README.md:39,84`) | OpenTofu creates Hetzner server; Nix (disko + nixos-anywhere) installs OS (ADR-0001) | `claude plugins install mattpocock-skills` or skills.sh copy (matt `README.md:25-41`) | `npx skills add humanlayer/skills --skill NAME` (hl-skills `README.md:5-9`) | AGENTS.md + `.agents/` in repo; `.claude/skills -> ../.agents/skills` (R34 §1) | local: repo files; cloud: repo CLAUDE.md, rules, skills, hooks come with clone (F02 CC-ENV) | CLI: your machine; cloud: `universal` image (F02 CDX-CL) | repo files on GitHub (F02 GH-ABT) | Devin: blueprint YAML (F02 DEV-ENV) |
| outside the repo | `cz`, `glab auth`, `make secrets`, mattpocock marketplace (F12 §3); seam rules S-1..S-7 only in operator `~/.claude/CLAUDE.md` 72 lines (F08 §4) | `/setup-pstack` writes always-on `pstack-models.mdc` (R64a D1) | toolchain check, installs only after consent (`README.md:65,133`); harness trust once per clone (`:120-121`) | operator SSH key in flake; Tailscale only access path after install (ADR-0001, ADR-0020) | `setup-matt-pocock-skills` skill (matt `README.md:55`) | unknown | unknown | user `~/.claude/*` and repo-enabled plugins not carried to cloud (F02 CC-ENV) | secrets "only available to setup scripts" (F02 CDX-CL) | firewall, setup steps (F02 GH-FW) | Cursor: `.cursor/environment.json` (F02 CUR) |
| toolchain / env per run | `.sdkmanrc` + `.nvmrc` checked by doctor (F08 §4); `mise.toml` #713 not built (F04 A); fresh worktree lacks `node_modules` (F11 #32) | workers in cloud by default (R64a D11) | worktree per worker (R64b D11) | workload runs in repo's flake devshell (ADR-0027); repo installs its own deps (R64d D7, ADR-0072) | none (no runtime, F01 §3) | none | unknown | `.worktreeinclude`; setup script → snapshot if ~5 min, cache ~7 days (F02 CC-WT, CC-ENV) | setup script; cache up to 12 h (F02 CDX-CL) | `copilot-setup-steps.yml`, max 59 min (F02 GH-ENV) | workmux `post_create` hook (F09) |
| VM setup | old: `create-agent.sh` per agent (F08 §1); new: `fleet-zones apply` writes sudoers, sshd drop-in, 3 zone users, 3 machine.env, runner config (F06 §1); worker image on VM unverified (F06 §1) | none (cloud) | none stated | standup once, deploy NixOS-only (ADR-0007) | none | none | Crabbox/Testbox for suites too large for the host (R37 §1) | self-hosted runner, outbound-poll (F02 CC-SH) | none | self-hosted ARC runners (F02 GH-ENV) | Amp `.agents/setup` 428 lines (F02 AMP-ORB) |

THEIR WHY
- firstmate: plain instructions, scripts, text records keep the system introspectable (R64b D2, VISION.md:61).
- forge: standing up the VM "is the slice's whole point"; whole closure kept free/open (ADR-0001).
- forge: missing `node_modules` was read as "cannot run" → repo installs own deps (R64d D7, ADR-0072).
- mattpocock: plugin = subscribe to updates; skills.sh = editable copy (matt `README.md:27`).
- Products: "env setup is the #1 friction" → setup script then snapshot (F02 §same-way 2, 8).
- Claude Code cloud: rules come from repo, not user machine (F02 §same-way 4).

## 2 · The pipeline used alone, by one human, without a fleet

| | OURS today | pstack | firstmate | forge | mattpocock | humanlayer rpi | openclaw | Claude Code | Codex | Copilot | other |
|---|---|---|---|---|---|---|---|---|---|---|---|
| entry | `/crq <issue>` in a worktree session; 28 of 45 sessions (F08 §1) | `/poteto-mode` in the chat; that chat runs the playbook (R64a D1 #575) | captain talks to firstmate; it dispatches (R64b core) | ticket labelled `forge:ready` (ADR-0016) | user-invoked skills: grilling, to-spec, implement (F01 §simplest) | user picks one of 4 flows (R64c D3) | task defines scope; chosen workflow owns execution (R64d D3) | one session; subagents or `/batch` 5–30 (F02) | CLI prompt (F02) | assign issue → agent (F02 GH-PR) | Aider: single agent, terminal (F09) |
| stages | 11 stages 0–10; crq.md 464 lines (F12 §1) | brief → worker → verifier → ship (R64a D3–D8) | brief → worker → no-mistakes → PR (R37 §1) | dispatch / revision / conflict workloads (R64d D3) | wayfinder: one ticket per session (R64c D3) | research → plan → implement, files between fresh sessions (F01 §simplest) | pr-simplify before review (R64d D6) | none fixed | none fixed | task → PR (F02) | Jules: plan before code (F02 JUL) |
| roles when alone | one session plays analyst → reviewer → developer → qa; all posted as `chiyanram` (F12 #35) | coordinator never edits code (R64a D3) | coordinator never codes, even trivial (R64b core) | declared workers (R64d D3) | review subagents only (R64c D6) | read-only research subagents (R64c D3) | lead "stays hands-on" (R64d D3) | lead + subagents (F02) | subagents when asked (F02) | one agent (F02) | — |
| check when alone | `make verify-module`; `verify-full` "still owed" on !268, !270 (F12 #28) | verifier agent (R64a D7) | no-mistakes `test`/`lint` (R37 §1) | scoped local commands, CI full (R64d D7) | full suite once at end (R64c D7) | automated vs manual boxes (R64c D7) | touched tests + targeted typecheck (R64d D7) | Stop hook exit 2 (F02 CC-HK) | your sandbox (F02) | Actions after approval (F02 GH-RISK) | Aider `--auto-test` (F09) |
| merge | operator, 77 of 78 (F08 §2); no quick lane (F12 #28) | explicit merge request only (R64a D8) | explicit word; `yolo` never merges red (R64b D8) | human (F01 §simplest) | "commit to current branch" (R64c D8) | commits when requested (R64c D8) | humans merge (F01 §simplest) | you (F02) | you (F02) | human only (F02 GH-RISK) | — |

THEIR WHY
- pstack: "a wrong decision usually costs less than blocking" (R64a D5).
- firstmate: "trivial is a guess and command attention does not scale" (R64b core, VISION.md:25).
- humanlayer: "Use the shortest path that gives the user useful review points" (R64c D3).
- mattpocock: one ticket per session; decision lives in one ticket (R64c D3–D4).
- openclaw: delegate only "when saving time or improving verification" (R64d D3).
- Industry: start simplest, add complexity only when needed (R64e D3, BEA).

## 3 · Fleet shape — who, how many, how long, what each owns, how work reaches them

| | OURS today | pstack | firstmate | forge | mattpocock | humanlayer rpi | openclaw | Claude Code | Codex | Copilot | other |
|---|---|---|---|---|---|---|---|---|---|---|---|
| who | old: analyst, spec-reviewer, developer, qa (F08 §1); new (not started): coordinator + analyst/spec-reviewer/developer/qa souls (F03, F06 §2) | coordinator → track → worker (R64a D3) | firstmate + workers + secondmates (R64b D3) | declared workers: harness + model + prompt (ADR-0006, R64d D3) | subagent per ticket (F01 #1261) | 2–6 read-only research subagents (R64c D3) | lead + delegate lanes; ClawSweeper bot (F01 §6) | subagents; agent teams; `--bg` sessions (F02) | subagents; cloud tasks (F02) | one agent per task (F02) | Devin: lead + managed Devins (F02 DEV-ADV) |
| how many | old: 4; new caps ≤2 building/host, ≤3 waiting (F03 caps); operator max 6 concurrent sessions (F08 §1) | rolling window ~10 (F05, `orchestrate.md:16,63`) | "no concurrency cap"; capacity opt-in (R64b D3) | one workload per run (README) | no cap (F01 #1261) | 2–6 (R64c D3) | unknown | `/batch` 5–30; one team/session (F02) | unknown | one repo per task (F02 GH-ABT) | Agent Orchestrator: lead + workers (F09) |
| lifetime | old: long-lived, ~100-turn sessions, "3 days silent" (F11 #49); new: per (issue, role, stage), killed on done (F03) | fresh, never resume-chained (R64a D4) | per task; secondmates idle by default (R64b D3) | per run; heartbeat loss → interrupted (ADR-0031) | per ticket | one phase per context window (R64c D3) | unknown | idle unattached `--bg` stopped ~1 h (F02 CC-AV) | unknown | session cap (F02 GH-ABT) | Jules: short-lived VM (F02 JUL) |
| ownership | one writer per stage; developer 8 of 78 merged MRs (F08 §2) | one writer per worktree, one stacker per stack (R64a D3) | worker reports only to firstmate (R64b core) | conflict = own workload kind (ADR-0069) | each subagent own worktree (F01 §simplest) | read-only | lead hands-on (R64d D3) | teammates share one checkout (F02 CC-PAR) | subagents share workspace (F02 CDX-SUB) | `copilot/` branch only (F02 GH-RISK) | — |
| how work arrives | old: Discord @mention + GitLab comment, "No labels" (R00); new: coordinator reads forge state (F03) | coordinator brief; completions as queue events (R64a D3) | `fm-spawn.sh` brief (R64b D3) | polled frontier snapshot + label (ADR-0010, ADR-0016) | `/implement` (R64c D4) | next command carries task dir (R64c D4) | task (R64d D3) | Agent tool; task list self-claim (F02 CC-TEAM) | prompt; `@codex` (F02) | issue, chat, Slack, Jira, API (F02 GH-PR) | GitLab Duo: assign service account (F09 GL-FL) |

THEIR WHY
- pstack: "Hard-coded swarm trees were tried and parked as too rigid" (R64a D3).
- pstack: "Interrupt-chained resumes silently drop directives" → fresh subagent (R64a D4).
- firstmate: without coordinator the captain "relearns what each one was about" (R64b core, VISION.md:12-14).
- firstmate: capacity cap after surplus workers spent 21.9M tokens retrying (R64b D3, #4237).
- forge: workers declared, runs isolated "so you can trace what every worker did" (R64d D3).
- mattpocock: all work goes to subagents to protect the coordinator's context window (R64c D3, chief-of-staff `:20`).
- Cognition: writes single-threaded; extra agents add analysis, not edits (R64e D3, COG-2).

## 4 · Gate / CI — where, how long, rerun, cost, and with NO paid CI minutes

| | OURS today | pstack | firstmate | forge | mattpocock | humanlayer rpi | openclaw | Claude Code | Codex | Copilot | other |
|---|---|---|---|---|---|---|---|---|---|---|---|
| where checks run | no CI (AGENTS.md; #440); VM Verifier `fleet-verify`, one unix user (R37 §1); laptop `make verify-full` (F12 §3); !263 runner pipeline draft (F04 A) | separate cloud verifier agent (R37 §1) | no-mistakes, then GitHub-hosted `ubuntu-latest` (R37 §1) | GitHub Actions Linux + KVM, required check (ADR-0036) | no runner (R37 §1) | humanlayer repo: pre-push `make check test` + CI `ubuntu-latest` (R37 §1) | PR CI `openclaw/ci-gate`; optional Blacksmith Testbox (R37 §1) | hooks; GitLab CI on your runner, beta (F02 CC-GL) | OpenAI-managed containers (F02) | Actions runner (F02 GH-ENV) | GitLab Duo: your runner (F09 GL-FL) |
| duration | Verifier 60m45s: smoke 24m33, Gradle 21m40, deploy ~10m (R38); runs 1h00–1h09 (F12 #24); laptop timings missing (R38; F11 §4 q1) | unknown | unknown | unknown | — | unknown | PR CI ~9 min (R64d D7) | unknown | cache up to 12 h (F02) | session cap 59 min setup (F02) | — |
| rerun / cancel | full rerun only, no test filter, no failed-run log (F10 q4–q8); no cancel/dedupe, af#56 open (F11 #46) | one swarm at code-ready head; single verifier on rebase (R64a D7) | per-PR cancel-in-progress; sharded on CI timings (R39 §3) | token can't rerun jobs → empty commits, #438 open (F01 §5) | — | — | concurrency per PR; "no reruns to get green" (R37 §1) | auto-fix on CI fail (F02 CC-WEB) | — | Actions need write-user approval (F02 GH-RISK) | Cursor CI-fix stops after 10 (F02 CUR) |
| result reaches MR | agent pastes `result.md` by hand (R37 §1); flake list in Discord (F08 §3) | ledger keyed PR + head SHA (R64a D7) | native check at pushed head (R37 §2) | done = PR ready + checks green, read by forge (F01 #518) | — | status checks (R37 §1) | required check (R37 §2) | PR (F02) | PR (F02) | PR (F02) | — |
| no paid CI minutes | GitLab Free 400 min used up: 100 pipelines, 98 failed, 0 passed (F11 #66); runs on own VM + laptop; project runner (shell, concurrent=1) registered from PR #84 branch, jobs not merged (F06 §1, F04 A) | Cursor cloud (cost unknown) | GitHub-hosted (minute cost not stated) | GitHub-hosted KVM (cost not stated) | n/a | GitHub-hosted (cost not stated) | GitHub-hosted + Blacksmith (cost not stated) | your own runner (F02 CC-GL) | managed (cost unknown) | self-hosted ARC possible (F02 GH-ENV) | GitLab docs: only instance runners metered (R37 §4) |

THEIR WHY
- pstack: "CI green is an input to a verdict, not a verdict" (R64a D7).
- pstack: "an author checks what it meant to build" (R64a D7, `shipping.md:5`).
- firstmate: "validation belongs to no-mistakes, CI belongs to the forge" (R37 §1, VISION.md:71).
- forge: VM tests need `/dev/kvm`; box and Mac lack it; tests rarely ran before merge (ADR-0036).
- forge: done must not take "the agent's word for it" (R64d D7, ADR-0065).
- openclaw: 33% of 3,133 box runs exited 0, 1,040 lane-hours vs ~9 min PR CI (R64d D7).
- mattpocock: a repo with no guardrail "is itself a finding" (R37 §1).

## 5 · Rulebook — instruction files, where they live, how they load

| | OURS today | pstack | firstmate | forge | mattpocock | humanlayer rpi | openclaw | Claude Code | Codex | Copilot | other |
|---|---|---|---|---|---|---|---|---|---|---|---|
| always-on file | CLAUDE.md 482 lines / 32,775 B > Codex 32 KiB; 17 `<important if>` blocks (R34 §0); #643 WIP AGENTS.md 33,096 B unpushed (F04 A) | only `pstack-models.mdc` (R64a D1) | AGENTS.md, 7,244 words, ceiling 9,000 (F01 §1, R64b D1) | root AGENTS.md 54 lines (R64d D1) | CLAUDE.md 25 lines, AGENTS.md symlink (R34 §1) | none; router SKILL.md per request (R64c D1) | root AGENTS.md ~19.5 KB (R64d D1) | ancestors at launch; target <200 lines (R64e D1) | concatenated root→cwd, 32 KiB cap (R64e D1) | custom instructions (F02 GH-ABT) | Amp: AGENTS.md ancestors (F02 AMP-SP) |
| scoped / nested | 7 `.claude/rules` with `paths:`, load on read (AGENTS.md); 6 module CLAUDE.md not linked from root (R34 §1) | leaves read in full on use (R64a D1) | skills "only at its stated trigger" (R64b D1) | forge appends own text to harness prompt (ADR-0057) | standards read at review (R64c D1) | one phase `process.md` per request (R64c D1) | 34 nested AGENTS.md (R34 §1) | subdirectory files on demand (R64e D1) | closer file overrides (R64e D1) | unknown | Amp: 41 AGENTS.md, subtree on read (F02 AMP-ORB) |
| skills / commands | 18 skills + `.claude/commands` incl. crq.md (F12 header); 4 review agents (F08 §2) | hub + playbooks + one-idea leaves; typed-only (R64a D1–D2) | 48 skill files (F01 §1) | vendored `.agents/skills`, `.claude/skills` symlink (R64d D2) | plugin bundle (matt README) | 7 skills (F01 §4) | 53 skills (F01 §6) | SKILL.md, progressive disclosure (R64e D2) | `.codex/agents/*.toml` (F02) | skills, hooks, MCP (F02) | — |
| user / fleet layer | user `~/.claude/CLAUDE.md` 72 lines (F08 §4); fleet `worker-rules.md` pasted into brief, wins over project (F06 §2); souls 2nd copy (F06 §2); agents load ~50 KB at start (R00) | `~/.cursor/rules` (R64a D1) | captain.md, learnings.md (R64b D9) | per-run empty `CLAUDE_CONFIG_DIR` (ADR-0057) | — | — | — | managed policy cannot be excluded (R64e D1) | first-turn snapshot reused, #161707 (F01 §6) | — | — |
| conflicts seen | "@here" vs "tag owner"; Co-Authored-By vs no trailers (F10 q3); 6 instruction conflicts (F12 §2) | #597 keys loader ignored (R64a D1) | #5175 truncated rulebook, open (F01) | attribution leaked despite AGENTS.md (ADR-0074) | #1274 CLAUDE.md marker clobber (F01) | — | #164006 middle rules dropped (F01) | CLAUDE.md replaces AGENTS.md by default (R64e D1) | — | — | — |

THEIR WHY
- pstack: descriptions "sat in the skill list of every session" → typed-only (R64a D1, #506).
- firstmate: "every agent's context stays lean"; prune over append (R64b D1).
- forge: run behaves "as it would for a developer in that repository" (R64d D1, ADR-0057).
- forge: shared writable config lets "any workload change what later runs load" (R64d D11).
- mattpocock: implementation agent has most context pressure → standards belong to review (R64c D1).
- openclaw: 20,000-char bootstrap cap truncated root; rules arrived as fragments (R64d D1).
- Anthropic: CLAUDE.md is "context, not enforced configuration" (R64e D1).

## 6 · Process — specs, approvals, lanes, stacked work

| | OURS today | pstack | firstmate | forge | mattpocock | humanlayer rpi | openclaw | Claude Code | Codex | Copilot | other |
|---|---|---|---|---|---|---|---|---|---|---|---|
| spec artefact | REQ-<issue>, 565–1,115 lines in current stack (F12 §1, #8) | 9-field brief (R64a D4) | brief: Captain's intent verbatim + Firstmate spec (R64b D4) | ticket + ADR per decision, 74 ADRs (F01 §5) | wayfinder decision tickets; to-spec (R64c D3) | `NN-` docs with repo SHA frontmatter (R64c D4) | PR body with 4 fixed sections, kept current (R64d D4, `AGENTS.md:112`) | SPEC.md after interview (R64e D5) | unknown | issue text (F02) | Factory: validation contract first (F02 FAC-MA) |
| approval gate | draft MR spec + design; human `/approved` naming SHA (F12 stage 5); 10 of 78 merged MRs carry it (F08 §2); !253 approved 5× (F12 #3) | missing field → refuse to spawn (R64a D4) | spawn refuses missing base line (R64b D4) | `forge:ready` label (ADR-0016) | HITL vs AFK per ticket (R64c D3) | System Design approved before Program Design (R64c D12) | completed review + exact head + ci-gate (R37 §1) | none fixed | none fixed | agent cannot mark Ready (F02 GH-RISK) | Jules: plan auto-approved on timer (F02 JUL) |
| lanes / size | none; "Never skip a stage"; G8 lanes not landed (F12 §4) | brief sized to unit (R64a D4) | intent-targeted local test (R64b D12) | scoped checks (R64d D7) | — | 4 flows by task type (R64c D3) | stage above ~800 lines (R64d D6) | — | — | "Break complex tasks" (R64e D8) | — |
| stacked work | ADR-0017 !227 ← !253 ← !258/!261 ← !266; REQ-531 re-opened 3× (F12 #1, #4) | one stacker per stack; lands contiguous verified run (R64a D3, D8) | `--base-branch` (R64b D3) | merge default into PR, never rebase (ADR-0069) | — | — | don't rebase main just because it advanced (R64d D8) | — | — | — | — |
| decisions recorded | Discord / session chat, noted after (!258 ×8) (F12 #7, #33) | `preferences.md`, ledger (R64a D9) | per-task inbox, appended verbatim (R64b D4) | ADR cites failed run (R64d D9) | `.out-of-scope/` records (R64c D2) | task directory (R64c D4) | PR evidence (R64d D9) | — | — | session log (F02) | — |

THEIR WHY
- pstack: "a worker cannot ask you a question" → brief carries everything (R64a D4).
- firstmate: "the machinery refuses to guess" — explicit contract per task (R64b D4, VISION.md:50).
- forge: rebase "would rewrite commits reviewers have seen" (R64d D8, ADR-0069).
- mattpocock: every "no" written once so it is not re-argued (R64c D2, PR #1179).
- humanlayer: implementation can start once a phase doc specifies the task well enough (R64c D3).
- openclaw: agent PRs "keep growing past the smallest fix" (R64d D6, #173363).
- Industry: small batches; AI "massive pull requests" raise instability (R64e D8, DORA-SB).

## 7 · Review — who reviews, how many, cost

| | OURS today | pstack | firstmate | forge | mattpocock | humanlayer rpi | openclaw | Claude Code | Codex | Copilot | other |
|---|---|---|---|---|---|---|---|---|---|---|---|
| who | spec-design-reviewer (5), architecture-reviewer (5, 7), code-standards-reviewer (7), smoke-spec-reviewer (F12 §1); fleet Spec Reviewer + QA agents (F12 §3) | `/interrogate`: Opus + Grok read-only; lead sorts 4 buckets (R64a D6) | delivery path (no-mistakes) owns review (R64b D6) | worker answers each feedback item (ADR-0062) | 2 axes, Standards + Spec, parallel subagents (R64c D6) | analyzers "DO NOT suggest improvements" (R64c D6) | ClawSweeper once per PR; autoreview skill (F01 §6, R64d D6) | fresh-context reviewer (R64e D6) | `@codex review`; auto_review agent (F02) | Copilot code review optional (F02) | Devin Review (F02) |
| how many | 4 rubric agents; criteria 86 / 30 / 24 (F12 #12) | 2 (was 3, #511) (R64a D6) | "never add a manual reviewer" (R64b D6) | — | 2 (R64c D6) | — | 1 bot + humans (F01 §6) | 1 (R64e D6) | 1 | 1 | 1 |
| rounds | unlimited; !267: 7 spec + 4 architecture (F12 §4) | unknown | worker never answers own finding (R64b D6) | revision per feedback (ADR-0062) | — | — | re-review by comment (F01 §6) | — | — | — | — |
| cost | arch 130–180k peak ctx, 6 runs/day (F10 q6); $1.92 arch, $2.85 spec, $1.95 std (F12 §1); #540 docs-only 489,534 tokens (F12 #10) | unknown | unknown | unknown | unknown | unknown | unknown | teams ~7× tokens (R64e D10) | unknown | unknown | unknown |
| counts toward merge | operator merge; agent verdicts posted under same account as `/approved` (F12 #35) | verdict from non-author only (R64a D7) | — | OWNER/COLLABORATOR comments only (ADR-0063) | — | manual boxes user-ticked (R64c D7) | humans merge (F01) | — | GitHub posts P0/P1 only (F02) | not toward required approvals (R64e D6) | — |

THEIR WHY
- pstack: "The adversarial signal comes from model diversity, not assigned personas" (R64a D6).
- firstmate: firstmate is "the command layer, not the workshop" (R64b D6, VISION.md:71).
- forge: a stranger's comment would "become text the worker acts on" (R64d D5, ADR-0063).
- mattpocock: separate axes stop "one axis from masking the other" (R64c D6).
- openclaw: re-review by comment because "Agents wait for a review that never comes" (F01 §6).
- Anthropic: "reviewers asked to find gaps will usually report some" (R64e D6).

## 8 · Hosting — where agents run, isolation, shared resources

| | OURS today | pstack | firstmate | forge | mattpocock | humanlayer rpi | openclaw | Claude Code | Codex | Copilot | other |
|---|---|---|---|---|---|---|---|---|---|---|---|
| where | laptop desktop sessions in worktrees (F08 §1); VM 8 vCPU / 23 GB, rootless podman (R38) | Cursor cloud agents (R37 §1) | local worktrees; tmux/zellij/herdr (F05) | NixOS box on Hetzner (ADR-0001) | user's harness (F01 §3) | user's harness (R64c D3) | unknown; Testbox for suites too large for the host (R37 §1) | local or Anthropic VM 4 vCPU/16 GB/30 GB (F02 CC-ENV) | local sandbox or managed container (F02) | Actions runner (F02) | workmux: tmux + container or Lima VM (F09) |
| isolation | old: unix user per agent + slice, `--dangerously-skip-permissions` (F11 #72); new: container + iptables egress + 3 unix zones + sudo rule (F03, F05) | cloud env (F05) | worktree; stop if in primary checkout (R64b D11) | bubblewrap (ADR-0024) | harness's job (R64c D3) | Codex sandbox may lock `.agents` (R64c D11) | secretless isolation for forks (R64d D11) | teams: no worktree; `--bg`: worktree (F02) | Seatbelt / bwrap+seccomp (F02 CDX-SEC) | ephemeral env + firewall (F02 GH-FW) | container-use: container + branch (F09) |
| shared resources | one Compose stack, fixed ports, last deploy wins (F11 #11, #14); one Claude token → all four stopped 10-01 (F11 #38) | none stated | 12 GB worktrees unreclaimed, #6854 (F01) | deploy never interrupts a workload (ADR-0035) | load ~140 at 6–7 subagents, #1261 (F01) | — | worktrees inject shared AGENTS.md, #129411 (F01) | Compose stack "single-tenant resource" (F02 §reuse) | subagent write conflicts (F02) | none (per task) | — |
| identity / tokens | 3 of 4 agents on operator PAT (F11 #40); new: per-role bots (F03) | unknown | harness's own auth (F05) | one shared GitHub write token (ADR-0017) | — | — | — | GitHub needed for cloud push (F02 CC-WEB) | secrets in setup only (F02) | `copilot/` branch (F02) | — |
| liveness | tmux screen-scrape, screen-diff (F11 #55, F03 fleet-watch) | never probes the agent (F05) | watcher daemon; #7105 open (F01) | heartbeat → interrupted (ADR-0031); 5 USD / 2 h cap (ADR-0044) | — | — | — | idle notification (F02 CC-TEAM) | — | session log (F02) | ccmanager busy/waiting/idle (F09) |

THEIR WHY
- forge: empty config dir — "no host state or earlier run reaches it" (R64d D11, ADR-0057).
- forge: one write token chosen deliberately (F05, ADR-0017).
- firstmate: refuse when a protection cannot apply; never degrade silently (R64b D11).
- pstack: "never resume to check" — reads ledger, not the agent (F05, `orchestrate.md:100`).
- mattpocock: stopping subagent loops belongs to the harness; a prose guard costs tokens every run (R64c D3).
- Products: fresh disposable VM per worker, so no shared host ports (F02 §same-way 2).

## 9 · Visibility — how humans and agents see state

| | OURS today | pstack | firstmate | forge | mattpocock | humanlayer rpi | openclaw | Claude Code | Codex | Copilot | other |
|---|---|---|---|---|---|---|---|---|---|---|---|
| human sees | MR thread ~1,900 lines for round/head/verdict (F12 #30); `make status` STALE banner (AGENTS.md); `fleet-digest` has no sink (F03) | `status.md` derived from tables; `/ketchup` <150 words (R64a D5) | outcomes, translation table (R64b D5) | dashboard: transcript, tokens, cost, frontier (README) | unknown | NN- docs (R64c D4) | CI lanes + required check (R37) | agent view: Needs input / Working / Completed / Ready (F02 CC-AV) | approvals labelled by source thread (F02) | session logs (F02) | Agent Orchestrator Kanban from PR+CI+review (F09) |
| agent sees | REQ heads / approvals / owed deltas rebuilt from 4–5 worktrees (F12 #29); local master stale (F11 #43) | ledger keyed PR + SHA (R64a D7) | per-task status file + inbox (F01) | labels on ticket (ADR-0016) | fetched ticket title (R64c D4) | task dir (R64c D4) | PR state | shared task list, "can lag" (F02) | — | — | — |
| done signal | Verifier `summary.json` sha; posted by agent (R37 §1); `post-status` not in worker image (F03) | verdict ladder (R64a D7) | `done: PR <url> checks green` at pushed HEAD (R37 §1) | ready + required checks green (F01 #518) | — | ticked boxes (R64c D7) | "Verify remote outcomes before success" (R64d) | `TaskCompleted` hook (F02) | — | PR (F02) | — |
| cost / limits | usage-limit stalls invisible; 89 % warning seen by chance (F11 #39) | budget tiers (R64a D10) | per-task spend ledger, opt-in (R64b D10) | per-run billed cost (README) | — | — | — | — | — | — | Devin ACUs (F02) |

THEIR WHY
- pstack: status "never hand-maintained" (R64a D5); `/ketchup` because the same catch-up prompt was retyped (#539).
- firstmate: a modal "is indistinguishable from a healthy idle composer" (R64b D5, #4754).
- firstmate: 26.5% of spend was cold pipeline agents, unattributed (R64b D10, #4238).
- forge: "To tell whether forge improves… runs have to be compared" (R64d D9, ADR-0034).
- forge: forge "must also not publish its internals" to GitHub (R64d D5, ADR-0066).

## 10 · Human channel — how the human is asked and answers

| | OURS today | pstack | firstmate | forge | mattpocock | humanlayer rpi | openclaw | Claude Code | Codex | Copilot | other |
|---|---|---|---|---|---|---|---|---|---|---|---|
| channel | laptop: session chat; fleet: Discord threads + GitLab notes (F12 §3); new coordinator: GitLab via Reporter bot, notifier not built (F03) | the chat + `gates.md` (F05) | firstmate only; tmux + optional chat (R64b core, F05) | block posted on PR/ticket (F01 #529); dashboard (ADR-0016) | plain chat, no picker (R64c D5) | chat (R64c D5) | chat (R64d D5) | lead; Remote Control (F02) | parent thread (F02) | session prompt box (R64e D5) | Devin: Slack/Teams tag (F02) |
| what reaches human | grill questions one at a time (F12 stage 2); `/approved` per material change (F12 #6) | irreversible, product calls, dead ends; batched with default (R64a D5) | review-ready, findings, blockers, destructive, credentials (R64b D5) | failure reasons on dashboard (R64d D5) | whole frontier per round, each with a proposed answer (R64c D5) | one decision per message (R64c D5) | consequential decisions only (R64d D5) | permission prompts bubble to lead (F02) | needs-approval fails to parent (F02) | — | Factory: halts mission on block (F02) |
| answer form | decisions in chat, noted afterwards (F12 #7); fleet-guard blocks notes that mention `/approved` (F12 #22) | default stands (R64a D5) | appended verbatim to task (R64b D4) | OWNER/COLLABORATOR comment (ADR-0063) | "yes" accepts the proposed answer (R64c D5) | Expected / Found / Why on mismatch (R64c D5) | silence never authorizes (R64d D5) | `claude -p --cloud <id>` (F02) | — | comment (F02) | — |
| conflicts seen | "@here when blocked" vs "tag the owner" (F10 q3); interviews held on Discord (F10) | — | busy doorbells escalate at a bound (R64b D5) | — | bare IDs fixed, #1294 (F01) | — | — | — | — | — | — |

THEIR WHY
- pstack: "a wrong decision usually costs less than blocking" (R64a D5).
- firstmate: "An escalation exists for a decision only a human can make" (R64b D5, VISION.md:16).
- forge: block note sat "where the operator does not look" → PR/ticket comment (F01 §5, #529).
- mattpocock: pickers push "multiple-choice questions with pre-baked answers" (R64c D5).
- openclaw: "Silence never authorizes gated action" (R64d D5).
- Industry: human attention is the scarce resource (R64e D5, MF-HAR).

## Where ours differs

1. Ours: no CI; gate on own VM or laptop (AGENTS.md). firstmate, forge, openclaw, humanlayer: GitHub-hosted CI (R37 §2, ADR-0036).
2. Ours: gate result pasted to the MR by an agent (R37 §1). firstmate, forge, openclaw, humanlayer: native forge check (R37 §2).
3. Ours: one gate slot, ~1 h per run, full rerun only (F12 #24). firstmate: per-PR cancel + sharding (R39 §3); openclaw PR CI ~9 min (R64d D7).
4. Ours: two gate systems on main — Verifier and !263 runner (F05). No reference keeps two (F05).
5. Ours: always-on file 482 lines / 32,775 B (R34). pstack, forge, mattpocock: ≤54 lines or skill-only (R64a D1, R64d D1, R34).
6. Ours: `<important if>` in root; 0 of 17 reference files use it (R34 §0).
7. Ours: path rules in `.claude/rules` + unlinked module CLAUDE.md (R34). openclaw, Amp: nested AGENTS.md (R34, F02).
8. Ours: rules in 3 places — repo, user `~/.claude`, fleet `worker-rules.md` (F08 §4, F06). forge: per-run empty config dir (ADR-0057).
9. Ours: 11 stages, no lanes (F12 §1, §4). humanlayer: 4 flows by task; openclaw: stage by size (R64c D3, R64d D6).
10. Ours: human `/approved` on spec before code (F12 stage 5). Most products start coding on dispatch (F09 §none-fits); hl approves design first (R64c D12).
11. Ours: specs stacked on unmerged specs across 4–6 MRs (F12 #1). pstack: one stacker per stack (R64a D3).
12. Ours: decisions in Discord / session chat, recorded later (F12 #33). forge, firstmate: forge comment or task inbox (ADR-0063, R64b D4).
13. Ours: 4 rubric review agents, unlimited rounds (F12). pstack 2, mattpocock 2 axes, Anthropic/Copilot 1 (R64a D6, R64c D6, R64e D6).
14. Ours: review cost ~$2–2.85 per run, 6 runs/day (F12). References: cost not stated (unknown).
15. Ours: laptop agent verdicts posted under the approver's account (F12 #35). Copilot: requester cannot approve agent PR (R64e D6).
16. Ours: old fleet long-lived role agents (F08). pstack, firstmate, forge, products: fresh worker per task/run (R64a D4, R64b D3, ADR-0031).
17. Ours: work reaches old agents by Discord @mention (R00). forge: labels; products: issue/assign (ADR-0016, F02).
18. Ours: new fleet stacks container + firewall + 3 unix zones (F05). Each reference uses one layer (F05).
19. Ours: per-role bots (new) / operator PAT (old) (F03, F11 #40). forge: one shared token (ADR-0017).
20. Ours: liveness by tmux screen-scrape (F11 #55). pstack reads ledger; forge heartbeat (F05, ADR-0031).
21. Ours: one Compose stack shared by all worktrees and agents (F11 #14). Products: disposable VM per worker (F02).
22. Ours: GitLab, self-managed-grade needs (F09). Most tools and Claude cloud push assume GitHub (F09 §patterns 6, F02 CC-WEB).
23. Ours: human channel split across chat, Discord, GitLab; notifier unbuilt (F03, F12). Products: status board (F02 §same-way 5).
24. Ours: no single view of REQ head / approval / gate (F12 #29–30). forge dashboard; Agent Orchestrator board (README, F09).
25. Ours: no per-run cost / limit view (F11 #39). forge per-run cost + cap; firstmate spend ledger (ADR-0044, R64b D10).
26. Ours: VM provisioned by shell scripts + sudo/sshd edits (F06 §1). forge: OpenTofu + NixOS declarative (ADR-0001).
27. Ours: seam standard only in operator's user file (F08 §4). References: rules shipped in repo or plugin (R34, matt README).
28. Ours: rule changes via numbered decisions G1–G32 (F13). pstack/addy: eval runs; matt: observed failure + evidence (R64a D2, R64c D2).
29. Ours: small fixes merged without `verify-full` (!268, !270) (F12 #28). forge, firstmate: merge refused without green check (ADR-0036, R64b D7).
30. Ours: fleet-guard text regex on `/approved` (F12 #22). Copilot: merge rights withheld in platform (F02 GH-RISK).

## Facts missing

- Laptop gate timings (R38 §Still missing; F11 §4 q1).
- Gate duration and CI minute cost for every reference (sources give hosting, not minutes; openclaw ~9 min only).
- Review cost per run for every reference and product.
- openclaw hosting / agent count; Codex agent counts; Cursor rule loading (F02 §Not reached).
- humanlayer rpi and mattpocock hosting and visibility (both run inside the user's harness; no runtime).
- Whether the new fleet's worker image exists on the VM (F06 §1).
