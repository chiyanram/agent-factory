// The toolchain folders the srt runner allows back read-only inside the hidden home (#371): a known manager found from
// PATH, the srt.readOnly setting, and the refusals (the home, outside it, a credential path, a manager's config or
// shims), on a planted home. No srt and no real toolchain needed.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  expand,
  folderProblem,
  locateToolchains,
  MANAGERS,
  managersOn,
  shimWarnings,
  toolchainLines,
} from "../src/core/box/srt-toolchains.js";
import { tempDir } from "./temp.js";

const ROOT = tempDir("srt-toolchains-");
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

// a planted home with each manager's folders, a credential folder and a plain tool folder
function plantHome(name: string): string {
  const home = join(ROOT, name);
  for (const dir of [
    ".local/share/mise/installs/java/25.0.1/bin",
    ".local/share/mise/shims",
    ".config/mise",
    ".sdkman/candidates/java/25-tem/bin",
    ".asdf/installs/nodejs/22.12.0/bin",
    ".asdf/shims",
    ".nvm/versions/node/v22.12.0/bin",
    ".ssh",
    ".cargo/bin",
    "Documents",
    ".factory",
  ]) {
    mkdirSync(join(home, dir), { recursive: true });
  }
  writeFileSync(join(home, ".ssh", "id_ed25519"), "not a key\n");
  return home;
}

const H = "/home/op";
const F = "/home/op/.factory";

describe("srt toolchains: the pure parts (#371)", () => {
  it("knows mise, SDKMAN!, asdf and nvm, each with its install folder", () => {
    expect(MANAGERS.map((m) => [m.name, m.installs])).toEqual([
      ["mise", ".local/share/mise/installs"],
      ["SDKMAN!", ".sdkman/candidates"],
      ["asdf", ".asdf/installs"],
      ["nvm", ".nvm/versions"],
    ]);
  });

  it("finds each manager from a PATH entry inside its install folder", () => {
    const cases: readonly (readonly [string, string, string])[] = [
      ["mise", `${H}/.local/share/mise/installs/java/25.0.1/bin`, `${H}/.local/share/mise/installs`],
      ["SDKMAN!", `${H}/.sdkman/candidates/java/current/bin`, `${H}/.sdkman/candidates`],
      ["asdf", `${H}/.asdf/installs/nodejs/22.12.0/bin`, `${H}/.asdf/installs`],
      ["nvm", `${H}/.nvm/versions/node/v22.12.0/bin`, `${H}/.nvm/versions`],
    ];
    for (const [name, entry, dir] of cases) {
      expect(managersOn(["/usr/bin", entry], H)).toEqual([{ dir, from: name }]);
    }
    // none on PATH, or only the manager's own bin or shims: nothing comes back
    expect(managersOn(["/usr/bin", `${H}/.local/bin`, `${H}/.local/share/mise/shims`, `${H}/.asdf/shims`], H)).toEqual(
      [],
    );
  });

  it("refuses the home, a folder outside it, a credential path or one that holds one, and a manager's config or shims", () => {
    expect(folderProblem(H, H, F)).toContain("your home itself");
    expect(folderProblem("/opt/jdk", H, F)).toContain("not under your home");
    expect(folderProblem("/home/opx/tools", H, F)).toContain("not under your home");
    expect(folderProblem(`${H}/.ssh`, H, F)).toContain("~/.ssh, a credential path");
    expect(folderProblem(`${H}/.config`, H, F)).toContain("a credential path");
    expect(folderProblem(`${H}/.m2`, H, F)).toContain("~/.m2/settings.xml, a credential path");
    expect(folderProblem(`${H}/.gradle`, H, F)).toContain("~/.gradle/gradle.properties");
    expect(folderProblem(`${H}/.docker/cli-plugins`, H, F)).toContain("~/.docker");
    expect(folderProblem(F, H, F)).toContain("the factory home");
    expect(folderProblem(`${H}/.config/mise`, H, F)).toContain("mise's config");
    expect(folderProblem(`${H}/.local/share/mise`, H, F)).toContain("mise's shims");
    expect(folderProblem(`${H}/.asdf`, H, F)).toContain("asdf's shims");
    // a manager's install folder and a plain tool folder may come back
    for (const m of MANAGERS) {
      expect(folderProblem(join(H, m.installs), H, F)).toBe("");
    }
    expect(folderProblem(`${H}/.cargo`, H, F)).toBe("");
  });

  it("reads a srt.readOnly entry as ~/x or an absolute path, nothing else", () => {
    expect(expand("~/.cargo", H)).toBe(`${H}/.cargo`);
    expect(expand("~", H)).toBe(H);
    expect(expand("~/a/../..", H)).toBe("/home");
    expect(expand("/opt/x/", H)).toBe("/opt/x/");
    expect(expand(".cargo", H)).toBeUndefined();
  });

  it("warns when PATH reaches a manager only through its shims, and says what to do", () => {
    const [warning, ...rest] = shimWarnings(["/usr/bin", `${H}/.local/share/mise/shims`], H);
    expect(rest).toEqual([]);
    expect(warning).toContain("PATH reaches mise only through its shims (~/.local/share/mise/shims)");
    expect(warning).toContain("mise activate");
    expect(shimWarnings([`${H}/.asdf/shims`], H)[0]).toContain("~/.asdf/installs/java/<version>/bin");
    // with the real install folder on PATH too, there is no warning
    expect(shimWarnings([`${H}/.local/share/mise/shims`, `${H}/.local/share/mise/installs/java/25/bin`], H)).toEqual(
      [],
    );
  });

  it("prints a risk line per folder allowed back, then each refusal and warning", () => {
    const lines = toolchainLines(
      { allowed: [{ dir: `${H}/.sdkman/candidates`, from: "SDKMAN!" }], refused: ["r"], warnings: ["w"] },
      H,
    );
    expect(lines).toEqual([
      "risk: the run reads ~/.sdkman/candidates (SDKMAN!), read-only: a secret kept in it can be read by the run",
      "refused: r",
      "warning: w",
    ]);
  });
});

describe("srt toolchains: on a planted home (#371)", () => {
  it("allows back each detected manager's install folder, found from PATH", async () => {
    const home = plantHome("managers");
    const path = [
      join(home, ".local/share/mise/installs/java/25.0.1/bin"),
      join(home, ".sdkman/candidates/java/25-tem/bin"),
      join(home, ".asdf/installs/nodejs/22.12.0/bin"),
      join(home, ".nvm/versions/node/v22.12.0/bin"),
      "/usr/bin",
    ].join(":");
    const found = await locateToolchains({ env: { PATH: path }, home, factoryHome: join(home, ".factory") });
    expect(found).toEqual({
      allowed: [
        { dir: join(home, ".local/share/mise/installs"), from: "mise" },
        { dir: join(home, ".sdkman/candidates"), from: "SDKMAN!" },
        { dir: join(home, ".asdf/installs"), from: "asdf" },
        { dir: join(home, ".nvm/versions"), from: "nvm" },
      ],
      refused: [],
      warnings: [],
    });
  });

  it("allows back srt.readOnly's folders, and refuses each bad entry with the reason", async () => {
    const home = plantHome("setting");
    const env = {
      PATH: "/usr/bin",
      FACTORY_SRT_READ_ONLY: JSON.stringify([
        "~/.cargo",
        "~",
        "/usr",
        "~/.ssh",
        "~/.config/mise",
        "~/missing",
        ".cargo",
        "~/.local/share/mise/shims",
      ]),
    };
    const found = await locateToolchains({ env, home, factoryHome: join(home, ".factory") });
    expect(found.allowed).toEqual([{ dir: join(home, ".cargo"), from: "srt.readOnly" }]);
    expect(found.refused).toEqual([
      'srt.readOnly "~" is your home itself, which the srt runner hides',
      'srt.readOnly "/usr" is not under your home; list only folders under it (one outside it is not hidden)',
      'srt.readOnly "~/.ssh" is or holds ~/.ssh, a credential path, which no run may read',
      `srt.readOnly "~/.config/mise" is or holds ~/.config/mise, mise's config, which no run may read`,
      'srt.readOnly "~/missing" is not a folder',
      'srt.readOnly ".cargo" must be ~/<folder> or an absolute path',
      `srt.readOnly "~/.local/share/mise/shims" is or holds ~/.local/share/mise/shims, mise's shims, which no run may read`,
    ]);
    // a PATH-style list works too; a broken JSON list is refused whole
    const colon = await locateToolchains({
      env: { FACTORY_SRT_READ_ONLY: "~/.cargo:~/Documents" },
      home,
      factoryHome: join(home, ".factory"),
    });
    expect(colon.allowed.map((t) => t.dir)).toEqual([join(home, ".cargo"), join(home, "Documents")]);
    const bad = await locateToolchains({
      env: { FACTORY_SRT_READ_ONLY: "[1" },
      home,
      factoryHome: join(home, ".factory"),
    });
    expect(bad.refused).toEqual([
      `FACTORY_SRT_READ_ONLY must be a list of folders under your home, such as ["~/.cargo"]`,
    ]);
  });

  it("warns on a shims-only PATH and allows nothing back for it", async () => {
    const home = plantHome("shims");
    const found = await locateToolchains({
      env: { PATH: [join(home, ".local/share/mise/shims"), "/usr/bin"].join(":") },
      home,
      factoryHome: join(home, ".factory"),
    });
    expect(found.allowed).toEqual([]);
    expect(found.warnings[0]).toContain("PATH reaches mise only through its shims");
  });

  it("lists a folder once when a manager and srt.readOnly both name it", async () => {
    const home = plantHome("twice");
    const found = await locateToolchains({
      env: {
        PATH: join(home, ".nvm/versions/node/v22.12.0/bin"),
        FACTORY_SRT_READ_ONLY: JSON.stringify(["~/.nvm/versions"]),
      },
      home,
      factoryHome: join(home, ".factory"),
    });
    expect(found.allowed).toEqual([{ dir: join(home, ".nvm/versions"), from: "nvm" }]);
  });
});
