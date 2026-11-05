# 36 · mattpocock/skills — recent changes, chief-of-staff, software factory (2026-10-23)

Sources opened: reference clone (`git fetch`, origin/main = `5beb35b`, 2026-10-19; local HEAD was `d81f3a1`, 2026-09-29,
53 commits behind) · `gh pr list/view` on mattpocock/skills · PR #1316 head fetched as a ref (read-only) · installed plugin
cache `~/.claude/plugins/cache/claude-plugins-official/mattpocock-skills/{1.2.3,1.3.1}` · aihero.dev cohort page
`/cohorts/software-factories-for-real-engineers-xdy1m` (HTML + embedded lesson bodies). Quotes ≤15 words.

## 1 · What changed, last ~4 weeks (2026-09-24 → 2026-10-21)

```
09-29  v1.3 release (#1120)                         10-05  chief-of-staff added (in-progress/)
10-06  SCOPE.md + .out-of-scope/ (#1179)             10-06  batch of skill fixes (#1187–#1190)
10-07  second batch (#1192–#1209)                    10-09  wizard, retro scope note (#1237, #1240)
10-19  chief-of-staff wiki (#1304)                   10-21  software-factory skill PR #1316 (OPEN)
```

| skill (ours tracks it) | change · PR · merged | why (from PR / commit) |
|---|---|---|
| wayfinder | maps/tickets carry only `wayfinder:` labels, never `ready-for-agent`; cross-refs written with real ids in the wiring pass; research branch pushed, no PR · #1181 · 10-07 | three real failures: triage label read as "ready to implement" (#518); `T1–T8` written as `#1–#8` auto-linked unrelated issues (#507); research subagents opened draft PRs (#576). Also step 3: "Read the label, not just the body" |
| grilling | "Word each question so 'yes' accepts your recommended answer." · #1193 · 10-07 | issue #706 |
| to-tickets | tickets attached as sub-issues of the source issue; "Blocked by" omitted when native edges set · #1188 · 10-06 | tickets cut from a spec issue landed top-level (#554); blockers recorded twice (#262) |
| implement | fetch a passed ticket ref and state its title (#1196, fixes #700); call the Skill tool for `tdd` and `code-review` (#1189) · 10-06/07 | bare "/skill" prose replaced by explicit Skill-tool calls, the repo convention from #878 |
| code-review | standards sources must include `CODING_STANDARDS.md`/`CONTRIBUTING.md` when present; both sub-agents "in the foreground"; tracker doc path named · #1208 · 10-07 | closes #937, #1065, #1073 |
| tdd | each proposed seam gets "a one-line note on what it catches and what it misses" · #1192 · 10-07 | — (no body) |
| setup-matt-pocock-skills | creates missing triage labels (`gh/glab label create`); GitHub sub-issue command; external-PR list via REST pulls · #1197, #1187 · 10-06/07 | closes #616, #635, #733, #801, #468 |
| retro | no skill change. `.out-of-scope/lazy-load-writing-for-agents.md`: retro loads `writing-for-agents` every run · #1240 · 10-09 (#1238 closed) | it "defines what a no-op instruction is", needed to judge before writing |
| writing-for-agents | no change in window | — |
| pr | no change in window (cohort lesson "The PR Skill" teaches its Evidence + Merge Danger sections) | — |
| diagnosing-bugs | prove a forced mutation landed before trusting the red · #1209 | — |

Repo governance added 10-06 (#1179, `SCOPE.md`): an issue must show an **observed failure** and fit the philosophy; **no new
skills accepted** ("if you can compose the behaviour from existing skills, it doesn't get a new skill"); `.out-of-scope/subagent-recursion.md`:
loop limits are "the harness's job, not skills'". Tracker scope: GitHub, GitLab, local markdown; Jira rejected.

Open PRs that would touch our skills: #1236 wayfinder (no tracker inference, research on walk) · #1224 grilling (number
questions across the conversation) · #1221 tdd (a bug fix's red reproduces the bug) · #1226 to-tickets · #1228 setup.

Installed plugin: `1.3.1` = origin `package.json` version, but the cached `in-progress/chief-of-staff/SKILL.md` has no
Wiki section (pre-#1304). `in-progress/` is excluded from the plugin manifest.

## 2 · chief-of-staff

Location: `skills/in-progress/chief-of-staff/SKILL.md` (added `e47c149` 10-05, reworked `2b47ffc`/`6fd9479` 10-06, wiki #1304 10-19).
`disable-model-invocation: true` — user-invoked only. Beta bucket. No aihero.dev / newsletter page found (WebSearch: none).

| aspect | what it says |
|---|---|
| purpose | "Pursue a long-running goal in a single session by co-ordinating subagents." |
| role | "You are the Directly Responsible Individual for this goal." Two tracks: tactical (this task) + strategic (improve the environment for the *next* task) |
| work | "All work should be done in subagents. Protect your context window." Background agents, so it stays in dialogue with the user |
| I/O to subagents | sparse; via **context pointers** (research notes, commits, wiki pages); never duplicate what a pointer holds |
| schedules | suggests recurring schedules, harness permitting |
| memory | a **wiki**: `index.md` + one page per topic; sources cited, never copied. Ops: Ingest · Query · Lint (lint suggested as a schedule). Based on Karpathy's LLM-wiki gist, minus `log.md` (#1304 body) |
| history rule | "Date every claim"; code claims cite `repo@sha`; never undated "currently"; supersede, don't rewrite |
| strategic view | "pit of success": constrained APIs, lint rules, `CODING_STANDARDS.md` for reviewers; data sources (logs, test DBs, browser); **"no workarounds"** rule — deviations fixed "before feature work is done" |

Relation to a coordinator: it is a lead that routes all work to subagents and keeps none of the work itself — same shape
as a router. Differences: it lives in **one long session**, owns strategy and memory (the wiki), and has a duty to change the
environment on every user message. It does not name seats, a tracker, or gates.

## 3 · Software factory

### 3a · Where it lives

| source | status |
|---|---|
| aihero cohort "Software Factories for Real Engineers" (published 2026-10-12, runs 2026-11-09 → 11-20) | OPENED. Workshops: Domain Language · Wayfinder · Review · Codebase Design · Feedback Loops · Software Factory Part One · Part Two. Most Part One/Two lessons are placeholders (empty body) |
| the page's `<SoftwareFactoryMap />` diagram | **NOT FOUND as text.** Rendered client-side; not in page HTML or the 65 JS chunks fetched. The layer list in the brief (The Loop / Environment / Knowledge / Practices / Team, with items) could not be located in any opened source — treat as from the brief, unverified |
| PR #1316 `software-factory` skill (OPEN, 10-21, `skills/in-progress/software-factory/`) | OPENED (SKILL.md, EXAMPLE-TASKS.md; the four slot surveys NOT OPENED) |
| `GLOSSARY.md` at repo root | OPENED — skills-repo terms only (Issue tracker, Issue, Decision ticket, Triage role); no factory terms |
| a `docs/GLOSSARY.md` / `CONTEXT.md` / factory page | none on origin/main |

### 3b · Terms as Matt defines them

Cohort page (marketing body):

| term | his definition |
|---|---|
| goal | "The goal of any software factory is **speed**." |
| accelerators | "loop engineering", systems "that trigger work without human intervention" |
| infrastructure | connect agents to data sources; run them in sandboxes |
| brakes | "Automated checks, automated review and human review." Without them: "a slop cannon" |
| knowledge | best brakes = codebase design, testing, guardrails in code — 50 years of industry knowledge |
| order | brakes before accelerators ("this is the wrong order") |
| roles | team = **strategic**; agent = **tactical** |

Lessons embedded in the page (Domain Language, Review):

| idea | his words / rule |
|---|---|
| ubiquitous language | from DDD; same "everywhere": team talk, product UI, code |
| glossary ownership | agent-owned glossary = "fastest way to turn your glossary into an absolute dumpster fire"; human owns it |
| glossary timing | merge glossary changes as soon as the term is decided, before the spec; rename code before the spec |
| bounded contexts | two teams with different correct language → two glossaries, mapped from `GLOSSARY-MAP.md` |
| ADRs sparingly | only when hard to reverse **and** surprising **and** a real trade-off; template is 1–3 sentences |
| the loop (image caption) | "grill with docs, spec, tickets, implement, code review" |
| three kinds of review | automated checks (deterministic) · automated review (LLM-as-judge) · human review |
| human review's job | "you should never have to leave the same comment twice"; each comment improves the system |
| review in fresh context | `/code-review` runs as a sub-agent, "a fresh context window right then and there"; loaded via `CODING_STANDARDS.md` |
| retro | suggests improvements to the agent's **environment** for future runs |
| PR evidence | screenshots S-tier; execution-based (tests, console) A-tier; Merge Danger = door + blast radius |

PR #1316 skill glossary ("Use these terms, and only these"):

| term | definition (paraphrase; avoid-list) |
|---|---|
| software factory | agents turning tickets, PRs, schedules into merged code, on remote infra the user picks |
| Task | a kind of work defined once, run many times (review, explore, implement, ratchet). Avoid: job, workflow, action |
| Trigger | event starting a run: tracker/git-host change, orchestrator clock, or another run |
| Run | one execution of a task on one runner, a black box; "never waits for a human" — a human's later change triggers a new run. Avoid: session |
| Runner | disposable machine; memory only in tracker, git host, orchestrator. Avoid: server, sandbox |
| Ticket tracker | where tickets live; "the factory's human interface". Avoid: issue tracker |
| Ticket source | outside thing that files tickets (feedback button, monitor) |
| Git host | branches, PRs, reviews. Avoid: forge, repo |
| Orchestrator | receives triggers, starts runs, records queued/in-flight/finished. Avoid: dispatcher, scheduler, control plane |
| Observability platform | where runners send logs/traces; optional |
| Start slow | one automated trigger at a time, throttled; human review on every PR; "cap every loop of runs at a few tries before a human" |
| Question every task | 5 questions: trigger · does/reads/writes · triggers next · where a human re-enters · what stops duplicate runs |
| design done | every slot names a product and every task answers all 5 |

EXAMPLE-TASKS: explore (triage) → implementer (draft PR when checks pass) → automated review → rework (fixes only what review
named; after N fails → human) · decompose (spec → dependent tickets) · ratchet (daily, one file off a lint exception list) ·
fix (failed factory run; fixes never chain; always human review) · architecture (nightly, files candidates; human picks) ·
retro (1 merged PR in 10; proposes changes to the factory's own instructions as a PR).

Note: the PR glossary uses **Ticket tracker** and says avoid "issue tracker"; repo `GLOSSARY.md` uses **Issue tracker** and
says avoid "ticket". The PR says Part Two scripts still use trigger/state/workflow/action and alignment is "parked".

## 4 · What this means for our agent factory design (`docs/design.md`, 2026-10-21) — facts only

Matches

| ours | Matt |
|---|---|
| coordinator routes only, state = GitLab | orchestrator records runs; runs keep memory only in tracker + git host; chief-of-staff does all work in subagents |
| writer never talks to human; human re-enters via MR | "A run never waits for a human"; human's change triggers a new run |
| reviewer fresh per round, verdict only | review run "reads the diff cold"; `/code-review` in a fresh sub-agent |
| after 3 rounds → human | rework: "after a set number of fails" → human; "cap every loop … at a few tries" |
| two verdicts Standards + Spec | `code-review` two axes, parallel sub-agents, now foreground (#1208) |
| gate = mechanical rules in `make lint`/CI | brake 1 "automated checks"; ratchet task for stricter checks |
| human approves every merge | human review on every PR at the start |
| one glossary per project, discovery adds terms | one ubiquitous language; human owns glossary; decide terms before spec |
| retro phase = mattpocock retro | retro task proposes changes to the factory's own instructions |
| MR body Evidence · Merge Danger | `pr` skill: Evidence tiers + Merge Danger (door, blast radius) |
| intake: small/foggy/ready | explore task sorts tickets (easy / needs human / not a bug) |

Gaps (in Matt's material, absent from design.md)

- No "ticket source" (monitor, feedback button, error tracker) or dedupe question per source.
- No question 5 "what stops two runs doing the same work" stated per seat (wayfinder uses assignee-as-claim).
- No ratchet, fix-own-failed-run, or nightly architecture task; no clock triggers.
- No throttle on retro (Matt: 1 merged PR in 10); ours runs retro in discovery per change.
- No coordinator memory (chief-of-staff wiki: dated, commit-cited, ingest/query/lint).
- No "strategic track" duty for the coordinator (improve environment every message; "no workarounds").
- No explicit "start slow / one trigger at a time" rollout rule.
- ADR "sparingly" three-part test not stated (design.md does not mention ADRs).

Contradicts or differs from a decision

- Coordinator "owns nothing; routing only" vs chief-of-staff as "Directly Responsible Individual" owning strategy and memory.
- Coordinator is a playbook session; Matt's orchestrator is a component (Actions / own server), and `implement-spec` docs say
  for true AFK a deterministic loop is "faster, cheaper, and more reliable" than an agent orchestrating.
- Discovery is an interactive session per issue; #1316 defines runs as never waiting for a human (discovery is human-in-loop, so it is outside his "run").
- Term clash: our docs say "issue"/"work item"; #1316 mandates **ticket tracker** and "avoid issue tracker", while his
  repo `GLOSSARY.md` mandates **Issue** and "avoid ticket".
- Our build phase "test-first for bugs only"; open PR #1221 (tdd) adds "a bug fix's red reproduces the bug" — consistent; `implement`
  still says "Use /tdd where possible, at pre-agreed seams" (test-first for all, seams agreed with user).
- wayfinder now forbids triage labels on maps/tickets (#1181); our `/refine` wraps wayfinder — any `ready-for-agent` on map
  tickets would contradict it.
- Matt's repo now refuses new skills that compose from existing ones (SCOPE.md); our design adds a project workflow skill (`/crq` router) — his rule governs his repo only.
