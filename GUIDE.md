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

**Today:** the bash `start-writer` still gives the writer a forge login ([ADR-0006](docs/adr/0006-identity-service-account-per-developer.md)): on GitHub the App's `gh`
(`scripts/github-app.sh`, which reads the App's key from your own home: `FACTORY_GH_APP_ID`, `FACTORY_GH_APP_KEY`), on
GitLab whatever `glab` login this machine has; nothing checks that the GitLab one is a bot. The `agent-factory ask` it
gives the writer runs as that same login (`FACTORY_IDENTITY=own`). Every command you run yourself (`claim`, `release`,
`status`, `block`, `reconcile`, and the rest of `agent-factory`) follows the steps below. `start-writer` moves over
when it is ported (#109, #110).

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

Any process of your user can run the same sudo line and get a token. The coordinator's settings
([#106](https://github.com/chiyanram/agent-factory/issues/106), "Set up the coordinator") deny `sudo` and the wrapper,
so start the coordinator only with `agent-factory coordinator`. The key itself stays out of reach either way.


### Both forges

- Every agent post starts with its seat: `[coordinator]`, `[writer]` or `[reviewer]`.
- A ticket's first writer run opens its change: after the first push of `factory/<ticket>`, the host opens a draft
  change onto the default branch, as the project's identity. Its title is the spec's title and its body names the
  ticket; the spec's text stays local. A change already open from that branch is reused, never doubled; two are left
  to you ([#164](https://github.com/chiyanram/agent-factory/issues/164)). **Today:** the writer step (#113) does not call it yet.
- On agent branches, CI runs test jobs only, with no secrets. An agent never changes CI: the host push refuses it, and
  the work is blocked with "touches CI config" and the files named (`src/core/ci-files.ts`, #115). The CI files are
  `.github/workflows/**`, `.github/actions/**`, `.gitlab-ci.yml` or the file the project's GitLab settings name
  instead, and every file those include in this repository, at any depth, child pipelines (`trigger: include:`) too;
  a glob follows GitLab's rules. For each, the pushed commit's version must be the branch's before the push or the
  default branch's, so a merge or rebase onto the default branch passes, and an edited merge or a reset does not. A CI
  file that does not parse, an include it cannot read, or one that names a variable is refused. You make a CI change
  in your own commit ([review 8](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6682922264)). `rules:` in `.gitlab-ci.yml` is not a gate: the branch's own copy runs.
  **Today:** the bash writer still pushes itself, so the refusal applies once the writer runs in the box and the host
  pushes (#113).
- The backstop, in case a CI change gets through anyway; set it up once per project:
  - GitLab: mark every secret CI/CD variable **Protected**, so a pipeline on an agent branch never sees it. Optional:
    point Settings → CI/CD → General pipelines → CI/CD configuration file at a file in a separate project you
    protect (`.gitlab-ci.yml@group/ci-config`), so the branch's copy is not the one that runs. **Today:** not yet tried
    on the free tier.
  - GitHub: keep secrets only in environments that need a reviewer's approval, never as plain repository secrets;
    and give a bot App no **Workflows** permission (step 1), so it cannot push a workflow change at all.
  - **Today:** `agent-factory setup` does not check the backstop yet; check it by hand.
- VM (`FACTORY_BOX=vm`): install Sysbox on the VM first ([#158](https://github.com/chiyanram/agent-factory/issues/158)).
  The box runs its own Docker under `--runtime=sysbox-runc`, so its root is an unprivileged user on the VM. Without
  Sysbox the box refuses to start; it never falls back to `--privileged` ([decision](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6704930024)).
  The image is `images/factory-box/Dockerfile`: git, Docker, Node 22 and the runner CLIs at pinned versions. A
  project's toolchain goes in its own `box.Dockerfile`, built `FROM` that image. **Today:** nothing builds, pins or
  starts the image; the writer step does (#113).
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

## Set up the box's model login

The box gets one model-only token, never your full login (ADR-0012 S6, #136). `claude setup-token` makes a one-year
token that "can only make model requests". It needs a Claude Pro, Max, Ultra, Team or Enterprise plan. Copilot follows
at stage B.

| # | who | step | why |
|---|---|---|---|
| 1 | developer | Run `claude setup-token` and approve in the browser. The token prints once; do not paste it anywhere but step 2. | The command does not save the token anywhere. |
| 2 | developer | Run `agent-factory setup claude` and paste the token at the hidden prompt. On the VM, run it as the user that runs the dispatcher: `sudo -u factory -H agent-factory setup claude`. | macOS keeps it in the login Keychain (passed to `security` on stdin, never in argv). Linux keeps it in `~/.factory/secrets/claude-token`, mode 600, in a folder of mode 700. A GitHub login (`gho_`, `ghp_`, `github_pat_`) is refused. |
| 3 | developer | Run `agent-factory setup status`. It prints the box, its risks, and the token's days left; exit 0 means a box may start. | A box never starts with an expired token, or one with no expiry on record. |
| 4 | developer | When `status` warns (7 days before expiry), repeat steps 1 and 2. | The token lasts one year. |

**Today:** the dispatcher (#103) does not read the token yet. When it does, it passes it as
`CLAUDE_CODE_OAUTH_TOKEN` with `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1`, which keeps it out of Bash, hooks and MCP servers.
The vm box takes each value through the docker CLI's environment (`docker exec --env NAME`), never its command line.

## Set up the coordinator

The coordinator runs in its own folder, with its own settings, so it cannot widen its own wall and your other Claude
sessions are left alone ([#106](https://github.com/chiyanram/agent-factory/issues/106), ADR-0012 S2).

1. `agent-factory setup coordinator` writes `$FACTORY_HOME/coordinator/.claude/settings.json` and a `CLAUDE.md` that
   points at this guide, both mode 0444, and refuses a symlink in their place. Run it again after each upgrade.
2. `agent-factory coordinator` starts Claude Code there with `--setting-sources project`, so the allow rules of your
   own user settings do not apply; `agent-factory coordinator copilot` starts Copilot CLI with its command rules as flags (see Today below).

The wall (`src/core/coordinator.ts`):

- **Runs with no prompt:** `agent-factory poll`, `spec`, `approval` and `status`.
- **Asks you first:** `agent-factory approve`, whose yes in the prompt is your approval. **Today:** the start commands
  too (`claim`, `release`, `block`, `reconcile`, `review`, `dispatch`, `setup`, `start-writer.sh`), since the loop is
  still run by hand; they become denied once the dispatcher runs the writer in the box (#113).
- **Denied:** `gh`, `glab`, `git push`, `curl`, `wget`, `ssh`, a second interpreter or shell (`node -e`, `python`,
  `sh -c`, `bash -c`, `npx` and others), `sudo`, the App token's wrapper, `security`, `chmod` and `chown`. Editing any
  `.claude/`, the package, `$FACTORY_HOME/approvals`, `projects`, `runs`, `secrets` and `coordinator`. Reading the
  secret paths: `~/.ssh`, `~/.gnupg`, the gh and glab logins, `~/.git-credentials`, `~/.netrc`, the cloud logins,
  `~/.docker/config.json`, `~/.npmrc`, `~/.m2/settings.xml`, `~/.gradle/gradle.properties`, the Keychain and the
  browser profiles, the factory user's home (`FACTORY_BOT_HOME`, default `/home/factory`) and every `.env*`.
- **Edits with no prompt** only spec drafts in `$FACTORY_HOME/specs`; any other edit asks you.
- Bypass and auto mode are switched off.

Check it once after setup: in the coordinator's session, ask it to read `~/.ssh/canary` (make an empty one first), a
project's `.env`, and to edit a file of the package and a project's `.claude/settings.json`; each must be refused. **Today:**

- Bash deny rules match a command as typed, and Claude Code's docs say they are no security boundary; the OS-level
  sandbox is not switched on, since `agent-factory status` posts with your own `gh` or `glab` login, which it would
  block (#114). A program the coordinator may run that reads files itself is not held by the Read rules.
- Copilot CLI has no read or edit rule by path, so under `agent-factory coordinator copilot` none of the Read or
  Edit denies above hold; only the command denies, and its folder plus `--add-dir`, do. The flags are not yet tried
  against a live Copilot CLI. Use Claude Code for the coordinator until they are.
- The read-only mode of the settings is no wall: your own user owns the folder, so the session could rename or replace
  the file with a command its Bash rules do not name. The wall holds once the folder belongs to the `factory` OS user
  (ADR-0012 S2) or the sandbox is on (#114).
- The dispatcher does not yet refuse to start when these settings are loosened (ADR-0012 S2; #105).
- Jira and Dynatrace reads, and questions to Jira, come with their plugins (#134).

## Settings

The scripts read their settings from the environment.

| setting | meaning | default |
|---|---|---|
| `FACTORY_FORGE` | the forge adapter | `gitlab` (or `github`) |
| `FACTORY_PROJECT` | the GitLab project path, or the GitHub `owner/name` | — |
| `FACTORY_REPO` | a local clone of that project; worktrees, packs and run files go in its `.claude/` | — |
| `FACTORY_RULEBOOK` | the rulebook plugin folder that holds `skills/<domain>/references/` | — |
| `FACTORY_GLAB`, `FACTORY_GH`, `FACTORY_CLAUDE` | the `glab`, `gh` and `claude` binaries | `glab`, `gh`, `claude`. **Today:** the bash scripts default `FACTORY_GH` to `scripts/bin/gh`, the App |
| `FACTORY_QUIET_MINUTES` | `dispatch`: how long an open question may sit before the claim is released | `30` |
| `FACTORY_IDENTITY` | who `agent-factory` acts as on the forge: `own`, your `gh` or `glab` login, or `app`, a GitHub App whose key the `factory` user holds ([Set up identity](#github)) | `own` |
| `FACTORY_APP_USER`, `FACTORY_APP_COMMAND` | with `app`: the OS user that holds the key, and the root-owned wrapper its sudo rule names | `factory`, `/usr/local/bin/agent-factory-app-token` |
| `FACTORY_FORGE_HOST` | the forge's host; the host push sends a branch only to a URL on it | `github.com` or `gitlab.com` |
| `FACTORY_GH_APP_ID`, `FACTORY_GH_APP_KEY` | **Today:** the bash scripts only: the GitHub App's ID and its private key file in your own home; `agent-factory` reads neither | git config `factory.ghAppId`, `factory.ghAppKey` |
| `FACTORY_CLAIM_LABEL` | the claim label | `agent::claimed` |
| `FACTORY_MAX_RUNS` | live runs at once on this machine | `2` |
| `FACTORY_MAX_USD` | the most one `claude -p` run may spend, in US dollars: every reviewer run, and a writer in `print` mode (the CLI does not cap a background run) | no cap |
| `FACTORY_DRY_RUN` | `1` makes `claim`, `release`, `status`, `ask`, `block` and `reconcile` print each forge write instead of making it, and end their line in "(dry run)"; reads still go to the forge; `start-writer` and `agent-factory review` refuse it | off |
| `FACTORY_RUN_MODE` | `print` runs the writer as a foreground `claude -p` | background |
| `FACTORY_BOX` | where a box runs ([review 1](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6682834172)): `vm` runs each box as a container with its own Docker engine under Sysbox, on this host's Docker (#113; install Sysbox first, #158); `laptop` on Rancher Desktop is **planned** (#129). No box starts without it | — (refused) |
| budget settings | **planned** ([review 11](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6683060877)): the factory's share of your budget (Copilot limit at work, Claude subscription at home), the stop line, runs at once, per-run caps, the model per phase and run hours, per project and machine | set after the pilot |
| `FACTORY_WRITER_MODEL` | the writer's model | Claude's default |
| `FACTORY_FIND_MODEL`, `FACTORY_RULE_MODEL`, `FACTORY_LOGIC_MODEL` | the reviewer's models | `sonnet`, `sonnet`, `opus` |
| `FACTORY_RULEBOOK` | the rulebook plugin folder the reviewer reads rules from (`skills/<domain>/references/`); `review` and the dispatcher's review step need it, by absolute path | — |
| `FACTORY_CLAUDE` | the `claude` CLI the reviewer runs | `claude` |
| `FACTORY_EGRESS_IMAGE` | the egress proxy's Squid image, pinned by digest (`name@sha256:<64 hex>`); a tag alone is refused (ADR-0012 S7) | a pinned `ubuntu/squid` 6.6 on Ubuntu 24.04 |
| `FACTORY_UPSTREAM_PROXY` | at work: the corporate proxy, `host:port`, that every egress proxy leaves through; a setting of the machine, not of a project | none: direct |
| `FACTORY_REVIEW_FIND`, `FACTORY_REVIEW_VERIFY` | the reviewer's instructions | the package's `prompts/review-find.md`, `prompts/review-verify.md` |
| `FACTORY_CURL` | the `curl` that mints the App's token | `curl` |
| `FACTORY_MAX_TRIES`, `FACTORY_SLEEP` | tries per request on a rate limit, and the wait command | `4`, `sleep` |

### The project file

Each project has one file on this machine, `$FACTORY_HOME/projects/<project>.json` (ADR-0014 P3), never in the repo,
so a branch cannot choose its own gate or the programs its evidence runs (#91):

```json
{
  "gate": "local",
  "verify": ["make", "verify"],
  "ready": { "programs": ["make", "./gradlew"], "timeoutMinutes": 30 },
  "egress": { "allow": ["repo.maven.apache.org", "services.gradle.org", ".gradle.org"] }
}
```

- `gate`: `forge-ci` when the forge's own CI is the gate; `local` when the project has none. Then the local verifier
  runs `verify` once at each head, and the dispatcher decides from its own record of that run, never from the forge,
  where any other check (a bot, a preview) could read as green; a red check on the forge still sends the writer back.
  It also posts the result as the commit status `agent-factory/verify` at the head, for people and branch protection.
  **Today:** that status is tested against GitHub's API shape only; on GitLab it is not yet tried on a live project.
- `ready.programs`: an evidence row's command must start with one of these, and run with no shell (no pipe, `&&`,
  redirect, `$`, glob or backslash); any other row fails the ready check.
- `egress.allow`: the hosts this project's boxes may reach, by name: `api.anthropic.com`, or `.npmjs.org` for a
  domain and every subdomain; no wildcard, IP, scheme, port or path. Each project has its own proxy,
  `factory-egress-<project>`, on its own network, `factory-int-<project>`, so one project's box never sees another's
  list (decision on [#30](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6707179439)). With none,
  no box runs for the project.
- With no file, the gate is forge CI and neither the ready check nor the verifier runs. A file that is there but not
  valid stops `dispatch` with the reason, so a typo never turns a local gate into forge CI. `#134` adds the plugin fields to the same file.

### The box image

Each project's box runs an image built on this machine, never pulled (#113):

```bash
agent-factory box build <project>
```

It builds the package's base image (`images/factory-box`: Ubuntu 24.04, Docker, Node 22, the agent CLIs), then, if
`$FACTORY_HOME/projects/<project>/box.Dockerfile` exists, the project's own layer on top of it, and pins the result's
ID in `$FACTORY_HOME/projects/<project>/box.json`. The dispatcher runs exactly that ID. A project Dockerfile must end
on the base:

```dockerfile
ARG BASE
FROM ${BASE}
RUN apt-get update && apt-get install -y --no-install-recommends openjdk-21-jdk-headless
```

Run it again after an upgrade of `agent-factory`. Both images are tagged by their ID (`factory-box-base:<12 hex>`,
`factory-box-<project>:<12 hex>`), so `docker image prune` keeps them.

## Run the loop

**You own the conversation, never the code or the queue.** You are the **coordinator**: the one AI the human talks
to. Writers and reviewers are fresh **workers** that the **dispatcher** (code, no LLM) starts. Each does one job on one
story and goes away. The forge is your only memory. In the target you run only the read commands, `agent-factory status`,
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
  **Today:** the bash `start-writer` still tells the writer to push, post with `agent-factory ask` and mark the MR ready; the
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

The dispatcher's decision table is code: [`src/core/dispatch/table.ts`](src/core/dispatch/table.ts) (#103, ADR-0012 S3,
[review 9](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6682943767)). Its header lists every row and every stop; the code is the source of truth. `agent-factory dispatch
<project> --once` runs one pass: it decides each approved ticket (and each change on a `factory/<ticket>` branch),
posts and labels as the project's identity, and starts at most one run. Run it from launchd or cron every few
minutes; a lock keeps two passes apart, and `--dry-run` prints the decisions and acts on none. Each pass keeps its
records in `$FACTORY_HOME/runs/<project>/<ticket>.jsonl`, so a restart loses nothing: a run that started and never
ended goes to a person. A ticket's change is the one on `factory/<ticket>` in this repository; a fork's branch of that
name is ignored, and two changes on it go to a person. Two rules hold over every row: a wait on a claimed change that
has been quiet (no record, no comment) for `FACTORY_QUIET_MINUTES` releases the claim; and a stop that went to a person
(`needs-human`, the claim released, one note) is not posted again when the label is removed: approve again to go on,
which also starts every count afresh. The ready check runs each evidence row of the writer's report again at the head,
and the local verifier the project file's `verify`, each in a fresh box with no forge token and its egress through the
project's own proxy; nothing of the branch runs on the host. Each box run starts that proxy afresh, inside the
project's lock. The dispatcher opens the vm box when `FACTORY_BOX=vm`, `box.json` and `egress.allow` are set; otherwise
the ready check and the verifier say what is missing and wait. **Today:** there is no writer step yet (#113), so no
run record is written, and the ready check, the verifier and the review step have nothing to run after;
`dispatch` does only these rows: reconcile a merged claim,
release a claim on a missing or stale approval or a quiet one, leave alone a change someone else claimed, and hand to a
person an unknown pipeline state or two changes on one branch. For each approved ticket it says which run it would
start. Run the table below by hand for the rest. There is no merge-conflict row yet.
The order is fixed: writer done → ready check → reviewer → gate → human ([gap 2](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6681560750)).
Poll the forge about every 5 minutes. Limits: one run per MR, at most `FACTORY_MAX_RUNS` at once, and at most one
heavy run (a build, an IT suite or a deploy) per machine.

| when the forge shows | do |
|---|---|
| the MR's ticket is approved (`agent-factory approval <project> <ticket>` exits 0), with `asks=0`, `needs_human=no` and no `stop` newer than the approval | `claim`, `start-writer`, `status "writer started"`; for a bug, `start-writer --test-first` first |
| a bug's test-first run ended with a pushed `test:` commit and `asks=0` | `start-writer` for the fix |
| the writer's report is `done` and the host pushed and posted it (**today:** the bash writer marks the MR ready instead) | the ready check runs its evidence rows at the head in a box (**today:** dispatch has no writer step yet, #113, so run them by hand), then `agent-factory review <mr>` |
| an open Act on thread, or the gate is red, with `needs_human=no` | `start-writer` again; after 3 rounds, label `needs-human`; a flaky job gets a rerun, not a writer |
| the evidence fails at the head | `start-writer` again; after 3 failures, label `needs-human` |
| the project's gate is `local` and the verifier has not run at this head | the local verifier runs `verify` in a box and posts `agent-factory/verify` at the head; it failing sends the writer back, as red CI does (**today:** dispatch opens no box yet, #113) |
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
| `agent-factory claim <mr>` / `agent-factory release <mr>` | adds or removes the claim label; `claim` refuses an MR already claimed or not open; `release` of an MR with no claim says so and is not an error |
| `start-writer.sh [--test-first] <mr>` | starts a fresh writer in its own worktree at the MR head; refuses an MR with a live run, and a machine at its run limit; `--test-first` starts a run that commits only a bug's failing test and stops |
| `agent-factory review <mr>` | one review round on a claimed MR: the context pack; the same patch-id as the last round reuses its verdict with no model run (with Act on still open, `needs-human`); after 3 rounds it refuses; then a find pass and one verify pass per kind, each a fresh read-only `claude -p` in a throwaway folder with the pack and the code at the head and no rule file; one thread per Act on and Consider; the status box; one summary note, last. It refuses an MR that already has a live writer or reviewer, and a machine at `FACTORY_MAX_RUNS`, and holds `.claude/runs/reviewer-<mr>.pid` while it runs. A change that touches a file whose name holds a control character is refused, for a person to review. Exit 0 posted, reused or nothing to do, 3 when the head moved (nothing posted), 1 otherwise. Each pass's answer is kept under `.claude/runs/<mr>/<head>/` |
| (context pack) | built by `review`, one per head, under `$FACTORY_REPO/.claude/packs/`: rules from the default branch only; an unresolved rule pointer or link stops it |
| `agent-factory status <mr> <sha> "<line>"` | posts one `[coordinator]` note through the posting template; refuses when the head is no longer `<sha>`, and a line that is not one line of text |
| `agent-factory ask -- <mr> <sha> "<question>"` | **today** the writer's one way to reach the human: posts one `[writer] OPEN:` note; refuses when the head is no longer `<sha>`. `--` keeps a question that starts with `-` a question. The target: the writer writes the question to `report.json` and the host posts it |
| `agent-factory spec <project> <ticket>` | checks a ticket's local spec (`$FACTORY_HOME/specs/<project>/<ticket>/spec.md`, default `~/.factory`) against the template: prints its hash, or every missing part (intent, numbered acceptance criteria, design, lane); `--template <ticket>` prints an empty one. The hash ignores line endings and trailing spaces, and changes on any real edit ([review 3](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6682553870), #127) |
| `agent-factory approve <project> <ticket> <hash>` | records the human's approval in `$FACTORY_HOME/approvals/<project>/<ticket>.json`: the spec's full hash, who and when. The hash on the command line is the full hash the human saw, as `agent-factory spec` printed it; a spec that no longer has exactly that hash is refused. Run it only through the harness `ask` prompt, never from an allow list ([review 3](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6682553870), #104) |
| `agent-factory approval <project> <ticket>` | whether work may start: `approved` (exit 0), `stale` when the spec changed after approval (3), `missing` (4), or a broken record or spec (1); `dispatch` reads the same record |
| `agent-factory dispatch <project> --once [--dry-run]` | one pass of the dispatcher's table over the project (see Triggers); exit 0, 1 when it cannot run, 2 when an action failed |
| `agent-factory block <mr> "<reason>" [<log>]` | labels `needs-human`, posts one `[coordinator] blocked: <reason>` note with the log as a field, then releases the claim; the label goes first |
| `agent-factory lint-edit '<command>'` | the writer's hook, not yours: lints each file an Edit or Write changed and shows the writer what failed. The command runs with no shell; one that needs a shell is reported to you and holds no writer |
| `tokens.sh <mr>` | the tokens one MR spent, by phase (writer, find, verify), from the records kept per head; reads no forge |
| `agent-factory reconcile` | removes each claim and run worktree with no live run, and each claim left on a merged MR; a live-run list it cannot read releases nothing |

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
  a note on the MR approves nothing, and the bot cannot merge the protected branch. In the coordinator's settings
  `approve` is an `ask` rule, so it runs only on your yes in the harness prompt (#106).
- **Today: the writer pushes only its own branch**, with `--force-with-lease` after a rebase. On GitHub its session
  gets an empty `GH_CONFIG_DIR` and no system or global git config, so it cannot act as the person. This is a prompt
  rule plus a missing login, not a wall; the target removes the forge token from the writer.
- **Decided: ready is checked, not reported.** No review starts until code has run the change's evidence commands
  again at its head, in a fresh box ([ADR-0012](docs/adr/0012-safety-design-for-unattended-runs.md) S5, #91), with no
  shell and only the programs the project file lists. **Today:** it is built on the box seam, but the dispatcher opens no box yet
  (#113), so the dispatcher waits for it, and by hand you run the evidence yourself first.
- **The reviewer reads, and the script posts.** It runs in a throwaway folder (under `$FACTORY_HOME/review-runs/`,
  private to you) with the pack and a copy of the whole code at the head. It may report code the diff does not touch only when this change breaks it.
  Every `CLAUDE.md`, `AGENTS.md`, `.claude/` and `.agents/` is removed from that copy, so the MR cannot choose the
  rules it is judged by. It has Read, Grep and Glob only (`claude -p --restricted`), and an environment with no forge
  token and no `FACTORY_*` setting. **Today** it runs on the host, not in the box (#113).
- **Rules come from the default branch**, never from the MR. An MR that edits a rule file is flagged for the human.
- **Protected files go to the human.** A review round that finds a change to CI config, `CODEOWNERS` or agent
  instruction files lists them in its summary and labels the MR `needs-human`, once per file. The same script-made
  box lists every build file and dependency manifest touched, and each new dependency (ADR-0012 S10, #117). Zero
  findings is not a pass: the summary says so, and no verdict ever approves or undrafts (#118).
- **No progress stops the loop.** When a writer round leaves the change empty, or the patch unchanged while its last
  verdict still has Act on findings, `agent-factory review` reuses the verdict and labels the MR `needs-human`.
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
  and Jira markup characters are escaped. The template is built (`src/core/post.ts`, #126), and
  the commands, the dispatcher, the reviewer and the writer's exit post through it ([review 4](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6682589125)). **Today:** the bash
  writer still holds a forge login, writes its evidence into the MR description itself and marks the MR ready; none of
  that goes through the template until the writer runs in the box (#109, #113).
- **The coordinator cannot widen its own wall.** It edits only spec drafts with no prompt, and never its settings, any
  `.claude/` or the factory ([review 7](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6682899888), #106). **Today:** an edit elsewhere asks you rather than being refused.
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
