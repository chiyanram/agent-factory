// setup — the writer step's setup for one pass (#113), from the box plan, the forge and the settings. The first thing
// missing is the reason the step is unavailable, so the dispatcher says why the writer waits.

import { boxTokenFrom, type TokenStore } from "../token/index.js";
import { forgeHost } from "../forge/index.js";
import type { Result } from "../forge/api.js";
import type { Forge } from "../forge/types.js";
import type { Identity } from "../identity.js";
import type { Pusher } from "../finish.js";
import type { BoxSetup } from "../ready/boxrun.js";
import type { BoxPlan } from "../ready/steps.js";
import { writerSettings } from "./settings.js";
import { readPrompts, type PushTarget, type WriterSetup } from "./step.js";

export type WriterInput = {
  readonly env: NodeJS.ProcessEnv;
  readonly home: string;
  readonly project: string;
  readonly label: string;
  readonly plan: BoxPlan;
  readonly forge: Forge;
  readonly identity: Identity;
  readonly store: Result<TokenStore>;
  readonly pusher: Pusher;
};

function pushTarget(input: WriterInput): Result<PushTarget> {
  const host = forgeHost(input.env, input.forge.name);
  const project = input.env.FACTORY_PROJECT ?? "";
  if (project === "") {
    return { kind: "failed", reason: "FACTORY_PROJECT is not set" };
  }
  return host.kind === "ok"
    ? {
        kind: "ok",
        value: { forge: input.forge.name, host: host.value, project, identity: input.identity, env: input.env },
      }
    : host;
}

type Placed = { readonly box: BoxSetup; readonly store: TokenStore; readonly push: PushTarget };

// placed : the box, the token store and where to push, or the first one missing
function placed(input: WriterInput): Result<Placed> {
  if (input.plan.kind === "unavailable") {
    return { kind: "failed", reason: input.plan.reason };
  }
  if (input.store.kind === "failed") {
    return input.store;
  }
  const push = pushTarget(input);
  return push.kind === "ok"
    ? { kind: "ok", value: { box: input.plan.setup, store: input.store.value, push: push.value } }
    : push;
}

export async function writerSetup(input: WriterInput): Promise<Result<WriterSetup>> {
  const where = placed(input);
  if (where.kind === "failed") {
    return where;
  }
  const settings = await writerSettings(input.env);
  if (settings.kind === "failed") {
    return settings;
  }
  const prompts = await readPrompts();
  const { box, store, push } = where.value;
  return prompts.kind === "ok"
    ? {
        kind: "ok",
        value: {
          box,
          settings: settings.value,
          prompts: prompts.value,
          forge: input.forge,
          push,
          home: input.home,
          project: input.project,
          label: input.label,
          login: () => boxTokenFrom({ store, now: new Date() }),
          pusher: input.pusher,
        },
      }
    : prompts;
}
