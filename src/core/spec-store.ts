// spec-store — the spec store a project's setting picks (#381; spec.ts says what each store is). The project file's
// "specStore" (settings/variables.ts) is local, the default and the work rule, or issue, for a personal project: the
// spec is then the body of the git host issue whose number is the ticket, read through the forge seam, and checked and
// hashed exactly as a local spec is, so an edit to the issue makes its approval stale.
//
// The issue store opens the forge only when it reads, so a command on a local-store project never calls the git host.

import { join } from "node:path";
import type { Result } from "./forge/api.js";
import type { Forge } from "./forge/types.js";
import { settingName, settingOf } from "./settings/machine.js";
import { SPEC_STORES, type SpecStoreKind } from "./settings/variables.js";
import type { SpecRead, SpecStore } from "./spec.js";

export type IssueReader = Pick<Forge, "issueBody">;

export type OpenIssues = () => Promise<Result<IssueReader>>;

const ISSUE = /^[1-9]\d{0,9}$/;

export function specStoreKind(env: NodeJS.ProcessEnv): Result<SpecStoreKind> {
  const set = settingOf(env, "specStore") ?? "local";
  const kind = SPEC_STORES.find((k) => k === set);
  return kind === undefined
    ? {
        kind: "failed",
        reason: `${settingName("specStore")} must be one of ${SPEC_STORES.join(", ")}, got ${JSON.stringify(set)}`,
      }
    : { kind: "ok", value: kind };
}

export function localStore(home: string): SpecStore {
  return { kind: "local", root: join(home, "specs") };
}

function issueRead(body: Result<string>, where: string): SpecRead {
  if (body.kind === "failed") {
    return { kind: "refused", reason: `cannot read ${where}: ${body.reason}` };
  }
  return body.value.trim() === "" ? { kind: "missing", where } : { kind: "found", text: body.value, where };
}

export function issueStore(input: { readonly open: OpenIssues; readonly hostProject: string }): SpecStore {
  return {
    kind: "issue",
    readIssueBody: async (ticket) => {
      if (!ISSUE.test(ticket)) {
        return {
          kind: "refused",
          reason: `the project keeps its specs in the git host issues, so the ticket is the issue number, got ${JSON.stringify(ticket)}`,
        };
      }
      const where = `issue #${ticket} of ${input.hostProject}`;
      const forge = await input.open();
      return issueRead(forge.kind === "ok" ? await forge.value.issueBody({ number: Number(ticket) }) : forge, where);
    },
  };
}

export function specStoreOf(input: {
  readonly env: NodeJS.ProcessEnv;
  readonly home: string;
  readonly open: OpenIssues;
}): Result<SpecStore> {
  const kind = specStoreKind(input.env);
  if (kind.kind === "failed") {
    return kind;
  }
  return {
    kind: "ok",
    value:
      kind.value === "local"
        ? localStore(input.home)
        : issueStore({
            open: input.open,
            hostProject: settingOf(input.env, "gitHostProject") ?? "the git host project",
          }),
  };
}

export function issuesFrom(forge: IssueReader): OpenIssues {
  return () => Promise.resolve({ kind: "ok", value: forge });
}

export function openOnce(open: OpenIssues): OpenIssues {
  let held: Promise<Result<IssueReader>> | undefined;
  return () => {
    held ??= open();
    return held;
  };
}
