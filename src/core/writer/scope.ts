// scope — the role card's edit scope, checked on what the run committed (#424; process/guardrails.ts edit-scope). A
// run inside the runner has skip-all permissions, where Claude Code reads no allow rule (tools.ts), so Edit(src/test/**)
// cannot work as a permission. The host checks the run's diff after the box stops instead: an edit outside the scope
// blocks the run, and the reason names the paths.

import { matches } from "../lane.js";
import type { Outcome } from "../report.js";

// the most paths a reason names
const MOST_NAMED = 3;

// outsideScope : each path the run changed that no glob of the scope names; none when the scope is anywhere. Pure.
export function outsideScope(paths: readonly string[], scope: readonly string[]): readonly string[] {
  return scope.length === 0 ? [] : paths.filter((p) => !matches(p, scope));
}

// scoped : the run's outcome, or blocked by the host when it edited outside its card's scope. Pure.
export function scoped(outcome: Outcome, outside: readonly string[], scope: readonly string[]): Outcome {
  if (outside.length === 0) {
    return outcome;
  }
  const named = outside.slice(0, MOST_NAMED).join(", ");
  const more = outside.length > MOST_NAMED ? ` and ${outside.length - MOST_NAMED} more` : "";
  return {
    kind: "blocked",
    reason: `the run edited ${named}${more}, outside its card's edit scope (${scope.join(", ")})`,
    by: "host",
  };
}
