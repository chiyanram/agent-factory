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
// A box that cannot start or run is a failure of the run, never a failed command: no verdict comes from it. A copy the
// box filled with files this user cannot remove also fails the run, so the disk never fills unseen.

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

export type Egress = EgressStarted | { readonly kind: "own" };

export type BoxSetup = {
  readonly box: Box;
  readonly image: PinnedImage | NoImage;
  readonly egress: () => Promise<Egress>;
  readonly repo: string;
  readonly env: NodeJS.ProcessEnv;
  readonly runsDir: string;
};

export type BoxJob = {
  readonly setup: BoxSetup;
  readonly number: number;
  readonly branch: string;
  readonly head: string;
  readonly commands: readonly Argv[];
  readonly timeoutSeconds: number;
  readonly history?: { readonly base: string };
};

export type Row = {
  readonly argv: Argv;
  readonly ran: Extract<Ran, { readonly kind: "exited" }> | Extract<Ran, { readonly kind: "timedOut" }>;
};

function gitReason(ran: Awaited<ReturnType<typeof hostGit>>): string {
  return ran.kind === "refused" ? ran.reason : ran.kind === "failed" ? ran.stderr.trim() : "";
}

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

export type RunSpec = {
  readonly worktree: string;
  readonly readOnly: readonly string[];
  readonly env: Readonly<Record<string, string>>;
};

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

async function inBox(
  job: BoxJob,
  code: string,
  env: Readonly<Record<string, string>>,
): Promise<Result<readonly Row[]>> {
  const { box } = job.setup;
  const session = await startBox(job.setup, { worktree: code, readOnly: [], env });
  if (session.kind === "failed") {
    return session;
  }
  const rows = await runAll(job, session.value);
  const stopped = await box.stop(session.value);
  return stopped.kind === "ok"
    ? rows
    : { kind: "failed", reason: `the box ${session.value.id} did not stop: ${stopped.reason}` };
}

// git honours safe.directory only in protected configuration, which includes the command scope.
// https://git-scm.com/docs/git-config#Documentation/git-config.txt-safedirectory
const GIT_SAFE: Readonly<Record<string, string>> = {
  GIT_CONFIG_COUNT: "1",
  GIT_CONFIG_KEY_0: "safe.directory",
  GIT_CONFIG_VALUE_0: "*",
};

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
        // git fetch refuses to update the current branch's head unless this flag is given.
        // https://git-scm.com/docs/git-fetch
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
  const removed = await attempt(() => rm(dir.value, { recursive: true, force: true }), `cannot remove ${dir.value}`);
  return removed.kind === "ok" ? rows : removed;
}

export function rowLine(row: Row): string {
  const what = row.argv.join(" ");
  return row.ran.kind === "timedOut"
    ? `${what} ran out of time (${row.ran.seconds}s)`
    : `${what} exited ${row.ran.code}`;
}
