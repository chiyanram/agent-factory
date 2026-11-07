# Guide

How to set up the factory's identity, configure the scripts and run the loop. The coordinator session follows
[Run the loop](#run-the-loop) as its instructions. Words in **bold** are in [Terms](#terms).

> **Target and today.** [ADR-0012](docs/adr/0012-safety-design-for-unattended-runs.md) (map #30, 2026-11-06) is the
> decided design, as revised by its review on map #30 ([issues 1–11](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6682834172)). The bash scripts do not follow it
> yet. Each place where they still differ is marked **Today:**.

## Install a pinned version

```bash
npm i -g github:chiyanram/agent-factory#v0.1.0
```

Pick the version from the [releases](https://github.com/chiyanram/agent-factory/releases); `CHANGELOG.md` says what
each one changed. npm builds the package on install. Never install from `main`: it changes under you (#153).

## Set up identity

The factory pushes and posts with a forge login that **only code uses**: the dispatcher and the host push. No LLM holds
it ([ADR-0012](docs/adr/0012-safety-design-for-unattended-runs.md) S14, [review 2](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6682431737)). Which login is set per project:

```
work (default)  dispatcher + host push ──▶ your own gh / glab login ──▶ pushes branches, opens MRs, comments
personal (opt.) dispatcher + host push ──▶ a bot: GitHub App <slug>[bot] or GitLab service account
human           agent-factory approve (a local permission) · reviews · merges with your own account
```

Agent text is marked by content, not by author: every post starts with `[writer]`, `[reviewer]` or `[coordinator]`,
and agent commits carry an `Agent: <seat>` trailer. **Today:** no script writes the trailer yet; `src/core/notes.ts`
reads it, and the writer's report (#109) will add it. With your own login (`FACTORY_IDENTITY=own`, the default) there
is nothing more to set up; the steps below are for a project that uses a bot. A bot's key belongs to a separate
`factory` OS user on the VM, never to a file your own user can read.

**Today:** the bash scripts (`claim`, `release`, `status`, `ask`, `block`, `reconcile`, `start-writer`,
`start-reviewer`) still act only as a bot ([ADR-0006](docs/adr/0006-identity-service-account-per-developer.md)): on
GitHub through `scripts/github-app.sh`, which reads the App's key from your own home (`FACTORY_GH_APP_ID`,
`FACTORY_GH_APP_KEY`). `agent-factory` (`poll`, the host push) follows the steps below. Each script moves over when it
is ported (#103, #138).

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
login, email or password. Its private key belongs to the `factory` OS user. Your user gets a one-hour token through one
sudo rule, and never reads the key ([#108](https://github.com/chiyanram/agent-factory/issues/108)).

```
dispatcher, poll, host push (your user)
  └─ sudo -n -u factory -- /usr/local/bin/agent-factory-app-token <owner/name>
       └─ factory user: reads ~factory/.config/agent-factory/github-app.json and the .pem (mode 600)
          signs a JWT, mints a token scoped to that one repository, caches it mode 600
  ◀─ {"token", "login": "<slug>[bot]", "expiresAt"}: held in that process's memory; given to each of its gh calls
     (GH_TOKEN) and git pushes (a credential helper for https://github.com only, every other helper dropped)
```

| # | who | step | why |
|---|---|---|---|
| 1 | developer | Create the App: Settings → Developer settings → GitHub Apps → New. Turn the webhook off. Repository permissions: Contents, Issues and Pull requests read and write; Checks, Commit statuses and Metadata read. Leave Workflows out. Install it on: only this account. Note the App ID and generate a private key. | Without Workflows the bot cannot change CI. |
| 2 | developer | Install the App on the project's repository only. | A token is minted for that one repository; `app-token` fails on any other. |
| 3 | developer | Add a ruleset on `main`: restrict updates, require a pull request with one approval, block force pushes and deletion. Make the repository admin the only bypass actor, for pull requests only. | Only the owner can merge into `main`. A ruleset on a private repo of a personal account needs GitHub Pro. |
| 4 | developer, on the VM | Create the user and hand it the key: `sudo useradd --system --create-home --shell /usr/sbin/nologin factory`; `sudo install -d -m 700 -o factory -g factory ~factory/.config ~factory/.config/agent-factory`; `sudo install -m 600 -o factory -g factory <key>.pem ~factory/.config/agent-factory/app.pem`; then delete the `.pem` from your own folders. | Your user, and anything it runs, can never read the key. |
| 5 | developer, on the VM | Write `~factory/.config/agent-factory/github-app.json`, mode 600, owned by `factory`: `{"appId": "<id>", "key": "/home/factory/.config/agent-factory/app.pem"}` (use the real home of `factory`). | `app-token` refuses a file of another user's, or one others can read. |
| 6 | developer, on the VM | Install a root-owned copy: `sudo git clone https://github.com/chiyanram/agent-factory /opt/agent-factory`, then `cd /opt/agent-factory && sudo npm ci && sudo npm run build`. Write the wrapper `/usr/local/bin/agent-factory-app-token`, owned by root, mode 755, with two lines: `#!/bin/sh` and `exec /usr/bin/node /opt/agent-factory/dist/cli.js app-token "$1"` (use `command -v node` for the real path). | The package is not on npm. Root owns every file the rule reaches, and the absolute `node` path means your PATH never chooses the program that reads the key. |
| 7 | developer, on the VM | Add the rule with `sudo visudo -f /etc/sudoers.d/agent-factory`, one line per project: `<you> ALL=(factory) NOPASSWD: /usr/local/bin/agent-factory-app-token <owner/name>`. Check it with `sudo -n -u factory -- /usr/local/bin/agent-factory-app-token <owner/name> \| jq .login`, which prints `"<slug>[bot]"`. | sudo matches the whole command line, so the rule allows that one command for that one repository. Never print the token itself. |
| 8 | developer | Set `FACTORY_FORGE=github`, `FACTORY_PROJECT=<owner/name>` and `FACTORY_IDENTITY=app`. Clone `FACTORY_REPO` over `https://github.com/`, with no credential helper in the clone's own config, and with no global `url.*.insteadOf` that rewrites `https://github.com/`. | The host push checks the one URL git will really push to: for an App it must be `https://github.com/<owner/name>`, and a clone that sets its own helper is refused, since git would fall back to your login. |

**Today:** any process of your user can run the same sudo line and get a token, the coordinator's Bash tool included.
The coordinator's deny list ([#106](https://github.com/chiyanram/agent-factory/issues/106)) must deny `sudo`; until it
does, do not leave a coordinator session running unattended on a project with `FACTORY_IDENTITY=app`. The key itself
stays out of reach either way.


### Both forges

- Every agent post starts with its seat: `[coordinator]`, `[writer]` or `[reviewer]`.
- On agent branches, CI runs test jobs only, with no secrets. An agent never changes CI: the host push refuses
  commits that touch `.gitlab-ci.yml` (and the files it includes), `.github/workflows/**` or `.github/actions/**`, and
  you make such a change in your own commit ([review 8](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6682922264)). Backstop: GitLab, protect every secret variable;
  GitHub, keep secrets in environments that need approval and keep Workflows out of a bot App (step 1). `rules:` in
  `.gitlab-ci.yml` is not a gate: the branch's own copy runs. **Today:** nothing refuses the push.
- Work laptop (`FACTORY_BOX=laptop`): in Rancher Desktop, share no home folder with its VM. The writer's box is a
  container there, with its own Docker inside ([review 1](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6682834172)).
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
| `FACTORY_GLAB`, `FACTORY_GH`, `FACTORY_CLAUDE` | the `glab`, `gh` and `claude` binaries | `glab`, `gh`, `claude`. **Today:** the bash scripts default `FACTORY_GH` to `scripts/bin/gh`, the App |
| `FACTORY_IDENTITY` | who `agent-factory` acts as on the forge: `own`, your `gh` or `glab` login, or `app`, a GitHub App whose key the `factory` user holds ([Set up identity](#github)) | `own` |
| `FACTORY_APP_USER`, `FACTORY_APP_COMMAND` | with `app`: the OS user that holds the key, and the root-owned wrapper its sudo rule names | `factory`, `/usr/local/bin/agent-factory-app-token` |
| `FACTORY_FORGE_HOST` | the forge's host; the host push sends a branch only to a URL on it | `github.com` or `gitlab.com` |
| `FACTORY_GH_APP_ID`, `FACTORY_GH_APP_KEY` | **Today:** the bash scripts only: the GitHub App's ID and its private key file in your own home; `agent-factory` reads neither | git config `factory.ghAppId`, `factory.ghAppKey` |
| `FACTORY_CLAIM_LABEL` | the claim label | `agent::claimed` |
| `FACTORY_MAX_RUNS` | live runs at once on this machine | `2` |
| `FACTORY_MAX_USD` | the most one `claude -p` run may spend, in US dollars: every reviewer run, and a writer in `print` mode (the CLI does not cap a background run) | no cap |
| `FACTORY_DRY_RUN` | `1` makes `claim`, `release`, `status`, `ask`, `block` and `reconcile` print each forge write instead of making it, and end their line in "(dry run)"; reads still go to the forge; `start-writer` and `start-reviewer` refuse it | off |
| `FACTORY_RUN_MODE` | `print` runs the writer as a foreground `claude -p` | background |
| `FACTORY_BOX` | **planned** ([review 1](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6682834172)): `vm` runs workers in your own VM, with its Docker; `laptop` runs each in a container on Rancher Desktop with its own Docker inside, a private home and filtered egress. The start refuses to run without a box | `laptop` |
| budget settings | **planned** ([review 11](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6683060877)): the factory's share of your budget (Copilot limit at work, Claude subscription at home), the stop line, runs at once, per-run caps, the model per phase and run hours, per project and machine | set after the pilot |
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
story and goes away. The forge is your only memory. In the target you run only the read commands, `status.sh`,
questions and status to Jira or the issue, and `agent-factory approve`; you edit and write only spec drafts in
`~/.factory/specs/`, and never your own settings ([review 3](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6682553870), [review 7](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6682899888)). The start commands and raw
`gh`, `glab`, `git push` and `curl` are denied to you ([Q15](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6681316890)). **Today:** no dispatcher
exists yet, so you run the triggers below by hand.

- **The forge is the record.** Every answer, verdict and state lives on the story's issue or MR. What is only in
  this chat was never decided.
- **The spec is the contract.** It holds the intent in the human's words, the acceptance criteria and the design
  link, so a writer seldom needs to ask. Where it lives is set per project ([review 3](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6682553870)): work, a local file
  `~/.factory/specs/<project>/<TICKET>/spec.md` with Jira for questions and status; personal, the issue. The PR body
  carries the approved spec and its hash.
- **A run ends with a report** ([gap 3](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6681622159), #109, `src/core/report.ts`). The writer writes `.factory/report.json` (never committed)
  and exits: `status` `done` with `evidence` rows (criterion, command, result), `asked` with one to five `questions`,
  or `blocked` with a `blocker`. The host checks it, then acts (`src/core/finish.ts`):
  `done` → push, post the evidence, run the ready check; `asked` → push, post the questions in one `[writer] OPEN:`
  note, wait; `blocked` → label `needs-human` first, push the work in progress only on top of the branch, post
  `blocked: <reason>` (in the writer's seat when the writer said it). A missing, unreadable or malformed report, any
  other field, a non-zero exit, a timeout, a cap or a failed box is `blocked` with the reason; a reason never quotes
  the report. The host reads the report only after the box has stopped, never through a symlink, and refuses to push
  when any new commit touches `.factory` (`excludeFactory` keeps it out of `git add`).
  **Today:** the bash `start-writer` still tells the writer to push, post with `ask.sh` and mark the MR ready; the
  report replaces that once the writer starts through the box and the dispatcher (#103, #138).
- **Every run is fresh.** Start a new worker for every job. Never resume one: a resumed worker drops instructions.

A developer without the fleet runs `/crq` in one session and takes these steps itself. A small fix costs less that way.

### Steps

1. **Intake.** Small and clear: open an issue. Foggy or big: open a map and its tickets. Ready: go to step 2.
2. **Grill.** Ask in small rounds, one decision each, with your recommendation first, worded so "yes" accepts it.
   Restate what is decided, the live state of each option, and one concrete example. Once the draft MR exists, post
   each ask as a `[coordinator] OPEN: …` note, so `poll` lists it until a human answers. A two-option ask accepts
   only "A" or "B"; any other reply gets one re-ask. Done when the human has answered every open question.
3. **Write the contract.** Write the spec where the project keeps it: the local spec file at work, the issue on a
   personal project. **Today:** open the draft MR with it. Done when a stranger with no chat access could build the
   change from the spec alone.
4. **Design review.** Start a reviewer on the design. It returns ALIGNED, CONFLICT or OPEN per decision. Bring every
   OPEN to the human. Done when nothing is OPEN and the human approves: run `agent-factory spec <project> <ticket>`,
   show them the hash, and when they say yes run `agent-factory approve <project> <ticket> <hash>`. The harness shows
   them the ticket and the hash, and only they can confirm. It records a local approval; an edit of the spec makes it
   stale, and `agent-factory approval <project> <ticket>` then says so ([review 3](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6682553870)). A `/approved` note on the MR
   counts for nothing. **Today:** the harness `ask` rule that keeps `approve` the human's own is not set up yet (#106).
5. **Run the queue.** Follow the triggers below. Done when the MR is merged or carries `needs-human`.
6. **Retro.** After about one merge in ten, turn each lesson into a rule change, strongest fix first: architecture →
   types → lint → test → docs. Read `tokens.sh <mr>` for what each phase cost. In the pilot, compare it with one
   `/crq` session on a like change at the same budget; a phase that does not change outcomes is retired.

### Triggers

This table is today's hand-run version of the dispatcher's decision table. The target table, with a stop on every
row, is ADR-0012 S3 ([review 9](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6682943767)). Until the dispatcher exists, run this one by hand.
The order is fixed: writer done → ready check → reviewer → gate → human ([gap 2](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6681560750)).
Poll the forge about every 5 minutes. Limits: one run per MR, at most `FACTORY_MAX_RUNS` at once, and at most one
heavy run (a build, an IT suite or a deploy) per machine.

| when the forge shows | do |
|---|---|
| the MR's ticket is approved (`agent-factory approval <project> <ticket>` exits 0), with `asks=0`, `needs_human=no` and no `stop` newer than the approval | `claim`, `start-writer`, `status "writer started"`; for a bug, `start-writer --test-first` first |
| a bug's test-first run ended with a pushed `test:` commit and `asks=0` | `start-writer` for the fix |
| the writer's report is `done` and the host pushed and posted it (**today:** the bash writer marks the MR ready instead) | `start-reviewer` at the head SHA; it runs the ready check first |
| an open Act on thread, or the gate is red, with `needs_human=no` | `start-writer` again; after 3 rounds, label `needs-human`; a flaky job gets a rerun, not a writer |
| `start-reviewer` exits 4: not ready | `start-writer` again; after 3 `[coordinator] not ready` notes, label `needs-human` |
| the gate is green and no Act on is open | assign a maintainer, `status "ready"`, ping the human; **never undraft**: only a human undrafts, and zero findings is not a pass ([Q5b](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6681168344)) |
| the MR is merged | retro (step 6, about one in ten); sweep the worktree |
| a run is silent too long, hits a cap, or fails | `block <mr> "<reason>" <log>`: `needs-human`, a `[coordinator] blocked:` note with the reason and log, and the claim released |
| you restart | `reconcile`: every claim without a live run goes back to the queue |
| `poll` shows `stop=<time>` newer than the ticket's approval (a maintainer's `/stop`), or a human pushes to the branch | stand off that MR; approving again lifts the stop |
| a merge conflict | `start-writer` to rebase; if that fails, `needs-human` |
| a claimed MR with no live run has a stale approval (`agent-factory approval` exits 3) or `asks` above 0 (a `[coordinator] OPEN:` or a `[writer] OPEN:` note) | `release` it and take the next approved MR; `claim` it again when the human answers |
| the usage limit is near | pause every run |

Act only on people's notes. A note is the factory's own when it comes from the factory's login and starts with a
seat prefix; such notes are output, not triggers.

### Scripts

You decide; the scripts act. Each takes one command and prints one line. On GitHub, read "pull request" for "MR"
and `#12` for `!12`.

| script | does |
|---|---|
| `agent-factory poll` | one line per open MR: head, draft, claimed, pipeline, `needs_human`, `stop`, open asks; plus each merged MR that still carries the claim; `--json` prints the records |
| `claim.sh <mr>` / `release.sh <mr>` | adds or removes the claim label; `claim` refuses an MR already claimed |
| `start-writer.sh [--test-first] <mr>` | starts a fresh writer in its own worktree at the MR head; refuses an MR with a live run, and a machine at its run limit; `--test-first` starts a run that commits only a bug's failing test and stops |
| `start-reviewer.sh <mr>` | first the ready check: runs each evidence command again at the head in a fresh worktree, with no shell, and exits 4 with one `[coordinator] not ready` note when one fails or the table is missing, once per head and description; then one review round: the pack, a find run, a verify run, then one summary note, with the tokens at this head by phase, and one thread per Act on or Consider; keeps each pass's answer and the writer transcripts under `.claude/runs/<mr>/<head>/`; reuses the last verdict when the patch-id is unchanged, or labels `needs-human` when that verdict still has Act on findings; labels `needs-human` when protected files changed; refuses a 4th round; exits 3 with `MOVED` when the head moved |
| `pack.sh <mr> [<previous-head>]` | builds the reviewer's context pack, with rules from the default branch; an unresolved rule pointer stops it |
| `status.sh <mr> <sha> "<line>"` | posts one `[coordinator]` note; refuses when the head is no longer `<sha>` |
| `ask.sh <mr> <sha> "<question>"` | **today** the writer's one way to reach the human: posts one `[writer] OPEN:` note; refuses when the head is no longer `<sha>`. The target: the writer writes the question to a file and the host posts it |
| `agent-factory spec <project> <ticket>` | checks a ticket's local spec (`$FACTORY_HOME/specs/<project>/<ticket>/spec.md`, default `~/.factory`) against the template: prints its hash, or every missing part (intent, numbered acceptance criteria, design, lane); `--template <ticket>` prints an empty one. The hash ignores line endings and trailing spaces, and changes on any real edit ([review 3](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6682553870), #127) |
| `agent-factory approve <project> <ticket> <hash>` | records the human's approval in `$FACTORY_HOME/approvals/<project>/<ticket>.json`: the spec's full hash, who and when. The hash on the command line is the full hash the human saw, as `agent-factory spec` printed it; a spec that no longer has exactly that hash is refused. Run it only through the harness `ask` prompt, never from an allow list ([review 3](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6682553870), #104) |
| `agent-factory approval <project> <ticket>` | whether work may start: `approved` (exit 0), `stale` when the spec changed after approval (3), `missing` (4), or a broken record or spec (1). **Today:** the dispatcher that reads it is not built (#103) |
| `block.sh <mr> "<reason>" [<log>]` | labels `needs-human`, posts one `[coordinator] blocked: <reason> · log: <log>` note, then releases the claim; the label goes first |
| `lint-edit.sh '<command>'` | the writer's hook, not yours: lints each file an Edit or Write changed and shows the writer what failed |
| `tokens.sh <mr>` | the tokens one MR spent, by phase (writer, find, verify), from the records kept per head; reads no forge |
| `reconcile.sh` | removes each claim and run worktree with no live run, and each claim left on a merged MR |

`poll` keeps no state, so a restart re-reads everything. It reads the forge through its CLI (`gh api`, `glab api`),
pages every list to its end, and waits out a rate limit. It does not read approvals: an approval is the local
`agent-factory approve`. A note is the factory's only when it comes from the factory's login **and** starts with a
seat prefix (`src/core/notes.ts`, #128); every other note is a person's. `asks` counts each `[coordinator] OPEN:` or
`[writer] OPEN:` note with no note after it from a project member: a GitLab Developer or more, or a GitHub
collaborator with write access. `stop` is the time of a maintainer's last note whose first line is exactly `/stop`
(a GitLab Maintainer or more, or a GitHub collaborator with write access), in UTC, or `undated` when its time does
not parse. A bot account is neither a member nor a maintainer, whatever its access, so a CI bot never answers an
ask or stops a change. `poll` reads the MR's conversation only: an answer or a `/stop` in a review comment or a review
body is not seen. `pipeline` is `success`, `failed`,
`running`, `canceled`, `skipped`, `manual`, `none`, or `unknown:<state>` for a state the forge sends that `poll` does
not know (#124); stand off an unknown one and tell the human. GitLab's own activity notes ("added ~label") are not
counted. A run is live while `claude agents --json` lists its session (`writer-<mr>` or `reviewer-<mr>`).

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
- **Approval and merge are the human's.** An approval is `agent-factory approve`, which records the spec's full hash;
  a note on the MR approves nothing, and the bot cannot merge the protected branch. **Today:** the harness `ask` rule
  that keeps `approve` from the coordinator is not set up yet (#106).
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
- **Decided: an agent never changes CI.** The host push refuses CI-file changes ([review 8](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6682922264)).
- **Enforced: host git runs no planted program.** Every git call the scripts make on a project's clone goes through
  `hgit` (`scripts/lib/git.sh`), and every one the TypeScript package makes through `hostGit` (`src/core/git.ts`): hooks, `core.fsmonitor`, filter and diff drivers, `sshCommand`, credential helpers
  and the rest come from your own system and global config only, never from the repo's. A repo whose own config
  sets an external diff, a merge driver, a URL rewrite or an `http.*` setting is refused (#87,
  [review 5](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6682642355)). **Decided:** the git
  control files are also read-only in the box (#110).
- **Decided: the writer reads only what it is given.** A private home per run; the coordinator gets a deny list on
  secret paths ([review 6](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6682837531)).
- **Decided: posted agent text cannot act.** The host posts only templated text: no line starts with `/`; `@`, `#`,
  `!`, `://` and `www.` are broken with an invisible joiner, so nothing pings, links, references or closes; Markdown
  and Jira markup characters are escaped. The template is built (`src/core/post.ts`, #126); the
  dispatcher (#103) and the writer's exit (#109) will post through it. **Today:** the bash scripts flatten model text
  but do not span mentions or keywords ([review 4](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6682589125)).
- **Decided: the coordinator cannot widen its own wall.** It edits only spec drafts, never its settings or the
  factory ([review 7](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6682899888)).
- **State goes to the forge**, never to a file only one session can read. The one exception is the local approval,
  which the PR body records once there is code.

## Terms

| term | means |
|---|---|
| **Seat** | a job one party owns for one story: human, coordinator, writer, reviewer or gate |
| **Coordinator** | the one AI session that talks with the human, plans and approves through `agent-factory approve`; in the target it starts no workers |
| **Dispatcher** | code with no LLM that runs the decision table (ADR-0012 S3) and holds the project's forge login: yours or a bot; not built yet |
| **Box** | where a worker runs: your VM, or a container on Rancher Desktop; no forge token, a private home, network only to the model API and registries (ADR-0012 S8) |
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
