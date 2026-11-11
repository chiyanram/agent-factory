// deviations — the build's deviation notes, as the review pack reads them (ADR-0018, #430). The implementer never edits
// the approved design: the host posts each change of a type, signature or file placement as one "[writer] DEVIATION:"
// note (finish.ts), and the review judges the change against the design plus these notes. A note counts only when it
// is the factory's (its login and the [writer] seat, notes.ts), so a stranger's note with the same words changes
// nothing the review judges against.

import { classify, type Note } from "../notes.js";
import { DEVIATION } from "../report.js";

const TITLE = new RegExp(`^\\[writer\\] ${DEVIATION}`);

// deviationNotes : the body of every deviation note the factory posted, oldest first. Pure.
export function deviationNotes(notes: readonly Note[], factory: string): readonly string[] {
  return notes
    .filter((note) => {
      const kind = classify({ note, readers: { factory, members: new Set() } });
      return kind.kind === "agent" && kind.seat === "writer" && TITLE.test(note.body);
    })
    .map((note) => note.body.trim());
}
