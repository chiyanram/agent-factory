// notify — the orchestrator's pings to a person (#119; ADR-0014 P5). One rule says when (turn-ping.ts): a pass
// pings when a ticket enters a person's turn, needs you or ready to merge, as whoseTurn reads it, and not again until the
// ticket has left that turn: a hand-over to needs-human, a writer's question, a manual CI job, a person's push, a spec
// changed after approval, a change ready to merge. A build held by its blockers (held) and the project at a cap (paused)
// only inform, so they keep their own checks. Each goes through the notify plugin the project file maps (the bundled
// discord plugin). This is the orchestrator's own channel, like forge.write: the coordinator's request policy does not
// cap it.
//
// A ping only informs. A failure never stops the pass or the ticket: the pass prints why, the forge note is still the
// record, and the ping is not tried again. A reply in Discord is never an approval. The text is a post.ts template, so
// no @everyone, mention, reference or link forms; the plugin switches every mention off as well.

import { realpath } from "node:fs/promises";
import type { Done, Result } from "./forge/api.js";
import { pluginConfigOf } from "./plugin/config.js";
import { callPlugin, type Secrets, type Setup } from "./plugin/registry.js";
import { renderPost, type Post } from "./post.js";
import { readProjectRaw } from "./project.js";
import type { TokenStore } from "./token/store.js";

export type Ping =
  // next: the person's step (next-step.ts)
  | {
      readonly kind: "needs-you";
      readonly ticket: string;
      readonly change: number | "none";
      readonly why: string;
      readonly next: string;
    }
  | { readonly kind: "ready"; readonly ticket: string; readonly change: number | "none"; readonly head: string }
  // the project is at a day cap or its window share (#131): no new run starts; ticket is the first one held
  | { readonly kind: "paused"; readonly ticket: string; readonly change: number | "none"; readonly why: string }
  // the ticket's build waits on the tickets its spec is blocked by (#494); it only informs
  | { readonly kind: "held"; readonly ticket: string; readonly change: number | "none"; readonly why: string };

export type Notify = (ping: Ping) => Promise<Done>;

// NO_NOTIFY : a project that maps no notify plugin pings no one; the forge notes stay the record
export const NO_NOTIFY: Notify = () => Promise.resolve({ kind: "ok" });

type Where = { readonly project: string; readonly mark: string };

function changeOf(where: Where, change: number | "none"): string {
  return change === "none" ? "no change yet" : `${where.mark}${change}`;
}

const TITLES: { readonly [K in Ping["kind"]]: (p: Extract<Ping, { kind: K }>) => string } = {
  "needs-you": (p) => `${p.ticket} needs you: ${p.why}`,
  ready: (p) => `${p.ticket} is ready for you to review and merge at ${p.head.slice(0, 8)}`,
  paused: (p) => `no new runs: ${p.why}`,
  held: (p) => `${p.ticket} waits: ${p.why}`,
};

function titleAs<K extends Ping["kind"]>(kind: K, ping: Extract<Ping, { kind: K }>): string {
  return TITLES[kind](ping);
}

// pingPost : what a person reads, as a posting template. Pure.
export function pingPost(where: Where, ping: Ping): Post {
  return {
    seat: "coordinator",
    title: titleAs(ping.kind, ping),
    fields: [
      { label: "project", value: where.project },
      { label: "change", value: changeOf(where, ping.change) },
      ...(ping.kind === "needs-you" ? [{ label: "next", value: ping.next }] : []),
    ],
    items: [],
  };
}

export type NotifyTarget = {
  readonly setup: Setup;
  readonly plugin: string;
  readonly project: string;
  readonly mark: string;
};

// pluginNotify : the pings through one notify plugin; the plugin answers { kind: "done" } when it went out
export function pluginNotify(target: NotifyTarget): Notify {
  return async (ping) => {
    const text = renderPost(pingPost(target, ping));
    if (text.kind === "refused") {
      return { kind: "failed", reason: text.reason };
    }
    const sent = await callPlugin(target.setup, {
      plugin: target.plugin,
      capability: "notify",
      op: "send",
      input: { text: text.text },
    });
    return sentDone(target.plugin, sent);
  };
}

function sentDone(plugin: string, sent: Awaited<ReturnType<typeof callPlugin>>): Done {
  if (sent.kind === "failed") {
    return sent;
  }
  const why = typeof sent.value.fields.reason === "string" ? `: ${sent.value.fields.reason}` : "";
  return sent.value.kind === "done"
    ? { kind: "ok" }
    : { kind: "failed", reason: `${plugin} answered ${sent.value.kind}${why}` };
}

// dryNotify : FACTORY_DRY_RUN=1: each ping printed instead of sent
export function dryNotify(log: (line: string) => void): Notify {
  return (ping) => {
    log(`DRY RUN: notify: ${titleAs(ping.kind, ping)}`);
    return Promise.resolve({ kind: "ok" });
  };
}

// notifyPluginOf : the notify plugin the project file maps, or "" when it maps none or there is no file; a file that is
// there but does not read is refused
export async function notifyPluginOf(files: {
  readonly home: string;
  readonly project: string;
}): Promise<Result<string>> {
  const raw = await readProjectRaw(files, "");
  if (raw.kind !== "ok") {
    return raw.kind === "missing" ? { kind: "ok", value: "" } : raw;
  }
  const config = pluginConfigOf(raw.path, raw.value);
  return config.kind === "ok" ? { kind: "ok", value: config.value.plugins.get("notify") ?? "" } : config;
}

// webhookSecrets : the Discord webhook, from the token store, for a notify call of the bundled discord plugin only:
// the file the registry added must be the package's own plugins/discord/plugin, so no other plugin that calls itself
// discord is ever handed it; any other plugin or capability gets no secret
export function webhookSecrets(store: Result<TokenStore>, bundled: string): Secrets {
  return async (call) => {
    if (call.capability !== "notify" || !(await sameFile(call.source, bundled))) {
      return { kind: "ok", value: {} };
    }
    const stored = store.kind === "ok" ? await store.value.get("discord") : store;
    return stored.kind === "found"
      ? { kind: "ok", value: { webhook: stored.token } }
      : { kind: "failed", reason: `no Discord webhook: ${stored.reason}` };
  };
}

async function sameFile(source: string, bundled: string): Promise<boolean> {
  const real = await realpath(bundled).catch(() => "");
  return real !== "" && real === source;
}
