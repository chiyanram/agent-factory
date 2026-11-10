# Guardrails

Read each line as a claim. **Enforced** means a script stops it today. **Decided** means
[ADR-0012](../adr/0012-safety-design-for-unattended-runs.md) chose it and a ticket under #30 builds it. Until then,
it is a prompt instruction at most.

- **Decided: runs execute on a runner.** No git host token, network only to the model API and registries; the host
  pushes and posts ([Q1](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6680836108)). Every implementer run does so (#113): the bash `start-writer`
  that ran one unsandboxed, as you, with the bot's login, is gone (#138).
- **Enforced: skip-all permissions only inside a runner** (`vm` or `srt`), never bare on the host; config never from
  the branch ([Q6, Q7](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6681210370), #114). The
  implementer's `.factory/settings.json` also holds its lists: allow Bash (inside the runner) and edits in the clone;
  deny `git push`, `WebFetch`, `curl` and reads of the credential paths. Claude Code keeps deny rules even with
  skip-all; the runner is the wall, the lists are the second line. **Today:** the automated review, the design review
  and the onboarder, which only read, still run on the host with Read, Grep and Glob, not in `srt` (#113).
- **Decided: zero findings is never green.** Only a human undrafts. Every PR gets a script-made status list of protected
  files and new dependencies ([Q5b](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6681168344)).

- **Code goes to an implementer, always.** The coordinator never edits code. (A prompt rule today; the target allow-list
  enforces it.)
- **START, approval and merge are the human's.** An approval is `agent-factory approve`, which records the spec's and
  the design's full hashes; a note on the PR approves nothing, and the bot cannot merge the protected branch. In the
  coordinator's settings `approve` and `start` are denied, not asked, so the AI can never run them, and the orchestrator
  refuses to start while those settings are looser (#227, #105). **Today:** on a laptop the AI runs as you, so the deny
  list is not a wall there; your merge review is the hard gate (accepted risk, #30).
- **Enforced: the implementer never pushes.** It runs on a runner with no git host login; the host pushes its branch
  for it through the host push (`src/core/push.ts`), with `--force-with-lease` against the head it saw (#113, #138).
- **Decided: ready is checked, not reported.** No review starts until code has run the change's evidence commands
  again at its head, on a fresh runner ([ADR-0012](../adr/0012-safety-design-for-unattended-runs.md) S5, #91), with no
  shell and only the programs the project file lists. The orchestrator runs it on the vm runner once the runner and `egress.allow`
  are set up; until then it waits, and by hand you run the evidence yourself first.
- **The automated review reads, and the script posts.** It runs in a throwaway folder (under `$FACTORY_HOME/review-runs/`,
  private to you) with the pack and a copy of the whole code at the head. It may report code the diff does not touch only when this change breaks it.
  Every `CLAUDE.md`, `AGENTS.md`, `.claude/` and `.agents/` is removed from that copy, so the PR cannot choose the
  rules it is judged by. It has Read, Grep and Glob only (`claude -p --restricted`), and an environment with no git host
  token and no `FACTORY_*` setting. **Today:** it runs on the host, not on a runner (#113).
- **Rules come from the default branch**, never from the PR. A PR that edits a rule file is flagged for the human.
- **Protected files go to the human.** A review round that finds a change to CI config, `CODEOWNERS` or agent
  instruction files lists them in its summary and labels the PR `needs-human`, once per file. The same script-made
  status list lists every build file and dependency manifest touched, and each new dependency (ADR-0012 S10, #117). Zero
  findings is not a pass: the summary says so, and no verdict ever approves or undrafts (#118).
- **No progress stops the loop.** When an implementer round leaves the change empty, or the patch unchanged while its last
  verdict still has Act on findings, `agent-factory review` reuses the verdict and labels the PR `needs-human`.
- **Decided: an agent never changes CI.** The host push refuses CI-file changes ([review 8](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6682922264)).
- **Enforced: the implementer loads no settings from the branch, and never changes them** (#110). Its `claude -p` runs with
  `--setting-sources user`, so the branch's `.claude/settings.json` (hooks, `env`, permissions), `.mcp.json`,
  `CLAUDE.md` and skills are not loaded; the rulebook (`--plugin-dir`) and the host's `.factory/settings.json` are. The
  implementer's prompt tells it to read the project's `AGENTS.md`, `CLAUDE.md` and skills as it reads the code. The root
  `.claude/`, `.agents/`, `AGENTS.md` and `CLAUDE.md` are read-only on the runner when the branch has them, and the host
  push refuses a commit that adds or changes one ("touches the agent's settings", `src/core/agent-settings.ts`). As
  for CI, a version equal to the default branch's passes, so a merge of main is fine. A person makes that change in
  their own commit.
- **Enforced: host git runs no planted program.** Every git call the factory makes on a project's clone goes through
  `hostGit` (`src/core/git.ts`): hooks, `core.fsmonitor`, filter and diff drivers, `sshCommand`, credential helpers
  and the rest come from your own system and global config only, never from the repo's. A repo whose own config
  sets an external diff, a merge driver, a URL rewrite or an `http.*` setting is refused (#87,
  [review 5](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6682642355)). **Decided:** the git
  control files are also read-only on the runner (#110).
- **Decided: the implementer reads only what it is given.** A private home per run; the coordinator gets a deny list on
  secret paths ([review 6](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6682837531)).
- **Decided: posted agent text cannot act.** The host posts only templated text: no line starts with `/`; `@`, `#`,
  `!`, `://` and `www.` are broken with an invisible joiner, so nothing pings, links, references or closes; Markdown
  and Jira markup characters are escaped. The template is built (`src/core/post.ts`, #126), and
  the commands, the orchestrator, the automated review and the implementer's exit post through it ([review 4](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6682589125)).
  One exception, the PR body (#335): below its own templated lines, the host posts the implementer's
  `.factory/pr.md` as Markdown, only through the cleaner (`src/core/pr-body.ts`). It drops raw HTML, breaks every `@`,
  puts `\` before a line that starts with `/`, breaks each reference after a closing keyword (`Fixes #12`), turns links to any host but the project's git host into plain text,
  and caps the length; tables, headings and lists stay. Notes and comments stay fixed templates.
- **The coordinator cannot widen its own wall.** It edits only spec drafts with no prompt, and never its settings, any
  `.claude/` or the factory ([review 7](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6682899888), #106). **Today:** an edit elsewhere asks you rather than being refused.
- **State goes to the git host**, never to a file only one run can read. The one exception is the local approval,
  which the PR body records once there is code.
