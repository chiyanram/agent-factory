# Inventory — non-script files of 2026-10-17/18 (skills#110 — every non-script file that lands on VM / laptop / agent-platform)

Sources: agent-fleet `080aabb..origin/main` @ `8738986` (#78 #80 #82 #79, all 2026-10-17) + open PR #84 (runner register flags) + open PR #85 (generic worker base) ·
agent-platform !263 (#671 own-runner gate, draft) · !269 (#670 key outside checkouts — **0 commits, description only**) · local WIP `71b5deb4` (#643 skeleton) ·
skills `origin/main` since 2026-10-16 · VM = what `scripts/fleet-zones apply` + `setup-gate-runner.sh` write (read from code; VM not inspected, no SSH).
Dest = "needed by ORIGINAL map destination" (one source for rules + role souls · /crq stages owned by role · diff-scoped reviewers · laptop and SSH fleet load identical files).

## 1 · VM host (written by `fleet-zones apply` 2026-10-17 and runner setup)

| file | lands on | what it is | how it works / who reads it | decision | dest? | live? |
|---|---|---|---|---|---|---|
| `/etc/sudoers.d/agent-fleet` — `fleet-coord ALL=(fleet-worker) NOPASSWD: /usr/local/bin/fleet-launch-worker` | VM | one sudo rule: coordinator may run only the launcher, only as fleet-worker | sudo; checked by `visudo -c` before install, mode 0440 | G13 · G31 | no | applied on VM |
| `/etc/ssh/sshd_config.d/50-agent-fleet.conf` — `AllowAgentForwarding no` · `AllowStreamLocalForwarding no` | VM | host-wide sshd drop-in: no agent or socket forwarding into the VM | sshd; `sshd -t` after write, then reload; also hits operator's own logins | G13 (stream-forwarding part never decided) | no | applied on VM |
| `/usr/local/lib/agent-fleet/` (rsync of the checkout, minus .git/.scratch) | VM | root-owned copy of the whole fleet repo, incl. plugin/, templates/, enforcement/ | the sudo rule runs code from here; coordinator allow-list points here | G13 | no | applied on VM |
| `~{fleet-coord,fleet-worker,fleet-runner}/.config/agent-fleet/machine.env` | VM | per-zone host-facts file, copied from `templates/machine.env.example` | sourced by every launch + runner pre_build_script; kept if exists | ND-15 · G32 | no | applied on VM (runner's filled by operator) |
| `~<zone>/.config/agent-fleet/secrets/` (0700) ×3 | VM | empty folder where the operator drops each zone's tokens | read by launcher / coordinator scripts | G13 Q4 | no | applied on VM |
| `~fleet-runner/.config/agent-fleet/stack-secrets/` (0700) | VM | gate stack's own master key + DB password, kept across jobs | filled by agent-platform's job (`FLEET_STACK_SECRETS`) | G29 · #671 | no | applied on VM (empty until !263 jobs run) |
| `~fleet-coord/.config/systemd/user/fleet-coordinator.service` (from template) | VM | user unit that restarts the coordinator tmux session | systemd user + linger; not started until tokens (install step 7) | G30 | no | written if apply ran after #82 merged — unverified; not started |
| `~{fleet-worker,fleet-runner}/.config/containers/{storage,containers}.conf` + `systemd/user/podman-prune.{service,timer}` | VM | rootless-podman config and daily prune, per zone | `ensure_container_config` (old fleet-lib.sh helper) called by apply | G13 · G29 | no | applied on VM |
| linger for 3 zone users (`loginctl enable-linger`) | VM | user services survive logout | systemd-logind state, not a file you edit | G30 | no | applied on VM |
| `/etc/gitlab-runner/config.toml` | VM | runner registration: token (root 0600), `concurrent = 1`, `pre_build_script` sources runner's machine.env | gitlab-runner; tag `aruvii-gate` + untagged-off set in GitLab UI (PR #84) | R28 · G26 · G29 | no | applied on VM (registered with PR #84 branch, `verify` valid) |
| gitlab-runner systemd unit (`gitlab-runner install --user fleet-runner`) | VM | system service running jobs as fleet-runner | systemd | G29 | no | applied on VM |
| worker image `agent-fleet-worker:<sha>` + volume `fleet-gradle-cache` | VM / laptop | the built worker container image | `worker-container build`; PR #85 says image never built locally | G13 · G32 | partly | **unverified** on VM |

## 2 · agent-fleet repo files (shipped to VM via `/usr/local/lib` copy and into the image)

| file | lands on | what it is | how it works / who reads it | decision | dest? | live? |
|---|---|---|---|---|---|---|
| `plugin/agents/analyst.md` | image + VM copy | analyst soul, 3 sentences; "crq stages 1–5" | fleet plugin agent file loaded by worker claude | G6 · G9e | yes (2nd copy beside AP `docs/agents/personas/`) | merged |
| `plugin/agents/spec-reviewer.md` | image + VM copy | spec-reviewer soul; pre-check before /approved | same | G6 · G9e | yes (2nd copy) | merged |
| `plugin/agents/developer.md` | image + VM copy | developer soul; stages 6, 6a, 9 | same | G6 · G9e | yes (2nd copy) | merged |
| `plugin/agents/qa.md` | image + VM copy | qa soul; stages 7, 8, read-only tools | same | G6 · G9e | yes (2nd copy; not diff-scoped) | merged |
| `plugin/agents/coordinator.md` | VM copy (coordinator) | coordinator soul + 5 hard rules + the watch loop table | `fleet-coordinator` starts claude with it | G6 · G25 · G26 · G30 | partly | merged; coordinator not started |
| `plugin/worker-rules.md` | image + VM copy | standing block prepended to every worker's system prompt | pasted into brief by `fleet-spawn`; wins over project files | G9e · G13 | partly (fleet-only rules, not the one rulebook) | merged |
| `plugin/PRINCIPLES.md` | image + VM copy | 9 fleet principles mapped to product AGENT-PRINCIPLES | coordinator argues from it | G9e | no | merged |
| `plugin/briefs/worker-brief.md` | VM copy | 10-field first message template for a worker | `fleet-spawn` fills `{{FIELD}}`, refuses blanks | G9e | partly | merged |
| `plugin/briefs/handoff-comment.md` | image + VM copy | shape of every stage-handoff comment | worker writes body; `post-status` writes header | G19 · G9e | no | merged (post-status not in image — worker can't run it) |
| `plugin/briefs/metrics-row.md` | image + VM copy | 5-number closing-comment block | `fleet-digest` parses it | G11 | no | merged |
| `plugin/.claude-plugin/plugin.json` · `.claude-plugin/marketplace.json` | image `/opt/agent-fleet` | manifest + marketplace making `plugin/` installable as `agent-fleet@agent-fleet` | managed-settings enables it in the image | G13 · G23 | yes (how fleet loads files) | merged |
| `plugins/reply-card/{reply-card.md, hooks/hooks.json, .claude-plugin/plugin.json}` | VM copy only | reply-shaping card, re-loaded by SessionStart hook | **not in marketplace, not in image** — nothing loads it (install.md:170) | G1 Q4 | partly (identical talking rules) | merged, **unwired** |
| `.devcontainer/managed-settings.json` | image `/etc/claude-code/` | auto mode, bypass off, AskUserQuestion denied, 5 marketplaces, 5 plugins enabled | Claude Code managed policy inside every worker | G13 · G27 · G23 | yes (the identical-load mechanism) | merged (enables empty `rulebook@chiyanram`) |
| `.devcontainer/Dockerfile` | image | worker image: main = temurin JDK + Gradle + Node; PR #85 = ubuntu + mise + codex + podman-remote | `worker-container build` | G13 · G32 (#85) | partly | merged; PR #85 branch only |
| `.devcontainer/devcontainer.json` | laptop (Docker) / VM | devcontainer def: caps NET_ADMIN/RAW, no-new-privileges, gradle volume (+ tool-cache in #85) | VS Code / `devcontainer` CLI | G13 | partly (same box laptop + VM) | merged; #85 edit branch only |
| `.devcontainer/egress-allow.txt` | image | firewall allow-list: Anthropic, gitlab, github, Maven/Gradle, npm | `init-firewall.sh` resolves at container start | G13 Q5–Q8 | no | merged |
| `.devcontainer/gitconfig` | image `/etc/gitconfig` | credential helpers reading `$GITLAB_TOKEN`/`$GH_TOKEN` | git inside worker | G13 Q3 | no | merged |
| `enforcement/coordinator-settings.json` | VM copy (fleet-coord) | coordinator `dontAsk` allow-list: fleet scripts, sudo launcher, tmux read, drafts only | `--settings` of coordinator claude | G31 | no | merged; coordinator not started |
| `templates/fleet-coordinator.service` | VM (source of unit above) | systemd user unit template | copied by fleet-zones | G30 | no | merged |
| `templates/com.agent-fleet.coordinator.plist` | laptop `/Library/LaunchDaemons/` | launchd daemon as fleet-coord, KeepAlive | copied by fleet-zones on macOS, `plutil -lint` | G30 | no | merged; laptop apply **unverified** |
| `templates/machine.env.example` | VM / laptop (source of machine.env) | host-facts template; main has JAVA_HOME + typed ports; #85 types only logins + repo URL | `machine_env.py` load/check | ND-15 · G32 (#85) | no | merged; #85 rewrite branch only |
| `docs/install.md` | repo docs | 9-step install beside old fleet, cutover | operator reads | G13 G16 G18 G25 G30 G31 | partly | merged (#85 edits branch only) |
| `docs/gate-runner.md` | repo docs | runner design + operator order on VM | operator reads | R28 · G29 · G20 | no | merged; PR #84 + #85 edits branch only |
| `CONTEXT.md` (+90 lines) | repo docs | glossary for coordinator, worker, zone, machine file, worker container | agents/humans read | G13 G19 G25 G30 G31 | partly | merged (#85 edit branch only) |
| `README.md` (+52) | repo docs | parts tables for provisioning + worker container | humans | — | no | merged |
| `.github/workflows/check.yml` (+46) | GitHub CI | runs all fleet unit/static tests incl. devcontainer, plugin, reply-card | GitHub Actions on PR/push | #57 | no | merged |
| `.gitignore` (+3) | repo | un-ignores `plugin/agents/` | git | — | no | merged |

## 3 · agent-platform

| file | lands on | what it is | how it works / who reads it | decision | dest? | live? |
|---|---|---|---|---|---|---|
| `.gitlab-ci.yml` (+139) | agent-platform | MR pipeline on own runner: floor jobs, manual full gate, delivery-probe, mutation | GitLab → runner tag `aruvii-gate` | R28 · G29 · G26 · G20 | partly (delivery-probe = do nested AGENTS.md reach claude+codex) | branch only (!263 draft) |
| `CLAUDE.md` (+16/−6) | agent-platform | replaces "There is no CI" with the new pipeline description | every agent session | G29 | no (and #643 moves this text to AGENTS.md — conflict) | branch only (!263) |
| `docs/spec/REQ-067-gitlab-ci-pipeline.md` (+277/−192) | agent-platform | REQ-067 amended in place for own-runner gate | /crq spec | R28 · G29 | no | branch only (!263) |
| `docs/adr/0011-makefile-is-the-single-gate-definition.md` (+18) · `docs/adr/README.md` | agent-platform | ADR-0011 amended: CI jobs call make targets | readers | G29 | no | branch only (!263) |
| `Makefile` (+31/−3) | agent-platform | new targets for gate stack reset / secrets / jobs | CI jobs + humans | G29 | no | branch only (!263) |
| `.claude/rules/dependencies.md` (+6/−4) | agent-platform | notes the new pipeline vs CVE gap | path-scoped rule | G29 | no | branch only (!263) |
| `docs/architecture/ARCHITECTURE.md` · `docs/design/SDLC-WORKFLOW-DESIGN.md` · `docs/spec/REQ-070-smoke-flake-visibility.md` | agent-platform | 1–4 line pointers to the new CI | readers | G29 | no | branch only (!263) |
| !269 (#670 key outside checkouts) | agent-platform | **no file changes** — spec lives in #670 description | — | G13 | no | nothing on branch |
| `AGENTS.md` (+483) / `CLAUDE.md` (→ `@AGENTS.md`) | agent-platform | flip: root text moved verbatim into AGENTS.md, CLAUDE.md imports it | Claude reads CLAUDE.md → AGENTS.md; codex reads AGENTS.md | G1 · G20 · #643 | yes | local only (WIP `71b5deb4`, dated 10-02, unpushed; 482 lines/33 KB > 32 KiB cap) |
| `.agents/skills/**` (55 files: 18 skills moved + new domain SKILLs code/testing/obs/delivery/migrations/planning; crq/dod/issue/refine commands → skills) | agent-platform | one skills tree; knowledge grouped by domain | Claude via `.claude/skills` symlink; codex native | G1 · G23 (contradicts G23 B: generic content stays in AP) | yes (one source) | local only |
| `.claude/skills` → `../.agents/skills` (symlink) | agent-platform | makes Claude see the moved tree | Claude Code skill discovery | G1 | yes | local only |
| `.claude/agents/*-reviewer.md` ×4 | agent-platform | path edits to new rubric locations | review subagents | G3 | partly (not diff-scoped yet) | local only |
| `docs/agents/personas/{analyst,developer,qa,spec-reviewer}.md` | agent-platform | path edits in AP's own role personas | old fleet render | — | partly (2nd soul source vs fleet `plugin/agents`) | local only |
| `docs/design/ONE-RULEBOOK-SKELETON.md` (+97) | agent-platform | where every skill and rule moves | design doc | #643 · G23 | yes | local only |
| `.claude/rules/*.md` ×5 · `.claude/always-on/agent-output.md` · `.claude/settings.json` · `aruvii-api/CLAUDE.md` · `docs/{CONTEXT,guides/*,design/SDLC-WORKFLOW-DESIGN,AGENT-PRINCIPLES,flyway-jpa…}.md` | agent-platform | path updates `.claude/skills` → `.agents/skills` | rules / allow-list / docs | #643 | no | local only |

## 4 · skills plugin (chiyanram/skills)

| file | lands on | what it is | how it works / who reads it | decision | dest? | live? |
|---|---|---|---|---|---|---|
| `.claude-plugin/marketplace.json` | skills plugin → laptop + image | marketplace `chiyanram` with one plugin `rulebook` | `claude plugin marketplace add`; image enables it | G23 (#93) | yes | merged (#107) |
| `plugins/rulebook/.claude-plugin/plugin.json` + `skills/.gitkeep` | skills plugin | rulebook plugin manifest v0.1.0, **zero skills** | baked by `bake-plugins.sh` | G23 | yes (empty) | merged, empty |
| `Makefile` (lint) | skills repo | `claude plugin validate --strict` on both manifests | operator before push | G10 | partly | merged |
| `README.md` (+33) | skills repo | install steps: laptop, worker image, codex caveat | humans | G23 · G20 | yes (identical load) | merged |
| `design-overview.md` · `requirements.md` | skills repo | map docs aligned to 10-16/17 decisions | humans/agents | map #9 | yes | merged |
| `refs/README.md` | skills repo | repinned citations | humans | R38 | no | merged |
| `review/neutral-pairs.{html,json}` + `template-neutral.html` | review page | neutral-domain Good/Bad pairs + ledger evidence | operator reviews in browser | G23 (#99) | partly (rule content) | merged (10-18) |
| `review/rule-reasons.html` · `reasons.json` · `template-reasons.html` | review page | reason column for each approved rule | operator reviews | G21 (#98) | partly | merged |
| `review/pipeline-comparison.html` | review page | G28 crq pipeline comparison | operator reviews | G28 | partly (crq stages) | merged |
| `review/r36.json` · `r37.json` | review data | Fowler/Spring + Checkstyle research picks | page builders | R36 · R37 (G9b) | partly | merged |
| `review/g9c-migration-rules.html` (dated 10-16) | review page | migration rules decided | operator | G9c (#34) | partly | merged |
| research notes (43 files on 10-17/18; 53 since 10-16) | skills repo | decision register, research, ticket drafts | humans/agents | various | — | merged |

## Totals

| group | rows | merged / applied | branch only | local only | unverified |
|---|---|---|---|---|---|
| 1 VM host | 12 | 10 | 0 | 0 | 2 (coord unit, image) |
| 2 agent-fleet files | 27 | 27 (several have #84/#85 edits on branch) | — | — | laptop plist |
| 3 agent-platform | 15 | 0 | 8 (!263) + !269 empty | 6 (WIP, ~80 files) | — |
| 4 skills plugin | 12 | 12 | 0 | 0 | — |

## Live on the VM right now
sudoers rule · sshd drop-in (host-wide) · `/usr/local/lib/agent-fleet` copy (carries souls, worker rules, briefs, coordinator settings, templates, reply-card) · 3× machine.env · 3× secrets dir + runner stack-secrets · podman conf + prune timers (worker, runner) · linger · gitlab-runner config.toml + service (PR #84 code).
Probably: fleet-coordinator.service (not started). Unknown: worker image. Nothing from agent-platform or skills plugin is active on the VM (no coordinator/worker has run).

## Needed by the original destination
yes: 4 role souls (as a 2nd source) · fleet marketplace/plugin.json · managed-settings.json · AP AGENTS.md flip · `.agents/skills` tree + symlink · ONE-RULEBOOK-SKELETON.md · skills marketplace + rulebook manifest (empty) · skills README install · design-overview/requirements.
partly: coordinator.md · worker-rules · worker-brief · reply-card (unwired) · Dockerfile/devcontainer · install.md · CONTEXT.md · reviewer agent path edits · personas · .gitlab-ci delivery-probe · review pages · skills Makefile.
no: everything in §1 (zones, sudo, sshd, runner, machine.env, units) · egress · gitconfig · coordinator-settings · templates · gate-runner.md · CI yaml · REQ-067/ADR-0011/Makefile/CLAUDE.md edits in !263.

## Scripts / tests (excluded, counts only)
| repo | scripts | tests |
|---|---|---|
| agent-fleet main (+ PR #84/#85 edit, add none) | 19 (15 `scripts/*` + 4 `.devcontainer/*.sh`) | 19 (16 `scripts/test_*` + devcontainer, plugin, reply-card) |
| agent-platform !263 | 3 (check-mr-title, gate-stack, probe-delivery) | 3 `.test.sh` |
| agent-platform WIP 71b5deb4 | 11 path-edited `.sh` | 5 (4 Java/Groovy + 1 `.test.sh`) |
| skills | 3 `review/build-*.py` | 0 |
