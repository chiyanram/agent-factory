// event-parse — reads one line of a ticket's record back into an event (records.ts). Each kind has its own reader, in
// parse-runs.ts, parse-design.ts and parse-checks.ts, or inline below for a kind of one or two fields. A line that
// is not JSON, names no known kind or has a field of the wrong shape reads as BAD, so the read fails at that line.

import type { Answer } from "../answers.js";
import { isVia } from "../human-record.js";
import { prop } from "../field.js";
import type { Event, Kind } from "./event.js";
import { BAD, type Bad, str, oneOf, TURN_LANES, type Parse, optionalText } from "./parse-fields.js";
import { startedOf, spentOf, setupRefusedOf, parkedOf, writerEndedOf } from "./parse-runs.js";
import { designEndedOf, designNotedOf } from "./parse-design.js";
import { readyEndedOf, verifyEndedOf, timelineParts, reviewEndedOf } from "./parse-checks.js";

const isKind = (k: unknown): k is Kind => typeof k === "string" && Object.hasOwn(PARSE, k);

function readBack(raw: unknown): { readonly [k: string]: string } | "bad" {
  const [asked, chosen] = [optionalText(raw, "asked"), optionalText(raw, "chosen")];
  return asked === "bad" || chosen === "bad" ? "bad" : { ...asked, ...chosen };
}

function answerOf(raw: unknown): Answer | undefined {
  const [question, choice, text] = [prop(raw, "question"), prop(raw, "choice"), prop(raw, "text")];
  const back = readBack(raw);
  const ok = Number.isSafeInteger(question) && typeof choice === "string" && typeof text === "string";
  return ok && back !== "bad" ? { question: Number(question), choice, text, ...back } : undefined;
}

function answeredOf(raw: unknown, at: string): Event | Bad {
  const spec = str(raw, "spec");
  const list = prop(raw, "answers");
  const answers = Array.isArray(list) ? list.map(answerOf) : [undefined];
  return spec === BAD || answers.some((a) => a === undefined)
    ? BAD
    : { at, kind: "answered", spec, answers: answers.filter((a): a is Answer => a !== undefined) };
}

const PARSE: Readonly<Record<Kind, Parse>> = {
  started: startedOf,
  "writer-ended": writerEndedOf,
  "ready-ended": readyEndedOf,
  "review-ended": reviewEndedOf,
  "verify-ended": verifyEndedOf,
  spent: spentOf,
  parked: parkedOf,
  "design-ended": designEndedOf,
  "setup-refused": setupRefusedOf,
  "design-noted": designNotedOf,
  pinged: (raw, at) => {
    const head = str(raw, "head");
    return head === BAD ? BAD : { at, kind: "pinged", head };
  },
  turn: (raw, at) => {
    const to = oneOf(raw, "to", TURN_LANES);
    return to === BAD ? BAD : { at, kind: "turn", to };
  },
  waiting: (raw, at) => {
    const since = str(raw, "since");
    return since === BAD ? BAD : { at, kind: "waiting", since };
  },
  blocked: (raw, at) => {
    const why = str(raw, "why");
    return why === BAD ? BAD : { at, kind: "blocked", why };
  },
  held: (raw, at) => {
    const why = str(raw, "why");
    return why === BAD ? BAD : { at, kind: "held", why };
  },
  "blockers-unread": (raw, at) => {
    const why = str(raw, "why");
    return why === BAD ? BAD : { at, kind: "blockers-unread", why };
  },
  shared: (raw, at) => {
    const approval = str(raw, "approval");
    return approval === BAD ? BAD : { at, kind: "shared", approval };
  },
  answered: answeredOf,
  begun: (raw, at) => {
    const by = str(raw, "by");
    const via = prop(raw, "via");
    return by === BAD || !isVia(via) ? BAD : { at, kind: "begun", by, via };
  },
  merged: (raw, at) => {
    const n = prop(raw, "number");
    const sha = str(raw, "sha");
    const by = str(raw, "by");
    return sha === BAD || by === BAD || !Number.isSafeInteger(n)
      ? BAD
      : { at, kind: "merged", number: Number(n), sha, by };
  },
  timeline: (raw, at) => {
    const n = prop(raw, "number");
    const parts = timelineParts(raw);
    return parts === BAD || !Number.isSafeInteger(n) ? BAD : { at, kind: "timeline", number: Number(n), ...parts };
  },
  approved: (raw, at) => {
    const by = str(raw, "by");
    const via = prop(raw, "via");
    const spec = str(raw, "spec");
    return by === BAD || spec === BAD || !isVia(via) ? BAD : { at, kind: "approved", by, via, spec };
  },
  "review-again": (raw, at) => {
    const by = str(raw, "by");
    const via = prop(raw, "via");
    const spec = str(raw, "spec");
    return by === BAD || spec === BAD || !isVia(via) ? BAD : { at, kind: "review-again", by, via, spec };
  },
};

export function parseLine(line: string): unknown {
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return undefined;
  }
}

export function eventOf(line: string): Event | Bad {
  const raw = parseLine(line);
  const at = str(raw, "at");
  const kind = prop(raw, "kind");
  return at === BAD || !isKind(kind) ? BAD : PARSE[kind](raw, at);
}

export function isEvent(e: Event | Bad): e is Event {
  return e !== BAD;
}
