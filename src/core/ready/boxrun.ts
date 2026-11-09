// boxrun — branch code run in a fresh box, never on the host (#91; ADR-0012 S5, S8). The ready check and the local
// verifier both come here:
//   1 the change's branch is fetched into the clone through hostGit, and its tip must be the head the run is for
//   2 the tree at that head is copied into a private folder with no checkout filter (code.ts); nothing of it runs here
//   3 the project's egress proxy starts (#130), then a fresh box with only that folder mounted, no forge token, on the
//     project's internal network, its egress through that proxy
//   4 the commands run one by one, each with no shell and a time limit; the first that fails ends the run
//   5 the box stops and the folder goes, however the run ended
// A box that cannot start or run is a failure of the run, never a failed command: no verdict comes from it.

import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Box, PinnedImage, Ran, Session } from "../box/index.js";
import { proxyEnv } from "../egress/env.js";
import type { Started as EgressStarted } from "../egress/start.js";
import type { Result } from "../forge/api.js";
import { hostGit } from "../git.js";
import type { Argv } from "../project.js";
import { copyCode } from "../review/code.js";
import { attempt } from "../review/safe.js";

export type BoxSetup = {
  readonly box: Box;
  readonly image: PinnedImage;
  // starts the project's egress proxy, recreated with the allowlist read this pass; a box run calls it inside the
  // project's dispatch lock, so it never recreates the proxy under a box that is running
  readonly egress: () => Promise<EgressStarted>;
  // the project's clone (FACTORY_REPO): only git reads it, through hostGit
  readonly repo: string;
  // the host's environment, for hostGit only; the box never sees it
  readonly env: NodeJS.ProcessEnv;
  // a private folder (0700) the copies of the tree go in
  readonly runsDir: string;
};

export type BoxJob = {
  readonly setup: BoxSetup;
  readonly number: number;
  readonly branch: string;
  readonly head: string;
  readonly commands: readonly Argv[];
  readonly timeoutSeconds: number;
};

// one command's run: exited with a code, or ran out of time
export type Row = {
  readonly argv: Argv;
  readonly ran: Extract<Ran, { readonly kind: "exited" }> | Extract<Ran, { readonly kind: "timedOut" }>;
};

function gitReason(ran: Awaited<ReturnType<typeof hostGit>>): string {
  return ran.kind === "refused" ? ran.reason : ran.kind === "failed" ? ran.stderr.trim() : "";
}

// fetched : the branch's tip in the clone, which must be the head this run is for
async function fetched(job: BoxJob): Promise<Result<string>> {
  const ref = `refs/factory/mr-${job.number}`;
  const git = (args: readonly string[]) =>
    hostGit({
      args,
      repo: { kind: "repo", path: job.setup.repo },
      env: job.setup.env,
      stdin: { kind: "none" },
    });
  const fetch = await git(["fetch", "-q", "origin", `+refs/heads/${job.branch}:${ref}`]);
  const tip = fetch.kind === "ok" ? await git(["rev-parse", ref]) : fetch;
  if (tip.kind !== "ok") {
    return { kind: "failed", reason: `cannot fetch ${job.branch}: ${gitReason(tip)}` };
  }
  const sha = tip.stdout.trim();
  return sha === job.head
    ? { kind: "ok", value: sha }
    : {
        kind: "failed",
        reason: `the tip of ${job.branch} is ${sha.slice(0, 8)}, not ${job.head.slice(0, 8)}: the head moved`,
      };
}

async function runAll(job: BoxJob, session: Session): Promise<Result<readonly Row[]>> {
  const rows: Row[] = [];
  for (const argv of job.commands) {
    const ran = await job.setup.box.run({
      session,
      command: { argv, stdin: { kind: "none" }, timeoutSeconds: job.timeoutSeconds },
    });
    if (ran.kind === "failed") {
      return { kind: "failed", reason: `the box could not run ${argv.join(" ")}: ${ran.reason}` };
    }
    rows.push({ argv, ran });
    if (ran.kind === "timedOut" || ran.code !== 0) {
      break;
    }
  }
  return { kind: "ok", value: rows };
}

// what one box run mounts and sees, beyond the image, the proxy and the network the setup gives
export type RunSpec = {
  readonly worktree: string;
  readonly readOnly: readonly string[];
  readonly env: Readonly<Record<string, string>>;
};

// startBox : the project's egress proxy, then a fresh box on `spec.worktree`, behind it. The ready check and the
// writer (#113) both start their boxes here.
export async function startBox(setup: BoxSetup, spec: RunSpec): Promise<Result<Session>> {
  const egress = await setup.egress();
  if (egress.kind === "failed") {
    return { kind: "failed", reason: `the egress proxy did not start: ${egress.reason}` };
  }
  const { proxy, network } = egress;
  const box = await setup.box.start({
    image: setup.image,
    worktree: spec.worktree,
    readOnly: spec.readOnly,
    env: { ...proxyEnv(proxy), ...spec.env },
    proxy: `http://${proxy.host}:${proxy.port}`,
    network,
  });
  return box.kind === "started"
    ? { kind: "ok", value: box.session }
    : { kind: "failed", reason: `the box did not start: ${box.reason}` };
}

// inBox : a fresh box on the tree in `code`; it is stopped whatever happens
async function inBox(job: BoxJob, code: string): Promise<Result<readonly Row[]>> {
  const { box } = job.setup;
  // no agent runs here, so there are no settings to hold read-only; the copy is thrown away after
  const session = await startBox(job.setup, { worktree: code, readOnly: [], env: {} });
  if (session.kind === "failed") {
    return session;
  }
  // the box seam never throws, so the stop always runs; a box that will not stop fails the run, so it is seen
  const rows = await runAll(job, session.value);
  const stopped = await box.stop(session.value);
  return stopped.kind === "ok"
    ? rows
    : { kind: "failed", reason: `the box ${session.value.id} did not stop: ${stopped.reason}` };
}

async function inFolder(job: BoxJob, dir: string): Promise<Result<readonly Row[]>> {
  const code = join(dir, "code");
  const copied = await copyCode({ repo: job.setup.repo, sha: job.head, into: code, env: job.setup.env, prune: "none" });
  return copied.kind === "ok" ? inBox(job, code) : copied;
}

// runInBox : the commands at the change's head, in a fresh box; the rows that ran, up to the first that failed
export async function runInBox(job: BoxJob): Promise<Result<readonly Row[]>> {
  const tip = await fetched(job);
  if (tip.kind === "failed") {
    return tip;
  }
  const dir = await attempt(async () => {
    await mkdir(job.setup.runsDir, { recursive: true, mode: 0o700 });
    return mkdtemp(join(job.setup.runsDir, "box-"));
  }, `cannot make a folder in ${job.setup.runsDir}`);
  if (dir.kind === "failed") {
    return dir;
  }
  const rows = await inFolder(job, dir.value);
  // a folder the box filled with files this user cannot remove fails the run, rather than fill the disk unseen
  const removed = await attempt(() => rm(dir.value, { recursive: true, force: true }), `cannot remove ${dir.value}`);
  return removed.kind === "ok" ? rows : removed;
}

// rowLine : how one row ended, for a reason or a status
export function rowLine(row: Row): string {
  const what = row.argv.join(" ");
  return row.ran.kind === "timedOut"
    ? `${what} ran out of time (${row.ran.seconds}s)`
    : `${what} exited ${row.ran.code}`;
}
