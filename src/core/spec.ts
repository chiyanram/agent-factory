// spec — where a ticket's spec lives, what it must hold, and its hash (#127; ADR-0012 S1).
//
// The spec is the writer's contract: the intent, the acceptance criteria, the design link and the lane. Where it lives
// is set per project ([review 3 on map #30]):
//   local  <home>/specs/<project>/<ticket>/spec.md, the default at work: nothing goes to git, Confluence or Jira
//   issue  the GitHub or GitLab issue body, for personal projects; read through the forge seam (#102)
// An approval (#104) records the spec's hash, and the dispatcher starts work only while the hash still matches, so a
// spec edited after it was approved is never built. The hash is taken over normalised text: line endings and trailing
// spaces are editor noise, not a change of meaning, so they never make an approval stale; any other edit does.
//
// What the human approves must be all there is to see. So a spec is refused when it holds a character that does not
// show (control, zero-width, bidi, tag characters, a byte-order mark) or is not in Unicode NFC form, and the template
// is read line by line outside code fences and HTML comments, with each section once. A spec with no acceptance
// criteria, or only placeholders ("TBD", "<…>", "..."), is refused: the writer would have no contract.
//
// The design is the spec's own ## Design section, so the spec's hash binds it and an approval binds one hash.
// In the feature and one-way-door lanes the section must hold design text: "none", or links alone, is refused before
// approval (designProblems), since the hash binds the section's text and never what a link points to. A design.md left
// beside a local spec is no longer read: spec and approve name it (beforeApproval) so nobody approves around it. The PR
// body holds the spec inside a fence longer than any it holds, so no git host runs a quick action, pings or closes from
// it.

import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { LANES, type Lane } from "./lane-order.js";
import { cleanField } from "./post.js";
import { scrubSecrets } from "./scrub.js";

export { LANES, type Lane } from "./lane-order.js";

export type Spec = {
  readonly title: string;
  readonly intent: string;
  readonly criteria: readonly string[];
  readonly design: string;
  readonly lane: Lane;
  readonly planned: readonly string[];
  readonly blockedBy: readonly string[];
  readonly text: string;
  readonly hash: string;
};

export type SpecCheck =
  | { readonly kind: "ok"; readonly spec: Spec }
  | { readonly kind: "invalid"; readonly problems: readonly string[] };

export type Refused = { readonly kind: "refused"; readonly reason: string };

export type SpecRead =
  | { readonly kind: "found"; readonly text: string; readonly where: string }
  | { readonly kind: "missing"; readonly where: string }
  | Refused;

export type SpecStore =
  | { readonly kind: "local"; readonly root: string }
  | { readonly kind: "issue"; readonly readIssueBody: (ticket: string) => Promise<SpecRead> };

export type Ticket = { readonly project: string; readonly ticket: string };

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export function plainName(name: string): boolean {
  return NAME.test(name);
}

function plainTicket(t: Ticket): boolean {
  return plainName(t.project) && plainName(t.ticket);
}

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
    "<the design: its shape, parts, contracts and data; none only in the tiny and bug lanes>",
    "",
    "## Lane",
    "",
    "feature",
    "",
    "## Planned files",
    "",
    "- <a path the change will touch, one per line>",
    "",
    "## Blocked by",
    "",
    "- <a ticket that must be merged before this one is built, one per line; leave out the section for none>",
    "",
  ].join("\n");
}

export function normalise(text: string): string {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""));
  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

export function specHash(text: string): string {
  return createHash("sha256").update(normalise(text), "utf8").digest("hex");
}

const HIDDEN =
  /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]|[\u{e0000}-\u{e007f}]/u;

function hiddenProblems(text: string): readonly string[] {
  return [
    ...(HIDDEN.test(text)
      ? ["characters that do not show (control, zero-width, bidi, tag or byte-order mark): remove them"]
      : []),
    ...(text.normalize("NFC") === text ? [] : ["text that is not in Unicode NFC form: save it normalised"]),
  ];
}

type Scan = { readonly fence: string; readonly comment: boolean };
type Step = { readonly scan: Scan; readonly hidden: boolean };

const OUTSIDE: Scan = { fence: "", comment: false };

function scanLine(scan: Scan, line: string): Step {
  if (scan.fence !== "") {
    return { scan: line.trim().startsWith(scan.fence) ? OUTSIDE : scan, hidden: true };
  }
  if (scan.comment) {
    return { scan: { fence: "", comment: !line.includes("-->") }, hidden: true };
  }
  const opener = /^\s*(`{3,}|~{3,})/.exec(line)?.[1] ?? "";
  if (opener !== "") {
    return { scan: { fence: opener, comment: false }, hidden: true };
  }
  if (line.includes("<!--")) {
    return { scan: { fence: "", comment: !line.slice(line.lastIndexOf("<!--")).includes("-->") }, hidden: true };
  }
  return { scan, hidden: line.includes("-->") };
}

type Line = { readonly text: string; readonly visible: boolean };

function visibleLines(text: string): readonly Line[] {
  let scan = OUTSIDE;
  return text.split("\n").map((line) => {
    const step = scanLine(scan, line);
    scan = step.scan;
    return { text: line, visible: !step.hidden };
  });
}

type Parsed = {
  readonly title: string;
  readonly sections: ReadonlyMap<string, string>;
  readonly duplicates: readonly string[];
};

function parse(text: string): Parsed {
  const lines = visibleLines(text);
  const title = /^# +(.*\S)\s*$/.exec(lines[0]?.visible === true ? lines[0].text : "")?.[1] ?? "";
  const sections = new Map<string, string[]>();
  const duplicates: string[] = [];
  let current = "";
  for (const line of lines.slice(1)) {
    const heading = line.visible ? /^## +(.*\S)\s*$/.exec(line.text)?.[1]?.toLowerCase() : undefined;
    if (heading !== undefined) {
      duplicates.push(...(sections.has(heading) ? [heading] : []));
      sections.set(heading, []);
      current = heading;
    } else if (current !== "" && line.visible) {
      sections.get(current)?.push(line.text);
    }
  }
  return { title, sections: new Map([...sections].map(([k, v]) => [k, v.join("\n").trim()])), duplicates };
}

const PLACEHOLDER = /^(<.*>|tbd|tbc|todo|to do|\.\.\.|…|-+|\?+|n\/a|example)$/i;

function real(body: string): boolean {
  return body.length > 0 && !PLACEHOLDER.test(body.trim());
}

function numbered(body: string): readonly string[] {
  return body
    .split("\n")
    .map((line) => /^\s*\d+[.)]\s+(.*\S)\s*$/.exec(line)?.[1] ?? "")
    .filter(real);
}

type Fields = {
  readonly title: string;
  readonly intent: string;
  readonly criteria: readonly string[];
  readonly design: string;
  readonly lane: string;
  readonly planned: readonly string[];
  readonly blocked: readonly BlockedLine[];
};

type BlockedLine =
  | { readonly kind: "ticket"; readonly ticket: string }
  | { readonly kind: "bad"; readonly line: string };

function blockedOf(body: string): readonly BlockedLine[] {
  return body
    .split("\n")
    .map((line) =>
      line
        .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
        .replaceAll("`", "")
        .trim(),
    )
    .filter((line) => real(line) && !line.startsWith("<") && line.toLowerCase() !== "none")
    .map((line) => {
      const ticket = line.replace(/^#/, "");
      return plainName(ticket) ? { kind: "ticket", ticket } : { kind: "bad", line };
    });
}

function plannedOf(body: string): readonly string[] {
  return body
    .split("\n")
    .map((line) =>
      line
        .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
        .replaceAll("`", "")
        .trim(),
    )
    .filter((path) => real(path) && !path.startsWith("<"));
}

function fields(p: Parsed): Fields {
  const at = (name: string): string => p.sections.get(name) ?? "";
  return {
    title: p.title,
    intent: at("intent"),
    criteria: numbered(at("acceptance criteria")),
    design: at("design"),
    lane: at("lane").toLowerCase(),
    planned: plannedOf(at("planned files")),
    blocked: blockedOf(at("blocked by")),
  };
}

function templateProblems(f: Fields, duplicates: readonly string[]): readonly string[] {
  return [
    ...(real(f.title) && !f.title.includes("<") ? [] : ["missing a first line '# <ticket>: <title>'"]),
    ...(real(f.intent) ? [] : ["missing an '## Intent' section in the person's own words"]),
    ...(f.criteria.length > 0
      ? []
      : ["missing an '## Acceptance criteria' section with at least one real numbered criterion"]),
    ...(real(f.design) ? [] : ["missing a '## Design' section: the design, or 'none' in the tiny and bug lanes"]),
    ...((LANES as readonly string[]).includes(f.lane)
      ? []
      : [`missing a '## Lane' section: one of ${LANES.join(", ")}`]),
    ...duplicates.map((d) => `the '## ${d}' section appears more than once`),
    ...f.blocked.flatMap((b) =>
      b.kind === "bad"
        ? [`the '## Blocked by' line ${JSON.stringify(b.line)} is not one ticket: write one per line`]
        : [],
    ),
  ];
}

export const MAX_BODY = 65_536;

const QUICK_ACTION = /^\s*\/[A-Za-z]/;
const MENTION = /(?:^|[^\w`@./-])@([A-Za-z0-9][\w.-]*)/;

function unfenced(text: string): readonly { readonly n: number; readonly text: string }[] {
  let fence = "";
  return text.split("\n").flatMap((line, i) => {
    const inside = fence !== "";
    fence = fenceAfter(fence, line);
    return inside || fence !== "" ? [] : [{ n: i + 1, text: line.replace(/`[^`]*`/g, "") }];
  });
}

function fenceAfter(fence: string, line: string): string {
  if (fence !== "") {
    return line.trim().startsWith(fence) ? "" : fence;
  }
  return /^\s*(`{3,}|~{3,})/.exec(line)?.[1] ?? "";
}

function lineProblems(line: { readonly n: number; readonly text: string }): readonly string[] {
  const mention = MENTION.exec(line.text)?.[1];
  return [
    ...(QUICK_ACTION.test(line.text)
      ? [`line ${line.n} starts with "/", which GitLab may run as a quick action: put it in backticks`]
      : []),
    ...(mention === undefined
      ? []
      : [`line ${line.n} mentions @${mention}, whom the git host would notify: put it in backticks`]),
  ];
}

export function postableSpec(text: string): readonly string[] {
  return [
    ...(scrubSecrets(text) === text
      ? []
      : ["the text holds something shaped like a secret (a token, a key or a login): take it out; nothing is sent"]),
    ...(text.length > MAX_BODY ? [`the body is ${text.length} characters; a git host keeps at most ${MAX_BODY}`] : []),
    ...hiddenProblems(text.replaceAll("\r\n", "\n")),
    ...unfenced(text.replaceAll("\r\n", "\n")).flatMap(lineProblems),
  ];
}

export function checkSpec(raw: string): SpecCheck {
  const text = normalise(raw);
  const parsed = parse(text);
  const f = fields(parsed);
  const problems = [...hiddenProblems(text), ...templateProblems(f, parsed.duplicates)];
  return problems.length > 0
    ? { kind: "invalid", problems }
    : {
        kind: "ok",
        spec: {
          title: f.title,
          intent: f.intent,
          criteria: f.criteria,
          design: f.design,
          lane: f.lane as Lane,
          planned: f.planned,
          blockedBy: [...new Set(f.blocked.flatMap((b) => (b.kind === "ticket" ? [b.ticket] : [])))],
          text,
          hash: specHash(text),
        },
      };
}

export type SpecPath = { readonly kind: "path"; readonly path: string } | Refused;

export function specPath(at: { readonly root: string } & Ticket): SpecPath {
  return plainTicket(at)
    ? { kind: "path", path: join(at.root, at.project, at.ticket, "spec.md") }
    : {
        kind: "refused",
        reason: `a project and a ticket must be plain names, got ${JSON.stringify(at.project)} ${JSON.stringify(at.ticket)}`,
      };
}

function missingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function readLocal(at: { readonly root: string } & Ticket): Promise<SpecRead> {
  const path = specPath(at);
  if (path.kind === "refused") {
    return path;
  }
  try {
    return { kind: "found", text: await readFile(path.path, "utf8"), where: path.path };
  } catch (error: unknown) {
    return missingFile(error)
      ? { kind: "missing", where: path.path }
      : { kind: "refused", reason: `cannot read ${path.path}: ${String(error)}` };
  }
}

export function readSpec(request: { readonly store: SpecStore } & Ticket): Promise<SpecRead> {
  const { store } = request;
  if (!plainTicket(request)) {
    return Promise.resolve({
      kind: "refused",
      reason: `a project and a ticket must be plain names, got ${JSON.stringify(request.project)} ${JSON.stringify(request.ticket)}`,
    });
  }
  switch (store.kind) {
    case "local":
      return readLocal({ root: store.root, project: request.project, ticket: request.ticket });
    case "issue":
      return store.readIssueBody(request.ticket);
    default: {
      const unreachable: never = store;
      return unreachable;
    }
  }
}

export type Approver = { readonly by: string; readonly at: string; readonly said?: "approved" | "started" };

export function prBlock(request: { readonly spec: Spec; readonly approver: Approver }): string {
  const { spec, approver } = request;
  const longest = Math.max(2, ...Array.from(spec.text.matchAll(/`+/g), (m) => m[0].length));
  const fence = "`".repeat(longest + 1);
  return [
    "## Approved spec",
    "",
    `spec ${spec.hash} · ${approver.said ?? "approved"} locally by ${cleanField(approver.by, 100)} at ${cleanField(approver.at, 40)}`,
    "",
    `${fence}markdown`,
    spec.text.replace(/\n$/, ""),
    fence,
  ].join("\n");
}

export const NO_DESIGN = "none";

const DESIGN_LANES: ReadonlySet<Lane> = new Set(["feature", "one-way door"]);

function withoutLinks(design: string): string {
  return design
    .replace(/\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/https?:\/\/\S*/g, " ")
    .replace(/[A-Za-z0-9._/-]*\.md\b/g, " ");
}

export function designProblems(spec: Pick<Spec, "lane" | "design">): readonly string[] {
  if (!DESIGN_LANES.has(spec.lane)) {
    return [];
  }
  if (spec.design.trim().toLowerCase() === NO_DESIGN) {
    return [`the ${spec.lane} lane needs a design: write it in the '## Design' section, not 'none'`];
  }
  return /\p{L}/u.test(withoutLinks(spec.design))
    ? []
    : [
        `the ${spec.lane} lane needs the design's text in the '## Design' section: the hash binds that text, never what a link points to`,
      ];
}

async function leftoverDesign(request: { readonly store: SpecStore } & Ticket): Promise<readonly string[]> {
  if (request.store.kind !== "local") {
    return [];
  }
  const spec = specPath({ root: request.store.root, project: request.project, ticket: request.ticket });
  if (spec.kind === "refused") {
    return [spec.reason];
  }
  const path = join(dirname(spec.path), "design.md");
  try {
    await access(path);
    return [`${path} is not read any more: move its text into the spec's '## Design' section and delete the file`];
  } catch (error: unknown) {
    return missingFile(error) ? [] : [`cannot read ${path}: ${String(error)}`];
  }
}

export async function beforeApproval(
  request: { readonly store: SpecStore } & Ticket,
  spec: Pick<Spec, "lane" | "design">,
): Promise<readonly string[]> {
  return [...(await leftoverDesign(request)), ...designProblems(spec)];
}
