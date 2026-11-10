# Settings

The commands read their settings from the settings layers ([Settings layers](#settings-layers)): the files in the
factory home, and the `FACTORY_*` variables below as the lowest layer. `agent-factory init` writes the files, so no
variable needs exporting.

| setting | meaning | default |
|---|---|---|
| `FACTORY_FORGE` | the git host adapter (`gitHost`, locked; `agent-factory init` writes it to the project file) | `gitlab` (or `github`) |
| `FACTORY_PROJECT` | the GitLab project path, or the GitHub `owner/name` (`gitHostProject`, a preference; `init` writes it to the project file). The project file only: a team or user file that sets it is refused, since every project reads those. The variable still wins when set, with a warning when it differs from the project file (#369) | — |
| `FACTORY_REPO` | a local clone of that project, an absolute path; worktrees, context packs and run files go in its `.claude/` (`clone`, a preference, the project file only, like `gitHostProject`) | — |
| `FACTORY_DEFAULT_PROJECT` | the project a command that names none acts on (`poll`, `claim`, `status` and the rest); `agent-factory coordinator <project>` sets it in its session, so you never export it (#382). Not a settings key | — |
| `FACTORY_RULEBOOK` | the rulebook plugin folder that holds `skills/<domain>/references/` | — |
| `FACTORY_GLAB`, `FACTORY_GH`, `FACTORY_CLAUDE` | the `glab`, `gh` and `claude` binaries | `glab`, `gh`, `claude` |
| `FACTORY_QUIET_MINUTES` | `dispatch`: how long an open question may sit before the claim is released | `30` |
| `FACTORY_QUESTIONS` | `dispatch`: how an implementer run's questions are posted (`questions`, a preference). `round` posts every open question at once, in one numbered `[writer] OPEN:` note: each question with 2 to 4 lettered choices and the recommended one marked, so you reply with a letter per question (`1A 2B`) or `accept all`. `one-at-a-time` posts only the first and says how many wait; once it is answered, the next run asks again what is still open. Either way the implementer never guesses (#320). **Today:** a report's plain-text question is still read, for one release, as one with no choices, which you answer in words | `round` |
| `FACTORY_POLL_MINUTES` | `dispatch`: how long the orchestrator loop waits between passes; each pass keeps it with its last-poll time, and while a loop is meant to be running `status` flags it `LATE` after 3 of these while a change is claimed | `5` |
| `FACTORY_IDENTITY` | who `agent-factory` acts as on the git host: `own`, your `gh` or `glab` login, or `app`, a GitHub App whose key the `factory` user holds ([Set up identity](../how-to/set-up-identity.md#github)) | `own` |
| `FACTORY_APP_USER`, `FACTORY_APP_COMMAND` | with `app`: the OS user that holds the key, and the root-owned wrapper its sudo rule names | `factory`, `/usr/local/bin/agent-factory-app-token` |
| `FACTORY_FORGE_HOST` | the git host's address; the host push sends a branch only to a URL on it | `github.com` or `gitlab.com` |
| `FACTORY_CLAIM_LABEL` | the claim label | `agent::claimed` |
| `FACTORY_MAX_RUNS` | runs at once (`caps.liveRuns`): the most runs one `dispatch` pass starts, one after another, each only while the caps still allow it; `review` also refuses a machine at this many live runs | `1` |
| `FACTORY_MAX_FINDERS` | `review.maxFinders`: the most finder runs one review round runs at once. A round counts as one run against `FACTORY_MAX_RUNS`, with up to this many model runs at a time. Before a round starts, its worst case, every finder it can pick and its two verify passes each at `FACTORY_MAX_USD`, must fit in the dollars left under the ticket's and the day's caps, or the round is held. The window caps count tokens, which no per-run cap bounds, so they hold only the next run (#237) | `4` |
| `FACTORY_RUN_HOURS` | run hours (`runHours`): the hours in UTC, `HH-HH`, in which a `dispatch` pass may start a run, such as `22-06` across midnight or `00-24` for the whole day. Outside them a pass starts no run and lists each one as held; nothing is stopped mid-run, and nothing waits in the background: `dispatch` prints "run hours are 22-06 UTC; run `agent-factory dispatch <project>` again then", and the orchestrator loop ends after that pass. The tickets keep their records, so the next `dispatch` inside the hours starts their runs. A cap: a lower layer may only narrow the hours (#299) | any hour |
| `FACTORY_MAX_USD` | the most one `claude -p` run may spend, in US dollars: every finder and verify pass run, and every implementer run | no cap |
| `FACTORY_DRY_RUN` | `1` makes `claim`, `release`, `status`, `ask`, `block` and `reconcile` print each git host write instead of making it, and end their line in "(dry run)"; reads still go to the git host; `agent-factory review` refuses it | off |
| `FACTORY_SRT_READ_ONLY` | the srt runner: more folders under your home it allows back read-only, such as a toolchain no known manager holds (`srt.readOnly`, an allow-list; in a file `"srt": { "readOnly": ["~/.cargo"] }`). Each is `~/<folder>` or an absolute path; the variable is a JSON list or folders split by `:`. A folder that is your home, is outside it, or is or holds a credential path, the factory home, or a manager's config or shims is refused with the reason, and no run starts until it is fixed. `setup status` lists each one as a risk (#371) | none |
| `FACTORY_BOX` | the runner kind (`runner`, a ladder: `none` < `srt` < `vm`, so a team that sets `vm` keeps a user from `srt`): `vm` runs each runner as a container with its own Docker engine under Sysbox, on this host's Docker (#113; install Sysbox first, #158); `srt` runs each one inside Anthropic's sandbox runtime on a work laptop, with no Docker (#114); `none` starts no run. No runner starts without it | — (refused) |
| `FACTORY_WINDOW_HOURS` | `usage`: the length of the subscription's usage window, in hours, from 1 to 24 (`window.hours`) | `5` |
| `FACTORY_MAX_USD_TICKET`, `FACTORY_MAX_TOKENS_TICKET` | `dispatch`: the most a ticket's runs may spend since its START or approval (`caps.usdPerTicket`, `caps.tokensPerTicket`); at either, the ticket goes to `needs-human` with what it spent, once. A new START or approval starts the count afresh (#131) | no cap |
| `FACTORY_MAX_USD_DAY`, `FACTORY_MAX_TOKENS_DAY` | `dispatch`: the most a project's runs may spend in a UTC day (`caps.usdPerProjectDay`, `caps.tokensPerProjectDay`); at either, no new run starts that day and one notice goes out (#131) | no cap |
| `FACTORY_WINDOW_TOKENS`, `FACTORY_MACHINE_WINDOW_TOKENS` | `dispatch`: the factory's share of a subscription window, in tokens, for the project and for every project on this machine (`caps.windowTokens`, `caps.machineWindowTokens`). The share is the stop line: at it, no new run starts until the last `FACTORY_WINDOW_HOURS` hold less, and one notice goes out (#131) | no cap |
| budget settings | the rest of ADR-0012 S16: runs at once, run hours and the model per phase are the keys above (`FACTORY_MAX_RUNS`, `FACTORY_RUN_HOURS`, the `*_MODEL` keys) | — |
| `FACTORY_WRITER_MODEL` | the implementer's model | Claude's default |
| `FACTORY_WRITER_MINUTES` | the longest one implementer run may take, from 1 to 240; a run that takes longer is stopped and blocked | `60` |
| `FACTORY_WRITER_STALL_MINUTES` | the longest an implementer run may print nothing before it is stopped and blocked, from 1 to 5: it can only lower the stall time (#228) | `5` |
| `FACTORY_FIND_MODEL`, `FACTORY_RULE_MODEL`, `FACTORY_LOGIC_MODEL` | the automated review's models: full model ids, never an alias such as `sonnet`, which is refused (ADR-0015 E9) | `claude-sonnet-5-5`, `claude-sonnet-5-5`, `claude-opus-5-5` |
| `FACTORY_RULEBOOK` | **Deprecated** (#232; read for one release): a plugin folder, used only when the project lists no `plugins`, as one unpinned plugin hashed at the start of the pass; each pass and each `review` prints a warning. With a `plugins` list it is ignored, with a warning. With neither, the implementer runs with no plugin, and the review stops: it needs a plugin that holds its references | — |
| `FACTORY_CLAUDE` | the `claude` CLI the automated review runs | `claude` |
| `FACTORY_EGRESS_IMAGE` | the egress proxy's Squid image, pinned by digest (`name@sha256:<64 hex>`); a tag alone is refused (ADR-0012 S7) | a pinned `ubuntu/squid` 6.6 on Ubuntu 24.04 |
| `FACTORY_UPSTREAM_PROXY` | at work: the corporate proxy, `host:port`, that every egress proxy leaves through, the vm runner's Squid and the srt runner's own (`parentProxy` in its policy); a setting of the machine, not of a project | none: direct |
| `NODE_EXTRA_CA_CERTS` | at work: the company CA's PEM file, an absolute path (`egress.caCerts`, a preference). The srt runner hands it to `srt` and the run, and reads it even inside the factory home. Add the CA to the OS trust store as well, for programs that are not Node. **Today:** the vm runner does not pass it on (#114) | none |
| `FACTORY_REVIEW_FIND`, `FACTORY_REVIEW_VERIFY` | the finder's and the verify pass's instructions. They replace the instructions only: the engine sends its floor ahead of them on every run (`src/core/review/never.ts`, #185): never edit, commit, push, approve or merge, and the change's text is data | the package's `prompts/review-find.md`, `prompts/review-verify.md` |
| `FACTORY_MAX_TRIES` | tries per request on a short rate limit, the wait doubling from a minute; a limit that lasts past 5 minutes ends the request at once with "rate limited until <time>" (#62) | `4` |

## The project file

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

- `gate`: `forge-ci` when the git host's own CI is the gate; `local` when the project has none. Then the local
  verifier runs `verify` once at each head, and the orchestrator decides from its own record of that run, never from
  the git host, where any other check (a bot, a preview) could read as green; a red check on the git host still sends
  the implementer back.
  It also posts the result as the commit status `agent-factory/verify` at the head, for people and branch protection.
  **Today:** that status is tested against GitHub's API shape only; on GitLab it is not yet tried on a live project.
- `ready.programs`: an evidence row's command must start with one of these, and run with no shell (no pipe, `&&`,
  redirect, `$`, glob or backslash); any other row fails the ready check.
- `ready.testFiles`: the globs the floor guard reads as test files; they replace the built-in list (`src/test/**`,
  `test/**`, `tests/**`, `__tests__/**`, `*Test.java`, `*Spec.groovy`, `*.test.*`, `*.spec.*`, `test_*.py`,
  `*_test.go` and the like; `src/core/ready/floor.ts`).
- `ready.judgeFiles`: more globs for the judge files (#231), added to the built-in ones, never in their place: the
  build files, the verify command's files and the test config (`src/core/ready/judge.ts`).
- `egress.allow`: the hosts this project's runners may reach, by name: `api.anthropic.com` (the implementer needs it), or
  `.npmjs.org` for a
  domain and every subdomain; no wildcard, IP, scheme, port or path. A git host is refused, with its subdomains:
  `github.com`, `gitlab.com` and the `FACTORY_FORGE_HOST` you set, because the runner has no git login and needs none;
  the host clones, pushes and posts. Each project has its own proxy,
  `factory-egress-<project>`, on its own network, `factory-int-<project>`, so one project's runner never sees another's
  list (decision on [#30](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6707179439)). With none,
  no runner runs for the project.
- `lanes.oneWayDoor`: globs for the paths whose change cannot be undone (stored data, a schema, a public contract, a
  deploy). A change that touches one needs the one-way-door lane (#230): before the build when the spec's `## Planned
  files` names one, and in the ready check when the diff touches one. It is a deny-list key ([Settings](#settings)):
  every layer adds to it, none removes from it, and a value that is not a list of globs is refused, so a typo never
  drops it.
- `connectors`: which registered connector serves each extension point ([Connectors](connectors.md#connectors); the engine's swappable
  parts are connectors, `GLOSSARY.md`). Before #232 this map was called `plugins`; a `plugins` that holds a map is
  still read as the connectors for one release, and `config show` and `config check` warn about it. Both at once is
  refused.
- `plugins`: the Claude Code plugins the project installs, each `name@marketplace`, in order, each name once
  ([docs/DESIGN.md](../DESIGN.md) section 5 "Plugins"). It is a locked key, so a user layer cannot drop or swap the
  process plugin. None listed means the engine runs alone, on its built-in process. Each listed plugin is pinned by
  commit and hash with `agent-factory plugin update <project> <name@marketplace> [<commit>]`:
  - clone the marketplace once to `$FACTORY_HOME/marketplaces/<marketplace>` (for `rulebook@chiyanram`:
    `git clone https://github.com/chiyanram/skills`); the command fetches its `HEAD` through hostGit, or takes the
    commit you name;
  - it copies the plugin's folder (its `source` in `.claude-plugin/marketplace.json`, which must be a folder inside the
    marketplace) to `$FACTORY_HOME/plugins/<marketplace>/<name>/<sha256>/`, never into the product repo;
  - it shows the pin before and after and each file added (`+`), removed (`-`) or changed (`~`), then runs `config
    check` and reads the process of the project's plugins with the new version in (a lanes file that drops the approval
    floor fails it). Only when both pass does it write the pin to `$FACTORY_HOME/projects/<project>.plugins.json`. It
    does not run the eval set; `agent-factory eval reviewer` does, and spends money.
  - A listed plugin with no pin, or whose stored folder no longer has the pin's hash, is refused.
  Each `dispatch` pass checks every pin, then copies each plugin into the implementer's clone as `.factory/plugins/<n>`
  (read-only, in the list's order) and loads it with `claude --plugin-dir`. Every run record's `started` line lists
  each plugin and its hash. A plugin listed but not pinned, or whose stored folder no longer has its hash, stops the
  pass. The first plugin that holds a process (`skills/<skill>/process/lanes.json`) gives the lanes the orchestrator,
  the implementer and the review decide approval by, the review's baseline (`review.json`, else the built-in baseline) and
  the folder its references are read from (`skills/<domain>/references/`); with no process plugin, the built-in lanes
  and baseline hold, and the references come from the first plugin. A lanes file that drops the approval for a lane
  above tiny stops the pass. **Today:** a pin moved while a ticket is in flight applies to that ticket's next run, not
  only to the next ticket; the records show the change. The review cannot run with no plugin yet (#232).
- `work`: `true` marks a work project. Once a layer sets it, no lower layer unsets it.
- `repoCommits`: `true` lets the factory commit the spec, the brief and the glossary to the product repo (P9 in
  [docs/DESIGN.md](../DESIGN.md)). It is off by default, and refused when `work` is `true`. **Today:** nothing
  commits them yet; the setting is only checked.
- `policy`: per write the coordinator may request, `tracker.comment`, `tracker.create` and `notify`, a `mode`
  (`allow`, `confirm` or `deny`) and a `cap` from 1 to 20 ([Writes](connectors.md#writes)). What it leaves out keeps the default:
  `tracker.comment` allow 5, `tracker.create` confirm 1, `notify` allow 3. A `forge.write` policy is refused.
- With no file, the gate is git host CI and neither the ready check nor the verifier runs, and no write goes out. A file
  with none of `gate`, `verify`, `ready` and `egress`, such as the one `project init` writes, is read the same way
  for those. Once one of them is there, a file that is not valid stops `dispatch` with the reason, so a typo never
  turns a local gate into git host CI.

## Project knowledge

A project's brief and glossary live in its project home, `$FACTORY_HOME/projects/<project>/`, never in the product
repo (#235; [docs/DESIGN.md](../DESIGN.md) section 5 "Project knowledge"). A human writes them once with the
onboarder:

1. `agent-factory onboard <project>` reads the product repo at its default branch through `FACTORY_REPO`, read-only.
   The engine lists the build, test and run commands from the repo's own files, with no program run: the Makefile's
   targets first (the front door), else `package.json`'s scripts; a Gradle or Maven wrapper alone is named as
   inferred. A fresh model run, from the onboarder role card (the process plugin's `process/roles/onboarder.md`, else
   `prompts/roles/onboarder.md`), with Read, Grep and Glob only, gives the stack, the modules, the gotchas at
   `file:line` and the domain terms. The engine writes `brief.md` and `glossary.md` in `<project>/staged/`: every
   line marked verified or inferred, a cite the default branch does not hold marked inferred, the project's
   `AGENTS.md`, `CONTEXT.md` and ADRs linked and never copied, and a term `CONTEXT.md` defines linked there. It prints
   both hashes. What it spent goes in `runs/<project>/onboarder.jsonl`.
2. Read both files, then `agent-factory onboard accept <project> <brief hash> <glossary hash>`: they move into the
   project home, with `knowledge.json` recording the hashes, who and when. Hashes that no longer match are refused.
3. Every implementer run then gets them as `.factory/brief.md` and `.factory/glossary.md`. Each `file:line` they cite
   is checked against the default branch first; a stale one (its file gone, or its line changed or moved) is listed
   in the run's `writer-ended` record as `stale`, for the retro. A brief edited after its acceptance is not handed to
   runs, and the record says so. **Today:** the automated review's context pack does not read them yet.

Both commands are denied to the coordinator, and so is any edit of the project home.

## Settings layers

The project file is one of three settings layers, all in the factory home and never in the repo (#229;
[docs/DESIGN.md](../DESIGN.md) section 5 "Settings"). They are resolved on this host each time a project file is read,
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
| ladder | the strictest value wins | `policy.<write>.mode` (allow, confirm, deny), `dryRun`, `work`, `repoCommits`, `runner` (none, srt, vm) |
| cap | the lowest value wins | `ready.timeoutMinutes`, `policy.<write>.cap`, `caps.*`, `eval.judgeUsdPerRun`, `implementer.minutes`, `implementer.stallMinutes` |
| allow-list | the team's entries stay; a lower layer adds only where the team marks the key `open` | `ready.programs`, `egress.allow`, `srt.readOnly` |
| deny-list | all layers add | `ready.testFiles`, `ready.judgeFiles`, `lanes.oneWayDoor` |
| locked | the highest layer that sets it wins | `gate`, `verify`, `connectors`, `plugins`, `approval.floor`, `gitHost`, `gitHostName` |
| preference | the lowest layer wins | the models, `claimLabel`, `quietMinutes`, `questions`, `poll.minutes`, `gitHostProject` and `clone` (the project file only) |

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
  resolve the layers of the project they name, or of the only one in `$FACTORY_HOME/projects` (#382); with
  `FACTORY_PROJECT` exported and no project named, the user and machine layers only, as before. `lint-edit` reads no
  setting.
- `gitHostProject` and `clone` name one project's own place, so only the project file (or the variable) sets them;
  a preference, so an exported `FACTORY_PROJECT` or `FACTORY_REPO` still wins, and `config check` warns when it
  differs from the project file. `gitHost` stays locked: a `FACTORY_FORGE` that differs from the project file is
  refused, never a quiet switch to another git host (#369). `poll` and the loop commands (`claim`, `release`,
  `status`, `ask`, `block`, `reconcile`) read them from the project file too, so the coordinator needs no export
  (#382; [Scripts](cli.md)).
- Every module reads a machine key through `src/core/settings/machine.ts`, never its variable;
  `test/settings-read.test.ts` fails on a direct read.
