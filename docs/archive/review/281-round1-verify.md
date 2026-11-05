Verified 281 round 1 · head 5cd6ed1c · patch-id 34b19e49

| # | bucket | one line why | fix (Act on only) |
|---|---|---|---|
| S1 | Act on | holds: packet re-run at head flags only `code-review/SKILL.md`; agent file (tools, model, `skills:`) and `crq.md` §7 come from branch unflagged; header :20-22 promises otherwise | review-packet.sh:125-126 add `\|.claude/agents/*\|.claude/commands/*` to the case |
| S2 | Act on | holds: crq.md:403-404 names no agent, model mechanism, input or output; only stage-7 agent is sonnet-pinned and runs §1-8 | crq.md step 4: spawn a fresh `general-purpose` agent, `model` override sonnet (rule findings) / opus (correctness); input = findings + packet path; output = one bucket + one line per finding |
| S3 | Act on | holds: no agent preloads `standards-review` at head; :3 still says stage-7 rubric of code-standards-reviewer; body edits (:14-21, :63-65, :774-792) have no reader | revert this MR's body hunks in standards-review/SKILL.md; set :3 to "No /crq stage runs it (#642 interim)" |
| S4 | Act on | holds: `docs/adr/0004` here = spring-ai-confined-to-worker | code-review/SKILL.md :21, :153 → `agent-factory docs/adr/0004`; same edit upstream in agent-factory drafts so copy stays verbatim |
| S5 | Act on | holds: rubric §8 prints `round <n>`; crq.md:400-401 prompt has no round, nor which packet in round 2+ | crq.md step 3 add: "the round number, and in rounds 2-3 the `-since-` packet path" |
| S6 | Consider | real duplication, but coordinator does not preload `code-review`, so inline table in crq.md has a reason; CONTEXT.md row was a restatement before too | — |
| S7 | Act on | holds: MR leaves draft at §9 (crq.md:457), after stage 7 | code-review/SKILL.md:3 trigger → "Use at /crq stage 7, over the review packet for the MR head"; mirror upstream |
| S8 | Act on | holds: README:56 points at an MR note, history clause; also must agree with S3's new :3 | README.md:56 → "no /crq stage runs it (#642 interim)" |
| Spec: closing line · verify part met · unrequested std-review body | Dismissed | duplicates of S3/S2/S3 | — |
| Spec: stale "stage 8 cites AC" (architecture-review:353,:364; spec-review:12,:103,:344) | Noted | real, verified; files untouched by diff (§4) | follow-up: #642 step 4 (retire old rubrics) for architecture-review; new issue for spec-review (still run by hand) |

## Fix list for the writer

1. scripts/review-packet.sh:125-126: add `|.claude/agents/*|.claude/commands/*` to the `changed_rule_files` case.
2. .claude/commands/crq.md step 4 (:403-404): name a fresh `general-purpose` agent with `model` sonnet for rule findings, opus for correctness; input findings + packet path; output one bucket + one line per finding.
3. .claude/skills/standards-review/SKILL.md: revert this MR's body hunks; line 3 description → "No /crq stage runs it (#642 interim)".
4. .claude/skills/code-review/SKILL.md:21 and :153: `docs/adr/0004` → `agent-factory docs/adr/0004` (+ upstream).
5. .claude/commands/crq.md step 3 (:400-401): add round number and, in rounds 2-3, the `-since-` packet path.
6. .claude/skills/code-review/SKILL.md:3: trigger → "Use at /crq stage 7, over the review packet for the MR head." (upstream too).
7. .claude/skills/README.md:56: → "no /crq stage runs it (#642 interim)".
