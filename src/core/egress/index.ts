// index — the egress proxy for every box (#130; decision B on #30, 2026-11-07). The caller passes the project's
// allowlist (ADR-0014 P3) and, at work, the corporate proxy. openEgress checks the list, writes the Squid config and
// starts the proxy, then gives back the address and the network a box joins (BoxSpec.proxy, #112).

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PinnedImage } from "../box/types.js";
import type { Runner } from "../forge/api.js";
import { parseAllowlist } from "./allowlist.js";
import { squidConf, type Upstream } from "./squid.js";
import { startEgress, type Started } from "./start.js";

export { parseAllowlist, type Allowlist } from "./allowlist.js";
export { squidConf, PROXY_PORT, type Upstream } from "./squid.js";
export { proxyEnv, type ProxyAddress } from "./env.js";
export {
  INTERNAL_NETWORK,
  OUTBOUND_NETWORK,
  PROXY_CONTAINER,
  planNetwork,
  readNetwork,
  startEgress,
  type Started,
} from "./start.js";

export type EgressSetup = {
  readonly allowlist: readonly string[];
  readonly upstream: Upstream;
  readonly image: PinnedImage;
  // where the rendered squid.conf is kept: <factory home>/egress
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
  const list = parseAllowlist(setup.allowlist);
  if (list.kind === "refused") {
    return { kind: "failed", reason: list.reason };
  }
  const conf = await writeConf(setup.dir, squidConf({ hosts: list.hosts, upstream: setup.upstream }));
  if (conf.kind === "failed") {
    return conf;
  }
  return startEgress({ docker: setup.docker, image: setup.image, confFile: conf.file });
}
