# Changelog

What agent-factory ships, by version. semantic-release writes this file from the commit messages on `main`;
do not edit it by hand.

## [0.33.0](https://github.com/chiyanram/agent-factory/compare/v0.32.2...v0.33.0) (2026-11-10)

### ✨ Features

* **process** — one process plugin per project: a second one fails config check and the run · [#426](https://github.com/chiyanram/agent-factory/issues/426) (PR [#442](https://github.com/chiyanram/agent-factory/pull/442))
* **process** — one shared finding record, the verify pass lowers grades only, retro actions as json · [#425](https://github.com/chiyanram/agent-factory/issues/425) (PR [#439](https://github.com/chiyanram/agent-factory/pull/439))
* **process** — role cards: guardrail ids from a closed list, an edit path scope checked on the run's commits, next dropped · [#424](https://github.com/chiyanram/agent-factory/issues/424) (PR [#440](https://github.com/chiyanram/agent-factory/pull/440))

### 🐛 Fixes

* **dispatch** — the loop runs the next pass at once after a step it ran itself · [#445](https://github.com/chiyanram/agent-factory/issues/445) (PR [#446](https://github.com/chiyanram/agent-factory/pull/446))
* **ready** — safe read-only evidence programs by default, refuse evidence that cannot prove its criterion, keep a reworked ticket moving · [#444](https://github.com/chiyanram/agent-factory/issues/444) (PR [#447](https://github.com/chiyanram/agent-factory/pull/447))

Install: `npm i -g https://github.com/chiyanram/agent-factory/releases/download/v0.33.0/chiyanram-agent-factory-0.33.0.tgz`

## [0.32.2](https://github.com/chiyanram/agent-factory/compare/v0.32.1...v0.32.2) (2026-11-10)

### 🐛 Fixes

* **box** — give each srt run a short temp folder, so srt's sockets fit macOS's limit · [#62](https://github.com/chiyanram/agent-factory/issues/62) (PR [#437](https://github.com/chiyanram/agent-factory/pull/437))
* **dispatch** — pick test-first from the lanes file's test_first, not the lane name "bug" · [#417](https://github.com/chiyanram/agent-factory/issues/417) (PR [#436](https://github.com/chiyanram/agent-factory/pull/436))

Install: `npm i -g https://github.com/chiyanram/agent-factory/releases/download/v0.32.2/chiyanram-agent-factory-0.32.2.tgz`

## [0.32.1](https://github.com/chiyanram/agent-factory/compare/v0.32.0...v0.32.1) (2026-11-10)

### 🐛 Fixes

* **box** — every srt run gets its own writable TMPDIR inside its private home · [#62](https://github.com/chiyanram/agent-factory/issues/62) (PR [#415](https://github.com/chiyanram/agent-factory/pull/415))

Install: `npm i -g https://github.com/chiyanram/agent-factory/releases/download/v0.32.1/chiyanram-agent-factory-0.32.1.tgz`

## [0.32.0](https://github.com/chiyanram/agent-factory/compare/v0.31.0...v0.32.0) (2026-11-10)

### ✨ Features

* **spec** — on a personal project the git host issue is the spec · [#381](https://github.com/chiyanram/agent-factory/issues/381) (PR [#399](https://github.com/chiyanram/agent-factory/pull/399))

### 🐛 Fixes

* **dispatch** — a writer run that stops records and logs why, even before a PR exists · [#62](https://github.com/chiyanram/agent-factory/issues/62) (PR [#408](https://github.com/chiyanram/agent-factory/pull/408))
* **onboard** — the engine owns the project rules and drops a false absence claim instead of refusing the brief · [#383](https://github.com/chiyanram/agent-factory/issues/383) (PR [#403](https://github.com/chiyanram/agent-factory/pull/403))

Install: `npm i -g https://github.com/chiyanram/agent-factory/releases/download/v0.32.0/chiyanram-agent-factory-0.32.0.tgz`

## [0.31.0](https://github.com/chiyanram/agent-factory/compare/v0.30.2...v0.31.0) (2026-11-10)

### ✨ Features

* **settings** — every command reads the project's git host and clone from the project file · [#382](https://github.com/chiyanram/agent-factory/issues/382) (PR [#394](https://github.com/chiyanram/agent-factory/pull/394))

### 🐛 Fixes

* **onboard** — the brief carries the repo's AGENTS.md MUSTs and a verified line must be backed by its cite · [#383](https://github.com/chiyanram/agent-factory/issues/383) (PR [#393](https://github.com/chiyanram/agent-factory/pull/393))

Install: `npm i -g https://github.com/chiyanram/agent-factory/releases/download/v0.31.0/chiyanram-agent-factory-0.31.0.tgz`

## [0.30.2](https://github.com/chiyanram/agent-factory/compare/v0.30.1...v0.30.2) (2026-11-10)

### 🐛 Fixes

* **forge** — back off on a GitHub rate limit instead of retrying, and spend fewer points per pass · [#62](https://github.com/chiyanram/agent-factory/issues/62) (PR [#388](https://github.com/chiyanram/agent-factory/pull/388))

Install: `npm i -g https://github.com/chiyanram/agent-factory/releases/download/v0.30.2/chiyanram-agent-factory-0.30.2.tgz`

## [0.30.1](https://github.com/chiyanram/agent-factory/compare/v0.30.0...v0.30.1) (2026-11-10)

### 🐛 Fixes

* **process** — a role card's hand-off may name a question's fields · [#62](https://github.com/chiyanram/agent-factory/issues/62) (PR [#379](https://github.com/chiyanram/agent-factory/pull/379))

Install: `npm i -g https://github.com/chiyanram/agent-factory/releases/download/v0.30.1/chiyanram-agent-factory-0.30.1.tgz`

## [0.30.0](https://github.com/chiyanram/agent-factory/compare/v0.29.0...v0.30.0) (2026-11-10)

### ✨ Features

* **setup** — agent-factory init sets up a laptop and a project in one guided run · [#369](https://github.com/chiyanram/agent-factory/issues/369) (PR [#377](https://github.com/chiyanram/agent-factory/pull/377))

Install: `npm i -g https://github.com/chiyanram/agent-factory/releases/download/v0.30.0/chiyanram-agent-factory-0.30.0.tgz`

## [0.29.0](https://github.com/chiyanram/agent-factory/compare/v0.28.0...v0.29.0) (2026-11-10)

### ✨ Features

* **box** — the srt runner allows back toolchain managers read-only · [#371](https://github.com/chiyanram/agent-factory/issues/371) (PR [#372](https://github.com/chiyanram/agent-factory/pull/372))

Install: [build and install the packed tarball](https://github.com/chiyanram/agent-factory/blob/v0.29.0/GUIDE.md#install-a-pinned-version)

## [0.28.0](https://github.com/chiyanram/agent-factory/compare/v0.27.0...v0.28.0) (2026-11-10)

### ✨ Features

* **box** — run the implementer inside srt on the work laptop · [#114](https://github.com/chiyanram/agent-factory/issues/114) (PR [#360](https://github.com/chiyanram/agent-factory/pull/360))

### 🐛 Fixes

* **box** — the srt runner hides the whole home and allows back only the agent CLI and Node · [#114](https://github.com/chiyanram/agent-factory/issues/114) (PR [#362](https://github.com/chiyanram/agent-factory/pull/362))

Install: `npm i -g github:chiyanram/agent-factory#v0.28.0`

## [0.27.0](https://github.com/chiyanram/agent-factory/compare/v0.26.0...v0.27.0) (2026-11-10)

### ✨ Features

* **dispatch** — a human's command starts the orchestrator loop, which ends by itself; no cron · [#305](https://github.com/chiyanram/agent-factory/issues/305) (PR [#311](https://github.com/chiyanram/agent-factory/pull/311))
* **dispatch** — cap spend per ticket, per project-day and per window share · [#131](https://github.com/chiyanram/agent-factory/issues/131) (PR [#294](https://github.com/chiyanram/agent-factory/pull/294))
* **dispatch** — flag a late orchestrator in status, and merge the default branch in on a conflict · [#103](https://github.com/chiyanram/agent-factory/issues/103) (PR [#259](https://github.com/chiyanram/agent-factory/pull/259))
* **dispatch** — record every run's tokens and cost, and add the usage command · [#131](https://github.com/chiyanram/agent-factory/issues/131) (PR [#286](https://github.com/chiyanram/agent-factory/pull/286))
* **dispatch** — run the design review before the approval and the cleanup run after the implementer · [#236](https://github.com/chiyanram/agent-factory/issues/236) (PR [#313](https://github.com/chiyanram/agent-factory/pull/313))
* **dispatch** — runs at once and run hours for the orchestrator · [#299](https://github.com/chiyanram/agent-factory/issues/299) (PR [#308](https://github.com/chiyanram/agent-factory/pull/308))
* **dispatch** — the run record keeps each lens's unique findings, and ADR-0004 says what is built · [#237](https://github.com/chiyanram/agent-factory/issues/237) (PR [#333](https://github.com/chiyanram/agent-factory/pull/333))
* **dispatch** — usage shows spend by run kind · [#337](https://github.com/chiyanram/agent-factory/issues/337) (PR [#338](https://github.com/chiyanram/agent-factory/pull/338))
* **dispatch** — usage splits a review round into finder and verify pass · [#337](https://github.com/chiyanram/agent-factory/issues/337) (PR [#340](https://github.com/chiyanram/agent-factory/pull/340))
* **egress** — agent-factory egress check runs the live egress checks in a real runner · [#130](https://github.com/chiyanram/agent-factory/issues/130) (PR [#292](https://github.com/chiyanram/agent-factory/pull/292))
* **egress** — plan and read the live egress checks, with a Node probe for the runner · [#130](https://github.com/chiyanram/agent-factory/issues/130) (PR [#291](https://github.com/chiyanram/agent-factory/pull/291))
* **egress** — refuse a git host on the egress allowlist · [#130](https://github.com/chiyanram/agent-factory/issues/130) (PR [#290](https://github.com/chiyanram/agent-factory/pull/290))
* **eval** — CI proof check for a change to a reviewer input · [#217](https://github.com/chiyanram/agent-factory/issues/217) (PR [#289](https://github.com/chiyanram/agent-factory/pull/289))
* **lint** — check each AGENTS.md MUST that code can check · [#221](https://github.com/chiyanram/agent-factory/issues/221) (PR [#284](https://github.com/chiyanram/agent-factory/pull/284))
* **onboard** — stage a project's brief and glossary in the project home for a human, and hand them to every run · [#235](https://github.com/chiyanram/agent-factory/issues/235) (PR [#314](https://github.com/chiyanram/agent-factory/pull/314))
* **plugin** — add plugin update <project> <name@marketplace>, which shows the change, runs config check, then moves the pin · [#232](https://github.com/chiyanram/agent-factory/issues/232) (PR [#293](https://github.com/chiyanram/agent-factory/pull/293))
* **plugin** — fetch a plugin version from its marketplace's clone into the factory home's store, by its hash · [#232](https://github.com/chiyanram/agent-factory/issues/232) (PR [#288](https://github.com/chiyanram/agent-factory/pull/288))
* **plugin** — hand the pinned plugins to the writer with --plugin-dir and record their hashes · [#232](https://github.com/chiyanram/agent-factory/issues/232) (PR [#297](https://github.com/chiyanram/agent-factory/pull/297))
* **plugin** — pin each listed plugin by commit and hash in the factory home, and check the hash before every run · [#232](https://github.com/chiyanram/agent-factory/issues/232) (PR [#287](https://github.com/chiyanram/agent-factory/pull/287))
* **plugin** — read the lanes and the review baseline from the process plugin, with a built-in default · [#232](https://github.com/chiyanram/agent-factory/issues/232) (PR [#261](https://github.com/chiyanram/agent-factory/pull/261))
* **review** — a finding carries its lens, grade and evidence, and a lane its lens count · [#237](https://github.com/chiyanram/agent-factory/issues/237) (PR [#321](https://github.com/chiyanram/agent-factory/pull/321))
* **review** — a Spec finding quotes the approved spec's criterion it fails · [#219](https://github.com/chiyanram/agent-factory/issues/219) (PR [#309](https://github.com/chiyanram/agent-factory/pull/309))
* **review** — add a Martian category to each finding, and keep its severity · [#218](https://github.com/chiyanram/agent-factory/issues/218) (PR [#304](https://github.com/chiyanram/agent-factory/pull/304))
* **review** — one finder run per picked lens, merged, then one verify pass · [#237](https://github.com/chiyanram/agent-factory/issues/237) (PR [#332](https://github.com/chiyanram/agent-factory/pull/332))
* **review** — pick a round's lenses by blast radius, and merge their findings by file:line and rule · [#237](https://github.com/chiyanram/agent-factory/issues/237) (PR [#310](https://github.com/chiyanram/agent-factory/pull/310))
* **review** — pin the reviewer's and the judge's models to full ids, and refuse an alias · [#213](https://github.com/chiyanram/agent-factory/issues/213) (PR [#303](https://github.com/chiyanram/agent-factory/pull/303))
* **review** — record the automated review's acted-on rate, and show it in usage · [#220](https://github.com/chiyanram/agent-factory/issues/220) (PR [#312](https://github.com/chiyanram/agent-factory/pull/312))
* **review** — send the engine's floor ahead of every find and verify pass, whatever instructions replace the default · [#232](https://github.com/chiyanram/agent-factory/issues/232) (PR [#302](https://github.com/chiyanram/agent-factory/pull/302))
* **review** — the project's lenses in the settings, and what each finder is given · [#237](https://github.com/chiyanram/agent-factory/issues/237) (PR [#331](https://github.com/chiyanram/agent-factory/pull/331))
* **settings** — every module reads the resolved settings through one adapter · [#254](https://github.com/chiyanram/agent-factory/issues/254) (PR [#258](https://github.com/chiyanram/agent-factory/pull/258))
* **writer** — ask every open question at once, as one round of choices with a recommendation · [#320](https://github.com/chiyanram/agent-factory/issues/320) (PR [#325](https://github.com/chiyanram/agent-factory/pull/325))
* **writer** — post the implementer's PR body as cleaned Markdown · [#335](https://github.com/chiyanram/agent-factory/issues/335) (PR [#336](https://github.com/chiyanram/agent-factory/pull/336))

### 🐛 Fixes

* **dispatch** — count a failed review round's spend toward the caps · [#131](https://github.com/chiyanram/agent-factory/issues/131) (PR [#300](https://github.com/chiyanram/agent-factory/pull/300))
* **onboard** — read the project's plugins and the pinned model, and drop ownHelper, so main builds again · [#235](https://github.com/chiyanram/agent-factory/issues/235) (PR [#318](https://github.com/chiyanram/agent-factory/pull/318))
* **release** — leave git trailers out of breaking-change release notes · [#343](https://github.com/chiyanram/agent-factory/issues/343) (PR [#349](https://github.com/chiyanram/agent-factory/pull/349))
* **review** — name the rulebook setting through settingName, so main's no-direct-read test passes · [#254](https://github.com/chiyanram/agent-factory/issues/254) (PR [#283](https://github.com/chiyanram/agent-factory/pull/283))

Install: `npm i -g github:chiyanram/agent-factory#v0.27.0`

## [0.26.0](https://github.com/chiyanram/agent-factory/compare/v0.25.0...v0.26.0) (2026-11-09)

### ✨ Features

* **plugin** — rename the connector map to connectors and add the plugins list key · [#232](https://github.com/chiyanram/agent-factory/issues/232) (PR [#257](https://github.com/chiyanram/agent-factory/pull/257))

Install: `npm i -g github:chiyanram/agent-factory#v0.26.0`

## [0.25.0](https://github.com/chiyanram/agent-factory/compare/v0.24.0...v0.25.0) (2026-11-09)

### ✨ Features

* **dispatch** — set the lane by code from the planned files and the diff, raise only, with an approval floor · [#230](https://github.com/chiyanram/agent-factory/issues/230) (PR [#253](https://github.com/chiyanram/agent-factory/pull/253))

Install: `npm i -g github:chiyanram/agent-factory#v0.25.0`

## [0.24.0](https://github.com/chiyanram/agent-factory/compare/v0.23.0...v0.24.0) (2026-11-09)

### ✨ Features

* **ready** — judge files (S4), fewer test cases (S1), and a human waiver scoped to the head · [#231](https://github.com/chiyanram/agent-factory/issues/231) (PR [#252](https://github.com/chiyanram/agent-factory/pull/252))

Install: `npm i -g github:chiyanram/agent-factory#v0.24.0`

## [0.23.0](https://github.com/chiyanram/agent-factory/compare/v0.22.0...v0.23.0) (2026-11-09)

### ✨ Features

* **eval** — agent-factory eval reviewer with the judge, the results file and the $100 cap · [#215](https://github.com/chiyanram/agent-factory/issues/215) (PR [#251](https://github.com/chiyanram/agent-factory/pull/251))
* **settings** — resolve team, project and user layers where safety keys only get stricter · [#229](https://github.com/chiyanram/agent-factory/issues/229) (PR [#250](https://github.com/chiyanram/agent-factory/pull/250))

Install: `npm i -g github:chiyanram/agent-factory#v0.23.0`

## [0.22.0](https://github.com/chiyanram/agent-factory/compare/v0.21.0...v0.22.0) (2026-11-09)

### ✨ Features

* **ready** — keep a failed ready check's output, so the rework run sees why it failed · [#199](https://github.com/chiyanram/agent-factory/issues/199) (PR [#249](https://github.com/chiyanram/agent-factory/pull/249))

Install: `npm i -g github:chiyanram/agent-factory#v0.22.0`

## [0.21.0](https://github.com/chiyanram/agent-factory/compare/v0.20.1...v0.21.0) (2026-11-09)

### ✨ Features

* **dispatch** — START and approval records; nothing starts without a human, and the AI can never approve · [#227](https://github.com/chiyanram/agent-factory/issues/227) (PR [#248](https://github.com/chiyanram/agent-factory/pull/248))

Install: `npm i -g github:chiyanram/agent-factory#v0.21.0`

## [0.20.1](https://github.com/chiyanram/agent-factory/compare/v0.20.0...v0.20.1) (2026-11-09)

### 🐛 Fixes

* **plugin** — keep a UTF-8 character whole when a plugin's output splits it · [#246](https://github.com/chiyanram/agent-factory/issues/246) (PR [#247](https://github.com/chiyanram/agent-factory/pull/247))

Install: `npm i -g github:chiyanram/agent-factory#v0.20.1`

## [0.20.0](https://github.com/chiyanram/agent-factory/compare/v0.19.0...v0.20.0) (2026-11-09)

### ✨ Features

* **review** — the review pack always carries the baseline review checks · [#226](https://github.com/chiyanram/agent-factory/issues/226) (PR [#244](https://github.com/chiyanram/agent-factory/pull/244))

Install: `npm i -g github:chiyanram/agent-factory#v0.20.0`

## [0.19.0](https://github.com/chiyanram/agent-factory/compare/v0.18.0...v0.19.0) (2026-11-09)

### ✨ Features

* **writer** — stop a silent run at the stall time; a failed step backs off before it retries · [#228](https://github.com/chiyanram/agent-factory/issues/228) (PR [#243](https://github.com/chiyanram/agent-factory/pull/243))

Install: `npm i -g github:chiyanram/agent-factory#v0.19.0`

## [0.18.0](https://github.com/chiyanram/agent-factory/compare/v0.17.0...v0.18.0) (2026-11-09)

### ✨ Features

* **review** — the reviewer reads the approved spec and design from the spec store · [#224](https://github.com/chiyanram/agent-factory/issues/224) (PR [#242](https://github.com/chiyanram/agent-factory/pull/242))

Install: `npm i -g github:chiyanram/agent-factory#v0.18.0`

## [0.17.0](https://github.com/chiyanram/agent-factory/compare/v0.16.0...v0.17.0) (2026-11-09)

### ✨ Features

* **notify** — Discord pings when a ticket needs a person · [#119](https://github.com/chiyanram/agent-factory/issues/119) (PR [#211](https://github.com/chiyanram/agent-factory/pull/211))

### 🐛 Fixes

* **writer** — every writer prompt says to run subagents and commands in the foreground · [#192](https://github.com/chiyanram/agent-factory/issues/192) (PR [#210](https://github.com/chiyanram/agent-factory/pull/210))

Install: `npm i -g github:chiyanram/agent-factory#v0.17.0`

## [0.16.0](https://github.com/chiyanram/agent-factory/compare/v0.15.1...v0.16.0) (2026-11-08)

### ✨ Features

* **writer** — a completion window: a writer that hangs after a valid report is decided from the report · [#182](https://github.com/chiyanram/agent-factory/issues/182) (PR [#208](https://github.com/chiyanram/agent-factory/pull/208))

Install: `npm i -g github:chiyanram/agent-factory#v0.16.0`

## [0.15.1](https://github.com/chiyanram/agent-factory/compare/v0.15.0...v0.15.1) (2026-11-08)

### 🐛 Fixes

* **writer** — the writer loads no settings from the branch, and the push refuses a change to them · [#110](https://github.com/chiyanram/agent-factory/issues/110) (PR [#207](https://github.com/chiyanram/agent-factory/pull/207))

Install: `npm i -g github:chiyanram/agent-factory#v0.15.1`

## [0.15.0](https://github.com/chiyanram/agent-factory/compare/v0.14.1...v0.15.0) (2026-11-08)

### ✨ Features

* **ready** — the floor guard: a diff that weakens tests or silences a checker fails the ready check · [#190](https://github.com/chiyanram/agent-factory/issues/190) (PR [#203](https://github.com/chiyanram/agent-factory/pull/203))

Install: `npm i -g github:chiyanram/agent-factory#v0.15.0`

## [0.14.1](https://github.com/chiyanram/agent-factory/compare/v0.14.0...v0.14.1) (2026-11-08)

### 🐛 Fixes

* **loop** — reconcile keeps a writer's worktree that holds unlanded work · [#189](https://github.com/chiyanram/agent-factory/issues/189) (PR [#201](https://github.com/chiyanram/agent-factory/pull/201))

Install: `npm i -g github:chiyanram/agent-factory#v0.14.1`

## [0.14.0](https://github.com/chiyanram/agent-factory/compare/v0.13.0...v0.14.0) (2026-11-08)

### ✨ Features

* **writer** — rework and ci runs in the box, with the project's lint hook · [#171](https://github.com/chiyanram/agent-factory/issues/171) (PR [#193](https://github.com/chiyanram/agent-factory/pull/193))

Install: `npm i -g github:chiyanram/agent-factory#v0.14.0`

## [0.13.0](https://github.com/chiyanram/agent-factory/compare/v0.12.0...v0.13.0) (2026-11-08)

### ✨ Features

* **plugin** — the forge as a plugin, and the kit's write-fidelity check ([#134](https://github.com/chiyanram/agent-factory/issues/134) part C) · PR [#194](https://github.com/chiyanram/agent-factory/pull/194)

Install: `npm i -g github:chiyanram/agent-factory#v0.13.0`

## [0.12.0](https://github.com/chiyanram/agent-factory/compare/v0.11.0...v0.12.0) (2026-11-08)

### ✨ Features

* **writer** — every writer commit carries "Agent: writer"; the host push refuses one without it · [#128](https://github.com/chiyanram/agent-factory/issues/128) (PR [#191](https://github.com/chiyanram/agent-factory/pull/191))

Install: `npm i -g github:chiyanram/agent-factory#v0.12.0`

## [0.11.0](https://github.com/chiyanram/agent-factory/compare/v0.10.0...v0.11.0) (2026-11-08)

### ✨ Features

* **plugin** — the write policy, request and confirm, and project init ([#134](https://github.com/chiyanram/agent-factory/issues/134) part B) · PR [#184](https://github.com/chiyanram/agent-factory/pull/184)

Install: `npm i -g github:chiyanram/agent-factory#v0.11.0`

## [0.10.0](https://github.com/chiyanram/agent-factory/compare/v0.9.0...v0.10.0) (2026-11-08)

### ✨ Features

* **plugin** — the plugin contract, a pinned registry and the contract test kit ([#134](https://github.com/chiyanram/agent-factory/issues/134) part A) · PR [#174](https://github.com/chiyanram/agent-factory/pull/174)

Install: `npm i -g github:chiyanram/agent-factory#v0.10.0`

## [0.9.0](https://github.com/chiyanram/agent-factory/compare/v0.8.0...v0.9.0) (2026-11-08)

### ✨ Features

* **writer** — the dispatcher's writer runs test-first and fix in the box, and the host pushes and posts · [#113](https://github.com/chiyanram/agent-factory/issues/113) (PR [#173](https://github.com/chiyanram/agent-factory/pull/173))

Install: `npm i -g github:chiyanram/agent-factory#v0.9.0`

## [0.8.0](https://github.com/chiyanram/agent-factory/compare/v0.7.0...v0.8.0) (2026-11-08)

### ✨ Features

* **coordinator** — the coordinator's wall as harness settings, set up and started by agent-factory · [#106](https://github.com/chiyanram/agent-factory/issues/106) (PR [#172](https://github.com/chiyanram/agent-factory/pull/172))

Install: `npm i -g github:chiyanram/agent-factory#v0.8.0`

## [0.7.0](https://github.com/chiyanram/agent-factory/compare/v0.6.0...v0.7.0) (2026-11-07)

### ✨ Features

* **box** — box build, one egress proxy per project, and the vm box on the dispatcher · [#113](https://github.com/chiyanram/agent-factory/issues/113) (PR [#170](https://github.com/chiyanram/agent-factory/pull/170))
* **push** — the host push refuses any commit that touches CI config · [#115](https://github.com/chiyanram/agent-factory/issues/115) (PR [#169](https://github.com/chiyanram/agent-factory/pull/169))

### 🐛 Fixes

* **git** — hgit and hostGit skip the system config when GIT_CONFIG_NOSYSTEM is set · [#167](https://github.com/chiyanram/agent-factory/issues/167) (PR [#168](https://github.com/chiyanram/agent-factory/pull/168))

Install: `npm i -g github:chiyanram/agent-factory#v0.7.0`

## [0.6.0](https://github.com/chiyanram/agent-factory/compare/v0.5.0...v0.6.0) (2026-11-07)

### ✨ Features

* **cli** — the loop commands, the lint hook and the repo checks in TypeScript ([#138](https://github.com/chiyanram/agent-factory/issues/138) part 3) · PR [#166](https://github.com/chiyanram/agent-factory/pull/166)

Install: `npm i -g github:chiyanram/agent-factory#v0.6.0`

## [0.5.0](https://github.com/chiyanram/agent-factory/compare/v0.4.0...v0.5.0) (2026-11-07)

### ✨ Features

* **forge** — openChange: the host opens a draft change after a ticket's first push · [#164](https://github.com/chiyanram/agent-factory/issues/164) (PR [#165](https://github.com/chiyanram/agent-factory/pull/165))

Install: `npm i -g github:chiyanram/agent-factory#v0.5.0`

## [0.4.0](https://github.com/chiyanram/agent-factory/compare/v0.3.0...v0.4.0) (2026-11-07)

### ✨ Features

* **cli** — the ready check and the local verifier, in a fresh box ([#138](https://github.com/chiyanram/agent-factory/issues/138) part 2; [#91](https://github.com/chiyanram/agent-factory/issues/91)) · PR [#163](https://github.com/chiyanram/agent-factory/pull/163)

Install: `npm i -g github:chiyanram/agent-factory#v0.4.0`

## [0.3.0](https://github.com/chiyanram/agent-factory/compare/v0.2.0...v0.3.0) (2026-11-07)

### ✨ Features

* **box** — the vm box: factory-box image and a Box over the docker CLI, run under Sysbox · [#113](https://github.com/chiyanram/agent-factory/issues/113) (PR [#160](https://github.com/chiyanram/agent-factory/pull/160))

Install: `npm i -g github:chiyanram/agent-factory#v0.3.0`

## [0.2.0](https://github.com/chiyanram/agent-factory/compare/v0.1.0...v0.2.0) (2026-11-07)

### Features

* **cli:** port the reviewer to TypeScript ([#138](https://github.com/chiyanram/agent-factory/issues/138) part 1; [#117](https://github.com/chiyanram/agent-factory/issues/117), [#118](https://github.com/chiyanram/agent-factory/issues/118)) ([#159](https://github.com/chiyanram/agent-factory/issues/159)) ([36c670d](https://github.com/chiyanram/agent-factory/commit/36c670dc52d0cd4f9cf9ac80a4a78ff777a0d625)), closes [#91](https://github.com/chiyanram/agent-factory/issues/91)

## [0.1.0](https://github.com/chiyanram/agent-factory/compare/v0.0.0...v0.1.0) (2026-11-07)

### Features

* **cli:** the dispatcher: one decision table with a stop on every row, run records, one locked pass ([#103](https://github.com/chiyanram/agent-factory/issues/103)) ([#154](https://github.com/chiyanram/agent-factory/issues/154)) ([756a6a5](https://github.com/chiyanram/agent-factory/commit/756a6a5ff215e85deffda7adc8999ef188be07cc)), closes [#113](https://github.com/chiyanram/agent-factory/issues/113) [#138](https://github.com/chiyanram/agent-factory/issues/138)
* **setup:** agent-factory setup stores the box's model-only claude token; a box never starts with an expired one ([#136](https://github.com/chiyanram/agent-factory/issues/136)) ([#155](https://github.com/chiyanram/agent-factory/issues/155)) ([45d7420](https://github.com/chiyanram/agent-factory/commit/45d7420560137f32a3270bdb4eaabb7ad228f30e))
