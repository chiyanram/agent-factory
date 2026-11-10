# Connectors

Every outside tool is reached through a connector ([ADR-0014](../adr/0014-plugin-model.md), #134). A connector is an
executable: `<exe> describe` prints one JSON object (its protocol, capabilities, declared writes, the env names it
needs, and the programs it runs by name, `cli`), and `<exe> call` reads one JSON request on stdin and prints one JSON result, a sealed case of that
capability, on stdout; its logs go to stderr. The core runs it with no shell, in a process group of its own that the
timeout, the output cap and the end of the call kill whole, and with only `PATH`, `HOME`, `LANG` and the names it
declared. A connector may not declare a model or cloud login, a git host token, a `FACTORY_*` setting or a loader
variable (`LD_*`, `DYLD_*`, `NODE_*` and the like); each uses its own CLI's login (`src/core/plugin/`).

A connector is the folder its file sits in. `plugin add` takes the sha256 of every file in that folder, copies the
folder into `$FACTORY_HOME/plugins/<sha256>/` (mode 700) and records it in `$FACTORY_HOME/plugins.json` (mode 600);
every call hashes the copy again and runs it, so a change to your own folder after review changes nothing. A file or
folder that someone else could write to, or a symlink inside the folder, is refused.

| command | does |
|---|---|
| `agent-factory plugin add <path\|name>` | inspects a connector and pins it, as above; a name is a connector bundled with the package, and nothing is fetched from the network. A name already added is refused: use `update` |
| `agent-factory plugin update <name> [<sha256>]` | runs the test kit on the connector's folder as it is now and shows its hash and the writes it adds (exit 3, nothing recorded); with that hash, records it, if it is still the same |
| `agent-factory plugin test <path\|name>` | the contract test kit: handshake; each `fixtures/<capability>/<case>.in.json` against its `.out.json`, for declared capabilities only; bad input; an unknown op; one JSON object on stdout; a canary in each declared env name that must not come back; no token in any answer; and write fidelity: each write fixture's text (`input.text`, or a post in `input.post` or `input.body`, as the posting template renders it), and once more a tricky one, must reach the CLI byte for byte and whole (an argv word, stdin, or a JSON string that is the text itself), with no more calls than the fixture's `<case>.cli.json` lists answers. A connector that writes must name its programs in `cli` (never an interpreter such as `node`); the kit then runs every call with a recording fake of each first on the connector's `PATH`, answering from `<case>.cli.json`, so a named program is never the real one |
| `agent-factory plugin list` | the registered connectors, with their writes and hashes |

A connector's `PATH` is yours without relative folders and without folders others can write to. The coordinator may not
run `plugin` or edit `plugins.json` or the store (#106). **Today:**

- The pin covers the connector's folder, not the interpreter a script names (`#!/usr/bin/env node` takes the first
  `node` on that `PATH`) nor the CLI it calls; folders your own user can write, such as `~/.local/bin`, stay on the
  `PATH`, since most CLIs live there.
- The fakes stand in only for the programs named in `cli`, found by name on the `PATH`: `describe` runs with the real
  `PATH`, and a program not named, one run by an absolute path, or the network reached from the connector's own code
  is not held back by the kit.

## The git host as a connector

The package bundles two connectors, `github` and `gitlab`: the factory's own git host adapters, built into
`plugins/<name>/lib/` from the compiled package, so the pinned folder holds every module it runs. Each declares
`forge.read` and `forge.write` and runs `gh` or `glab` from its `PATH` with that CLI's own login; the project comes in
each request, so it needs no setting and no token. A project opts in with its project file:

```json
{ "connectors": { "forge.read": "github", "forge.write": "github" } }
```

Run `agent-factory plugin add github` once. The bundled connectors start with `#!/usr/bin/env node`, so `node` must be in
a `PATH` folder only its owner can write; where it is not (some CI tool caches), `describe` exits 127, and a link to
`node` in such a folder, put first on the `PATH`, fixes it. Then `dispatch <project>` makes every git host call of its pass through the
connector, and reads each answer back in the seam's own shapes, so a connector that answers anything else fails that
call. A git host call has the built-in adapter's room: an answer of up to 64 MiB, and time to wait out a rate limit on every
try. `FACTORY_DRY_RUN` still holds every write back, opening a change too. Without the mapping, the built-in adapter
runs, as before.

The connector's name must be the git host's (`FACTORY_FORGE`), and each request names its git host, which the
connector checks. A setting the connector cannot honour stops the pass instead of being dropped without a word: `FACTORY_GH`,
`FACTORY_GLAB`, `GH_TOKEN`, `GITHUB_TOKEN`, `GH_ENTERPRISE_TOKEN`, `GH_HOST`, `GITLAB_TOKEN`, `GITLAB_HOST`, and a
`FACTORY_FORGE_HOST` other than github.com or gitlab.com. **Today:**

- Only `dispatch` opts in; `review`, `poll`, `status` and the loop commands still use the built-in adapter.
- `FACTORY_IDENTITY=app` with a git host connector is refused: the App's token would have to reach the connector, and
  none may hold one (ADR-0014 P11). App projects keep the built-in adapter.
- A project on GitHub Enterprise or a self-managed GitLab keeps the built-in adapter, since the connector gets no host
  setting; so does one whose `gh` or `glab` login comes from a token in the environment.
- The connector tries a rate-limited request 4 times; `FACTORY_MAX_TRIES` does not reach it.

## Pings

The orchestrator pings you on Discord when a ticket needs you (#119), through the bundled `discord` notify connector:
- each hand-over its table makes on a change: CI red twice, the ready check's failures, the same patch twice, a run
  that never ended, and its other stops;
- an implementer run that ended blocked, or with a question that waits on your answer;
- a change ready for you to review and merge (the gate is green).

Each goes once per event and head, as its git host note does. To set it up:
1. In the Discord channel, Integrations → Webhooks → New Webhook, and copy its URL.
2. `agent-factory setup discord` and paste it at the hidden prompt. It is kept like the claude token: the login
   Keychain on macOS, `~/.factory/secrets/discord-token` (mode 600) on Linux, never printed. On the VM run it as the
   user that runs the orchestrator.
3. `agent-factory plugin add discord`, and map `"notify": "discord"` in the project file's `connectors`.

The core hands the webhook to the connector inside the request on stdin, never in env or argv; the connector's `curl` reads
it from a 0600 config file it removes after, and the message from stdin. The text is a posting template, and every
mention is switched off, so nothing pings `@everyone`. A ping only informs: one that fails never stops the pass or
the ticket (the pass prints why, the git host note is the record) and is not tried again, and a reply in Discord is
never an approval. `FACTORY_DRY_RUN=1` prints each ping instead. The coordinator's `request notify` goes through the
same connector, within its policy and cap ([Writes](#writes)). The webhook goes only to the package's own
`plugins/discord/plugin`, matched by its real path, never to another connector that calls itself `discord`. **Today:**

- A stop the automated review makes itself (open Act on findings, an empty change, a protected file, its round
  limit) and a hand-over with no change to label ping no one yet; the git host note or the pass's error is the record.
- The connector runs `curl` with no proxy setting, so a host that reaches Discord only through a proxy sends no ping.
- The text is the git host's posting template, so `&` and `<` show as `&amp;` and `&lt;` in Discord.

## Writes

The coordinator holds no login, so it never writes to a tracker or a chat itself. It asks, and code performs the write
(ADR-0014 P5, P6; `src/core/plugin/request.ts`):

1. It writes a draft, as JSON, among the spec drafts in `$FACTORY_HOME/specs/` (`request` reads a draft from nowhere
   else): `{"project": "ledger", "ticket": "PROJ-1", "text": "…"}`, with `"items": ["…"]` for a list (not for
   `notify`), and a `"title"` for `tracker.create`. A draft with any other field is refused.
2. It runs `agent-factory request <tracker.comment|tracker.create|notify> --file <draft.json>`. The core checks the
   draft, cleans every text field with the posting template (`[coordinator] …`, so no line starts a quick action, a
   mention, a reference or a link), and applies the policy.
3. `allow`: the write goes out at once through the connector the project file maps it to (exit 0). `confirm`: it is kept
   in `$FACTORY_HOME/pending/`, nothing goes out, and `request` prints a command (exit 3):
   `agent-factory confirm <project>/<ticket>/<capability>/<id> '<the text>'`. The coordinator runs it, and the harness
   prompt shows you where the write goes and its exact text; your yes sends it. Say yes only when the prompt spells
   the text out in single quotes: a `confirm` whose text comes from `$(…)`, a backtick or a variable would match
   and go out, while the prompt showed you only the command that makes the text. `deny`: refused (exit 1).

A write goes out only when all of these hold, at `request` and again at `confirm`:

- the ticket's approval is current (`agent-factory approval` says `approved`); a ticket with none gets no write;
- the project file maps the capability to a connector, and that connector declared the write in its `describe`;
- the cap has room: it counts the writes since the ticket's latest approval, so approving again starts afresh. A write
  the connector failed still counts, since it may have gone out;
- at `confirm`, the text you were shown is the kept text, byte for byte, leaving out the invisible word joiners the
  cleaning puts after `@`, `#` and `!` (no one can see them to check them), and the kept request is unchanged.

Each write is logged in `$FACTORY_HOME/writes/<project>/<ticket>.jsonl` before it is sent, then its outcome; one
ticket's writes run one at a time behind `<ticket>.lock`, which holds its process ID, so a lock left by a process
that was killed is taken over. Cleaning drops every control and invisible format character (bidi controls and
isolates, tag characters, the soft hyphen, variation selectors), so what the prompt shows is what is sent. A connector answers a write with `{"kind": "done", "url": "…"}`; any other kind is a
failure. `forge.write` is the orchestrator's alone, and no Jira status, assignee or field change has a capability.
**Today:**

- The pending requests and the write log belong to your own user, so the coordinator's settings deny editing them,
  but a command its Bash rules do not name could still change them; they move to the `factory` OS user with the
  approvals (ADR-0012 S2).
- No tracker or chat connector is bundled yet, so a write needs a connector you add yourself.
- Kept requests never expire; one made under an earlier approval is refused at `confirm`, but its file stays in
  `pending/` until you remove it.
