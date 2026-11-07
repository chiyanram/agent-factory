// start — creates the egress networks and starts the proxy container, through the docker CLI (#130; decision B on #30,
// 2026-11-07). The box (#113) joins only the internal network, so the proxy is its only way out. Nothing here throws.
//
//   factory-int     docker network create --internal: no route out (Docker sets no default route and drops traffic to
//                   other networks)
//   factory-ext     a plain bridge: the proxy's way out
//   factory-egress  the Squid container, on both networks
//
// An internal network of that name that is not --internal is refused, never reused: a box on it would have an open
// network. The proxy is created again on every start, so it always runs the config rendered now. The config goes in
// with `docker cp`, not a bind mount, because Rancher Desktop shares no $HOME with its VM (ADR-0012 S8).

import type { Call, Exit, Runner } from "../forge/api.js";
import type { PinnedImage } from "../box/types.js";
import { PROXY_PORT } from "./squid.js";
import type { ProxyAddress } from "./env.js";

export const INTERNAL_NETWORK = "factory-int";
export const OUTBOUND_NETWORK = "factory-ext";
export const PROXY_CONTAINER = "factory-egress";

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
const removeProxy: Step = async (docker) => {
  const exit = await docker.run(call(docker, ["rm", "--force", PROXY_CONTAINER]));
  return exit.code === 0 || /no such container/i.test(exit.stderr)
    ? { kind: "ok" }
    : { kind: "failed", reason: `docker rm: ${exit.stderr.trim()}` };
};

export async function startEgress(input: {
  readonly docker: Docker;
  readonly image: PinnedImage;
  readonly confFile: string;
}): Promise<Started> {
  const steps: readonly Step[] = [
    ensureNetwork(INTERNAL_NETWORK, true),
    ensureNetwork(OUTBOUND_NETWORK, false),
    removeProxy,
    (d) =>
      step(d, [
        "create",
        "--name",
        PROXY_CONTAINER,
        "--network",
        OUTBOUND_NETWORK,
        "--restart",
        "unless-stopped",
        input.image.ref,
      ]),
    (d) => step(d, ["cp", input.confFile, `${PROXY_CONTAINER}:/etc/squid/squid.conf`]),
    (d) => step(d, ["network", "connect", INTERNAL_NETWORK, PROXY_CONTAINER]),
    (d) => step(d, ["start", PROXY_CONTAINER]),
  ];
  for (const s of steps) {
    const done = await s(input.docker);
    if (done.kind === "failed") {
      return done;
    }
  }
  return { kind: "started", proxy: { host: PROXY_CONTAINER, port: PROXY_PORT }, network: INTERNAL_NETWORK };
}
