// egress-cli — `agent-factory egress check <project>` (#130): the live egress checks, in a real runner on the project's
// internal network, behind the proxy a box run starts. Only a real Docker host proves them, so the operator runs it on
// the VM; app.ts hands it this host's settings, docker and box plan.

import { parseArgs } from "node:util";
import type { Runner } from "./core/forge/api.js";
import { MODEL_HOST, PULL_IMAGE, report } from "./core/egress/check.js";
import { checkEgress } from "./core/egress/live.js";
import type { PlanRead } from "./core/ready/plan.js";

export const EGRESS_HELP = `  egress check <project> [--port <n>]... [--model-host <host>] [--pull <image>]
                               the live egress checks (#130) in a fresh runner behind the project's proxy: a host off
                               the list refused, a model call through, a direct connection and an outside DNS name
                               refused, only the --port ports open on the host's gateway, and the inner Docker
                               pulling <image> (default ${PULL_IMAGE}). Needs what a dispatch pass needs (FACTORY_BOX,
                               box.json, egress.allow, FACTORY_REPO). Exit 0 all passed or skipped, 1 a check failed
`;

export type EgressDeps = {
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
  // runs `go` with the project's resolved settings, this host's docker and its box plan; its exit code
  readonly resolved: (
    project: string,
    go: (host: {
      readonly docker: { readonly run: Runner; readonly bin: string; readonly env: NodeJS.ProcessEnv };
      readonly plan: () => Promise<PlanRead>;
    }) => Promise<number>,
  ) => Promise<number>;
};

type Parsed = {
  readonly project: string;
  readonly ports: readonly number[];
  readonly modelHost: string;
  readonly pullImage: string;
};

const PORT = /^\d{1,5}$/;
const MAX_PORT = 65_535;

function portsOf(texts: readonly string[]): readonly number[] | "bad" {
  const ports = texts.map((t) => (PORT.test(t) ? Number(t) : 0));
  return ports.every((p) => p >= 1 && p <= MAX_PORT) ? ports : "bad";
}

// projectOf : the project of `check <project>`, or "" for any other words
function projectOf(positionals: readonly string[]): string {
  const [what, project = "", ...rest] = positionals;
  return what === "check" && rest.length === 0 ? project : "";
}

type Values = { readonly port: string[]; readonly "model-host": string; readonly pull: string };

function parsedOf(values: Values, positionals: readonly string[]): Parsed | "usage" {
  const { port, "model-host": modelHost, pull: pullImage } = values;
  const project = projectOf(positionals);
  const ports = portsOf(port);
  return project === "" || ports === "bad" ? "usage" : { project, ports, modelHost, pullImage };
}

export function parseEgressArgs(argv: readonly string[]): Parsed | "usage" {
  try {
    const { values, positionals } = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        port: { type: "string", multiple: true, default: [] },
        "model-host": { type: "string", default: MODEL_HOST },
        pull: { type: "string", default: PULL_IMAGE },
      },
    });
    return parsedOf(values, positionals);
  } catch {
    return "usage";
  }
}

export async function egressCommand(argv: readonly string[], deps: EgressDeps): Promise<number> {
  const parsed = parseEgressArgs(argv);
  if (parsed === "usage") {
    deps.err(`usage:\n${EGRESS_HELP}`);
    return 64;
  }
  return deps.resolved(parsed.project, async (host) => {
    const read = await host.plan();
    const plan = read.kind === "ok" ? read.value.plan : { kind: "unavailable" as const, reason: read.reason };
    if (plan.kind !== "ready") {
      deps.err(`agent-factory egress: no runner for ${parsed.project}: ${plan.reason}\n`);
      return 1;
    }
    deps.err("starting the proxy and a runner; the gateway scan takes up to 5 minutes\n");
    const rows = await checkEgress({
      ...parsed,
      setup: plan.setup,
      allowlist: plan.project.egress.allow,
      docker: host.docker,
    });
    if (rows.kind === "failed") {
      deps.err(`agent-factory egress: ${rows.reason}\n`);
      return 1;
    }
    const done = report(rows.value);
    deps.out(done.text);
    return done.ok ? 0 : 1;
  });
}
