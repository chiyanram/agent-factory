// srt-plan — the pure half of the srt runner (#114): Anthropic's sandbox runtime (`srt`, @anthropic-ai/sandbox-runtime)
// around the whole agent process on a work laptop, with no Docker. srt.ts runs it. Nothing here touches a file or a
// process.
//
//   srt --settings <policy> -- <argv>   one generated policy per run, a file outside the clone; srt refuses a
//                                       --settings file that is missing or invalid, never falls back to its defaults;
//                                       the command comes after `--`, so srt reads none of its flags
//   sandbox-exec (macOS), bubblewrap    srt's own OS sandbox; on Linux it also needs socat and ripgrep (its README)
//   (Linux)
//
// The policy (srt's README, at the pinned version):
//   writes      only the run's clone and the run's private HOME (ADR-0012 S15); the clone's read-only paths stay
//               read-only; srt adds its own mandatory denies (.git/hooks, .git/config, shell rc files); and the run's
//               own temp folder, a fresh 0700 folder with a short path such as /private/tmp/af-Xy12Ab, never /tmp
//               itself: a Claude Code with no writable temp folder fails every Bash call with EPERM, and srt puts
//               its own control sockets in that folder, whose paths macOS caps at 104 bytes
//   reads       the person's whole home is hidden. srt's allowRead wins over its denyRead, so the clone, the private
//               HOME and the agent's programs (the CLI's install and its Node, srt-programs.ts) and the toolchains (a
//               detected toolchain manager's install folder, and srt.readOnly: srt-toolchains.ts) are allowed back
//               read-only. A denyRead more specific than an allowed folder still holds, so the credential paths, the
//               factory home (its secrets and every other run) and the Docker sockets are denied by name as well, in
//               case a program folder holds one
//   network     only through srt's own proxy, which allows the project's checked egress allowlist on port 443 alone
//               (the same rule as the vm runner's Squid proxy, egress/squid.ts) and chains to the company proxy at work
//   sockets     no local binding, no Unix socket: no Docker socket (on Linux srt blocks them with seccomp)
//   env         the host's PATH and locale, the private HOME, the temp folder and the spec's own variables; no other
//               host variable
//
// S7: the version is pinned. A new pin is a PR that reviews srt's release and passes the laptop check (docs/how-to/check-the-runner.md "Check
// the srt runner"). The probe refuses a missing srt, another version, and a platform srt does not sandbox.

import { join } from "node:path";
import type { Exit, Result } from "../forge/api.js";
import type { Upstream } from "../egress/squid.js";
import type { Toolchains } from "./srt-toolchains.js";
import type { Command, Probe } from "./types.js";

export const SRT_VERSION = "0.0.82";
export const SRT_PACKAGE = "@anthropic-ai/sandbox-runtime";
// --omit=optional: srt's only optional dependency is the Windows MXC SDK, which a macOS or Linux laptop never needs
// https://github.com/anthropic-experimental/sandbox-runtime/blob/v0.0.82/package.json#L37
export const SRT_INSTALL = `npm install --global --omit=optional ${SRT_PACKAGE}@${SRT_VERSION}`;

// srt's Windows backend is alpha, so only macOS and Linux are accepted
// https://github.com/anthropic-experimental/sandbox-runtime/blob/v0.0.82/README.md?plain=1#L742
const PLATFORMS: ReadonlySet<NodeJS.Platform> = new Set(["darwin", "linux"]);

export const CREDENTIAL_PATHS: readonly string[] = [
  ".ssh",
  ".gnupg",
  ".config/gh",
  ".config/glab-cli",
  "Library/Application Support/glab-cli",
  ".git-credentials",
  ".config/git/credentials",
  ".netrc",
  ".aws",
  ".config/gcloud",
  ".azure",
  ".kube",
  ".oci",
  ".docker",
  ".npmrc",
  ".pypirc",
  ".m2/settings.xml",
  ".gradle/gradle.properties",
  "Library/Keychains",
  "Library/Application Support/Google/Chrome",
  "Library/Application Support/Firefox",
  "Library/Safari",
  ".config/google-chrome",
  ".config/chromium",
  ".mozilla",
  ".claude",
  ".claude.json",
  ".copilot",
];

const DOCKER_SOCKETS: readonly string[] = ["/var/run/docker.sock", "/run/docker.sock"];
const HOME_SOCKETS: readonly string[] = [".rd/docker.sock", ".colima/default/docker.sock", ".colima/docker.sock"];

export function secretPaths(home: string, factoryHome: string): readonly string[] {
  return [...[...CREDENTIAL_PATHS, ...HOME_SOCKETS].map((p) => join(home, p)), factoryHome];
}

export type SrtHost = {
  readonly platform: NodeJS.Platform;
  readonly home: string;
  readonly factoryHome: string;
  readonly programs: Result<readonly string[]>;
  readonly toolchains: Toolchains;
};

export type SrtEgress = {
  readonly hosts: readonly string[];
  readonly upstream: Upstream;
  readonly caCerts: string;
};

export type SrtRun = {
  readonly worktree: string;
  readonly readOnly: readonly string[];
  readonly home: string;
  readonly tmp: string;
};

export type SrtPolicy = {
  readonly network: {
    readonly allowedDomains: readonly string[];
    readonly deniedDomains: readonly string[];
    readonly allowLocalBinding: false;
    readonly allowAllUnixSockets: false;
    readonly parentProxy?: { readonly http: string; readonly https: string };
  };
  readonly filesystem: {
    readonly denyRead: readonly string[];
    readonly allowRead: readonly string[];
    readonly allowWrite: readonly string[];
    readonly denyWrite: readonly string[];
  };
  readonly enableWeakerNestedSandbox: false;
  readonly enableWeakerNetworkIsolation: false;
  readonly allowNestedUserNamespaces: false;
  readonly allowAppleEvents: false;
};

// srt's *.x.com matches only the strict subdomains of x.com, so a dotted entry .x.com becomes x.com and *.x.com
// https://github.com/anthropic-experimental/sandbox-runtime/blob/v0.0.82/src/sandbox/domain-pattern.ts#L181
export function srtDomains(hosts: readonly string[]): readonly string[] {
  return hosts.flatMap((h) => (h.startsWith(".") ? [`${h.slice(1)}:443`, `*${h}:443`] : [`${h}:443`]));
}

function parentOf(upstream: Upstream): Pick<SrtPolicy["network"], "parentProxy"> {
  if (upstream.kind === "none") {
    return {};
  }
  const url = `http://${upstream.host}:${upstream.port}`;
  return { parentProxy: { http: url, https: url } };
}

export function srtPolicy(input: {
  readonly host: SrtHost;
  readonly egress: SrtEgress;
  readonly run: SrtRun;
}): SrtPolicy {
  const { host, egress, run } = input;
  return {
    network: {
      allowedDomains: srtDomains(egress.hosts),
      deniedDomains: [],
      allowLocalBinding: false,
      allowAllUnixSockets: false,
      ...parentOf(egress.upstream),
    },
    filesystem: {
      denyRead: [host.home, ...secretPaths(host.home, host.factoryHome), ...DOCKER_SOCKETS],
      allowRead: [
        run.worktree,
        run.home,
        run.tmp,
        ...(host.programs.kind === "ok" ? host.programs.value : []),
        ...host.toolchains.allowed.map((t) => t.dir),
        ...(egress.caCerts === "" ? [] : [egress.caCerts]),
      ],
      allowWrite: [run.worktree, run.home, run.tmp],
      denyWrite: run.readOnly.map((p) => join(run.worktree, p)),
    },
    enableWeakerNestedSandbox: false,
    enableWeakerNetworkIsolation: false,
    allowNestedUserNamespaces: false,
    allowAppleEvents: false,
  };
}

export function srtArgs(policyFile: string, command: Command): readonly string[] {
  return ["--settings", policyFile, "--", ...command.argv];
}

export const VERSION_ARGS: readonly string[] = ["--version"];

export function readSrtProbe(input: {
  readonly platform: NodeJS.Platform;
  readonly programs: Result<readonly string[]>;
  readonly refused: readonly string[];
  readonly version: Exit;
}): Probe {
  const { platform, programs, refused } = input;
  if (!PLATFORMS.has(platform)) {
    return { kind: "missing", reason: `srt does not sandbox ${platform} here; the srt runner runs on macOS or Linux` };
  }
  if (programs.kind === "failed") {
    return { kind: "missing", reason: programs.reason };
  }
  return refused.length > 0 ? { kind: "missing", reason: refused.join("; ") } : readVersion(input.version);
}

function readVersion(version: Exit): Probe {
  if (version.code !== 0) {
    const said = version.stderr.trim().split("\n").at(-1) ?? "";
    return { kind: "missing", reason: `srt does not answer (${said}); install it: ${SRT_INSTALL}` };
  }
  const got = version.stdout.trim();
  return got === SRT_VERSION
    ? { kind: "ready" }
    : {
        kind: "missing",
        reason: `srt is ${JSON.stringify(got)}, not the pinned ${SRT_VERSION}; install it: ${SRT_INSTALL}`,
      };
}

const PASSED = ["PATH", "LANG", "LC_ALL", "TERM"] as const;
const RESERVED =
  /^(HOME|TMPDIR|TMP|TEMP|CLAUDE_CODE_TMPDIR|CLAUDE_TMPDIR|SRT_.*|HTTPS?_PROXY|https?_proxy|NO_PROXY|no_proxy|ALL_PROXY|all_proxy)$/;

export const RUN_TMP_ROOT = "/tmp";
export const RUN_TMP_PREFIX = "af-";
// macOS caps a Unix socket's path at 104 bytes (sun_path)
// https://github.com/apple-oss-distributions/xnu/blob/xnu-12377.121.6/bsd/sys/un.h#L79
const SOCKET_MAX = 104;
const SOCKET_NAME = "/srt-mux-4194304-99.sock";

export function tmpTooLong(tmp: string): string {
  const longest = Buffer.byteLength(`${tmp}${SOCKET_NAME}`);
  return longest <= SOCKET_MAX
    ? ""
    : `the run's temp folder ${tmp} is too long for srt's sockets (${longest} of ${SOCKET_MAX} bytes)`;
}

// srt sets the run's TMPDIR to CLAUDE_CODE_TMPDIR, else /tmp/claude, and Claude Code keeps its own temp files under
// CLAUDE_CODE_TMPDIR
// https://github.com/anthropic-experimental/sandbox-runtime/blob/v0.0.82/src/sandbox/sandbox-utils.ts#L798-L805
// https://code.claude.com/docs/en/env-vars
export function tmpEnv(tmp: string): Readonly<Record<string, string>> {
  return { CLAUDE_CODE_TMPDIR: tmp, TMP: tmp, TEMP: tmp };
}

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function checkEnv(env: Readonly<Record<string, string>>): string {
  const bad = Object.keys(env).find((n) => !ENV_NAME.test(n) || RESERVED.test(n));
  return bad === undefined ? "" : `env name ${JSON.stringify(bad)} is not allowed in the srt runner`;
}

// with no parentProxy in its policy, srt chains to the HTTP(S)_PROXY it was started with, so none is passed
// https://github.com/anthropic-experimental/sandbox-runtime/blob/v0.0.82/src/sandbox/parent-proxy.ts#L75-L84
export function srtEnv(input: {
  readonly host: NodeJS.ProcessEnv;
  readonly home: string;
  readonly tmp: string;
  readonly ca: { readonly name: string; readonly file: string };
  readonly spec: Readonly<Record<string, string>>;
}): Readonly<Record<string, string>> {
  const passed = PASSED.flatMap((n) => {
    const value = input.host[n];
    return value === undefined ? [] : [[n, value] as const];
  });
  return {
    ...Object.fromEntries(passed),
    HOME: input.home,
    ...tmpEnv(input.tmp),
    ...(input.ca.file === "" ? {} : { [input.ca.name]: input.ca.file }),
    ...input.spec,
  };
}

export function insideClone(path: string): boolean {
  return path !== "" && !path.startsWith("/") && !path.split("/").includes("..");
}
