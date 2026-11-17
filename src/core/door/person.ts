// door/person — the person a front door verified (ADR-0023 D2). A door's own identity check makes one through vouch,
// and the write API (write.ts) refuses any other object, even one of the same shape: a door cannot hand the core a
// name it did not check. Only src/core/door/ calls vouch (test/door.test.ts holds that).

import { isVia, type Via } from "../human-record.js";
import type { Refused } from "../spec.js";

// a key only this file can name, so code outside it cannot build a Person, not even an object of the same shape
const VOUCHED_BRAND: unique symbol = Symbol("vouched");

export type Person = {
  readonly kind: "person";
  // who, as the door's check named them; the records' `by`
  readonly by: string;
  // the door that checked them; the records' `via`
  readonly via: Via;
  readonly [VOUCHED_BRAND]: true;
};

// a front door: its via, and its own check of who is at it, from what that door has (the terminal: its environment)
export type Door<Evidence> = {
  readonly via: Via;
  readonly verify: (evidence: Evidence) => Promise<Person | Refused>;
};

// every person a door vouched for, so a copy or a hand-made object is refused
const VOUCHED = new WeakSet<object>();

// unseen : a code unit that breaks a line or changes how the text around it reads: a C0 or C1 control, DEL, a line or
// paragraph separator, or a direction mark, embedding, override or isolate. Pure.
function unseen(code: number): boolean {
  const ranges: readonly (readonly [number, number])[] = [
    [0x00, 0x1f],
    [0x7f, 0x9f],
    [0x200e, 0x200f],
    [0x2028, 0x202e],
    [0x2066, 0x2069],
  ];
  return ranges.some(([low, high]) => code >= low && code <= high);
}

// plainName : one line of text that reads as it shows, and not blank. Pure.
function plainName(by: string): boolean {
  const codes = Array.from({ length: by.length }, (_, i) => by.charCodeAt(i));
  return by.trim() !== "" && !codes.some(unseen);
}

// vouch : the person a door's check named, frozen; an unknown door or a name that is not one plain line is refused
export function vouch(via: unknown, by: string): Person | Refused {
  if (!isVia(via)) {
    return { kind: "refused", reason: `${JSON.stringify(via)} is not a front door` };
  }
  if (!plainName(by)) {
    return { kind: "refused", reason: `the ${via} door named no plain person: ${JSON.stringify(by)}` };
  }
  const person: Person = Object.freeze({ kind: "person", by, via, [VOUCHED_BRAND]: true } as const);
  VOUCHED.add(person);
  return person;
}

// isVouched : whether a door vouched for this very value
export function isVouched(value: unknown): value is Person {
  return typeof value === "object" && value !== null && VOUCHED.has(value);
}
