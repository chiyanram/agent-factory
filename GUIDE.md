# Guide

How to set up the factory's bot, configure the scripts and run the loop. The coordinator session follows
[Run the loop](#run-the-loop) as its instructions. Words in **bold** are in [Terms](#terms).

## Set up the bot

The scripts that write to the forge refuse a human login. Each developer sets up one bot once
([ADR-0006](docs/adr/0006-identity-service-account-per-developer.md)). The bot pushes branches, opens merge requests
and comments. It cannot merge the protected branch. The developer's own account posts `/approved` and merges.

```
developer ──▶ bot (agent-<name>, or <slug>[bot]) ──▶ pushes branches, opens MRs, comments; cannot merge
developer ──▶ own account                         ──▶ /approved and merge only
```

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
- Whoever started the work does not approve it. Write this rule down for the team; a forge on a free plan cannot
  enforce it.
- When a developer leaves, revoke the GitLab token and block the account, or delete the App's key or the App.
- Before the first run on a machine, open `claude` once in `FACTORY_REPO` and accept the trust prompt. Add
  `.claude/worktrees/`, `.claude/runs/` and `.claude/packs/` to the project's `.gitignore`.

**Known gap.** Agents run as the developer's OS user, so they can read the token in glab's config or the App's key.
The Developer role and the App's permissions limit what a stolen credential can do. It is not a wall.

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
| `FACTORY_RUN_MODE` | `print` runs the writer as a foreground `claude -p` | background |
| `FACTORY_WRITER_MODEL` | the writer's model | Claude's default |
| `FACTORY_FIND_MODEL`, `FACTORY_RULE_MODEL`, `FACTORY_LOGIC_MODEL` | the reviewer's models | `sonnet`, `sonnet`, `opus` |
| `FACTORY_REVIEW_FIND`, `FACTORY_REVIEW_VERIFY` | the reviewer's instructions | `prompts/review-find.md`, `prompts/review-verify.md` |
| `FACTORY_CURL` | the `curl` that mints the App's token | `curl` |
| `FACTORY_MAX_TRIES`, `FACTORY_SLEEP` | tries per request on a rate limit, and the wait command | `4`, `sleep` |

## Run the loop

**You own the conversation and the queue, never the code.** You are the **coordinator**: the one AI the human talks
to. Writers and reviewers are fresh **workers** you start. Each does one job on one story and goes away. The forge
is your only memory.

- **The forge is the record.** Every answer, verdict and state lives on the story's issue or MR. What is only in
  this chat was never decided.
- **The MR is the contract.** A worker cannot ask you a question, so the MR holds the intent in the human's words,
  the acceptance criteria and the design link.
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
   OPEN to the human. Done when nothing is OPEN and the human posts `/approved`.
5. **Run the queue.** Follow the triggers below. Done when the MR is merged or carries `needs-human`.
6. **Retro.** After about one merge in ten, turn each lesson into a rule change, strongest fix first: architecture →
   types → lint → test → docs.

### Triggers

Poll the forge about every 5 minutes. Limits: one run per MR, at most `FACTORY_MAX_RUNS` at once, and at most one
heavy run (a build, an IT suite or a deploy) per machine.

| when the forge shows | do |
|---|---|
| `/approved` from a human maintainer, with `asks=0` and `needs_human=no` | `claim`, `start-writer`, `status "writer started"` |
| the writer marks the MR ready | `start-reviewer` at the head SHA |
| an open Act on thread, or the gate is red | `start-writer` again; after 3 rounds, label `needs-human`; a flaky job gets a rerun, not a writer |
| the gate is green and no Act on is open | undraft, assign a maintainer, `status "ready"` |
| the MR is merged | retro (step 6, about one in ten); sweep the worktree |
| a run is silent too long, or hits its time cap | mark it interrupted, `release` the claim |
| you restart | `reconcile`: every claim without a live run goes back to the queue |
| a human posts `/stop`, or pushes to the branch | stand off that MR |
| a merge conflict | `start-writer` to rebase; if that fails, `needs-human` |
| a claimed MR with no live run shows `approved=stale` or `asks` above 0 | `release` it and take the next approved MR; `claim` it again when the human answers |
| the usage limit is near | pause every run |

Act only on notes from human accounts. Notes from agent accounts are output, not triggers.

### Scripts

You decide; the scripts act. Each takes one command and prints one line. On GitHub, read "pull request" for "MR"
and `#12` for `!12`.

| script | does |
|---|---|
| `poll.sh` | one line per open MR: head, draft, claimed, `approved=yes\|stale\|no`, pipeline, `needs_human`, `stop`, open asks; plus each merged MR that still carries the claim |
| `claim.sh <mr>` / `release.sh <mr>` | adds or removes the claim label; `claim` refuses an MR already claimed |
| `start-writer.sh <mr>` | starts a fresh writer in its own worktree at the MR head; refuses an MR with a live run, and a machine at its run limit |
| `start-reviewer.sh <mr>` | one review round: the pack, a find run, a verify run, then one summary note and one thread per Act on or Consider; reuses the last verdict when the patch-id is unchanged, or labels `needs-human` when that verdict still has Act on findings; labels `needs-human` when protected files changed; refuses a 4th round; exits 3 with `MOVED` when the head moved |
| `pack.sh <mr> [<previous-head>]` | builds the reviewer's context pack, with rules from the default branch; an unresolved rule pointer stops it |
| `status.sh <mr> <sha> "<line>"` | posts one `[coordinator]` note; refuses when the head is no longer `<sha>` |
| `reconcile.sh` | removes each claim and run worktree with no live run, and each claim left on a merged MR |

`poll` keeps no state, so a restart re-reads everything. It counts `/approved` only from a human maintainer, as the
first line of a note, and only when it is newer than the last human edit of the description; an older one shows as
`approved=stale`. It counts an open ask as a `[coordinator] OPEN:` note with no human note after it. A run is live
while `claude agents --json` lists its session (`writer-<mr>` or `reviewer-<mr>`).

### Escalation

The human gets: every OPEN design question, `needs-human` after 3 rounds, a merge conflict a writer could not rebase,
a standing rule that contradicts what you see, and anything irreversible. You keep: polling, claims, retries of flaky
jobs, and starting and restarting workers.

## Guardrails

The scripts enforce these; prompts alone do not.

- **Code goes to a writer, always.** The coordinator never edits code.
- **Approval and merge are the human's, always.** The bot cannot merge the protected branch.
- **The writer pushes only its own branch**, with `--force-with-lease` after a rebase. It never talks to the human.
  On GitHub its session gets an empty `GH_CONFIG_DIR` and no system or global git config, so it cannot act as the
  person.
- **The reviewer reads, and the script posts.** It runs in a throwaway folder with the pack and a copy of the code.
  Every `CLAUDE.md`, `AGENTS.md`, `.claude/` and `.agents/` is removed from that copy, so the MR cannot choose the
  rules it is judged by. It has Read, Grep and Glob only.
- **Rules come from the default branch**, never from the MR. An MR that edits a rule file is flagged for the human.
- **Protected files go to the human.** A review round that finds a change to CI config, `CODEOWNERS` or agent
  instruction files lists them in its summary and labels the MR `needs-human`.
- **No progress stops the loop.** When a writer round leaves the patch unchanged and its last verdict still has Act
  on findings, `start-reviewer` labels the MR `needs-human` instead of reusing the verdict for another round.
- **State goes to the forge**, never to a file only one session can read.

## Terms

| term | means |
|---|---|
| **Seat** | a job one party owns for one story: human, coordinator, writer, reviewer or gate |
| **Coordinator** | the one AI session that talks with the human, plans, and starts workers |
| **Worker** | a fresh, short-lived AI session that does one job on one story: a writer or a reviewer |
| **Writer** | the worker that owns the branch of one MR; it never talks to the human |
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
| **Bot** | the account every agent of one developer acts as: a GitLab service account or a GitHub App |
