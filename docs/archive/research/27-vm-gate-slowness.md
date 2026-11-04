# 27 — Why the gate is slow on the VM: known facts, suspects, read-only checks (2026-10-21)

For chiyanram/agent-factory#20 (gate speed). Local files only; nothing run on the VM.

## Main finding

Nobody has measured where the VM's time goes. The same tests run ~2.7× slower than on the laptop (JVM and browser alike).
Three causes fit and none is separated: slower cores, CPU steal (shared vCPU), rootless podman storage overhead.
Every recorded Verifier run took 1h00–1h10 (R29 60m45; F12 #24/#25 1h00–1h09; dry run 7 1h10). The only ~1.5 h figure is
#554, before the Verifier, when each agent deployed its own stack (OOM kills, Keycloak timeout — skills research/39:35).

## Known facts

| item | value | source |
|---|---|---|
| plan | Contabo Cloud VPS 8 (inferred from runner name), 8 shared vCPU, 23 GB | research/17:17,137; skills research/38:7 |
| swap | 0 B (09-27) → 7 GB unused (10-02) | research/11:16; 38:7 |
| disk | unknown | — |
| runtime | rootless podman, cgroup v2, overlay; fuse-overlayfs drift seen on the developer agent; Verifier hides the check (`>/dev/null`) | 38:7; research/11:40; agent-fleet setup-verifier.sh:138 |
| slot cgroup | MemoryMax 12G, swap 2G, no CPU cap | setup-verifier.sh:63,140 |
| other load | old 4-agent fleet + Verifier live; second Gradle daemon during R29 | handoff:73; 38:8-9 |
| Gradle | -Xmx4g, parallel, build cache, configuration cache | gradle.properties:7-11 |
| ITs | maxParallelForks=1, heap 2g, JUnit parallel off | aruvii.integration-test-conventions.gradle.kts:30-36 |
| Testcontainers | Ryuk off, reuse off | agent-fleet machine.env.example:21 |
| Verifier checkout | fresh `clone --shared` per job: configuration cache misses, node_modules empty | fleet-verify:266-289 |
| smoke | 2 workers, retries 1, llm project 1 worker | playwright.smoke.config.ts:40,48,82 |
| compose | memory limits only, no cpus: limit; OLLAMA_NUM_PARALLEL=2 | docker-compose.yml:114,186,290,296 |
| doctor.sh | checks memory, podman timeout, ulimit; not CPU, steal, swap, storage driver, disk | doctor.sh:291-857 |

## Causes

Measured: serial api IT task 18m50 of 21m40 · smoke 24m33 · healthy wait ~6.5 min · 2.7× per-test gap (effect only).
Ruled out for R29: memory (10 GB free, 0 OOM).
Suspected: CPU steal · slower cores · fuse-overlayfs · other tenants (old agents, second Gradle, Ollama) · Ollama with no CPU
limit starving api/DB · no Gradle cache benefit in a fresh clone · slot near its 12G cap · disk I/O.

## Read-only commands for the operator (no sudo; "during" = while a gate job runs)

| # | command | answers |
|---|---|---|
| 1 | `nproc; lscpu \| grep -E 'Model name\|MHz\|Thread\|Hypervisor\|L3'` | CPU model, clock |
| 2 | `vmstat 5 > vmstat.log` (during) | steal (st), iowait (wa), swapping (si/so) |
| 3 | `cat /proc/pressure/{cpu,memory,io}` (before, during, after) | which resource stalls |
| 4 | `cat /sys/fs/cgroup/user.slice/user-$(id -u fleet-verifier-1).slice/{memory.pressure,memory.events,cpu.stat,memory.peak}` | slot memory pressure vs 12G cap |
| 5 | `free -h; swapon --show` | RAM, swap |
| 6 | `df -hT; lsblk -d -o NAME,ROTA,SIZE,MODEL` | filesystem, SSD vs HDD |
| 7 | `dd if=/dev/zero of=$HOME/dd.tmp bs=1M count=1024 oflag=direct; rm $HOME/dd.tmp` | disk throughput |
| 8 | `podman info --format '{{.Store.GraphDriverName}} {{.Store.GraphOptions}} {{.Host.CgroupManager}} {{.Host.Security.Rootless}}'` (as each slot/runner user) | native overlay vs fuse-overlayfs |
| 9 | `findmnt -t fuse.fuse-overlayfs,overlay` | live fuse mounts |
| 10 | `cat /sys/fs/cgroup/user.slice/user-$(id -u).slice/cgroup.controllers` | cpu/memory controllers delegated |
| 11 | `ps -eo user,pid,etime,pcpu,rss,comm --sort=-pcpu \| head -25` (during) | competing processes |
| 12 | `podman stats --no-stream` as the slot user (during smoke) | Ollama vs api CPU |
| 13 | `grep -E 'actionable tasks\|FROM-CACHE' <job log>` | Gradle executed vs cached |
| 14 | `cat /etc/fleet-verify/fleets/*.yaml` | the real gate command |

Commands 2, 3 and 8 in one gate run separate steal vs core speed vs storage driver.
