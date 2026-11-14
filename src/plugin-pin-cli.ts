// plugin-pin-cli — `agent-factory plugin update <project> <name@marketplace> [<commit>]` (#232; docs/DESIGN.md section 5
// "Plugins": updating is deliberate). It fetches the marketplace's clone (or takes the given commit, and fetches a full
// commit the clone lacks, #607), copies the plugin into the store by its hash, shows what changes against the pin,
// then runs config check and reads the process of the project's plugins with the new version in. Only when both pass
// does it move the pin. The eval set is not run here: `agent-factory eval reviewer` runs it, and spends money.

import { access } from "node:fs/promises";
import type { Result } from "./core/forge/api.js";
import { changedFiles, fetchPlugin, folderCounts, targetCommit, type Fetched } from "./core/process/fetch.js";
import {
  listedPlugins,
  marketplaceDir,
  pinnedDirs,
  readPins,
  storeDir,
  treeHash,
  writePins,
  type Pin,
  type Pins,
} from "./core/process/pins.js";
import { refText, type PluginRef } from "./core/process/plugins.js";
import { readProcess } from "./core/process/read.js";
import { plainName } from "./core/spec.js";
import { checkProblems } from "./settings-cli.js";

export type PinIo = {
  readonly env: NodeJS.ProcessEnv;
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
  readonly home: string;
};

function fail(io: PinIo, reason: string): number {
  io.err(`agent-factory plugin update: ${reason}\n`);
  return 1;
}

function pinLine(pin: Pin | undefined): string {
  return pin === undefined
    ? "not pinned"
    : `${pin.commit.slice(0, 12)} ${pin.version || "(no version)"} sha256:${pin.sha256.slice(0, 12)}`;
}

// listedRef : the plugin, when the project's resolved settings list it
async function listedRef(io: PinIo, project: string, word: string): Promise<Result<PluginRef>> {
  if (!plainName(project)) {
    return { kind: "failed", reason: `${JSON.stringify(project)} is not a plain project name` };
  }
  const refs = await listedPlugins({ home: io.home, project, env: io.env });
  const ref = refs.kind === "ok" ? refs.value.find((r) => refText(r) === word) : undefined;
  if (refs.kind === "failed") {
    return refs;
  }
  return ref === undefined
    ? { kind: "failed", reason: `the project ${project} does not list ${JSON.stringify(word)} in "plugins"` }
    : { kind: "ok", value: ref };
}

async function fetched(io: PinIo, ref: PluginRef, given: string | undefined): Promise<Result<Fetched>> {
  const market = marketplaceDir(io.home, ref.marketplace);
  if (
    !(await access(market).then(
      () => true,
      () => false,
    ))
  ) {
    return { kind: "failed", reason: `no marketplace clone at ${market}: git clone the marketplace there first` };
  }
  const commit = await targetCommit(io.env, market, given);
  return commit.kind === "ok" ? fetchPlugin({ home: io.home, env: io.env, ref, commit: commit.value }) : commit;
}

// changedSince : the files a new version adds, removes and changes against the pinned one
async function changedSince(io: PinIo, ref: PluginRef, before: Pin, after: Fetched): Promise<readonly string[]> {
  const old = await treeHash(storeDir(io.home, ref, before.sha256));
  return changedFiles(old.kind === "ok" ? old.value.files : [], after.files);
}

// showChange : the pin before and after, and the files the new version adds (+), removes (-) and changes (~); a first
// pin shows a count per folder instead of every file (#482)
async function showChange(io: PinIo, ref: PluginRef, before: Pin | undefined, after: Fetched): Promise<void> {
  const lines = before === undefined ? folderCounts(after.files) : await changedSince(io, ref, before, after);
  io.out(`${refText(ref)}: ${pinLine(before)} -> ${pinLine(after)}\n`);
  io.out(lines.length === 0 ? "no file changes\n" : lines.map((l) => `${l}\n`).join(""));
}

// checked : config check and the process read, with the new pins; every reason it fails
async function checked(io: PinIo, project: string, pins: Pins): Promise<readonly string[]> {
  const problems = await checkProblems(io, project);
  const refs = await listedPlugins({ home: io.home, project, env: io.env });
  const proc = await readProcess(pinnedDirs(io.home, refs.kind === "ok" ? refs.value : [], pins));
  return [
    ...(problems.kind === "ok"
      ? problems.value.filter((p) => p.level === "error").map((p) => p.text)
      : [problems.reason]),
    ...(proc.kind === "failed" ? [proc.reason] : []),
  ];
}

async function moved(io: PinIo, project: string, ref: PluginRef, f: Fetched): Promise<number> {
  const pins = await readPins(io.home, project);
  if (pins.kind === "failed") {
    return fail(io, pins.reason);
  }
  const before = pins.value[refText(ref)];
  if (before?.sha256 === f.sha256 && before.commit === f.commit) {
    io.out(`${refText(ref)} is already pinned at ${pinLine(before)}\n`);
    return 0;
  }
  return checkedMove(io, { project, ref, pins: pins.value, before, f });
}

type Move = {
  readonly project: string;
  readonly ref: PluginRef;
  readonly pins: Pins;
  readonly before: Pin | undefined;
  readonly f: Fetched;
};

async function checkedMove(io: PinIo, { project, ref, pins, before, f }: Move): Promise<number> {
  await showChange(io, ref, before, f);
  const next: Pins = { ...pins, [refText(ref)]: { commit: f.commit, version: f.version, sha256: f.sha256 } };
  const errors = await checked(io, project, next);
  if (errors.length > 0) {
    io.err(errors.map((e) => `error: ${e}\n`).join(""));
    return fail(io, `the check failed; the pin stays at ${pinLine(before)}`);
  }
  const written = await writePins(io.home, project, next);
  return written.kind === "ok"
    ? (io.out(`pinned ${refText(ref)} at ${pinLine(next[refText(ref)])}; the next ticket uses it\n`), 0)
    : fail(io, written.reason);
}

// pinUpdate : plugin update <project> <name@marketplace> [<commit>]
export async function pinUpdate(io: PinIo, project: string, word: string, commit: string | undefined): Promise<number> {
  const ref = await listedRef(io, project, word);
  const got = ref.kind === "ok" ? await fetched(io, ref.value, commit) : ref;
  if (got.kind === "failed" || ref.kind === "failed") {
    return fail(io, got.kind === "failed" ? got.reason : "");
  }
  return moved(io, project, ref.value, got.value);
}
