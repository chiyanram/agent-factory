# 0019 · Where a ticket's state lives before its PR opens

Status: accepted 2026-11-10 (operator, design audit). Partly built: the issue holds the spec on a personal project
(#381). Refines [ADR-0002](0002-mr-is-the-record-gitlab-is-memory.md).

## Context

Rule P3 says "the ticket tracker and the git host are the memory; a restart loses nothing". Before the PR opens that
is false: START, the approval and the run records, and at work the spec too, live only in the START machine's
`$FACTORY_HOME`. A lost or switched laptop loses them. The 12-factor agent principles (factor 5) ask for one store of
state. At work, nothing may be committed to the product repo (P9).

## Decision

1. Reword P3 to the truth: before the PR, the memory is the git host and tracker plus the START machine's
   `$FACTORY_HOME`, and a ticket's build runs on the machine that holds its records.
2. Before a project is shared with a second person, the bot copies the approved spec, the design and both hashes to
   the ticket at approval: the issue on a personal project, Jira at work. Another machine can continue from there.
3. The approval record itself stays local; the copy is for continuity, and it starts nothing.

## Considered

| option | why not |
|---|---|
| keep P3 as written | it claims a property the code does not have |
| commit the spec to the product repo | P9 forbids it at work |
| a shared state service | one more system to run and secure, for one or two users |

## Consequences

- The docs stop promising that a restart loses nothing.
- The issue spec store (#381) covers the spec on a personal project; the copy at approval covers work.
