import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const dir = mkdtempSync(join(tmpdir(), "a-"));
