// door/discord/shown — what /approve shows a person: the spec's and the design's texts, the lane and both full hashes,
// each hash computed from the very text shown, as `approve` computes it (approval.ts currentSpec). The hashes a Confirm
// binds are therefore the hashes of what the person was shown; an edit after that makes `approve` refuse.
// A text the scrub would change is refused, since the person would approve a hash of words they did not see.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Where } from "../../approval.js";
import {
  checkSpec,
  designPath,
  NO_DESIGN,
  readSpec,
  specHash,
  type Refused,
  type Spec,
  type SpecStore,
} from "../../spec.js";

export type Shown = {
  readonly spec: string;
  readonly specText: string;
  readonly lane: string;
  readonly title: string;
  readonly design: string;
  readonly designText: string | undefined;
};

const no = (reason: string): Refused => ({ kind: "refused", reason });

function storeOf(where: Where): SpecStore {
  return where.store ?? { kind: "local", root: join(where.home, "specs") };
}

async function designText(where: Where): Promise<string | undefined> {
  const store = storeOf(where);
  const path =
    store.kind === "local" ? designPath({ root: store.root, project: where.project, ticket: where.ticket }) : undefined;
  return path?.kind === "path" ? readFile(path.path, "utf8").catch(() => undefined) : undefined;
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
  const design = await designText(where);
  if ("kind" in read) {
    return read;
  }
  const texts = [read.text, design ?? ""];
  return texts.every((t) => scrub(t) === t)
    ? {
        spec: read.spec.hash,
        specText: read.text,
        lane: read.spec.lane,
        title: read.spec.title,
        design: design === undefined ? NO_DESIGN : specHash(design),
        designText: design,
      }
    : no(
        "the spec or its design holds text shaped like a secret, which Discord would show hidden: approve at the terminal",
      );
}
