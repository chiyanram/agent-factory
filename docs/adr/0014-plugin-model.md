# 0014 · A small core with extension points, and a plugin for every outside tool

> Words: this record keeps the words it was written in. [GLOSSARY.md](../../GLOSSARY.md) maps each old word to today's ([ADR-0016](0016-adopt-the-software-factory-vocabulary.md)).

Status: accepted 2026-11-07 (operator, map #30: plugin model Q1–Q11). Extends ADR-0013 T2 and T3, and widens
ADR-0012 S18 from context sources to every outside tool.

## Context

The factory must work with many tools that differ by place:
- `gh` and `glab` for the forge;
- `acli` and the Atlassian MCP server for Jira and Confluence at work;
- `dtctl` for Dynatrace;
- `claude`, `copilot` and `opencode` as the agent;
- Discord for pings;
- the operator's own CLIs.

The core must not know any one of them. The operator asked for the Jenkins shape: a small core with extension points,
and plugins. The safety rules of ADR-0012 must hold whatever the plugin:
- no login reaches an LLM or the box;
- every posted text is cleaned (`src/core/post.ts`, #126);
- config never comes from the branch (S12).

## Decision

```
 coordinator (LLM) ── may only run: agent-factory fetch … · agent-factory request …
                         │
 ┌──────────── core (TypeScript, zero runtime deps) ────────────────────────────┐
 │ extension points: context.read · tracker.comment · tracker.create            │
 │                   forge.read · forge.write · notify · runner · box           │
 │ policy (allow | confirm | deny, cap per run) · post.ts cleaning              │
 │ execFile, no shell · env allow-list · timeout · output cap · sha256 check    │
 └──────┬───────┬───────┬────────────┬───────┬─────────┬───────────────┬────────┘
        ▼       ▼       ▼            ▼       ▼         ▼               ▼
       gh     glab    acli      mcp-bridge  dtctl   discord   claude · copilot · opencode · vm · laptop
   each plugin uses its own CLI login; the LLM and the box never see a plugin or its login
```

| # | decision | #30 |
|---|---|---|
| P1 | **A plugin is an executable.** `<exe> describe` returns its protocol, capabilities and declared writes. `<exe> call` reads one JSON request on stdin and prints one JSON sealed result on stdout; logs go to stderr. The core runs it with `execFile` (no shell), a timeout and an output cap. Bundled plugins use the same contract. | [Q1](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6701120918) |
| P2 | **Registered once, pinned.** `agent-factory plugin add <name or path>` runs `describe`, shows the declared writes, and records the absolute path and sha256 in `~/.factory/plugins.json`. Each call hashes the file again; a different hash is refused. No PATH scan at run time. | [Q2](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6701132265) |
| P3 | **Project config on the machine, in live layers.** `~/.factory/projects/<project>.json` maps each capability to a plugin and holds the write policy. Amended 2026-11-09 (#229; v4 D-F8, review choice 4 = B): the settings are three live layers, all outside the repo: the team's `teams/<team>/team.json`, read at the commit the project pins (`"team": "<team>@<commit>"`), the project file, and `user.json`, with the `FACTORY_*` variables as the machine layer. Each key has a class fixed in code, and a safety key only gets stricter in a lower layer. `team update` shows the change, checks it and moves the pin. `project init` may still copy a template once. Never a repo file. | [Q3](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6701145424) |
| P4 | **A CLI first; MCP behind one bridge.** Where a CLI covers a call, the plugin uses it. Otherwise one bundled `mcp-bridge` plugin is an MCP client on the host, with a fixed mapping from each capability op to one named tool. The LLM never sees an MCP tool list. | [Q4](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6701177029) |
| P5 | **Write defaults.** `tracker.comment`: allow, 5 per run. `tracker.create`: confirm, 1 per run. `forge.write`: the dispatcher only. `notify`: allow, 3 per run. No Jira status transition, assignee or field change. A plugin may only perform the writes it declared. | [Q5](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6701194265) |
| P6 | **The coordinator asks; a person confirms.** It runs `agent-factory request <capability> --file draft.json`. The core checks the schema, cleans every text field with `post.ts`, and applies the policy. On confirm, a person runs `agent-factory confirm <id>` behind the harness ask prompt, which shows the cleaned text. | [Q6](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6701204087) |
| P7 | **The runner is pure; the box runs it.** A runner plugin builds the argv and parses the output. The box plugin runs that argv inside the box. Claude Code and Copilot CLI must be supported; OpenCode is optional, on its GitHub Copilot provider. | [Q7](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6701261830) |
| P8 | **Versions as Terraform does.** One integer `protocol` major in every request and `describe`. The core supports N and N−1; any other major is refused at add or update time. Minors only add optional fields. No auto-update: `plugin update` re-runs `describe` and the test kit and shows changed writes. | [Q8](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6701302001) |
| P9 | **Forge I/O is a plugin; decisions stay in the core** (ADR-0010). `forge.read` and `forge.write` are separate. | [Q9](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6701346106) |
| P10 | **No network install in v1.** Only bundled plugins or a local path, pinned by sha256. | [Q10](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6701346106) |
| P11 | **Env allow-list only.** A plugin gets the trusted `PATH`, `HOME` and `LANG`, plus the names it declares. Never the model token (ADR-0012 S6). | [Q11](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6701346106) |

A contract test kit ships with the package: `agent-factory plugin test <path>`. It checks:
- the handshake and the schema of each result;
- bad input and unknown ops;
- one JSON object on stdout, and logs on stderr only;
- caps and timeouts;
- an env canary;
- write fidelity: the text sent to the CLI equals the given text, byte for byte;
- that no token pattern appears in a result.

## Why

- **An executable, not loaded code:** any language, and the core stays free of plugin dependencies. Jenkins gives each
  plugin "its own `ClassLoader`" and still has linkage errors. Backstage warns of "multiple versions of the same
  package being installed".
- **One JSON object, not text lines:** CVE-2020-5260 let an encoded newline "inject unintended values into the
  credential helper protocol stream".
- **Pinned by hash:** tj-actions (CVE-2025-30066): "Attackers retroactively modified multiple version tags to
  reference a malicious commit". Terraform checks "the checksums" in `.terraform.lock.hcl`.
- **MCP as a backend only:** MCP tools are "model-controlled", and "Attackers can execute any command with MCP client
  privileges". gh-aw also narrows MCP: "Custom MCP servers should be read-only".
- **Writes requested, then performed by code:** gh-aw runs the agent "without giving the agentic portion of the
  workflow any write permissions". It caps each write type, for example "Create GitHub issues (max: 1)".
- **Versions:** Terraform: "Minor versions of the protocol are additive." It is the only compared model that checks
  compatibility and never changes a plugin under the user.

## Alternatives rejected

| option | why rejected |
|---|---|
| plugins as TypeScript modules loaded into the core (Jenkins, Backstage) | TypeScript only; plugin dependencies enter the core |
| MCP as the plugin contract | built for LLM tool calls; needs a JSON-RPC session and OAuth in the core |
| gRPC (Terraform's transport) | needs runtime dependencies |
| PATH scan at run time (`kubectl-*`, `gh-*`) | runs any file found on PATH; Krew plugins "are not audited for security" |
| project config in the repo | a branch could loosen its own write policy (S12, #87) |
| the coordinator runs `acli` or `gh` itself, or holds MCP tools | an LLM that reads untrusted Jira text would hold a login that can write |
| the runner plugin runs the agent itself | one plugin that forgets the box runs an agent on the host |
| latest-only plugins, or auto-update | files change after review (Jenkins update center; Claude Code: "the files you reviewed can change on disk") |
| network install of third-party plugins in v1 | no review step; the tj-actions lesson |

## Consequences

- #134 builds the contract, `plugins.json`, the project file, the policy, `request` and `confirm`, and the test kit.
- The bash scripts are ported onto these plugins (#138). No new bash.
- The core cannot stop a plugin binary from calling its CLI by itself, outside `post.ts`. The write-fidelity test and
  local, pinned, reviewed plugins are the guard.
- The hash pins the plugin, not the CLI it calls. A plugin must find its CLI on the trusted PATH only, as `hgit` does
  (#87).
- Claude's `--bare` "doesn't use your subscription login", so the runner does not use it with the Max token. #110
  keeps the repo's own hooks out of the writer's settings. If `--bare` becomes the default for `-p`, the Max token
  stops working (watch item on #136).
- UNVERIFIED, to confirm at `plugin add` before those plugins are built:
  - the `dtctl` problems command;
  - `acli` Confluence support and the `workitem create` flags;
  - the Atlassian MCP tool names;
  - whether the work laptop allows unsigned executables.

## Sources

Map #30 comments of 2026-11-07 (linked above). The full research with every source:
[#134 evidence comment](https://github.com/chiyanram/agent-factory/issues/134#issuecomment-6701367545). Also
ADR-0010, 0012 and 0013.
