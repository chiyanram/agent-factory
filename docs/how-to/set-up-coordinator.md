# Set up the coordinator

The coordinator runs in its own folder, with its own settings, so it cannot widen its own wall and your other Claude Code
sessions are left alone ([#106](https://github.com/chiyanram/agent-factory/issues/106), ADR-0012 S2).

1. `agent-factory setup coordinator` writes `$FACTORY_HOME/coordinator/.claude/settings.json` and a `CLAUDE.md` that
   points at this guide, both mode 0444, and refuses a symlink in their place. Run it again after each upgrade.
2. `agent-factory coordinator` starts Claude Code there with `--setting-sources project`, so the allow rules of your
   own user settings do not apply; `agent-factory coordinator copilot` starts Copilot CLI with its command rules as flags (see Today below).

The wall (`src/core/coordinator.ts`):

- **Runs with no prompt:** `agent-factory poll`, `spec`, `approval` and `status`, and `agent-factory request`, whose
  write the project's policy decides in code ([Writes](../reference/connectors.md#writes)).
- **Asks you first:** `agent-factory confirm`, whose prompt shows the exact text of a kept write; your yes sends it. **Today:** the start commands
  too (`claim`, `release`, `block`, `reconcile`, `review`, `dispatch`, `setup`); they become denied once the
  orchestrator runs every step of the loop (#113).
- **Denied:** `agent-factory approve`, `agent-factory start` and `agent-factory waive`: the AI never approves, never
  STARTs a ticket and never waives its own test check hit, so you run them yourself in your own terminal (#227, #231).
  `agent-factory eval`: an eval pass spends on model runs (up to $100), and only a human starts one (#215).
  `agent-factory onboard`: the onboarder's run and the acceptance of its brief are a human's (#235). Then `gh`, `glab`, `git push`, `curl`, `wget`, `ssh`, a second interpreter or shell (`node -e`, `python`,
  `sh -c`, `bash -c`, `npx` and others), `sudo`, the App token's wrapper, `security`, `chmod`, `chown`,
  `agent-factory plugin`, `agent-factory project` and `agent-factory init`, which write settings. Editing any `.claude/`, the package, `$FACTORY_HOME/approvals`,
  `starts`, `waivers`,
  `projects`, `runs`, `secrets`, `coordinator`, `pending`, `writes`, `plugins.json` and `plugins`. Reading the
  secret paths: `~/.ssh`, `~/.gnupg`, the gh and glab logins, `~/.git-credentials`, `~/.netrc`, the cloud logins,
  `~/.docker/config.json`, `~/.npmrc`, `~/.m2/settings.xml`, `~/.gradle/gradle.properties`, the Keychain and the
  browser profiles, the factory user's home (`FACTORY_BOT_HOME`, default `/home/factory`) and every `.env*`.
- **Edits with no prompt** only spec drafts in `$FACTORY_HOME/specs`; any other edit asks you.
- Bypass and auto mode are switched off.

Check it once after setup: in the coordinator, ask it to read `~/.ssh/canary` (make an empty one first), a
project's `.env`, and to edit a file of the package and a project's `.claude/settings.json`; each must be refused. **Today:**

- Bash deny rules match a command as typed, and Claude Code's docs say they are no security boundary; the OS-level
  sandbox is not switched on, since `agent-factory status` posts with your own `gh` or `glab` login, which it would
  block (#114). A program the coordinator may run that reads files itself is not held by the Read rules.
- Copilot CLI has no read or edit rule by path, so under `agent-factory coordinator copilot` none of the Read or
  Edit denies above hold; only the command denies, and its folder plus `--add-dir`, do. The flags are not yet tried
  against a live Copilot CLI. Use Claude Code for the coordinator until they are.
- The read-only mode of the settings is no wall: your own user owns the folder, so the coordinator could rename or replace
  the file with a command its Bash rules do not name. The wall holds once the folder belongs to the `factory` OS user
  (ADR-0012 S2) or the sandbox is on (#114).
- The orchestrator does not yet refuse to start when these settings are loosened (ADR-0012 S2; #105).
- Jira and Dynatrace reads come with their connectors (#134); writes to them go through `request` ([Writes](../reference/connectors.md#writes)).
