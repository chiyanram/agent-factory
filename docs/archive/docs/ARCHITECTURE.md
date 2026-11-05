# Architecture — the agent factory as decided

Every line cites where it was decided. `#N` is an issue on this repo. `research/NN` is a file in `research/`.
Terms are in `GLOSSARY.md`. Big decisions have an ADR in `docs/adr/`.

## 1 · The flow

```
┌───────┐  talk  ┌──────────────┐ start ┌──────────┐ ready  ┌─────────────┐ green ┌────────────┐ green ┌────────────┐
│ human │ ◀────▶ │ COORDINATOR  │ ────▶ │ WRITER   │ ─────▶ │ REVIEWER    │ ────▶ │ GATE       │ ────▶ │ maintainer │
└───────┘        │ one AI       │       │ fresh,   │ ◀───── │ find pass + │       │ GitLab CI  │       │ approves,  │
  │              │ session:     │       │ own      │ Act on │ verify pass │       │ on the VM  │       │ merges     │
  └─/approved──▶ │ intake·grill │       │ worktree │        │ fresh/round │       │ runner     │       └────────────┘
                 │ spec·design  │       └──────────┘        └─────────────┘       └────────────┘
                 │ retro        │             ≤3 review rounds, then the human decides
                 └──────────────┘
        every seat reads and writes ONE place ▼
┌──────────────────────────────── GitLab: the only memory ─────────────────────────────────┐
│ issue ─▶ draft MR: intent verbatim · ACs · design link · thread of answers and verdicts  │
│ claim label · head SHA + patch-id on each verdict · pipeline result · approval · merge   │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

The coordinator talks with the human. It does intake, grilling, spec, design and retro itself. After `/approved`, it
starts a fresh writer. The writer hands the MR to a fresh reviewer. Then the gate runs. A human maintainer approves and
merges. Workers never talk to the human. Sources: #1 CORRECTION 2026-10-23; #4 Q1, Q2, Q3b; #24; ADR-0001, ADR-0002.

| seat | owns | runs as | source |
|---|---|---|---|
| human | `/approved`, approve, merge | — | #4 Q3b |
| coordinator | talking with the human; intake → grill → spec → design → retro; starting workers | one AI session (Claude or Codex), CLI or tmux, laptop or VM | #1 CORRECTION; research/24, 38 |
| writer | the branch of one MR | `claude --bg` in its own worktree (fallback `claude -p`) | #1 "How seats run" |
| reviewer | a verdict only | find pass + verify pass, each a fresh `claude -p` | #22 Q1 |
| gate | the CI result at the head SHA | GitLab CI job on the VM runner | #4 Q5a; #20 |

Helpers (security auditor, architect, scout) are called by a seat. They own nothing. Source: #1 "Intake DECIDED".

## 2 · Phases — `/crq` is a router

```
COORDINATOR   intake → grill → spec → design
REVIEWER                                      → design review (Opus; ALIGNED / CONFLICT / OPEN)
HUMAN                                                            → /approved
WRITER                                                                       → build → cleanup
REVIEWER                                                                                       → code review (≤3 rounds)
GATE                                                                                                          → gate
WRITER                                                                                                               → done
COORDINATOR                                                                                                                 → retro (after merge)
```

`/crq` names one skill per phase. It never repeats the skill. Without the fleet, the developer's own session takes the
coordinator's phases. Sources: #24 resolution and its correction 2026-10-23; #16 Q3, Q4.

## 3 · Three ways a developer uses it

All three are optional. The rulebook and the router are the same in each. Source: #1 CORRECTION 2026-10-23; #1 "Box 2".

| way | what the developer opens | who does the coordinator's job | workers |
|---|---|---|---|
| laptop, with the fleet | a coordinator Claude session in the CLI or tmux; Discord if wanted | the coordinator session | started by the coordinator |
| laptop, without the fleet | Claude in the project; `/crq`, `/refine`, `/issue` | the developer's own session | none, or the developer starts them |
| VM | the same coordinator command in tmux | the coordinator session | started by the coordinator |

The VM adds uptime only. It needs no `create-agent.sh` and no permission bypass. Source: #1 "Box 2 coordinator DECIDED".

## 4 · The coordinator's triggers

The coordinator reacts when GitLab changes. It polls GitLab about every 5 minutes. Limits: 1 run per MR, at most 2
runs at once, the rest wait in a queue. Source: #23 Q2; research/37. **#23 is still open**: the playbook text is not written.

| trigger | action |
|---|---|
| `/approved` by a human maintainer (author checked, not a regex) | claim label, start writer, post an ack note |
| writer ready | start reviewer, keyed to the head SHA |
| open Act on, or gate red | start writer again; after 3 rounds, label `needs-human`; flakes split from real failures; results for old SHAs ignored |
| gate green and no Act on | undraft and assign a maintainer, by a plain `glab` command (no model) |
| MR merged | retro (throttled, about 1 per 10 merges); sweep the worktree |
| human message on Discord | copy it verbatim to the MR; ignore bot authors |
| once a day | digest of green-and-waiting MRs, oldest first; skip when nothing changed |
| run silent too long, or time cap hit | mark interrupted, release the claim |
| coordinator restart | reconcile claim labels that have no live run |
| human `/stop`, or a human push | agents stand off |
| merge conflict | rebase run, or `needs-human` |
| usage limit | pause all runs |
| note from an agent account | never starts a run |

## 5 · The record

```
GitLab issue ──▶ draft MR ──────────────────────────────────────────────▶ merged
                 description: intent (human's words) · ACs · design link
                 thread: answers copied verbatim · [reviewer] round N notes · one thread per Act on/Consider
                 head SHA + patch-id on every verdict · pipeline result
```

The MR is the one record. Discord is a talk channel only. A restart loses nothing because the coordinator re-reads
GitLab. Sources: #4 Q1; #1 "Box 2"; ADR-0002.

## 6 · Review

```
head SHA ──▶ context pack (script, rules from master) ──▶ FIND (fresh) ──▶ VERIFY (fresh) ──▶ MR
                                                          Standards + Spec   opens each file:line,
                                                          findings only      sorts into 4 buckets
```

| bucket | meaning |
|---|---|
| Act on | the writer fixes it this round |
| Consider | the human decides |
| Noted | real, out of scope; becomes a follow-up issue |
| Dismissed | dropped, with one line why |

Same patch-id after a rebase: the verdict is reused. Changed patch-id: only the interdiff is reviewed. Three rounds,
then the human. Models: rule findings on Sonnet; logic findings verified on Opus; stage-5 design review on Opus.
Sources: #18 Q1, Q4, Q6 CORRECTED, Q7 CORRECTED, Q8, Q9; #22 Q1–Q5; research/20, 25, 35; ADR-0004.

## 7 · Gate

| kind of work | the gate runs |
|---|---|
| docs, skills, markdown | lint + rule-load check |
| code, quick or standard lane | touched modules' tests + smoke core |
| floor (migration, security, public API, new dependency) or full lane | the full gate at the head SHA |

The gate is GitLab CI on the VM's own project runner. Writers never deploy the shared stack. They use Testcontainers.
Smoke runs only in the pipeline. Speed comes from parallel ITs, not a new machine. Sources: #4 Q4, Q5a, Q5b; #20;
research/30; ADR-0005. Pipeline shape: L5 #25 (open).

## 8 · The rulebook

```
project repo (e.g. agent-platform)
├─ AGENTS.md                         root, <200 lines; file-type blocks, ≤3 MUSTs each, then pointers
├─ CLAUDE.md                         = @AGENTS.md
├─ <dir>/AGENTS.md                   area rules near their code (e.g. aruvii-ui/, db/migration/), ≤3 MUSTs on top
├─ .agents/skills/<domain>/references/*.md   project rule bodies, plain markdown
├─ .claude/skills ──symlink──▶ .agents/skills
└─ docs/agents/<domain>.md           the project's values for generic rules

chiyanram/skills (generic, any project)
└─ plugins/rulebook/skills/<domain>/references/*.md   neutral rules that point to docs/agents/<domain>.md
   reaches Claude as a plugin; reaches other tools by `npx skills add`
```

| piece | rule | source |
|---|---|---|
| reference | five sections: Rules · When X, use Y · Good/Bad · Decided edges · Review checks | old G5; #1 "Box 5" |
| one rule | imperative + because + the failure it prevents, ≤35 words | old G21 |
| one file | serves the writer and the reviewer | #18 Q2 |
| mechanical rule | goes to `make lint` or CI; the reviewer skips it | #18 Q2; old G22 |
| size check | `make lint` checks <200 lines and the root→leaf chain <32 KiB | old G20 |
| load proof | a sentinel probe per tool | old G20 |
| generic vs project | generic rule in chiyanram/skills; Aruvii-only rule in the nearest nested AGENTS.md | #21 Q1+Q10 |
| writing the rules | one MR per target file, each rule cites its ledger row | #1 "Box 5 gap closed"; #21 resolution; research/34 |

Sources: research/22, 34; ADR-0003.

## 9 · Identity

```
developer ──creates once──▶ service account agent-<name> (Developer role, cannot merge master)
                             │ token made by the human, never by an agent
agent commit ──▶ Co-authored-by: <the human>
agent post   ──▶ starts with its seat, e.g. [reviewer]
human account ─▶ /approved and merge only
```

Team rule: the person who started the work does not approve it. GitLab Free cannot enforce it. On Free a Developer can
approve, so the reviewer's "never approve" rests on its prompt and the team rule. Sources: #1 "Identity DECIDED";
#22 Q5; research/24; ADR-0006. Setup checklist: L6 #26 (open).

## 10 · Isolation

Writers never deploy the shared stack. Each writer has its own worktree. No permission bypass; the harness sandbox
instead. The service account cannot merge protected master. Same on laptop and VM. No unix-zone walls.
Source: #1 "Box 8 DECIDED"; #4 Q5b.

Claude-only extras (hooks, subagents) are convenience. Every hard rule also lives in `make lint` or CI.
Source: #1 "Box 10 DECIDED".

## 11 · What is NOT in it

| out | why | where it goes |
|---|---|---|
| transition from the old fleet (4 persona agents, the Verifier, agent-fleet PR #84/#85, agent-platform !263 !269 #713, VM zone users) | not design | L7 #27 |
| office work, other projects | follow-up | after this map |
| stacked work (a change built on an unmerged change) | parked as fog | map #1 "Not yet specified" |
