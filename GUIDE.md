# Guide

How to set up the factory's bot, configure the scripts and run the loop. The coordinator session follows
[Run the loop](#run-the-loop) as its instructions. Words in **bold** are in [Terms](#terms).

> **Target and today.** [ADR-0012](docs/adr/0012-safety-design-for-unattended-runs.md) (map #30, 2026-11-06) is the
> decided design. The bash scripts do not follow it yet. Each place where they still differ is marked **Today:**.

## Set up the bot

The scripts that write to the forge refuse a human login. The target is **one bot per project, used only by code**:
the dispatcher and the host push ([ADR-0012](docs/adr/0012-safety-design-for-unattended-runs.md) S14,
[gap 1](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6681534148)). No LLM holds its login. The bot pushes branches, opens merge requests and comments. It cannot
merge the protected branch. The human's own account approves and merges.

```
dispatcher + host push ──▶ bot (agent-<project>, or <slug>[bot]) ──▶ pushes branches, opens MRs, comments; cannot merge
human ──▶ own account  ──▶ /approved (typed on the MR, or by approve.sh in the terminal) and merge
```

**Today:** each developer sets up one bot ([ADR-0006](docs/adr/0006-identity-service-account-per-developer.md)), and
the coordinator and the writer both act as it. The steps below still name the account `agent-<name>`.

### GitLab

| # | who | step | why |
|---|---|---|---|
| 1 | group owner | Create the service account `agent-<name>` (Group → Settings → Service accounts). | Free since GitLab 18.11, up to 100 per top-level group, no seat. |
| 2 | group owner | Add it to the project as **Developer**. | It can push branches, open MRs and comment. |
| 3 | group owner | Protect `master`: merge = Maintainers, push = no one. | An agent cannot merge into `master`. |
| 4 | developer | Create a token for the account: scopes `api` and `write_repository`, expiry 365 days. Store it in glab's config with `glab auth login`. Never put it in an environment variable. | Agents never handle tokens. An environment variable leaks to every child process. |
| 5 | developer | Set the git author for agent commits to `agent-<name>`. Every agent commit carries `Co-authored-by: <developer>`. | The human and the agent are both on the record. |
| 6 | developer | Set a reminder two weeks before the token expires. | An expired token stops every agent of that developer. |

### GitHub

On GitHub the bot is a **GitHub App** that the developer's own account owns. It posts as `<slug>[bot]` and has no
login, email or password.

| # | who | step | why |
|---|---|---|---|
| 1 | developer | Create the App: Settings → Developer settings → GitHub Apps → New. Turn the webhook off. Repository permissions: Contents, Issues and Pull requests read and write; Checks, Commit statuses and Metadata read. Leave Workflows out. Install it on: only this account. | Without Workflows the bot cannot change CI. |
| 2 | developer | Note the App ID. Generate a private key, move the `.pem` to `~/.config/agent-factory/`, and run `chmod 600` on it. | The key mints a one-hour token on demand (`scripts/github-app.sh`). No token is stored in a file or an environment variable. |
| 3 | developer | Install the App on the project's repository only. | The scripts refuse an App that is not installed on `FACTORY_PROJECT`. |
| 4 | repo owner | Add a ruleset on `main`: restrict updates, require a pull request with one approval, block force pushes and deletion. Make the repository admin the only bypass actor, for pull requests only. | Only the owner can merge into `main`. A ruleset on a private repo of a personal account needs GitHub Pro. |
| 5 | developer | In `FACTORY_REPO`: clone over `https://github.com/`; set `git config factory.ghAppId <id>`, `factory.ghAppKey <pem path>` and `factory.project <owner/name>`; add an empty credential helper and then the App's: `git config --add credential.https://github.com.helper ""` and `git config --add credential.https://github.com.helper "!<agent-factory>/scripts/github-app.sh git-credential"`; set `user.name <slug>[bot]` and `user.email <bot-id>+<slug>[bot]@users.noreply.github.com` (`gh api "users/<slug>[bot]" --jq .id` gives the id). | `start-writer` refuses a clone without each of these. The empty helper stops a global helper from answering with the person's login. |
| 6 | developer | For the coordinator scripts, set `FACTORY_FORGE=github`, `FACTORY_GH_APP_ID`, `FACTORY_GH_APP_KEY` and `FACTORY_PROJECT`. | The scripts refuse any token that is not the App's. |

### Both forges

- Every agent post starts with its seat: `[coordinator]`, `[writer]` or `[reviewer]`.
- On agent branches, CI runs test jobs only, with no secrets, and a CI-file edit waits for a human
  ([Q5a](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6681168344)). GitLab: protect every CI variable and environment, and add `rules:` or a push rule on the
  CI paths. GitHub: keep Workflows out of the App (step 1) and put secrets in environments that need approval.
- Whoever started the work does not approve it. Write this rule down for the team; a forge on a free plan cannot
  enforce it.
- When a developer leaves, revoke the GitLab token and block the account, or delete the App's key or the App.
- Before the first run on a machine, open `claude` once in `FACTORY_REPO` and accept the trust prompt. Add
  `.claude/worktrees/`, `.claude/runs/` and `.claude/packs/` to the project's `.gitignore`.
- Give the writer its quick tools in `docs/agents/commands.md` on the default branch, one plain line each (a fence
  around them is fine): `lint-file: <command>` runs on each file the writer edits, with the file as its last word,
  and `test-touched: <command>` runs the tests it touched. Either may be left out. The file is read from the MR's
  target branch, never from the MR, because the lint runs as a hook with no permission prompt.

**Known gap (today).** Agents run as the developer's OS user, so they can read the token in glab's config or the
App's key. The Developer role and the App's permissions limit what a stolen credential can do. It is not a wall.
**Target:** the writer runs in a box with no forge token ([Q1b](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6680836108)). The coordinator is held back by
deny rules only, because it runs as the same OS user ([ADR-0012](docs/adr/0012-safety-design-for-unattended-runs.md) S2).

## Settings

The scripts read their settings from the environment.

| setting | meaning | default |
|---|---|---|
| `FACTORY_FORGE` | the forge adapter | `gitlab` (or `github`) |
| `FACTORY_PROJECT` | the GitLab project path, or the GitHub `owner/name` | — |
| `FACTORY_REPO` | a local clone of that project; worktrees, packs and run files go in its `.claude/` | — |
| `FACTORY_RULEBOOK` | the rulebook plugin folder that holds `skills/<domain>/references/` | — |
| `FACTORY_GLAB`, `FACTORY_GH`, `FACTORY_CLAUDE` | the `glab`, `gh` and `claude` binaries | `glab`, `scripts/bin/gh`, `claude` |
| `FACTORY_GH_APP_ID`, `FACTORY_GH_APP_KEY` | the GitHub App's ID and its private key file | git config `factory.ghAppId`, `factory.ghAppKey` |
| `FACTORY_CLAIM_LABEL` | the claim label | `agent::claimed` |
| `FACTORY_AGENT_PREFIX` | the start of every GitLab agent account's name | `agent-` |
| `FACTORY_MAX_RUNS` | live runs at once on this machine | `2` |
| `FACTORY_MAX_USD` | the most one `claude -p` run may spend, in US dollars: every reviewer run, and a writer in `print` mode (the CLI does not cap a background run) | no cap |
| `FACTORY_DRY_RUN` | `1` makes `poll`, `claim`, `release`, `status`, `ask`, `block` and `reconcile` print each forge write instead of making it, and end their line in "(dry run)"; reads still go to the forge; `start-writer` and `start-reviewer` refuse it | off |
| `FACTORY_RUN_MODE` | `print` runs the writer as a foreground `claude -p` | background |
| `FACTORY_BOX` | **planned** ([Q4](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6681022323)): `laptop` runs workers locked down on this machine, with a Docker exception for ITs; `vm` runs them in your own VM. The start refuses to run without a sandbox | `laptop` |
| `FACTORY_WRITER_MODEL` | the writer's model | Claude's default |
| `FACTORY_FIND_MODEL`, `FACTORY_RULE_MODEL`, `FACTORY_LOGIC_MODEL` | the reviewer's models | `sonnet`, `sonnet`, `opus` |
| `FACTORY_READY_COMMANDS` | the programs an evidence command may start in the ready check; they run the MR's own build files, with none of this machine's logins | `make ./gradlew ./mvnw` |
| `FACTORY_READY_ENV`, `FACTORY_READY_TIMEOUT` | the variables an evidence command keeps (it gets a fresh `HOME`, an empty `GH_CONFIG_DIR` and no git config besides), and the seconds it may run | `PATH LANG JAVA_HOME`, `1800` |
| `FACTORY_READY_CHECK` | `off` skips the ready check, for a project whose required CI job proves the build at the head | on |
| `FACTORY_REVIEW_FIND`, `FACTORY_REVIEW_VERIFY` | the reviewer's instructions | `prompts/review-find.md`, `prompts/review-verify.md` |
| `FACTORY_CURL` | the `curl` that mints the App's token | `curl` |
| `FACTORY_MAX_TRIES`, `FACTORY_SLEEP` | tries per request on a rate limit, and the wait command | `4`, `sleep` |

## Run the loop

**You own the conversation, never the code or the queue.** You are the **coordinator**: the one AI the human talks
to. Writers and reviewers are fresh **workers** that the **dispatcher** (code, no LLM) starts. Each does one job on one
story and goes away. The forge is your only memory. In the target you run only the read scripts and `approve.sh`;
the start scripts and raw `gh`, `glab` and `curl` are denied to you ([Q15](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6681316890)). **Today:** no dispatcher
exists yet, so you run the triggers below by hand.

- **The forge is the record.** Every answer, verdict and state lives on the story's issue or MR. What is only in
  this chat was never decided.
- **The MR is the contract.** It holds the intent in the human's words, the acceptance criteria and the design link,
  so a writer seldom needs to ask. When it must, it writes the question in `.factory/report.md` and exits, and the
  host posts it as `[writer] OPEN:` ([gap 3](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6681622159)). **Today:** its prompt tells it to push, post with
  `ask.sh` and stop; that is an instruction, not a guardrail the scripts enforce.
- **Every run is fresh.** Start a new worker for every job. Never resume one: a resumed worker drops instructions.

A developer without the fleet runs `/crq` in one session and takes these steps itself. A small fix costs less that way.

### Steps

1. **Intake.** Small and clear: open an issue. Foggy or big: open a map and its tickets. Ready: go to step 2.
2. **Grill.** Ask in small rounds, one decision each, with your recommendation first, worded so "yes" accepts it.
   Restate what is decided, the live state of each option, and one concrete example. Once the draft MR exists, post
   each ask as a `[coordinator] OPEN: …` note, so `poll` lists it until a human answers. A two-option ask accepts
   only "A" or "B"; any other reply gets one re-ask. Done when the human has answered every open question.
3. **Write the contract.** Open the draft MR with the intent, the acceptance criteria and the design link. Done when
   a stranger with no chat access could build the change from the MR alone.
4. **Design review.** Start a reviewer on the design. It returns ALIGNED, CONFLICT or OPEN per decision. Bring every
   OPEN to the human. Done when nothing is OPEN and the human approves: they type `/approved` on the MR, or tell you,
   and you run `approve.sh <mr>`. The harness asks them to confirm it, and the note posts with their own login
   ([W1](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6679395560)). Never post `/approved` any other way.
5. **Run the queue.** Follow the triggers below. Done when the MR is merged or carries `needs-human`.
6. **Retro.** After about one merge in ten, turn each lesson into a rule change, strongest fix first: architecture →
   types → lint → test → docs. Read `tokens.sh <mr>` for what each phase cost. In the pilot, compare it with one
   `/crq` session on a like change at the same budget; a phase that does not change outcomes is retired.

### Triggers

This table is the dispatcher's decision table ([Q15](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6681316890)). Until the dispatcher exists, run it by hand.
The order is fixed: writer done → ready check → reviewer → gate → human ([gap 2](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6681560750)).
Poll the forge about every 5 minutes. Limits: one run per MR, at most `FACTORY_MAX_RUNS` at once, and at most one
heavy run (a build, an IT suite or a deploy) per machine.

| when the forge shows | do |
|---|---|
| `/approved` from a human maintainer, with `asks=0` and `needs_human=no` | `claim`, `start-writer`, `status "writer started"`; for a bug, `start-writer --test-first` first |
| a bug's test-first run ended with a pushed `test:` commit and `asks=0` | `start-writer` for the fix |
| the writer's run ended with exit 0 and the host posted its report, with `asks=0` (**today:** the writer marks the MR ready) | `start-reviewer` at the head SHA; it runs the ready check first |
| an open Act on thread, or the gate is red, with `needs_human=no` | `start-writer` again; after 3 rounds, label `needs-human`; a flaky job gets a rerun, not a writer |
| `start-reviewer` exits 4: not ready | `start-writer` again; after 3 `[coordinator] not ready` notes, label `needs-human` |
| the gate is green and no Act on is open | assign a maintainer, `status "ready"`, ping the human; **never undraft**: only a human undrafts, and zero findings is not a pass ([Q5b](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6681168344)) |
| the MR is merged | retro (step 6, about one in ten); sweep the worktree |
| a run is silent too long, hits a cap, or fails | `block <mr> "<reason>" <log>`: `needs-human`, a `[coordinator] blocked:` note with the reason and log, and the claim released |
| you restart | `reconcile`: every claim without a live run goes back to the queue |
| a human posts `/stop`, or pushes to the branch | stand off that MR |
| a merge conflict | `start-writer` to rebase; if that fails, `needs-human` |
| a claimed MR with no live run shows `approved=stale` or `asks` above 0 (a `[coordinator] OPEN:` or a `[writer] OPEN:` note) | `release` it and take the next approved MR; `claim` it again when the human answers |
| the usage limit is near | pause every run |

Act only on notes from human accounts. Notes from agent accounts are output, not triggers.

### Scripts

You decide; the scripts act. Each takes one command and prints one line. On GitHub, read "pull request" for "MR"
and `#12` for `!12`.

| script | does |
|---|---|
| `poll.sh` | one line per open MR: head, draft, claimed, `approved=yes\|stale\|no`, pipeline, `needs_human`, `stop`, open asks; plus each merged MR that still carries the claim |
| `claim.sh <mr>` / `release.sh <mr>` | adds or removes the claim label; `claim` refuses an MR already claimed |
| `start-writer.sh [--test-first] <mr>` | starts a fresh writer in its own worktree at the MR head; refuses an MR with a live run, and a machine at its run limit; `--test-first` starts a run that commits only a bug's failing test and stops |
| `start-reviewer.sh <mr>` | first the ready check: runs each evidence command again at the head in a fresh worktree, with no shell, and exits 4 with one `[coordinator] not ready` note when one fails or the table is missing, once per head and description; then one review round: the pack, a find run, a verify run, then one summary note, with the tokens at this head by phase, and one thread per Act on or Consider; keeps each pass's answer and the writer transcripts under `.claude/runs/<mr>/<head>/`; reuses the last verdict when the patch-id is unchanged, or labels `needs-human` when that verdict still has Act on findings; labels `needs-human` when protected files changed; refuses a 4th round; exits 3 with `MOVED` when the head moved |
| `pack.sh <mr> [<previous-head>]` | builds the reviewer's context pack, with rules from the default branch; an unresolved rule pointer stops it |
| `status.sh <mr> <sha> "<line>"` | posts one `[coordinator]` note; refuses when the head is no longer `<sha>` |
| `ask.sh <mr> <sha> "<question>"` | **today** the writer's one way to reach the human: posts one `[writer] OPEN:` note; refuses when the head is no longer `<sha>`. The target: the writer writes the question to a file and the host posts it |
| `approve.sh <mr>` | **planned** (W1): posts `/approved` at the head with the human's own login; the coordinator may run it only through the harness `ask` prompt |
| `block.sh <mr> "<reason>" [<log>]` | labels `needs-human`, posts one `[coordinator] blocked: <reason> · log: <log>` note, then releases the claim; the label goes first |
| `lint-edit.sh '<command>'` | the writer's hook, not yours: lints each file an Edit or Write changed and shows the writer what failed |
| `tokens.sh <mr>` | the tokens one MR spent, by phase (writer, find, verify), from the records kept per head; reads no forge |
| `reconcile.sh` | removes each claim and run worktree with no live run, and each claim left on a merged MR |

`poll` keeps no state, so a restart re-reads everything. It counts `/approved` only from a human maintainer, as the
first line of a note, and only when it is newer than the last human edit of the description; an older one shows as
`approved=stale`. It counts an open ask as a `[coordinator] OPEN:` or `[writer] OPEN:` note with no human note after
it. A run is live while `claude agents --json` lists its session (`writer-<mr>` or `reviewer-<mr>`).

### Escalation

The human gets: every OPEN design question, every `[writer] OPEN:` question, `needs-human` after 3 rounds, a merge
conflict a writer could not rebase, a standing rule that contradicts what you see, and anything irreversible. You
keep the conversation and the open questions. The dispatcher keeps polling, claims, retries of flaky jobs, and
starting and restarting workers. **Today** you keep those too, until it exists.

## Guardrails

Read each line as a claim. **Enforced** means a script stops it today. **Decided** means
[ADR-0012](docs/adr/0012-safety-design-for-unattended-runs.md) chose it and a ticket under #30 builds it. Until then,
it is a prompt instruction at most.

- **Decided: workers run in a box.** No forge token, network only to the model API and registries; the host pushes
  and posts ([Q1](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6680836108)). **Today:** the writer runs unsandboxed, as you, with the bot's login.
- **Decided: no skip-permissions on the laptop**, an allow-list instead; config never from the branch
  ([Q6, Q7](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6681210370)).
- **Decided: zero findings is never green.** Only a human undrafts. Every PR gets a script-made box of protected files
  and new dependencies ([Q5b](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6681168344)).

- **Code goes to a writer, always.** The coordinator never edits code. (A prompt rule today; the target allow-list
  enforces it.)
- **Enforced: approval and merge are the human's.** `poll` counts `/approved` only from a human maintainer, and the
  bot cannot merge the protected branch.
- **Today: the writer pushes only its own branch**, with `--force-with-lease` after a rebase. On GitHub its session
  gets an empty `GH_CONFIG_DIR` and no system or global git config, so it cannot act as the person. This is a prompt
  rule plus a missing login, not a wall; the target removes the forge token from the writer.
- **Enforced: ready is checked, not reported.** No review starts until a script has run the MR's evidence commands
  again at its head, with no shell. **Today** that run uses the MR's own build files on the host, with open network;
  the target runs it in the box ([ADR-0012](docs/adr/0012-safety-design-for-unattended-runs.md) S5, #91).
- **The reviewer reads, and the script posts.** It runs in a throwaway folder with the pack and a copy of the whole
  code at the head. It may report code the diff does not touch only when this change breaks it.
  Every `CLAUDE.md`, `AGENTS.md`, `.claude/` and `.agents/` is removed from that copy, so the MR cannot choose the
  rules it is judged by. It has Read, Grep and Glob only. **Today** it runs unsandboxed; the target puts it in the
  box.
- **Rules come from the default branch**, never from the MR. An MR that edits a rule file is flagged for the human.
- **Protected files go to the human.** A review round that finds a change to CI config, `CODEOWNERS` or agent
  instruction files lists them in its summary and labels the MR `needs-human`, once per file. **Today** build files
  and new dependencies are left to the reviewer; the target adds both to the script-made box.
- **No progress stops the loop.** When a writer round leaves the change empty, or the patch unchanged while its last
  verdict still has Act on findings, `start-reviewer` reuses the verdict and labels the MR `needs-human`.
- **State goes to the forge**, never to a file only one session can read.

## Terms

| term | means |
|---|---|
| **Seat** | a job one party owns for one story: human, coordinator, writer, reviewer or gate |
| **Coordinator** | the one AI session that talks with the human, plans and approves through `approve.sh`; in the target it starts no workers |
| **Dispatcher** | code with no LLM that runs the trigger table from `poll` and holds the bot login (ADR-0012 S3); not built yet |
| **Box** | the sandbox a worker runs in: no forge token, network only to the model API and registries (ADR-0012) |
| **Worker** | a fresh, short-lived AI session that does one job on one story: a writer or a reviewer |
| **Writer** | the worker that owns the branch of one MR; it reaches the human only through a `[writer] OPEN:` note |
| **Reviewer** | the worker that gives a verdict only: a find pass, then a verify pass |
| **Gate** | the project's CI pipeline result at the MR head |
| **Run** | one start of a worker on one MR for one job |
| **Story** | one issue and its one MR; the MR is the record of the work |
| **Context pack** | the reviewer's input, built once per head, with rules from the default branch |
| **Finding** | one problem: rule ID · `file:line` · severity · fix |
| **Act on** · **Consider** · **Noted** · **Dismissed** | the four buckets of a verified finding: the writer fixes it · the human decides · a follow-up issue · dropped, with one line why |
| **Round** | one review of one head; after 3 rounds the human decides |
| **Patch-id** | the `git patch-id` of the diff; an unchanged patch-id after a rebase reuses the last verdict |
| **Rulebook** | the rules every worker loads: the project's `AGENTS.md` files and the `rulebook` plugin |
| **Bot** | the project's GitLab service account or GitHub App; in the target only code uses it (**today:** one per developer, used by every agent) |
