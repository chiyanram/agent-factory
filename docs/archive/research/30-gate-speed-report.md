# 30 — Gate speed: one report (2026-10-22)

For chiyanram/agent-factory#20 and agent-platform #738 (verify-full to ~19 min, IT pre-setup standard). Sources:
VM agent measurement (job `20261021-181918-5946a8`, report `~/gate-diagnose-2026-10-21/report.md` on the VM),
research/17 (gate runner), research/27 (VM facts), research/28 (IT Postgres), agent-platform #738 first comment.

## 1 · What

The full gate (`make verify-full` in the Verifier) takes **1h35m** on the VM. The same gate takes **~28 min** on the
laptop (#738, master `7cb49b34`, 2026-10-21). It has grown: 61 min on 10-02 (R29), 1h27–1h33 for #728's last three jobs.

## 2 · What we measured on the VM (1h35m41s, #734's branch, head b73a6f83, nothing else heavy running)

| phase (UTC) | ran | CPU used |
|---|---|---|
| 18:19–18:30 | compile + unit tests (many JVMs) | ~65 % |
| **18:31–19:00** | **integration tests: one Java process at ~100 % of one core** | **~15 % — 7 of 8 cores idle for 30 min** |
| 19:01–19:10 | stack build + deploy | ~35 % |
| **19:26–19:55** | **smoke, ~3 GB of containers, 2 workers** | 50–75 % |

| suspect | seen | real? |
|---|---|---|
| CPU steal (shared vCPU) | `st` = 0 in all 1,201 samples | no |
| memory / swap | 16 GB free; short swap-out bursts only | no |
| other load on the VM | nothing heavy ran | no |
| disk / fsync | iowait 0.1 % mean; fsync 1.2 ms in a disk test | minor (laptop: DB reset 35 ms/test ≈ 35 s per run, #738) |
| slow cores | Intel Broadwell (2014), 8 vCPU | yes — but it only hurts because ITs use one core |
| **serial integration tests** | 30 min on one core | **yes, the biggest** |
| **smoke** | ~30 min | **yes, second** |
| Gradle cache hits | job log not readable by the agent's account | not measured |

## 3 · Why

1. **Integration tests are serial by design.** `maxParallelForks = 1` and JUnit parallel off
   (`aruvii.integration-test-conventions.gradle.kts:30-36`, ADR-0009), because all tests share one Postgres. On a
   slow core one fork takes 30 min while 7 cores wait.
2. **The suite keeps growing** (api ITs 785 → 881 → 996 tests in three weeks), and serial time grows with it.
3. **Smoke is long** because `@llm` tests run on 1 worker against CPU Ollama, with 2 workers overall.
4. The VM's cores are ~2.7× slower per test than the laptop's, so every serial minute costs about three.

## 4 · How others do it (research/17 §2)

| technique | who |
|---|---|
| parallel test forks, "number of available CPU cores or slightly fewer", needs isolated tests | Gradle docs |
| isolation per fork: own database (template copy) | standard Postgres practice; #748's plan |
| split a suite across executors by measured timings | firstmate, Playwright `--shard`, GitLab `parallel: N` |
| scoped checks on a PR, full suite once on main | openclaw (PR CI ~9 min), forge ADR-0064, Google presubmit/post-submit |
| build cache: skip unchanged tasks | Gradle (ours is on) |
| scripted model instead of real inference in the gate | ours `fake-llm` (#576); no reference runs CPU inference in its gate |
| retry one failed job, not the whole gate | GitHub, GitLab |

Shared shape: speed comes from **splitting work across cores and executors, and from the cache** — not from a bigger
single serial job.

## 5 · What we can do — mapped to existing agent-platform tickets

| order | change | ticket | expected effect | measure |
|---|---|---|---|---|
| 1 | one IT pre-setup standard; verify-full orchestration | **#738** | laptop 28 → ~19 min | #738's own table |
| 2 | api ITs in parallel forks, each with a database copied from a template (ADR-0020) | **#748** | the 30-min one-core phase uses all 8 cores | IT phase time on the VM |
| 3 | smoke diet: scripted model for `@llm` specs, fewer/cheaper specs | **#746, #607, #609** | smoke ~30 min shrinks; Ollama can leave the gate stack | smoke phase time |
| 4 | pipeline layout: ITs run beside deploy + smoke, not before | L5 gate pipeline (agent-factory) | removes the wait between phases | total wall |
| 5 | `-c fsync=off` back in the IT Postgres (`AruviiTestcontainersInitializer.java:54` replaces Testcontainers' default) | inside **#738** | small | `db-reset … mean=` |

Re-measure on the VM after each of 1–3 with the same brief (`agent-factory/docs/briefs/vm-gate-diagnose.md`).

## 6 · Decision for the design (#20)

Keep the VM as the GitLab runner — no new machine. Keep "done by kind of work" (B). Gate speed comes from #738, #748
and the smoke diet, in that order, and from running ITs beside smoke in the pipeline.

## 7 · Not measured

Gradle executed vs FROM-CACHE in the Verifier (needs read access to the job folder), the VM's `@llm` vs `smoke`
split, deploy split, per-core benchmark VM vs laptop.
