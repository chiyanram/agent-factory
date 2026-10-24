# 43 — agent-fleet since 2026-10-15: what changed, what it teaches, what the design misses

Source: `chiyanram/agent-fleet` (GitHub), fetched 2026-10-24. `git log --since=2026-10-15 --all`, `gh pr list/view`,
`gh issue list/view`. Compared with `docs/ARCHITECTURE.md`, `docs/adr/0001`–`0008`, `docs/playbooks/coordinator.md`,
`docs/setup/identity.md`, and the freeze list in `docs/handoff-2026-10-18.md` §"Frozen work".
Read-only: nothing was run on the VM.

## 0 · Timeline at a glance

```
10-15 ... 10-17 ████ burst: PR #78 #79 #80 #82 merged; PR #84 #85 opened        ── before freeze
10-18           ── FREEZE (handoff-2026-10-18: "nothing more merges or runs until the design decides")
10-22           ███ PR #87 #88 #89 merged  (issue #86 Verifier steps)            ── AFTER freeze
10-23           █   PR #91 merged          (issue #90 OOM, one heavy run)        ── AFTER freeze
10-24           █   PR #92 merged          (force-with-lease guard tests)        ── AFTER freeze
open            PR #84 runner-register fix · PR #85 generic base + mise · issues #74 #75 #83 #56
```

PR #43 check: `gh pr view 43` = "feat(verifier): per-suite counts and a paste-ready result.md", head repo
`chiyanram/agent-fleet`, merged 2026-09-30 (`dd36e78`). Same repo, and outside the window. The VM path
`/root/projects/agent-fleet` was not inspected (no VM access in this task); nothing found suggests another remote.

## 1 · What changed

| date | item | what changed | why (their reason) | evidence |
|---|---|---|---|---|
| 10-17 | PR #78 (#72 agent side) | coordinator soul/loop, `fleet-spawn`, `fleet-watch` (retry dead worker once, stalls, budget), `fleet-digest`, `post-status`, forge adapter (gh+glab), briefs, `metrics-row.md` | old map skills#9 decisions | commits `360c746`..`86ccbd3`, merge `3ba7883` |
| 10-17 | PR #80 (#74 provisioning) | `fleet-zones` (fleet-coord / fleet-worker / fleet-runner unix users + wall test), `machine.env`, `fleet-runner` wrapping the Verifier, `/approved` only from operator's forge account, one-command host update + fingerprint, reply-card plugin | skills#69 zones, G25, G26, G29 | `e6787f1`, `fe64a25`, `a6fa886`, `76a8cc2`, `2e4d38c`; merge `38938f1` |
| 10-17 | PR #79 (#73 worker image) | one devcontainer image laptop+VM; onboarding baked in; Ryuk needs socket host path; rulebook baked from chiyanram marketplace; one transcript folder per worker; image build needs read-only skills token | #73 | `bb78614`, `b7386ae`, `3319d01`, `b81ce01`, `782712f`, `4b47694`; merge `8738986` |
| 10-17 | PR #82 (#81) | coordinator: own Reporter bot, tmux as `fleet-coord` kept alive by systemd/launchd; settings file in `dontAsk` mode; status to forge thread, not Discord | G31 | `b9344e3`, `96a198f`; merge `59bd102` |
| 10-17 | PR #84 OPEN | `setup-gate-runner.sh` registers with name+executor only; tag + "untagged off" set in GitLab UI | first real VM registration failed: a `glrt-` token refuses `--tag-list`/`--run-untagged` | PR #84 body (FATAL text); commit `c0c3412` author `root` on VM; "gitlab-runner verify: valid" |
| 10-17 | PR #85 OPEN (#83) | image = generic base (claude native, codex, mise, podman-remote; JDK/Gradle/Node removed); worker start runs project's setup from `docs/agents/worktree-setup.md` front matter on `origin/HEAD`; per-zone `fleet-tool-cache` volume; project egress list; port blocks 20000+100·n; machine.env shrunk, JAVA_HOME gone | G32 skills#109: "the fleet is generic, the project brings its toolchain" | PR #85 body; issue #83 contract comment 10-17 15:19 |
| 10-17 | issue #74 comment | VM: `fleet-zones apply` ran; 7 walls held, 2 untested (runner token, Discord token path); check still probes a Discord `.env` that G16/G31 dropped | operator VM run | issue #74 comment 11:57Z |
| 10-22 | issue #86 → PR #87 | `fleet-verify submit --step NAME k=v`: named steps from fleet's `verification.yaml`, regex-checked inputs passed as env vars only, `setup:` block, step jobs jump queued full jobs, `latest/` = full runs only; agent template: re-run failures as steps, handover still needs a full PASS | re-checking one smoke spec cost a ~1 h gate; smoke can run nowhere else | PR #87 body, 63 tests; issue #86 "Decided with the operator, 2026-10-22" |
| 10-22 | issue #86 comment | scope fleet-only; the `smoke` step's direct Playwright call is **permanent**; agent-platform #771 (`make smoke SPEC=`) closed | operator | issue #86 comment 14:36Z |
| 10-22 | PR #88 | step env = setup's final env (`env -0` dump) + inputs | found while moving aruvii toolchain lines into `setup:` — steps had no java/node | PR #88 body |
| 10-22 | PR #89 | unit file carries `FLEET_VERIFY_CODE=<sha256>`; new code restarts an idle slot, refuses on a busy one | new `fleet-verify` never reached a running slot until reboot; a step job would have run the full command | PR #89 body |
| 10-23 | issue #90 → PR #91 | agent template memory paragraph: one heavy run at a time; a killed DB hangs a run; long/repeated runs → Verifier step | aruvii-developer on app **#738**: IT suite + 2nd Gradle run side by side → 9 GB cap → **15 OOM kills** → test Postgres died → run hung → **~3 h lost**; then ~40-min measurements in-session | issue #90 body; `1d0ee0c` |
| 10-24 | PR #92 | guard tests: `--force-with-lease` (± `--force-if-includes`) allowed on feature branches; `--force`, `-f`, `-uf`, `+refspec`, lease to master/main denied | operator decision 10-24: developer may rebase its own branch; old rules **missed** `-f`/`-uf` and `+feat/x` | PR #92 table; recipe change lives in fleet data `aruvii-developer/agent.yaml` (not in this repo) |

## 2 · Learnings

| # | learning | evidence |
|---|---|---|
| L1 | GitLab runner auth tokens (`glrt-`) move tags and untagged policy to the server; CLI flags are refused. Runner setup is a UI step, then register with name + executor only | PR #84 |
| L2 | A test (`test_refuses_without_gitlab_runner…`) fails on any host that really has `gitlab-runner`; fleet tests are host-sensitive | PR #84, PR #87 "Unrelated" note |
| L3 | Agents and the Verifier both run heavy JVM + Testcontainers work on one VM; a 9 GB per-agent cap still OOMs when one agent runs two heavy jobs at once | issue #90; research/11 rows 1, 5, 7 |
| L4 | A killed test Postgres **hangs** the run instead of failing it — liveness, not exit code, is the signal | issue #90 |
| L5 | Hourly full gate is too coarse: people need to re-run one tier/spec (smoke has no other home) | issue #86 |
| L6 | A long-running daemon keeps old code after an install unless the unit changes; idempotent "unchanged and active" hid it | PR #89 |
| L7 | Toolchain set-up done in one shell does not reach the next; the build env must be carried explicitly | PR #88 |
| L8 | The fleet's agent-command guard is a regex and it missed `-f`, `-uf`, `+refspec` force pushes for weeks | PR #92 |
| L9 | Rebase-and-force-with-lease on the agent's own branch is now an operator-approved need | PR #92 |
| L10 | Project-owned toolchain: `make worktree-setup` + one `mise.toml`, read from `origin/HEAD`; cache per host; egress list from the project; gate runner host has no JDK after #85 | PR #85, issue #83 contract |
| L11 | Image build needs a read-only GitHub token for the skills marketplace; Ryuk needs the podman socket's host path | `4b47694`, `3319d01` |
| L12 | Zone walls tested on the VM: 7 held; runner token and Discord path untested; probe set still names the dropped Discord plugin | issue #74 comment |
| L13 | The old fleet is still the live path and is doing design-endorsed work (#738 is gate-speed step 1) | issue #90; `docs/open-items.md:51` |
| L14 | Template changes reach a running agent only after `update-agent.sh --continue` — i.e. a resumed session | PR #87 "After merge", PR #91 |

## 3 · Against the agent-factory design

| # | verdict | where in the design | proposal |
|---|---|---|---|
| L1 | **missed** | ADR-0005 names the runner, not its registration | L5 #25 / runner setup doc: "create runner in GitLab UI with tag + untagged off; register name + executor". Carry PR #84 into L7 #27 as the one frozen fix worth keeping |
| L2 | missed (minor) | — | L7 #27: note when reusing fleet tests |
| L3 | **missed** | ARCHITECTURE §4/§10 allow "at most 2 runs at once" and writers using Testcontainers on one host; no memory budget. ADR-0005 "until the runner exists, the writer runs the same make target" — exactly the run that OOMed | Coordinator playbook §Triggers: count heavy runs, not runs (≤1 heavy local build per host while the gate runner shares the VM). Writer rule in project AGENTS.md: one heavy run at a time. Also check against #748 parallel IT forks, which raise per-run memory |
| L4 | partly covered | playbook "run silent too long → mark interrupted" | Make "silent" mean no output for N min, and record the OOM-kill count in the interrupt note so a hang is not read as slowness |
| L5 | **contradicts / partly covered** | ADR-0005 rejects the Verifier queue and decides "done by kind"; GitLab CI retries single jobs natively | Fleet invested 3 PRs in the rejected Verifier after the freeze. L7 #27: decide if `verification.yaml` steps map to CI jobs (unit / it / smoke-core / smoke-file); the per-spec smoke filter (#771 closed) is still missing on the app side |
| L6 | n/a to design (Verifier retires) | ADR-0005 | L7 #27: note only; same trap applies to any long-running coordinator script — the host-update command must restart it |
| L7 | missed | — | L5 #25 pipeline: setup and test in one job, or export env explicitly between scripts |
| L8 | **covered in principle** | ARCHITECTURE §10 "Claude-only extras are convenience; every hard rule also lives in make lint or CI"; identity.md step 3 protects master | Confirms the design. Add: feature-branch force push is not forge-protected, so §10's claim holds only for master |
| L9 | **missed** | playbook "merge conflict → start writer to rebase" implies a force push, but nothing permits it | identity.md / writer rules: writer may `git push --force-with-lease` to its own MR branch only; master stays protected (step 3) |
| L10 | **missed** | ARCHITECTURE has no worker image and no toolchain story; `worktree-setup` appears nowhere in `docs/` | L7 #27 + L5 #25: writer start = `make worktree-setup` in the fresh worktree, start only on exit 0 (G27 contract from issue #83); gate job runs the same command. PR #85's image half is moot (no containers, §10) |
| L11 | moot | §10 drops containers | L7 #27: drop with the image |
| L12 | **contradicts** | ARCHITECTURE §10 "No unix-zone walls" | VM zone users exist and passed 7 wall tests; L7 #27 must decide remove vs keep; identity.md "Known gap" (agent can read glab token) is what the zones solved |
| L13 | covered | open-items §C "old fleet still live" | L7 #27: list #738 as in flight on the old fleet |
| L14 | **contradicts** ADR-0001 | ADR-0001 "never resume a worker" | Evidence for ADR-0001: rule changes need a resumed session in the old model; fresh workers read them each run |

## 4 · Changed despite the freeze

- **5 PRs merged to `main` after the 2026-10-18 freeze:** #87, #88, #89 (2026-10-22), #91 (2026-10-23), #92 (2026-10-24).
  All authored and merged by `chiyanram`, merged within ~1 min of opening (no review).
- Issue #86 itself says "Built after the agent-fleet freeze lifts", and was built the same day. Its design is
  "decided with the operator, 2026-10-22". Nothing in agent-factory records the freeze being lifted.
- They extend the **Verifier**, which ADR-0005 rejected and L7 #27 plans to retire.
- PR #92 changes live agent permissions via fleet data (`aruvii-developer/agent.yaml`, outside this repo, not seen).
- PR #87 / #91 need `update-agent.sh --continue` and `setup-verifier.sh --register` on the VM: the old fleet's
  configuration was likely changed live after the freeze. Not verified (no VM access).
- PR #84 and PR #85 stayed open and unchanged since 2026-10-17 (`updatedAt` 10-17). Issue #74 and #75 had no new
  comments after 10-17.
