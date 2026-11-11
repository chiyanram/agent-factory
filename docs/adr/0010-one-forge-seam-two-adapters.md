# 0010 · One forge seam, two adapters

> Words: this record keeps the words it was written in; read it as **one git-host seam, two adapters**. [GLOSSARY.md](../../GLOSSARY.md) maps each old word to today's ([ADR-0016](0016-adopt-the-software-factory-vocabulary.md)).

Status: accepted 2026-11-04 (operator, #64 Q1–Q3); the bot amended to a GitHub App on 2026-11-05. Amends ADR-0009.

Amended by [ADR-0012](0012-safety-design-for-unattended-runs.md).

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
| the bot | a service account, `bot: true` (ADR-0006) | a GitHub App the developer's account owns, posting as `<slug>[bot]`; `scripts/github-app.sh` mints its one-hour token from the App's key; a token that cannot list the App's installation repositories, or an App not installed on the project, is refused; a writer's session gets no gh login and no system or global git config, so it can act only as the App |
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

## Amended 2026-11-06

By [ADR-0013](0013-typescript-package-cli-first.md) ([integration rule](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6681380403)):
- Every forge call stays a CLI call (`gh api`, `glab api`).
- A direct HTTP call is allowed only where no CLI covers it, with its token from the CLI or the keychain at call time.
- The seam moves into the TypeScript package when it is ported.
- The gate is unchanged: a human's `/approved`, stale after a human body edit. `approve.sh` posts it with the human's
  own login ([gap 1](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6681534148)).
- The writer gets no `gh` or App path (ADR-0012 S6). The "a writer's session … can act only as the App" cell is the
  current script behaviour, which ADR-0012 replaces.

## Ported 2026-11-07

The seam is in the TypeScript package (`src/core/forge/`, #102), and `poll` is `agent-factory poll`. It no longer
decides `approved`: an approval is local (ADR-0012 S1), so the `/approved` gate above and the body edits are gone. It
tells the factory's notes from people's by login and seat prefix (ADR-0012 S14, #128). `scripts/lib/forge.sh` stays
only until its last bash caller is ported (#138).
