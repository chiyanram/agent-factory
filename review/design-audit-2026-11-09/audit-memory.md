# Audit 6 · memory (#268, map #262)

Audits the target design: ADR-0002, `docs/DESIGN.md` §2 P3 and P9, §5 "Project knowledge" and "Spec home",
`GLOSSARY.md` (Project home, Spec home, Onboarder, Retro). Baseline: chiyanram/skills#210 (2026-11-06). Sources read
2026-11-09. Only primary sources (vendor docs, papers, source code).

## Verdict table

| # | decision (target design) | verdict | differs from skills#210 |
|---|---|---|---|
| M1 | P3 / ADR-0002: the ticket tracker and the git host are the memory; a restart loses nothing | **change** (restate P3, or mirror the per-host records) | yes |
| M2 | Structure: a repo map built at run time, never stored | keep | no (#210 silent) |
| M3 | Meaning: `glossary.md` with avoid words, plus the decision records | keep | no |
| M4 | Commands and gotchas: `brief.md`, written once by the onboarder, reviewed by a human | refine (only non-inferable facts; re-run its commands; measure it) | yes |
| M5 | Lessons: proposed by the retro, accepted by a human | refine (add expiry and re-validation) | yes |
| M6 | Link existing `AGENTS.md`/`CONTEXT.md`, never copy; nothing that rots; re-check every `file:line` each run | keep | no |
| M7 | P9: nothing committed to the product repo by default | keep (refine: name a git-host store for the opt-in projects) | yes |
| M8 | Spec home is a setting (local folder default; shared place; issue/Jira; repo commit) | refine (tie to M1: a spec a second machine needs must have a git-host or tracker copy) | yes |

## M1 · P3: the tracker and the git host are the memory — change

**Problem in the target design.** P3 says the tracker and git host are the memory. But the target design keeps
these on one host only:

- START and approval records: `~/.factory/starts/…`, `~/.factory/approvals/…` (ADR-0012 S1);
- the spec, by default: "a local folder, which is the default and what work uses" (DESIGN §5);
- the project home: brief, glossary, lessons (`GLOSSARY.md` "Project home");
- run records (backoff time, hashes, audit; DESIGN §3, §5).

DESIGN §3 also says "a phase may run on one machine and the build on another." A spec in a local folder on machine A
is not on machine B. ADR-0002 rejected "firstmate-style task files" because they are "per host". The target design
now has per-host stores again. A restart on the same host loses nothing. Loss of the host loses every pre-PR spec
and approval. The S1 bot note on the PR is a partial mirror, and only after the PR opens.

**What industry does.** Vendors name each store and say whether it is shared:

- Claude Code: "Auto memory is machine-local. … Files are not shared across machines or cloud environments."
  https://code.claude.com/docs/en/memory
- GitHub Copilot Memory: "Each repository-level fact belongs to one specific repository"; stored server-side, shared
  with users who have read access. https://docs.github.com/en/copilot/concepts/agents/copilot-memory
- gh-aw: repo-memory is "persistent file storage via Git branches with unlimited retention", default branch
  `memory/default`; cache-memory expires after 7 days. https://github.github.com/gh-aw/reference/repo-memory/
- Anthropic harness: a fresh session must "Read the git logs and progress files to get up to speed".
  https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents

**Proposal.** Pick one:
1. Restate P3: "The tracker and git host are the shared record. `~/.factory` on the host that ran START holds the
   human's word and private knowledge. A restart on that host loses nothing." Then mark the multi-machine sentence in
   §3 as needing M8.
2. Keep P3 as written, and require a git-host or tracker copy (hash at least) of every record a second machine needs,
   before that machine runs a phase.

Recommendation: option 1 plus M8. It is honest about the work setup (specs never in git), and it keeps the rule
testable.

**Differs from skills#210: yes.** #210 agreed "tracker + git host + orchestrator only" (Pocock, line 232) and "durable
progress artefacts + git checkpoints". It did not check the per-host stores added on 2026-11-09.

## M2 · Repo map at run time, never stored — keep

A stored map rots. A run-time map is the industry pattern for structure.

- Aider: "Aider sends a repo map to the LLM along with each change request"; "computed on a graph where each source
  file is a node"; "`--map-tokens` … defaults to 1k tokens." https://aider.chat/docs/repomap.html
- Gloaguen et al. 2026: "repository overviews, although popular and recommended by model providers, are not
  helpful." https://arxiv.org/abs/2602.11988 — supports keeping structure out of stored files.

Note for map #175 (evals): give the map a token cap, as Aider does.

**Differs from skills#210: no** (#210 did not cover it).

## M3 · Glossary with avoid words, plus decision records — keep

- Pocock `domain-modeling` (source, MIT): the glossary uses an `_Avoid_:` line per term, and "`GLOSSARY.md` should be
  totally devoid of implementation details." https://github.com/mattpocock/skills (engineering/domain-modeling/SKILL.md,
  GLOSSARY-FORMAT.md)
- Kiro steering: `structure.md` "covers file organization, naming conventions"; `product.md` the product's purpose;
  "Kiro includes these in every interaction by default." https://kiro.dev/docs/steering/

**Differs from skills#210: no.** #210 recorded "terms differ, glossary covers" and planned "one glossary".

## M4 · `brief.md` by the onboarder, written once, human-reviewed — refine

The shape matches industry: an agent drafts the file, a human reviews it.

- Copilot: you can "ask Copilot cloud agent to generate one for you"; it opens a draft PR and adds you as reviewer. Its
  onboarding prompt asks for build and test steps, and says the file "must not be task specific."
  https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions
- Claude Code: "target under 200 lines per CLAUDE.md file. Longer files consume more context and reduce adherence";
  "Review … periodically to remove outdated or conflicting instructions." https://code.claude.com/docs/en/memory
- Gloaguen et al. 2026: context files "do not generally improve task success rates", "increasing inference cost by over
  20% on average", for "both LLM-generated and developer-committed" files. https://arxiv.org/abs/2602.11988
- Chroma: "model performance consistently degrades with increasing input length"; "Even a single distractor reduces
  performance." https://www.trychroma.com/research/context-rot

**Refine.**
1. "Written once" rots. Re-run each command in the brief on each run (as `file:line` already is), and flag a failing one.
2. Keep only facts an agent cannot infer from the repo: commands, gotchas. No overview (see M2).
3. Measure a run with and without the brief (map #175). The paper says the gain is not automatic.

**Differs from skills#210: yes.** #210 held "short instruction files" as agreed good practice. The 2026 paper says
even short ones may not help, so the brief needs a measurement.

## M5 · Lessons: proposed by the retro, accepted by a human — refine

Industry splits on the human gate. All add a freshness rule.

- Devin: Devin suggests knowledge; "Edit the suggested Knowledge before saving, or dismiss" it. Stored on the platform,
  not the repo. https://docs.devin.ai/product-guides/knowledge
- Copilot Memory: no human gate, but it "checks the fact's citations against the current branch"; "The default expiry
  period is 90 days", reset when the fact is validated again.
  https://docs.github.com/en/copilot/concepts/agents/copilot-memory
- Claude Code auto memory: Claude writes it; plain markdown you "can read, edit, or delete".
  https://code.claude.com/docs/en/memory

**Refine.** Keep the human gate (stricter than Copilot, same as Devin). Add: each lesson cites `file:line` or a rule
id, is re-checked each run, and expires unless a run uses it or a human re-confirms it. Without this, accepted lessons
grow and become distractors (Chroma, above).

**Differs from skills#210: yes.** #210 RT5 counts a lesson the first time it happens. It had no expiry.

## M6 · Link existing files, never copy; nothing that rots; re-check `file:line` — keep

- Claude Code reads `AGENTS.md` in place and imports with `@path`; it warns that "if two instructions contradict each
  other, Claude may pick one arbitrarily." Copying makes two sources that drift. https://code.claude.com/docs/en/memory
- AGENTS.md: "Treat AGENTS.md as living documentation"; "The closest AGENTS.md to the edited file wins." https://agents.md/
- Copilot Memory re-checks citations against the current branch (above): same idea as re-checking `file:line`.

**Differs from skills#210: no.**

## M7 · P9: nothing committed to the product repo by default — keep

The industry default is the opposite: agent knowledge and specs are committed.

- Cursor project rules: "Stored in `.cursor/rules`, version-controlled". https://cursor.com/docs/context/rules
- Copilot: `.github/copilot-instructions.md`, `.github/instructions/*.instructions.md`, `AGENTS.md` in the repo
  (URL in M4). AGENTS.md: "at the root of the repository" (https://agents.md/).
- Kiro: "Steering files are part of your codebase." https://kiro.dev/docs/steering/

But every vendor also has an out-of-repo store: `CLAUDE.local.md` and `~/.claude/projects/<project>/memory/` (Claude
Code), user and team rules (Cursor), `~/.kiro/steering` (Kiro), platform knowledge (Devin), server-side memory
(Copilot), `~/.factory/docs` fallback (Factory). So P9 is a minority default with a supported path. The work setup
needs it. Reading the repo's own files stays first-class (§5 already links them).

**Refine (optional, personal and aruvii).** For a project that opts in, gh-aw's pattern — a separate `memory/…` branch on
the git host, never merged — gives a shared, versioned store without touching the default branch
(https://github.github.com/gh-aw/reference/repo-memory/). It also closes part of M1.

**Differs from skills#210: yes.** #210 assumed in-repo artefacts (Böckeler memory bank, Kiro steering, design docs kept
under SR15). P9 is newer than #210.

## M8 · Spec home is a setting — refine

A configurable spec location is a vendor pattern.

- Factory Spec Mode: "By default, plans are saved to `.factory/docs` inside the nearest project-level `.factory`
  directory", fallback `~/.factory/docs`; a "Spec save directory" option picks project, home or a custom path.
  https://docs.factory.com/cli/user-guides/specification-mode
- GitHub Spec Kit: specs in "`specs/[branch-name]/`", "versioned, created in branches, and merged."
  https://github.com/github/spec-kit/blob/main/spec-driven.md

**Refine.** The default (local folder) is per host. It conflicts with "a phase may run on one machine and the build on
another" (M1). Rule: before a build runs on a machine other than the one that holds the spec, the approved spec (or its
text and hash) must be in the tracker issue or the PR. S1 already puts the whole approved spec in the PR body once the
PR opens; move that copy to approval time.

**Differs from skills#210: yes.** #210 cited specs in the repo (Anthropic SPEC.md, spec-kit, Böckeler spec-anchored).
