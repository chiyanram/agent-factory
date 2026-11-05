# 23 — Agent roles: the 4 old agents vs references and products (2026-10-20)

For chiyanram/agent-factory#1 (roles; boxes 1, 2, 4). Read-only. Product rows from research/02 (Devin, Factory weak).

## Roles per source

| source | roles | lifetime | who does discovery / grilling | handoff |
|---|---|---|---|---|
| pstack | coordinator · sub-coordinator · worker/verifier (orchestrate.md:15-17) | coordinator standing; workers fresh, "Never resume-chain a brief" (:56) | coordinator/lead with human; "a worker cannot ask you a question" (:11) | 9-field brief; one owner per PR |
| mattpocock | skills; implementer/merger/exploration subagents (implement-spec:23-32) | per ticket | HITL grilling in the user's session (wayfinder:79) | spec/tickets `ready-for-agent` |
| firstmate | firstmate supervisor · ship/scout crewmates | supervisor long-lived; crew per task | firstmate intake (AGENTS.md:183); scout plans (:181); workers never address the captain (:11) | Captain's intent verbatim + spec (:216) |
| openclaw | coordinator · researcher · writer · reviewer (presets/team.json) | named; bounded sessions_spawn | coordinator = single point of contact | artefact path, checks, uncertainty |
| humanlayer | research → plan → implement (ralph_*) | one phase per session | create_plan interactive with user; ralph_impl sends no-plan tickets back to "ready for spec" (:25) | plan doc + ticket status |
| forge | declared workers | per run | human opts in `forge:ready` | ticket → PR |
| addy | reviewer personas only | per call | user's /spec session; "The user… is the orchestrator" | SPEC.md, plan |
| plinth | business-analyst · architect · tech-lead · coders | per call | business-analyst with the user; "Do not implement application code" | issue comment: spec + Gherkin |
| Codex cloud / Copilot / Cursor | one agent per task | per task | human's prompt/issue | PR |
| Claude Code | lead + subagents/teammates/--bg | per task | lead session | spawn prompt |
| Factory Missions | orchestrator · workers · validators | workers fresh | orchestrator asks clarifying questions | validation contract |

## Our 4 agents

| agent | did (evidence) | maps to | verdict |
|---|---|---|---|
| aruvii-analyst | stages 1–5: grill → REQ → wireframe → draft MR (research/12:15-19); REQs 565–1,115 lines; 1 merged MR (!168) | plinth BA · humanlayer plan · mattpocock HITL grilling · firstmate scout | keep role; one discovery session per issue, ends at /approved |
| Aruvi Spec Reviewer | per-commit notes (18 on !258; 8 in 12 min on !267) | independent reviewer | merge into one fresh reviewer |
| Aruvi Agent Developer | TDD + Verifier; 8/78 merged MRs (research/08:68) | writer/crewmate/implementer | keep as writer, fresh per MR |
| aruvii-qa | review rounds, AC citing | reviewer/validator | merge with spec reviewer |

Missing: a coordinator (old G6) — today only Discord @mentions.

## Patterns (≥2 sources)

- The writer starts from an approved artefact and never talks to the human (pstack, firstmate, mattpocock, humanlayer, plinth, forge).
- Discovery is a separate session that talks to the human — coordinator (firstmate, openclaw, pstack, Factory) or a HITL phase/analyst (mattpocock, humanlayer, plinth, addy).
- Review by a non-author with fresh context (pstack, mattpocock, addy, Factory, products).
- Roles are per-task seats, not standing personas ("adversarial signal comes from model diversity, not assigned personas", pstack via research/14:132).
- Grilling does not belong in the writer: no reference has the implementer grill; our grilling takes days (#660 H1–H14); research/21 rated #16 P1 THIN; addy anti-pattern C (orchestration-patterns.md:316-326).

Seats: discovery (intent + spec to /approved) · writer (branch) · reviewer (verdict only) · coordinator (routing, never artefacts) · gate (CI) · human (approve, merge).
Unverified: whether discovery is the coordinator itself or a session it starts (pstack guard-the-context-window argues for a separate session).
