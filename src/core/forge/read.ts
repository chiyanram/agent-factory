// read — typed values out of a forge's JSON answer, with no throw and no guess. A Reader keeps the first value that is
// not where or what it should be; the caller checks it once, at the end, and fails with its path. A value read after
// a failure is a placeholder that is never used.

import type { Result } from "./api.js";

export type Reader = {
  // the value at path, as JSON gave it: undefined when a step is missing
  at(value: unknown, path: string): unknown;
  text(value: unknown, path: string): string;
  int(value: unknown, path: string): number;
  bool(value: unknown, path: string): boolean;
  list(value: unknown, path: string): readonly unknown[];
  // true when JSON has null (or nothing) at path: a ghost author, a commit with no checks
  absent(value: unknown, path: string): boolean;
  done<T>(value: T): Result<T>;
};

function step(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;
}

export function reader(context: string): Reader {
  let problem = "";
  const walk = (value: unknown, path: string): unknown => (path === "" ? value : path.split(".").reduce(step, value));
  function check<T>(found: unknown, path: string, want: string, ok: (v: unknown) => boolean, empty: T): T {
    if (ok(found)) {
      return found as T;
    }
    problem ||= `${context}: expected ${want} at ${path || "the top"}, got ${JSON.stringify(found) ?? "nothing"}`;
    return empty;
  }
  return {
    at: walk,
    text: (value, path) => check(walk(value, path), path, "a string", (v) => typeof v === "string", ""),
    int: (value, path) => {
      const found = walk(value, path);
      // GitLab's GraphQL gives an iid as a string of digits
      const number = typeof found === "string" && /^\d+$/.test(found) ? Number(found) : found;
      return check(number, path, "a whole number", (v) => Number.isSafeInteger(v), 0);
    },
    bool: (value, path) => check(walk(value, path), path, "true or false", (v) => typeof v === "boolean", false),
    list: (value, path) => check(walk(value, path), path, "a list", Array.isArray, []),
    absent: (value, path) => walk(value, path) === null || walk(value, path) === undefined,
    done: (value) => (problem === "" ? { kind: "ok", value } : { kind: "failed", reason: problem }),
  };
}
