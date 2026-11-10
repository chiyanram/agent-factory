// choose — the box decisions, all pure (#112): which place FACTORY_BOX names, the known risks of that place, whether an
// image is pinned, and whether a run may start. openBox (index.ts) is the one place that asks a Box anything: the probe.
//
// There is no default place. An unset FACTORY_BOX is refused, so setup (#136) must ask, and a run never starts in a
// place nobody chose. The key is a ladder, none < srt < vm (#114): a team that sets vm keeps a user from srt, and none,
// which a layer may set to say "no runner here", starts no run at all: no run ever runs bare.

import type { Box, BoxPlace, PinnedImage, Probe } from "./types.js";
import { settingName, settingOf } from "../settings/machine.js";

export type BoxChoice =
  | { readonly kind: "chosen"; readonly place: BoxPlace; readonly risks: readonly string[] }
  | { readonly kind: "refused"; readonly reason: string };

type Place = { readonly value: string; readonly choice: BoxChoice };

// The risks a person accepts by choosing the place. Setup prints them before the first run (#112).
const VM_RISKS: readonly string[] = [
  "the box runs its own Docker engine under Sysbox: an escape from it reaches the VM as an unprivileged user, and a Sysbox flaw could widen that",
  "a host on the egress allowlist (the model API, the package and image registries) can still carry data out",
  "the box holds the model-only token: a tricked writer can spend model budget with it until the token is revoked",
];

// The srt runner's risks (#114): the sandbox is the host's own kernel and the agent runs as the person.
const SRT_RISKS: readonly string[] = [
  "the runner is an OS sandbox (sandbox-exec on macOS, bubblewrap on Linux) around a process that runs as you: a flaw in it, or in the kernel, reaches your whole account",
  "your home is hidden but for the run's clone, the agent CLI's and Node's install folders, and the toolchain folders listed below, which it reads: a secret kept inside one of those folders can be read by the run",
  "a host on the egress allowlist (the model API, the package registries) can still carry data out",
  "the runner holds the model-only token: a tricked writer can spend model budget with it until the token is revoked",
  "there is no Docker in the runner: tests that need containers fail there and run on git host CI",
];

const name = settingName("runner");

const PLACES: readonly Place[] = [
  { value: "vm", choice: { kind: "chosen", place: "vm", risks: VM_RISKS } },
  { value: "srt", choice: { kind: "chosen", place: "srt", risks: SRT_RISKS } },
  { value: "none", choice: { kind: "refused", reason: `${name}=none starts no run; set it to srt or vm` } },
  { value: "laptop", choice: { kind: "refused", reason: `${name}=laptop is replaced by srt (#114); use srt or vm` } },
];

export function chooseBox(env: NodeJS.ProcessEnv): BoxChoice {
  const set = settingOf(env, "runner");
  if (set === undefined || set.trim() === "") {
    return { kind: "refused", reason: `${name} is not set; set it to srt or vm` };
  }
  const place = PLACES.find((p) => p.value === set);
  return place === undefined
    ? { kind: "refused", reason: `${name}=${JSON.stringify(set)} is not a runner kind; use srt or vm` }
    : place.choice;
}

export type Pin = PinnedImage | { readonly kind: "refused"; readonly reason: string };

// name@sha256:<digest> from a registry, or sha256:<id> of an image built on this host (agent-factory box build)
const DIGEST = /^([^\s@]+@)?sha256:[0-9a-f]{64}$/;

// pinImage : an image named by its sha256 digest or local image ID; a tag alone can change under the factory, so it
// is refused (S7)
export function pinImage(ref: string): Pin {
  return DIGEST.test(ref)
    ? { kind: "pinned", ref }
    : {
        kind: "refused",
        reason: `image ${JSON.stringify(ref)} is not pinned (name@sha256:<64 hex>, or sha256:<64 hex> from box build)`,
      };
}

export type Opened =
  | { readonly kind: "ready"; readonly box: Box; readonly risks: readonly string[] }
  | { readonly kind: "refused"; readonly reason: string };

// the place's Box and its probe answer, or none when that place has no Box yet
export type Found = { readonly kind: "found"; readonly box: Box; readonly probe: Probe } | { readonly kind: "none" };

// startGate : a run may start only in a chosen place whose box answers the probe (S7: refuse to start when the box is
// missing).

export function startGate(input: { readonly choice: BoxChoice; readonly found: Found }): Opened {
  const { choice, found } = input;
  if (choice.kind === "refused") {
    return choice;
  }
  if (found.kind === "none") {
    return { kind: "refused", reason: `the ${choice.place} box is not built yet (#113)` };
  }
  return found.probe.kind === "ready"
    ? { kind: "ready", box: found.box, risks: choice.risks }
    : { kind: "refused", reason: `the ${choice.place} box is not working: ${found.probe.reason}` };
}
