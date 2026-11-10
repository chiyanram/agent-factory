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
import type { LaneProps } from "../lane.js";
import type { PushTarget, WriterSetup } from "./step.js";
import type { PluginDir } from "../process/read.js";
import { settingOf } from "../settings/machine.js";

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
  // the plugins, in order (process/use.ts)
  readonly plugins: readonly PluginDir[];
  // the project's lanes, from its process (#232)
  readonly lanes: readonly LaneProps[];
};

function pushTarget(input: WriterInput): Result<PushTarget> {
  const host = forgeHost(input.env, input.forge.name);
  const project = settingOf(input.env, "gitHostProject") ?? "";
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

// writerSetup : the writer step's setup; each run reads its role card when it starts (step.ts)
export function writerSetup(input: WriterInput): Promise<Result<WriterSetup>> {
  const where = placed(input);
  if (where.kind === "failed") {
    return Promise.resolve(where);
  }
  const settings = writerSettings(input.env, input.plugins);
  if (settings.kind === "failed") {
    return Promise.resolve(settings);
  }
  const { box, store, push } = where.value;
  return Promise.resolve({
    kind: "ok",
    value: {
      box,
      settings: settings.value,
      forge: input.forge,
      push,
      home: input.home,
      project: input.project,
      label: input.label,
      login: () => boxTokenFrom({ store, now: new Date() }),
      pusher: input.pusher,
      lanes: input.lanes,
    },
  });
}
