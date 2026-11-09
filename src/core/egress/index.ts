// index — the egress proxy for every box (#130; decision B on #30, 2026-11-07). The caller passes the project, its
// allowlist (ADR-0014 P3) and, at work, the corporate proxy. openEgress checks the list, writes the Squid config and
// starts the project's own proxy, then gives back the address and the network a box joins (BoxSpec.proxy and
// BoxSpec.network, #112). One proxy per project (decision on #30, 2026-11-07).

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PinnedImage } from "../box/types.js";
import type { Runner } from "../forge/api.js";
import { parseAllowlist } from "./allowlist.js";
import { squidConf, type Upstream } from "./squid.js";
import { egressNames, startEgress, type Started } from "./start.js";

// Canonical's Squid 6.6 on Ubuntu 24.04, the box's own base (S7: pinned); FACTORY_EGRESS_IMAGE may replace it
export const DEFAULT_EGRESS_IMAGE =
  "ubuntu/squid:6.6-24.04_edge@sha256:8a3baed477e2c282ab8aa5edad442f69873246964f225c5c2ae8364b6610963c";

export { GIT_HOSTS, parseAllowlist, type Allowlist } from "./allowlist.js";
export { squidConf, PROXY_PORT, type Upstream } from "./squid.js";
export { proxyEnv, type ProxyAddress } from "./env.js";
export { upstreamOf, type UpstreamRead } from "./upstream.js";
export {
  OUTBOUND_NETWORK,
  egressNames,
  planNetwork,
  readNetwork,
  startEgress,
  type EgressNames,
  type Started,
} from "./start.js";

export type EgressSetup = {
  // a plain project name (spec.ts): it names the proxy, its network and its config folder
  readonly project: string;
  readonly allowlist: readonly string[];
  // the project's own git host, refused on the list besides the public ones (allowlist.ts)
  readonly gitHosts: readonly string[];
  readonly upstream: Upstream;
  readonly image: PinnedImage;
  // where the rendered configs are kept: <factory home>/egress; each project's in its own folder
  readonly dir: string;
  readonly docker: { readonly run: Runner; readonly bin: string; readonly env: NodeJS.ProcessEnv };
};

async function writeConf(
  dir: string,
  text: string,
): Promise<{ readonly kind: "written"; readonly file: string } | { readonly kind: "failed"; readonly reason: string }> {
  const file = join(dir, "squid.conf");
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(file, text, { mode: 0o600 });
    return { kind: "written", file };
  } catch (error) {
    return {
      kind: "failed",
      reason: `cannot write ${file}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function openEgress(setup: EgressSetup): Promise<Started> {
  const list = parseAllowlist(setup.allowlist, setup.gitHosts);
  if (list.kind === "refused") {
    return { kind: "failed", reason: list.reason };
  }
  const conf = await writeConf(
    join(setup.dir, setup.project),
    squidConf({ hosts: list.hosts, upstream: setup.upstream }),
  );
  if (conf.kind === "failed") {
    return conf;
  }
  return startEgress({
    docker: setup.docker,
    image: setup.image,
    confFile: conf.file,
    names: egressNames(setup.project),
  });
}
