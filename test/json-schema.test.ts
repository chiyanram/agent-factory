import { describe, expect, it } from "vitest";
import { unknownKeywords, validate } from "../src/core/process/json-schema.js";

describe("the JSON-schema checker", () => {
  it("runs the keywords it knows", () => {
    const schema = {
      type: "object",
      required: ["a"],
      additionalProperties: false,
      properties: {
        a: { type: "array", minItems: 1, items: { enum: ["x", "y"] } },
        b: { type: "string", minLength: 1, pattern: "^[A-Z]+[0-9]+$" },
        c: { anyOf: [{ type: "boolean" }, { const: "yes" }] },
        d: { type: "array", prefixItems: [{ const: 1 }], items: false },
      },
    };
    expect(validate({ a: ["x"], b: "RV1", c: true, d: [1] }, schema)).toEqual([]);
    expect(validate({ a: [], b: "", c: "no", d: [1, 2], e: 0 }, schema)).toEqual([
      "a: has 0 items, needs at least 1",
      "b: is empty",
      'b: "" does not match ^[A-Z]+[0-9]+$',
      'c: matches no allowed form (c: "no" is not boolean; c: "no" is not "yes")',
      "d[1]: not allowed",
      'the top level: "e" is not a known field',
    ]);
    expect(validate({}, schema)).toEqual(['the top level: "a" is missing']);
  });

  it("refuses a schema that asks for a check it does not run", () => {
    expect(unknownKeywords({ properties: { a: { maximum: 3 } }, if: {} })).toEqual([
      '#: unsupported keyword "if"',
      '#/properties/a: unsupported keyword "maximum"',
    ]);
  });
});
