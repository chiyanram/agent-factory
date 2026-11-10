// rerun-note — the ready check's re-run of each evidence row, beside the result the writer claimed (#430). The writer's
// "done" note holds the claim (finish.ts); this note, posted on each head the rows ran at, holds what the host saw when
// it ran the same command again in a fresh box, so a person reads both side by side. Model text is data: the post
// template cleans every item.

import type { Post } from "../post.js";
import type { Evidence } from "../report.js";
import { tailOf } from "../kept.js";
import { rowLine, type Row } from "./boxrun.js";

// lastLine : the last line a row printed, stdout first, else stderr; "" when it printed nothing. Pure.
function lastLine(row: Row): string {
  if (row.ran.kind !== "exited") {
    return "";
  }
  const out = tailOf(row.ran.stdout).split("\n").at(-1) ?? "";
  return out !== "" ? out : (tailOf(row.ran.stderr).split("\n").at(-1) ?? "");
}

// rowItem : one row as a person reads it: the criterion, what the writer claimed, and what the host's re-run showed.
// Pure.
function rowItem(e: Evidence, row: Row | undefined): string {
  const ran = row === undefined ? "did not run" : rowLine(row);
  const said = row === undefined ? "" : lastLine(row);
  return `${e.criterion} · claimed: ${e.result} · re-run: ${ran}${said === "" ? "" : ` · ${said}`}`;
}

// rerunPost : the re-run of every row at the head, in the claim's order. Pure.
export function rerunPost(head: string, evidence: readonly Evidence[], rows: readonly Row[], passed: boolean): Post {
  return {
    seat: "coordinator",
    title: `ready check at ${head.slice(0, 12)}: ${passed ? "every row ran again and passed" : "a row failed when run again"}`,
    fields: [],
    items: evidence.map((e, i) => rowItem(e, rows[i])),
  };
}
