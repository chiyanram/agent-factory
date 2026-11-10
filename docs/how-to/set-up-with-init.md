# Set up with agent-factory init

`agent-factory init` sets up this laptop and one project in one guided run (#369). It is plain code, with no model run.
Run it inside the product clone, or name the clone with `--repo <absolute path>`:

```bash
cd ~/workspace/ledger
agent-factory init            # the project's name defaults to the clone folder's: ledger
```

1. **Reads the clone.** The git host and the project from `origin` (`github.com` is `github`; any other host is
   `gitlab`, and its name becomes `gitHostName`), the clone's path, the build tool (`./gradlew`, `./mvnw` or `pom.xml`,
   `package.json`, `Makefile`: `ready.programs`, the verify command and the egress hosts its dependencies need, plus
   `api.anthropic.com`), the integration tests in `src/integrationTest` (the built-in test globs hold them), Flyway
   (`db/migration`) and Liquibase (`db/changelog`) folders, the CI files and the toolchain file (`mise.toml`,
   `.tool-versions`, `.sdkmanrc`). It runs none of the clone's programs.
2. **Asks one round**, in the style of `questions: round`: the project on the git host, the runner (`srt` or `vm`),
   the gate (`forge-ci` when the clone has CI files, else `local` with the verify command), the plugins
   (`rulebook@chiyanram` or none), when it found migrations, whether they are one-way doors, and where the ticket
   specs live (`specStore`): `issue`, the git host issue's body, recommended for a personal project on github.com or
   gitlab.com, or `local`, recommended on a company's own git host; a project marked `work` is not asked and stays
   `local` (#381). Each question has
   lettered choices with the recommended one marked; answer `1A 2B`, or press Enter to take every recommendation.
   `--yes` takes them all, for a repeat setup. A question whose key the files already hold is not asked.
3. **Writes the answers** to the settings layers, never to the repo or a shell profile: `runner` to
   `$FACTORY_HOME/user.json`, and the rest to `$FACTORY_HOME/projects/<project>.json`, including the project's
   identity: `gitHost`, `gitHostProject` and `clone` ([Settings](../reference/settings.md#settings)). It shows each key it adds (`+`) and each
   value it would replace (`~`), and replaces one only after your yes; `--yes` keeps every value the files hold and
   exits 3. A list key only grows. It runs `config check` on the result first, and writes nothing when that fails.
4. **Pins each plugin** through `agent-factory plugin update` after it says what that does and you say yes: it clones
   the marketplace to `$FACTORY_HOME/marketplaces/<marketplace>` through hostGit when it is not there
   (`https://github.com/chiyanram/skills` for `chiyanram`).
5. **Checks each piece** and prints ✓ or ✗ with the fix: `srt` at the pinned version (the exact install command, with
   `--omit=optional`), the `claude` CLI, `agent-factory` and `srt` under the active Node (after a Node upgrade they
   are gone; it prints the reinstall commands), the model token's days left (read from its expiry record in
   `tokens.json`, never the token), the git host login for the project (the project's default branch, through the
   `Forge` seam), each tool the toolchain file declares against the one `PATH` gives a run (for example SDKMAN!'s Java
   25 first on `PATH` while `mise.toml` declares 27: it names the manager that wins and the fix), the coordinator's
   settings, and `config check`.
6. **Prints the next commands**, in order, for you to run: each fix, then `claude setup-token` and `agent-factory setup
   claude` when the token is missing, opening `claude` once in the clone, `agent-factory onboard <project>`,
   `agent-factory onboard accept <project> <brief hash> <glossary hash>`, the spec (in the issue's body with the issue
   store, else the local file), `agent-factory start` and
   `agent-factory coordinator <project>`.

It never handles a secret and never runs a command only a human runs (`setup claude`, `onboard`, `onboard accept`,
`start`, `approve`, `waive`). The coordinator's settings deny `agent-factory init`, since it writes the settings that
hold the coordinator's wall. Exit 0 when every check passes, 1 when one fails or init refuses, 3 when `--yes` kept a
value. Running it again is safe: it asks only what is missing and writes nothing when nothing changed. Once the files
hold `FACTORY_FORGE`, `FACTORY_PROJECT`, `FACTORY_REPO` and `FACTORY_BOX`, it says you can remove their exports:
every command, the coordinator's `poll`, `status` and the loop commands too, reads them from the files (#382).

The sections below are the manual steps, kept as reference.
