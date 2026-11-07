import { describe, expect, it } from "vitest";
import { statusBox } from "../src/core/review/status.js";

function files(map: Readonly<Record<string, string>>): (path: string) => Promise<string> {
  return async (path) => map[path] ?? "";
}

describe("statusBox (#117)", () => {
  it("sends CI config, code owners and agent instruction files to the human, and lists build files apart", async () => {
    const touched = [
      ".github/workflows/ci.yml",
      ".gitlab-ci.yml",
      "docs/CODEOWNERS",
      "svc/AGENTS.md",
      "CLAUDE.local.md",
      ".claude/settings.json",
      "x/.agents/a.md",
      "pom.xml",
      "src/Main.java",
      "Makefile",
    ];
    const box = await statusBox({ touched, before: files({}), after: files({}) });
    expect(box).toEqual({
      kind: "ok",
      value: {
        protected: [
          ".github/workflows/ci.yml",
          ".gitlab-ci.yml",
          "docs/CODEOWNERS",
          "svc/AGENTS.md",
          "CLAUDE.local.md",
          ".claude/settings.json",
          "x/.agents/a.md",
        ],
        build: ["pom.xml", "Makefile"],
        added: [],
      },
    });
  });

  it("names each new dependency, from every manifest it reads; a kept or bumped one is not new", async () => {
    const before = files({
      "package.json": JSON.stringify({ dependencies: { react: "18.0.0" } }),
      "pom.xml": "<dependency><groupId>org.a</groupId><artifactId>old</artifactId><version>1</version></dependency>",
      "build.gradle.kts": 'implementation("org.a:old:1.0")',
      "gradle/libs.versions.toml": '[libraries]\nold = { module = "org.a:old", version = "1" }\n',
      "requirements.txt": "requests==2.0\n",
      "go.mod": "module x\nrequire github.com/a/old v1.0.0\n",
    });
    const after = files({
      "package.json": JSON.stringify({ dependencies: { react: "18.3.1" }, devDependencies: { "left-pad": "1.0.0" } }),
      "pom.xml":
        "<dependency><groupId>org.a</groupId><artifactId>old</artifactId><version>2</version></dependency><dependency><groupId>org.b</groupId><artifactId>new</artifactId></dependency>",
      "build.gradle.kts": 'implementation("org.a:old:2.0")\ntestImplementation("org.c:fresh:1.0")',
      "gradle/libs.versions.toml":
        '[libraries]\nold = { module = "org.a:old", version = "2" }\nnew = "org.d:cat:1.0"\n',
      "requirements.txt": "requests==2.1\nflask>=3\n",
      "go.mod": "module x\nrequire github.com/a/old v1.1.0\nrequire github.com/b/new v0.1.0\n",
    });
    const touched = [
      "package.json",
      "pom.xml",
      "build.gradle.kts",
      "gradle/libs.versions.toml",
      "requirements.txt",
      "go.mod",
    ];
    const box = await statusBox({ touched, before, after });
    expect(box.kind === "ok" ? box.value.added : []).toEqual([
      "left-pad (package.json)",
      "org.b:new (pom.xml)",
      "org.c:fresh (build.gradle.kts)",
      "org.d:cat (gradle/libs.versions.toml)",
      "flask (requirements.txt)",
      "github.com/b/new (go.mod)",
    ]);
  });

  it("a manifest new in the change lists all its dependencies; a broken one lists none and never fails", async () => {
    const box = await statusBox({
      touched: ["package.json", "web/package.json"],
      before: files({}),
      after: files({ "package.json": JSON.stringify({ dependencies: { a: "1" } }), "web/package.json": "{not json" }),
    });
    expect(box.kind === "ok" ? box.value.added : []).toEqual(["a (package.json)"]);
  });

  it("reads no option line of requirements and no replace or exclude block of go.mod as a dependency", async () => {
    const box = await statusBox({
      touched: ["requirements.txt", "go.mod"],
      before: files({}),
      after: files({
        "requirements.txt": "-r base.txt\n--index-url https://example.invalid/simple\n# a comment\nflask==3\n",
        "go.mod":
          "module x\nrequire github.com/a/real v1.0.0\nreplace (\n\tgithub.com/a/real v1.0.0 => github.com/fork/real v1.0.1\n)\nexclude (\n\tgolang.org/x/bad v0.1.0\n)\n",
      }),
    });
    expect(box.kind === "ok" ? box.value.added : []).toEqual([
      "flask (requirements.txt)",
      "github.com/a/real (go.mod)",
    ]);
  });
});
