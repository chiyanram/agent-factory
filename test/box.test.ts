import { describe, expect, it } from "vitest";
import { chooseBox, openBox, pinImage } from "../src/core/box/index.js";
import { boxContract } from "./box-contract.js";
import { fakeBox } from "./fake-box.js";

const EXIT_0 = { kind: "exited", code: 0, stdout: "", stderr: "" } as const;

describe("chooseBox", () => {
  it("refuses when FACTORY_BOX is not set, so setup has to ask", () => {
    expect(chooseBox({})).toEqual({ kind: "refused", reason: "FACTORY_BOX is not set; set it to vm" });
    expect(chooseBox({ FACTORY_BOX: "  " }).kind).toBe("refused");
  });

  it("chooses the vm box and names the risks a person accepts with it", () => {
    const choice = chooseBox({ FACTORY_BOX: "vm" });
    expect(choice.kind).toBe("chosen");
    if (choice.kind !== "chosen") return;
    expect(choice.place).toBe("vm");
    expect(choice.risks.join("\n")).toMatch(/Sysbox/);
    expect(choice.risks.join("\n")).toMatch(/allowlist/);
    expect(choice.risks.join("\n")).toMatch(/model-only token/);
  });

  it("refuses the laptop box until stage B", () => {
    expect(chooseBox({ FACTORY_BOX: "laptop" })).toEqual({
      kind: "refused",
      reason: "FACTORY_BOX=laptop is stage B (#129); use vm",
    });
  });

  it("refuses a place that is not a box", () => {
    expect(chooseBox({ FACTORY_BOX: "host" })).toEqual({
      kind: "refused",
      reason: 'FACTORY_BOX="host" is not a box; use vm',
    });
    expect(chooseBox({ FACTORY_BOX: "VM" }).kind).toBe("refused");
  });
});

describe("pinImage", () => {
  it("keeps an image named by its sha256 digest", () => {
    const ref = `ghcr.io/chiyanram/factory-box:1@sha256:${"0123456789abcdef".repeat(4)}`;
    expect(pinImage(ref)).toEqual({ kind: "pinned", ref });
  });

  it("keeps a local image ID, as box build records it", () => {
    const ref = `sha256:${"0123456789abcdef".repeat(4)}`;
    expect(pinImage(ref)).toEqual({ kind: "pinned", ref });
  });

  it("refuses a tag alone, a short digest, upper-case hex and spaces", () => {
    expect(pinImage("factory-box:latest").kind).toBe("refused");
    expect(pinImage(`factory-box@sha256:${"a".repeat(63)}`).kind).toBe("refused");
    expect(pinImage(`factory-box@sha256:${"A".repeat(64)}`).kind).toBe("refused");
    expect(pinImage(`factory box@sha256:${"a".repeat(64)}`).kind).toBe("refused");
    expect(pinImage(`sha256:${"a".repeat(63)}`).kind).toBe("refused");
    expect(pinImage(`@sha256:${"a".repeat(64)}`).kind).toBe("refused");
  });
});

describe("openBox", () => {
  it("opens the chosen box when its probe answers ready, with the risks to print", async () => {
    const fake = fakeBox({});
    const opened = await openBox({ env: { FACTORY_BOX: "vm" }, boxes: [fake.box] });
    expect(opened.kind).toBe("ready");
    if (opened.kind !== "ready") return;
    expect(opened.box).toBe(fake.box);
    expect(opened.risks.length).toBeGreaterThan(0);
    expect(fake.calls).toEqual([{ op: "probe" }]);
  });

  it("refuses to start when the chosen box does not work, and says why", async () => {
    const fake = fakeBox({ probe: { kind: "missing", reason: "docker: no answer from the daemon" } });
    expect(await openBox({ env: { FACTORY_BOX: "vm" }, boxes: [fake.box] })).toEqual({
      kind: "refused",
      reason: "the vm box is not working: docker: no answer from the daemon",
    });
  });

  it("refuses to start when the chosen place has no box yet", async () => {
    const laptop = fakeBox({ place: "laptop" });
    expect(await openBox({ env: { FACTORY_BOX: "vm" }, boxes: [laptop.box] })).toEqual({
      kind: "refused",
      reason: "the vm box is not built yet (#113)",
    });
    expect(laptop.calls).toEqual([]);
  });

  it("asks no box anything when no place is chosen", async () => {
    const fake = fakeBox({});
    expect((await openBox({ env: {}, boxes: [fake.box] })).kind).toBe("refused");
    expect(fake.calls).toEqual([]);
  });
});

boxContract("fake", () => fakeBox({ runs: [EXIT_0, EXIT_0, EXIT_0, EXIT_0] }).box);
