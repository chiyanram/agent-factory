// latest — the installed version against the latest release (#482, ledger pilot row 11), for `init` and
// `setup status`. A newer release is said with its install line and never fails the check: an older install still
// works. When the release list cannot be read (offline, a proxy), the check says so and passes. It reads the release
// list over HTTPS with no login; it is agent-factory's own repo, not a project's, so it does not go through the git
// host seam.

import type { Result } from "../forge/api.js";

export const RELEASES_API = "https://api.github.com/repos/chiyanram/agent-factory/releases/latest";

export type VersionCheck = { readonly ok: true; readonly line: string; readonly fix: string };

// newer : whether version a is newer than b, by its numeric parts. Pure.
export function newer(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  const i = pa.findIndex((n, k) => n !== (pb[k] ?? 0));
  return i >= 0 && (pa[i] ?? 0) > (pb[i] ?? 0);
}

// installLine : the one line that installs a release. Pure.
export function installLine(v: string): string {
  return `npm i -g https://github.com/chiyanram/agent-factory/releases/download/v${v}/chiyanram-agent-factory-${v}.tgz`;
}

// versionCheck : the installed version and the latest release, as one check line. Pure.
export function versionCheck(installed: string, latest: Result<string>): VersionCheck {
  if (latest.kind === "failed") {
    return {
      ok: true,
      line: `agent-factory ${installed}; the latest release could not be read (${latest.reason})`,
      fix: "",
    };
  }
  return newer(latest.value, installed)
    ? {
        ok: true,
        line: `agent-factory ${installed}; ${latest.value} is the latest release: ${installLine(latest.value)}`,
        fix: "",
      }
    : { ok: true, line: `agent-factory ${installed}, the latest release`, fix: "" };
}

// versionIn : the version a release list's answer names; none when it names none. Pure.
function versionIn(body: unknown): string | undefined {
  const tag = typeof body === "object" && body !== null ? Reflect.get(body, "tag_name") : undefined;
  return typeof tag === "string" && /^v\d+\.\d+\.\d+$/.test(tag) ? tag.slice(1) : undefined;
}

// latestRelease : the latest release's version, read with the given fetch; why not, when it cannot be read
export async function latestRelease(get: (url: string) => Promise<Response>): Promise<Result<string>> {
  try {
    const answer = await get(RELEASES_API);
    const version = answer.ok ? versionIn(await answer.json()) : undefined;
    if (version !== undefined) {
      return { kind: "ok", value: version };
    }
    return {
      kind: "failed",
      reason: answer.ok ? "no version in the answer" : `the git host answered ${answer.status}`,
    };
  } catch {
    return { kind: "failed", reason: "no answer" };
  }
}
