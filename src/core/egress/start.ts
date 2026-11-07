// start — creates the egress networks and starts the proxy container, through the docker CLI (#130; decision B on #30,
// 2026-11-07). The box (#113) joins only its project's internal network, so the proxy is its only way out. Nothing
// here throws.
//
//   factory-int-<project>     docker network create --internal: no route out (Docker sets no default route and drops
//                             traffic to other networks, so one project's box cannot reach another project's proxy)
//   factory-ext               a plain bridge, shared: the proxies' way out; it holds no policy
//   factory-egress-<project>  the project's Squid container, on both networks, with only that project's allowlist
//
// One proxy per project (decision on #30, 2026-11-07): two projects' passes run at once, and a shared proxy would let
// one pass swap the allowlist under the other's box. An internal network of that name that is not --internal is
// refused, never reused: a box on it would have an open network. The proxy is created again on every start, so it
// always runs the config rendered now; the project's dispatch lock keeps that from happening under a running box. The
// config goes in with `docker cp`, not a bind mount, because Rancher Desktop shares no $HOME with its VM (ADR-0012 S8).

import type { Call, Exit, Runner } from "../forge/api.js";
import type { PinnedImage } from "../box/types.js";
import { PROXY_PORT } from "./squid.js";
import type { ProxyAddress } from "./env.js";

export const OUTBOUND_NETWORK = "factory-ext";

// the project's proxy container and the internal network its boxes join; the project is a plain name (spec.ts)
export type EgressNames = { readonly proxy: string; readonly network: string };

export function egressNames(project: string): EgressNames {
  return { proxy: `factory-egress-${project}`, network: `factory-int-${project}` };
}

export type Started =
  | { readonly kind: "started"; readonly proxy: ProxyAddress; readonly network: string }
  | { readonly kind: "failed"; readonly reason: string };

export type NetworkState = { readonly kind: "absent" } | { readonly kind: "present"; readonly internal: boolean };
export type NetworkPlan =
  | { readonly kind: "create" }
  | { readonly kind: "keep" }
  | { readonly kind: "refused"; readonly reason: string };

// planNetwork : what to do with a network, given what docker says about it. Pure.
export function planNetwork(input: {
  readonly name: string;
  readonly state: NetworkState;
  readonly internal: boolean;
}): NetworkPlan {
  const { name, state, internal } = input;
  if (state.kind === "absent") {
    return { kind: "create" };
  }
  return state.internal === internal
    ? { kind: "keep" }
    : {
        kind: "refused",
        reason: `network ${name} exists with internal=${state.internal}, but the factory needs internal=${internal}; remove it with: docker network rm ${name}`,
      };
}

// readNetwork : docker's answer to `network inspect --format {{.Internal}}`. A missing network is "absent"; any other
// failure is not read as absent, so a broken docker is never taken for a network to create.
export function readNetwork(exit: Exit): NetworkState | { readonly kind: "failed"; readonly reason: string } {
  if (exit.code === 0) {
    return { kind: "present", internal: exit.stdout.trim() === "true" };
  }
  return /no such network|not found/i.test(exit.stderr)
    ? { kind: "absent" }
    : { kind: "failed", reason: `docker network inspect: ${exit.stderr.trim()}` };
}

type Docker = { readonly run: Runner; readonly bin: string; readonly env: NodeJS.ProcessEnv };
type Step = (docker: Docker) => Promise<{ readonly kind: "ok" } | { readonly kind: "failed"; readonly reason: string }>;

function call(docker: Docker, args: readonly string[]): Call {
  return { bin: docker.bin, args, stdin: "", env: docker.env };
}

async function step(
  docker: Docker,
  args: readonly string[],
): Promise<{ readonly kind: "ok" } | { readonly kind: "failed"; readonly reason: string }> {
  const exit = await docker.run(call(docker, args));
  return exit.code === 0
    ? { kind: "ok" }
    : { kind: "failed", reason: `docker ${args.slice(0, 2).join(" ")}: ${exit.stderr.trim()}` };
}

async function act(
  docker: Docker,
  name: string,
  internal: boolean,
  state: NetworkState,
): Promise<{ readonly kind: "ok" } | { readonly kind: "failed"; readonly reason: string }> {
  const plan = planNetwork({ name, state, internal });
  switch (plan.kind) {
    case "keep":
      return { kind: "ok" };
    case "refused":
      return { kind: "failed", reason: plan.reason };
    case "create":
      return step(docker, ["network", "create", ...(internal ? ["--internal"] : []), name]);
  }
}

function ensureNetwork(name: string, internal: boolean): Step {
  return async (docker) => {
    const state = readNetwork(
      await docker.run(call(docker, ["network", "inspect", "--format", "{{.Internal}}", name])),
    );
    return state.kind === "failed" ? state : act(docker, name, internal, state);
  };
}

// removeProxy : succeeds when no proxy container is left, even if there was none
function removeProxy(name: string): Step {
  return async (docker) => {
    const exit = await docker.run(call(docker, ["rm", "--force", name]));
    return exit.code === 0 || /no such container/i.test(exit.stderr)
      ? { kind: "ok" }
      : { kind: "failed", reason: `docker rm: ${exit.stderr.trim()}` };
  };
}

export async function startEgress(input: {
  readonly docker: Docker;
  readonly image: PinnedImage;
  readonly confFile: string;
  readonly names: EgressNames;
}): Promise<Started> {
  const { proxy, network } = input.names;
  const steps: readonly Step[] = [
    ensureNetwork(network, true),
    ensureNetwork(OUTBOUND_NETWORK, false),
    removeProxy(proxy),
    (d) =>
      step(d, [
        "create",
        "--name",
        proxy,
        "--network",
        OUTBOUND_NETWORK,
        "--restart",
        "unless-stopped",
        input.image.ref,
      ]),
    (d) => step(d, ["cp", input.confFile, `${proxy}:/etc/squid/squid.conf`]),
    (d) => step(d, ["network", "connect", network, proxy]),
    (d) => step(d, ["start", proxy]),
  ];
  for (const s of steps) {
    const done = await s(input.docker);
    if (done.kind === "failed") {
      return done;
    }
  }
  return { kind: "started", proxy: { host: proxy, port: PROXY_PORT }, network };
}
