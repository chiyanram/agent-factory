import type { Result } from "../src/core/forge/api.js";

export const noRunFolder = async (): Promise<Result<string>> => ({ kind: "ok", value: "/nonexistent/run-folder" });
