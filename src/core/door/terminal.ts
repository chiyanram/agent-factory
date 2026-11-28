// door/terminal — the terminal's front door (ADR-0023): the person at the terminal is the OS user and, when set, their
// own git user.name. A record, not proof: on the VM only the `factory` OS user can write the records, and on a laptop
// the human merge review stays the hard gate (ADR-0012 S1).

import { userInfo } from "node:os";
import { hostGit } from "../git.js";
import type { Refused } from "../spec.js";
import type { Approve } from "../approval.js";
import type { Accept } from "../onboard/home.js";
import type { Start } from "../start.js";
import type { Waive } from "../waiver.js";
import type { ReviewAgain } from "../review-again.js";
import { vouch, type Door, type Person } from "./person.js";
import {
  acceptAs,
  approveAs,
  reviewAgainAs,
  startAs,
  waiveAs,
  type AcceptAs,
  type ApproveAs,
  type ReviewAgainAs,
  type StartAs,
  type WaiveAs,
} from "./write.js";

async function whoApproves(env: NodeJS.ProcessEnv): Promise<string> {
  const name = await hostGit({
    args: ["config", "--get", "user.name"],
    repo: { kind: "none" },
    env,
    stdin: { kind: "none" },
  });
  const gitName = name.kind === "ok" ? name.stdout.trim() : "";
  return gitName.length > 0 ? `${userInfo().username} (${gitName})` : userInfo().username;
}

const VIA = "terminal";

export const terminalDoor: Door<NodeJS.ProcessEnv> = {
  via: VIA,
  verify: async (env) => vouch(VIA, await whoApproves(env)),
};

async function asTerminal<T>(env: NodeJS.ProcessEnv, write: (person: Person) => Promise<T>): Promise<T | Refused> {
  const person = await terminalDoor.verify(env);
  return person.kind === "refused" ? person : write(person);
}

export function startAtTerminal(env: NodeJS.ProcessEnv, request: StartAs): Promise<Start> {
  return asTerminal(env, (person) => startAs(person, request, env));
}

export function approveAtTerminal(env: NodeJS.ProcessEnv, request: ApproveAs): Promise<Approve> {
  return asTerminal(env, (person) => approveAs(person, request, env));
}

export function waiveAtTerminal(env: NodeJS.ProcessEnv, request: WaiveAs): Promise<Waive> {
  return asTerminal(env, (person) => waiveAs(person, request, env));
}

export function acceptAtTerminal(env: NodeJS.ProcessEnv, request: AcceptAs): Promise<Accept> {
  return asTerminal(env, (person) => acceptAs(person, request, env));
}

export function reviewAgainAtTerminal(env: NodeJS.ProcessEnv, request: ReviewAgainAs): Promise<ReviewAgain> {
  return asTerminal(env, (person) => reviewAgainAs(person, request, env));
}
