# 17 — The gate runner: where the hour goes, how others get a fast gate, options with no paid CI (2026-10-18)

Ticket: chiyanram/agent-factory#15 (parent #1). Read-only. Describes and compares; decides nothing.

| tag | source | pin / date |
|---|---|---|
| R28/R29/R30/R66 | `~/workspace/skills/research/37`, `38`, `39`, `66`; skills #60, #62, #63 (+ comments) | as written |
| F08/F11/F12/F14 | `agent-factory/research/08`, `11`, `12`, `14 §4` | 2026-10-18 |
| af | agent-fleet `origin/main 8738986`: `verifier/fleet-verify`, `docs/gate-runner.md`; af#56 | read today |
| ap | agent-platform `origin/master b138661b`: `Makefile`, `build-logic/`, `gradle.properties`, `docker-compose.yml`, `aruvii-ui/playwright.smoke.config.ts`; #576 #609 #610 | read today |
| !263 | `glab mr diff 263` (#671 — own-runner pipeline, draft) `.gitlab-ci.yml` | read today |
| GL | `glab api projects/…agent-platform` + `/runners` | read today |
| LAP | Playwright `report.json` + JUnit XML left in local worktrees under `~/workspace/agent-platform` | 2026-09-30 → 10-18 |
| web | docs.gitlab.com, docs.gradle.org, playwright.dev, contabo.com, hetzner.com, docs.hetzner.com | read 2026-10-18 |

Live GitLab state (GL): `merge_method: ff`, `squash_option: always`, `shared_runners_enabled: **false**` (instance runners are now off),
`only_allow_merge_if_pipeline_succeeds: **false**`, one project runner `aruvii-gate-vmi3573588` online. `vmi…` is Contabo's naming, so the VM is a Contabo VPS.

---

## 1 · Where the time goes

### 1a · The VM (R29, job `133306-d28641`, #622 @54457bf1, PASS 60m45s, 2026-10-02)

| phase | VM time | share | what drives it |
|---|---|---|---|
| smoke FULL (795 tests, 2 workers, retries 1) | 24m33 | 40 % | `@llm` project pinned to 1 worker on CPU Ollama `qwen3:1.7b`; host strain held workers at 2 (`playwright.smoke.config.ts:36-41`) |
| one Gradle `check` (build + units + ITs + Checkstyle + JaCoCo) | 21m40 | 36 % | aruvii-api `integrationTest` (790 tests) alone 18m50: `maxParallelForks = 1`, junit parallel off (`aruvii.integration-test-conventions.gradle.kts`) |
| deploy (3 images 3m26, then start → healthy) | ~10m | 16 % | ~6.5 min healthy wait. api `start_period 30s / interval 15s / retries 5`, worker waits on api, ollama `start_period 60s / retries 10` (`docker-compose.yml:106-111,179-185,300-305`) |
| UI build + Playwright unit | 2m33 | 4 % | — |

Not the cause: memory (10 GB free, 0 OOM kills — R29). The runs per MR are 1h00–1h09 (F12 #24). The VM: 8 vCPU / 23 GB, rootless podman.

### 1b · The laptop — partly known now (LAP)

The laptop is an Apple M5 Max (18 cores, 36 GB; `sysctl`). The worktrees still hold the reports of earlier runs:

| phase | laptop (LAP) | VM (R29) | ratio |
|---|---|---|---|
| smoke FULL, 2 workers, ~800 tests | **8.1–13.4 min**, 8 runs 09-30 → 10-18; typical ~8.5 (e.g. `crq-585` 10-18: 8.4 min, 801 passed) | 24m33 (795) | **~2.8×** |
| of which `llm` project (1 worker) | 3.8 min, 48 tests (`crq-585` report) — runs alongside `smoke` in the pool | not split | — |
| smoke core (`@core`, 1 worker) | 4.3–4.4 min, 164–173 tests | — | — |
| aruvii-api `integrationTest` (JUnit first start → last end) | **6.9 min** for 785 tests (10-02); 8.5 min / 818 (10-17); 10.3 min / 881 (10-18) | 18m50 for 790 (10-02) | **~2.7×** |

Two facts follow. The same suite size runs ~2.7–2.8× slower on the VM, in both the JVM and the browser phases, so "is the VM slower or is the gate this big" (R29, F11 §4 q1) is answered in part: **both**. And the IT suite is growing (785 → 881 tests in 16 days).
Caveats: several worktrees carry identical IT timestamps, which are restored `FROM-CACHE` outputs (shared `~/.gradle`), so the numbers are three runs, not nine. The ollama container on the Mac also runs on CPU, but nothing here says whether it is native or containerised. And #609's "about 50 min of 1 h is the `@llm` tier" does not match either machine (laptop llm 3.8 min; VM smoke total 24.5 min).

**Still unknown:** the laptop's full Gradle `check` wall time and its cache hit rate, deploy → healthy on both machines, the VM's split of smoke between `llm` and `smoke`, CPU steal on the VM (a shared-vCPU VPS), and whether the Verifier's clean clone gets Gradle cache hits.

### 1c · Measurement plan (operator; same SHA on both machines; no pipes into `tail`)

| # | where | command | record |
|---|---|---|---|
| M1 | both | `git rev-parse HEAD; nproc \|\| sysctl -n hw.ncpu; free -g \|\| sysctl hw.memsize` | SHA, cores, RAM |
| M2 | both | `make clean; /usr/bin/time make verify FRESH=1 > m2.log 2>&1; echo $?` (`time -v` on Linux, `-l` on mac) | wall, exit, peak RSS |
| M3 | both | `grep -E 'actionable tasks\|BUILD' m2.log`; then repeat M2 **without** `FRESH=1` at the next SHA | executed vs `FROM-CACHE` — what the cache saves on an ordinary change |
| M4 | both | the JUnit-XML script: per module `build/test-results/integrationTest/TEST-*.xml` → min `timestamp` → max `timestamp+time`, test count | IT wall per module (the log has no timestamps — R29) |
| M5 | both | `/usr/bin/time make deploy`; then `docker inspect -f '{{.Name}} {{.State.StartedAt}} {{.State.Health.Status}}' $(docker compose ps -q)` (podman on the VM) | build vs healthy wait, slowest container |
| M6 | both | `/usr/bin/time make smoke FULL=1 DEPLOY=0`; then the per-project split from `aruvii-ui/playwright/results/report.json` (sum `results[].duration` by `projectName`) | smoke wall; llm vs non-llm |
| M7 | VM | `vmstat 5` (or `mpstat 5`) during M2 and M6 → `st` column | CPU steal %: noisy neighbours vs core speed |
| M8 | VM | the same report split on an existing Verifier job: `fleets/<fleet>/jobs/<id>/report/<suite>/` | VM llm share, no new run needed |
| M9 | VM | `make smoke FULL=1 DEPLOY=0` with workers 2 → 3 → 4 (Playwright `--workers`), recording flaky/failed | whether E7/#38's host-strain limit holds on this VM |

---

## 2 · How references and products get a fast gate

| technique | who | how | source |
|---|---|---|---|
| shard on measured timings | firstmate | one timed test runner, then shards across CI runners by timing; "never tried more local parallelism" | R30 §3 (`f02eef1`, `673b6ad`, `869ae90`) |
| scoped lanes in PR CI, full CI on main | openclaw | changed-lanes manifest picks PR lanes; full `main` CI hourly; PR CI ~9 min | R66 §4 (`ci.yml:180-191,762 @b94e5177`; `299d289e9`) |
| touched-area checks local, full suite on forge | forge, firstmate | ADR-0064 "only the commands for the areas they touched"; fm `--changed` normal, `--all` deliberate | R66 §4 |
| affected graph incl. dependents | Nx | git diff base..head → project graph → plus dependents | R66 §2 (nx.dev affected) |
| build cache | Gradle | skip a task whose inputs did not change → `FROM-CACHE`; ours is on (`gradle.properties` `org.gradle.caching=true`) | R66 §2 (docs.gradle.org build_cache) |
| parallel test forks | Gradle | `maxParallelForks` "number of available CPU cores or slightly fewer"; needs isolated tests | docs.gradle.org/current/userguide/performance.html |
| test filter | ours | `make test-module/it-module MOD= TEST=`; a non-matching `TEST=` fails | ap `Makefile:202-215` |
| shard a browser suite | Playwright | `--shard=x/y`, blob reporter, `merge-reports`; per-file split unless `fullyParallel` | playwright.dev/docs/test-sharding |
| split one job N ways | GitLab | `parallel: N` with `CI_NODE_INDEX/CI_NODE_TOTAL` (the splitting comes from the test tool) | docs.gitlab.com/ci/jobs/job_control/ |
| rerun one job at the same SHA | GitHub, GitLab | GH "re-run failed jobs"; GitLab retry one job → new job id, same pipeline | R66 §1 |
| auto-cancel superseded runs | firstmate, openclaw, GitLab | per-PR `cancel-in-progress`; GitLab `interruptible` | R30 §3; R66 §1 |
| failed-run evidence | Playwright, ours | `trace: retain-on-failure` (ours); Verifier keeps `log.gz`, reports, `failed-tests.txt` 14 days, but the stack's container logs die at teardown (F12 #25) | ap smoke config; af `fleet-verify:run_job` |
| flake class kept visible | Playwright, Google, openclaw | `flaky` outcome; Google auto-quarantine; openclaw FRV record with owner | R66 §3 |
| fake / scripted model | ours | `fake-llm` scripted by key (#576 closed); only smoke-92, smoke-69 and a few others use it; 19 spec files carry `@llm` (24 tags); #609 (convert the rest) open | ap `git grep`; #576, #609 |
| fast vs slow tier | ours, Google | core ~4–5 min vs full; Google presubmit vs post-submit | ap Makefile `smoke`; R66 §2 |
| merge queue / train | GitHub, GitLab | GH merge queue tests against PRs ahead; **GitLab merge trains and merged-results pipelines are Premium/Ultimate only** | R66 §1; docs.gitlab.com/ci/pipelines/merge_trains/, /merged_results_pipelines/ |

Shared shape (R66): narrow before merge, full in one place. The speed comes from **splitting across executors and from the cache**, not from a bigger single serial job. None of the references uses CPU inference in its gate.

---

## 3 · Self-hosted options, no paid CI

GitLab metering: "The usage of instance runners by projects running CI/CD jobs is measured in compute minutes." Free = "400 compute minutes per month". Project runners are not named as metered (docs.gitlab.com/ci/pipelines/compute_minutes/). Instance runners are already off (GL).

### (a) The existing Verifier, improved (af `verifier/fleet-verify`)

Today it has one fixed `command` per fleet, PASS iff exit 0, one slot, SUPERSEDED for queued jobs only, `log.gz` + reports + `failed-tests.txt` kept 14 days, and the teardown and sweep always run. `docs/gate-runner.md` already says the new gate does not use it ("keeps serving the old fleet until cutover").

| change | how | gain | effort |
|---|---|---|---|
| test filter / scoped run | `submit --target <make target>` checked against a config allow-list (e.g. `verify-module MOD=…`, `smoke DEPLOY=0`) | rerun of one phase: ~2–25 min instead of 61 | S–M (Python + tests; the result must name the target, or "PASS" stops meaning the full gate) |
| keep failure logs | before teardown: `docker compose logs --no-color > d/stack.log` for a non-PASS result | flake cause visible (F12 #25: ~4h40 on one flake) | S |
| cancel | af#56 proposal: cancel marker → kill the process group → teardown → CANCELLED; submit cancels an older running job | ~2 h lost on 10-02 (F11 #46) | M (needs a grill) |
| phase timestamps | prefix the log with time, write per-phase durations to `summary.json` | covers M4/M5 permanently | S |

Speed of the full gate is unchanged (still ~61 min, one slot). It rebuilds what GitLab gives natively, and it is a second system beside the forge (R28 opt A, F14 diff #4).

### (b) GitLab project runner on the VM — shell vs docker executor

Registered (`aruvii-gate-vmi3573588`, online). !263's jobs: **floor** `mr-title · lint(+build-ui) · unit(test IT=0 …) · smoke-core` on every push; **full** (manual `full-gate`) `it:api · it:runtime · it:support · smoke-full`; smoke jobs `interruptible: false` + `resource_group: aruvii-gate-stack`; `retry: runner_system_failure`; and with `concurrent = 1`, every job runs one after another.

| | shell executor (registered) | docker executor |
|---|---|---|
| how | job runs as `fleet-runner` on the host; uses its podman, JDK, `machine.env` | each job in a fresh container from an image; Testcontainers + compose need the podman socket mounted |
| GitLab's words | "Generally it's unsafe to run jobs with shell executors" (…/executors/shell/) | "Clean build environment for every build" ✓, "Runner file system access protected" ✓ (…/runner/executors/) |
| isolation | none between jobs; branch code can read the runner's home (F11 #75) | per job, but a mounted socket gives the job the user's container engine anyway |
| caching | `~/.gradle` persists → build cache hits across jobs | needs a cache volume or a remote Gradle cache, else every job is cold |
| speed vs today | serial sum ≈ today's 61 min plus a per-job `gate-deps` + Gradle startup; the floor alone ≈ units + lint + core smoke (~15–20 min on VM, est. from R29 ratios) | the same or slower (image pulls, cold cache) |
| with `concurrent = 2–3` | `it:*` in parallel with deploy + `smoke-full` → critical path ≈ max(it:api 18m50, deploy 10 + smoke 24.5) ≈ **~35 min** on this VM (est.), CPU-bound on 8 shared vCPU | same, with more memory overhead |
| cost | €0 extra | €0 extra |
| effort | merge !263 + "Pipelines must succeed" + `concurrent` tuning; IT jobs each start their own Testcontainers (Ryuk / port contention, F5) | high: image with JDK 25 + Node + Playwright + podman-socket wiring under rootless podman (Podman support not verified here) |

### (c) The laptop as a runner (when it is on)

| | |
|---|---|
| how | second project runner on the Mac (`gitlab-runner` shell executor, own tag); jobs carry both tags or a `tags:` choice; the stack lock from #717 (`scripts/stack-lock.sh`) stops a second stack run on the machine |
| speed | measured ~2.7–2.8× the VM on ITs and smoke (§1b) → est. full serial gate ~25 min; with `concurrent = 2` ~12–15 min critical path (est., unmeasured: Gradle total, deploy) |
| cost | €0 |
| limits | asleep / offline = jobs stay pending; one Compose stack shared with the operator's worktrees (last deploy wins, F11 #14); the shell executor runs branch code as the operator; VM agents cannot rely on it (R28 opt C) |
| effort | S: install + register + tag; a decision on which jobs may land there |

### (d) A faster or bigger machine (prices excl. VAT unless stated)

| machine | CPU / RAM | monthly | source |
|---|---|---|---|
| **current**: Contabo Cloud VPS 8 (spec match; `vmi` runner name) | 8 vCPU (shared) / 24 GB | €14.00 incl. VAT (€11.20 excl.), 24-month term | contabo.com/en/vps/ |
| Contabo Cloud VPS 16 | 16 vCPU (shared) / 64 GB | €37.00 incl. VAT | contabo.com/en/vps/ |
| Hetzner Cloud CCX33 / CCX43 | 8 / 16 **dedicated** vCPU, 32 / 64 GB | €138.49 / €275.99 | hetzner.com/cloud/general-purpose; docs.hetzner.com price-adjustment (from 2026-06-15) |
| Hetzner AX42 (dedicated server) | Ryzen 7 PRO 8700GE, 8 cores + SMT, 64 GB DDR5 ECC, 2×512 GB NVMe | €97.30 + €49 setup | hetzner.com/dedicated-rootserver/ax42; docs.hetzner.com price-adjustment |
| Hetzner AX102 | Ryzen 9 7950X3D, 16 cores + SMT, 128 GB, 2×1.92 TB NVMe | €257.30 + €129 setup | hetzner.com/dedicated-rootserver/ax102; same |
| laptop (reference point) | M5 Max 18 cores / 36 GB | owned | `sysctl` |

No measurement on any of these. The VM's 2.7× gap could be per-core speed, shared-vCPU steal, or rootless podman overhead; M7 tells which. More vCPU on a shared VPS (VPS 16) helps only parallel jobs; dedicated cores (AX, CCX) address both per-core speed and steal. A gate box separate from the agents' VM also removes the "agents and runner share one VM" question (F11 §4 q2). Effort: re-provision `fleet-runner` + runner (af `docs/gate-runner.md` steps 1–7) on a second host.

### (e) Cutting the smoke cost

| lever | effect | state |
|---|---|---|
| scripted model for `@llm` specs (#609) | removes CPU-Ollama load and the 1-worker `llm` lane; on the laptop that lane is 3.8 min serial of an 8.4 min run; the VM share is unknown (M8) | #609 open; Q27 re-grill: converted specs leave Ollama, the rest stay in the gate |
| Ollama out of the gate stack once nothing calls it | shorter deploy (ollama `start_period 60s`, up to 10 retries × 15 s) and frees RAM/CPU | depends on #609 completing |
| `retries: 1` → 0 on a quieter node | the config comment says so ("On a GPU/quieter CI node this can go back to 0") | — |
| workers 2 → 4 | tried before, failed on API/DB host strain (E7/#38); Q27 re-grill kept 2 | M9 on the new hardware |
| core tier on every push, full once at the head | !263's floor/full split | !263 draft |

---

## 4 · What "fast enough for C" needs (C = full gate at the head before every merge)

**Assumptions.** Peak load is W40: 29 merges / week ≈ **6 per working day** (F08; 30-day mean 2.6/day). `merge_method: ff` (GL): every merge moves master, so the next MR has to rebase and its gate result goes stale (R30 §2: "rebase voids evidence"). Full gates are therefore **serial per merge**. Reruns: ~1.5 gates per merge (F12 #24/#25: !249 2 runs, !259 2 runs; !230 5 jobs). The window is an 8 h operator day. For a merge to wait under ~1 h, one slot at ≤50 % utilisation is assumed.

```
gate runs per day  = 6 merges × 1.5            = 9
utilisation        = 9 × T / 480 min ≤ 0.5   →   T ≤ ~27 min
at T = 61 min (today): 9 × 61 = 549 min > 480 → the queue never drains on a peak day
```

**Target: a full gate of ≤ ~25 min wall** at peak, ~45 min at the 30-day mean (2.6/day). Without ff (no forced rebase) the load would be lower, but ff + squash is the project setting.

| combination | full-gate wall (est.) | reaches ≤25? | basis |
|---|---|---|---|
| today: Verifier, one serial job, VM | 61 min | no | R29 |
| (b) shell runner, `concurrent=1`, VM | ~61 min + per-job overhead | no | !263 + R29 |
| (b) `concurrent=2–3` on VM (ITs ‖ deploy+smoke) | ~35 min | no | R29 phases; CPU-bound on 8 shared vCPU |
| (b)+(e) #609 done, VM, parallel | ~30 min (smoke share falls by an unmeasured amount, M8) | borderline | — |
| (c) laptop runner, serial | ~25 min | borderline; only when the laptop is on | LAP ratios ×R29 |
| (b)/(c) + parallel on laptop-class or AX-class cores | **~12–15 min** (it:api ~7–10 ‖ deploy ? + smoke ~8.5) | yes | LAP; deploy unmeasured |
| (d) dedicated box + (b) `concurrent≥2` + (e) | ~12–18 min, assuming AX-class cores ≈ laptop-class (unmeasured) | yes | — |
| + (a)/GitLab single-job retry for flakes | cuts the 1.5× rerun factor toward ~1.1×, since a rerun costs one job, not 61 min | widens the margin | R66 §1 |

What every row that reaches the target shares: **faster cores than the current VM** (the measured 2.7× gap) **and** ITs running beside smoke rather than before it. aruvii-api's IT task stays the longest JVM job. Splitting it further means more than one fork per module, which is an ADR-0009 change. The measurements still to make before any of the "est." rows is trusted: M2/M3 (Gradle total + cache), M5 (deploy), M7 (steal), M8 (VM llm share).
