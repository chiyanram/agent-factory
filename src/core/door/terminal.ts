// door/terminal — the terminal's front door (ADR-0023): the person at the terminal is the OS user and, when set, their
// own git user.name. A record, not proof: on the VM only the `factory` OS user can write the records, and on a laptop
// the human merge review stays the hard gate (ADR-0012 S1).

import { userInfo } from "node:os";
import { hostGit } from "../git.js";
import type { Refused } from "../spec.js";
import type { Approve } from "../approval.js";
import type { Start } from "../start.js";
import type { Waive } from "../waiver.js";
import { vouch, type Door, type Person } from "./person.js";
import { approveAs, startAs, waiveAs, type ApproveAs, type StartAs, type WaiveAs } from "./write.js";

// whoApproves : the OS user and, when set, the operator's own git user.name
export async function whoApproves(env: NodeJS.ProcessEnv): Promise<string> {
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

// asTerminal : the write as the person at the terminal, or the door's refusal when its check names no one
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
