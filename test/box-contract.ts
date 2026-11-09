// The contract every Box keeps (#112), whatever its place. The fake box and the vm box (#113, on a fake docker) run it
// here; the laptop box (#129) runs the same suite, so a caller can never tell the places apart.
//
// A box is made from a host environment, as app.ts makes it from its own, and shows what it handed to the runtime it
// drives: each call's argv and environment. So the suite can prove no host variable reaches the run (#181).

import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Box, BoxSpec, PinnedImage } from "../src/core/box/types.js";

// one call the box made of its runtime (the docker CLI for vm), or what a fake box was given
export type Handed = { readonly argv: readonly string[]; readonly env: Readonly<Record<string, string | undefined>> };
export type Made = { readonly box: Box; readonly handed: () => readonly Handed[] };

// a host with only what any machine has; the canary test adds its own to a copy
const HOST: NodeJS.ProcessEnv = { PATH: "/usr/bin:/bin", HOME: "/home/op", LANG: "C" };
const TRUE = { argv: ["true"], stdin: { kind: "none" }, timeoutSeconds: 30 } as const;
// a command that prints one line; each box's maker answers it with that line
export const STREAMED = { argv: ["echo", "streamed"], stdin: { kind: "none" }, timeoutSeconds: 30 } as const;

// every word a box handed on: each argument, and each variable's name and value
function words(handed: readonly Handed[]): readonly string[] {
  return handed.flatMap((h) => [
    ...h.argv,
    ...Object.entries(h.env).flatMap(([name, value]) => (value === undefined ? [name] : [name, value])),
  ]);
}

const IMAGE: PinnedImage = { kind: "pinned", ref: `factory-box@sha256:${"a".repeat(64)}` };

export function boxContract(name: string, make: (host: NodeJS.ProcessEnv) => Made, spec: Partial<BoxSpec> = {}): void {
  const full: BoxSpec = {
    image: IMAGE,
    worktree: "/tmp/wt",
    readOnly: [],
    env: {},
    proxy: "http://proxy:3128",
    network: "factory-int-ledger",
    ...spec,
  };

  describe(`box contract: ${name}`, () => {
    it("hands the run no host variable it was not given, by name or by value (#181; ADR-0012 S6, S15)", async () => {
      const canary = `canary-${randomUUID()}`;
      const ghToken = `ghp_${randomUUID().replaceAll("-", "")}`;
      const made = make({ ...HOST, FACTORY_CANARY: canary, GH_TOKEN: ghToken });
      const started = await made.box.start({ ...full, env: { CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-declared" } });
      if (started.kind !== "started") throw new Error("start failed");
      await made.box.run({ session: started.session, command: { ...TRUE, stdin: { kind: "text", text: "a prompt" } } });
      await made.box.stop(started.session);
      const handed = words(made.handed());
      // what the spec declares does reach the run, so the check below looks at the run's real input
      expect(handed).toContain("CLAUDE_CODE_OAUTH_TOKEN");
      // names, not only values: a redacting runner can hide a value
      const leaks = ["FACTORY_CANARY", canary, "GH_TOKEN", ghToken];
      expect(handed.filter((w) => leaks.some((l) => w.includes(l)))).toEqual([]);
    });

    it("runs a command in a started box and gives back its exit", async () => {
      const { box } = make(HOST);
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

    it("hands a command's watcher its output as it comes: by the end, all of it (#228)", async () => {
      const { box } = make(HOST);
      const started = await box.start(full);
      if (started.kind !== "started") throw new Error("start failed");
      const heard: string[] = [];
      const ran = await box.run({
        session: started.session,
        command: { ...STREAMED, watch: (chunk) => heard.push(chunk) },
      });
      expect(ran).toMatchObject({ kind: "exited", code: 0, stdout: "streamed\n" });
      expect(heard.join("")).toBe("streamed\n");
      await box.stop(started.session);
    });

    it("refuses a run in a stopped box", async () => {
      const { box } = make(HOST);
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
      const { box } = make(HOST);
      const started = await box.start(full);
      if (started.kind !== "started") throw new Error("start failed");
      expect(await box.stop(started.session)).toEqual({ kind: "ok" });
      expect(await box.stop(started.session)).toEqual({ kind: "ok" });
    });

    it("starts each box apart from the others", async () => {
      const { box } = make(HOST);
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
