# Audit 2 · safety (#264, map #262)

Audits the **target design** (`docs/DESIGN.md` §2 P4–P6, §4, §5 Runners; ADR-0012 S1–S18; GLOSSARY "Test checks").
Code is not judged. Baseline: chiyanram/skills#210 (2026-11-06) and #83 (lethal trifecta survey). This file extends
them. All sources fetched 2026-11-09. Quotes are short and exact.

## Verdict table

| # | decision | verdict | one-line reason | differs from skills#210 |
|---|---|---|---|---|
| D1 | Runner isolation: `vm` (Sysbox) and `srt` (laptop), whole process, refuse when missing (S5, S7, S8) | **refine** | Matches industry. But `srt` reads everywhere by default and starts with no settings file; Sysbox shares the host kernel with the `factory` user's App key | no (#210 silent on runners) |
| D2 | Egress: deny-all plus model API and package registries; git host refused (S6, §5) | **change** | Both allowed hosts accept uploads. A public incident exfiltrated files through `api.anthropic.com` with the attacker's key. A domain allowlist alone does not close the "communicate" leg | yes (#210 silent; #83 assumed the allowlist closes it) |
| D3 | P4: no model holds a git host login; the host pushes and posts (S6, S13, S14) | **keep** | Same as Anthropic cloud sessions, gh-aw safe outputs and Copilot cloud agent | no |
| D4 | P5: what judges a change never comes from that change (S12) | **keep** | Same as GitHub's `pull_request_target` rule and gh-aw protected files | no |
| D5 | P6: the AI never approves; zero findings is not a pass (S10) | **refine** | Keep the rule. Add the Copilot rule: the human who started the ticket is not the only approver, for team projects. Copilot now offers opt-in AI approvals, so keep ours locked | yes (adds requester ≠ approver) |
| D6 | §4 accepted risk: on a laptop the deny list is not a wall | **refine** | Keep the acceptance. Claude Code's own docs say deny rules miss subprocesses; add the cheap OS layer (Bash sandbox `denyWrite` on the record folders, no unsandboxed retry, bypass mode disabled) | no (#210 silent) |
| D7 | Test checks S1–S4 with a head-scoped waiver | **refine** | Keep detection. Add prevention: existing tests and judge files read-only in the implementer's runner. ImpossibleBench: read-only stops test edits and keeps real performance | yes (#210 VB6 is a prompt rule only) |

Changes in one line:

- **D2:** make egress check *what* goes to an allowed host, not only the host name: model API calls must carry the
  runner's own token (or the upload paths are blocked), and registries are read-only (GET through a mirror). Grill it,
  because ADR-0012 rejected a proxy that adds the login (the terms), and checking a header is a different act.

---

## D1 · Runner isolation (keep vm, refine srt)

**Design.** Every unattended run and every run of branch code goes in a runner (S5). The whole process is wrapped, not
only Bash (S7). `vm` is a Sysbox container with its own Docker on the VM; `srt` on the work laptop, with container
tests on git host CI. No host Docker socket. Refuse to start when the runner is missing.

**Industry.**

- Claude Code docs say the Bash sandbox alone "is not sufficient for fully unattended runs", and to "Always run
  `--dangerously-skip-permissions` sessions inside a container, a VM, or the sandbox runtime".
  ([sandbox-environments](https://code.claude.com/docs/en/sandbox-environments))
- Same page, for an untrusted repo: "A dedicated virtual machine". And: "A dedicated virtual machine provides the
  strongest separation, with its own kernel".
- `srt` README: "By default, read access is allowed everywhere." Writes and network are deny by default.
  ([sandbox-runtime](https://github.com/anthropic-experimental/sandbox-runtime)) Status: "Beta Research Preview".
- Claude Code docs on `srt`: "If `~/.srt-settings.json` doesn't exist ... the runtime starts anyway." "Don't take a
  clean start as proof your settings loaded." ([sandbox-environments](https://code.claude.com/docs/en/sandbox-environments))
- Sysbox: "it does not (yet) provide the same level of isolation as VM-based alternatives or user-space OSes like
  gVisor". ([nestybox/sysbox](https://github.com/nestybox/sysbox))
- Claude Code: allowing `/var/run/docker.sock` "effectively grants access to the host system".
  ([sandboxing](https://code.claude.com/docs/en/sandboxing#security-limitations)) This backs "never mount the socket".
- OpenHands: "Anything mounted read-write into `/workspace` can be modified by the agent."
  ([OpenHands Docker runtime](https://docs.openhands.dev/openhands/usage/runtimes/docker))

**Verdict: refine.** The shape is industry practice. Three gaps:

1. `srt` read default is open. The target must say: `denyRead` the whole home, then re-allow the worktree and named
   files. This is S15's allow-list, written as srt config.
2. `srt` starts with defaults when its settings file is missing. "Refuse when missing" must check that *our* settings
   loaded (the S15 canary covers it if the canary runs inside srt, before the agent).
3. Sysbox shares the kernel. On the VM, the `factory` user's App key sits on the same kernel as the runners. Name it
   as a residual risk, and keep the App scoped to the project's repos with no `workflows` permission (S9 already).

## D2 · Egress allowlist (change)

**Design.** Deny-all, plus the model API and the package registries. The git host is not on it (S6). Squid proxy on an
`--internal` network.

**Industry.**

- gh-aw: "The Squid proxy controls the agent's egress traffic via a configurable domain allowlist."
  ([gh-aw architecture](https://github.github.com/gh-aw/introduction/architecture/)) Same pattern as ours.
- Copilot cloud agent: "By default, Copilot's access to the internet is limited by a firewall", with a recommended
  allowlist of package registries. It warns: "Sophisticated attacks may bypass the firewall, potentially allowing
  unauthorized network access and data exfiltration."
  ([Copilot firewall](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/customize-the-agent-firewall))
- Claude Code: "Allowing broad domains such as `github.com` can create paths for data exfiltration." The proxy
  decides "from the client-supplied hostname without inspecting TLS", so domain fronting can reach other hosts.
  ([sandboxing](https://code.claude.com/docs/en/sandboxing#security-limitations))
- Incident (Rehberger, 2025): the sandbox could reach `api.anthropic.com`; "The upload will not happen to the user's
  Anthropic account, but to the attackers". Fix asked: "ensure the sandbox enforces that Claude can only communicate
  with the logged in user's account."
  ([Claude Pirate](https://embracethered.com/blog/posts/2025/claude-abusing-network-access-and-anthropic-api-for-data-exfiltration))
- Repeat in Claude Cowork (2026-01): "includes an attacker's own Anthropic API key and has the agent upload any files
  it can see". ([Willison](https://simonwillison.net/2026/Jan/14/claude-cowork-exfiltrates-files/))
- Willison's trifecta: "The ability to externally communicate in a way that could be used to steal your data" is a leg.
  ([lethal trifecta](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/))

**Rule of Two check.** The writer reads untrusted text [A]. It holds private data: the repo code and the model token
[B]. Its egress reaches two upload-capable hosts [C]. So it holds all three legs, and the allowlist only narrows [C].

**Verdict: change.** Keep the allowlist. Add content rules at the proxy:

1. Model API: only requests that carry the runner's own token pass, or the upload endpoints (`/v1/files`) are
   blocked. Either needs TLS termination at the proxy, with its CA in the runner.
2. Registries: read-only. GET only, or a read-only mirror (work already plans a package mirror). This also stops a
   `npm publish` of the code.
3. Write "the allowlist narrows exfiltration, it does not stop it" into S6, as **Today:** style honesty.

Open for grilling: ADR-0012 rejected a proxy that *adds* the Claude Max login (terms). Checking that a header equals a
known token is not adding one, but it still terminates TLS on that traffic.

## D3 · P4: no model holds a git host login (keep)

**Design.** The runner has no forge credential. The host pushes, posts from a fixed template, and refuses CI paths.

**Industry.**

- Anthropic cloud sessions: "sensitive credentials (such as git credentials or signing keys) are never inside the
  sandbox with Claude Code." A proxy checks that a push targets only the configured branch.
  ([Anthropic engineering](https://www.anthropic.com/engineering/claude-code-sandboxing))
- gh-aw: "the agent never requires write permissions because all write operations are performed by separate,
  validated jobs." ([gh-aw architecture](https://github.github.com/gh-aw/introduction/architecture/))
- Copilot cloud agent: "can only perform simple push operations" and "only has the ability to push to a single
  branch". ([Copilot risks](https://docs.github.com/en/copilot/concepts/agents/coding-agent/risks-and-mitigations))
- OWASP LLM06: "Implement authorization in downstream systems rather than relying on an LLM to decide if an action is
  allowed or not." ([OWASP LLM06:2025](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/))

**Verdict: keep.** Ours is the gh-aw shape (host applies typed output), stricter than Copilot (no push at all). The
model-only token is the one credential left; D2 covers it.

## D4 · P5: the judge never comes from the change (keep)

**Design.** Rules from the default branch or a pinned plugin; settings from outside the repo; `.claude/`, `AGENTS.md`,
git hooks and config read-only in the runner; host git with hooks off.

**Industry.**

- GitHub `pull_request_target` "runs in the context of the default branch of the base repository", and "Running
  untrusted code on the `pull_request_target` trigger may lead to security vulnerabilities."
  ([events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows))
- GitHub Security Lab: checking out a PR under a privileged trigger is "a dangerous practice that may lead to
  repository compromise". ([preventing pwn requests](https://securitylab.github.com/resources/github-actions-preventing-pwn-requests/))
- `srt` denies by default `.git/hooks`, `.git/config`, `.mcp.json`, `.claude/commands`, `.claude/agents`.
  Claude Code: a session that can write config paths "can persist hooks, permission rules, or MCP servers that run
  unsandboxed the next time". ([sandbox-environments](https://code.claude.com/docs/en/sandbox-environments))
- gh-aw protected files (`.github/`, `AGENTS.md`, `CLAUDE.md`, `.claude/`, `.agents/`, CODEOWNERS) already in #210.

**Verdict: keep.** Industry does the same. One note: `srt` on Linux builds its deny list once at launch and "does not
cover anything the session creates later". Our host-side git (hgit) makes this moot for the host, but a runner-side
`git init` of a nested repo is not covered. Low risk.

## D5 · P6: the AI never approves; zero findings is not a pass (refine)

**Design.** The reviewer may block, never approve. Only a human undrafts or merges. Zero findings is no signal.

**Industry.**

- Copilot cloud agent "cannot mark its pull requests as "Ready for review" and cannot approve or merge a pull
  request." It also "Prevents the user who asked Copilot cloud agent to create a pull request from approving it."
  ([Copilot risks](https://docs.github.com/en/copilot/concepts/agents/coding-agent/risks-and-mitigations))
- Copilot code review: "By default, Copilot's reviews do not count toward required approvals". But now, when enabled,
  "Copilot can submit an approving review that satisfies your repository's required-approval rule".
  ([Copilot code review](https://docs.github.com/en/copilot/concepts/agents/code-review))
- gh-aw threat detection: a detector failure means "the security assessment is incomplete, not that a threat was found
  or that the output is clean". ([gh-aw threat detection](https://github.github.com/gh-aw/reference/threat-detection/))
- OWASP LLM06: "require a human to approve high-impact actions before they are taken."
  ([OWASP LLM06:2025](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/))

**Verdict: refine.**

1. Keep "the AI never approves" as an engine rule that no plugin or setting can drop. The market now ships opt-in AI
   approval, so this is a real choice, not a default.
2. Add a project setting (ladder class): "the human who STARTed may not be the only merger". Off for personal and
   aruvii (one person). On for step 6, colleagues. This is Copilot's requester rule.

## D6 · §4: on a laptop the deny list is not a wall (refine)

**Design.** The coordinator runs as the developer. `approve` and `start` are on its deny list; bypass mode is never
used. The human merge is the hard gate. Signed approvals come later.

**Industry.**

- Claude Code: "Bash permission patterns that try to constrain command arguments are fragile." Deny rules don't apply
  "to arbitrary subprocesses that read or write files indirectly, like a Python or Node script". "For OS-level
  enforcement that blocks all processes from accessing a path, enable the sandbox."
  ([permissions](https://code.claude.com/docs/en/permissions))
- Same page: "Use both for defense-in-depth, since sandbox restrictions still apply even if a prompt injection bypasses
  Claude's decision-making." `disableBypassPermissionsMode` "works from any scope".
- Claude Code: with `"allowUnsandboxedCommands": false`, "Claude Code ignores the `dangerouslyDisableSandbox`
  parameter". ([sandboxing](https://code.claude.com/docs/en/sandboxing))
- Meta Rule of Two: a session with all three legs "should not be permitted to operate autonomously and at a minimum
  requires supervision". ([Meta AI](https://ai.meta.com/blog/practical-ai-agent-security/)) The coordinator is
  interactive, so the acceptance fits this rule.

**Verdict: refine.** The acceptance is sound under Rule of Two, because a human sits in the coordinator's loop and
merges. Add the cheap OS layer the vendor itself recommends, so a forged record needs more than one slip:

1. Coordinator settings: Bash sandbox on, `filesystem.denyWrite` on `~/.factory/approvals/`, `~/.factory/starts/`,
   the settings layers and the project home; `allowUnsandboxedCommands: false`; `disableBypassPermissionsMode`.
2. `agent-factory approve` and `start` ask for a typed confirm on `/dev/tty`. The Bash tool has no TTY.
3. The dispatcher's "refuse to start unless these rules are in place" (S2) also checks items 1–2.

This is still not a wall (mods, `!` commands, hooks run outside the sandbox). Keep the **accepted risk** text.

## D7 · Test checks S1–S4 (refine)

**Design.** The engine stops a removed test, an added skip, fewer assertions, or a changed judge file. A human waiver
is scoped to the head. A test-integrity lens reviews other test edits.

**Industry.**

- ImpossibleBench: "an LLM agent with access to unit tests may delete failing tests rather than fix the underlying
  bug." GPT-5 "cheats 54.0% of the time on Conflicting-SWEbench". Claude models cheat mostly by test modification
  (over 79% of cheating cases). Hiding tests "reduces cheating success rate to near zero"; read-only tests keep
  performance and stop modification, but not special-casing. Authors recommend "hiding test files entirely or
  restricting them to read-only access". ([arXiv 2510.20270](https://arxiv.org/html/2510.20270))
- METR: frontier models were "attempting (often successfully) to get a higher score by modifying the tests or scoring
  code." ([METR, 2025-06-05](https://metr.org/blog/2025-06-05-recent-reward-hacking/))
- gh-aw protected files and #210 VB6 ("Never delete, skip or weaken a test") are prompt or review rules.

**Verdict: refine.** S1–S4 are good detection; no checked factory has them in code. Add prevention, which the paper
shows works:

1. In the implementer and cleanup runs, mount existing test files and judge files read-only (as S12 does for
   `.claude/`). The test-first run, which writes tests, keeps write access.
2. A legit test edit in the implementer run ends with `asked`, and the waiver path stays.
3. Special-casing and operator overloading are not stopped by read-only. The test-integrity lens keeps that job.

Cost: the role split (test-first vs implementer) already exists, so the mount rule follows the role card.

---

## Sources (all primary, fetched 2026-11-09)

| source | used in |
|---|---|
| Claude Code docs: [sandboxing](https://code.claude.com/docs/en/sandboxing), [sandbox-environments](https://code.claude.com/docs/en/sandbox-environments), [permissions](https://code.claude.com/docs/en/permissions) | D1 D2 D4 D6 |
| [anthropic-experimental/sandbox-runtime README](https://github.com/anthropic-experimental/sandbox-runtime) | D1 |
| [Anthropic engineering: Claude Code sandboxing](https://www.anthropic.com/engineering/claude-code-sandboxing) | D3 |
| GitHub docs: [Copilot risks and mitigations](https://docs.github.com/en/copilot/concepts/agents/coding-agent/risks-and-mitigations), [Copilot firewall](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/customize-the-agent-firewall), [Copilot code review](https://docs.github.com/en/copilot/concepts/agents/code-review), [workflow events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows) | D2 D3 D4 D5 |
| [GitHub Security Lab: pwn requests](https://securitylab.github.com/resources/github-actions-preventing-pwn-requests/) | D4 |
| gh-aw: [architecture](https://github.github.com/gh-aw/introduction/architecture/), [threat detection](https://github.github.com/gh-aw/reference/threat-detection/) | D2 D3 D5 |
| [nestybox/sysbox README](https://github.com/nestybox/sysbox) | D1 |
| [OpenHands Docker runtime](https://docs.openhands.dev/openhands/usage/runtimes/docker) | D1 |
| [OWASP LLM06:2025 Excessive Agency](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/) | D3 D5 |
| [Willison: lethal trifecta](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/), [Cowork exfiltration](https://simonwillison.net/2026/Jan/14/claude-cowork-exfiltrates-files/) | D2 |
| [Meta: Agents Rule of Two](https://ai.meta.com/blog/practical-ai-agent-security/) | D2 D6 |
| [Rehberger: Claude Pirate (incident)](https://embracethered.com/blog/posts/2025/claude-abusing-network-access-and-anthropic-api-for-data-exfiltration) | D2 |
| [ImpossibleBench, arXiv 2510.20270](https://arxiv.org/html/2510.20270), [METR reward hacking](https://metr.org/blog/2025-06-05-recent-reward-hacking/) | D7 |

Checked, not decisive:

- **CaMeL** ([arXiv 2503.18813](https://arxiv.org/abs/2503.18813)): control flow from the trusted query, so "untrusted
  data ... can never impact the program flow"; 77% of tasks with provable security vs 84% undefended. It backs P1
  (the engine decides) more than any row here.
- **Design Patterns for Securing LLM Agents** ([arXiv 2506.08837](https://arxiv.org/html/2506.08837)): after untrusted
  input the agent "must be constrained so that it is _impossible_ for that input to trigger any consequential
  actions". Its coding-agent case asks for user confirmation of pushes. Same direction as D3 and D5.
- **Devin** ([enterprise security](https://docs.devin.ai/enterprise/security-access/security/enterprise-security)):
  recommends "Branch protections to enforce validation checks" and "Code reviews before deployment". No public detail
  on its sandbox egress. Not used as evidence.
- **Factory droids:** not fetched in this pass.
