// check — the live egress checks of #130's Done when, planned and read here; live.ts runs them in a real runner on the
// project's internal network. Pure. Each check is one command in the runner (the probe, probe.ts, or the runner's own
// docker) and a reading of what it printed. Only a real Docker host can prove them, so `agent-factory egress check`
// runs them on the VM (GUIDE.md "Check the egress proxy").

import type { Ran } from "../box/types.js";
import type { ProxyAddress } from "./env.js";
import { PROBE, PROBE_SECONDS } from "./probe.js";

// a host no project lists, a public address the runner must not reach direct, and the image the inner Docker pulls
export const OFF_LIST_HOST = "example.com";
export const DIRECT_ADDRESS = "1.1.1.1";
export const MODEL_HOST = "api.anthropic.com";
export const PULL_IMAGE = "hello-world";
const PULL_SECONDS = 300;

export type Verdict = { readonly kind: "pass" | "fail" | "skipped"; readonly detail: string };
export type Row = { readonly name: string; readonly verdict: Verdict };

export type LiveCheck =
  | {
      readonly kind: "run";
      readonly name: string;
      readonly argv: readonly [string, ...string[]];
      readonly timeoutSeconds: number;
      readonly read: (out: Answer) => Verdict;
    }
  | { readonly kind: "skipped"; readonly name: string; readonly detail: string };

// what the probe printed, or how the command ended when it printed nothing to read
export type Answer =
  | { readonly kind: "json"; readonly value: Readonly<Record<string, unknown>>; readonly code: number }
  | { readonly kind: "text"; readonly code: number; readonly stdout: string; readonly stderr: string }
  | { readonly kind: "none"; readonly reason: string };

export type CheckInput = {
  readonly proxy: ProxyAddress;
  // the project's allowlist, as parseAllowlist keeps it
  readonly hosts: readonly string[];
  // the internal network's gateway, the host's side of it; "" when docker named none
  readonly gateway: string;
  // the host ports setup names as reachable from a runner (#136)
  readonly ports: readonly number[];
  readonly modelHost: string;
  readonly pullImage: string;
};

const pass = (detail: string): Verdict => ({ kind: "pass", detail });
const fail = (detail: string): Verdict => ({ kind: "fail", detail });

// allows : whether the list lets a host through, as Squid's dstdomain reads it
export function allows(hosts: readonly string[], host: string): boolean {
  return hosts.some((h) => h === host || (h.startsWith(".") && (`.${host}` === h || host.endsWith(h))));
}

function probe(mode: string, ...args: string[]): readonly [string, ...string[]] {
  return ["node", "-e", PROBE, mode, ...args];
}

function shown(out: Answer): string {
  switch (out.kind) {
    case "json":
      return JSON.stringify(out.value);
    case "text":
      return `exit ${out.code}: ${(out.stderr.trim() || out.stdout.trim()).slice(-300)}`;
    case "none":
      return out.reason;
  }
}

function field(out: Answer, name: string): unknown {
  return out.kind === "json" ? out.value[name] : undefined;
}

// refusedByProxy : the proxy answered the CONNECT with 403
function refusedByProxy(out: Answer): Verdict {
  return field(out, "proxy") === 403 ? pass("the proxy answered 403") : fail(`not refused: ${shown(out)}`);
}

// reached : the proxy opened the tunnel and the host answered over TLS; any HTTP status is the host's own answer
function reached(out: Answer): Verdict {
  const server = field(out, "server");
  return field(out, "proxy") === 200 && typeof server === "string" && server.startsWith("HTTP/")
    ? pass(`through the proxy, the host answered ${server}`)
    : fail(`not reached: ${shown(out)}`);
}

// blocked : the probe ran, and the connection or the lookup failed
function blocked(out: Answer): Verdict {
  return out.kind === "json" && typeof out.value.error === "string"
    ? pass(`failed as it must: ${out.value.error}`)
    : fail(`it got through: ${shown(out)}`);
}

function openPorts(out: Answer): readonly number[] | undefined {
  const open = field(out, "open");
  return Array.isArray(open) && open.every((p) => typeof p === "number") ? open : undefined;
}

function gatewayPorts(named: readonly number[]): (out: Answer) => Verdict {
  return (out) => {
    const open = openPorts(out);
    if (open === undefined) {
      return fail(`no scan: ${shown(out)}`);
    }
    const extra = open.filter((p) => !named.includes(p));
    return extra.length === 0
      ? pass(`open: ${open.join(", ") || "none"}; every one is named`)
      : fail(`open and not named by setup: ${extra.join(", ")}; close them or bind them to 127.0.0.1`);
  };
}

function pulled(out: Answer): Verdict {
  return out.kind === "text" && out.code === 0 ? pass("the inner Docker pulled it") : fail(shown(out));
}

const connect = { kind: "run", timeoutSeconds: PROBE_SECONDS.connect + 5 } as const;

function viaProxy(input: CheckInput, host: string, port: number): readonly [string, ...string[]] {
  return probe("via", input.proxy.host, String(input.proxy.port), host, String(port));
}

function offList(input: CheckInput): LiveCheck {
  const name = "a host off the allowlist is refused";
  return allows(input.hosts, OFF_LIST_HOST)
    ? { kind: "skipped", name, detail: `${OFF_LIST_HOST} is on this project's list` }
    : { ...connect, name, argv: viaProxy(input, OFF_LIST_HOST, 443), read: refusedByProxy };
}

function modelCall(input: CheckInput): readonly LiveCheck[] {
  const host = input.modelHost;
  const name = `a model call reaches ${host} through the proxy`;
  return allows(input.hosts, host)
    ? [
        { ...connect, name, argv: viaProxy(input, host, 443), read: reached },
        // the proxy allows port 443 alone, so an allowed host on another port is refused
        { ...connect, name: `${host} on port 80 is refused`, argv: viaProxy(input, host, 80), read: refusedByProxy },
      ]
    : [{ kind: "skipped", name, detail: `${host} is not on this project's list; name another with --model-host` }];
}

function gateway(input: CheckInput): LiveCheck {
  const name = "on the host's gateway, only the ports setup names are open";
  return input.gateway === ""
    ? { kind: "skipped", name, detail: "docker named no gateway for the internal network" }
    : {
        kind: "run",
        name,
        argv: probe("scan", input.gateway, "1", "65535"),
        timeoutSeconds: PROBE_SECONDS.scan + 5,
        read: gatewayPorts(input.ports),
      };
}

// liveChecks : #130's Done when, in order, for one project's runner
export function liveChecks(input: CheckInput): readonly LiveCheck[] {
  return [
    offList(input),
    ...modelCall(input),
    {
      ...connect,
      name: "a direct connection that skips the proxy is refused",
      argv: probe("direct", DIRECT_ADDRESS, "443"),
      read: blocked,
    },
    {
      ...connect,
      name: "an outside name does not resolve in the runner",
      argv: probe("dns", OFF_LIST_HOST),
      read: blocked,
    },
    gateway(input),
    {
      kind: "run",
      name: `the inner Docker pulls ${input.pullImage}, as Testcontainers does`,
      argv: ["docker", "pull", input.pullImage],
      timeoutSeconds: PULL_SECONDS,
      read: pulled,
    },
  ];
}

// answerOf : a command's end, with its last stdout line read as JSON when it is
export function answerOf(ran: Ran): Answer {
  switch (ran.kind) {
    case "failed":
      return { kind: "none", reason: `the runner could not run it: ${ran.reason}` };
    case "timedOut":
      return { kind: "none", reason: `no answer in ${ran.seconds} s` };
    case "exited":
      return jsonOf(ran.stdout.trim().split("\n").at(-1) ?? "", ran);
  }
}

function jsonOf(line: string, ran: Extract<Ran, { readonly kind: "exited" }>): Answer {
  const text: Answer = { kind: "text", code: ran.code, stdout: ran.stdout, stderr: ran.stderr };
  try {
    const value: unknown = JSON.parse(line);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? { kind: "json", value: { ...value }, code: ran.code }
      : text;
  } catch {
    return text;
  }
}

// readGateway : docker's `network inspect --format '{{range .IPAM.Config}}{{.Gateway}} {{end}}'`, its first IPv4
export function readGateway(stdout: string): string {
  return stdout.split(/\s+/).find((w) => /^\d{1,3}(\.\d{1,3}){3}$/.test(w)) ?? "";
}

// report : one line per check, and whether all passed or were skipped
export function report(rows: readonly Row[]): { readonly text: string; readonly ok: boolean } {
  const text = rows.map((r) => `${r.verdict.kind.padEnd(7)} ${r.name}: ${r.verdict.detail}\n`).join("");
  return { text, ok: rows.every((r) => r.verdict.kind !== "fail") };
}
