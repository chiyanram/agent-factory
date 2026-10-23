# Agent factory

The words we use for the agent factory: one coordinator AI, fresh workers and one rulebook. Each term names where it
was decided. Format: mattpocock `domain-modeling` skill, `GLOSSARY-FORMAT.md`.

## Language

### Seats and runs

**Seat**:
A job one party owns for one story: human, coordinator, writer, reviewer or gate (#1 CORRECTION 2026-10-23).
_Avoid_: role, persona, agent (for the job)

**Coordinator**:
The one AI session that talks with the human, does intake, grilling, spec, design and retro, and starts workers (#1 CORRECTION 2026-10-23; research/38).
_Avoid_: lead, orchestrator, discovery, analyst

**Worker**:
A fresh, short-lived AI session that does one job on one story and goes away; a writer or a reviewer (#4 Q2).
_Avoid_: crewmate, persona agent, standing agent

**Writer**:
The worker that owns the branch of one MR; it never talks to the human (#4 Q2; #1 "How seats run").
_Avoid_: developer agent, implementer

**Reviewer**:
The worker that gives a verdict only, fresh per round, made of a find pass and a verify pass (#18 Q7 CORRECTED; #22 Q1).
_Avoid_: QA, spec reviewer, lead

**Gate**:
The GitLab CI pipeline result at the MR head SHA, chosen by kind of work (#4 Q4, Q5a).
_Avoid_: Verifier, `/dod`

**Run**:
One start of a worker on one MR for one job; at most 1 per MR and 2 at once (#23 Q2).
_Avoid_: job (that is a CI job)

**Fleet**:
The coordinator plus the workers it starts; optional for every developer (#1 CORRECTION 2026-10-23).
_Avoid_: old fleet (that is the retired 4-agent setup)

**Old fleet**:
The 4 always-on persona agents (aruvii-analyst, Spec Reviewer, Agent Developer, aruvii-qa) and the Verifier; retired by the design, removed in L7 #27 (research/23).

**Verifier**:
The old fleet's gate queue: one slot, about an hour, full rerun only; replaced by the GitLab CI gate (#4 Q5a; research/17).
_Avoid_: using "verify" for it — that word now means the verify pass

**Discovery** (retired term):
A separate seat for intent → issue → REQ → draft MR; withdrawn 2026-10-23, its jobs belong to the coordinator (#1 CORRECTION).

**Chief of staff**:
Not a seat: a map plus a planning session the human starts when a goal is big, as map #1 is run (#23 Q1; research/36).

**Helper**:
An agent a seat calls for one question (security auditor, architect, scout); it owns nothing (#1 "Intake DECIDED").

### Work and record

**Story**:
One GitLab issue and its one MR; the MR is the one record of the work (#4 Q1).
_Also_: ticket, work item. _Avoid_: task (in Matt Pocock's software-factory language a task is a kind of work, not one story)

**Map**:
One issue labelled `wayfinder:map` that holds a big goal: notes, decisions so far, fog and its child tickets (`docs/agents/issue-tracker.md`).

**Intake**:
The first coordinator step: small and clear → issue (`/issue`); foggy or big → map + tickets (`/refine`); ready → grill (#1 "Intake DECIDED").

**Done by kind**:
The gate picks its checks from the kind of work: docs → lint + rule-load check; quick/standard code → touched tests + smoke core; floor or full → full gate (#4 Q4).

**Floor**:
Work that always takes the full gate: a migration, security, a public API or a new dependency (#4 Q4; old G8).

**Track 1 / track 2**:
Track 1 is this map's design work (plan, don't do); track 2 is temporary changes in agent-platform, the operator's call (#1 "Correction" 2026-10-20).

**Service account**:
One GitLab account per developer (`agent-<name>`, Developer role) that every agent of that developer posts and pushes as (#1 "Identity DECIDED").
_Avoid_: bot, shared token

### Review

**Context pack**:
The reviewer's input, built by a script once per head, with rules read from master (#22 Q3).
_Avoid_: review packet, brief

**Find pass**:
The first fresh reviewer call; it lists candidate findings (#22 Q1).

**Verify pass**:
The second fresh reviewer call; it opens each cited `file:line`, drops what does not hold and sorts the rest into the four buckets (#22 Q1).
_Avoid_: "the lead verifies", Verifier

**Finding**:
One problem: rule id · `file:line` · severity · fix; a correctness finding also names input, state and wrong result (#18 Q4, Q8).

**Verdict**:
The reviewer's result for one round, with Standards and Spec kept apart; at design review, ALIGNED / CONFLICT / OPEN per decision (#18 Q4, Q7).
_Avoid_: approval, MET / UNMET

**Act on**:
A verified finding the writer fixes this round (#18 Q9).

**Consider**:
A verified finding the human decides (#18 Q9).

**Noted**:
A real finding out of scope; it becomes a follow-up issue (#18 Q9).

**Dismissed**:
A finding dropped, with one line why, kept visible so the human can overrule (#18 Q9).

**Round**:
One review of one head; after 3 rounds the decision goes to the human (#18 Q1).

**Patch-id**:
The `git patch-id` of the diff; the same patch-id after a rebase reuses the last verdict (#18 Q1).

**Correctness lens**:
The question inside the Standards verdict: which real input, state or failure makes this path wrong (#18 Q8).

### Rulebook

**Rulebook**:
The small markdown files every writer and reviewer loads: root AGENTS.md, nested AGENTS.md, references and the generic plugin (#1 "Box 5"; research/22).
_Avoid_: rubric, `.claude/rules`, area file

**Root block**:
One file-type section of the root AGENTS.md: at most 3 MUSTs, then pointers to references (#21 Q5).

**MUST**:
A rule that sits in a root block or on top of a nested AGENTS.md, at most 3 per block (#21 Q5; old G1b).

**Reference**:
One markdown file under `.agents/skills/<domain>/references/` with five sections: Rules · When X, use Y · Good/Bad · Decided edges · Review checks (old G5).
_Avoid_: area file (withdrawn with `paths:`), rubric
