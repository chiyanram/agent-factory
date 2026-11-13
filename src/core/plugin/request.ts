// request — the coordinator asks for a write; code performs it (#134; ADR-0014 P5, P6). The coordinator holds no login:
// it runs `agent-factory request <capability> --file draft.json`, and the core checks the draft's schema, cleans every
// text field with post.ts, and applies the project's policy (config.ts):
//
//   deny      refused
//   allow     performed at once, within the cap
//   confirm   kept in <home>/pending/<hex>.json (pending.ts); request prints `agent-factory confirm <id> '<the text>'`,
//             which the coordinator runs behind the harness ask prompt, so the person sees the exact text before it goes
//             out
//
// confirm performs only when the text it is given is the pending text, byte for byte, leaving out the invisible word
// joiners (U+2060) that cleanField puts after "@", "#" and "!": no person can see them, so none can check them. The
// id names the project, the ticket and the capability, so the prompt shows where the write goes, and confirm checks
// all three against the pending request. A write needs the ticket's approval to be current, its capability mapped to
// a plugin that declared that write, and a free place under the cap of that approval (writes.ts); confirm checks each
// again. Nothing here throws.

import { createHash, randomBytes } from "node:crypto";
import type { Done, Result } from "../forge/api.js";
import { approvalState } from "../approval.js";
import { prop } from "../dispatch/records.js";
import { cleanField, renderPost, type Post } from "../post.js";
import { plainName, type SpecStore } from "../spec.js";
import { isPolicyPoint, isPostPoint, readPluginConfig, type PolicyPoint, type PostPoint, type Rule } from "./config.js";
import { isPoint } from "./contract.js";
import { callPlugin, registered, type Setup } from "./registry.js";
import { dropPending, keepPending, parseId, readPending, type Id, type Pending } from "./pending.js";
import { appendLine, approvalKey, counted, onTicket, readLog, type Where } from "./writes.js";

// a write answers { kind: "done", url? } when it went out; any other kind is a failure
export const DONE = "done";
const MAX_ITEMS = 20;
const JOINER = /\u2060/g;

export type Draft = {
  readonly project: string;
  readonly ticket: string;
  readonly text: string;
  readonly items: readonly string[];
  readonly title: string;
};

// what is sent: the plugin's op and input, and the text the person checks
export type Built = { readonly op: string; readonly input: Readonly<Record<string, unknown>>; readonly text: string };

export type Requested =
  | {
      readonly kind: "done";
      readonly count: number;
      readonly cap: number;
      readonly url: string;
      // what the person must know after it went out (spec-body.ts: the approval is now stale)
      readonly note?: string;
    }
  | { readonly kind: "pending"; readonly id: string; readonly command: string; readonly text: string }
  | { readonly kind: "failed"; readonly reason: string };

export type Confirmed = Extract<Requested, { kind: "done" | "failed" }>;

function failed(reason: string): { readonly kind: "failed"; readonly reason: string } {
  return { kind: "failed", reason };
}

// pointOf : the capability a request names, when it is one the coordinator may request
export function pointOf(capability: string): Result<PostPoint> {
  if (isPostPoint(capability)) {
    return { kind: "ok", value: capability };
  }
  // spec.body is a whole spec file, not a draft of a post: spec-body.ts reads and sends it
  if (isPolicyPoint(capability)) {
    return failed(
      `${capability} is sent from the spec file: request ${capability} --file <home>/specs/<p>/<t>/spec.md`,
    );
  }
  if (capability === "forge.write") {
    return failed("forge.write is the dispatcher's; the coordinator never writes to the forge");
  }
  return failed(
    isPoint(capability)
      ? `${capability} is not a write; request names tracker.comment, tracker.create or notify`
      : `${JSON.stringify(capability)} is not an extension point`,
  );
}

// the fields each draft may hold; title is tracker.create's own
const FIELDS: Readonly<Record<PostPoint, readonly string[]>> = {
  "tracker.comment": ["project", "ticket", "text", "items"],
  "tracker.create": ["project", "ticket", "title", "text", "items"],
  notify: ["project", "ticket", "text"],
};

function words(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function itemsOf(value: unknown): readonly string[] | "bad" {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) && value.length <= MAX_ITEMS && value.every(words) ? value.filter(words) : "bad";
}

function shapeOf(capability: PostPoint, raw: unknown): Result<object> {
  const known = FIELDS[capability];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return failed("the draft is not one JSON object");
  }
  const extra = Object.keys(raw).find((k) => !known.includes(k));
  return extra === undefined
    ? { kind: "ok", value: raw }
    : failed(`a ${capability} draft holds only ${known.join(", ")}; it has ${JSON.stringify(extra)}`);
}

function whereOf(raw: object): Result<Pick<Draft, "project" | "ticket">> {
  const project = prop(raw, "project");
  const ticket = prop(raw, "ticket");
  return typeof project === "string" && plainName(project) && typeof ticket === "string" && plainName(ticket)
    ? { kind: "ok", value: { project, ticket } }
    : failed('the draft must name its "project" and "ticket" as plain names');
}

// titleOf : tracker.create's title; the other writes have none
function titleOf(capability: PostPoint, value: unknown): Result<string> {
  if (capability !== "tracker.create") {
    return { kind: "ok", value: "" };
  }
  return words(value) ? { kind: "ok", value } : failed('a tracker.create draft needs a "title"');
}

function bodyOf(capability: PostPoint, raw: object): Result<Pick<Draft, "text" | "items" | "title">> {
  const text = prop(raw, "text");
  const items = itemsOf(prop(raw, "items"));
  if (!words(text) || items === "bad") {
    return failed(`the draft needs "text", and "items" only as a list of at most ${MAX_ITEMS} texts`);
  }
  const title = titleOf(capability, prop(raw, "title"));
  return title.kind === "ok" ? { kind: "ok", value: { text, items, title: title.value } } : title;
}

function fieldsOf(capability: PostPoint, raw: object): Result<Draft> {
  const where = whereOf(raw);
  if (where.kind === "failed") {
    return where;
  }
  const body = bodyOf(capability, raw);
  return body.kind === "ok" ? { kind: "ok", value: { ...where.value, ...body.value } } : body;
}

function parsed(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

// draftOf : the draft's text, checked against the capability's schema
export function draftOf(capability: PostPoint, text: string): Result<Draft> {
  const shape = shapeOf(capability, parsed(text));
  return shape.kind === "ok" ? fieldsOf(capability, shape.value) : shape;
}

function posted(post: Post, op: string, input: (text: string) => Readonly<Record<string, unknown>>): Result<Built> {
  const rendered = renderPost(post);
  return rendered.kind === "ok"
    ? { kind: "ok", value: { op, input: input(rendered.text), text: rendered.text } }
    : failed(rendered.reason);
}

// each write's text is a post.ts template: a seat line, then the cleaned fields
const BUILD: Readonly<Record<PostPoint, (d: Draft) => Result<Built>>> = {
  "tracker.comment": (d) =>
    posted({ seat: "coordinator", title: d.text, fields: [], items: d.items }, "comment", (text) => ({
      ticket: d.ticket,
      text,
    })),
  "tracker.create": (d) =>
    posted(
      { seat: "coordinator", title: d.title, fields: [{ label: "details", value: d.text }], items: d.items },
      "create",
      (text) => ({ from: d.ticket, title: cleanField(d.title), text }),
    ),
  notify: (d) =>
    posted(
      {
        seat: "coordinator",
        title: d.text,
        fields: [{ label: "ticket", value: `${d.project}/${d.ticket}` }],
        items: [],
      },
      "send",
      (text) => ({ text }),
    ),
};

export function built(capability: PostPoint, draft: Draft): Result<Built> {
  return BUILD[capability](draft);
}

// what one write needs: where it goes, the plugin, the approval it counts against and the rule that holds
export type Plan<P extends PolicyPoint = PostPoint> = {
  readonly where: Where;
  readonly capability: P;
  readonly plugin: string;
  readonly approval: string;
  readonly approvedAt: string;
  readonly rule: Rule;
};

async function approvalOf(
  where: Where & { readonly store?: SpecStore },
): Promise<Result<{ readonly key: string; readonly at: string }>> {
  const state = await approvalState(where);
  switch (state.kind) {
    case "approved":
      return { kind: "ok", value: { key: approvalKey(state.record), at: state.record.at } };
    case "stale":
      return failed(`${where.project}/${where.ticket}: the spec changed since it was approved; no write goes out`);
    case "missing":
      return failed(`${where.project}/${where.ticket} is not approved; no write goes out for it`);
    case "refused":
      return failed(state.reason);
  }
}

async function ruleOf(where: Where, capability: PostPoint): Promise<Result<Pick<Plan, "plugin" | "rule">>> {
  const config = await readPluginConfig(where);
  if (config.kind === "failed") {
    return config;
  }
  const plugin = config.value.plugins.get(capability);
  const rule = config.value.policy[capability];
  if (rule.mode === "deny") {
    return failed(`${where.project}: the policy denies ${capability}`);
  }
  return plugin === undefined
    ? failed(`${where.project}: no connector for ${capability} in the project file's "connectors"`)
    : { kind: "ok", value: { plugin, rule } };
}

async function declared(home: string, plugin: string, capability: PostPoint): Promise<Done> {
  const entry = await registered(home, plugin);
  if (entry.kind === "failed") {
    return entry;
  }
  return entry.value.writes.includes(capability)
    ? { kind: "ok" }
    : failed(`the plugin ${plugin} did not declare the write ${capability}; it may not perform it`);
}

// the project's spec store, which the approval is checked against (spec-store.ts, #381)
export type SpecsFor = (project: string) => Promise<Result<SpecStore>>;

// what request and confirm run with: the plugin setup, and the spec store of the draft's project; the local one under
// <home>/specs when none is given
export type RequestSetup = Setup & { readonly specs?: SpecsFor };

// approvalAt : the draft's ticket's approval, checked against its project's spec store
async function approvalAt(
  setup: RequestSetup,
  where: Where,
): Promise<Result<{ readonly key: string; readonly at: string }>> {
  if (setup.specs === undefined) {
    return approvalOf(where);
  }
  const store = await setup.specs(where.project);
  return store.kind === "ok" ? approvalOf({ ...where, store: store.value }) : store;
}

// planOf : the write's plan, after the approval, the policy and the plugin's declared writes are each checked
async function planOf(setup: RequestSetup, capability: PostPoint, draft: Draft): Promise<Result<Plan>> {
  const home = setup.home;
  const where = { home, project: draft.project, ticket: draft.ticket };
  const approval = await approvalAt(setup, where);
  if (approval.kind === "failed") {
    return approval;
  }
  const rule = await ruleOf(where, capability);
  if (rule.kind === "failed") {
    return rule;
  }
  const writes = await declared(home, rule.value.plugin, capability);
  return writes.kind === "ok"
    ? {
        kind: "ok",
        value: { where, capability, ...rule.value, approval: approval.value.key, approvedAt: approval.value.at },
      }
    : writes;
}

// room : the writes of the plan's capability since its approval, while the cap has room for one more
export async function room(plan: Plan<PolicyPoint>): Promise<Result<number>> {
  const log = await readLog(plan.where);
  if (log.kind === "failed") {
    return log;
  }
  const n = counted(log.value, plan.capability, plan.approval);
  return n < plan.rule.cap
    ? { kind: "ok", value: n }
    : failed(
        `${plan.where.project}/${plan.where.ticket}: the cap is reached, ${n} of ${plan.rule.cap} ${plan.capability} since the approval of ${plan.approvedAt}`,
      );
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function now(): string {
  return new Date().toISOString();
}

function answerOf(result: Awaited<ReturnType<typeof callPlugin>>): Result<string> {
  if (result.kind === "failed") {
    return result;
  }
  const { kind, fields } = result.value;
  const url = typeof fields.url === "string" ? fields.url : "";
  const why = typeof fields.reason === "string" ? `: ${fields.reason}` : "";
  return kind === DONE ? { kind: "ok", value: url } : failed(`the plugin answered ${kind}${why}`);
}

// a write's call: the url it went out at ("" when none), or why it failed
export type Sender = () => Promise<Result<string>>;

// pluginSender : the call of the plugin the plan names, with the built op and input
function pluginSender(setup: Setup, plan: Plan, write: Built): Sender {
  return async () =>
    answerOf(
      await callPlugin(setup, { plugin: plan.plugin, capability: plan.capability, op: write.op, input: write.input }),
    );
}

// perform : one write, under the ticket's lock: a place under the cap, the reserved line, `before` (confirm removes
// its pending file there, so it cannot go out twice), the call, and its outcome line
export async function perform(
  plan: Plan<PolicyPoint>,
  text: string,
  send: Sender,
  before: () => Promise<Done>,
): Promise<Confirmed> {
  const n = await room(plan);
  if (n.kind === "failed") {
    return n;
  }
  const id = randomBytes(6).toString("hex");
  const reserved = await appendLine(plan.where, {
    kind: "reserved",
    id,
    capability: plan.capability,
    approval: plan.approval,
    at: now(),
    sha256: sha256(text),
  });
  const ready = reserved.kind === "ok" ? await before() : reserved;
  return ready.kind === "ok" ? sent(plan, send, { id, count: n.value + 1 }) : ready;
}

async function sent(
  plan: Plan<PolicyPoint>,
  send: Sender,
  at: { readonly id: string; readonly count: number },
): Promise<Confirmed> {
  const answer = await send();
  const detail = answer.kind === "ok" ? answer.value : answer.reason;
  await appendLine(plan.where, { kind: answer.kind === "ok" ? "done" : "failed", id: at.id, at: now(), detail });
  return answer.kind === "ok"
    ? { kind: "done", count: at.count, cap: plan.rule.cap, url: answer.value }
    : failed(`${plan.capability} on ${plan.where.project}/${plan.where.ticket} failed (it still counts): ${detail}`);
}

// quoted : one shell word, in single quotes, that the shell passes through byte for byte
export function quoted(text: string): string {
  return `'${text.replace(/'/g, "'\\''")}'`;
}

// the draft as its capability's schema holds it, so confirm reads it back with the same check
const STORED: Readonly<Record<PostPoint, (d: Draft) => object>> = {
  "tracker.comment": (d) => ({ project: d.project, ticket: d.ticket, text: d.text, items: d.items }),
  "tracker.create": (d) => ({ project: d.project, ticket: d.ticket, title: d.title, text: d.text, items: d.items }),
  notify: (d) => ({ project: d.project, ticket: d.ticket, text: d.text }),
};

function idOf(plan: Plan, hex: string): string {
  return `${plan.where.project}/${plan.where.ticket}/${plan.capability}/${hex}`;
}

async function kept(plan: Plan, draft: Draft, write: Built): Promise<Requested> {
  const n = await room(plan);
  if (n.kind === "failed") {
    return n;
  }
  const hex = randomBytes(6).toString("hex");
  const id = idOf(plan, hex);
  const record: Pending = {
    id,
    plugin: plan.plugin,
    approval: plan.approval,
    draft: STORED[plan.capability](draft),
    text: write.text,
  };
  const saved = await keepPending(plan.where.home, hex, record, now());
  return saved.kind === "ok"
    ? { kind: "pending", id, text: write.text, command: `agent-factory confirm ${id} ${quoted(shown(write.text))}` }
    : saved;
}

// shown : the text as a person can check it: the invisible word joiners left out
export function shown(text: string): string {
  return text.replace(JOINER, "");
}

function nothing(): Promise<Done> {
  return Promise.resolve({ kind: "ok" });
}

// planned : the plan, and the write built from the draft
async function planned(
  setup: RequestSetup,
  capability: PostPoint,
  draft: Draft,
): Promise<Result<readonly [Plan, Built]>> {
  const plan = await planOf(setup, capability, draft);
  if (plan.kind === "failed") {
    return plan;
  }
  const write = built(capability, draft);
  return write.kind === "ok" ? { kind: "ok", value: [plan.value, write.value] } : write;
}

async function requested(setup: RequestSetup, capability: PostPoint, draft: Draft): Promise<Requested> {
  const both = await planned(setup, capability, draft);
  if (both.kind === "failed") {
    return both;
  }
  const [plan, write] = both.value;
  const run = () =>
    plan.rule.mode === "allow"
      ? perform(plan, write.text, pluginSender(setup, plan, write), nothing)
      : kept(plan, draft, write);
  return unwrapped(await onTicket(plan.where, () => okOf(run())));
}

// okOf, unwrapped : onTicket guards a Result; these carry their own cases, so they ride in one
async function okOf<T extends Requested>(run: Promise<T>): Promise<Result<T>> {
  return { kind: "ok", value: await run };
}

function unwrapped<T extends Requested>(r: Result<T>): T | { readonly kind: "failed"; readonly reason: string } {
  return r.kind === "ok" ? r.value : r;
}

// request : one write the coordinator asks for: refused, done (allow) or pending (confirm)
export async function request(setup: RequestSetup, capability: string, draftText: string): Promise<Requested> {
  const point = pointOf(capability);
  if (point.kind === "failed") {
    return point;
  }
  const draft = draftOf(point.value, draftText);
  return draft.kind === "ok" ? requested(setup, point.value, draft.value) : draft;
}

// sameAsPending : the plan and the write made again now, and the pending request they must match
function sameAsPending(id: Id, [plan, write]: readonly [Plan, Built], pending: Pending, given: string): Done {
  const checks: readonly (readonly [boolean, string])[] = [
    [
      plan.where.project === id.where.project && plan.where.ticket === id.where.ticket,
      "the pending request names another ticket than its id; request it again",
    ],
    [shown(given) === shown(pending.text), "the text is not the pending request's text; nothing went out"],
    [write.text === pending.text, "the pending request was changed after it was made; request it again"],
    [plan.approval === pending.approval, "the ticket was approved again since; request it again"],
    [
      plan.plugin === pending.plugin,
      `the project file now maps ${plan.capability} to ${plan.plugin}; request it again`,
    ],
  ];
  const bad = checks.find(([ok]) => !ok);
  return bad === undefined ? { kind: "ok" } : failed(bad[1]);
}

async function confirmedLocked(
  setup: RequestSetup,
  id: Id & { readonly capability: PostPoint },
  given: { readonly id: string; readonly text: string },
): Promise<Confirmed> {
  const pending = await readPending(id, given.id);
  if (pending.kind === "failed") {
    return pending;
  }
  const draft = draftOf(id.capability, JSON.stringify(pending.value.draft));
  const both = draft.kind === "ok" ? await planned(setup, id.capability, draft.value) : draft;
  if (both.kind === "failed") {
    return both;
  }
  const same = sameAsPending(id, both.value, pending.value, given.text);
  const remove = () => dropPending(setup.home, id.hex);
  const [plan, write] = both.value;
  return same.kind === "ok" ? perform(plan, write.text, pluginSender(setup, plan, write), remove) : same;
}

// confirm : the pending request with that id, performed, when the text given is its text
export async function confirm(setup: RequestSetup, id: string, text: string): Promise<Confirmed> {
  const parsedId = parseId(setup.home, id);
  if (parsedId.kind === "failed") {
    return parsedId;
  }
  const capability = pointOf(parsedId.value.capability);
  if (capability.kind === "failed") {
    return capability;
  }
  return unwrapped(
    await onTicket(parsedId.value.where, () =>
      okOf(confirmedLocked(setup, { ...parsedId.value, capability: capability.value }, { id, text })),
    ),
  );
}
