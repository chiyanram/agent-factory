# 0010 · One forge seam, two adapters

Status: accepted 2026-11-04 (operator, #64 Q1–Q3); the bot amended to a GitHub App on 2026-11-05. Amends ADR-0009.

## Context

Every coordinator script called GitLab through `scripts/lib/gitlab.sh`. The laptop pilot (#62) runs on a new GitHub
repository, so the scripts must work on GitHub as well, chosen per project.

## Decision

```
 poll  claim  release  status  reconcile  pack  start-writer  start-reviewer
                              │  the same forge_* calls, the same answer shapes
                       scripts/lib/forge.sh      FACTORY_FORGE=gitlab (default) | github
                      ┌───────┴────────┐
              lib/gitlab.sh        lib/github.sh
                      └───────┬────────┘
                       lib/http.sh   one `<cli> api --include` call, retried on a rate limit
```

- `forge.sh` names every call and the shape of its answer. An adapter only reads and writes. The decisions stay in
  the scripts, so they are the same on both forges: `poll.sh` decides `approved`, `stop` and `asks` from
  `forge_changes`, which gives members, comments, body edits and checks in one shape.
- The lines a script prints name a change `!12` on GitLab and `#12` on GitHub.

| | GitLab | GitHub |
|---|---|---|
| the bot | a service account, `bot: true` (ADR-0006) | a GitHub App the developer's account owns, posting as `<slug>[bot]`; `scripts/github-app.sh` mints its one-hour token from the App's key; a token that cannot list the App's installation repositories is refused |
| who may `/approved` | Maintainer or higher | a collaborator with write access or more |
| a body edit that makes `/approved` stale | the activity note with action `description` | `userContentEdits` |
| the gate | the head pipeline | the head commit's `statusCheckRollup`, mapped to `success`, `failed`, `running`, `none` |
| a finding at file:line | a diff discussion | a pull request review comment; a plain comment naming file:line when the line is not in the diff |
| a rate limit | 429 | 429, or 403 with `retry-after` or `x-ratelimit-remaining: 0` |
| removing a label that is already gone | no error | a 404, counted as removed once a re-read shows the label gone |

Only branches in the repository itself are supported on GitHub; a fork's branch cannot be fetched from origin.

## Why

- The pilot needs GitHub, and the operator wants the forge chosen per project.
- One seam keeps the rules that guard the gate (a human's `/approved`, stale after a human edit, no human token) in
  one place. Two copies of `poll` would drift.
- A test stubs `glab` or `gh` the same way (`glab_stub` in `tests/lib.sh`), so both adapters run with no network.

## Alternatives rejected

| option | why rejected |
|---|---|
| a machine user `agent-<dev>` as the bot | a second personal account with its own email and password, and a long-lived token; the operator rejected it on 2026-11-05 (#64 Q1, amended): GitHub's service account is an App |
| `/approved` as a GitHub review approval | the factory's gate is a literal comment on both forges, so one rule covers both (#64 Q2) |
| a second copy of the scripts for GitHub | the decisions would drift between the copies |

## Sources

#64 (body and decisions comment) · #62 · ADR-0002, 0005, 0006, 0009
