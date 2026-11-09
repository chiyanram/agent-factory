// live — runs the live egress checks (check.ts) in a real runner (#130): the project's proxy starts as a box run starts
// it, then a fresh runner with an empty folder mounted joins the project's internal network, each check runs in it,
// and the runner stops however the checks ended. `agent-factory egress check <project>` calls it on the VM.

import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Runner, Result } from "../forge/api.js";
import type { BoxSetup } from "../ready/boxrun.js";
import { startBox } from "../ready/boxrun.js";
import { parseAllowlist } from "./allowlist.js";
import { answerOf, liveChecks, readGateway, type LiveCheck, type Row } from "./check.js";
import type { Session } from "../box/types.js";
import type { Started } from "./start.js";

export type LiveInput = {
  readonly setup: BoxSetup;
  readonly allowlist: readonly string[];
  readonly docker: { readonly run: Runner; readonly bin: string; readonly env: NodeJS.ProcessEnv };
  readonly ports: readonly number[];
  readonly modelHost: string;
  readonly pullImage: string;
};

async function gatewayOf(input: LiveInput, network: string): Promise<string> {
  const { docker } = input;
  const exit = await docker.run({
    bin: docker.bin,
    args: ["network", "inspect", "--format", "{{range .IPAM.Config}}{{.Gateway}} {{end}}", network],
    stdin: "",
    env: docker.env,
  });
  return exit.code === 0 ? readGateway(exit.stdout) : "";
}

async function runOne(setup: BoxSetup, session: Session, check: LiveCheck): Promise<Row> {
  if (check.kind === "skipped") {
    return { name: check.name, verdict: { kind: "skipped", detail: check.detail } };
  }
  const ran = await setup.box.run({
    session,
    command: { argv: check.argv, stdin: { kind: "none" }, timeoutSeconds: check.timeoutSeconds },
  });
  return { name: check.name, verdict: check.read(answerOf(ran)) };
}

// checksFor : the checks for this proxy and its network's gateway
async function checksFor(
  input: LiveInput,
  egress: Extract<Started, { kind: "started" }>,
): Promise<readonly LiveCheck[]> {
  const list = parseAllowlist(input.allowlist);
  return liveChecks({
    proxy: egress.proxy,
    hosts: list.kind === "ok" ? list.hosts : [],
    gateway: await gatewayOf(input, egress.network),
    ports: input.ports,
    modelHost: input.modelHost,
    pullImage: input.pullImage,
  });
}

async function runAll(setup: BoxSetup, session: Session, checks: readonly LiveCheck[]): Promise<readonly Row[]> {
  const rows: Row[] = [];
  for (const check of checks) {
    rows.push(await runOne(setup, session, check));
  }
  return rows;
}

async function inRunner(input: LiveInput, folder: string): Promise<Result<readonly Row[]>> {
  const egress = await input.setup.egress();
  if (egress.kind === "failed") {
    return { kind: "failed", reason: `the egress proxy did not start: ${egress.reason}` };
  }
  // the proxy is started once: the runner joins the one these checks then probe
  const setup: BoxSetup = { ...input.setup, egress: () => Promise.resolve(egress) };
  const session = await startBox(setup, { worktree: folder, readOnly: [], env: {} });
  if (session.kind === "failed") {
    return session;
  }
  const rows = await runAll(setup, session.value, await checksFor(input, egress));
  const stopped = await setup.box.stop(session.value);
  return stopped.kind === "ok"
    ? { kind: "ok", value: rows }
    : { kind: "failed", reason: `the runner ${session.value.id} did not stop: ${stopped.reason}` };
}

// checkEgress : every live check, in a runner on an empty folder that goes afterwards
export async function checkEgress(input: LiveInput): Promise<Result<readonly Row[]>> {
  await mkdir(input.setup.runsDir, { recursive: true, mode: 0o700 });
  const folder = await mkdtemp(join(input.setup.runsDir, "egress-check-"));
  try {
    return await inRunner(input, folder);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}
