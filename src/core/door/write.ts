// door/write — the one way a front door writes a person's word (ADR-0023 D2, D3; ADR-0012 S1): START, approve and
// waive, each with `by` and `via` taken from the person a door vouched for (person.ts), never from the request. Each
// refuses, and writes nothing, when no door vouched for the person, or when it runs inside a model run. That second
// check reads the environment, which a model can change, so it backs up the walls and is not one: the coordinator's
// deny list and, on the VM, the `factory` OS user are. **Today:** the coordinator does not start through the agent
// adapter (#691), so for it only CLAUDECODE marks the run.

import { MODEL_RUN_MARK } from "../agent/mark.js";
import { approve, type Approve, type ApproveRequest } from "../approval.js";
import { start, type Start, type StartRequest } from "../start.js";
import type { Refused } from "../spec.js";
import { waive, type Waive, type WaiveRequest } from "../waiver.js";
import { isVouched, type Person } from "./person.js";

// what marks a model run: Claude Code sets CLAUDECODE for every command it runs, and the agent adapter
// (agent/claude.ts, agent/copilot.ts, agent/claude-writer.ts) sets AGENT_FACTORY_MODEL_RUN for every run it starts
export const MODEL_RUN_MARKERS = ["CLAUDECODE", ...Object.keys(MODEL_RUN_MARK)] as const;

export type StartAs = Omit<StartRequest, "by" | "via">;
export type ApproveAs = Omit<ApproveRequest, "by" | "via">;
export type WaiveAs = Omit<WaiveRequest, "by" | "via">;

// refusal : why this person's word cannot be written here, or undefined when it can
function refusal(person: Person, env: NodeJS.ProcessEnv): Refused | undefined {
  if (!isVouched(person)) {
    return { kind: "refused", reason: "no front door verified this person: a door's own check must vouch for them" };
  }
  const marker = MODEL_RUN_MARKERS.find((name) => (env[name] ?? "") !== "");
  return marker === undefined
    ? undefined
    : {
        kind: "refused",
        reason: `a model run never writes a person's word (${marker} is set); run it from a plain terminal`,
      };
}

// signed : the person's by and via, over any the request carried
function signed(person: Person): { readonly by: string; readonly via: Person["via"] } {
  return { by: person.by, via: person.via };
}

export async function startAs(person: Person, request: StartAs, env: NodeJS.ProcessEnv): Promise<Start> {
  return refusal(person, env) ?? start({ ...request, ...signed(person) });
}

export async function approveAs(person: Person, request: ApproveAs, env: NodeJS.ProcessEnv): Promise<Approve> {
  return refusal(person, env) ?? approve({ ...request, ...signed(person) });
}

export async function waiveAs(person: Person, request: WaiveAs, env: NodeJS.ProcessEnv): Promise<Waive> {
  return refusal(person, env) ?? waive({ ...request, ...signed(person) });
}
