# 0012 · Safety design for unattended runs

Status: accepted 2026-11-06 (operator, map #30: W1, Q1, Q4–Q7, Q11, Q15, gaps 1–3). Amends ADR-0001, 0005, 0006,
0010 and 0011. Closes the design side of #83 gaps 1–6. The scripts do not follow it yet. Each build ticket is cut under
#30.

## Context

The writer runs as the developer's OS user, with that user's logins, and with no sandbox. `start-writer.sh` starts
`claude --bg` and gives the writer the bot's `gh` (`scripts/lib/github.sh:131-142`). The coordinator is an LLM that
reads untrusted text (issues, PR notes, Jira, the web), holds the bot login, and starts runs. That is the lethal
trifecta in one seat (#83). Today the real risk is an agent mistake that runs with every credential, more than an
injection.

## Decision

```
you ⇄ coordinator (LLM, interactive)        dispatcher (code, no LLM)            box (writer, reviewer, ready check)
      reads issues, PRs, Jira (read only)   reads poll.sh; one decision table    no forge token, no network but
      runs only allow-listed commands       holds the bot login                  the model API and registries
      approve.sh → harness "ask" → note     claim · start · release · reconcile  writes .factory/report.md, exits
                                            host: push, post the report  ◀───────┘
```

| # | decision | #30 |
|---|---|---|
| S1 | **Approval.** The human approves in the terminal. The coordinator runs `approve.sh <n>`, which is in the harness `ask` list and never in `allow`. The harness prompt shows the PR number, the title and the head sha. `approve.sh` posts `/approved` with the **human's own forge login**. A `/approved` typed on the PR page stays valid. `poll.sh` keeps counting human-maintainer notes, stale after a human body edit. | [W1](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6679395560), [gap 1](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6681534148) |
| S2 | **The coordinator's wall.** Its shell runs an allow-list only: the factory read commands (`poll`, `status`) and `approve.sh` (ask). Raw `gh`, `glab`, `curl`, `bash -c` and the start scripts are denied. It holds no bot login. On one OS user these deny rules are the only wall; a later step may run the dispatcher as another OS user or on the VM. | [Q15](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6681316890), [gap 1](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6681534148) |
| S3 | **Code dispatches.** A dispatcher with no LLM runs one decision table from `poll.sh` fields: approved and not claimed → claim + writer; writer done → ready check; ready check passed → reviewer; stop or more than 3 rounds → release + `needs-human`; merged and claimed → reconcile. | [Q15](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6681316890), [gap 2](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6681560750) |
| S4 | **Order.** writer done → ready check (D12) → reviewer (ADR-0004) → gate → a human undrafts and merges. CI green is not the trigger for review. | [gap 2](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6681560750) |
| S5 | **What runs in a box.** The writer, the reviewer and the ready check: every run that has no human watching and every run of branch code. The coordinator does not. | [Q1a](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6680836108) |
| S6 | **Network and credentials.** Deny-all, plus an allowlist: the model API and the package registries. The forge is not on it. The host pushes and posts every comment; the writer holds no forge token. | [Q1b](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6680836108) |
| S7 | **Sandbox tool, in two steps.** Step 1, now: Claude Code's built-in `sandbox.enabled` with `sandbox.network.allowedDomains` and `WebFetch` denied; `copilot --sandbox` at work. Step 2, before unattended runs at scale: `srt <runner>` around the whole process (it also covers hooks, MCP, file reads and OpenCode). Pin the `srt` version. Refuse to start when the sandbox is missing. | [Q1c](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6680836108) |
| S8 | **Where the box is.** `FACTORY_BOX=laptop` (default) or `vm`, chosen at setup. Laptop: locked down, plus a Docker exception so the writer runs the ITs it writes. VM: the user's own VM and its Docker. Risk: Rancher Desktop mounts `$HOME`, so the Docker exception can reach it. Until a mount limited to the factory folder is verified, setup prints this risk. | [Q4](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6681022323) |
| S9 | **CI on agent branches.** Test jobs only, with no secrets (protected variables and environments). Any edit to a CI file stops the pipeline until a human approves. The writer keeps at most 2 CI rounds, then the human decides. A project with no forge CI uses the local verifier of #91. | [Q5a](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6681168344) |
| S10 | **Zero findings is not green.** The AI reviewer may block but never approve. Only a human undrafts or merges. Every PR gets a script-made box: files touched under `.claude/`, `.agents/`, CI and the build, plus new dependencies. | [Q5b](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6681168344) |
| S11 | **Permissions.** In laptop mode the writer runs with no skip-permissions flag. Instead: Bash is allowed only inside the sandbox (`sandbox.autoAllowBashIfSandboxed`), edits only in the worktree, `git push`, `WebFetch` and `curl` are denied, and the rest is denied. Copilot: `--allow-tool` / `--deny-tool`. Skip-all is allowed only in `FACTORY_BOX=vm` or after step 2. | [Q6](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6681210370) |
| S12 | **Config never comes from the branch.** Settings, hooks and the lint hook (D17) load from the default branch or from the factory, passed with `--settings`. `.claude/`, `.agents/`, `AGENTS.md` and `CLAUDE.md` are read-only in the box. | [Q7](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6681210370) |
| S13 | **Done.** The writer writes `.factory/report.md` (evidence and questions, never committed) and exits. On exit 0 the host pushes and posts the report. On another exit code, or a cap, the host pushes the work-in-progress branch and blocks the change (D14). A writer question uses the same file. | [gap 3](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6681622159) |
| S14 | **The bot.** One bot per project, used only by code (the dispatcher and the host push). No bot per developer. No LLM holds the bot login. | [gap 1 / Q11](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6681534148) |

## Why

Each fact below was checked on 2026-11-06 against the source named. The quotes are in the #30 comments.

- Every checked factory boxes the agent and limits its network. Stripe Minions use an EC2 devbox "isolated from
  production resources and the internet". Spotify Honk uses a container with "virtually no access to surrounding systems".
  The Copilot coding agent has a firewall allowlist. Google Jules runs in a VM. Sandcastle uses Seatbelt, bwrap or a
  container per run.
- In each of them, code outside the agent dispatches, pushes and talks to people. Nobody signs an approval with a bot,
  and no AI "clean" result ships code. Copilot code review "does not count toward required approvals" by default.
  Spotify's LLM judge vetoes about a quarter of runs, and engineers still review.
- They all let the agent build and run tests inside its box (Stripe part 2, Spotify part 3, GitHub docs). So the
  writer must run the ITs it writes (S8).
- Claude Code's sandbox covers Bash only, and its docs call that "not sufficient for fully unattended runs" (S7, step 2).
  OpenCode has no sandbox (opencode#2242).
- Only our coordinator sits next to the human's login. That is why S2 exists.

## Alternatives rejected

| option | why rejected |
|---|---|
| the coordinator's word as the approval | an LLM that reads untrusted text can be talked into it (W1) |
| an approver bot signs the approval | the key sits under the same OS user; no checked system signs approvals with a bot (gap 1) |
| a VM for everyone | it costs RAM and disk on every laptop; Sandcastle lets the user choose (Q4) |
| Docker shipping as the sandbox | a host Docker socket inside the container is the same escape (Q13) |
| no pipeline on agent branches until a human clicks (Copilot's default) | the writer would lose its CI feedback (Q5a) |
| skip permission prompts on the laptop | the laptop box is weak; skip-all only in a strong box (Q6) |

## Sources

Map #30 comments of 2026-11-06 (linked above) · #83 · #91 · the Sandcastle study on #83 · ADR-0001, 0004, 0005, 0006,
0011.
