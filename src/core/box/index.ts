// index — opens the box FACTORY_BOX names (#112). Setup (#136) and the dispatcher (#103) call openBox before any run,
// and a refusal stops them: no run starts with no working box (S7). Each place's Box is passed in, so the vm box (#113)
// and the laptop box (#129) plug in here without a change to any caller.

import { chooseBox, startGate, type Found, type Opened } from "./choose.js";
import type { Box, BoxPlace } from "./types.js";

export type { Box, BoxPlace, BoxSpec, Command, Copy, Done, Input, PinnedImage, Probe, Ran, Session, Started } from "./types.js";
export { chooseBox, pinImage, startGate, type BoxChoice, type Opened, type Pin } from "./choose.js";

async function find(place: BoxPlace, boxes: readonly Box[]): Promise<Found> {
  const box = boxes.find((b) => b.place === place);
  return box === undefined ? { kind: "none" } : { kind: "found", box, probe: await box.probe() };
}

export async function openBox(input: { readonly env: NodeJS.ProcessEnv; readonly boxes: readonly Box[] }): Promise<Opened> {
  const choice = chooseBox(input.env);
  const found: Found = choice.kind === "chosen" ? await find(choice.place, input.boxes) : { kind: "none" };
  return startGate({ choice, found });
}
