// check-coordinator — fails when the coordinator's settings template is looser than its wall (#105, #227, #215):
// approve, start or eval allowed or asked, raw gh, glab or curl, bash -c, an edit outside the spec drafts, a missing
// deny, or bypass mode. The orchestrator runs the same check (wallProblems in src/core/coordinator.ts) before each pass.
//
//   node scripts/check-coordinator.ts                   the template src/core/coordinator.ts builds (make lint)
//   node scripts/check-coordinator.ts <settings.json>   a settings file, as built for the sample places below
//
// Runs on Node's type stripping (Node 22.18+), so it uses only erasable TypeScript. coordinator.ts has type imports
// only, so it loads here without a build.

import { readFileSync } from "node:fs";
import type * as Coordinator from "../src/core/coordinator.js";

// the places the template is built for; any absolute paths do
export const SAMPLE: Coordinator.CoordinatorPlaces = {
  pkg: "/opt/agent-factory",
  factoryHome: "/home/dev/.factory",
  botHome: "/home/factory",
};

async function load(): Promise<typeof Coordinator> {
  const loaded: typeof Coordinator = await import(new URL("../src/core/coordinator.ts", import.meta.url).href);
  return loaded;
}

if (process.argv[1] === import.meta.filename) {
  const wall = await load();
  const file = process.argv[2];
  const settings: unknown =
    file === undefined ? wall.claudeSettings(SAMPLE) : (JSON.parse(readFileSync(file, "utf8")) as unknown);
  const problems = wall.wallProblems(settings, SAMPLE);
  for (const problem of problems) {
    console.log(`${file ?? "the coordinator template"}: ${problem}`);
  }
  if (problems.length > 0) {
    console.log(`check-coordinator: ${problems.length} way(s) the coordinator's settings are looser than its wall`);
    process.exit(1);
  }
}
