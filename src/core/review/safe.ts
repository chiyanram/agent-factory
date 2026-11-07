// safe — a file-system step as a result, never a throw: a full disk or a file race fails one review step, never the
// whole dispatcher pass.

import type { Result } from "../forge/api.js";

export async function attempt<T>(step: () => Promise<T>, reason: string): Promise<Result<T>> {
  try {
    return { kind: "ok", value: await step() };
  } catch {
    return { kind: "failed", reason };
  }
}
