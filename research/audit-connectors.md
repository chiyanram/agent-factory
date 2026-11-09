# Audit 3 · connectors (#265, map #262)

Audits the **target design**: ADR-0014 P1–P11, DESIGN §5 "Connectors", GLOSSARY "Connector".
Code is cited only to check a claim. Sources read 2026-11-09. Baseline: skills#210 (2026-11-06).

**About skills#210.** It has no MCP, connector or plugin-protocol section (0 hits for "mcp"). It touches this area only
through gh-aw: writes buffered as safe outputs, caps per write type, protected files, staged dry-run. So most rows say
"no — #210 silent". A row says "no — agrees" where #210 speaks and says the same.

## Verdict table

| # | decision (short) | verdict | differs from skills#210 |
|---|---|---|---|
| P1 | connector = executable, `describe` / `call`, one JSON in, one JSON out | **change** (scope: no inbound connector kind) | no — #210 silent |
| P2 | registered once, pinned by sha256, no PATH scan | refine (ADR text says "file"; code hashes the tree; interpreter not pinned) | no — #210 silent |
| P3 | project config on the machine, live layers, never a repo file | keep | no — agrees (protected files) |
| P4 | CLI first; MCP behind one bridge; LLM never sees an MCP tool list | **change** (pin and sandbox the MCP servers the bridge runs; fix the stale "why not MCP" reason) | no — #210 silent |
| P5 | write defaults and caps per run; only declared writes | keep | no — agrees (gh-aw caps) |
| P6 | coordinator requests; core cleans and applies policy; a person confirms | keep | no — agrees (gh-aw safe outputs) |
| P7 | runner is pure (argv + parse); the box runs it | keep | no — #210 silent |
| P8 | one integer protocol major, N and N−1, minors additive | keep | no — #210 silent |
| P9 | forge I/O is a connector; decisions stay in the core | keep | no — #210 silent |
| P10 | no network install in v1 | keep | no — #210 silent |
| P11 | env allow-list only | keep | no — #210 silent |
| Q | executable per connector vs MCP servers as the connector protocol | keep the executable and the own contract; MCP stays a backend | no — #210 silent |

---

## P1 · A connector is an executable — change (scope)

**Keep the shape.** Every compared system runs an outside program and talks over stdin/stdout:
- git credential helpers: "Credential helpers are programs executed by Git"; one operation argument (`get`, `store`,
  `erase`). <https://git-scm.com/docs/gitcredentials>
- Docker: "Credential helpers can be any program or script that implements the credential helper protocol." "The `get`
  command writes a JSON payload to `STDOUT`." <https://docs.docker.com/reference/cli/docker/login/>
- Claude Code hooks: "For command hooks, input arrives on stdin." "Print nothing but the JSON object to stdout."
  <https://code.claude.com/docs/en/hooks>
- MCP stdio: "The client launches the MCP server as a subprocess." "The server MUST NOT write anything to its `stdout`
  that is not a valid MCP message." Logs go to stderr.
  <https://modelcontextprotocol.io/specification/2025-11-25/basic/transports>
- go-plugin (Terraform): "launching subprocesses and communicating over RPC"; "Plugins can't crash your host process."
  <https://github.com/hashicorp/go-plugin>

`src/core/plugin/contract.ts` matches P1: one JSON object on stdout, a sealed `kind`, logs on stderr.

**The gap.** GLOSSARY and DESIGN §5 now call five things connectors: front door, approval, gate, agent CLI, runner.
ADR-0014 has only outbound, request–reply extension points (`contract.ts` `EXTENSION_POINTS`). A front door such as the
Discord bot *receives* messages. One-shot `call` cannot hold a listener. Industry gives inbound parts their own shape:
- MCP 2026-07-28 adds `subscriptions/listen`: "a single long-lived POST-response stream for opted-in server-to-client
  change notifications." <https://modelcontextprotocol.io/specification/2026-07-28/changelog>
- Claude Code plugins: "`channels` declares the message channels a plugin provides, such as a bridge to a chat app",
  "each bound to one of its MCP servers"; monitors are "a persistent background process".
  <https://code.claude.com/docs/en/plugins-reference>

**Proposal.** Decide one of the two, and write it in ADR-0014:
1. Inbound connectors are not under describe/call. They are separate programs that only write START, approval and
   answer records (ADR-0012 S1 already says the bot writes the same records). Recommended: smallest change.
2. Add a `poll` op with a cursor, so a front door stays one-shot.

## P2 · Registered once, pinned — refine

Industry pins by content digest, and checks on every use:
- Terraform lock file: `h1:` "is also a SHA256 hash" "computed from the package contents"; it is "a trust on first use
  approach". <https://developer.hashicorp.com/terraform/language/files/dependency-lock>
- GitHub Actions: "Pin references to actions to a commit SHA"; "a tag can be moved or deleted".
  <https://docs.github.com/en/actions/reference/security/secure-use>
- Claude Code plugins: an `archive` source is versioned by "the `sha256` pin in the marketplace entry".
  <https://code.claude.com/docs/en/plugins/loading>
- SLSA: verify that the "`subject` matches the digest of the artifact in question" before use.
  <https://slsa.dev/spec/v1.1/verifying-artifacts>

Two refinements:
1. ADR-0014 says "the absolute path and sha256" of the file. `src/core/plugin/pin.ts` hashes the whole folder tree and
   runs a private copy. The code is right (it matches Terraform `h1:`); fix the ADR text.
2. Not pinned: the interpreter (`#!/usr/bin/env node`) and the CLI the connector calls. `pin.ts` says so. Record this in
   the ADR's Consequences, next to the CLI gap that is already there.

Signing (Sigstore: "the identity in the certificate matches an expected identity", <https://docs.sigstore.dev/about/overview/>)
adds value only with network install. P10 rules that out, so no change now.

## P3 · Project config on the machine — keep

Industry treats repo-held tool config as untrusted input:
- Claude Code: a project plugin "comes from the repository rather than from you", so "it loads only after the same
  trust check"; managed settings are highest, and "no other source overrides them".
  <https://code.claude.com/docs/en/plugins/loading>
- MCP: a malicious "startup" command in a client configuration is a named attack.
  <https://modelcontextprotocol.io/specification/2026-07-28/basic/security_best_practices>

The factory goes one step further (never a repo file). That is right for unattended runs on branch code.

## P4 · MCP behind one bridge — change

**Keep:** the LLM never holds MCP tools; a fixed op→tool map. Sources agree:
- MCP: tools are "model-controlled"; "clients MUST consider tool annotations to be untrusted unless they come from
  trusted servers". <https://modelcontextprotocol.io/specification/2026-07-28/server/tools>
- Copilot coding agent: it "will not ask for your approval before using them"; "We strongly recommend that you
  allowlist specific read-only tools."
  <https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/extend-coding-agent-with-mcp>

**Change 1: pin and sandbox the MCP server the bridge starts.** P2's hash pins the bridge, not the server it launches
(often `npx <package>`). The bridge runs it on the host, with a login. Industry boxes these servers:
- MCP: "Execute MCP server commands in a sandboxed environment with minimal default privileges"; "Attackers can execute
  any command with MCP client privileges."
  <https://modelcontextprotocol.io/specification/2026-07-28/basic/security_best_practices>
- gh-aw: "MCP servers execute within isolated containers"; "Per-container domain allowlists enforced via Squid proxy";
  "Tool filtering at the configuration level restricts which operations each server may expose."
  <https://github.github.com/gh-aw/introduction/architecture/>

Proposal: each MCP server is registered like a connector (digest of its package or image), runs in a box with an
egress allowlist (the Squid set-up of #130 exists), and the bridge lists only the mapped tools.

**Change 2: fix the stale reason.** ADR-0014 rejects "MCP as the plugin contract" because it "needs a JSON-RPC session
and OAuth in the core". Both are now false:
- 2026-07-28: "Make MCP stateless: remove the `initialize`/`notifications/initialized` handshake."
  <https://modelcontextprotocol.io/specification/2026-07-28/changelog>
- Auth: "Implementations using an STDIO transport SHOULD NOT follow this specification, and instead retrieve
  credentials from the environment." <https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization>

The decision still stands, for other reasons (see Q). Only the ADR text must change.

Not verified this round: the gh-aw quote "Custom MCP servers should be read-only" that ADR-0014 cites.

## P5 · Write defaults and caps — keep

- gh-aw: "Create GitHub issues (max: 1)"; with no config, `create-issue` defaults to `max: 1`.
  <https://github.github.com/gh-aw/reference/safe-outputs/>
- MCP: servers "MUST" "Rate limit tool invocations"; clients "SHOULD" "Prompt for user confirmation on sensitive
  operations". <https://modelcontextprotocol.io/specification/2026-07-28/server/tools>

The factory's defaults are as tight as gh-aw's. "Only declared writes" is stronger than MCP annotations, which are
hints only.

## P6 · The coordinator asks; a person confirms — keep

- gh-aw: no write permission for the agentic part; "separate permission-controlled jobs execute permitted requests";
  threat detection runs before any write. <https://github.github.com/gh-aw/reference/safe-outputs/>,
  <https://github.github.com/gh-aw/introduction/architecture/>
- MCP: "there SHOULD always be a human in the loop with the ability to deny tool invocations"; "Show tool inputs to the
  user before calling the server". <https://modelcontextprotocol.io/specification/2026-07-28/server/tools>

gh-aw adds a threat-detection pass on the buffered writes. #210 already lists this idea. `post.ts` cleaning covers part
of it; no new change.

## P7 · The runner is pure; the box runs it — keep

- gh-aw: "The agent job runs with minimal read-only permissions." <https://github.github.com/gh-aw/introduction/architecture/>
- MCP: "Use platform-appropriate sandboxing technologies (containers, chroot, application sandboxes, etc.)".
  <https://modelcontextprotocol.io/specification/2026-07-28/basic/security_best_practices>

Splitting "build argv" from "run it in the box" means no runner connector can forget the box. No compared system does
it better.

## P8 · Versions as Terraform does — keep

- Terraform: "Major versions of the protocol delineate Terraform CLI and Terraform Plugin compatibility." "Minor
  versions of the protocol are additive." <https://developer.hashicorp.com/terraform/plugin/terraform-plugin-protocol>
- MCP 2026-07-28: "Every request declares the protocol version it is using"; on a miss the server returns
  `UnsupportedProtocolVersionError` "listing the versions it does support". <https://modelcontextprotocol.io/specification/versioning>
- LSP uses capabilities: "The set of capabilities is exchanged between the client and server during the initialize
  request." <https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/>

P8 already puts `protocol` in every request and in `describe`, as MCP now does. Capabilities sit in `describe`, as in
LSP. Nothing to add.

## P9 · Forge I/O is a connector; decisions stay in the core — keep

- gh-aw: the agent "requests actions", and write jobs run after it. <https://github.github.com/gh-aw/reference/safe-outputs/>
- MCP: "Servers MUST" "Validate all tool inputs" and "Implement proper access controls"; the policy lives outside the
  model. <https://modelcontextprotocol.io/specification/2026-07-28/server/tools>

Separate `forge.read` and `forge.write` match gh-aw's split between read-only agent and write job.

## P10 · No network install in v1 — keep

- kubectl: Krew plugins "are not audited for security"; "arbitrary programs running on your machine".
  <https://kubernetes.io/docs/tasks/extend-kubectl/kubectl-plugins/>
- MCP Registry: "currently in preview"; it "hosts metadata", and "delegates security scanning" to package registries
  and aggregators. <https://modelcontextprotocol.io/registry/about>

No registry today gives a review step the factory could rely on. Revisit when one signs packages (see P2).

## P11 · Env allow-list only — keep

- MCP stdio: credentials come "from the environment" (authorization spec, above).
- Copilot coding agent: "Only Agents secrets and variables with names prefixed with `COPILOT_MCP_` will be available".
  <https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/extend-coding-agent-with-mcp>
- Claude Code: hook handlers "run in the current directory with Claude Code's environment"; `http` hooks take an
  `allowedEnvVars` list. <https://code.claude.com/docs/en/hooks>

The factory is stricter than Claude Code (full env) and as strict as Copilot (named only). `contract.ts` also forbids
loader variables (`LD_`, `NODE_`, `PYTHON…`), which no compared system does. The P4 change applies the same rule per
MCP server.

## Q · An executable per connector, or MCP servers as the connector protocol?

**Verdict: keep the executable and the own describe/call contract. MCP stays a backend behind the bridge.**

What changed in MCP (2025-06 to 2026-07):

| change | source |
|---|---|
| stateless; no `initialize`; version in every request | 2026-07-28 changelog |
| `server/discover` "MUST" exist, returns versions and capabilities | 2026-07-28 changelog |
| `outputSchema` + `structuredContent`, any JSON value | 2026-07-28 tools |
| tasks moved to an extension; sampling, roots, logging deprecated | 2026-07-28 changelog |
| OAuth: CIMD preferred, DCR deprecated; stdio uses env | 2025-11-25 and 2026-07-28 auth |
| tool annotations still "untrusted unless they come from trusted servers" | 2026-07-28 tools |

So stateless MCP over stdio is now close to describe/call (`server/discover` + `tools/list` ≈ `describe`,
`tools/call` ≈ `call`). The old cost reason is gone. The design reasons still hold:

1. **Writes.** MCP has no declared, enforced write list. Annotations are hints. P5 needs the core to know each write
   before it runs.
2. **Sealed results.** `structuredContent` is free JSON for a model. The core needs a closed `kind` per capability.
3. **Audience.** MCP tools are "model-controlled". Connectors are called by code, never by a model.
4. **Reuse is small.** Bundled connectors (gh, glab, discord) are ours. A third-party MCP server still needs an
   op→tool map and a write declaration. That map *is* the bridge.

**Revisit trigger.** Re-open if MCP adds enforced side-effect declarations, or if more than two connectors end up as
thin MCP wrappers. Then make protocol 2 of the contract an MCP-stdio profile, and keep pin, env allow-list, declared
writes and caps in the core.
