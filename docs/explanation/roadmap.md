# Roadmap

**ADRs to update** as the work lands:
- 0004: a finder per lens (amended);
- 0011: lanes and phases become plugin data;
- 0012:
  - S1: approval;
  - S2: the deny list;
  - S3: new rows;
  - S8, S11 and S17: the `srt` runner on the laptop;
  - S13: the implementer's PR body, cleaned (amended, #335);
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
| 3 | **ledger pilot**, with project setup by the onboarder | #235 #492 | the targets in section 6 |
| 3b | **release 1.0** | #492 | the pilot passed; the docs match what 1.0 does |
| 4 | aruvii, after 1.0: agent-platform changes made locally and tested, then pushed and moved to the Contabo VM; tiny and docs tickets first, then bug, then feature. It adopts the crq plugin; the Verifier stays as its gate (#234), and the cutover retires only the old fleet | #233 (closed unbuilt) #234 #237 #492, which holds the set-up, the pilot and the cutover, with #41's backup gate optional; the automated review changes of ADR-0015 #218–#221 | the same targets |
| 4b | SDLC context: owners, deploys and incidents read through the `context.read` extension point, which aruvii needs ([the factory stack](factory-stack.md)) | its own ticket when it comes up | the coordinator and the review read a project's owners and deploys |
| 5 | work laptop | #114 #493 | the same targets on the small laptop; specs never in git |
| 5b | more than one line: a security line and an incident line beside ticket to PR ([the factory stack](factory-stack.md)) | its own ticket when it comes up | a second line runs on the same engine with the same brakes |
| 6 | colleagues | Jira approval · spec PR · team template | the same targets with 2–3 colleagues |
| later | signed approvals on laptops · scheduled extra tasks · the RCA agent | — | — |

Each step widens only after its exit check passes. Map #460 keeps the current list.

## 9. Open

- **Copilot CLI and Claude plugins:** whether Copilot CLI loads them. If not, the engine passes it the plugin's skills
  folder (the #493 spike).
