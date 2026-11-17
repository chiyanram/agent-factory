# Triage Labels

The skills speak in terms of five canonical triage roles. This repo uses the same label names as mattpocock/skills.
When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the label from this table.

| Label | Meaning |
| ----- | ------- |
| `needs-triage` | Maintainer needs to evaluate this ticket |
| `needs-info` | Waiting on reporter for more information |
| `ready-for-agent` | Fully specified, ready for an AFK agent |
| `ready-for-human` | Requires human implementation |
| `wontfix` | Will not be actioned |

## Type labels

Each issue form sets one type label (#327). chiyanram/skills and chiyanram/rca-agent use the same three.

| Label | Form | Meaning |
| ----- | ---- | ------- |
| `type:bug` | Bug report | Something shipped is wrong |
| `type:feature` | Feature | Something new to ship |
| `type:task` | Task | A step that ships nothing new, such as a repo, CI or docs change |

The "Open question for the map" form sets no type label: it feeds the build map, not a change. The labels were created
once with `gh label create`; there is no sync tool.

## Other labels

| Label | Meaning |
| ----- | ------- |
| `released` | Set by semantic-release on a ticket whose change shipped in a release |
| `eval-baseline-approved` | The operator approves a change to `evals/reviewer/baseline.json` ([the proof check](../../evals/reviewer/README.md#the-proof-check)) |
| `after-pilot` | Work moved until after the first pilot has run |
| `waiting:operator` | A ticket's Claude session has stopped for the operator's word (a spec and design approval, grill answers). The session puts it on the issue when it stops, and takes it off once it has the answer, in the session or relayed by the coordinator in the operator's own words. `agent-factory board` lists the ticket under **needs you**, and the orchestrator pings once per time it goes on ([`waiting.ts`](../../src/core/dispatch/waiting.ts)). It is a session's claim, not a human record: nothing decides on it. Never on a PR. In a project with local specs, the issue is not the factory's ticket, so `board` shows it on its own row |
