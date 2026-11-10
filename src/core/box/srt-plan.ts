// srt-plan — the pure half of the srt runner (#114; decided on #30, 2026-11-08 and 2026-11-10): Anthropic's sandbox
// runtime (`srt`, @anthropic-ai/sandbox-runtime) around the whole agent process on a work laptop, with no Docker.
// srt.ts runs it. Nothing here touches a file or a process.
//
//   srt --settings <policy> -- <argv>   one generated policy per run, a file outside the clone; srt refuses a
//                                       --settings file that is missing or invalid, never falls back to its defaults
//   sandbox-exec (macOS), bubblewrap    srt's own OS sandbox; on Linux it also needs socat and ripgrep (its README)
//   (Linux)
//
// The policy (srt's README, at the pinned version):
//   writes      only the run's clone and the run's private HOME (ADR-0012 S15); the clone's read-only paths stay
//               read-only; srt adds its own mandatory denies (.git/hooks, .git/config, shell rc files)
//   reads       open, but for the credential paths under the person's home (review issue 6 on #30), the factory home
//               (its secrets and every other run), and the Docker sockets; the clone and the private HOME are allowed
//               back inside the factory home
//   network     only through srt's own proxy, which allows the project's checked egress allowlist on port 443 alone
//               (the same rule as the vm runner's Squid proxy, egress/squid.ts) and chains to the company proxy at work
//   sockets     no local binding, no Unix socket: no Docker socket (on Linux srt blocks them with seccomp)
//
// S7: the version is pinned. The probe refuses a missing srt, another version, and a platform srt does not sandbox.

import { join } from "node:path";
import type { Exit } from "../forge/api.js";
import type { Upstream } from "../egress/squid.js";
import type { Command, Probe } from "./types.js";

// the pinned srt (S7): a release at least two weeks old when it was pinned (0.0.81, 2026-10-20). A new pin is a PR
// that changes this line and passes the laptop check (GUIDE.md "Check the srt runner").
export const SRT_VERSION = "0.0.81";
export const SRT_PACKAGE = "@anthropic-ai/sandbox-runtime";
export const SRT_INSTALL = `npm install --global ${SRT_PACKAGE}@${SRT_VERSION}`;

// the platforms srt sandboxes with a stable backend; Windows is alpha in srt and is refused
const PLATFORMS: ReadonlySet<NodeJS.Platform> = new Set(["darwin", "linux"]);

// the credential paths under the person's home that no run may read (review issue 6 on #30; #114): the coordinator's
// SECRET_HOME (coordinator.ts) as folders and files, plus the git host CLIs' and the agent CLIs' own logins
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

// the Docker engines' sockets outside the home: the runner reaches none (#114 "no Docker socket")
const DOCKER_SOCKETS: readonly string[] = ["/var/run/docker.sock", "/run/docker.sock"];
// the Docker sockets under the home: Docker Desktop, Rancher Desktop, Colima
const HOME_SOCKETS: readonly string[] = [".rd/docker.sock", ".colima/default/docker.sock", ".colima/docker.sock"];

// the host the srt runner runs on
export type SrtHost = {
  readonly platform: NodeJS.Platform;
  // the person's real home: the credential paths are under it
  readonly home: string;
  // the factory home: its secrets, its records and every other run's folders
  readonly factoryHome: string;
};

// the project's egress, as the srt runner keeps it: the allowlist parseAllowlist checked, the company proxy, and the
// company CA's PEM file ("" for none)
export type SrtEgress = {
  readonly hosts: readonly string[];
  readonly upstream: Upstream;
  readonly caCerts: string;
};

// one run's folders: the clone, the paths in it the run may read but not change, and its private HOME
export type SrtRun = {
  readonly worktree: string;
  readonly readOnly: readonly string[];
  readonly home: string;
};

// the settings file srt reads, as far as the factory writes it (srt's SandboxRuntimeConfig)
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

// srtDomains : one allowlist entry as srt's allowedDomains: on port 443 only, as the Squid proxy allows; a dotted entry
// ".x.com" allows x.com and every subdomain, which srt writes as two entries. Pure.
export function srtDomains(hosts: readonly string[]): readonly string[] {
  return hosts.flatMap((h) => (h.startsWith(".") ? [`${h.slice(1)}:443`, `*${h}:443`] : [`${h}:443`]));
}

// parentOf : the company proxy srt's own proxy chains to; none sends it out direct. Pure.
function parentOf(upstream: Upstream): Pick<SrtPolicy["network"], "parentProxy"> {
  if (upstream.kind === "none") {
    return {};
  }
  const url = `http://${upstream.host}:${upstream.port}`;
  return { parentProxy: { http: url, https: url } };
}

// srtPolicy : the one policy of one run. Pure.
export function srtPolicy(input: {
  readonly host: SrtHost;
  readonly egress: SrtEgress;
  readonly run: SrtRun;
}): SrtPolicy {
  const { host, egress, run } = input;
  const underHome = (p: string): string => join(host.home, p);
  return {
    network: {
      allowedDomains: srtDomains(egress.hosts),
      deniedDomains: [],
      allowLocalBinding: false,
      allowAllUnixSockets: false,
      ...parentOf(egress.upstream),
    },
    filesystem: {
      denyRead: [
        ...CREDENTIAL_PATHS.map(underHome),
        ...HOME_SOCKETS.map(underHome),
        ...DOCKER_SOCKETS,
        host.factoryHome,
      ],
      // the run's own folders are inside the factory home; the company CA may be too
      allowRead: [run.worktree, run.home, ...(egress.caCerts === "" ? [] : [egress.caCerts])],
      allowWrite: [run.worktree, run.home],
      denyWrite: run.readOnly.map((p) => join(run.worktree, p)),
    },
    enableWeakerNestedSandbox: false,
    enableWeakerNetworkIsolation: false,
    allowNestedUserNamespaces: false,
    allowAppleEvents: false,
  };
}

// srtArgs : srt with the run's policy, then the command, after `--` so srt reads none of the command's flags. Pure.
export function srtArgs(policyFile: string, command: Command): readonly string[] {
  return ["--settings", policyFile, "--", ...command.argv];
}

export const VERSION_ARGS: readonly string[] = ["--version"];

// readSrtProbe : the runner can start when the platform is one srt sandboxes and `srt --version` prints the pinned
// version (S7: refuse to start when the runner is missing or not the pinned one). Pure.
export function readSrtProbe(input: { readonly platform: NodeJS.Platform; readonly version: Exit }): Probe {
  const { platform, version } = input;
  if (!PLATFORMS.has(platform)) {
    return { kind: "missing", reason: `srt does not sandbox ${platform} here; the srt runner runs on macOS or Linux` };
  }
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

// the variables of the host a run may see besides its spec's: the toolchain on PATH (S15) and the locale
const PASSED = ["PATH", "LANG", "LC_ALL", "TERM"] as const;
// names the srt runner sets itself, or srt does: passing one in would change srt, not the run
const RESERVED = /^(HOME|TMPDIR|SRT_.*|HTTPS?_PROXY|https?_proxy|NO_PROXY|no_proxy|ALL_PROXY|all_proxy)$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

// checkEnv : a spec's variable names, each one a run may be given; the first that is not is the reason. Pure.
export function checkEnv(env: Readonly<Record<string, string>>): string {
  const bad = Object.keys(env).find((n) => !ENV_NAME.test(n) || RESERVED.test(n));
  return bad === undefined ? "" : `env name ${JSON.stringify(bad)} is not allowed in the srt runner`;
}

// srtEnv : everything srt and the run see: the host's PATH and locale, the private HOME, the company CA when there is
// one, and the spec's own variables; no other host variable (ADR-0014 P11, #181). srt itself adds the proxy variables
// that point at its own proxy, and with no parentProxy in the policy it would chain to an HTTP(S)_PROXY it was started
// with: none is passed, so the policy alone decides. Pure.
export function srtEnv(input: {
  readonly host: NodeJS.ProcessEnv;
  readonly home: string;
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
    ...(input.ca.file === "" ? {} : { [input.ca.name]: input.ca.file }),
    ...input.spec,
  };
}

// insideClone : a relative path that stays inside the clone. Pure.
export function insideClone(path: string): boolean {
  return path !== "" && !path.startsWith("/") && !path.split("/").includes("..");
}
