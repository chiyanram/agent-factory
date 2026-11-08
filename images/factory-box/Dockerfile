# factory-box: the base image of every vm box (#113; decided on #30, 2026-11-07).
#
# It holds what every project needs: git, its own Docker engine (for Testcontainers), Node and the runner CLIs, each at
# a pinned version. A project's toolchain (a JDK, Gradle, ...) goes in that project's own box.Dockerfile, built FROM
# this image and kept outside the repo, under ~/.factory/projects/<project>/ (Q2). The box runs under Sysbox
# (--runtime=sysbox-runc), so its root is an unprivileged user on the VM and the engine needs no --privileged.
#
# The container's main process is dockerd. The runner never runs as root: the vm Box gives the `box` user the host
# owner's uid at start and runs every command as `box` (Q3).
#
# Base images are pinned by digest (ADR-0012 S7). apt packages follow the Ubuntu 24.04 archive at build time.
#
# `agent-factory box build` puts this package in the build context as agent-factory.tgz (npm pack of the host's own
# copy, #171), so the writer's lint hook runs the same agent-factory as the host. Build it through box build only.

FROM node:22-bookworm-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d AS node

FROM ubuntu:24.04@sha256:fe81560990fae86dc4743202b2cb4d3df98d0bcf949173cecef15ce1127ef852

ARG CLAUDE_CODE_VERSION=2.1.319
ARG COPILOT_VERSION=1.0.107
ARG OPENCODE_VERSION=1.19.5

RUN apt-get update \
 && apt-get install --yes --no-install-recommends ca-certificates git docker.io \
 && rm -rf /var/lib/apt/lists/*

COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
 && npm install --global --no-fund --no-audit \
      "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
      "@github/copilot@${COPILOT_VERSION}" \
      "opencode-ai@${OPENCODE_VERSION}" \
 && npm cache clean --force

COPY agent-factory.tgz /tmp/agent-factory.tgz
RUN npm install --global --no-fund --no-audit /tmp/agent-factory.tgz \
 && rm /tmp/agent-factory.tgz \
 && npm cache clean --force

# Ubuntu's image has a user `ubuntu` at uid 1000; the box user takes its place, and joins the engine's group.
RUN userdel --remove ubuntu \
 && useradd --create-home --uid 1000 --shell /bin/bash box \
 && usermod --append --groups docker box

WORKDIR /work
CMD ["dockerd"]
