// eval-cli — `agent-factory eval reviewer` on the command line (ADR-0015 E7, #215), and the route to `eval pin`
// (eval-pin-cli.ts): the eval pass of the automated
// review over the golden set, on the host, through the same agent CLI as the production review. It spends on model
// runs, so it never runs in CI or in a dry run, and it is refused before it spends when it could pass the $100 cap.
// Its clones go in a fresh private folder under the factory home, never /tmp, where anyone could plant a CLAUDE.md
// above a run folder.

import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { AIMS, type Aim } from "./core/eval/bar.js";
import { evalReviewer, evalSettings, type EvalInput, type EvalSettings, type Written } from "./core/eval/harness.js";
import { openAgentCli } from "./core/agent/index.js";
import { settingOf } from "./core/settings/machine.js";
import { refusal, workDir, type EvalIo } from "./eval-host.js";
import { EVAL_PIN_HELP, evalPinCommand } from "./eval-pin-cli.js";

export type { EvalIo } from "./eval-host.js";

const REVIEWER_HELP = `  eval reviewer [<repo>] [--drafts] [--aim quality|cost]
                               the automated review's eval (ADR-0015): each case the operator approved in
                               evals/reviewer/cases.md, 3 runs of the real review round on a throwaway clone, Act on
                               findings matched with the seeds by place and judge; writes
                               evals/reviewer/results/<date>-<sha>.json. <repo> is this repository's checkout (default
                               .). --drafts runs draft cases too (never proof). It stops before it spends over $100 and
                               marks that result partial, never proof. --aim says what the change it proves aims
                               at, as the proof check needs (ADR-0021): quality, recall above the baseline's plus
                               the noise; cost, a cheaper pass. Leave it out for a baseline. Host
                               only: refused in CI. A human runs it; the coordinator's settings deny it. Exit 0 written, 3 written but partial, 1 refused
`;

type Parsed = {
  readonly root: string;
  readonly drafts: boolean;
  readonly aim: Aim | "none";
};

function parsed(argv: readonly string[]): Parsed | "usage" {
  try {
    const { values, positionals } = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: { drafts: { type: "boolean" }, aim: { type: "string" } },
    });
    const aim = aimOf(values.aim);
    return aim === "bad" ? "usage" : reviewerOf(positionals, values.drafts === true, aim);
  } catch {
    return "usage";
  }
}

function reviewerOf(positionals: readonly string[], drafts: boolean, aim: Aim | "none"): Parsed | "usage" {
  const [what, root = ".", ...rest] = positionals;
  return what === "reviewer" && rest.length === 0 ? { root: resolve(root), drafts, aim } : "usage";
}

function aimOf(value: string | undefined): Aim | "none" | "bad" {
  return value === undefined ? "none" : (AIMS.find((a) => a === value) ?? "bad");
}

async function run(p: Parsed, s: EvalSettings, io: EvalIo): Promise<number> {
  const work = await workDir(io.env);
  if (work.kind === "failed") {
    io.err(`agent-factory eval: ${work.reason}\n`);
    return 1;
  }
  const written = await evalReviewer(inputOf(p, s, io, work.value));
  if (written.kind === "failed") {
    io.err(`agent-factory eval: ${written.reason}\n`);
    return 1;
  }
  io.out(`${written.value.path}${note(written.value)}\n`);
  return written.value.partial ? 3 : 0;
}

function inputOf(p: Parsed, s: EvalSettings, io: EvalIo, work: string): EvalInput {
  return {
    root: p.root,
    env: io.env,
    work,
    rulebook: settingOf(io.env, "rulebook") ?? "",
    model: openAgentCli({ env: io.env }).readOnly,
    settings: s,
    now: new Date(),
    log: (line) => io.err(`${line}\n`),
  };
}

function note(w: Written): string {
  if (w.partial) {
    return " (partial: never proof)";
  }
  return w.proof ? "" : " (draft cases: not proof)";
}

export const EVAL_HELP = `${REVIEWER_HELP}${EVAL_PIN_HELP}`;

export function evalCommand(argv: readonly string[], io: EvalIo): Promise<number> {
  return argv[0] === "pin" ? evalPinCommand(argv.slice(1), io) : reviewerCommand(argv, io);
}

async function reviewerCommand(argv: readonly string[], io: EvalIo): Promise<number> {
  const p = parsed(argv);
  if (p === "usage") {
    io.err(`usage: agent-factory eval reviewer [<repo>] [--drafts] [--aim quality|cost]\n`);
    return 64;
  }
  const refused = refusal(io.env);
  if (refused !== "") {
    io.err(`agent-factory eval: ${refused}\n`);
    return 1;
  }
  const settings = evalSettings(io.env, { drafts: p.drafts, aim: p.aim });
  if (settings.kind === "failed") {
    io.err(`agent-factory eval: ${settings.reason}\n`);
    return 1;
  }
  return run(p, settings.value, io);
}
