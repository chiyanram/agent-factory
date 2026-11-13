# Why does every feature edit src/app.ts?

Ticket: #568 (child of map #567, "Map: garden health"). Facts only. The split decision is a later ticket.

Source: `src/app.ts` at origin/main `2c3e2ec` (1,756 lines). Commits: `git log --since='60 days ago' -- src/app.ts`
on 2026-11-13 (52 commits, `122b996` to `0bc7a92`). Each commit was grouped by its own diff to `src/app.ts`.

## Answer

Both. `src/app.ts` is a shared list that each new command edits by hand, **and** it holds the logic of about eight
commands that have no module of their own.

```
a new command, today                          a change to the dispatch pass, today
-------------------------------------------   ---------------------------------------
1. import its module            app.ts:1-89   1. import the new core module  app.ts:1-89
2. add its help text            app.ts:91-170 2. edit stepsFor / passSetup   app.ts:864-964
3. a new flag? Args field       app.ts:172-185
              parseArgs option  app.ts:1722-1733
              command.run field app.ts:1745-1754
4. a wrapper: factoryHome guard,
   resolvedRun, call the module (one per cmd)
5. a COMMANDS row               app.ts:1650-1675
   (or a runCli branch / ownOptions)
```

## The commits, grouped (52)

| Group | What the diff to app.ts did | n | Commits |
|---|---|---|---|
| New command | import + HELP text + wrapper + a `COMMANDS` row, a `SETUP` row, or a `runCli` branch | 21 | 122b996 41665dc 476de68 45d7420 756a6a5 36c670d bb4fa34 518671b f7b5b13 6df5834 aa281ef 7893dde e4acab0 96222f5 96b2522 698506e 1639545 b310326 cd6f326 af718d0 060facd |
| Dispatch pass wiring | a new step, setting or box in `stepsFor`, `passSetup`, `onePass`, `hostBoxPlan` | 15 | 6f7b549 d9a677e 6281c40 ac49b39 914a38a 6f51ad0 35475fc fa354ef 5a6bd43 af55afc 3361abf 6137393 c9e71a6 c4884a0 f693373 |
| Spec / approval logic | the spec, start, approve and approval commands, which live in app.ts | 4 | 4994f67 4396e2e 0bc7a92 b770e2d |
| Settings plumbing | every command routed through `resolvedRun` / `projectRun` | 2 | 13b9418 dfce870 |
| Setup, init, box, onboard | status lines, init probes, box packing, onboard fix | 4 | 3df26a3 4f8415f 49b9625 ec2ec94 |
| Review | the review command's spec input | 1 | 5fa7a82 |
| Help text or comment only | one HELP line, a comment, `COMMAND_NAMES` | 4 | 41f8142 40c103d c7da990 9d78dea |
| Format | Biome over the whole file | 1 | 7153d1a |

Counts from the diffs:

- 43 of 52 commits add an import line.
- 18 of 52 commits add a `name: "…"` row to `COMMANDS` or `SETUP`.
- 7 flags were added, and each one edits three places (`Args`, the `parseArgs` options, the `command.run` call):
  `--template --json` (122b996), `--once --dry-run` (756a6a5), `--yes` (e4acab0), `--no-loop` (5a6bd43),
  `--repo` (af718d0), `--show` (0bc7a92).
- `factoryHome(` is called 20 times; most calls are a copy of the same "refused home → print, exit 1" guard.
  `resolvedRun(` is called 13 times.

## The responsibilities on main, with line ranges

| # | Responsibility | Lines | Notes |
|---|---|---|---|
| R1 | Imports | 1-89 | 67 import statements, from 65 modules |
| R2 | Help text | 91-170 | Inline text for 15 commands; 8 sibling modules give their own `*_HELP` (lines 146, 149) |
| R3 | Shared CLI types and helpers | 172-232 | `Args` 172-185, `Io` 187-211, `factoryHome` 213-225, `version` 227-232 |
| R4 | Thin adapters to sibling `*-cli.ts` modules | 234-298, 830-846, 1074-1089, 1448-1476, 1478-1553 | usage, trace, onboard, egress, loop commands, plugin, config, team, init |
| R5 | poll | 300-333 | Logic in place |
| R6 | spec, start, approve, waive, approval | 335-742 | Logic in place: `specFound`, `beforeDesignReview`, `whoApproves`, `branchOnHost`, `withLoop`, `startOutcome` |
| R7 | Dispatch composition root | 746-1072, 1091-1131 | `dispatchSettings`, `tokenStore`, `hostBoxPlan`, `processAndQuarantine`, `stepsFor`, `passSetup`, `aroundPass`, `notifierFor`, `setupNow`, `onePass`, `dispatchReady`, `dispatchCommand`, `loopPasses` |
| R8 | Settings resolution | 1030-1072 | `resolvedRun`, `projectRun`; sits inside R7 but all commands use it |
| R9 | review | 1133-1239 | `reviewStepFor` (used by R7 too), outcome lines, `reviewCommand` |
| R10 | app-token | 1241-1267 | Logic in place |
| R11 | setup claude / discord / status / coordinator | 1269-1344, 1400-1430, 1609-1648 | Token store prompts, status lines |
| R12 | box build | 1346-1398 | `packageDir`, `baseDir`, `boxCommand` |
| R13 | coordinator session | 1432-1446, 1555-1607 | `coordinatorArgs`, `coordinatorSession`, `sessionEnv`; also `PKG`, `BUNDLED_DISCORD` at 1444-1446 |
| R14 | Registry and entry | 1650-1756 | `COMMANDS` 1650-1675, `COMMAND_NAMES` 1677-1684, `ownOptions` 1686-1704, `runCli` 1706-1716, `mainCli` 1718-1756 |

Ranges interleave. For example `placesOf` (1400-1413) serves R7 (`dispatchReady` 1021), R11 and R13.
`hostBoxPlan` (797-828) serves R7 and egress (R4). `whoApproves` (511) serves R6 and onboard (R4).

## The pattern that already exists

13 sibling modules already hold a command each: `src/usage-cli.ts`, `trace-cli.ts`, `onboard-cli.ts`, `init-cli.ts`,
`loop-cli.ts`, `plugin-cli.ts`, `plugin-pin-cli.ts`, `request-cli.ts`, `eval-cli.ts`, `egress-cli.ts`,
`coordinator-cli.ts`, `settings-cli.ts` (plus `src/cli.ts`, 98 lines, the process binding). Example:
`src/usage-cli.ts` exports `USAGE_HELP` and `usageCommand`. For such a command, app.ts keeps only R1 import, R2
`${USAGE_HELP}`, an R4 wrapper (`usage`, app.ts:234-245) and an R14 row. usage, trace, onboard, init, loop,
request, eval, egress, plugin, config and team follow it. R5, R6, R7 and R9-R13 keep their logic in app.ts.

## What a split along these lines would look like (not decided)

```
src/app.ts         R3 Io/Args + R14 registry/entry + the one help header     (~250 lines)
src/cli-common.ts  factoryHome, version, resolvedRun, projectRun, tokenStore, placesOf, PKG
src/spec-cli.ts    R5? + R6                                                  (~410 lines)
src/dispatch-cli.ts R7 (and hostBoxPlan, shared with egress)                 (~330 lines)
src/review-cli.ts  R9                                                        (~110 lines)
src/setup-cli.ts   R10 + R11 + R12                                           (~190 lines)
coordinator-cli.ts R13 joins the existing file
```

Facts that bear on it:

1. With `{ name, help, run }` exported per module, a new command would still add one import and one registry row.
   Only a self-registering list (or a directory scan) removes that last shared edit.
2. A new flag would still edit `Args` and `mainCli` unless each module parses its own words. `eval`, `egress` and
   the request commands already do that (`runCli` 1706-1716, `ownOptions` 1686-1704).
3. R7 is the composition root of the orchestrator. 15 of 52 commits edit it, and none of them adds a command. It is
   the largest part that changes for reasons other than "a new command".
4. `test/cli.test.ts` and `test/cli-doc.test.ts` call `runCli` and `COMMAND_NAMES`; both stay stable if app.ts keeps
   those exports.
