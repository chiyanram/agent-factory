# #262 Map: Audit the factory design against industry software-factory practice — keep or change, per core decision

## Destination

**A design audit of agent-factory against industry software-factory practice.** Each core decision in the target design (`docs/DESIGN.md` and the ADRs) has a verdict, keep or change, that cites at least 2 independent sources. Each "change" verdict is decided by the operator, and an accepted change becomes a ticket on map #30.

## Notes

- **Audits the target design, not the code** (operator, 2026-11-09, Q6). Code is cited only to check a claim. DESIGN §7 already lists the code gaps; do not report them again.
- **May reopen accepted decisions, only as proposals** (Q2). Each proposal is its own grilling ticket. Nothing on #30 waits for this map (Q7).
- **Sources:** the skills#210 comparison (2026-11-06) is the baseline. Add what it lacks: GitHub Copilot coding agent, gh-aw, OpenHands, Devin, Factory droids, the Claude Code plugin docs, and others found on the way. Mark each verdict that differs from skills#210 (Q3). A source counts only when it is primary (vendor docs, papers, source code, incident reports). Evidence rule CP4 from #30 applies: ≥2 independent references.
- **Words:** `GLOSSARY.md`. "Connector" is the executable I/O part (ADR-0014); "plugin" is a Claude Code plugin (rules, process, role cards). The code and ADR-0014 still say "plugin" for a connector, which #144 phase 3 fixes.
- **Six areas** (Q5): control flow, safety, connectors, plugins and role cards, review, memory. One research ticket each.
- **Research output:** one file per area, `research/audit-<area>.md`, on a `research/audit-<area>` branch, never merged. The operator approves each commit and push.
- Skills to consult: research, grilling, domain-modeling, writing-for-agents.

## Decisions so far

- [Audit 1 · control flow](https://github.com/chiyanram/agent-factory/issues/263): P1, P7, P8, approval by lane, raise-only lane kept; fresh runs and backoff refined; the 5-min stall stop changes
- [Audit 2 · safety](https://github.com/chiyanram/agent-factory/issues/264): P4, P5 kept; srt, P6, laptop deny list, test checks refined; the host-name egress allowlist changes (data leaves via the model API)
- [Audit 3 · connectors](https://github.com/chiyanram/agent-factory/issues/265): own contract over MCP kept; pin wording refined; inbound listener and MCP-bridge pinning change
- [Audit 4 · plugins and role cards](https://github.com/chiyanram/agent-factory/issues/266): Claude Code plugins and 9 cards kept; Copilot CLI loads Claude plugins; prose card fields and list-order conflicts change; Copilot repo-skill override is a P5 hole
- [Audit 5 · review](https://github.com/chiyanram/agent-factory/issues/267): lens count, one verify pass, 3 rounds kept; votes, severity, evidence floor refined; near-duplicate merge and lens retirement change
- [Audit 6 · memory](https://github.com/chiyanram/agent-factory/issues/268): repo map, glossary, P9 kept; brief, lessons, spec home refined; P3 is false while START, approval and spec live on one host

## Not yet specified

- The refine verdicts: whether each goes to #30 as-is or needs its own grilling ticket. Decided in #269.
- Whether any verdict needs a prototype (for example a role card's shape, or the connector protocol) before it can be decided.
- Which accepted changes need an ADR update, and in which order they land on #30.

## Out of scope

- Evals and measurement: map #175 (eval the factory's output) owns them (Q5).
- Code gaps against the target design: DESIGN §7 owns them (Q6).



# #269 Which audit changes go to map #30, and in what order?

## Question

Of the change verdicts from the six audit research tickets, which does the operator accept, which ADRs do they amend, and in what order do they land as tickets on map #30 (build to cutover)?

# #272 Egress: how does the box stop data leaving through an allowed host?

## Question

A host-name allowlist lets the agent upload files to `api.anthropic.com` with an attacker's key, or to a registry (Rehberger 2025). Options: TLS inspection that checks the token and blocks `/v1/files`, read-only registry mirrors, or accept the risk. ADR-0012 rejected a login-injecting proxy for the Claude Max terms; does this differ enough?

Evidence: [research/audit-safety.md](https://github.com/chiyanram/agent-factory/blob/research/audit-safety/research/audit-safety.md), from #264.

# #273 Copilot runner: how is a branch kept from replacing the pinned crq skill?

## Question

Copilot CLI loads a repo's `.claude/skills/` before plugin skills, first found wins. A branch can add `.claude/skills/crq` and replace the pinned rulebook, which breaks P5. What guard does #162 (Copilot runner) add?

Evidence: [research/audit-plugins-roles.md](https://github.com/chiyanram/agent-factory/blob/research/audit-plugins-roles/research/audit-plugins-roles.md), from #266.

# #274 Role cards: which frontmatter fields are machine values the engine enforces?

## Question

`tools`, `enforced_guardrails`, `input` and `must_not_see` are prose today, so the engine cannot enforce them. Proposal: permission-rule syntax for tools, IDs from an engine-owned closed list for the rest, drop `next`, shared names (name, description, tools, model) plus `metadata`. Accept, and where does the closed list live?

Evidence: [research/audit-plugins-roles.md](https://github.com/chiyanram/agent-factory/blob/research/audit-plugins-roles/research/audit-plugins-roles.md), from #266.

# #275 Stall stop: what silence limit lets an honest test run finish?

## Question

A silent foreground Bash call may run 10 min, and ADR-0012 S8 makes the writer run its own ITs, but the stall stop is 5 min and can only go lower. Proposal: pin `BASH_MAX_TIMEOUT_MS` in the box and set the stall time to it plus a margin.

Evidence: [research/audit-control-flow.md](https://github.com/chiyanram/agent-factory/blob/research/audit-control-flow/research/audit-control-flow.md), from #263.

# #276 Memory: where do START, approval and the spec live so another machine can build?

## Question

P3 says a restart loses nothing, but START, approval, the spec and the project home live only in one host's `~/.factory`, while DESIGN §3 lets the build run on another machine. Reword P3 to two stores, copy the approved spec to the issue or PR at approval, or something else?

Evidence: [research/audit-memory.md](https://github.com/chiyanram/agent-factory/blob/research/audit-memory/research/audit-memory.md), from #268.

# #277 Plugin conflicts: how are two disagreeing prose rules settled?

## Question

DESIGN §5 proposes list order wins, but Claude Code's docs say for conflicting instructions "Claude may follow either one". Proposal: one process plugin per project, rule IDs namespaced by plugin, a conflict is a `config check` finding.

Evidence: [research/audit-plugins-roles.md](https://github.com/chiyanram/agent-factory/blob/research/audit-plugins-roles/research/audit-plugins-roles.md), from #266.

# #278 Inbound front doors: is the Discord bot a connector or a separate record writer?

## Question

ADR-0014 P1's one-shot describe/call cannot host a listener. Make inbound parts separate programs that only write records, or add a `poll` op with a cursor?

Evidence: [research/audit-connectors.md](https://github.com/chiyanram/agent-factory/blob/research/audit-connectors/research/audit-connectors.md), from #265.

# #279 MCP bridge: how is the MCP server it starts pinned and boxed?

## Question

The bridge's sha256 does not cover the MCP server it starts (often `npx <pkg>`), which runs on the host with a login. Pin by digest, run in a box with an egress allowlist, list only mapped tools? Also fix ADR-0014's outdated reason for rejecting MCP.

Evidence: [research/audit-connectors.md](https://github.com/chiyanram/agent-factory/blob/research/audit-connectors/research/audit-connectors.md), from #265.

# #280 Review: should the verify pass merge near-duplicate findings across lenses?

## Question

An exact file:line + rule key leaves two threads for one bug flagged by two lenses on nearby lines. Proposal: keep the exact merge, then the verify pass merges the same issue within about ±5 lines and records every lens.

Evidence: [research/audit-review.md](https://github.com/chiyanram/agent-factory/blob/research/audit-review/research/audit-review.md), from #267.

# #281 Lens retirement: retire for noise or for silence?

## Question

DESIGN §6 retires a lens after 20 PRs with no unique verified finding. Industry retires rules for low precision or low resolution rate. Proposal: count acted-on findings (ADR-0015 R4), add a precision floor, never retire a rare severe lens that still catches its seeded golden bugs, operator approves each.

Evidence: [research/audit-review.md](https://github.com/chiyanram/agent-factory/blob/research/audit-review/research/audit-review.md), from #267.

