# Roadmap

## 7. What changes from today (`main` `ff95ed3`)

| today | changes to |
|---|---|
| the implementer and the automated review refuse to start without `FACTORY_RULEBOOK` | they run with no plugin, on built-in defaults |
| the review requires the rulebook's `skills/code/references/smells.md` | the baseline comes from the process plugin, or the built-in one |
| `AGENTS.md` pointers must say "(rulebook plugin)" | the repo's own files plus enabled plugins, by their standard names |
| prompts live in `prompts/*.md`, with crq rule ids typed in | role cards live in the process plugin; the engine keeps no prompt text |
| the review reads the change description as the spec (`review/pack.ts:409`) | it reads the approved spec and design from the spec store (#224) |
| crq review checks never reach the review | they are always sent (#226), later from the process plugin |
| a ticket starts from an approval file, and the lane comes from the approval (`dispatch/table.ts:44`) | START opens it, approval releases the build, and the lane is checked from the diff |
| one approval kind, local, nothing on the git host (ADR-0012 S1) | approval by lane, many front doors, a bot-written copy on the git host |
| the floor guard (`ready/floor.ts`) checks skips, deleted test files, fewer asserts, bare suppressions and empty catches, with no waiver | plus judge files (S4), test-case removal within a file, and a waiver scoped to the head (#231) |
| findings have no lens or evidence grade (`review/verdicts.ts`) | `lens`, `grade` (`cited` / `walked` / `ran`) and `evidence` |
| design findings skip the verify pass | they go through the verify pass |
| one find pass for all rules (ADR-0004) | one finder run per lens, one shared verify pass |
| `report.json` has no `deferred` list | an optional `deferred` list (cleanup) |
| the PR body is built by the host | the host posts the implementer's `.factory/pr.md` below its own lines, cleaned (#335, built) |
| a team template copied once (ADR-0014 P3) | live settings layers, pinned by commit |
| one runner kind, `vm`; the laptop is refused (`box/choose.ts:24`) | `srt` on the work laptop (built for `claude`, #114) |
| `claude` only | an agent CLI connector: claude and copilot |
| caps per run only | caps per run, ticket and project-day, plus usage records |
| no project knowledge | the onboarder's brief and glossary in the project home |
| old words in code and docs (`forge`, `box`, `dispatcher`, `writer`, `plugin` for a connector) | the glossary's words (#144: docs in phase 3, code names in phase 4) |

**ADRs to update** as the work lands:
- 0004: a finder per lens (amended 2026-11-09);
- 0011: lanes and phases become plugin data;
- 0012:
  - S1: approval;
  - S2: the deny list;
  - S3: new rows;
  - S8, S11 and S17: the `srt` runner on the laptop;
  - S13: the implementer's PR body, cleaned (amended 2026-11-09, #335);
  - S14: role markers in posts and commits;
- 0014: connectors vs plugins; P3 becomes settings layers;
- 0015: the implementer's evals.

ADR-0006 (a service account per developer) is already replaced by 0012 S14.

## 8. Order of work

| step | what | tickets | exit check |
|---|---|---|---|
| 0 | eval set: the automated review's golden set (ADR-0015); 10 past tickets once there is run history | #213–#217 | a baseline recorded |
| 1 | safety core | #224 #226 #227 #228 #230 #231 #131 #103 | planted tests: a deleted test, a skip, fewer asserts, a lower lane and a stalled run each stop |
| 1, alongside | fixes found on the way | #185 #199 #200 #138 | `make lint` and `make test` |
| 2 | plugins, role cards, the new runs and settings | #229 #232 #236 (with chiyanram/skills#237) | a run with no plugin, with the rulebook, and with a stand-in team plugin |
| 3 | **ledger pilot**, with project setup by the onboarder | #235 #62 (with #158, #130 on the VM) | the targets in section 6 |
| 3b | **release 1.0** | #240 | the pilot passed; the docs match what 1.0 does |
| 4 | aruvii, after 1.0: agent-platform changes made locally and tested, then pushed and moved to the Contabo VM; tiny and docs tickets first, then bug, then feature. It adopts the crq plugin (#40); the Verifier stays as its gate (#234), and the cutover retires only the old fleet (#44) | #233 #234 #237 #35 #38 #40 #42 #43 #44; #41 (backup gate, optional); the automated review changes of ADR-0015 #218–#221 | the same targets |
| 5 | work laptop | #162 #114 #198 | the same targets on the small laptop; specs never in git |
| 6 | colleagues | Jira approval · spec PR · team template | the same targets with 2–3 colleagues |
| later | web app (#120) · signed approvals on laptops · scheduled extra tasks · the RCA agent | — | — |

Each step widens only after its exit check passes. Map #30 keeps the current list.

## 9. Open

- **Acceptance criteria form:** Gherkin (the rulebook's GA1–GA6) or numbered lines (the spec template here). Decided in
  chiyanram/skills#237.
- **Copilot CLI and Claude plugins:** whether Copilot CLI loads them. If not, the engine passes it the plugin's skills
  folder (the #162 spike).
