// vm-plan — the pure half of the vm box (#113): the checks on a spec and on the host owner, the docker arguments for
// each step, and how each docker answer reads. vm.ts runs them. Nothing here calls docker.
//
//   docker run --runtime sysbox-runc   the box's own Docker engine, with no --privileged
//   --network factory-int-<project>    its project's egress proxy is its only way out
//   /work                              the run's clone, the only folder mounted; the agent's settings read-only
//   user box, the host owner's uid     every command runs as box, never as root; files keep their owner on both sides
//   docker exec --env NAME             a value goes in through the docker CLI's environment, never its argv, so a token
//                                      never shows in a process list
//
// A `timeout` exit counts as a timeout only when the time really ran out, so a command that exits 124 on its own is
// still read as its exit.

import { join } from "node:path";
import type { Exit } from "../forge/api.js";
import type { BoxSpec, Command, PinnedImage, Probe, Ran } from "./types.js";

export const RUNTIME = "sysbox-runc";
export const WORKDIR = "/work";
export const USER = "box";
export const HOME = "/home/box";
const ENGINE_WAIT_SECONDS = 60;
const KILL_AFTER_SECONDS = 10;
// `timeout` exits 124 when the time ran out, and 137 when the command had to be killed after it
// https://www.gnu.org/software/coreutils/manual/html_node/timeout-invocation.html
const TIMEOUT_CODES: ReadonlySet<number> = new Set([124, 137]);
const LOCAL = "localhost,127.0.0.1,::1";

export type Owner = { readonly uid: number; readonly gid: number };
export type Check = { readonly kind: "ok" } | { readonly kind: "refused"; readonly reason: string };

const OK: Check = { kind: "ok" };
const refuse = (reason: string): Check => ({ kind: "refused", reason });
const firstRefusal = (checks: readonly Check[]): Check => checks.find((c) => c.kind === "refused") ?? OK;

// a comma splits the fields of docker's --mount
// https://docs.docker.com/engine/storage/bind-mounts/
const mountable = (path: string): boolean => !path.includes(",");

export function insideWorktree(path: string): boolean {
  const parts = path.split("/");
  return path !== "" && !path.startsWith("/") && !parts.includes("..") && mountable(path);
}

// the docker CLI reads DOCKER_* variables itself: passing one would change docker, not the run
// https://docs.docker.com/reference/cli/docker/#environment-variables
const RESERVED = /^(DOCKER_|HOME$)/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const NETWORK = /^factory-int-[A-Za-z0-9][A-Za-z0-9._-]*$/;

export type PinnedSpec = BoxSpec & { readonly image: PinnedImage };

export type CheckedSpec =
  | { readonly kind: "ok"; readonly spec: PinnedSpec }
  | { readonly kind: "refused"; readonly reason: string };

function isPinned(spec: BoxSpec): spec is PinnedSpec {
  return spec.image.kind === "pinned";
}

const SPEC_RULES: readonly ((spec: BoxSpec) => Check)[] = [
  (s) =>
    s.worktree.startsWith("/") && mountable(s.worktree)
      ? OK
      : refuse(`worktree ${JSON.stringify(s.worktree)} must be an absolute path with no comma`),
  (s) =>
    firstRefusal(
      s.readOnly.map((p) =>
        insideWorktree(p) ? OK : refuse(`read-only path ${JSON.stringify(p)} is not inside the worktree`),
      ),
    ),
  (s) =>
    firstRefusal(
      Object.keys(s.env).map((n) =>
        ENV_NAME.test(n) && !RESERVED.test(n) ? OK : refuse(`env name ${JSON.stringify(n)} is not allowed in the box`),
      ),
    ),
  (s) => (/^http:\/\/[^\s,]+$/.test(s.proxy) ? OK : refuse(`proxy ${JSON.stringify(s.proxy)} is not an http:// URL`)),
  (s) => (NETWORK.test(s.network) ? OK : refuse(`network ${JSON.stringify(s.network)} is not a docker network name`)),
];

export function checkSpec(spec: BoxSpec): CheckedSpec {
  if (!isPinned(spec)) {
    return { kind: "refused", reason: "the vm runner runs only a pinned image; this spec names none" };
  }
  const check = firstRefusal(SPEC_RULES.map((rule) => rule(spec)));
  return check.kind === "ok" ? { kind: "ok", spec } : check;
}

export function checkOwner(owner: Owner): Check {
  return Number.isInteger(owner.uid) && Number.isInteger(owner.gid) && owner.uid > 0 && owner.gid >= 0
    ? OK
    : refuse(`the host owner uid ${owner.uid} gid ${owner.gid} is root or unknown; run the factory as a normal user`);
}

export const RUNTIMES_ARGS: readonly string[] = [
  "info",
  "--format",
  "{{range $name, $_ := .Runtimes}}{{$name}}\n{{end}}",
];
export const imageArgs = (ref: string): readonly string[] => ["image", "inspect", "--format", "{{.Id}}", ref];

const PROBE_RULES: readonly ((input: {
  readonly runtimes: Exit;
  readonly image: Exit;
  readonly ref: string;
}) => Check)[] = [
  (i) => (i.runtimes.code === 0 ? OK : refuse(`docker does not answer: ${i.runtimes.stderr.trim()}`)),
  (i) =>
    i.runtimes.stdout.split("\n").includes(RUNTIME)
      ? OK
      : refuse(`docker has no ${RUNTIME} runtime; install Sysbox on this host (#158). The box never runs --privileged`),
  (i) => (i.image.code === 0 ? OK : refuse(`image ${i.ref} is not on this host: ${i.image.stderr.trim()}`)),
];

export function readProbe(input: {
  readonly owner: Owner;
  readonly runtimes: Exit;
  readonly image: Exit;
  readonly ref: string;
}): Probe {
  const check = firstRefusal([checkOwner(input.owner), ...PROBE_RULES.map((rule) => rule(input))]);
  return check.kind === "ok" ? { kind: "ready" } : { kind: "missing", reason: check.reason };
}

export function runArgs(input: { readonly name: string; readonly spec: PinnedSpec }): readonly string[] {
  const { name, spec } = input;
  const mounts = [
    `type=bind,src=${spec.worktree},dst=${WORKDIR}`,
    ...spec.readOnly.map((p) => `type=bind,src=${join(spec.worktree, p)},dst=${WORKDIR}/${p},readonly`),
  ];
  return [
    "run",
    "--detach",
    "--name",
    name,
    "--runtime",
    RUNTIME,
    "--init",
    "--network",
    spec.network,
    ...mounts.flatMap((m) => ["--mount", m]),
    "--mount",
    "type=volume,dst=/var/lib/docker",
    "--tmpfs",
    `${HOME}:rw,nosuid,nodev,mode=0700`,
    ...[`HTTP_PROXY=${spec.proxy}`, `HTTPS_PROXY=${spec.proxy}`, `NO_PROXY=${LOCAL}`].flatMap((e) => ["--env", e]),
    spec.image.ref,
  ];
}

export function setupArgs(name: string, owner: Owner): readonly (readonly string[])[] {
  const asRoot = (...argv: string[]): readonly string[] => ["exec", "--user", "0", name, ...argv];
  return [
    asRoot("groupmod", "--non-unique", "--gid", String(owner.gid), USER),
    asRoot("usermod", "--non-unique", "--uid", String(owner.uid), "--gid", String(owner.gid), USER),
    asRoot("chown", `${USER}:${USER}`, HOME),
    asRoot("timeout", String(ENGINE_WAIT_SECONDS), "sh", "-c", "until docker info >/dev/null 2>&1; do sleep 1; done"),
  ];
}

export function execArgs(input: {
  readonly name: string;
  readonly command: Command;
  readonly envNames: readonly string[];
}): readonly string[] {
  const { name, command, envNames } = input;
  return [
    "exec",
    ...(command.stdin.kind === "text" ? ["--interactive"] : []),
    "--user",
    USER,
    "--workdir",
    WORKDIR,
    "--env",
    `HOME=${HOME}`,
    ...envNames.flatMap((n) => ["--env", n]),
    name,
    "timeout",
    `--kill-after=${KILL_AFTER_SECONDS}`,
    String(command.timeoutSeconds),
    ...command.argv,
  ];
}

const DAEMON_ERROR = /^Error( response from daemon)?:.*(no such container|is not running)/im;

export function readRan(input: {
  readonly exit: Exit;
  readonly timeoutSeconds: number;
  readonly elapsedSeconds: number;
}): Ran {
  const { exit, timeoutSeconds, elapsedSeconds } = input;
  if (exit.code !== 0 && DAEMON_ERROR.test(exit.stderr)) {
    return { kind: "failed", reason: `docker exec: ${exit.stderr.trim()}` };
  }
  return TIMEOUT_CODES.has(exit.code) && elapsedSeconds >= timeoutSeconds
    ? { kind: "timedOut", seconds: timeoutSeconds }
    : { kind: "exited", code: exit.code, stdout: exit.stdout, stderr: exit.stderr };
}

export function readRemoved(exit: Exit): Check {
  return exit.code === 0 || /no such container/i.test(exit.stderr) ? OK : refuse(`docker rm: ${exit.stderr.trim()}`);
}
