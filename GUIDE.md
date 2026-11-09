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
human           agent-factory start · approve · waive (local records) · reviews · merges with your own account
```

Agent text is marked by content, not by author: every post starts with `[writer]`, `[reviewer]` or `[coordinator]`,
and agent commits carry an `Agent: <seat>` trailer. The dispatcher's writer gets it from a `prepare-commit-msg` hook in
its clone, mounted read-only, and the host push refuses a writer commit without it (#128). **Today:** the bash
`start-writer` writes no trailer. With your own login (`FACTORY_IDENTITY=own`, the default) there
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
  to you ([#164](https://github.com/chiyanram/agent-factory/issues/164)). The writer step (#113) does this on a first run that
  committed; a first run that committed nothing opens no change, and the run's record says so.
- On agent branches, CI runs test jobs only, with no secrets. An agent never changes CI: the host push refuses it, and
  the work is blocked with "touches CI config" and the files named (`src/core/ci-files.ts`, #115). The CI files are
  `.github/workflows/**`, `.github/actions/**`, `.gitlab-ci.yml` or the file the project's GitLab settings name
  instead, and every file those include in this repository, at any depth, child pipelines (`trigger: include:`) too;
  a glob follows GitLab's rules. For each, the pushed commit's version must be the branch's before the push or the
  default branch's, so a merge or rebase onto the default branch passes, and an edited merge or a reset does not. A CI
  file that does not parse, an include it cannot read, or one that names a variable is refused. You make a CI change
  in your own commit ([review 8](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6682922264)). `rules:` in `.gitlab-ci.yml` is not a gate: the branch's own copy runs.
  The dispatcher's writer (#113) runs in the box and the host pushes, so the refusal applies there. **Today:** the bash
  `start-writer` still pushes itself, and the refusal does not apply to it.
- The backstop, in case a CI change gets through anyway; set it up once per project:
  - GitLab: mark every secret CI/CD variable **Protected**, so a pipeline on an agent branch never sees it. Optional:
    point Settings → CI/CD → General pipelines → CI/CD configuration file at a file in a separate project you
    protect (`.gitlab-ci.yml@group/ci-config`), so the branch's copy is not the one that runs. The GitLab docs list it
    on the Free tier ([pipeline settings](https://docs.gitlab.com/ci/pipelines/settings/)). **Today:** not yet tried.
  - GitHub: keep secrets only in environments that need a reviewer's approval, never as plain repository secrets;
    and give a bot App no **Workflows** permission (step 1), so it cannot push a workflow change at all.
  - Check the backstop by hand. `agent-factory setup` does not check it, because the factory's identity must not hold
    the right to read CI variables or secrets (#115).
- VM (`FACTORY_BOX=vm`): install Sysbox on the VM first ([#158](https://github.com/chiyanram/agent-factory/issues/158)).
  The box runs its own Docker under `--runtime=sysbox-runc`, so its root is an unprivileged user on the VM. Without
  Sysbox the box refuses to start; it never falls back to `--privileged` ([decision](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6704930024)).
  The image is `images/factory-box/Dockerfile`: git, Docker, Node 22 and the runner CLIs at pinned versions. A
  project's toolchain goes in its own `box.Dockerfile`, built `FROM` that image. `agent-factory box build` builds and
  pins it ([The box image](#the-box-image)).
- Work laptop (`FACTORY_BOX=laptop`): in Rancher Desktop, share no home folder with its VM. The writer's box is a
  container there, with its own Docker inside ([review 1](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6682834172)).
- Whoever started the work does not approve it. Write this rule down for the team; a forge on a free plan cannot
  enforce it.
- When a developer leaves, revoke the GitLab token and block the account, or delete the App's key or the App.
- Before the first run on a machine, open `claude` once in `FACTORY_REPO` and accept the trust prompt. Add
  `.claude/worktrees/`, `.claude/runs/` and `.claude/packs/` to the project's `.gitignore`.
- Give the writer its quick tools in `docs/agents/commands.md` on the default branch, one plain line each (a fence
  around them is fine): `lint-file: <command>` runs on each file the writer edits, with the file as its last word,
  and `test-touched: <command>` runs the tests it touched. Either may be left out. The file is read from the default
  branch, never from the change's branch, because the lint runs as a hook with no permission prompt. The host writes
  the hook into a read-only `.factory/settings.json` in the clone and starts `claude` with `--settings` on it; the hook
  runs `agent-factory lint-edit`, which the box has because `box build` installs this package in it.

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

The dispatcher's writer reads it before each run and passes it as `CLAUDE_CODE_OAUTH_TOKEN` with
`CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1`, which keeps it out of Bash, hooks and MCP servers. No other secret goes into the
box: no forge token, no `PATH` or `HOME` of yours.
The vm box takes each value through the docker CLI's environment (`docker exec --env NAME`), never its command line.

## Set up the coordinator

The coordinator runs in its own folder, with its own settings, so it cannot widen its own wall and your other Claude
sessions are left alone ([#106](https://github.com/chiyanram/agent-factory/issues/106), ADR-0012 S2).

1. `agent-factory setup coordinator` writes `$FACTORY_HOME/coordinator/.claude/settings.json` and a `CLAUDE.md` that
   points at this guide, both mode 0444, and refuses a symlink in their place. Run it again after each upgrade.
2. `agent-factory coordinator` starts Claude Code there with `--setting-sources project`, so the allow rules of your
   own user settings do not apply; `agent-factory coordinator copilot` starts Copilot CLI with its command rules as flags (see Today below).

The wall (`src/core/coordinator.ts`):

- **Runs with no prompt:** `agent-factory poll`, `spec`, `approval` and `status`, and `agent-factory request`, whose
  write the project's policy decides in code ([Writes](#writes)).
- **Asks you first:** `agent-factory confirm`, whose prompt shows the exact text of a kept write; your yes sends it. **Today:** the start commands
  too (`claim`, `release`, `block`, `reconcile`, `review`, `dispatch`, `setup`, `start-writer.sh`), since the loop is
  still run by hand; they become denied once the dispatcher runs the writer in the box (#113).
- **Denied:** `agent-factory approve`, `agent-factory start` and `agent-factory waive`: the AI never approves, never
  STARTs a ticket and never waives its own test check hit, so you run them yourself in your own terminal (#227, #231).
  `agent-factory eval`: an eval pass spends on model runs (up to $100), and only a human starts one (#215). Then `gh`, `glab`, `git push`, `curl`, `wget`, `ssh`, a second interpreter or shell (`node -e`, `python`,
  `sh -c`, `bash -c`, `npx` and others), `sudo`, the App token's wrapper, `security`, `chmod`, `chown`,
  `agent-factory plugin` and `agent-factory project`. Editing any `.claude/`, the package, `$FACTORY_HOME/approvals`,
  `starts`, `waivers`,
  `projects`, `runs`, `secrets`, `coordinator`, `pending`, `writes`, `plugins.json` and `plugins`. Reading the
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
- Jira and Dynatrace reads come with their plugins (#134); writes to them go through `request` ([Writes](#writes)).

## Plugins

Every outside tool is reached through a plugin ([ADR-0014](docs/adr/0014-plugin-model.md), #134). A plugin is an
executable: `<exe> describe` prints one JSON object (its protocol, capabilities, declared writes, the env names it
needs, and the programs it runs by name, `cli`), and `<exe> call` reads one JSON request on stdin and prints one JSON result, a sealed case of that
capability, on stdout; its logs go to stderr. The core runs it with no shell, in a process group of its own that the
timeout, the output cap and the end of the call kill whole, and with only `PATH`, `HOME`, `LANG` and the names it
declared. A plugin may not declare a model or cloud login, a forge token, a `FACTORY_*` setting or a loader variable
(`LD_*`, `DYLD_*`, `NODE_*` and the like); each uses its own CLI's login (`src/core/plugin/`).

A plugin is the folder its file sits in. `plugin add` takes the sha256 of every file in that folder, copies the
folder into `$FACTORY_HOME/plugins/<sha256>/` (mode 700) and records it in `$FACTORY_HOME/plugins.json` (mode 600);
every call hashes the copy again and runs it, so a change to your own folder after review changes nothing. A file or
folder that someone else could write to, or a symlink inside the folder, is refused.

| command | does |
|---|---|
| `agent-factory plugin add <path\|name>` | inspects a plugin and pins it, as above; a name is a plugin bundled with the package, and nothing is fetched from the network. A name already added is refused: use `update` |
| `agent-factory plugin update <name> [<sha256>]` | runs the test kit on the plugin's folder as it is now and shows its hash and the writes it adds (exit 3, nothing recorded); with that hash, records it, if it is still the same |
| `agent-factory plugin test <path\|name>` | the contract test kit: handshake; each `fixtures/<capability>/<case>.in.json` against its `.out.json`, for declared capabilities only; bad input; an unknown op; one JSON object on stdout; a canary in each declared env name that must not come back; no token in any answer; and write fidelity: each write fixture's text (`input.text`, or a post in `input.post` or `input.body`, as the posting template renders it), and once more a tricky one, must reach the CLI byte for byte and whole (an argv word, stdin, or a JSON string that is the text itself), with no more calls than the fixture's `<case>.cli.json` lists answers. A plugin that writes must name its programs in `cli` (never an interpreter such as `node`); the kit then runs every call with a recording fake of each first on the plugin's `PATH`, answering from `<case>.cli.json`, so a named program is never the real one |
| `agent-factory plugin list` | the registered plugins, with their writes and hashes |

A plugin's `PATH` is yours without relative folders and without folders others can write to. The coordinator may not
run `plugin` or edit `plugins.json` or the store (#106). **Today:**

- The pin covers the plugin's folder, not the interpreter a script names (`#!/usr/bin/env node` takes the first
  `node` on that `PATH`) nor the CLI it calls; folders your own user can write, such as `~/.local/bin`, stay on the
  `PATH`, since most CLIs live there.
- The fakes stand in only for the programs named in `cli`, found by name on the `PATH`: `describe` runs with the real
  `PATH`, and a program not named, one run by an absolute path, or the network reached from the plugin's own code is
  not held back by the kit.

### The forge as a plugin

The package bundles two plugins, `github` and `gitlab`: the factory's own forge adapters, built into
`plugins/<name>/lib/` from the compiled package, so the pinned folder holds every module it runs. Each declares
`forge.read` and `forge.write` and runs `gh` or `glab` from its `PATH` with that CLI's own login; the project comes in
each request, so it needs no setting and no token. A project opts in with its project file:

```json
{ "connectors": { "forge.read": "github", "forge.write": "github" } }
```

Run `agent-factory plugin add github` once. The bundled plugins start with `#!/usr/bin/env node`, so `node` must be in
a `PATH` folder only its owner can write; where it is not (some CI tool caches), `describe` exits 127, and a link to
`node` in such a folder, put first on the `PATH`, fixes it. Then `dispatch <project>` makes every forge call of its pass through the
plugin, and reads each answer back in the seam's own shapes, so a plugin that answers anything else fails that call.
A forge call has the built-in adapter's room: an answer of up to 64 MiB, and time to wait out a rate limit on every
try. `FACTORY_DRY_RUN` still holds every write back, opening a change too. Without the mapping, the built-in adapter
runs, as before.

The plugin's name must be the forge's (`FACTORY_FORGE`), and each request names its forge, which the plugin checks.
A setting the plugin cannot honour stops the pass instead of being dropped without a word: `FACTORY_GH`,
`FACTORY_GLAB`, `GH_TOKEN`, `GITHUB_TOKEN`, `GH_ENTERPRISE_TOKEN`, `GH_HOST`, `GITLAB_TOKEN`, `GITLAB_HOST`, and a
`FACTORY_FORGE_HOST` other than github.com or gitlab.com. **Today:**

- Only `dispatch` opts in; `review`, `poll`, `status` and the loop commands still use the built-in adapter.
- `FACTORY_IDENTITY=app` with a forge plugin is refused: the App's token would have to reach the plugin, and none may
  hold one (ADR-0014 P11). App projects keep the built-in adapter.
- A project on GitHub Enterprise or a self-managed GitLab keeps the built-in adapter, since the plugin gets no host
  setting; so does one whose `gh` or `glab` login comes from a token in the environment.
- The plugin tries a rate-limited request 4 times; `FACTORY_MAX_TRIES` does not reach it.

### Pings

The dispatcher pings you on Discord when a ticket needs you (#119), through the bundled `discord` notify plugin:
- each hand-over its table makes on a change: CI red twice, the ready check's failures, the same patch twice, a run
  that never ended, and its other stops;
- a writer run that ended blocked, or with a question that waits on your answer;
- a change ready for you to review and merge (the gate is green).

Each goes once per event and head, as its forge note does. To set it up:
1. In the Discord channel, Integrations → Webhooks → New Webhook, and copy its URL.
2. `agent-factory setup discord` and paste it at the hidden prompt. It is kept like the claude token: the login
   Keychain on macOS, `~/.factory/secrets/discord-token` (mode 600) on Linux, never printed. On the VM run it as the
   user that runs the dispatcher.
3. `agent-factory plugin add discord`, and map `"notify": "discord"` in the project file's `connectors`.

The core hands the webhook to the plugin inside the request on stdin, never in env or argv; the plugin's `curl` reads
it from a 0600 config file it removes after, and the message from stdin. The text is a posting template, and every
mention is switched off, so nothing pings `@everyone`. A ping only informs: one that fails never stops the pass or
the ticket (the pass prints why, the forge note is the record) and is not tried again, and a reply in Discord is
never an approval. `FACTORY_DRY_RUN=1` prints each ping instead. The coordinator's `request notify` goes through the
same plugin, within its policy and cap ([Writes](#writes)). The webhook goes only to the package's own
`plugins/discord/plugin`, matched by its real path, never to another plugin that calls itself `discord`. **Today:**

- A stop the reviewer makes itself (open Act on findings, an empty change, a protected file, its round limit) and a
  hand-over with no change to label ping no one yet; the forge note or the pass's error is the record.
- The plugin runs `curl` with no proxy setting, so a host that reaches Discord only through a proxy sends no ping.
- The text is the forge's posting template, so `&` and `<` show as `&amp;` and `&lt;` in Discord.

### Writes

The coordinator holds no login, so it never writes to a tracker or a chat itself. It asks, and code performs the write
(ADR-0014 P5, P6; `src/core/plugin/request.ts`):

1. It writes a draft, as JSON, among the spec drafts in `$FACTORY_HOME/specs/` (`request` reads a draft from nowhere
   else): `{"project": "ledger", "ticket": "PROJ-1", "text": "…"}`, with `"items": ["…"]` for a list (not for
   `notify`), and a `"title"` for `tracker.create`. A draft with any other field is refused.
2. It runs `agent-factory request <tracker.comment|tracker.create|notify> --file <draft.json>`. The core checks the
   draft, cleans every text field with the posting template (`[coordinator] …`, so no line starts a quick action, a
   mention, a reference or a link), and applies the policy.
3. `allow`: the write goes out at once through the plugin the project file maps it to (exit 0). `confirm`: it is kept
   in `$FACTORY_HOME/pending/`, nothing goes out, and `request` prints a command (exit 3):
   `agent-factory confirm <project>/<ticket>/<capability>/<id> '<the text>'`. The coordinator runs it, and the harness
   prompt shows you where the write goes and its exact text; your yes sends it. Say yes only when the prompt spells
   the text out in single quotes: a `confirm` whose text comes from `$(…)`, a backtick or a variable would match
   and go out, while the prompt showed you only the command that makes the text. `deny`: refused (exit 1).

A write goes out only when all of these hold, at `request` and again at `confirm`:

- the ticket's approval is current (`agent-factory approval` says `approved`); a ticket with none gets no write;
- the project file maps the capability to a plugin, and that plugin declared the write in its `describe`;
- the cap has room: it counts the writes since the ticket's latest approval, so approving again starts afresh. A write
  the plugin failed still counts, since it may have gone out;
- at `confirm`, the text you were shown is the kept text, byte for byte, leaving out the invisible word joiners the
  cleaning puts after `@`, `#` and `!` (no one can see them to check them), and the kept request is unchanged.

Each write is logged in `$FACTORY_HOME/writes/<project>/<ticket>.jsonl` before it is sent, then its outcome; one
ticket's writes run one at a time behind `<ticket>.lock`, which holds its process ID, so a lock left by a process
that was killed is taken over. Cleaning drops every control and invisible format character (bidi controls and
isolates, tag characters, the soft hyphen, variation selectors), so what the prompt shows is what is sent. A plugin answers a write with `{"kind": "done", "url": "…"}`; any other kind is a
failure. `forge.write` is the dispatcher's alone, and no Jira status, assignee or field change has a capability.
**Today:**

- The pending requests and the write log belong to your own user, so the coordinator's settings deny editing them,
  but a command its Bash rules do not name could still change them; they move to the `factory` OS user with the
  approvals (ADR-0012 S2).
- No tracker or chat plugin is bundled yet, so a write needs a plugin you add yourself.
- Kept requests never expire; one made under an earlier approval is refused at `confirm`, but its file stays in
  `pending/` until you remove it.

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
| `FACTORY_POLL_MINUTES` | `dispatch`: how often launchd or cron runs it; each pass keeps it with its last-poll time, and `status` flags the orchestrator `LATE` after 3 of these while a change is claimed | `5` |
| `FACTORY_IDENTITY` | who `agent-factory` acts as on the forge: `own`, your `gh` or `glab` login, or `app`, a GitHub App whose key the `factory` user holds ([Set up identity](#github)) | `own` |
| `FACTORY_APP_USER`, `FACTORY_APP_COMMAND` | with `app`: the OS user that holds the key, and the root-owned wrapper its sudo rule names | `factory`, `/usr/local/bin/agent-factory-app-token` |
| `FACTORY_FORGE_HOST` | the forge's host; the host push sends a branch only to a URL on it | `github.com` or `gitlab.com` |
| `FACTORY_GH_APP_ID`, `FACTORY_GH_APP_KEY` | **Today:** the bash scripts only: the GitHub App's ID and its private key file in your own home; `agent-factory` reads neither | git config `factory.ghAppId`, `factory.ghAppKey` |
| `FACTORY_CLAIM_LABEL` | the claim label | `agent::claimed` |
| `FACTORY_MAX_RUNS` | live runs at once on this machine | `2` |
| `FACTORY_MAX_USD` | the most one `claude -p` run may spend, in US dollars: every reviewer run, every run of the dispatcher's writer, and a bash writer in `print` mode (the CLI does not cap a background run) | no cap |
| `FACTORY_DRY_RUN` | `1` makes `claim`, `release`, `status`, `ask`, `block` and `reconcile` print each forge write instead of making it, and end their line in "(dry run)"; reads still go to the forge; `start-writer` and `agent-factory review` refuse it | off |
| `FACTORY_RUN_MODE` | `print` runs the writer as a foreground `claude -p` | background |
| `FACTORY_BOX` | where a box runs ([review 1](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6682834172)): `vm` runs each box as a container with its own Docker engine under Sysbox, on this host's Docker (#113; install Sysbox first, #158); `laptop` on Rancher Desktop is **planned** (#129). No box starts without it | — (refused) |
| `FACTORY_WINDOW_HOURS` | `usage`: the length of the subscription's usage window, in hours, from 1 to 24 (`window.hours`) | `5` |
| budget settings | **planned** ([review 11](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6683060877)): the factory's share of your budget (Copilot limit at work, Claude subscription at home), the stop line, runs at once, per-run caps, the model per phase and run hours, per project and machine | set after the pilot |
| `FACTORY_WRITER_MODEL` | the writer's model | Claude's default |
| `FACTORY_WRITER_MINUTES` | the longest one run of the dispatcher's writer may take, from 1 to 240; a run that takes longer is stopped and blocked | `60` |
| `FACTORY_WRITER_STALL_MINUTES` | the longest a writer run may print nothing before it is stopped and blocked, from 1 to 5: it can only lower the stall time (#228) | `5` |
| `FACTORY_FIND_MODEL`, `FACTORY_RULE_MODEL`, `FACTORY_LOGIC_MODEL` | the reviewer's models | `sonnet`, `sonnet`, `opus` |
| `FACTORY_RULEBOOK` | the rulebook plugin folder the reviewer reads rules from (`skills/<domain>/references/`); `review` and the dispatcher's review step need it, by absolute path. Its process (`skills/<skill>/process/lanes.json` and `review.json`) gives the review's baseline checks; with no process there, or no `review.json`, the review keeps the built-in baseline (crq review-process, code-review and verify-done, code smells). A lanes file that drops the approval for a lane above tiny stops the review (#232). **Today:** this folder stands in for the `plugins` list, and the lanes are checked but the dispatcher still uses the built-in ones. The dispatcher's writer needs it too: it must hold `.claude-plugin/plugin.json`, and the host copies it into the writer's clone as `.factory/rulebook`, read-only, loaded with `claude --plugin-dir` | — |
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
  "ready": { "programs": ["make", "./gradlew"], "timeoutMinutes": 30, "testFiles": ["src/test/**", "**/*Spec.groovy"] },
  "egress": { "allow": ["repo.maven.apache.org", "services.gradle.org", ".gradle.org"] },
  "lanes": { "oneWayDoor": ["db/migrations/**", "api/openapi.yaml"] },
  "connectors": { "tracker.comment": "jira", "tracker.create": "jira", "notify": "discord" },
  "plugins": ["rulebook@chiyanram"],
  "policy": { "tracker.comment": { "mode": "allow", "cap": 5 } }
}
```

`agent-factory project init <project> [--template <file>]` writes it: from a template, copied once and never
read again and only when its fields read, or with no connector, no plugin and the default policy. A team that keeps its settings
live uses a team layer instead ([Settings layers](#settings-layers)). It never replaces a file that is
there.

- `gate`: `forge-ci` when the forge's own CI is the gate; `local` when the project has none. Then the local verifier
  runs `verify` once at each head, and the dispatcher decides from its own record of that run, never from the forge,
  where any other check (a bot, a preview) could read as green; a red check on the forge still sends the writer back.
  It also posts the result as the commit status `agent-factory/verify` at the head, for people and branch protection.
  **Today:** that status is tested against GitHub's API shape only; on GitLab it is not yet tried on a live project.
- `ready.programs`: an evidence row's command must start with one of these, and run with no shell (no pipe, `&&`,
  redirect, `$`, glob or backslash); any other row fails the ready check.
- `ready.testFiles`: the globs the floor guard reads as test files; they replace the built-in list (`src/test/**`,
  `test/**`, `tests/**`, `__tests__/**`, `*Test.java`, `*Spec.groovy`, `*.test.*`, `*.spec.*`, `test_*.py`,
  `*_test.go` and the like; `src/core/ready/floor.ts`).
- `ready.judgeFiles`: more globs for the judge files (#231), added to the built-in ones, never in their place: the
  build files, the verify command's files and the test config (`src/core/ready/judge.ts`).
- `egress.allow`: the hosts this project's boxes may reach, by name: `api.anthropic.com` (the writer needs it), or
  `.npmjs.org` for a
  domain and every subdomain; no wildcard, IP, scheme, port or path. Each project has its own proxy,
  `factory-egress-<project>`, on its own network, `factory-int-<project>`, so one project's box never sees another's
  list (decision on [#30](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6707179439)). With none,
  no box runs for the project.
- `lanes.oneWayDoor`: globs for the paths whose change cannot be undone (stored data, a schema, a public contract, a
  deploy). A change that touches one needs the one-way-door lane (#230): before the build when the spec's `## Planned
  files` names one, and in the ready check when the diff touches one. It is a deny-list key ([Settings](#settings)):
  every layer adds to it, none removes from it, and a value that is not a list of globs is refused, so a typo never
  drops it.
- `connectors`: which registered connector serves each extension point ([Plugins](#plugins); the engine's swappable
  parts are connectors, `GLOSSARY.md`). Before #232 this map was called `plugins`; a `plugins` that holds a map is
  still read as the connectors for one release, and `config show` and `config check` warn about it. Both at once is
  refused.
- `plugins`: the Claude Code plugins the project installs, each `name@marketplace`, in order, each name once
  ([docs/DESIGN.md](docs/DESIGN.md) section 5 "Plugins"). It is a locked key, so a user layer cannot drop or swap the
  process plugin. None listed means the engine runs alone, on its built-in process. **Today:** the list is checked and
  locked only; no plugin is fetched, pinned by hash or handed to a run yet (#232).
- `work`: `true` marks a work project. Once a layer sets it, no lower layer unsets it.
- `repoCommits`: `true` lets the factory commit the spec, the brief and the glossary to the product repo (P9 in
  [docs/DESIGN.md](docs/DESIGN.md)). It is off by default, and refused when `work` is `true`. **Today:** nothing
  commits them yet; the setting is only checked.
- `policy`: per write the coordinator may request, `tracker.comment`, `tracker.create` and `notify`, a `mode`
  (`allow`, `confirm` or `deny`) and a `cap` from 1 to 20 ([Writes](#writes)). What it leaves out keeps the default:
  `tracker.comment` allow 5, `tracker.create` confirm 1, `notify` allow 3. A `forge.write` policy is refused.
- With no file, the gate is forge CI and neither the ready check nor the verifier runs, and no write goes out. A file
  with none of `gate`, `verify`, `ready` and `egress`, such as the one `project init` writes, is read the same way
  for those. Once one of them is there, a file that is not valid stops `dispatch` with the reason, so a typo never
  turns a local gate into forge CI.

### Settings layers

The project file is one of three settings layers, all in the factory home and never in the repo (#229;
[docs/DESIGN.md](docs/DESIGN.md) section 5 "Settings"). They are resolved on this host each time a project file is read,
so before every run, and no run's agent is handed them. The coordinator's deny list covers each of them:
`$FACTORY_HOME/user.json`, `$FACTORY_HOME/teams/**` and `$FACTORY_HOME/projects/**`, and the orchestrator refuses to
start while one is missing (`wallProblems`).

| layer | file | holds |
|---|---|---|
| team | `$FACTORY_HOME/teams/<team>/team.json`, a git clone, read at the commit the project pins | the project file's keys, plus `"modes": {"<key>": "locked" \| "default" \| "open"}` |
| project | `$FACTORY_HOME/projects/<project>.json`; `"team": "<team>@<full commit>"` pins the team | the keys above |
| user | `$FACTORY_HOME/user.json` | the same keys |
| machine | the `FACTORY_*` variables | the keys `config show` lists with an `env` source; the files may set them too, at the dotted name, such as `"caps": {"usdPerRun": 2}` |

Every key has a class, fixed in code (`src/core/settings/keys.ts`):

| class | rule | keys |
|---|---|---|
| ladder | the strictest value wins | `policy.<write>.mode` (allow, confirm, deny), `dryRun`, `work`, `repoCommits` |
| cap | the lowest value wins | `ready.timeoutMinutes`, `policy.<write>.cap`, `caps.*`, `eval.judgeUsdPerRun`, `implementer.minutes`, `implementer.stallMinutes` |
| allow-list | the team's entries stay; a lower layer adds only where the team marks the key `open` | `ready.programs`, `egress.allow` |
| deny-list | all layers add | `ready.testFiles`, `ready.judgeFiles`, `lanes.oneWayDoor` |
| locked | the highest layer that sets it wins | `gate`, `verify`, `connectors`, `plugins`, `approval.floor` |
| preference | the lowest layer wins | the models, `claimLabel`, `quietMinutes`, `poll.minutes` |

- A lower layer that loosens a safety key (any class but preference) stops the read, and so the run, with the key, the
  layer, its `file:line` and the team value. A team `locked` mode holds on any class.
- `approval.floor` is the engine's: no lane above tiny starts without a human approval, and no layer can change it.
- An unknown key is a warning with "did you mean" for one release, then an error.
- With no team pin and no user file, every value is the project file's own, as before the layers.
- `agent-factory config show <project>` prints each key's value, layer, `file:line` and class; `config check <project>`
  resolves the layers, runs the project file's checks on the result, and exits 0 or 1; `team update <project>
  [<commit>]` shows what the team's new commit (default: its clone's `HEAD`) changes, checks it, then moves the pin.
  Fetch the team's clone yourself first; nothing here uses the network.
- The machine layer is the lowest: a variable may make a team's cap lower, never higher. `dispatch`, `review` and
  `start` resolve the project's layers once before the run, print each warning, and refuse to start on an error, so a
  team's `caps.usdPerRun` is the most each model run of the project may spend (#254). `poll` and the loop commands
  name no project, so they resolve the user and machine layers only; `lint-edit` reads no setting.
- Every module reads a machine key through `src/core/settings/machine.ts`, never its variable;
  `test/settings-read.test.ts` fails on a direct read.

### The box image

Each project's box runs an image built on this machine, never pulled (#113):

```bash
agent-factory box build <project>
```

It packs this package with `npm pack` and builds the base image with it installed (`images/factory-box`: Ubuntu
24.04, Docker, Node 22, the agent CLIs, `agent-factory`), then, if
`$FACTORY_HOME/projects/<project>/box.Dockerfile` exists, the project's own layer on top of it, and pins the result's
ID in `$FACTORY_HOME/projects/<project>/box.json`. The dispatcher runs exactly that ID. A project Dockerfile must end
on the base:

```dockerfile
ARG BASE
FROM ${BASE}
RUN apt-get update && apt-get install -y --no-install-recommends openjdk-21-jdk-headless
```

Run it again after an upgrade of `agent-factory`, so the box runs the same version as the host. In a checkout, run
`npm run build` first: a package with no `dist/cli.js` is refused. Both images are tagged by their ID (`factory-box-base:<12 hex>`,
`factory-box-<project>:<12 hex>`), so `docker image prune` keeps them.

After the first build on the VM, prove that no host variable reaches the box (#181). In a checkout of this package, as
the user that runs the dispatcher, run:

```bash
FACTORY_TEST_BOX_IMAGE="$(jq -r .image "$FACTORY_HOME/projects/<project>/box.json")" npx vitest run test/vm-box-real.test.ts
```

It plants a canary and a `GH_TOKEN` in the host environment, runs `env` in a real box, and fails if either one, or any
secret-like name the box was not given, is there. Where there is no image or no Sysbox, it is skipped and says why.

## Run the loop

**You own the conversation, never the code or the queue.** You are the **coordinator**: the one AI the human talks
to. Writers and reviewers are fresh **workers** that the **dispatcher** (code, no LLM) starts. Each does one job on one
story and goes away. The forge is your only memory. In the target you run only the read commands, `agent-factory status`,
questions and status to Jira or the issue through `agent-factory request` ([Writes](#writes)), and
`agent-factory confirm` behind the person's yes; you never run `agent-factory approve`, `agent-factory start` or
`agent-factory waive` or `agent-factory eval`, which are denied to you: the human runs them (#227, #231, #215). You edit and write only spec drafts in
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
  the report. The host decides from the report only after the box has stopped, never through a symlink, and refuses to
  push when any new commit touches `.factory` (`excludeFactory` keeps it out of `git add`). While the writer runs, the
  host looks for a report the schema accepts every 5 s; once one is there, the writer has a 60 s completion window. A
  writer still running at its end (a child such as `gh` or an MCP server can keep it from exiting) is stopped, and the
  run is decided from its report, read again after the stop; its note then says the writer hung, and so does the run
  record (#182). The box's own timeout firing inside the window counts the same. A run with no valid report waits out
  its timeout and is `blocked`; past the timeout and a 30 s grace the host stops the box itself, since the box's
  timeout stops counting once `claude` exits and a child holding stdout open would keep the pass waiting. The window's
  edge is not exact: a run that exits as the window closes may still read as hung.
  The writer streams its output (`--output-format stream-json`). A run with no valid report that prints nothing for
  the stall time (`FACTORY_WRITER_STALL_MINUTES`, 5 minutes) is stopped and `blocked`, so it goes to `needs-human`;
  its note shows its last five output lines, each cleaned by `post.ts` (#228). Time the machine spends asleep does not
  count: each 5 s poll adds at most 10 s of silence.
  The host reads the stream's last line, the result event, for the run's cost and tokens (`total_cost_usd` and every
  `usage` token, cache reads and writes too), and keeps them as `spend` on the run's `writer-ended` record; a review
  round's `review-ended` record keeps what its passes spent the same way (#131). A run stopped before its result event
  has no `spend`: `usage` counts it as unmeasured, never as free. The dollar figure is the CLI's own; on a
  subscription it need not be what you are charged, so count tokens there (an open check on #131).
  Every writer prompt also says to run subagents and commands in the foreground and wait for them (#192, `FOREGROUND`
  in `src/core/writer/step.ts`), so nothing is left in the background when the run ends.
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
   show them the spec hash and the design hash (`none` with no `design.md` beside the spec), and ask them to run
   `agent-factory approve <project> <ticket> <spec hash> [<design hash>]` in their own terminal. You cannot run it: it
   is on your deny list (#227). It records a local approval bound to both hashes; an edit of the spec or the design
   makes it stale, and `agent-factory approval <project> <ticket>` then says so ([review 3](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6682553870)). A `/approved` note on the MR
   counts for nothing. A tiny-lane ticket needs no approval: the human's `agent-factory start <project> <ticket>` is
   enough.
5. **Run the queue.** Follow the triggers below. Done when the MR is merged or carries `needs-human`.
6. **Retro.** After about one merge in ten, turn each lesson into a rule change, strongest fix first: architecture →
   types → lint → test → docs. Read `tokens.sh <mr>` for what each phase cost. In the pilot, compare it with one
   `/crq` session on a like change at the same budget; a phase that does not change outcomes is retired.

### Triggers

The dispatcher's decision table is code: [`src/core/dispatch/table.ts`](src/core/dispatch/table.ts) (#103, ADR-0012 S3,
[review 9](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6682943767)). Its header lists every row and every stop; the code is the source of truth. `agent-factory dispatch
<project> --once` runs one pass: it decides each ticket with a START or an approval record (and each change on a
`factory/<ticket>` branch),
posts and labels as the project's identity, and starts at most one run. Run it from launchd or cron every few
minutes; a lock keeps two passes apart, and `--dry-run` prints the decisions and acts on none. Each pass keeps its
records in `$FACTORY_HOME/runs/<project>/<ticket>.jsonl`, so a restart loses nothing: a run that started and never
ended goes to a person. A ticket's change is the one on `factory/<ticket>` in this repository; a fork's branch of that
name is ignored, and two changes on it go to a person. Two rules hold over every row: a wait on a claimed change that
has been quiet (no record, no comment) for `FACTORY_QUIET_MINUTES` releases the claim; and a stop that went to a person
(`needs-human`, the claim released, one note) is not posted again when the label is removed: to go on, the human
STARTs again or approves the spec again; the newer of the two records starts every count afresh (#227). The build
begins only on a human's word: a START in the tiny lane, a START and an approval in the others. An approval with no
START waits, since nothing runs without one. Each approval also gets one shared copy on the ticket's PR, posted by the project's identity ("approved by … via …, spec …, design …"); it is for
people to see and starts nothing. The pass refuses to start while the coordinator's settings are missing or looser than
its wall (#105). A failed ready check, a review with Act on findings and a failed local verifier
each record when the writer may try again (`nextTry`, #228): 10 s after the step's first failure, doubling each time,
never more than 5 minutes; until then the pass waits on that ticket, and the caps still hold. The ready check first runs the floor guard (#190, #231): it reads the change's diff
from its merge base with the default branch, on the host and with git only, and fails the check at once, with each
`file:line`, when the diff lowers the bar (VB6, CR4). The test checks (S1–S4):
- a test file deleted, or moved out of the test files (a move inside them is followed), or fewer test cases in a test
  file that stays (`@Test` and its kin, a Spock feature, `it(`, `test(`, `def test_`, `func Test`; a renamed case is
  silent);
- a skip or focus marker added in a test file (`@Disabled…`, `@Ignore…`, `@Requires({ false })`, `.skip`, `.only`,
  `xit(`, `fit(`, `pytest.mark.skip`, `xfail`, `t.Skip` and the like);
- more assertion lines removed than added in a test file (`assert…`, `expect(`, `assertThat`, `verify(`, Go's
  `t.Error` and `t.Fatal`), every statement of a Spock `then:` or `expect:` block counting;
- a judge file added, changed, moved or deleted: a build file or dependency manifest, a file the project's `verify`
  command names or its program reads (`Makefile` for `make`, `package.json` for `npm`), jest, vitest or playwright
  config, `junit-platform.properties`, `pytest.ini`, `conftest.py`, and the project's `ready.judgeFiles`.

and the code checks:
- a suppression added with no reason comment on the line above (`@SuppressWarnings`, `eslint-disable`,
  `@ts-ignore`, `NOSONAR`, `noqa` and the like), in any file;
- a `catch` or `except` left empty: added so, or with its body removed.

A test check hit goes to a person at once (`needs-human`, with the hits listed), never back to the writer; a code check
hit sends the writer back like any failed ready check. A person who agrees with a test check hit runs
`agent-factory waive <project> <ticket> <head>` and removes `needs-human`: the ready check runs again at that head and
clears it. On a later head the test checks look again only at the files changed since the waiver's head, so a cleared
file is flagged again only if it changes again. A line only moved or re-indented is not new, and a submodule bump is not read. A guard that cannot read the diff
or the waiver fails the step, so the check is never passed and a person looks. The guard counts assertions per file, so swapping one for a trivial one, or moving assertions to another file,
fools it or fails it; and Spock `where:` rows are not counted.

The ready check then reads the lane the real diff needs, the same way (#230; `src/core/ready/lane.ts`): only docs,
comments or the values of config keys that stay may be tiny; any other change, a moved file among them, needs at least
bug; a path under the project's `lanes.oneWayDoor` needs the one-way door. The lane is only ever raised: a diff that
needs a heavier lane than the one a human approved, or STARTed in the tiny lane, goes to `needs-human`, and the way on
is a raised `## Lane` in the spec and a human's approval of it. The same check runs before the build, on the spec's
`## Planned files`: a planned file under a one-way-door path holds the ticket until the spec is raised and approved.
Every lane above tiny needs an approval (the approval floor); a lanes value from a plugin or a settings layer that
drops it is refused (`lanesOf`). **Today:** a config file's change counts as values when its changed lines keep the
same keys, so a dependency's major bump in `package.json` still reads as tiny; the automated review's LN2 check is
what catches it. Each acceptance criterion must also have an evidence row: the n-th criterion is `AC-n`, and a row
names it when its `criterion` starts with that id; a criterion with no row fails the check and counts towards its 3
tries. Then it runs each evidence row of the writer's report again at the head,
and the local verifier the project file's `verify`, each in a fresh box with no forge token and its egress through the
project's own proxy; nothing of the branch runs on the host. Each box run starts that proxy afresh, inside the
project's lock. The dispatcher opens the vm box when `FACTORY_BOX=vm`, `box.json` and `egress.allow` are set; otherwise
the writer, the ready check and the verifier say what is missing and wait. The writer runs a ticket's `test-first` and
`fix` runs in the box, on a fresh clone of the branch (or of the default branch on a first run), and the host pushes
and posts what it committed. A `rework` or `ci` run (#171) works the same way, with its task in a read-only
`.factory/task.md` of at most 20,000 characters, all from the host, because the box has no forge login:

| the run is for | `.factory/task.md` holds |
|---|---|
| a failed ready check | why it failed at the head (the evidence row that failed, with the last 200 lines of its stdout and stderr, the acceptance criteria with no row, or the floor guard's `file:line` hits), kept at `.claude/runs/<change>/<head>/ready.txt` before the result is recorded |
| an open Act on | the review's own Act on findings, kept at `.claude/runs/<change>/<head>/act-on.json` before it posts them; never a forge thread |
| red forge CI | each failed job's name and the last 200 lines of its log, for the first 3 jobs (GitHub check runs and statuses, GitLab pipeline jobs) |
| a failed local verifier | the verifier's own output, kept at `.claude/runs/<change>/<head>/verify.txt` before it posts the status |

When the host cannot build the task (nothing kept at the head, or red CI with no failed job named), it says so on the
change and labels it `needs-human`. `dispatch` also does these rows: reconcile a merged claim,
release a claim on a missing or stale approval or a quiet one, leave alone a change someone else claimed, and hand to a
person an unknown pipeline state or two changes on one branch. For each approved ticket it says which run it would
start. Run the table below by hand for the rest.

A change that does not merge into its target (`poll` shows `conflict=yes`) sends the implementer on a merge run (#103):
the host fetches the default branch into the run's clone as `origin/<default>`, the implementer merges it in and
resolves the conflicts, and the host pushes the merge as a fast-forward. Nothing rebases or force-pushes. A change that
still conflicts after that one merge run goes to a person. `conflict=unknown` (the git host has not checked yet) has
no row. Each pass that polled writes its last-poll time to `$FACTORY_HOME/runs/<project>/last-poll.json` (a dry run
does not), and `agent-factory status` puts "orchestrator last ran N min ago" at the head of its line, flagged `LATE`
when that is more than 3 poll intervals (`FACTORY_POLL_MINUTES`) ago while any change is claimed: a stopped cron or
launchd job shows up there, instead of claimed changes that just sit. Flaky jobs are not yet rerun with failure
signatures (#132): red CI sends the writer back.
The order is fixed: writer done → ready check → reviewer → gate → human ([gap 2](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6681560750)).
Poll the forge about every 5 minutes. Limits: one run per MR, at most `FACTORY_MAX_RUNS` at once, and at most one
heavy run (a build, an IT suite or a deploy) per machine.

| when the forge shows | do |
|---|---|
| the MR's ticket is approved (`agent-factory approval <project> <ticket>` exits 0), with `asks=0`, `needs_human=no` and no `stop` newer than the approval | `claim`, `start-writer`, `status "writer started"`; for a bug, `start-writer --test-first` first |
| a bug's test-first run ended with a pushed `test:` commit and `asks=0` | `start-writer` for the fix |
| the writer's report is `done` and the host pushed and posted it (**today:** the bash writer marks the MR ready instead) | the ready check runs its evidence rows at the head in a box, then `agent-factory review <project> <mr>` |
| an open Act on thread, or the gate is red, with `needs_human=no` | `start-writer` again; after 3 rounds, label `needs-human`; a flaky job gets a rerun, not a writer |
| the evidence fails at the head | `start-writer` again; after 3 failures, label `needs-human` |
| the project's gate is `local` and the verifier has not run at this head | the local verifier runs `verify` in a box and posts `agent-factory/verify` at the head; it failing sends the writer back, as red CI does |
| the gate is green and no Act on is open | assign a maintainer, `status "ready"`, ping the human; **never undraft**: only a human undrafts, and zero findings is not a pass ([Q5b](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6681168344)) |
| the MR is merged | retro (step 6, about one in ten); sweep the worktree |
| a run is silent too long, hits a cap, or fails | `block <mr> "<reason>" <log>`: `needs-human`, a `[coordinator] blocked:` note with the reason and log, and the claim released |
| you restart | `reconcile`: every claim without a live run goes back to the queue |
| `poll` shows `stop=<time>` newer than the ticket's approval (a maintainer's `/stop`), or a human pushes to the branch | stand off that MR; approving again lifts the stop |
| a merge conflict (`conflict=yes`) | `dispatch` sends the implementer to merge the default branch in; if it still conflicts, `needs-human`. Never rebase or force-push |
| a claimed MR with no live run has a stale approval (`agent-factory approval` exits 3) or `asks` above 0 (a `[coordinator] OPEN:` or a `[writer] OPEN:` note) | `release` it and take the next approved MR; `claim` it again when the human answers |
| the usage limit is near | pause every run |

Act only on people's notes. A note is the factory's own when it comes from the factory's login and starts with a
seat prefix; such notes are output, not triggers.

### Scripts

You decide; the scripts act. Each takes one command and prints one line. On GitHub, read "pull request" for "MR"
and `#12` for `!12`.

| script | does |
|---|---|
| `agent-factory poll` | one line per open MR: head, draft, claimed, pipeline, `needs_human`, `stop`, open asks, `conflict` (`yes`, `no`, or `unknown` while the git host has not checked); plus each merged MR that still carries the claim; `--json` prints the records |
| `agent-factory claim <mr>` / `agent-factory release <mr>` | adds or removes the claim label; `claim` refuses an MR already claimed or not open; `release` of an MR with no claim says so and is not an error |
| `start-writer.sh [--test-first] <mr>` | starts a fresh writer in its own worktree at the MR head; refuses an MR with a live run, and a machine at its run limit; replaces a dead run's worktree only when it holds nothing to land, and refuses one with uncommitted files, commits no remote branch has, or that git cannot check (#189: `reconcile` hands it to you); `--test-first` starts a run that commits only a bug's failing test and stops |
| `agent-factory review <project> <mr>` | one review round on a claimed MR: the context pack; the same patch-id as the last round reuses its verdict with no model run (with Act on still open, `needs-human`); after 3 rounds it refuses; then a find pass and one verify pass per kind, each a fresh read-only `claude -p` in a throwaway folder with the pack and the code at the head and no rule file; one thread per Act on and Consider; the status box; one summary note, last. It refuses an MR that already has a live writer or reviewer, and a machine at `FACTORY_MAX_RUNS`, and holds `.claude/runs/reviewer-<mr>.pid` while it runs. A change that touches a file whose name holds a control character is refused, for a person to review. Exit 0 posted, reused or nothing to do, 3 when the head moved (nothing posted), 1 otherwise. Each pass's answer is kept under `.claude/runs/<mr>/<head>/` |
| (context pack) | built by `review`, one per head, under `$FACTORY_REPO/.claude/packs/`: rules from the default branch only; an unresolved rule pointer or link stops it. The intent and acceptance criteria come from the approved spec of the ticket the MR's `factory/<ticket>` branch names, read from `<home>/specs/<project>/` and checked against `<home>/approvals/<project>/`; the design from that spec's `## Design` link, as the default branch holds it. A spec edited after approval, or never approved, is named in the pack for the reviewer to report; no spec in the store stops it. The MR description is data in the pack, never the contract |
| `agent-factory status <mr> <sha> "<line>"` | posts one `[coordinator]` note through the posting template; refuses when the head is no longer `<sha>`, and a line that is not one line of text. The line it prints starts with "orchestrator last ran N min ago", flagged `LATE` after 3 poll intervals while any change is claimed (#103) |
| `agent-factory ask -- <mr> <sha> "<question>"` | **today** the writer's one way to reach the human: posts one `[writer] OPEN:` note; refuses when the head is no longer `<sha>`. `--` keeps a question that starts with `-` a question. The target: the writer writes the question to `report.json` and the host posts it |
| `agent-factory spec <project> <ticket>` | checks a ticket's local spec (`$FACTORY_HOME/specs/<project>/<ticket>/spec.md`, default `~/.factory`) against the template: prints its hash and the design's (`design none` with no `design.md` beside it), or every missing part (intent, numbered acceptance criteria, design, lane); an optional `## Planned files` lists the paths the change will touch, one per line, for the lane check before the build (#230); `--template <ticket>` prints an empty one. The hash ignores line endings and trailing spaces, and changes on any real edit ([review 3](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6682553870), #127) |
| `agent-factory start <project> <ticket> [--yes]` | records a human's START in `$FACTORY_HOME/starts/<project>/<ticket>.json`: who, the front door (`via`) and when. It opens the ticket; in the tiny lane it also lets the build begin. When `factory/<ticket>` is already on the git host it asks first (exit 3), and `--yes` starts anyway. A human runs it; the coordinator's settings deny it (#227) |
| `agent-factory approve <project> <ticket> <spec hash> [<design hash>]` | records the human's approval in `$FACTORY_HOME/approvals/<project>/<ticket>.json`: the spec's full hash, the design's (`none` when there is no `design.md` beside the spec), who, the front door and when. The hashes on the command line are the ones the human saw, as `agent-factory spec` printed them; a spec or design that no longer has exactly that hash is refused. A human runs it; the coordinator's settings deny it ([review 3](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6682553870), #104, #227) |
| `agent-factory waive <project> <ticket> <head>` | records the human's waiver of the test checks in `$FACTORY_HOME/waivers/<project>/<ticket>.json`: `kind: "test-change"`, the full commit id of the head the hits were listed at, who, the front door and when. The ready check clears the test check hits at that head; on a later head it looks again only at the files changed since, so a cleared file is flagged again only if it changes again. A waiver given again replaces it. A human runs it; the coordinator's settings deny it (#231) |
| `agent-factory request <capability> --file <draft.json>` | asks for a `tracker.comment`, `tracker.create` or `notify` write on an approved ticket; the project's policy performs it at once (0), keeps it for `confirm` and prints that command (3), or refuses it (1) ([Writes](#writes)) |
| `agent-factory confirm <id> '<text>'` | performs a kept write when the text is the one `request` printed; run it only through the harness `ask` prompt |
| `agent-factory approval <project> <ticket>` | whether work may start: `approved` (exit 0), `stale` when the spec changed after approval (3), `missing` (4), or a broken record or spec (1); `dispatch` reads the same record |
| `agent-factory dispatch <project> --once [--dry-run]` | one pass of the dispatcher's table over the project (see Triggers); exit 0, 1 when it cannot run, 2 when an action failed |
| `agent-factory usage [<project>]` | what the dispatcher's runs spent, from the run records: today, the current window (the last `FACTORY_WINDOW_HOURS`) and this month, in dollars and tokens, for all, each project and each ticket. Days and months are UTC. `+N?` is N runs with no spend reported, not in the sums. A review or eval run by hand writes no run record, so it is not in it (#131) |
| `agent-factory block <mr> "<reason>" [<log>]` | labels `needs-human`, posts one `[coordinator] blocked: <reason>` note with the log as a field, then releases the claim; the label goes first |
| `agent-factory lint-edit '<command>'` | the writer's hook, not yours: lints each file an Edit or Write changed and shows the writer what failed. The command runs with no shell; one that needs a shell is reported to you and holds no writer |
| `tokens.sh <mr>` | the tokens one MR spent, by phase (writer, find, verify), from the records kept per head; reads no forge |
| `agent-factory reconcile` | removes each claim and run worktree with no live run, and each claim left on a merged MR; a live-run list it cannot read releases nothing. It never removes a writer's worktree that holds unlanded work (#189): commits no remote branch holds, after a fetch, or uncommitted files. For an open MR it labels `needs-human` before any claim is released, pushes the commits on top of the MR's branch through the host push, with a blocked run's guards (fast-forward only, no `.factory`, no CI file), and posts one note naming the commits, the push and every uncommitted file, which it never commits. It tells you once for what the worktree holds, until that changes. A merged or closed MR gets no label and no push. A folder that is not one of the clone's worktrees, or a worktree it cannot fetch for, is kept and labels nothing. A reviewer's worktree is removed as before. `FACTORY_DRY_RUN=1` fetches nothing and says which it would keep |

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
conflict a writer could not merge, a standing rule that contradicts what you see, and anything irreversible. You
keep the conversation and the open questions. The dispatcher keeps polling, claims, retries of flaky jobs, and
starting and restarting workers. **Today** you keep those too, until it exists.

## Guardrails

Read each line as a claim. **Enforced** means a script stops it today. **Decided** means
[ADR-0012](docs/adr/0012-safety-design-for-unattended-runs.md) chose it and a ticket under #30 builds it. Until then,
it is a prompt instruction at most.

- **Decided: workers run in a box.** No forge token, network only to the model API and registries; the host pushes
  and posts ([Q1](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6680836108)). The dispatcher's writer runs so (#113). **Today:** the bash `start-writer` still runs
  unsandboxed, as you, with the bot's login.
- **Decided: no skip-permissions on the laptop**, an allow-list instead; config never from the branch
  ([Q6, Q7](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6681210370)).
- **Decided: zero findings is never green.** Only a human undrafts. Every PR gets a script-made box of protected files
  and new dependencies ([Q5b](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6681168344)).

- **Code goes to a writer, always.** The coordinator never edits code. (A prompt rule today; the target allow-list
  enforces it.)
- **START, approval and merge are the human's.** An approval is `agent-factory approve`, which records the spec's and
  the design's full hashes; a note on the MR approves nothing, and the bot cannot merge the protected branch. In the
  coordinator's settings `approve` and `start` are denied, not asked, so the AI can never run them, and the dispatcher
  refuses to start while those settings are looser (#227, #105). **Today:** on a laptop the AI runs as you, so the deny
  list is not a wall there; your merge review is the hard gate (accepted risk, #30).
- **Today: the writer pushes only its own branch**, with `--force-with-lease` after a rebase. On GitHub its session
  gets an empty `GH_CONFIG_DIR` and no system or global git config, so it cannot act as the person. This is a prompt
  rule plus a missing login, not a wall; the target removes the forge token from the writer.
- **Decided: ready is checked, not reported.** No review starts until code has run the change's evidence commands
  again at its head, in a fresh box ([ADR-0012](docs/adr/0012-safety-design-for-unattended-runs.md) S5, #91), with no
  shell and only the programs the project file lists. The dispatcher runs it in the vm box once the box and `egress.allow` are
  set up; until then it waits, and by hand you run the evidence yourself first.
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
- **Enforced: the writer loads no settings from the branch, and never changes them** (#110). Its `claude -p` runs with
  `--setting-sources user`, so the branch's `.claude/settings.json` (hooks, `env`, permissions), `.mcp.json`,
  `CLAUDE.md` and skills are not loaded; the rulebook (`--plugin-dir`) and the host's `.factory/settings.json` are. The
  writer's prompt tells it to read the project's `AGENTS.md`, `CLAUDE.md` and skills as it reads the code. The root
  `.claude/`, `.agents/`, `AGENTS.md` and `CLAUDE.md` are read-only in the box when the branch has them, and the host
  push refuses a commit that adds or changes one ("touches the agent's settings", `src/core/agent-settings.ts`). As
  for CI, a version equal to the default branch's passes, so a merge of main is fine. A person makes that change in
  their own commit.
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
| **Coordinator** | the one AI session that talks with the human and plans; it never approves or STARTs (both commands are denied to it, #227), and in the target it starts no workers |
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
