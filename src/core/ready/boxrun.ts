// boxrun — branch code run in a fresh box, never on the host (#91; ADR-0012 S5, S8). The ready check and the local
// verifier both come here:
//   1 the change's branch is fetched into the clone through hostGit, and its tip must be the head the run is for
//   2 the tree at that head is copied into a private folder with no checkout filter (code.ts); nothing of it runs here.
//     For a ready check with a git row (#444), the host makes that folder a repository of its own: the branch at the
//     head and the default branch, fetched from the clone through hostGit, so the row reads history in the box
//   3 the project's egress proxy starts (#130), then a fresh box with only that folder mounted, no forge token, on the
//     project's internal network, its egress through that proxy
//   4 the commands run one by one, each with no shell and a time limit; the first that fails ends the run
//   5 the box stops and the folder goes, however the run ended
// A box that cannot start or run is a failure of the run, never a failed command: no verdict comes from it.

import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Box, NoImage, PinnedImage, Ran, Session } from "../box/index.js";
import { proxyEnv } from "../egress/env.js";
import type { Started as EgressStarted } from "../egress/start.js";
import type { Result } from "../forge/api.js";
import { hostGit, type RepoTarget } from "../git.js";
import type { Argv } from "../project.js";
import { copyCode } from "../review/code.js";
import { attempt } from "../review/safe.js";
import { BASE_REF } from "./floor.js";

// the run's egress: the project's Squid proxy, started, on its internal network (vm), or the runner's own proxy, which
// the srt runner was made with from the same checked allowlist (#114)
export type Egress = EgressStarted | { readonly kind: "own" };

export type BoxSetup = {
  readonly box: Box;
  // the vm runner's pinned image; NO_IMAGE for the srt runner, which runs this host's own programs
  readonly image: PinnedImage | NoImage;
  // starts the project's egress proxy, recreated with the allowlist read this pass; a box run calls it inside the
  // project's dispatch lock, so it never recreates the proxy under a box that is running
  readonly egress: () => Promise<Egress>;
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
  // the branch's history in the box's copy, with the default branch the floor guard fetched (#444); none by default
  readonly history?: { readonly base: string };
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

// behindProxy : the proxy variables, the proxy and the network a box joins; none for a runner with its own proxy
function behindProxy(egress: Exclude<Egress, { kind: "failed" }>): {
  readonly env: Readonly<Record<string, string>>;
  readonly proxy: string;
  readonly network: string;
} {
  if (egress.kind === "own") {
    return { env: {}, proxy: "", network: "" };
  }
  const { proxy, network } = egress;
  return { env: proxyEnv(proxy), proxy: `http://${proxy.host}:${proxy.port}`, network };
}

// startBox : the project's egress proxy, then a fresh box on `spec.worktree`, behind it. The ready check and the
// writer (#113) both start their boxes here.
export async function startBox(setup: BoxSetup, spec: RunSpec): Promise<Result<Session>> {
  const egress = await setup.egress();
  if (egress.kind === "failed") {
    return { kind: "failed", reason: `the egress proxy did not start: ${egress.reason}` };
  }
  const net = behindProxy(egress);
  const box = await setup.box.start({
    image: setup.image,
    worktree: spec.worktree,
    readOnly: spec.readOnly,
    env: { ...net.env, ...spec.env },
    proxy: net.proxy,
    network: net.network,
  });
  return box.kind === "started"
    ? { kind: "ok", value: box.session }
    : { kind: "failed", reason: `the box did not start: ${box.reason}` };
}

// inBox : a fresh box on the tree in `code`; it is stopped whatever happens
async function inBox(
  job: BoxJob,
  code: string,
  env: Readonly<Record<string, string>>,
): Promise<Result<readonly Row[]>> {
  const { box } = job.setup;
  // no agent runs here, so there are no settings to hold read-only; the copy is thrown away after
  const session = await startBox(job.setup, { worktree: code, readOnly: [], env });
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

// the box's git reads its own repository, whoever owns the copy: command scope, which git honours for this key
const GIT_SAFE: Readonly<Record<string, string>> = {
  GIT_CONFIG_COUNT: "1",
  GIT_CONFIG_KEY_0: "safe.directory",
  GIT_CONFIG_VALUE_0: "*",
};

// withHistory : the copy made a repository on the host, through hostGit: the branch at the head checked out, the
// default branch as <base> and origin/<base>; the files stay the ones code.ts copied
async function withHistory(job: BoxJob, code: string, base: string): Promise<Result<string>> {
  const git = (args: readonly string[], repo: RepoTarget) =>
    hostGit({ args, repo, env: job.setup.env, stdin: { kind: "none" } });
  const branch = `refs/heads/${job.branch}`;
  const copy: RepoTarget = { kind: "repo", path: code };
  const steps: readonly (readonly [readonly string[], RepoTarget])[] = [
    [["init", "-q", code], { kind: "none" }],
    [
      [
        "fetch",
        "-q",
        "--no-tags",
        // the fresh repository's unborn HEAD names git's default branch, which may be the project's own (main on a
        // recent git, or init.defaultBranch): fetching into it is refused unless allowed; HEAD is set right after (#62)
        "--update-head-ok",
        job.setup.repo,
        `+refs/factory/mr-${job.number}:${branch}`,
        `+${BASE_REF}:refs/heads/${base}`,
        `+${BASE_REF}:refs/remotes/origin/${base}`,
      ],
      copy,
    ],
    [["symbolic-ref", "HEAD", branch], copy],
    [["reset", "-q"], copy],
  ];
  for (const [args, repo] of steps) {
    const ran = await git(args, repo);
    if (ran.kind !== "ok") {
      return { kind: "failed", reason: `cannot give the box the branch's history: ${gitReason(ran)}` };
    }
  }
  return { kind: "ok", value: code };
}

async function inFolder(job: BoxJob, dir: string): Promise<Result<readonly Row[]>> {
  const code = join(dir, "code");
  const copied = await copyCode({ repo: job.setup.repo, sha: job.head, into: code, env: job.setup.env, prune: "none" });
  if (copied.kind !== "ok") {
    return copied;
  }
  if (job.history === undefined) {
    return inBox(job, code, {});
  }
  const repo = await withHistory(job, code, job.history.base);
  return repo.kind === "ok" ? inBox(job, code, GIT_SAFE) : repo;
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
