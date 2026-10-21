# Agent factory — design (draft for approval, 2026-10-21)

Map: [#1](https://github.com/chiyanram/agent-factory/issues/1). Each line links to where it was decided; evidence is in
`research/`. A piece is here only if it traces to an issue we hit or a practice ≥2 references share (CP4); the two that
do not are marked **thin**.

## The flow

```
 human ⇄ DISCOVERY ─/approved─▶ WRITER ─▶ REVIEWER ─▶ GATE ─▶ a maintainer approves ─▶ merge
   │      intake → issue →        fresh,     fresh,      GitLab CI,
   │      REQ → draft MR          own        2 verdicts  by kind
   │                              worktree
   └──── COORDINATOR starts each seat and routes; owns nothing; state = GitLab
```

## 1 · Seats — who does what ([#1](https://github.com/chiyanram/agent-factory/issues/1), research/23)

| seat | owns | runs as |
|---|---|---|
| human | approve, merge | — |
| coordinator | routing only | one playbook session (claude or codex); laptop or VM, same command, no bypass (research/24) |
| discovery | intake → issue or map → grill → REQ → draft MR, until `/approved` | interactive session, one per issue |
| writer | the branch | `claude --bg` in its own worktree (fallback `claude -p`); never talks to the human |
| reviewer | a verdict only | `claude -p`, one shot, fresh per round |
| gate | the CI result | GitLab CI job |

Intake: small → issue (`/issue`); foggy → map + work items (`/refine`); ready → grill. Helpers (security auditor,
architect, scout) are called by a seat and own nothing. Other tools: `codex exec` is the headless equivalent.

## 2 · The record and the channel ([#4](https://github.com/chiyanram/agent-factory/issues/4) Q1)

- Issue → MR is the one record. The MR description holds the intent verbatim and the acceptance criteria.
- Discord stays a talk channel; every answer is copied verbatim into the MR. Status lives in GitLab, not chat.
- Identity: one GitLab service account per developer (`agent-<name>`, Developer role, cannot merge master). Every agent
  commit carries `Co-authored-by: <human>`; every post starts with its seat. The starter does not approve (team rule).
- Other developers use the same pipeline. On undraft the writer assigns a maintainer as GitLab reviewer; the
  coordinator posts one daily line of green-and-waiting MRs. **Thin** ([#19](https://github.com/chiyanram/agent-factory/issues/19)).

## 3 · The rulebook ([#1](https://github.com/chiyanram/agent-factory/issues/1) box 5, research/22)

```
AGENTS.md            root, <200 lines, file-type MUSTs ≤3 per block     CLAUDE.md = @AGENTS.md
├─ <dir>/AGENTS.md   area rules (e.g. aruvii-ui/, db/migration/)
└─ .agents/skills/<domain>/references/*.md   rule bodies, plain markdown (.claude/skills → symlink)
generic rules: chiyanram/skills → Claude plugin + `npx skills add` for other tools
```

- Each reference has five sections: Rules · When X, use Y · Good/Bad · Decided edges · Review checks (old G5). A rule is
  imperative + because + the failure it prevents, ≤35 words (G21). One file serves writer and reviewer.
- Mechanical rules go to `make lint` or CI. `make lint` checks <200 lines and the root→leaf chain <32 KiB; a sentinel
  probe proves each tool loads the rules (G20).
- One glossary per project (Aruvii: `docs/CONTEXT.md`); discovery adds settled terms; the reviewer flags new terms. **Thin**.
- The 476 approved rules are written after approval, one MR per target file; each rule cites its ledger row; the
  reviewer checks both directions.

## 4 · The phases — `/crq` is a router naming one skill per phase ([#16](https://github.com/chiyanram/agent-factory/issues/16))

| phase | seat | skill |
|---|---|---|
| intake, grill | discovery | `/issue`, `/refine`, grilling + domain-modeling |
| spec | discovery | to-spec; intent + ACs in the MR |
| design | discovery | codebase-design, prototype |
| spec/design review | reviewer | one reviewer: spec-review + architecture A–E merged + the Aruvii decision guide (facts corrected) |
| build | writer | test-first for bugs only; features any order, PIT on touched classes with decisions, every surviving mutant listed. Modules without PIT stay test-first until agent-platform #659 |
| cleanup | writer | deslop, trimmed |
| code review | reviewer | §5 |
| gate | gate | §6 |
| done | writer | MR body: summary diagram · Evidence · Merge Danger · untouched-and-risk |
| retro | discovery | mattpocock retro + pstack correct ladder (strongest fix first) |

## 5 · Review ([#18](https://github.com/chiyanram/agent-factory/issues/18), research/19, 20, 25)

- One fresh reviewer, two verdicts kept apart: **Standards** (matching rules + smell baseline + a correctness lens:
  every finding names input, state, wrong result) and **Spec** (each AC cited at `file:line` both ways + F-01), at stage 7.
- Findings only (id · `file:line` · severity · fix); a spec/design review gives ALIGNED / CONFLICT / OPEN per decision.
- The lead verifies each finding into Act on · Consider · Noted · Dismissed (why).
- Each verdict names head SHA + patch-id: same patch-id → reuse; changed → review the delta only; after 3 rounds → human.
- Rules are read from **master**; an MR's own rule edits are reviewed as diff and flagged for the human.
- One context pack per head.

## 6 · Gate, done, isolation, measurement

- Gate: GitLab CI on the VM runner, done by kind of work ([#4](https://github.com/chiyanram/agent-factory/issues/4) Q4, Q5a). `/dod` is gone; its checks belong to the gate or the reviewer. Until the runner exists, the writer runs the same `make` target and records SHA + result on the MR.
- Approval: any maintainer, once reviewer and gate are green.
- Isolation: writers never deploy the shared stack (Testcontainers only) · own worktree · harness sandbox, no permission bypass · cannot merge master. No unix-zone walls.
- Measurement: tokens/$ per review (transcripts, kept 365 days) and output (rounds per MR, lead's bucket counts).
- Claude-only extras (hooks, subagents) are convenience; every hard rule is also in `make lint` or CI.

## Not in this design

- **Transition** — retiring the old 4-agent fleet and Verifier, frozen agent-fleet PR #84/#85, agent-platform !263 !269
  #713, VM zone users. First ticket after approval.
- Office work and other projects — follow-up.
