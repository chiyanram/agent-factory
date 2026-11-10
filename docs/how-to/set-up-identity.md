# Set up identity

The factory pushes and posts with a git host login that **only code uses**: the orchestrator and the host push. No
model holds it ([ADR-0012](../adr/0012-safety-design-for-unattended-runs.md) S14, [review 2](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6682431737)). Which login is set per project:

```
work (default)  orchestrator + host push ──▶ your own gh / glab login ──▶ pushes branches, opens PRs, comments
personal (opt.) orchestrator + host push ──▶ a bot: GitHub App <slug>[bot] or GitLab service account
human           agent-factory start · approve · waive (local records) · reviews · merges with your own account
```

Agent text is marked by content, not by author: every post starts with `[writer]`, `[reviewer]` or `[coordinator]`
(the implementer's, the automated review's and the coordinator's prefixes, which keep their names until #144 phase 4),
and agent commits carry an `Agent: <seat>` trailer that names the role. The implementer gets it from a
`prepare-commit-msg` hook in its clone, mounted read-only, and the host push refuses an implementer commit without it (#128). With your own login
(`FACTORY_IDENTITY=own`, the default) there is nothing more to set up; the steps below are for a project that uses a
bot. A bot's key belongs to a separate
`factory` OS user on the VM, never to a file your own user can read.

No implementer holds a git host login: the implementer runs only through `agent-factory dispatch <project>`, on a
runner, and the host pushes and posts for it. The bash `start-writer`, which gave it one, is gone (#138).

## GitLab

| # | who | step | why |
|---|---|---|---|
| 1 | group owner | Create the service account `agent-<name>` (Group → Settings → Service accounts). | Free since GitLab 18.11, up to 100 per top-level group, and it takes no paid user. |
| 2 | group owner | Add it to the project as **Developer**. | It can push branches, open PRs and comment. |
| 3 | group owner | Protect `master`: merge = Maintainers, push = no one. | An agent cannot merge into `master`. |
| 4 | developer | Create a token for the account: scopes `api` and `write_repository`, expiry 365 days. Store it in glab's config with `glab auth login`. Never put it in an environment variable. | Agents never handle tokens. An environment variable leaks to every child process. |
| 5 | developer | Set the git author for agent commits to `agent-<name>`. Every agent commit carries `Co-authored-by: <developer>`. | The human and the agent are both on the record. |
| 6 | developer | Set a reminder two weeks before the token expires. | An expired token stops every agent of that developer. |

## GitHub

On GitHub the bot is a **GitHub App** that the developer's own account owns. It posts as `<slug>[bot]` and has no
login, email or password. Its private key belongs to the `factory` OS user. Your user gets a one-hour token through one
sudo rule, and never reads the key ([#108](https://github.com/chiyanram/agent-factory/issues/108)).

```
orchestrator, poll, host push (your user)
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


## Both git hosts

- Every agent post starts with its role's prefix: `[coordinator]`, `[writer]` (the implementer) or `[reviewer]` (the
  automated review).
- A ticket's first implementer run opens its change: after the first push of `factory/<ticket>`, the host opens a draft
  change onto the default branch, as the project's identity. Its title is the spec's title and its body names the
  ticket; the spec's text stays local. A change already open from that branch is reused, never doubled; two are left
  to you ([#164](https://github.com/chiyanram/agent-factory/issues/164)). The implementer step (#113) does this on a first run that
  committed; a first run that committed nothing opens no change, and the run's record says so.
- On agent branches, CI runs test jobs only, with no secrets. An agent never changes CI: the host push refuses it, and
  the work is blocked with "touches CI config" and the files named (`src/core/ci-files.ts`, #115). The CI files are
  `.github/workflows/**`, `.github/actions/**`, `.gitlab-ci.yml` or the file the project's GitLab settings name
  instead, and every file those include in this repository, at any depth, child pipelines (`trigger: include:`) too;
  a glob follows GitLab's rules. For each, the pushed commit's version must be the branch's before the push or the
  default branch's, so a merge or rebase onto the default branch passes, and an edited merge or a reset does not. A CI
  file that does not parse, an include it cannot read, or one that names a variable is refused. You make a CI change
  in your own commit ([review 8](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6682922264)). `rules:` in `.gitlab-ci.yml` is not a gate: the branch's own copy runs.
  The implementer (#113) runs on a runner and the host pushes, so the refusal applies to every implementer commit.
- The backstop, in case a CI change gets through anyway; set it up once per project:
  - GitLab: mark every secret CI/CD variable **Protected**, so a pipeline on an agent branch never sees it. Optional:
    point Settings → CI/CD → General pipelines → CI/CD configuration file at a file in a separate project you
    protect (`.gitlab-ci.yml@group/ci-config`), so the branch's copy is not the one that runs. The GitLab docs list it
    on the Free tier ([pipeline settings](https://docs.gitlab.com/ci/pipelines/settings/)). **Today:** not yet tried.
  - GitHub: keep secrets only in environments that need a person's approval, never as plain repository secrets;
    and give a bot App no **Workflows** permission (step 1), so it cannot push a workflow change at all.
  - Check the backstop by hand. `agent-factory setup` does not check it, because the factory's identity must not hold
    the right to read CI variables or secrets (#115).
- VM (`FACTORY_BOX=vm`): install Sysbox on the VM first ([#158](https://github.com/chiyanram/agent-factory/issues/158)).
  The runner runs its own Docker under `--runtime=sysbox-runc`, so its root is an unprivileged user on the VM. Without
  Sysbox the runner refuses to start; it never falls back to `--privileged` ([decision](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6704930024)).
  The image is `images/factory-box/Dockerfile`: git, Docker, Node 26 and the agent CLIs at pinned versions. A
  project's toolchain goes in its own `box.Dockerfile`, built `FROM` that image. `agent-factory box build` builds and
  pins it ([The runner image](check-the-runner.md#the-runner-image)).
- Work laptop (`FACTORY_BOX=srt`, #114): install the pinned sandbox runtime, `npm install --global --omit=optional
  @anthropic-ai/sandbox-runtime@0.0.82` (on Linux also `bubblewrap`, `socat` and `ripgrep`). Each implementer run, ready
  check and local verifier runs inside `srt` with one policy the factory writes per run: writes only in the run's clone
  and a private home, and the run's own temp folder `/tmp/af-<6 characters>` (`TMPDIR`; never `/tmp` itself, #62); your whole home hidden, but for the clone, the private home and, read-only, the folders `claude`
  and its Node are installed in (found from `PATH`, and the factory's own Node and package, for the lint hook), and the
  project's toolchain (below); the credential paths, the factory home and the Docker sockets denied by name as well; network only through srt's own
  proxy and the project's `egress.allow`; and no Docker socket. There is no Docker in the runner: container tests run on git host CI. A run
  refuses to start when `srt` is missing or is not that version. Run the laptop check once ([Check the srt
  runner](check-the-runner.md#check-the-srt-runner)).
  The project declares its toolchain in its own file (`mise.toml`, `.tool-versions`, `.sdkmanrc`), and the runner
  provides it (#371). When a `PATH` folder lies inside a known toolchain manager's install folder, srt allows that whole
  folder back, read-only: mise `~/.local/share/mise/installs`, SDKMAN! `~/.sdkman/candidates`, asdf `~/.asdf/installs`,
  nvm `~/.nvm/versions`. Never the manager's config (mise's `~/.config/mise` can hold `env` secrets) and never its
  shims. So put the real install folders on `PATH`: use `mise activate`, not `mise activate --shims`; with asdf, put the
  install's `bin` folder on `PATH`. A `PATH` that reaches a manager only through its shims gets a warning in `setup
  status`. Anything else goes in `srt.readOnly` (below). `setup status` lists each folder allowed back as a risk.
- Whoever started the work does not approve it. Write this rule down for the team; a git host on a free plan cannot
  enforce it.
- When a developer leaves, revoke the GitLab token and block the account, or delete the App's key or the App.
- Before the first run on a machine, open `claude` once in `FACTORY_REPO` and accept the trust prompt. Add
  `.claude/worktrees/`, `.claude/runs/` and `.claude/packs/` to the project's `.gitignore`.
- Give the implementer its quick tools in `docs/agents/commands.md` on the default branch, one plain line each (a fence
  around them is fine): `lint-file: <command>` runs on each file the implementer edits, with the file as its last word,
  and `test-touched: <command>` runs the tests it touched. Either may be left out. The file is read from the default
  branch, never from the change's branch, because the lint runs as a hook with no permission prompt. The host writes
  the hook into a read-only `.factory/settings.json` in the clone and starts `claude` with `--settings` on it; the hook
  runs `agent-factory lint-edit`, which the runner has because `box build` installs this package in it.

**Known gap (today).** The coordinator and the automated review's runs still run as the developer's OS user, so they
could read the token in glab's config or the App's key. The Developer role and the App's permissions limit what a
stolen credential can do. It is not a wall. The implementer already runs on a runner with no git host token
([Q1b](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6680836108), #113). The coordinator is held back by
deny rules only, because it runs as the same OS user ([ADR-0012](../adr/0012-safety-design-for-unattended-runs.md) S2).
