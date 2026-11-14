// lesson — what the retro card's run returns (#488 AC-2, the drafts): one lesson per repeated failure, as JSON the CLI
// checks against LESSON_SCHEMA, then read here before the engine writes anything (retro/draft.ts). Each lesson names
// the failures it comes from, its cause (RT2), a fix at the highest level that holds (RT6), its actions as one JSON list
// (RT4), a patch against the pinned rules pack, a new golden case or role scenario (RT9) and a review-by date (RT10).
// Pure.

import type { Result } from "../forge/api.js";
import { prop } from "../dispatch/records.js";

export const LEVELS = ["structure", "type", "lint", "test", "rule"] as const;
const ACTION_TYPES = ["rule", "script", "check", "playbook"] as const;
const DATE = "^\\d{4}-\\d{2}-\\d{2}$";

const text = { type: "string", minLength: 1 } as const;

export const LESSON_SCHEMA = JSON.stringify({
  type: "object",
  required: ["lessons"],
  properties: {
    lessons: {
      type: "array",
      items: {
        type: "object",
        required: ["failures", "cause", "level", "actions", "rules_patch", "case", "review_by"],
        properties: {
          failures: { type: "array", items: text, minItems: 1 },
          cause: text,
          level: { enum: LEVELS },
          actions: {
            type: "array",
            items: {
              type: "object",
              required: ["type", "owner", "due", "ticket"],
              properties: {
                type: { enum: ACTION_TYPES },
                owner: text,
                due: { type: "string", pattern: DATE },
                ticket: text,
              },
            },
          },
          rules_patch: { type: "string" },
          case: {
            type: "object",
            required: ["name", "files"],
            properties: {
              name: text,
              files: {
                type: "array",
                items: {
                  type: "object",
                  required: ["path", "text"],
                  properties: { path: text, text: { type: "string" } },
                },
              },
            },
          },
          review_by: { type: "string", pattern: DATE },
        },
      },
    },
  },
});

export type CaseFile = { readonly path: string; readonly text: string };

export type Lesson = {
  readonly failures: readonly string[];
  readonly cause: string;
  readonly level: (typeof LEVELS)[number];
  readonly actions: readonly unknown[];
  readonly rulesPatch: string;
  readonly caseName: string;
  readonly caseFiles: readonly CaseFile[];
  readonly reviewBy: string;
};

// SAFE : a case file's path: plain relative parts, no "..", no hidden part
const SAFE = /^(?:[A-Za-z0-9_][A-Za-z0-9_.-]*\/)*[A-Za-z0-9_][A-Za-z0-9_.-]*$/;

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const list = (v: unknown): readonly unknown[] => (Array.isArray(v) ? v : []);
const strings = (v: unknown): readonly string[] => list(v).filter((s): s is string => typeof s === "string");

// caseFilesOf : the case's files, or the first path the engine will not write. Pure.
function caseFilesOf(raw: unknown): Result<readonly CaseFile[]> {
  const read = list(raw).map((f) => ({ path: str(prop(f, "path")), text: str(prop(f, "text")) }));
  const bad = read.find((f) => !SAFE.test(f.path) || f.path.split("/").includes(".."));
  return bad === undefined
    ? { kind: "ok", value: read }
    : { kind: "failed", reason: `a case file path is not plain: ${JSON.stringify(bad.path)}` };
}

// lessonOf : one lesson of the answer, the schema already checked by the CLI. Pure.
function lessonOf(raw: unknown): Result<Lesson> {
  const files = caseFilesOf(prop(prop(raw, "case"), "files"));
  if (files.kind === "failed") {
    return files;
  }
  return {
    kind: "ok",
    value: {
      failures: strings(prop(raw, "failures")),
      cause: str(prop(raw, "cause")),
      level: LEVELS.find((l) => l === prop(raw, "level")) ?? "rule",
      actions: list(prop(raw, "actions")),
      rulesPatch: str(prop(raw, "rules_patch")),
      caseName: str(prop(prop(raw, "case"), "name")),
      caseFiles: files.value,
      reviewBy: str(prop(raw, "review_by")),
    },
  };
}

// lessonsOf : the run's lessons, or why the answer cannot be written. Pure.
export function lessonsOf(output: unknown): Result<readonly Lesson[]> {
  const raw = prop(output, "lessons");
  if (!Array.isArray(raw)) {
    return { kind: "failed", reason: "the retro run's answer has no lessons list" };
  }
  const read = raw.map(lessonOf);
  const bad = read.find((r) => r.kind === "failed");
  return bad?.kind === "failed" ? bad : { kind: "ok", value: read.flatMap((r) => (r.kind === "ok" ? [r.value] : [])) };
}
