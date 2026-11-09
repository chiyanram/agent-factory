// upstream — the corporate proxy every request leaves through at work (#130), read from FACTORY_UPSTREAM_PROXY. Pure.
// It is a setting of the machine, not of a project: the network the factory runs on decides it (decision on #30,
// 2026-11-07). Unset or empty means the proxy goes out direct.
//
//   FACTORY_UPSTREAM_PROXY=proxy.corp.example:8080    host and port only: no scheme, no user, no password

import type { Upstream } from "./squid.js";
import { settingOf } from "../settings/machine.js";

export type UpstreamRead = Upstream | { readonly kind: "refused"; readonly reason: string };

const HOST_PORT = /^([A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?):(\d{1,5})$/;
const MAX_PORT = 65_535;

function portOf(text: string): number | "bad" {
  const port = Number(text);
  return port >= 1 && port <= MAX_PORT ? port : "bad";
}

function proxyOf(set: string): UpstreamRead {
  const [, host, port] = HOST_PORT.exec(set) ?? [];
  const number = port === undefined ? "bad" : portOf(port);
  return host !== undefined && number !== "bad"
    ? { kind: "proxy", host, port: number }
    : {
        kind: "refused",
        reason: `FACTORY_UPSTREAM_PROXY must be host:port, such as proxy.corp.example:8080, got ${JSON.stringify(set)}`,
      };
}

export function upstreamOf(env: NodeJS.ProcessEnv): UpstreamRead {
  const set = (settingOf(env, "egress.upstreamProxy") ?? "").trim();
  return set === "" ? { kind: "none" } : proxyOf(set);
}
