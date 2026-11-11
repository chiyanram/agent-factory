// check-temp-dirs (#222, #485): a tmpdir() call in test/ or scripts/ is refused unless it is realpathSync(tmpdir())
import { describe, expect, it } from "vitest";
import { bareCalls } from "../scripts/check-temp-dirs.js";

describe("bareCalls", () => {
  it("finds a bare tmpdir() call, and passes one wrapped in realpathSync", () => {
    const text = [
      'const a = mkdtempSync(join(tmpdir(), "x-"));',
      'const b = mkdtempSync(join(realpathSync(tmpdir()), "x-"));',
      "const c = realpathSync( tmpdir( ) ) + tmpdir();",
    ].join("\n");
    expect(bareCalls("scripts/x.ts", text)).toEqual(["scripts/x.ts:1", "scripts/x.ts:3"]);
  });
});
