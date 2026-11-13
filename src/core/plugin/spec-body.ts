// spec-body — a spec change in the issue store, sent as the issue's new body (#542; ADR-0012 S2). The coordinator
// edits <home>/specs/<project>/<ticket>/spec.md (it reads the issue's body first with `agent-factory spec --show`), and
// runs `agent-factory request spec.body --file <that file>`. The request is always kept, never sent at once (the
// policy is confirm or deny, policy.ts): it prints `agent-factory confirm <id> '<the whole new body>'`, and the
// person's yes in the harness prompt sends it through the project's forge (Forge.setIssueBody).
//
// A body is sent only when, at request and again at confirm: the project keeps its specs in the issue store, the
// ticket is an issue number, the text may be posted (postableSpec), the policy is not deny, and the cap has room. A
// spec change needs no approval, since it is mostly made before one: the cap counts per approval, or per "unapproved"
// when there is none. At confirm the text must be the kept text byte for byte, and the issue's body must still be the
// one seen at request, so a person's edit in between is never written over. Nothing here throws.

import { createHash, randomBytes } from "node:crypto";
import { relative, sep } from "node:path";
import type { Done, Result } from "../forge/api.js";
import type { Forge } from "../forge/types.js";
import { readApproval } from "../approval.js";
import { plainName, postableSpec, specHash } from "../spec.js";
import { readPluginConfig, type PolicyPoint } from "./config.js";
import { dropPending, keepPending, readPending, type Id, type Pending } from "./pending.js";
import { now, perform, quoted, room, type Confirmed, type Plan, type Requested, type SpecsFor } from "./request.js";
import { approvalKey, onTicket, type Where } from "./writes.js";

export const SPEC_BODY: PolicyPoint = "spec.body";
// the plugin a spec.body plan names: the project's own forge, whichever connector serves it
const FORGE = "forge";
const ISSUE = /^[1-9]\d{0,9}$/;
const UNAPPROVED = "unapproved";

export type Issues = Pick<Forge, "issueBody" | "setIssueBody">;

export type SpecBodySetup = {
  readonly home: string;
  // the project's spec store, which must be the issue store
  readonly specs: SpecsFor;
  // the project's forge, which reads the issue's body and sets it
  readonly issues: (project: string) => Promise<Result<Issues>>;
};

type Body = Where & { readonly text: string };

// what one spec.body write needs: the plan perform takes, the forge, the issue's body now and the approved spec's hash
type BodyPlan = {
  readonly plan: Plan<PolicyPoint>;
  readonly issues: Issues;
  readonly base: string;
  readonly approvedHash: string;
};

function failed(reason: string): { readonly kind: "failed"; readonly reason: string } {
  return { kind: "failed", reason };
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

// specBodyOf : the body from its file, <home>/specs/<project>/<ticket>/spec.md, its text as it is
export function specBodyOf(
  input: { readonly home: string; readonly specs: string; readonly file: string },
  text: string,
): Result<Body> {
  const parts = relative(input.specs, input.file).split(sep);
  const [project = "", ticket = ""] = parts;
  const named = [project, ticket].every(plainName) && parts.join("/") === `${project}/${ticket}/spec.md`;
  return named
    ? { kind: "ok", value: { home: input.home, project, ticket, text } }
    : failed(`a ${SPEC_BODY} request takes the spec file, <home>/specs/<project>/<ticket>/spec.md; got ${input.file}`);
}

// sendable : the store, the ticket and the text, checked before anything is read from the git host
async function sendable(setup: SpecBodySetup, body: Body): Promise<Done> {
  const problems = postableSpec(body.text);
  if (problems.length > 0) {
    return failed(`the spec cannot be sent as the issue's body:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  }
  if (!ISSUE.test(body.ticket)) {
    return failed(`the ticket is the issue number in the issue store, got ${JSON.stringify(body.ticket)}`);
  }
  const store = await setup.specs(body.project);
  if (store.kind === "failed") {
    return store;
  }
  return store.value.kind === "issue"
    ? { kind: "ok" }
    : failed(`${body.project} keeps its specs in local files: edit the spec.md itself; nothing is sent`);
}

// ruleOf : the policy's rule for spec.body; deny refuses it
async function ruleOf(where: Where): Promise<Result<Plan<PolicyPoint>["rule"]>> {
  const config = await readPluginConfig(where);
  if (config.kind === "failed") {
    return config;
  }
  const rule = config.value.policy[SPEC_BODY];
  return rule.mode === "deny"
    ? failed(`${where.project}: the policy denies ${SPEC_BODY}`)
    : { kind: "ok", value: rule };
}

// approvalOf : the approval the write counts against, and the spec hash it approved; "unapproved" when there is none
async function approvalOf(
  where: Where,
): Promise<Result<{ readonly key: string; readonly at: string; readonly hash: string }>> {
  const stored = await readApproval(where);
  if (stored.kind === "refused") {
    return failed(stored.reason);
  }
  return stored.kind === "record"
    ? { kind: "ok", value: { key: approvalKey(stored.record), at: stored.record.at, hash: stored.record.spec_hash } }
    : { kind: "ok", value: { key: UNAPPROVED, at: "none", hash: "" } };
}

// baseOf : the forge, and the sha256 of the issue's body as it is now
async function baseOf(setup: SpecBodySetup, body: Body): Promise<Result<Pick<BodyPlan, "issues" | "base">>> {
  const issues = await setup.issues(body.project);
  if (issues.kind === "failed") {
    return issues;
  }
  const current = await issues.value.issueBody({ number: Number(body.ticket) });
  return current.kind === "ok" ? { kind: "ok", value: { issues: issues.value, base: sha256(current.value) } } : current;
}

// bodyPlan : every check above, then the plan; the issue is read last, after nothing local refused
async function bodyPlan(setup: SpecBodySetup, body: Body): Promise<Result<BodyPlan>> {
  const where = { home: body.home, project: body.project, ticket: body.ticket };
  const ok = await sendable(setup, body);
  if (ok.kind === "failed") {
    return ok;
  }
  const rule = await ruleOf(where);
  if (rule.kind === "failed") {
    return rule;
  }
  const approval = await approvalOf(where);
  if (approval.kind === "failed") {
    return approval;
  }
  const base = await baseOf(setup, body);
  if (base.kind === "failed") {
    return base;
  }
  const plan = {
    where,
    capability: SPEC_BODY,
    plugin: FORGE,
    approval: approval.value.key,
    approvedAt: approval.value.at,
    rule: rule.value,
  };
  return { kind: "ok", value: { plan, ...base.value, approvedHash: approval.value.hash } };
}

// kept : the request, kept for the person's confirm with the command that sends it
async function kept(body: Body, p: BodyPlan): Promise<Requested> {
  const n = await room(p.plan);
  if (n.kind === "failed") {
    return n;
  }
  const hex = randomBytes(6).toString("hex");
  const id = `${body.project}/${body.ticket}/${SPEC_BODY}/${hex}`;
  const record: Pending = { id, plugin: FORGE, approval: p.plan.approval, draft: {}, text: body.text, base: p.base };
  const saved = await keepPending(body.home, hex, record, now());
  return saved.kind === "ok"
    ? { kind: "pending", id, text: body.text, command: `agent-factory confirm ${id} ${quoted(body.text)}` }
    : saved;
}

// requestSpecBody : a spec change kept for the person's confirm, or why it is refused
export async function requestSpecBody(setup: SpecBodySetup, body: Body): Promise<Requested> {
  const run = async (): Promise<Result<Requested>> => {
    const p = await bodyPlan(setup, body);
    return { kind: "ok", value: p.kind === "ok" ? await kept(body, p.value) : p };
  };
  const done = await onTicket(body, run);
  return done.kind === "ok" ? done.value : done;
}

// sameAsKept : the plan made again now, and the kept request it must match
function sameAsKept(p: BodyPlan, pending: Pending, given: string): Done {
  const checks: readonly (readonly [boolean, string])[] = [
    [given === pending.text, "the text is not the kept request's text; nothing went out"],
    [p.plan.approval === pending.approval, "the ticket was approved again since; request it again"],
    [p.base === pending.base, "the issue's body changed since the request; read it again with spec --show"],
  ];
  const bad = checks.find(([ok]) => !ok);
  return bad === undefined ? { kind: "ok" } : failed(bad[1]);
}

// sender : the issue's body set to the text
function sender(p: BodyPlan, text: string): () => Promise<Result<string>> {
  return async () => {
    const set = await p.issues.setIssueBody({ number: Number(p.plan.where.ticket), text });
    return set.kind === "ok" ? { kind: "ok", value: "" } : set;
  };
}

// staleNote : what the person must do when the ticket was approved and its spec now differs
function staleNote(p: BodyPlan, text: string): { readonly note?: string } {
  return p.approvedHash !== "" && p.approvedHash !== specHash(text)
    ? { note: "the ticket's approval is now stale: approve the new spec again" }
    : {};
}

async function confirmedLocked(
  setup: SpecBodySetup,
  id: Id,
  given: { readonly id: string; readonly text: string },
): Promise<Confirmed> {
  const pending = await readPending(id, given.id);
  if (pending.kind === "failed") {
    return pending;
  }
  const text = pending.value.text;
  const p = await bodyPlan(setup, { ...id.where, text });
  if (p.kind === "failed") {
    return p;
  }
  const same = sameAsKept(p.value, pending.value, given.text);
  const drop = () => dropPending(setup.home, id.hex);
  const done = same.kind === "ok" ? await perform(p.value.plan, text, sender(p.value, text), drop) : same;
  return done.kind === "done" ? { ...done, ...staleNote(p.value, text) } : done;
}

// confirmSpecBody : the kept spec change with that id, sent, when the text given is its text
export async function confirmSpecBody(
  setup: SpecBodySetup,
  id: Id,
  given: { readonly id: string; readonly text: string },
): Promise<Confirmed> {
  const done = await onTicket(id.where, async () => ({ kind: "ok", value: await confirmedLocked(setup, id, given) }));
  return done.kind === "ok" ? done.value : done;
}
