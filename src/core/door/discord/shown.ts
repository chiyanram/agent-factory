// door/discord/shown — what /approve shows a person: the spec's text, its ## Design included, the lane and the full
// hash, computed from the very text shown, as `approve` computes it (approval.ts currentSpec). The hash a Confirm binds
// is therefore the hash of what the person was shown; an edit after that makes `approve` refuse.
// A text the scrub would change is refused, since the person would approve a hash of words they did not see.

import { join } from "node:path";
import type { Where } from "../../approval.js";
import { checkSpec, readSpec, type Refused, type Spec, type SpecStore } from "../../spec.js";

export type Shown = {
  readonly spec: string;
  readonly specText: string;
  readonly lane: string;
  readonly title: string;
};

const no = (reason: string): Refused => ({ kind: "refused", reason });

function storeOf(where: Where): SpecStore {
  return where.store ?? { kind: "local", root: join(where.home, "specs") };
}

async function specOf(where: Where): Promise<{ readonly text: string; readonly spec: Spec } | Refused> {
  const read = await readSpec({ store: storeOf(where), project: where.project, ticket: where.ticket });
  if (read.kind !== "found") {
    return read.kind === "missing" ? no(`there is no spec for ${where.project}/${where.ticket}`) : read;
  }
  const checked = checkSpec(read.text);
  return checked.kind === "ok"
    ? { text: read.text, spec: checked.spec }
    : no(`the spec is not ready: ${checked.problems.join("; ")}`);
}

export async function shown(where: Where, scrub: (text: string) => string): Promise<Shown | Refused> {
  const read = await specOf(where);
  if ("kind" in read) {
    return read;
  }
  return scrub(read.text) === read.text
    ? { spec: read.spec.hash, specText: read.text, lane: read.spec.lane, title: read.spec.title }
    : no("the spec holds text shaped like a secret, which Discord would show hidden: approve at the terminal");
}
