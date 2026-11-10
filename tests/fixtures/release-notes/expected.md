## [0.2.0](https://github.com/chiyanram/agent-factory/compare/v0.1.0...v0.2.0) (DATE)

### ⚠️ Breaking changes

* **forge** — FACTORY_FORGE replaces FACTORY_GLAB.

### ✨ Features

* **cli** — the dispatcher runs one locked pass · [#103](https://github.com/chiyanram/agent-factory/issues/103) (PR [#154](https://github.com/chiyanram/agent-factory/pull/154))
* **forge** — one Forge seam for both forges · [#140](https://github.com/chiyanram/agent-factory/issues/140) (PR [#160](https://github.com/chiyanram/agent-factory/pull/160))
* **setup** — setup reads the rules from [chiyanram/skills#31](https://github.com/chiyanram/skills/issues/31) · PR [#163](https://github.com/chiyanram/agent-factory/pull/163)

### 🐛 Fixes

* **box** — a box never starts with an expired token · [#136](https://github.com/chiyanram/agent-factory/issues/136) (PR [#155](https://github.com/chiyanram/agent-factory/pull/155))

### ⚡ Performance

* **dispatch** — poll each forge once per pass · PR [#162](https://github.com/chiyanram/agent-factory/pull/162)

Install: `npm i -g https://github.com/chiyanram/agent-factory/releases/download/v0.2.0/chiyanram-agent-factory-0.2.0.tgz`
