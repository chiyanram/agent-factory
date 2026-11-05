# Brief: find out why the gate is slow on this VM (read-only)

You are an agent on the VM. Your job is to **measure**, not to fix. The operator gave you this brief.

## Why

A full gate (`make verify-full` in the Verifier) takes 1h00–1h10 here. The same tests run about 2.7 times faster on the
operator's laptop. Nobody knows why. There are five suspects:

1. CPU steal: the 8 vCPUs are shared with other customers.
2. Slow cores: each core is slower than the laptop's.
3. Storage driver: rootless podman may use fuse-overlayfs, which is slow.
4. Other load: the old agents, a second Gradle daemon or Ollama compete for CPU.
5. No Gradle cache: the Verifier clones fresh for each job.

Your output decides which suspects are real.

## Rules

- Read only. Do not change any file, setting, service, container or user.
- Do not use `sudo`.
- Do not stop, restart or cancel any job, container or agent.
- Do not start a gate job yourself. If none is running, stop at step 3 and ask the operator to start one.
- Write every output into one folder: `~/gate-diagnose-<date>/`.
- If a command is not installed or is refused, write "not available" and continue.

## Steps

### 1. Prepare

```bash
D=~/gate-diagnose-$(date +%Y%m%d-%H%M); mkdir -p $D; cd $D
```

### 2. Before the job (static facts)

```bash
{ nproc; lscpu | grep -E 'Model name|MHz|Thread|Hypervisor|L3'; } > cpu.txt
{ free -h; swapon --show; } > memory.txt
{ df -hT; lsblk -d -o NAME,ROTA,SIZE,MODEL; } > disk.txt
cat /proc/pressure/cpu /proc/pressure/memory /proc/pressure/io > pressure-before.txt
dd if=/dev/zero of=$D/dd.tmp bs=1M count=1024 oflag=direct 2> disk-speed.txt; rm -f $D/dd.tmp
```

For each user that runs containers for the gate (`fleet-verifier-1`, the gitlab-runner user if it exists, and yourself),
record the storage driver. Run as that user only if you already can without sudo; otherwise write "no access":

```bash
podman info --format '{{.Store.GraphDriverName}} {{.Store.GraphOptions}} {{.Host.CgroupManager}} {{.Host.Security.Rootless}}' >> storage.txt
findmnt -t fuse.fuse-overlayfs,overlay >> storage.txt
cat /sys/fs/cgroup/user.slice/user-$(id -u).slice/cgroup.controllers >> storage.txt
```

### 3. Wait for a gate job

Check whether a Verifier job is running (`fleet-verify status`, or `ps -eo pid,etime,command | grep -E '[g]radle|[p]laywright'`).
If none is running, stop here and tell the operator: "Ready. Start one gate job and tell me."

### 4. During the job

Start these when the job starts:

```bash
vmstat 5 > vmstat.log &
VMSTAT=$!
```

Every 5 minutes until the job ends, append the following lines:

```bash
date >> during.txt
cat /proc/pressure/cpu /proc/pressure/memory /proc/pressure/io >> during.txt
ps -eo user,pid,etime,pcpu,rss,comm --sort=-pcpu | head -15 >> during.txt
```

Once, while smoke tests are running, as the slot user if you can:

```bash
podman stats --no-stream > containers-during-smoke.txt
```

When the job ends, run:

```bash
kill $VMSTAT
cat /proc/pressure/cpu /proc/pressure/memory /proc/pressure/io > pressure-after.txt
```

### 5. From the finished job

From the job's log, record its phase times and how many Gradle tasks came from the cache:

```bash
grep -E 'actionable tasks|FROM-CACHE|BUILD (SUCCESSFUL|FAILED)' <job log> > gradle-cache.txt
cat /etc/fleet-verify/fleets/*.yaml > gate-command.txt
```

## Report back

Reply to the operator with this table, one row per suspect. Attach the folder path.

| suspect | what you saw | real? |
|---|---|---|
| CPU steal | average and max `st` column from vmstat.log | real if the average is above 5 % |
| slow cores | CPU model and MHz | (the operator compares it with the laptop) |
| storage driver | driver per user from storage.txt | real if `fuse-overlayfs` appears |
| other load | top processes in during.txt that are not part of the job | real if other users take more than 1 CPU |
| no Gradle cache | executed vs FROM-CACHE counts | real if nearly everything executed |
| also | `wa` (iowait) average, `si/so` (swapping), PSI "some avg60" peaks | — |

Report only what you measured. Write "not measured" where a step failed. Do not guess a cause.
