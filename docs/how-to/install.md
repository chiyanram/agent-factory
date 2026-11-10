# Install a pinned version

Install the packed package from the release. Set `V` to the version you want:

```bash
V=0.30.0
npm i -g https://github.com/chiyanram/agent-factory/releases/download/v$V/chiyanram-agent-factory-$V.tgz && agent-factory --version
```

The last command prints the version. Pick the version from the
[releases](https://github.com/chiyanram/agent-factory/releases); `CHANGELOG.md` says what each one changed. Never
install from `main`: it changes under you (#153).

Releases v0.29.0 and older have no packed package attached. For those, build the tag, pack it and install the packed
file:

```bash
V=0.29.0
cd /tmp && rm -rf af-$V && git clone -q --depth 1 --branch v$V https://github.com/chiyanram/agent-factory af-$V
cd af-$V && npm ci && npm pack && npm i -g ./chiyanram-agent-factory-$V.tgz && agent-factory --version
```

We do not use `npm i -g github:chiyanram/agent-factory#v<version>`, because npm does not give that build its
devDependencies, so the build fails.
