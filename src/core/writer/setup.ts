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
import { openAgentCli } from "../agent/index.js";
import type { LaneProps } from "../lane.js";
import type { PushTarget, WriterSetup } from "./step.js";
import type { PluginDir } from "../process/read.js";
import { settingOf } from "../settings/machine.js";
import { issuesFrom, specStoreOf } from "../spec-store.js";

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
  readonly plugins: readonly PluginDir[];
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

type Placed = {
  readonly box: BoxSetup;
  readonly store: TokenStore;
  readonly push: PushTarget;
  readonly programs: readonly string[];
  readonly testFiles: readonly string[];
};

function placed(input: WriterInput): Result<Placed> {
  if (input.plan.kind === "unavailable") {
    return { kind: "failed", reason: input.plan.reason };
  }
  if (input.store.kind === "failed") {
    return input.store;
  }
  const push = pushTarget(input);
  return push.kind === "ok"
    ? {
        kind: "ok",
        value: {
          box: input.plan.setup,
          store: input.store.value,
          push: push.value,
          programs: input.plan.project.ready.programs,
          testFiles: input.plan.project.ready.testFiles,
        },
      }
    : push;
}

export function writerSetup(input: WriterInput): Promise<Result<WriterSetup>> {
  const where = placed(input);
  if (where.kind === "failed") {
    return Promise.resolve(where);
  }
  const settings = writerSettings(input.env, input.plugins);
  if (settings.kind === "failed") {
    return Promise.resolve(settings);
  }
  const specs = specStoreOf({ env: input.env, home: input.home, open: issuesFrom(input.forge) });
  if (specs.kind === "failed") {
    return Promise.resolve(specs);
  }
  const { box, store, push, programs, testFiles } = where.value;
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
      programs,
      testFiles,
      agent: openAgentCli({ env: input.env }).writer,
      lanes: input.lanes,
      specs: specs.value,
    },
  });
}
