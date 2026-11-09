# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

Edit the "Label in our tracker" column to match whatever vocabulary you actually use.

## Type labels

Each issue form sets one type label (#327). chiyanram/skills and chiyanram/rca-agent use the same three.

| Label | Form | Meaning |
| ----- | ---- | ------- |
| `type:bug` | Bug report | Something shipped is wrong |
| `type:feature` | Feature | Something new to ship |
| `type:task` | Task | A step that ships nothing new, such as a repo, CI or docs change |

The "Open question for the map" form sets no type label: it feeds the build map, not a change. The labels were created
once with `gh label create`; there is no sync tool.
