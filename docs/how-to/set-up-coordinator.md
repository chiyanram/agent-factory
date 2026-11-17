# Set up the coordinator

The coordinator runs in its own folder, with its own settings, so it cannot widen its own wall and your other Claude Code
sessions are left alone ([#106](https://github.com/chiyanram/agent-factory/issues/106), ADR-0012 S2).

1. Run `agent-factory setup coordinator`. It writes `$FACTORY_HOME/coordinator/.claude/settings.json` and a `CLAUDE.md`
   that points at this guide, both mode 0444, and refuses a symlink in their place. Run it again after each upgrade.
   The orchestrator refuses to start while these settings are looser than the wall, and tells you to run it again and
   names what is missing. A coordinator session that is already open keeps the rules it started with: restart it.
2. Run `agent-factory coordinator [<project>]`. It starts Claude Code there with `--setting-sources project`, so the allow rules of your
   own user settings do not apply; `agent-factory coordinator [<project>] copilot` starts Copilot CLI with its command rules as flags (see Today below).
   It needs no `FACTORY_*` export (#382): the session is for the project you name, or the only one in
   `$FACTORY_HOME/projects`, and each command it runs (`poll`, `status`, `claim`, `release`, `block`, `reconcile`) reads
   that project's `gitHost`, `gitHostProject` and `clone` from its project file. With several projects and none named,
   it starts with no default, and each command names its project (`agent-factory poll ledger`). For the ledger pilot:

   ```bash
   agent-factory coordinator ledger
   ```

The wall (`src/core/coordinator.ts`):

- **Runs with no prompt:** `agent-factory poll`, `board`, `spec`, `approval`, `status`, `grill` and `retro` (not `retro --draft`, which spends on a model run and is denied), with or without the project word
  (`agent-factory poll ledger`), and `agent-factory request`, whose
  write the project's policy decides in code ([Writes](../reference/connectors.md#writes)).
- **Asks you first:** `agent-factory confirm`, whose prompt shows the exact text of a kept write; your yes sends it. **Today:** the start commands
  too (`claim`, `release`, `block`, `reconcile`, `review`, `dispatch`, `setup`); they become denied once the
  orchestrator runs every step of the loop (#674).
- **Denied:** `agent-factory approve`, `agent-factory start` and `agent-factory waive`: the AI never approves, never
  STARTs a ticket and never waives its own test check hit, so you run them yourself in your own terminal (#227, #231).
  Run them from a plain terminal, not as `!agent-factory …` inside Claude Code: the door seam refuses a person's word
  where `CLAUDECODE` is set ([ADR-0023](../adr/0023-front-doors-are-engine-commands.md)). `agent-factory door`: a front
  door writes a person's word, so the AI never runs one.
  `agent-factory eval`: an eval pass spends on model runs (up to $100), and only a human starts one (#215).
  `agent-factory onboard`: the onboarder's run and the acceptance of its brief are a human's (#235). Then `gh`, `glab`, `git push`, `curl`, `wget`, `ssh`, a second interpreter or shell (`node -e`, `python`,
  `sh -c`, `bash -c`, `npx` and others), `sudo`, the App token's wrapper, `security`, `chmod`, `chown`,
  `agent-factory plugin`, `agent-factory project` and `agent-factory init`, which write settings. `WebFetch` and
  `WebSearch`: outside context comes only through `agent-factory fetch` (ADR-0012 S18). Editing any `.claude/`, the package, `$FACTORY_HOME/approvals`,
  `starts`, `waivers`,
  `projects`, `runs`, `secrets`, `coordinator`, `pending`, `writes`, `plugins.json` and `plugins`. Reading the
  secret paths: `~/.ssh`, `~/.gnupg`, the gh and glab logins, `~/.git-credentials`, `~/.netrc`, the cloud logins,
  `~/.docker/config.json`, `~/.npmrc`, `~/.m2/settings.xml`, `~/.gradle/gradle.properties`, the Keychain and the
  browser profiles, the factory user's home (`FACTORY_BOT_HOME`, default `/home/factory`) and every `.env*`.
- **Edits** only spec drafts in `$FACTORY_HOME/specs`, with no prompt. A PreToolUse hook, `agent-factory edit-scope`,
  refuses every other Edit or Write before the rules are read, a `..` or a symlink that leads out of the drafts too;
  a deny rule cannot do it, since Claude Code lets no allow rule carve an exception out of a deny.
- Bypass and auto mode are switched off.

Check it once after setup: in the coordinator, ask it to read `~/.ssh/canary` (make an empty one first), a
project's `.env`, to edit a file of the package, a project's `.claude/settings.json` and a project's source file, and
to fetch a URL; each must be refused. If the edit of the source file asks you instead, the hook could not run (no
`node` on the session's PATH, or the package moved): run `agent-factory setup coordinator` again and restart the
session; a hook that cannot run falls back to asking, never to allowing. Where the wall does not hold yet:

- **Today:** Bash deny rules match a command as typed, and Claude Code's docs say they are no security boundary; the OS-level
  sandbox is not switched on, since `agent-factory status` posts with your own `gh` or `glab` login, which it would
  block (#674). A program the coordinator may run that reads files itself is not held by the Read rules.
- **Today:** Copilot CLI has no read or edit rule by path that we have tried, so under `agent-factory coordinator copilot`
  none of the Read or Edit denies above hold, nor the edit-scope hook nor the `WebFetch` and `WebSearch` denies; only
  the command denies, and its folder plus `--add-dir`, do (#493 tries its flags). The flags are not yet tried
  against a live Copilot CLI. Use Claude Code for the coordinator until they are.
- **Today:** the read-only mode of the settings is no wall: your own user owns the folder, so the coordinator could rename or replace
  the file with a command its Bash rules do not name. The wall holds once the folder belongs to the `factory` OS user
  (ADR-0012 S2) or the sandbox is on (#674).
- **Today:** Jira reads come with its connector (#566); writes to them go through `request` ([Writes](../reference/connectors.md#writes)).

## Claude Code plugins

Install a Claude Code plugin the coordinator needs at user scope only:
`claude plugin install <name>@<marketplace> --scope user`. Never use `--scope project` or `--scope local`, because
they write into the folder (a clone, or the coordinator's own) and override your user choice. An install can exit 0
and leave the plugin off, so the factory reads Claude Code's files back instead of trusting it (#555):

- `agent-factory config check <project>` prints each plugin it knows, today `discord@claude-plugins-official`, as on
  with the file it read, or as a warning that names the state and the fix: off, not installed, set at project scope,
  or a settings file it cannot read or that is not JSON.
- `agent-factory coordinator <project> --discord` refuses to start Claude Code while the Discord plugin is not on,
  and names the fix. The plain launch needs no plugin.

The coordinator starts with `--setting-sources project`, under which Claude Code loads no plugin enabled at user
scope, so the Discord launch also enables its plugin with `--settings`. The check is what makes that safe: `--settings`
cannot load a plugin that is not installed.

It reads `enabledPlugins` in `$CLAUDE_CONFIG_DIR/settings.json` (else `~/.claude/settings.json`), the user install in
`plugins/installed_plugins.json` beside it, and `.claude/settings.json` and `.claude/settings.local.json` in the clone
and the coordinator's folder (the launch reads only the coordinator's folder).
