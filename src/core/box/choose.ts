// choose — the box decisions, all pure (#112): which place FACTORY_BOX names, the known risks of that place, whether an
// image is pinned, and whether a run may start. openBox (index.ts) is the one place that asks a Box anything: the probe.
//
// There is no default place. An unset FACTORY_BOX is refused, so setup (#136) must ask, and a run never starts in a
// place nobody chose.

import type { Box, BoxPlace, PinnedImage, Probe } from "./types.js";

export type BoxChoice =
  | { readonly kind: "chosen"; readonly place: BoxPlace; readonly risks: readonly string[] }
  | { readonly kind: "refused"; readonly reason: string };

type Place = { readonly value: string; readonly choice: BoxChoice };

// The risks a person accepts by choosing the place. Setup prints them before the first run (#112).
const VM_RISKS: readonly string[] = [
  "the box runs its own Docker daemon, so the container is privileged: an escape from it reaches the VM as the box user",
  "a host on the egress allowlist (the model API, the package and image registries) can still carry data out",
  "the box holds the model-only token: a tricked writer can spend model budget with it until the token is revoked",
];

const PLACES: readonly Place[] = [
  { value: "vm", choice: { kind: "chosen", place: "vm", risks: VM_RISKS } },
  { value: "laptop", choice: { kind: "refused", reason: "FACTORY_BOX=laptop is stage B (#129); use vm" } },
];

export function chooseBox(env: NodeJS.ProcessEnv): BoxChoice {
  const set = env.FACTORY_BOX;
  if (set === undefined || set.trim() === "") {
    return { kind: "refused", reason: "FACTORY_BOX is not set; set it to vm" };
  }
  const place = PLACES.find((p) => p.value === set);
  return place === undefined ? { kind: "refused", reason: `FACTORY_BOX=${JSON.stringify(set)} is not a box; use vm` } : place.choice;
}

export type Pin = PinnedImage | { readonly kind: "refused"; readonly reason: string };

const DIGEST = /^[^\s@]+@sha256:[0-9a-f]{64}$/;

// pinImage : an image named by its sha256 digest; a tag alone can change under the factory, so it is refused (S7)
export function pinImage(ref: string): Pin {
  return DIGEST.test(ref) ? { kind: "pinned", ref } : { kind: "refused", reason: `image ${JSON.stringify(ref)} is not pinned by digest (name@sha256:<64 hex>)` };
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
