// onboard-cli — agent-factory onboard (#235): the onboarder's run, and a human's acceptance of what it staged. Both are
// a human's to run: the coordinator's settings deny them (coordinator.ts HUMAN_ONLY).

import type { Result } from "./core/forge/api.js";
import { accept } from "./core/onboard/home.js";
import { onboard, type OnboardSetup } from "./core/onboard/run.js";
import { plainName } from "./core/spec.js";

export const ONBOARD_HELP = `  onboard <project>            run the onboarder once: it reads the product repo at the default branch, read-only,
                               and stages brief.md and glossary.md in <home>/projects/<project>/staged for a human;
                               prints their hashes. A human runs it; the coordinator's settings deny it
  onboard accept <project> <brief hash> <glossary hash>
                               accept the staged brief and glossary with exactly those hashes: every run reads them
                               from then on. A human runs it; the coordinator's settings deny it
`;

export type OnboardIo = {
  readonly home: string;
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
  // the run's setup, once the project is known
  readonly setup: (project: string) => Promise<Result<OnboardSetup>>;
  readonly by: () => Promise<string>;
  readonly now: () => number;
};

const HASH = /^[0-9a-f]{64}$/;

async function run(project: string, io: OnboardIo): Promise<number> {
  const setup = await io.setup(project);
  const done = setup.kind === "ok" ? await onboard(setup.value) : setup;
  if (done.kind === "failed") {
    io.err(`agent-factory onboard: ${done.reason}\n`);
    return 1;
  }
  const { hashes, spend } = done.value;
  io.out(`staged in ${io.home}/projects/${project}/staged ($${spend.usd.toFixed(2)}, ${spend.tokens} tokens)\n`);
  io.out(`brief ${hashes.brief}\nglossary ${hashes.glossary}\n`);
  io.out(`read both, then accept them: agent-factory onboard accept ${project} ${hashes.brief} ${hashes.glossary}\n`);
  return 0;
}

async function accepted(project: string, brief: string, glossary: string, io: OnboardIo): Promise<number> {
  const done = await accept({
    home: io.home,
    project,
    seen: { brief, glossary },
    by: await io.by(),
    at: new Date(io.now()).toISOString(),
  });
  if (done.kind === "failed") {
    io.err(`agent-factory onboard accept: ${done.reason}\n`);
    return 1;
  }
  io.out(`accepted: every run of ${project} reads ${done.value}/brief.md and glossary.md\n`);
  return 0;
}

// acceptArgs : the project and both hashes of `accept <project> <brief hash> <glossary hash>`, or "bad"
function acceptArgs(positionals: readonly string[]): readonly [string, string, string] | "bad" {
  const at = (i: number): string => positionals[i] ?? "";
  const shape = positionals.length === 4 && at(0) === "accept" && plainName(at(1));
  return shape && [at(2), at(3)].every((h) => HASH.test(h)) ? [at(1), at(2), at(3)] : "bad";
}

// runArgs : the project of `onboard <project>`, or "" when the words are not that
function runArgs(positionals: readonly string[]): string {
  const project = positionals[0] ?? "";
  return positionals.length === 1 && project !== "accept" && plainName(project) ? project : "";
}

// onboardCommand : onboard <project>, or onboard accept <project> <brief hash> <glossary hash>
export function onboardCommand(positionals: readonly string[], io: OnboardIo): Promise<number> {
  const acceptance = acceptArgs(positionals);
  if (acceptance !== "bad") {
    return accepted(...acceptance, io);
  }
  const project = runArgs(positionals);
  if (project !== "") {
    return run(project, io);
  }
  io.err("usage: agent-factory onboard <project> | onboard accept <project> <brief hash> <glossary hash>\n");
  return Promise.resolve(64);
}
