// streams — each review run's whole stream in an eval pass, kept after the pass deletes its clones, so a person can
// count which files each finder and verify run read (agentskills.io's check that a skill was used at all). One file a
// run, <dir>/<case>/run<N>-<seq>-<part>.jsonl, scrubbed of secrets before it is written. A stream that cannot be kept
// loses the stream, never the run: the run's answer is passed on unchanged.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RoundPart } from "../dispatch/spend.js";
import type { Model } from "../review/model.js";
import { scrubSecrets } from "../scrub.js";

function partName(part: RoundPart | undefined): string {
  if (part === undefined) {
    return "run";
  }
  return part.kind === "finder" ? `finder-${part.lens}` : "verify";
}

export function keepStreams(model: Model, dir: string, run: number): Model {
  let seq = 0;
  return async (call) => {
    const result = await model(call);
    seq += 1;
    const stream = result.kind === "ok" ? (result.value.stream ?? "") : "";
    if (stream !== "") {
      const name = `run${run}-${String(seq).padStart(2, "0")}-${partName(call.part).replace(/[^a-z0-9-]/gi, "-")}.jsonl`;
      await mkdir(dir, { recursive: true, mode: 0o700 })
        .then(() => writeFile(join(dir, name), scrubSecrets(stream), { mode: 0o600 }))
        .catch(() => undefined);
    }
    return result;
  };
}
