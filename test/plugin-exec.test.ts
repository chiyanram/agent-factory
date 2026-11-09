import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmodSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_LIMITS, runPlugin } from "../src/core/plugin/exec.js";
import { tempDir } from "./temp.js";

let root = "";
beforeEach(() => {
  root = tempDir("factory-plugin-exec-");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

// a plugin that writes `parts` (each a list of byte values) to `stream`, one write per part, a pause between them, so
// each part reaches runPlugin as a chunk of its own
function splitWriter(stream: "stdout" | "stderr", parts: readonly (readonly number[])[]): string {
  const path = join(root, `plugin-${stream}`);
  writeFileSync(
    path,
    `#!${process.execPath}
const parts = ${JSON.stringify(parts)};
const next = (i) => {
  if (i === parts.length) return;
  process.${stream}.write(Buffer.from(parts[i]), () => setTimeout(() => next(i + 1), 50));
};
next(0);
`,
  );
  chmodSync(path, 0o755);
  return path;
}

const bytes = (text: string): number[] => [...Buffer.from(text, "utf8")];

// "€" is three bytes in UTF-8 (e2 82 ac); the cut falls after its first byte
const EURO = bytes('{"text":"5 €"}');
const CUT = EURO.indexOf(0xe2) + 1;

describe("runPlugin", () => {
  it.each(["stdout", "stderr"] as const)(
    "keeps a UTF-8 character whole when %s splits it across two writes",
    async (stream) => {
      const path = splitWriter(stream, [EURO.slice(0, CUT), EURO.slice(CUT)]);
      const ran = await runPlugin({ path, args: [], stdin: "", env: process.env, limits: DEFAULT_LIMITS });
      expect(ran).toMatchObject({ kind: "exited", code: 0, [stream]: '{"text":"5 €"}' });
    },
  );

  it("ends a stream cut inside a character with one U+FFFD, not a lost byte", async () => {
    const path = splitWriter("stdout", [bytes("ok "), [0xe2, 0x82]]);
    const ran = await runPlugin({ path, args: [], stdin: "", env: process.env, limits: DEFAULT_LIMITS });
    expect(ran).toMatchObject({ kind: "exited", code: 0, stdout: "ok �" });
  });
});
