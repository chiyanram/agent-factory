# Check the runner

## The runner image

Each project's runner runs an image built on this machine, never pulled (#113):

```bash
agent-factory box build <project>
```

It packs this package with `npm pack` and builds the base image with it installed (`images/factory-box`: Ubuntu
24.04, Docker, Node 26, the agent CLIs, `agent-factory`), then, if
`$FACTORY_HOME/projects/<project>/box.Dockerfile` exists, the project's own layer on top of it, and pins the result's
ID in `$FACTORY_HOME/projects/<project>/box.json`. The orchestrator runs exactly that ID. A project Dockerfile must end
on the base:

```dockerfile
ARG BASE
FROM ${BASE}
RUN apt-get update && apt-get install -y --no-install-recommends openjdk-21-jdk-headless
```

Run it again after an upgrade of `agent-factory`, so the runner runs the same version as the host. In a checkout, run
`npm run build` first: a package with no `dist/cli.js` is refused. Both images are tagged by their ID (`factory-box-base:<12 hex>`,
`factory-box-<project>:<12 hex>`), so `docker image prune` keeps them.

After the first build on the VM, prove that no host variable reaches the runner (#181). In a checkout of this package,
as the user that runs the orchestrator, run:

```bash
FACTORY_TEST_BOX_IMAGE="$(jq -r .image "$FACTORY_HOME/projects/<project>/box.json")" npx vitest run test/vm-box-real.test.ts
```

It plants a canary and a `GH_TOKEN` in the host environment, runs `env` on a real runner, and fails if either one, or any
secret-like name the runner was not given, is there. Where there is no image or no Sysbox, it is skipped and says why.

## Check the egress proxy

**Today:** the egress proxy is tested only on a fake docker. Each runner joins its project's `--internal` network,
`factory-int-<project>`, and leaves only through the project's Squid proxy; that it holds on a real Docker host is
proven only by this check (#130). Run it on the VM after the first `box build`, as the user that runs the orchestrator,
with the same settings as a dispatch pass:

```bash
agent-factory egress check <project> --port 22
```

Name with `--port` each port a runner may reach on the host's gateway (setup lists the ports that listen on all
interfaces, #136). It starts the project's proxy as a run does, then a fresh runner on an empty folder, and prints one
line per check, `pass`, `fail` or `skipped`. Exit 0 means none failed. Tick each one on #130 with the output:

- [ ] a host off the allowlist (`example.com`) is refused: the proxy answers 403;
- [ ] a model call reaches `api.anthropic.com` through the proxy (any HTTP answer from it), and the same host on
  port 80 is refused; `--model-host` names another model API;
- [ ] a direct connection that skips the proxy (`1.1.1.1:443`) fails;
- [ ] an outside name does not resolve in the runner, so DNS is no way out either;
- [ ] on the host's gateway, every open port is one you named; close any other port, or bind it to `127.0.0.1`;
- [ ] the inner Docker pulls `hello-world`, as Testcontainers does; the list needs `.docker.io` and
  `production.cloudflare.docker.com`, and `--pull` names the image your ITs use;
- [ ] a real model call, by the first implementer run on the VM, goes through: the check reaches the host, not the model;
- [ ] the open question: does the work build need a private-registry token? Run the work project's build in the
  runner; if a registry answers 401, record it on #130.

On the work laptop there is no Squid proxy: the srt runner keeps its own, and `egress check` says so; run the srt
check below instead.

## Check the srt runner

**Today:** the srt runner is tested only on a fake `srt` (`test/srt-box.test.ts`); that its policy holds on a real
laptop is proven only by this check (#114). Run it on the work laptop after installing the pinned `srt`, in a checkout
of this package, as the user that runs the orchestrator:

```bash
echo canary > ~/.ssh/canary
FACTORY_TEST_SRT=1 npx vitest run test/srt-box-real.test.ts
rm ~/.ssh/canary
```

It starts a fresh srt runner on an empty clone, with `api.anthropic.com` as the only allowed host, runs one command per
check, and fails on the first that gets through. Where `srt` is missing or another version, it is skipped and says why.
Tick each one on #114 with the output:

- [ ] reading `~/.ssh/canary` inside `srt` fails;
- [ ] a file in `~/Documents` is unreadable: the whole home is hidden;
- [ ] `claude --version` and `node` still run inside `srt` when they are installed under your home;
- [ ] a toolchain program under a detected manager (mise, SDKMAN!, asdf or nvm on `PATH`) runs inside `srt`, and a write
  to its folder fails;
- [ ] a direct connection that skips the proxy (`curl --noproxy '*' https://1.1.1.1`) fails;
- [ ] a host off the allowlist (`https://example.com`) is refused by srt's proxy;
- [ ] a call to `https://api.anthropic.com` goes through (any HTTP answer); at work, through `FACTORY_UPSTREAM_PROXY`
  and the company CA;
- [ ] a write in the clone works, and a write elsewhere in your home fails;
- [ ] `node -e "require('fs').mkdtempSync(require('os').tmpdir()+'/x')"` works inside `srt` (the run's own temp
  folder), and a write to `/tmp` directly fails;
- [ ] the factory home's files and your `gh`, `glab`, `.netrc` and `.git-credentials` logins cannot be read;
- [ ] no Docker socket answers (Docker Desktop, Rancher Desktop);
- [ ] by hand: one implementer run with `claude` finishes inside `srt` (`FACTORY_BOX=srt agent-factory dispatch
  <project>`); a run with Copilot comes with #162.

The policy hides your whole home ([review 6](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6682837531);
the operator's choice A on #114). It allows back only the run's clone and private home, and, read-only, the install
folders of `claude` and its Node, the detected toolchain managers' install folders, and the `srt.readOnly` folders.
A run writes only in its clone, its private home and its own temp folder: a fresh folder with a short path,
`/tmp/af-<6 characters>` (mode 0700), made before the run and removed after it. The run's `TMPDIR` names it; srt sets
that from `CLAUDE_CODE_TMPDIR`, and srt makes its own control sockets there too, so the path must stay short: macOS caps
a socket path at 104 bytes, and a temp folder inside the private home failed every command with `listen EINVAL`. The
policy never allows `/tmp` itself (srt keeps only its own `/tmp/claude` writable); a run with no temp folder of its own
fails every Bash call with `EPERM` (#62).
A program kept elsewhere under your home cannot be read inside `srt`: put its manager's real install folder on `PATH`,
or add its folder to `srt.readOnly`.
