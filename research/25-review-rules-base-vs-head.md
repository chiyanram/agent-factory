# 25 — Should the reviewer read rules from the MR head or from master? (2026-10-20)

For chiyanram/agent-factory#1 box 6 (re-checks #18 Q6). Read-only.

Old G3 default 3 (chiyanram/skills issues/07-grill-review-shape.md:39-41): "review reads rules/references from master, not the branch — an MR that edits a rule file gets that file flagged for human review". #18 Q6 chose the MR head for a waste reason (rubric version mismatch), not weighing trust.

| source | rules from | MR that edits rules | URL / file:line |
|---|---|---|---|
| Claude Code Code Review | base (REVIEW.md) | "never from the pull request's own changes… merge the REVIEW.md change first" | code.claude.com/docs/en/code-review-customize |
| claude-code-action | base (.claude/, CLAUDE.md, .mcp.json) | PR copies under .claude-pr/ "for reference only" | github.com/anthropics/claude-code-action/blob/main/docs/security.md |
| firstmate / no-mistakes | base | "honored only from the default-branch copy" | refs/kunchenguid-firstmate/.no-mistakes.yaml:6-7 |
| GitHub Actions guidance | — | must not check out untrusted code in a privileged context | docs.github.com/en/actions/reference/security/secure-use |
| GitHub Copilot code review | head | PR's own edits apply | docs.github.com/en/copilot/concepts/agents/code-review |
| CodeRabbit | head | feature-branch config used | docs.coderabbit.ai/getting-started/yaml-configuration |
| Greptile | head | PR config applies | greptile.com/docs/troubleshooting/common-issues |
| openclaw autoreview | operator config outside the repo | "must remain outside the reviewed repository" | autoreview/SKILL.md:175 |
| pstack / mattpocock | head working tree | not handled | interrogate/SKILL.md:18; code-review/SKILL.md:34-36 |
| GitLab Duo | not stated | — | review_instructions page |

Pattern: security-focused tools take rules from base and treat the PR's rule edits as data; convenience bots use head and do not discuss the risk.
