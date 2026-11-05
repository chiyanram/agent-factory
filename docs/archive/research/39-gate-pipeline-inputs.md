# 39 — Gate pipeline inputs for L5 (#25, gate pipeline by kind) (2026-10-23)

Facts L5 needs, then one PROPOSAL. Read-only collection. Sources:
- agent-platform draft !263 (#671 — own-runner pipeline), branch `chore/671-own-runner-pipeline` @ `0cc32429`
  (`.gitlab-ci.yml`, `docs/spec/REQ-067-gitlab-ci-pipeline.md`, MR notes)
- agent-platform `Makefile` @ `origin/master` (fetched 2026-10-23)
- agent-factory #4 (Q4, Q5a, Q5b), #20 resolution, `docs/adr/0005-gate-gitlab-ci-vm-runner.md`, research/17 §2–§4, research/30
- agent-platform #738, #748, #746, #607, #609 and their successors

---

## 1 · !263 (#671) — what it builds

State: draft, open. `/approved` on spec+design at `03fe17ce`; stage 7 done at `0cc32429`. First MR pipeline
2958342482 was **pending** — no `aruvii-gate` runner had registered then (MR note 2026-10-17 11:01).

```
 merge_request_event only · tags [aruvii-gate] · shell executor, concurrent = 1
 FLOOR (auto, every push)                 FULL (manual full-gate, blocking)       REPORT (manual)
 mr-title  lint  unit  delivery-probe*    full-gate ─needs─▶ it:api                mutation
              └──┬──┘                                      it:runtime             (allow_failure)
                 ▼ needs                                   it:support
             smoke-core (deploy+core)                      smoke-full (deploy+FULL)
 * only when AGENTS.md / skills changed AND a nested AGENTS.md exists
```

| item | !263 value | cite |
|---|---|---|
| workflow | MR pipelines only | `.gitlab-ci.yml:21` "`$CI_PIPELINE_SOURCE == "merge_request_event"`" |
| stages | `floor, full, report` | `.gitlab-ci.yml:23` |
| executor / tags | shell, `concurrent = 1`, user `fleet-runner`, tag `aruvii-gate` | `.gitlab-ci.yml:4-5`, `:26` |
| default | `interruptible: true`, `timeout: 30 minutes` | `.gitlab-ci.yml:27-28` |
| retry | `max: 1`, `when: [runner_system_failure]` only | `.gitlab-ci.yml:29-31` |
| smoke template | `interruptible: false`, `resource_group: aruvii-gate-stack` | `.gitlab-ci.yml:38-39` |
| smoke prep | `gate-deps` → `gate-secrets` → `gate-reset` → `certs` | `.gitlab-ci.yml:41-44` |
| smoke artifacts | `playwright/results/`, `playwright/traces/`, `when: always`, 14 days | `.gitlab-ci.yml:45-50` |
| JUnit artifacts | `reports: junit: "**/build/test-results/**/TEST-*.xml"` | `.gitlab-ci.yml:56-57` |
| `mr-title` | `make check-mr-title`, title via `MR_TITLE` env, never interpolated | `.gitlab-ci.yml:61-64` |
| `lint` | `gate-deps` · `lint` · `build-ui` | `.gitlab-ci.yml:68-71` |
| `unit` | `gate-deps` · `test IT=0` · `test-doctor` · `test-next` · `test-property` | `.gitlab-ci.yml:76-81` |
| `smoke-core` | `needs: [lint, unit]`, `make smoke` | `.gitlab-ci.yml:83-88` |
| `delivery-probe` | `rules: changes: [**/AGENTS.md, .claude/skills/**, .agents/skills/**]` + `exists` | `.gitlab-ci.yml:95-96` |
| `full-gate` | `when: manual`, `allow_failure: false`, only `echo` | `.gitlab-ci.yml:100-105` |
| `it:api` | `verify-module MOD=aruvii-api`, 90 min | `.gitlab-ci.yml:107-113` |
| `it:runtime` | `verify-module` worker, chat, agents (serial in one job) | `.gitlab-ci.yml:115-123` |
| `it:support` | `verify-module` tools, infra, test-support | `.gitlab-ci.yml:125-133` |
| `smoke-full` | `needs: [full-gate]`, `make smoke FULL=1`, 90 min | `.gitlab-ci.yml:135-141` |
| `mutation` | manual, `allow_failure: true`, pitest reports artifact | `.gitlab-ci.yml:143-155` |

How floor/full is chosen: **not by kind.** Every MR gets the same floor; the full lane is one manual click at
`/crq` stage 9 (REQ-067 D5: "Floor on every push; the full gate is manual and blocking"). D9 says the split is
"**provisional**" (REQ-067:123).

New make targets !263 adds (not on master yet): `check-mr-title`, `gate-deps`, `gate-secrets`, `gate-reset`,
`probe-delivery` (branch `Makefile` diff, `.PHONY` line 64).

### Right / wrong, against L5's decisions

| | !263 | verdict for L5 |
|---|---|---|
| every job calls `make` (ADR-0011) | yes | **keep** |
| deploy + test in one job, `resource_group` across pipelines (D10) | yes | **keep** — honours "never interrupt a deploy" and last-deploy-wins |
| `gate-reset` → empty DB per smoke job (D12) | yes | **keep**; cost: `down -v` also drops Ollama volume, re-seed every job (MR note, stage 7) |
| one job per IT group, each `needs: [full-gate]` only → single-job retry (AC-6) | yes | **keep** |
| JUnit + Playwright artifacts, 14 days, `when: always` | yes | **keep** |
| title checked from env, never executed | yes | **keep** |
| done by kind (#4 Q4) | no — docs-only MR still runs `unit` + `smoke-core` | **change** |
| floor (migration/security/API/dep) → full automatically | no — full is always a manual click | **change** |
| ITs beside deploy+smoke (#20) | blocked by `concurrent = 1`: all jobs serial | **change** runner `concurrent` ≥ 2 |
| `smoke-core` waits on `lint`+`unit` (`needs`) | yes | **change** — serialises; L5 wants ITs/smoke beside |
| retry only `runner_system_failure` | no `script_failure` retry | keep (a flake retry hides flakes; REQ-070 records them) — operator call |
| `it:runtime` / `it:support` run 3 modules serially in one job | yes | revisit after #760 (parallel forks) |
| `full-gate` job only `echo`s | a button, not a gate | drop if full is picked by rule |

---

## 2 · Makefile @ origin/master — targets a job would call

| target | runs | deploys / lock | cite |
|---|---|---|---|
| `lint` | `checkstyleMain/Test/IntegrationTest`, `npm run lint`, `typecheck:pw`; `ONLY=java\|ui` | no | `Makefile:353-357` |
| `build-ui` | `npm run build -- --configuration production`, zero warnings | no | `Makefile:362-365` |
| `test` | `gradlew check` (+ITs) and `npm test` + `test:unit:pw`; `IT=0` drops ITs; `ONLY=api\|ui\|arch` | no | `Makefile:188-194` |
| `test-module` | `gradlew :$(MOD):test [--tests]` — "not a gate" | no | `Makefile:205-208` |
| `it-module` | `gradlew :$(MOD):integrationTest [--tests] [-Dollama.it]` | no | `Makefile:212-215` |
| `verify-module` | `gradlew :$(MOD):check` (units+ITs+Checkstyle+JaCoCo floor) | no | `Makefile:223-226` |
| `test-doctor` | shell unit tests incl. `stack-lock.test.sh` | no | `Makefile:322-325` |
| `test-next` | `scripts/next.test.sh` | no | `Makefile:335-338` |
| `test-property` | `npm run test:property:pw` | no | `Makefile:294-297` |
| `test-ui` | `node-check`, jest, playwright unit | no | `Makefile:280-283` |
| `doc-drift` | `scripts/check-doc-drift.sh` — docs claims vs code | no | `Makefile:368-371` |
| `verify-fast` | test-doctor, test-next, `check -x integrationTest`, lint, test-ui, test-property | no | `Makefile:376-379` |
| `verify` | doctor, test-doctor, test-next, `gradlew check`, `npm ci`, lint, test-ui, test-property, build-ui | no | `Makefile:388-391` |
| `verify-full` | `verify` then `smoke FULL=1` | **yes** | `Makefile:403-408` |
| `deploy` | under `stack-lock.sh`: `deploy.sh` (image build skips tests), `up -d`; `ONLY=` | **yes, lock** | `Makefile:159-163` |
| `smoke` | `node-check`, under **one** `stack-lock.sh run`: build fake-llm, `deploy.sh all`, `npm run smoke:core` (or `smoke` with `FULL=1`); `DEPLOY=0` skips deploy | **yes, lock** | `Makefile:412-427` |
| `mutation` | `gradlew :aruvii-guardrails:pitest` — guardrails only | no | `Makefile:252-255` |
| `certs` / `secrets` | generate certs / secrets if absent | no | `Makefile:86-95` |
| `doctor` | read-only machine probes | no | `Makefile:73-77` |

Stack lock: `scripts/stack-lock.sh` = "One stack run at a time, per machine (#717)" (`stack-lock.sh:5`); lock file in
the git common dir, a live holder → exit 75 `stack busy:` (`stack-lock.sh:19-22`). Only `deploy`, `smoke`
(hence `verify-full`) and Playwright globalSetup take it. On the runner, `resource_group` is the cross-pipeline
guard; the lock is the per-machine one.

Gap: **no "touched modules" target exists.** `test` is repo-wide; `verify-module` is one module. "Touched tests"
needs either a per-module loop from changed paths, or reliance on the Gradle build cache (`~/.gradle` persists on
a shell executor → unchanged modules report `FROM-CACHE`; research/17 §3b). Cache hit rate on the VM: not
measured (research/30 §7).

---

## 3 · Decisions L5 must honour

| # | decision | source |
|---|---|---|
| D-a | docs/skills/md only → lint + rule-load check | #4 Q4; ADR-0005:15 |
| D-b | quick/standard code → touched modules' tests + smoke-core | #4 Q4; ADR-0005:15 |
| D-c | floor (migration, security, public API, new dependency) or full lane → full gate at head SHA | #4 Q4 |
| D-d | "C once the gate is fast": full gate before every merge, later | #4 Q4 |
| D-e | GitLab CI on the VM's own project runner; "Pipelines must succeed"; one job can be rerun | #4 Q5a; ADR-0005:14 |
| D-f | writers never deploy the stack; ITs via Testcontainers; smoke only in the pipeline | #4 Q5b; ADR-0005:19 |
| D-g | ITs run beside deploy + smoke, not before | #20 resolution; ADR-0005:16; research/30 §5 row 4 |
| D-h | results keyed to head SHA (MR is the record) | #4 Q1, Q3b; REQ-067 D8 |
| D-i | GitLab Free: no merge trains, no merged-results pipelines | research/17 §2 row "merge queue / train" |
| D-j | one VM runner: 8 vCPU (Broadwell, shared), 24 GB, rootless podman, shell executor | research/30 §2; research/17 §3d; agent-fleet `docs/gate-runner.md:9,14` |
| D-k | VM is idle, not slow: ITs 30 min on one core, 7 idle; smoke ~30 min | research/30 §2 |
| D-l | speed order: #738 → parallel IT forks → smoke diet → L5 layout | #20 resolution; research/30 §5 |

Tension to flag: D-b says "touched modules' tests" — whether that includes the touched modules' **ITs** is not
stated. Proposal below assumes **yes** (`verify-module` per touched IT module), because units alone miss
Testcontainers breaks.

---

## 4 · How a job can know an MR's kind (GitLab Free)

| signal | GitLab mechanism | Free? | re-evaluated when | used by !263 |
|---|---|---|---|---|
| changed paths | `rules: changes:` (MR pipelines diff against the target branch); `changes: compare_to:` | yes | every push | yes — `delivery-probe` only (`.gitlab-ci.yml:95`) |
| labels | `$CI_MERGE_REQUEST_LABELS` in `rules: if:` | yes | **only at pipeline creation** — a label change starts no pipeline | no |
| MR title type | `$CI_MERGE_REQUEST_TITLE` in `rules: if:` (regex) | yes | only at creation; edit starts no pipeline (REQ-067 "The gap this accepts") | read, not used for lanes |
| computed kind | a `classify` job writes a child-pipeline YAML; `trigger: include: artifact:` | yes (parent-child) | every push | no |
| manual click | `when: manual` + `allow_failure: false` → pipeline "blocked" | yes | n/a | yes — `full-gate` |

Note: `rules:` cannot read a dotenv artifact from an earlier job; dynamic choice needs a child pipeline.
Recommendation: **paths decide by default, one label forces full.** Paths are re-checked every push and cannot be
forgotten; the label is an operator override. Title type is unreliable as a kind (a `docs(...)` title can
carry code).

Floor paths on master (verified to exist):

| floor class | paths |
|---|---|
| migration | `aruvii-infra/src/main/resources/db/migration/**` |
| security | `aruvii-api/src/main/java/ai/aruvii/api/security/**`, `**/config/SecurityConfig.java`, `aruvii-auth/src/main/**`, `aruvii-shared/src/main/java/ai/aruvii/shared/{auth,security}/**`, `**/*CredentialEncryptor.java` |
| public API | `aruvii-api/src/main/java/**/*Controller.java` (59 files, all in aruvii-api); `aruvii-shared` DTOs — scope for operator |
| new dependency | `gradle/libs.versions.toml`, `**/build.gradle.kts`, `build-logic/**`, `aruvii-ui/package.json`, `aruvii-ui/package-lock.json` |

Docs-only paths: `**/*.md`, `docs/**`, `.agents/**`, `.claude/**` (minus `.claude/hooks/**`, which is code).

---

## 5 · Open agent-platform tickets that change the gate

| ticket | state | what it changes in the pipeline |
|---|---|---|
| **#738** — cut verify-full to ~19 min, IT pre-setup | open (design on !294) | faster `it:api` (hard ≤8 min on laptop), BCrypt 10 in tests, `fsync=off`, Checkstyle not run twice in `verify`, smoke `llm` overlaps `smoke`; adds a VM timing row. Every timing below waits on it |
| **#748** — api ITs in parallel forks | closed into #752 → build **#760** (open) | `maxParallelForks` default 4, DB per fork from template; target IT phase on VM ≤10 min. `it:api` uses more cores → competes with smoke for CPU |
| **#746** — login once per role, workspace per worker | closed into #753 → build **#763** (open) | shorter smoke jobs; no YAML change |
| **#607** — prune smoke to critical paths | closed into #753 → builds **#764** (bucket 1, open) … buckets 2–6 | smoke-full shrinks; target full smoke on VM ≤10 min (#753) |
| **#609** — `@llm` specs to scripted model | closed into #753 → build **#762** (open) | per-PR smoke all scripted; 3 real-model specs leave the gate as opt-in tier → Ollama can leave the gate stack, shorter deploy and `gate-reset` |

---

## 6 · PROPOSAL (draft for the operator — not decided)

Kind is decided by paths at every push, plus one label `gate::full` to force the full gate.
Every timing is **"after #738" — unmeasured**.

```
 MR push (merge_request_event only) · tags [aruvii-gate] · runner concurrent = 3 (was 1)
 kind = docs | code | floor    (rules: changes:, label gate::full ⇒ floor)

 stage check ─────────────────────────────────────────────────────────────────────
   mr-title ──┐   lint(+build-ui if ui/**) ─┐   probe-delivery* (docs/skills changed)
              │                             │
 stage test ──┼─────────────────────────────┼─────────────────────────────────────
   [code,floor]  unit  (test IT=0 · test-doctor · test-next · test-property)
   [code]        it:touched   (verify-module per touched IT module)  ║ parallel
   [floor]       it:api · it:runtime · it:support                    ║ with ▼
 stage stack ────────────────────────────────────────────── resource_group ───────
   [code]   smoke-core  (gate-reset → make smoke)          needs: [] ║ beside ITs
   [floor]  smoke-full  (gate-reset → make smoke FULL=1)   needs: [] ║ beside ITs
 stage report ────────────────────────────────────────────────────────────────────
   mutation (manual, allow_failure)          flake-history.jsonl → artifact
 * probe-delivery = the "rule-load check" for docs MRs
```

| # | job | stage | runs (make) | when (kind) | parallel with | retry | results |
|---|---|---|---|---|---|---|---|
| 1 | `mr-title` | check | `check-mr-title` | all | 2, 3 | 1× `runner_system_failure` | job log |
| 2 | `lint` | check | `gate-deps` · `lint` · `build-ui` (`build-ui` only if `aruvii-ui/**` changed) | all | 1, 3 | same | job log |
| 3 | `probe-delivery` | check | `probe-delivery` | docs paths changed (AGENTS.md, skills, rules) | 1, 2 | same | job log |
| 4 | `unit` | test | `gate-deps` · `test IT=0` · `test-doctor` · `test-next` · `test-property` | code, floor | 5–8 | same | JUnit report, 14 d |
| 5 | `it:touched` | test | `verify-module MOD=<m>` per touched module with `src/integrationTest` | code (not floor) | 4, 9 | same | JUnit report |
| 6 | `it:api` | test | `verify-module MOD=aruvii-api` | floor | 4, 7, 8, 10 | same | JUnit report |
| 7 | `it:runtime` | test | `verify-module` worker · chat · agents | floor | 4, 6, 8, 10 | same | JUnit report |
| 8 | `it:support` | test | `verify-module` tools · infra · test-support | floor | 4, 6, 7, 10 | same | JUnit report |
| 9 | `smoke-core` | stack | `gate-deps` · `gate-secrets` · `gate-reset` · `certs` · `smoke` | code | 4, 5 | same; not interruptible | Playwright results + traces, `flake-history.jsonl`, 14 d |
| 10 | `smoke-full` | stack | same prep · `smoke FULL=1` | floor | 4, 6–8 | same; not interruptible | same as 9 |
| 11 | `mutation` | report | `mutation` | manual, any | — | none | pitest report |

Rules for every row:
- Results keyed to `$CI_COMMIT_SHA`; "Pipelines must succeed" reads them; a new push makes them stale (REQ-067 D8).
- Smoke jobs `needs: []` so they start beside the ITs, not after `lint`+`unit` (!263 chained them).
- No job `allow_failure` except `mutation`. No `full-gate` button when the lane is chosen by rule.
- Writers never call jobs 9–10's targets (D-f); they run `test-module` / `it-module` / `verify-module` only.

Timings — **all "after #738", unmeasured on the VM**:

| lane | critical path | basis |
|---|---|---|
| docs | `lint` (+ probe) | — |
| code | max(`unit`+`it:touched`, deploy + `smoke-core`) | — |
| floor | max(`it:api`, deploy + `smoke-full`); research/17 est. ~35 min pre-#738 with `concurrent` 2–3 | research/17 §3b, §4 |

Open questions for the operator:
1. "Touched modules' tests" — units only, or ITs too? (proposal: ITs too, `it:touched`).
2. `concurrent = 3` on 8 shared vCPU / 24 GB: OOM risk once #760 forks are on (4 forks × 2 GB heap) beside a
   ~3 GB smoke stack. Measure before raising.
3. `it:touched` needs a small script mapping changed paths → modules (and dependents?). Or accept the Gradle
   cache as "touched" and run `test` with ITs on. Choose one.
4. Is `aruvii-shared` DTO change "public API"? Defines the floor path list.
5. `script_failure` retry: keep off (flakes stay visible via REQ-070) or allow 1?
6. When D-d (full before every merge) arrives: flip floor rules to `when: always`; nothing else changes.
