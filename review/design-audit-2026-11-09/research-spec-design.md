# Research: spec + design by an AI coordinator, and design review before approval

Written 2026-11-10. Checked against agent-factory `c9e71a6` and skills `1e22921` (read-only snapshots). Covers
capability (2) intake: the coordinator writes the spec and design with the human; and (3) design review before
approval. Extends `audit-memory.md` (Spec Kit, Kiro steering). It does not redo it.

Marks: **[unverified]** = not read in a primary source. **[secondary]** = a first-hand account, but not the vendor's
own docs.

## 1. Verdict table

| # | our decision (where) | verdict | reason | sources |
|---|---|---|---|---|
| V1 | AI coordinator drafts spec + design; human answers questions (DESIGN.md §3; `coordinator.md`) | **keep** | Every tool does this: the AI writes, the human steers and approves. | Kiro specs; Spec Kit `spec-driven.md`; Claude Code best practices ("interview me"); Cursor plan mode; Factory Spec Mode |
| V2 | Spec = WHAT (no paths); design = HOW with `file:line` (PD6, SR2) | **keep** | Same split as Spec Kit and Kiro. Google design docs also keep goals apart from the design. | Spec Kit spec template ("Avoid HOW"); Kiro requirements.md vs design.md; Ubl, Design Docs at Google [secondary] |
| V3 | AC = numbered `AC-n — should …`, a table for many inputs (GA2, GA4, GA6) | **keep, refine** | Stable IDs + one observable outcome + example tables match everyone. Gap: no slot for the trigger or start state. EARS has `WHEN … SHALL`; Gherkin has `Given/When`. Refine GA6: allow "should X when Y" as the standard form. | Kiro EARS; Spec Kit (`FR-001 … MUST`, Given/When/Then); Cucumber Gherkin reference; OpenAI ExecPlans ("behavior a human can verify"); Mavin et al. RE'09 |
| V4 | DESIGN.md §9 still lists "AC form: Gherkin or numbered" as open | **change** (docs) | The rulebook decided it: numbered `should` lines (GA2, GA6). The open item is stale. Close it. | `skills-head/.../acceptance-criteria.md:16-23`; `af-c9e71a6/docs/DESIGN.md` §9 |
| V5 | Bug spec = current, expected, unchanged behaviour (AC12) | **keep** | Kiro bugfix specs use the same three parts. Two independent designs agree. | Kiro bugfix specs; Böckeler (Kiro too heavy for small bugs) |
| V6 | Questions: all at once, one numbered round, 2–4 choices, one recommended (DESIGN §3; #320) | **keep** | Spec Kit `/specify` asks all at once with an options table. Claude Code asks multiple-choice. Papers show asking lifts results. | Spec Kit `specify.md`, `clarify.md`; Claude Code best practices; ClarifyGPT; TiCoder; Ambig-SWE |
| V7 | No cap on question count; "never guess" (coordinator step 3, SR19) | **refine** | Spec Kit caps markers at 3 and turns the rest into recorded defaults; `/clarify` caps at 5. We have no cap, so a round can flood the human. Add a cap per round; the rest become marked defaults (SR19) under "accept all". | Spec Kit `specify.md` ("Maximum 3"); Spec Kit `clarify.md` ("Maximum of 5"); Böckeler (review burden) |
| V8 | "Never guess" lives only in the coordinator's prompt | **keep, note** | Ambig-SWE: models struggle to see that a task is underspecified. So a prompt rule alone is weak. Our second detector is the design-reviewer's `open` verdict and the SR19 check. Keep both. | Ambig-SWE; ClarifyGPT (detects by sampling, not by asking the model) |
| V9 | Answers go into the spec; approval lanes re-approve (R4) | **keep** | Spec Kit writes each answer into `## Clarifications` as `Q → A`. Same idea. | Spec Kit `clarify.md`; Kiro (specs stay in sync) |
| V10 | Explicit human approval before any build; never a bot (DESIGN §3, P6) | **keep** | Plan mode, Factory and Cursor block edits until a human approves. Spec Kit asks the user to approve tests. Only OpenAI ExecPlans runs on without a gate. | Claude Code permission modes; Factory Spec Mode; Cursor plan mode; Spec Kit Art. III; OpenAI ExecPlans (counter-example) |
| V11 | Approval bound to spec + design hashes; any edit makes it stale (DESIGN §3, AC10) | **keep** | Stronger than any agent tool (theirs bind to the session). Same rule as forge branch protection: a new push dismisses the approval. | GitHub protected branches; GitLab approval settings; Spec Kit (specs merged in branches) |
| V12 | PD7 (record a deviation in the design during build) vs V11 (any design edit = stale) | **refine** | The design does not say what a PD7 edit does to a live build. OpenAI and Kiro treat the plan as a living document. We must pick: a deviation log outside the hashed design, or stop for re-approval. **[unverified]** how GUIDE handles it today. | OpenAI ExecPlans ("living document", Decision Log); Kiro (specs sync with code) |
| V13 | Fresh read-only design-reviewer + verify pass before approval (`design-reviewer.md`, `dispatch/design.ts`) | **keep** | Spec Kit `/analyze` is read-only, graded, before build. Kiro has "Analyze Requirements". Anthropic: a fresh reviewer helps because it has not seen the reasoning. Ours is stronger: per-decision verdict, then a refute pass. | Spec Kit `analyze.md`; Kiro feature specs; Claude Code best practices; Anthropic evaluator-optimizer |
| V14 | Design review checks ACs and slices, but no AC → slice link (design-reviewer step 5; PD4/PD5) | **refine** | Spec Kit `/analyze` checks "coverage gaps"; Kiro links each task to its requirements. Ours checks coverage only at the ready check, after the build. Add: each slice names its AC-n; the design-reviewer flags an AC with no slice. | Spec Kit `analyze.md`; Kiro blog (tasks linked to requirements); OpenAI ExecPlans (validation per milestone) |
| V15 | Human reads spec + design + findings before approval | **refine** | Böckeler: SDD tools make "a LOT of markdown" to review. Spec Kit `/analyze` caps findings at 50, sorts by severity, and sums the rest. Give the human a one-screen approval digest: intent, ACs, irreversible steps, kept findings by severity. | Böckeler; Spec Kit `analyze.md`; Claude Code best practices ("skip style") |
| V16 | Lanes scale the process: tiny skips spec review and approval (lanes.json) | **keep** | Böckeler: one workflow for every size is "a sledgehammer". Kiro has Quick Spec. Bezos: two-way doors get a light process. Ubl: skip the doc when there is no ambiguity. | Böckeler; Kiro specs (Quick Spec); Amazon 2016 letter; Ubl [secondary] |
| V17 | One-way door lists each irreversible step + pre-mortem (LN3, SR20) | **keep** | Matches the Amazon one-way vs two-way door split. No agent tool has this. | Amazon 2016 letter; Ubl (cross-cutting concerns) [secondary] |
| V18 | Design must name a rejected alternative (SR10) | **keep** | Spec Kit `research.md` records "Alternatives considered". Google design docs have an alternatives section. | Spec Kit `plan.md`; Ubl [secondary] |
| V19 | Research first, claims at `file:line`, neutral helper questions (SR21, SR22, SR2, SR3) | **keep** | Plan mode, Cursor and Factory research read-only before a plan. Devin shows code cites in its plan **[unverified]**. Our drift check (SR3) has no peer. | Claude Code permission modes; Cursor plan mode; Factory Spec Mode; Devin interactive planning (search summary only) |
| V20 | Rules as gates on the design (SR14 no seam without a second user, etc.) | **keep** | Spec Kit's constitution gates (Simplicity, Anti-Abstraction) block the plan unless the exception is justified. Same idea, kept in a plugin. | Spec Kit `spec-driven.md`, `plan.md` |

Summary: 13 keep, 6 refine, 1 change (docs only). No design change. The refines are V3, V7, V12, V14, V15 (and V3's
small wording). V12 is the one with a real gap in the design.

## 2. Consensus (each held by ≥3 primary sources)

1. **The AI drafts, the human decides.** The agent writes the spec or plan; the human answers and approves. (Kiro,
   Spec Kit, Claude Code, Cursor, Factory.)
2. **Read-only research before the plan.** Planning cannot edit code. (Claude Code plan mode, Factory Spec Mode,
   Cursor plan mode.)
3. **Ask, do not guess, on what changes scope.** Questions come as multiple choice with options. (Spec Kit
   `/specify` and `/clarify`, Claude Code "interview me", Cursor, Factory; papers ClarifyGPT, TiCoder, Ambig-SWE.)
4. **Cap the questions; record defaults as assumptions.** (Spec Kit max 3 and max 5; Spec Kit Assumptions section;
   Bezos "70% of the information".) Weaker: 2 vendor docs + 1 letter.
5. **Separate WHAT from HOW.** (Spec Kit, Kiro, Ubl [secondary], our PD6.)
6. **Structured, testable acceptance criteria with stable IDs.** EARS, Given/When/Then, or `FR-001`. (Kiro, Spec Kit,
   Cucumber, OpenAI ExecPlans.) No consensus on one format.
7. **An explicit human approval before code edits.** (Claude Code plan mode, Factory, Cursor, Kiro phases.)
8. **An automated, read-only consistency check of the spec/plan before build.** (Spec Kit `/analyze`, Kiro
   "Analyze Requirements", Claude Code fresh reviewer.) Vendors make it optional; we make it required per lane.
9. **Trace requirements to tasks.** (Kiro tasks link to requirements; Spec Kit `/analyze` coverage; OpenAI ExecPlans
   validation per milestone.)
10. **Scale the ceremony to the change.** (Böckeler; Kiro Quick Spec; Amazon two-way doors; Claude Code: a plain
    prompt works in most cases.)
11. **Stale approval after a change.** (GitHub, GitLab branch protection.) No agent tool binds plan approval to a
    hash; we are ahead here.

Critique to keep in view: Böckeler finds SDD tools make too much markdown to review, give a false sense of control
(the agent does not follow the spec), and risk waterfall. Our answers: lanes (V16), the ready check re-runs every AC
row (the spec is checked, not trusted), and the digest proposal (V15).

## 3. Sources

### GitHub Spec Kit

- `spec-driven.md` — https://github.com/github/spec-kit/blob/main/spec-driven.md
  - "Through iterative dialogue with AI, this idea becomes a comprehensive PRD."
  - "Mark all ambiguities: Use [NEEDS CLARIFICATION: specific question]"
  - Gates: "Simplicity Gate (Article VII)", "Anti-Abstraction Gate (Article VIII)". "The LLM cannot proceed without
    either passing the gates or documenting justified exceptions".
  - Article III: "Tests are validated and approved by the user". No explicit human approval of the spec or plan.
  - Specs are "versioned, created in branches, and merged."
- `templates/spec-template.md` — https://github.com/github/spec-kit/blob/main/templates/spec-template.md
  - "**Given** [initial state], **When** [action], **Then** [expected outcome]"; "**FR-001**: System MUST …";
    "**SC-001**: [Measurable metric …]".
- `templates/commands/specify.md` — https://github.com/github/spec-kit/blob/main/templates/commands/specify.md
  - "LIMIT: Maximum 3 [NEEDS CLARIFICATION] markers total"; else "make informed guesses for the rest".
  - "Document assumptions: Record reasonable defaults in the Assumptions section".
  - "Present all questions together before waiting for responses"; table "Option | Answer | Implications".
- `templates/commands/clarify.md` — https://github.com/github/spec-kit/blob/main/templates/commands/clarify.md
  - "Maximum of 5 total questions across the whole session"; "Present EXACTLY ONE question at a time".
  - "`**Recommended:** Option [X] - <reasoning>`"; answers logged as "`- Q: <question> → A: <final answer>`" in
    "`## Clarifications`".
- `templates/commands/plan.md` — https://github.com/github/spec-kit/blob/main/templates/commands/plan.md
  - "Evaluate gates (ERROR if violations unjustified)"; research.md: "Alternatives considered: [what else evaluated]".
- `templates/commands/analyze.md` — https://github.com/github/spec-kit/blob/main/templates/commands/analyze.md
  - "**STRICTLY READ-ONLY**: Do **not** modify any files."; passes: duplication, ambiguity, underspecification,
    constitution alignment, coverage gaps, inconsistency; CRITICAL/HIGH/MEDIUM/LOW; "Limit to 50 findings total".
  - Runs after `/tasks`, before `/implement`.
- Note: the README now lists hyphenated commands (`/speckit-specify`) and a new `/speckit-converge`. Not read.

### AWS Kiro

- Specs — https://kiro.dev/docs/specs/
  - Files: "requirements.md (or bugfix.md)", "design.md", "tasks.md". Quick Spec runs "without approval gates", so
    the normal flow has gates (inferred; the mechanics are not described). "Requirements-First or Design-First."
- Feature specs — https://kiro.dev/docs/specs/feature-specs/
  - EARS: "WHEN [condition/event] THE SYSTEM SHALL [expected behavior]". design.md "documents technical architecture,
    sequence diagrams, and implementation considerations". "Analyze Requirements" is optional.
- Bugfix specs — https://kiro.dev/docs/specs/bugfix-specs/
  - "WHEN [condition] THEN the system SHALL CONTINUE TO [existing behavior]"; "not just what's broken, but what must
    remain working."
- Introducing Kiro — https://kiro.dev/blog/introducing-kiro/
  - Design from "approved spec requirements"; tasks linked to requirements; "Kiro's specs stay synced with your
    evolving codebase."

### Anthropic

- Claude Code best practices — https://code.claude.com/docs/en/best-practices
  - "Interview me until you could write the spec, then write it to SPEC.md." "Claude comes back with multiple-choice
    questions". "Once `SPEC.md` exists, start a fresh session to build from it".
  - "A fresh reviewer does help, because it hasn't seen your reasoning". "A reviewer that's asked to find problems
    will always find *something*."
- Permission modes (plan mode) — https://code.claude.com/docs/en/permission-modes
  - "Claude reads files, runs shell commands to explore, and writes a plan, but does not edit your source." Choices:
    approve, or "No, keep planning". `Ctrl+G` edits the plan.
- Building effective agents — https://www.anthropic.com/engineering/building-effective-agents
  - "Agents can then pause for human feedback at checkpoints or when encountering blockers." Evaluator-optimizer:
    "one LLM call generates a response while another provides evaluation and feedback in a loop."

### OpenAI Codex

- ExecPlans — https://developers.openai.com/cookbook/articles/codex_exec_plans
  - "Every ExecPlan is a living document." "Every ExecPlan must be fully self-contained." Required: Progress,
    Surprises & Discoveries, Decision Log, Outcomes & Retrospective.
  - "Acceptance should be phrased as behavior a human can verify."
  - No gate: "do not prompt the user for "next steps"; simply proceed"; "Resolve ambiguities autonomously". A
    counter-example to our P8/approval.

### Factory

- Specification Mode — https://docs.factory.com/cli/user-guides/specification-mode
  - "Droid should not edit files, change configuration, make commits …"; it "can … ask clarifying questions".
  - Ends with `ExitSpecMode` for approval; approve, or keep iterating. Saved specs: `.factory/docs`.

### Cursor

- Plan mode — https://cursor.com/docs/agent/planning
  - "Agent asks clarifying questions"; "Researches your codebase"; "You review and edit the plan through chat or
    markdown files"; "Click to build the plan when ready".

### Devin

- Interactive planning — https://docs.devin.ai/work-with-devin/interactive-planning
  - **[unverified]**: two fetches returned an index page. A search summary says the plan has "code citations you can
    inspect". Confidence levels: only in third-party guides. Not used as a source for any verdict alone.

### Design review practice

- Malte Ubl, "Design Docs at Google" — https://www.industrialempathy.com/posts/design-docs-at-google/
  **[secondary]**: a Google engineer's own blog, not Google docs.
  - Non-goals are "things that could reasonably be goals, but are explicitly chosen not to be goals". Sections:
    alternatives considered, cross-cutting concerns. Review: comment threads, then a design review meeting. Skip the
    doc when the problem is not ambiguous.
- Amazon 2016 shareholder letter — https://www.aboutamazon.com/news/company-news/2016-letter-to-shareholders
  - "Many decisions are reversible, two-way doors. Those decisions can use a light-weight process." "most decisions
    should probably be made with somewhere around 70% of the information you wish you had."
- Google, Meta: no first-party published design-review process found. **[unverified]** gap.

### Approval binding (forge practice)

- GitHub — https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches
  - "dismiss stale pull request approvals when commits are pushed that affect the diff".
- GitLab — https://docs.gitlab.com/user/project/merge_requests/approvals/settings/
  - "Remove all approvals when commits are added to the source branch"; "Prevent approval by merge request creator".

### Acceptance-criteria formats

- EARS: Mavin, Wilkinson, Harwood, Novak, RE'09, DOI 10.1109/RE.2009.9. **[unverified]**: paper not read; the
  pattern is quoted from Kiro.
- Gherkin — https://cucumber.io/docs/gherkin/reference/
  - "`Given` steps are used to describe the initial context"; "We recommend 3-5 steps per example"; examples should
    not "make any assumptions about technology or user interface".

### Papers

- ClarifyGPT (Mu et al., FSE 2024) — https://arxiv.org/abs/2310.10996
  - Detects ambiguity by sampling several solutions and checking agreement; asks only then. GPT-4 MBPP-sanitized
    70.96% → 80.80%. **[unverified]**: numbers from the abstract via search, full paper not read.
- TiCoder (Lahiri et al.) — https://arxiv.org/abs/2208.05950 ; user study https://arxiv.org/abs/2404.10100
  - Tests as the way to pin user intent; pass@1 rises with 1–5 user answers. **[unverified]**: abstract via search.
- Ambig-SWE (Vijayvargiya et al., CMU) — https://arxiv.org/abs/2502.13069
  - "models struggle to distinguish between well-specified and underspecified instructions"; interaction gives
    "up to 74% over the non-interactive settings".
- SWE-bench Verified (OpenAI): many issues filtered as underspecified. **[unverified]**: page returned 403.

### Critique

- Birgitta Böckeler, "Understanding Spec-Driven-Development: Kiro, spec-kit, and Tessl", martinfowler.com,
  2025-10-15 — https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html
  - "spec-kit created a LOT of markdown files for me to review." "I'd rather review code than all these markdown
    files."
  - Small bug in Kiro: "like using a sledgehammer to crack a nut."
  - "I frequently saw the agent ultimately not follow all the instructions."
  - "An effective SDD tool would have to provide a very good spec review experience."

## 4. Our design, as read

- `af-c9e71a6/docs/DESIGN.md` §3 (flow, approval, questions), §9 (stale AC-form item).
- `af-c9e71a6/GLOSSARY.md` (Spec, AC, Design, Slice, Approval, Design-reviewer).
- `af-c9e71a6/src/core/dispatch/design.ts:1-13` — checked: review re-runs per spec+design hash pair; an approval
  given before the verify pass ended does not release the build.
- `skills-head/plugins/rulebook/skills/crq/` — `SKILL.md`, `process/roles/{coordinator,design-reviewer,verify-pass}.md`,
  `process/lanes.json`.
- `skills-head/plugins/rulebook/skills/planning/references/` — `acceptance-criteria.md` (GA1–AC12),
  `spec-review.md` (SR1–SR22), `program-design.md` (PD1–PD10; no rule links a slice to an AC).
