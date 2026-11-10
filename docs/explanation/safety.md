# Safety

How the factory keeps an unattended AI run from doing harm, what is still open, and what is decided next. The design
is [ADR-0012](../adr/0012-safety-design-for-unattended-runs.md). **Enforced** means code stops it today; **Today:**
marks a place where the code still differs from the design.

## The threat model

An AI run that holds all three of these legs at once can be turned against you by text it reads:

```text
  untrusted input            private data                 a way out
  the code, its deps,        the repo, the model          any host the run can reach
  the ticket, a PR comment   token, files on disk         that accepts uploads
          │                        │                              │
          └────────────── an injected prompt joins them ──────────┘
```

| run | untrusted input | private data | a way out | so |
|---|---|---|---|---|
| implementer, cleanup, test-first | yes | the repo | the model API and the package registries | holds all three: the runner and the egress list narrow the way out, they do not close it (see [What is open](#what-is-open)) |
| automated review, design review, onboarder | yes | the repo | the model API only | read-only tools; **Today:** they run on the host, not on a runner (#113) |
| coordinator | the ticket and the chat | your laptop | your own network | a human is in the loop; on a laptop its deny list is not a wall (accepted risk) |
| orchestrator, host push | data only | the git host login | the git host | code with no model: text it reads never changes what it does |

Two rules follow from this, decided on 2026-11-10:

- **No unattended run holds all three legs** in a way nothing narrows. Where one does today, this page says so.
- **Prose is not a guardrail.** A rule only in a prompt or a role card is advice. A rule that matters is enforced in
  code, or it is marked **Today:** here.

## The layers

```text
 human gates      START · approve (hash-bound) · merge             only a human; denied to the coordinator
 orchestrator     fixed decision table, caps, stops                code, no model
 runner           srt (laptop) · Sysbox container (VM)             no git host login, private HOME, egress allow-list
 host push        CI files · agent settings · .factory · fast-forward only     refuses, never asks
 checks           ready check re-runs evidence · test checks S1–S4 · automated review · gate
 posting          every note through one template                  agent text cannot ping, link, close or run a command
```

| layer | stops | state | where |
|---|---|---|---|
| no git host login in a run | a run pushing, merging or posting by itself | Enforced (#113) | `src/core/push.ts` |
| runner, srt | reading your home; writing outside the clone; a direct connection | Enforced: whole home hidden, only the clone, a private HOME and the tool folders allowed back (#362, #371) | `src/core/box/srt-plan.ts` |
| runner, vm | the same, in a container under Sysbox; `--internal` network, one Squid proxy per project | Enforced (#113, #130) | `src/core/box/`, `src/core/egress/` |
| egress allow-list | reaching any host not on the list; the git host always refused | Enforced by host name only | `src/core/egress/allowlist.ts` |
| host push guards | a run changing CI, its own settings or `.factory` | Enforced (#115, #110) | `src/core/ci-files.ts`, `src/core/agent-settings.ts` |
| hostGit | a repo's own git config running a planted program on the host | Enforced (#87) | `src/core/git.ts` |
| coordinator deny list | the AI running `approve`, `start`, `waive`, `eval`, `onboard`, `plugin`, `init`, `gh`, `git push` | Enforced as rules; **Today:** not a wall on a laptop | `src/core/coordinator.ts:50-100` |
| posting template | agent text that pings, links, closes or quick-acts | Enforced (#126, #335) | `src/core/post.ts`, `src/core/pr-body.ts` |

## What is open

| gap | why it matters | decided | state |
|---|---|---|---|
| **An allowed host can still receive data.** The proxy sees only the host name; TLS is never opened (`src/core/egress/squid.ts:3-5`). A prompt-injected run can upload files to the model API with an attacker's own key (Rehberger 2025). Claude Code and Copilot have the same gap. | the "way out" leg stays open | accept and say so for the pilot; route registries through a read-only mirror before aruvii; spike a split network (the agent CLI reaches the model API, its tools reach only the mirror) | not built |
| **The coordinator on a laptop** runs as you, so its deny list matches commands as typed and is no wall. | a forged approval needs only one missed rule | add the coordinator's OS sandbox: no writes to approvals, starts, settings or the project home, and `allowUnsandboxedCommands: false`; before colleagues, a typed confirm for `approve` and `start` | not built |
| **Read-only runs on the host.** The automated review, the design review and the onboarder run with Read, Grep and Glob, outside a runner. | a bug in the tool limits is not contained | run them on a runner (#113) | not built |
| **Copilot at work** with no API key. | the runner needs a model-only token; Copilot's hosts may include `github.com`, which the egress list refuses | spike first (#162): a Copilot-only PAT, its hosts, whether it loads the plugin; then protect `.github/skills`, `.github/copilot-instructions.md` and `.github/instructions/` like `.claude/` | blocked on #162 |

## Every guardrail

- **Enforced: runs execute on a runner.** No git host token, network only to the model API and registries; the host
  pushes and posts ([Q1](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6680836108)). Every
  implementer run does so (#113).
- **Enforced: skip-all permissions only inside a runner** (`vm` or `srt`), never bare on the host; config never from
  the branch ([Q6, Q7](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6681210370), #114). The
  implementer's `.factory/settings.json` also holds its lists: allow Bash (inside the runner) and edits in the clone;
  deny `git push`, `WebFetch`, `curl` and reads of the credential paths. Claude Code keeps deny rules even with
  skip-all; the runner is the wall, the lists are the second line.
- **Enforced: zero findings is never green.** Only a human undrafts. Every PR gets a script-made status list of
  protected files and new dependencies ([Q5b](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6681168344), #118).
- **Code goes to an implementer, always.** The coordinator never edits code. **Today:** a prompt rule; an edit outside
  the spec drafts asks you rather than being refused.
- **START, approval and merge are the human's.** An approval is `agent-factory approve`, which records the spec's and
  the design's full hashes; a note on the PR approves nothing, and the bot cannot merge the protected branch. In the
  coordinator's settings `approve` and `start` are denied, not asked, and the orchestrator refuses to start while those
  settings are looser (#227, #105). **Today:** on a laptop the AI runs as you, so the deny list is not a wall there;
  your merge review is the hard gate (accepted risk, #30).
- **Enforced: the implementer never pushes.** The host pushes its branch for it through the host push
  (`src/core/push.ts`), with `--force-with-lease` against the head it saw (#113, #138).
- **Enforced: ready is checked, not reported.** No review starts until code has run the change's evidence commands
  again at its head, on a fresh runner (ADR-0012 S5, #91), with no shell and only the read-only set (`grep`, `git`'s
  reads and the like, #444) or the programs the project file lists. A gate run given for several criteria, or a result
  that is prose rather than what the command printed, fails the check.
- **The automated review reads, and the script posts.** It runs in a throwaway folder (under
  `$FACTORY_HOME/review-runs/`) with the pack and a copy of the whole code at the head. Every `CLAUDE.md`, `AGENTS.md`,
  `.claude/` and `.agents/` is removed from that copy, so the PR cannot choose the rules it is judged by. It has Read,
  Grep and Glob only, and an environment with no git host token and no `FACTORY_*` setting. **Today:** it runs on the
  host, not on a runner (#113).
- **Rules come from the default branch** or a pinned plugin, never from the PR. A PR that edits a rule file is flagged
  for the human.
- **Protected files go to the human.** A review round that finds a change to CI config, `CODEOWNERS` or agent
  instruction files lists them in its summary and labels the PR `needs-human`, once per file (ADR-0012 S10, #117).
- **No progress stops the loop.** When an implementer round leaves the change empty, or the patch unchanged while its
  last verdict still has Act on findings, `agent-factory review` reuses the verdict and labels the PR `needs-human`.
- **Enforced: an agent never changes CI.** The host push refuses CI-file changes
  ([review 8](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6682922264), #115).
- **Enforced: the implementer loads no settings from the branch, and never changes them** (#110). Its `claude -p` runs
  with `--setting-sources user`, so the branch's `.claude/settings.json`, `.mcp.json`, `CLAUDE.md` and skills are not
  loaded; the plugins (`--plugin-dir`) and the host's `.factory/settings.json` are. The root `.claude/`, `.agents/`,
  `AGENTS.md` and `CLAUDE.md` are read-only on the runner, and the host push refuses a commit that adds or changes one
  (`src/core/agent-settings.ts`). A version equal to the default branch's passes, so a merge of main is fine.
- **Enforced: host git runs no planted program.** Every git call on a project's clone goes through `hostGit`
  (`src/core/git.ts`): hooks, `core.fsmonitor`, filter and diff drivers, `sshCommand` and credential helpers come from
  your own config only. A repo whose own config sets an external diff, a merge driver, a URL rewrite or an `http.*`
  setting is refused (#87, [review 5](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6682642355)).
  Inside `srt`, `.git/hooks` and `.git/config` are read-only too; **Today:** not checked on the vm runner.
- **Enforced: the implementer reads only what it is given.** A private home per run; on srt your whole home is hidden
  but the folders allowed back ([review 6](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6682837531)).
- **Enforced: posted agent text cannot act.** The host posts only templated text: no line starts with `/`; `@`, `#`,
  `!`, `://` and `www.` are broken with an invisible joiner; Markdown and Jira markup characters are escaped
  (`src/core/post.ts`, #126). The PR body's `.factory/pr.md` goes through its own cleaner (`src/core/pr-body.ts`,
  #335): no raw HTML, no mention, no closing keyword, no link off the project's git host, capped length.
- **The coordinator cannot widen its own wall.** It edits only spec drafts with no prompt, and never its settings, any
  `.claude/` or the factory ([review 7](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6682899888), #106).
- **Where state lives.** **Today:** before the PR opens, a ticket's START, spec, approval and run records are only on
  the machine that ran START, in `$FACTORY_HOME`; after it opens, the branch, the PR and a copy of the approval are on
  the git host. Copying the approved spec to the ticket at approval is decided, not built.
