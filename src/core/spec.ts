// spec — where a ticket's spec lives, what it must hold, and its hash (#127; ADR-0012 S1).
//
// The spec is the writer's contract: the intent, the acceptance criteria, the design link and the lane. Where it lives
// is set per project ([review 3 on map #30]):
//   local  ~/.factory/specs/<project>/<ticket>/spec.md, the default at work: nothing goes to git, Confluence or Jira
//   issue  the GitHub or GitLab issue body, for personal projects; read through the forge seam (#102)
// An approval (#104) records the spec's hash, and the dispatcher starts work only while the hash still matches, so a
// spec edited after it was approved is never built. The hash is taken over normalised text: line endings and trailing
// spaces are editor noise, not a change of meaning, so they never make an approval stale; any other edit does.
//
// A spec must follow the template below. A spec with no acceptance criteria is refused: without them the writer has
// no contract and the ready check has nothing to prove.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { cleanField } from "./post.js";

export const LANES = ["tiny", "bug", "feature", "one-way door"] as const;
export type Lane = (typeof LANES)[number];

export type Spec = {
  readonly title: string;
  readonly intent: string;
  readonly criteria: readonly string[];
  readonly design: string;
  readonly lane: Lane;
  // the normalised text, and its hash: what an approval records and what the PR body carries
  readonly text: string;
  readonly hash: string;
};

export type SpecCheck = { readonly kind: "ok"; readonly spec: Spec } | { readonly kind: "invalid"; readonly problems: readonly string[] };

export type SpecRead =
  | { readonly kind: "found"; readonly text: string; readonly where: string }
  | { readonly kind: "missing"; readonly where: string }
  | { readonly kind: "refused"; readonly reason: string };

// The store a project uses. "issue" reads through a function the forge seam (#102) provides, so this module knows no
// forge.
export type SpecStore =
  | { readonly kind: "local"; readonly root: string }
  | { readonly kind: "issue"; readonly readIssueBody: (ticket: string) => Promise<SpecRead> };

// A project or ticket name becomes part of a path, so it is a plain name: no "/", no "..", no leading dot.
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export function template(ticket: string): string {
  return [
    `# ${ticket}: <one-line title>`,
    "",
    "## Intent",
    "",
    "<what the person wants, in their own words>",
    "",
    "## Acceptance criteria",
    "",
    "1. <a result someone can check>",
    "",
    "## Design",
    "",
    "none",
    "",
    "## Lane",
    "",
    "feature",
    "",
  ].join("\n");
}

// normalise : the text an approval is bound to. CRLF and CR become LF, trailing spaces and tabs go, blank lines at the
// end go, and the text ends with one newline.
export function normalise(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map((line) => line.replace(/[ \t]+$/, ""));
  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

export function specHash(text: string): string {
  return createHash("sha256").update(normalise(text), "utf8").digest("hex");
}

type Sections = ReadonlyMap<string, string>;

// sections : the body under each "## Heading", keyed by the lower-cased heading.
function sections(text: string): Sections {
  const out = new Map<string, string>();
  const parts = text.split(/^## +/m).slice(1);
  for (const part of parts) {
    const at = part.indexOf("\n");
    const heading = (at < 0 ? part : part.slice(0, at)).trim().toLowerCase();
    out.set(heading, at < 0 ? "" : part.slice(at + 1).trim());
  }
  return out;
}

function numbered(body: string): readonly string[] {
  return body
    .split("\n")
    .map((line) => /^\s*\d+[.)]\s+(.*\S)\s*$/.exec(line)?.[1] ?? "")
    .filter((item) => item.length > 0 && !/^<.*>$/.test(item));
}

function filled(body: string): boolean {
  return body.length > 0 && !/^<.*>$/.test(body);
}

// checkSpec : the spec, or every way it breaks the template.
export function checkSpec(raw: string): SpecCheck {
  const text = normalise(raw);
  const title = /^# +(.*\S)\s*$/m.exec(text)?.[1] ?? "";
  const s = sections(text);
  const intent = s.get("intent") ?? "";
  const criteria = numbered(s.get("acceptance criteria") ?? "");
  const design = s.get("design") ?? "";
  const lane = (s.get("lane") ?? "").toLowerCase();
  const problems = [
    ...(filled(title) && !title.includes("<") ? [] : ["a first line '# <ticket>: <title>'"]),
    ...(filled(intent) ? [] : ["an '## Intent' section in the person's own words"]),
    ...(criteria.length > 0 ? [] : ["an '## Acceptance criteria' section with at least one numbered criterion"]),
    ...(filled(design) ? [] : ["a '## Design' section: a link, or 'none'"]),
    ...((LANES as readonly string[]).includes(lane) ? [] : [`a '## Lane' section: one of ${LANES.join(", ")}`]),
  ];
  return problems.length > 0
    ? { kind: "invalid", problems: problems.map((p) => `missing ${p}`) }
    : { kind: "ok", spec: { title, intent, criteria, design, lane: lane as Lane, text, hash: specHash(text) } };
}

export type SpecPath = { readonly kind: "path"; readonly path: string } | { readonly kind: "refused"; readonly reason: string };

export function specPath(root: string, project: string, ticket: string): SpecPath {
  if (!NAME.test(project) || !NAME.test(ticket)) {
    return { kind: "refused", reason: `a project and a ticket must be plain names, got ${JSON.stringify(project)} ${JSON.stringify(ticket)}` };
  }
  return { kind: "path", path: join(root, project, ticket, "spec.md") };
}

async function readLocal(root: string, project: string, ticket: string): Promise<SpecRead> {
  const path = specPath(root, project, ticket);
  if (path.kind === "refused") {
    return path;
  }
  try {
    return { kind: "found", text: await readFile(path.path, "utf8"), where: path.path };
  } catch (error: unknown) {
    const missing = error instanceof Error && "code" in error && error.code === "ENOENT";
    return missing ? { kind: "missing", where: path.path } : { kind: "refused", reason: `cannot read ${path.path}: ${String(error)}` };
  }
}

// readSpec : a ticket's spec text from the project's store.
export function readSpec(store: SpecStore, project: string, ticket: string): Promise<SpecRead> {
  switch (store.kind) {
    case "local":
      return readLocal(store.root, project, ticket);
    case "issue":
      return NAME.test(ticket) ? store.readIssueBody(ticket) : Promise.resolve({ kind: "refused", reason: `a ticket must be a plain name, got ${JSON.stringify(ticket)}` });
    default: {
      const unreachable: never = store;
      return unreachable;
    }
  }
}

export type Approver = { readonly by: string; readonly at: string };

// prBlock : the part of a PR body that records what was approved: the spec itself, its hash and who approved it when.
// The reviewer's pack reads the PR body (pack section 5), so the reviewer checks the change against this exact spec.
// The spec is the person's own approved text, so it goes in as written, inside a fence longer than any it holds: in a
// code block, GitHub and GitLab run no quick action, ping nobody and close nothing. The approver line is cleaned.
export function prBlock(spec: Spec, approver: Approver): string {
  const longest = Math.max(2, ...Array.from(spec.text.matchAll(/`+/g), (m) => m[0].length));
  const fence = "`".repeat(longest + 1);
  return [
    "## Approved spec",
    "",
    `spec ${spec.hash} · approved locally by ${cleanField(approver.by, 100)} at ${cleanField(approver.at, 40)}`,
    "",
    `${fence}markdown`,
    spec.text.replace(/\n$/, ""),
    fence,
  ].join("\n");
}
