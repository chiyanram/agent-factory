// The contract every Box keeps (#112), whatever its place. The fake box and the vm box (#113, on a fake docker) run it
// here; the laptop box (#129) runs the same suite, so a caller can never tell the places apart.

import { describe, expect, it } from "vitest";
import type { Box, BoxSpec, PinnedImage } from "../src/core/box/types.js";

const IMAGE: PinnedImage = { kind: "pinned", ref: `factory-box@sha256:${"a".repeat(64)}` };

export function boxContract(name: string, make: () => Box, spec: Partial<BoxSpec> = {}): void {
  const full: BoxSpec = {
    image: IMAGE,
    worktree: "/tmp/wt",
    readOnly: [],
    env: {},
    proxy: "http://proxy:3128",
    ...spec,
  };

  describe(`box contract: ${name}`, () => {
    it("runs a command in a started box and gives back its exit", async () => {
      const box = make();
      const started = await box.start(full);
      expect(started.kind).toBe("started");
      if (started.kind !== "started") return;
      const ran = await box.run({
        session: started.session,
        command: { argv: ["true"], stdin: { kind: "none" }, timeoutSeconds: 30 },
      });
      expect(ran).toMatchObject({ kind: "exited", code: 0 });
      await box.stop(started.session);
    });

    it("refuses a run in a stopped box", async () => {
      const box = make();
      const started = await box.start(full);
      if (started.kind !== "started") throw new Error("start failed");
      await box.stop(started.session);
      const ran = await box.run({
        session: started.session,
        command: { argv: ["true"], stdin: { kind: "none" }, timeoutSeconds: 30 },
      });
      expect(ran.kind).toBe("failed");
    });

    it("stops a box that is already gone", async () => {
      const box = make();
      const started = await box.start(full);
      if (started.kind !== "started") throw new Error("start failed");
      expect(await box.stop(started.session)).toEqual({ kind: "ok" });
      expect(await box.stop(started.session)).toEqual({ kind: "ok" });
    });

    it("starts each box apart from the others", async () => {
      const box = make();
      const one = await box.start(full);
      const two = await box.start(full);
      if (one.kind !== "started" || two.kind !== "started") throw new Error("start failed");
      expect(one.session.id).not.toBe(two.session.id);
      await box.stop(one.session);
      const ran = await box.run({
        session: two.session,
        command: { argv: ["true"], stdin: { kind: "none" }, timeoutSeconds: 30 },
      });
      expect(ran).toMatchObject({ kind: "exited", code: 0 });
      await box.stop(two.session);
    });
  });
}
