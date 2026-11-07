// A fake box for the tests of every caller of the box seam (#112): each run gets the next scripted answer, and every
// call is recorded, so no test needs a container runtime.

import type { Box, BoxPlace, BoxSpec, Command, Copy, Done, Probe, Ran, Session } from "../src/core/box/types.js";

export type BoxCall =
  | { readonly op: "probe" }
  | { readonly op: "start"; readonly spec: BoxSpec }
  | { readonly op: "run"; readonly session: Session; readonly command: Command }
  | { readonly op: "copyIn" | "copyOut"; readonly copy: Copy }
  | { readonly op: "stop"; readonly session: Session };

export type FakeBox = { readonly box: Box; readonly calls: BoxCall[]; readonly live: Set<string> };

export function fakeBox(input: { readonly place?: BoxPlace; readonly probe?: Probe; readonly runs?: readonly Ran[]; readonly copies?: Done }): FakeBox {
  const place = input.place ?? "vm";
  const calls: BoxCall[] = [];
  const live = new Set<string>();
  let started = 0;
  let ran = 0;
  const box: Box = {
    place,
    probe: async () => {
      calls.push({ op: "probe" });
      return input.probe ?? { kind: "ready" };
    },
    start: async (spec) => {
      calls.push({ op: "start", spec });
      started += 1;
      const session = { id: `fake-${started}`, place };
      live.add(session.id);
      return { kind: "started", session };
    },
    run: async ({ session, command }) => {
      calls.push({ op: "run", session, command });
      if (!live.has(session.id)) {
        return { kind: "failed", reason: `fake: box ${session.id} is not running` };
      }
      ran += 1;
      return input.runs?.[ran - 1] ?? { kind: "failed", reason: `fake: no answer for run ${ran}: ${command.argv.join(" ")}` };
    },
    copyIn: async (copy) => {
      calls.push({ op: "copyIn", copy });
      return input.copies ?? { kind: "ok" };
    },
    copyOut: async (copy) => {
      calls.push({ op: "copyOut", copy });
      return input.copies ?? { kind: "ok" };
    },
    stop: async (session) => {
      calls.push({ op: "stop", session });
      live.delete(session.id);
      return { kind: "ok" };
    },
  };
  return { box, calls, live };
}
