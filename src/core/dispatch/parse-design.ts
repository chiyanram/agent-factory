// parse-design — reads the lines of a design review (event-parse.ts): "design-ended", with the spec and card hashes,
// the findings or what the verify pass kept, and its end; and "design-noted".

import type { Lane } from "../spec.js";
import { recordedFindings, recordedKept } from "../design/findings.js";
import { prop } from "../field.js";
import { agrees, DESIGN_REASONS, type DesignEnd } from "../end-reason.js";
import type { Event } from "./event.js";
import { BAD, type Bad, str, oneOf, runsIn, reasonOr, laneField, optionalText } from "./parse-fields.js";
import { writerExtras } from "./parse-runs.js";

function designEndOf(raw: unknown): DesignEnd | Bad {
  const outcome = oneOf(raw, "outcome", ["done", "failed"] as const);
  if (outcome === BAD) {
    return BAD;
  }
  const reason = reasonOr(raw, outcome === "done" ? "done" : "unknown");
  if (reason === BAD) {
    return BAD;
  }
  const end = { outcome, reason };
  return agrees(DESIGN_REASONS, end) ? end : BAD;
}

type DesignParts = Pick<Extract<Event, { kind: "design-ended" }>, "step" | "spec" | "design" | "why"> & DesignEnd;

function designTexts(raw: unknown): Pick<DesignParts, "spec" | "design" | "why"> | Bad {
  const spec = str(raw, "spec");
  const design = optionalText(raw, "design");
  const why = str(raw, "why");
  return spec === BAD || design === "bad" || why === BAD ? BAD : { spec, ...design, why };
}

function designParts(raw: unknown): DesignParts | Bad {
  const which = oneOf(raw, "step", ["review", "verify"] as const);
  const end = designEndOf(raw);
  const texts = designTexts(raw);
  return which === BAD || end === BAD || texts === BAD ? BAD : { step: which, ...end, ...texts };
}

export function designEndedOf(raw: unknown, at: string): Event | Bad {
  const parts = designParts(raw);
  const findings = recordedFindings(prop(raw, "findings"));
  const kept = recordedKept(prop(raw, "kept"));
  const extras = designExtras(raw);
  if (parts === BAD || extras === BAD) {
    return BAD;
  }
  return findings === undefined || kept === undefined
    ? BAD
    : { at, kind: "design-ended", ...parts, findings, kept, ...extras, ...runsIn(raw) };
}

function designExtras(raw: unknown): (ReturnType<typeof writerExtras> & DesignOptional) | Bad {
  const parts = [writerExtras(raw), finalField(raw), laneField(raw), plannedField(raw)];
  return parts.some((p) => p === BAD) ? BAD : Object.assign({}, ...parts);
}

type DesignOptional = { readonly final?: true; readonly lane?: Lane; readonly planned?: readonly string[] };

function plannedField(raw: unknown): { readonly planned?: readonly string[] } | Bad {
  const planned = prop(raw, "planned");
  if (planned === undefined) {
    return {};
  }
  return Array.isArray(planned) && planned.every((f) => typeof f === "string") ? { planned } : BAD;
}

export function designNotedOf(raw: unknown, at: string): Event | Bad {
  const texts = designTexts(raw);
  return texts === BAD ? BAD : { at, kind: "design-noted", ...texts };
}

function finalField(raw: unknown): { readonly final?: true } | Bad {
  const final = prop(raw, "final");
  if (final !== undefined && typeof final !== "boolean") {
    return BAD;
  }
  return final === true ? { final: true } : {};
}
