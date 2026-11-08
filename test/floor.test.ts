import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rmSync } from "node:fs";
import { floorGuard, hitsLine, isTestFile, TEST_FILES, type Hit } from "../src/core/ready/floor.js";
import { project, type Project } from "./review-repo.js";

let p: Project;
beforeEach(() => {
  p = project();
  // main holds a test with assertions, a Spock spec and a test the change may move
  p.write(
    "src/test/java/OrderTest.java",
    "class OrderTest {\n  void total() {\n    assertThat(total()).isEqualTo(3);\n    assertThat(count()).isEqualTo(2);\n  }\n}\n",
  );
  p.write(
    "src/test/groovy/OrderSpec.groovy",
    "class OrderSpec extends Specification {\n  def 'totals'() {\n    when:\n    def t = order.total()\n    then:\n    t == 3\n    and:\n    order.count == 2\n  }\n}\n",
  );
  p.write(
    "src/test/java/OldNameTest.java",
    "class OldNameTest {\n  void a() {\n    assertThat(a()).isTrue();\n  }\n}\n",
  );
  p.commitAll("tests on main");
  p.git("push", "-q", "origin", "main");
  p.git("checkout", "-q", "-b", "factory/PROJ-1");
});
afterEach(() => rmSync(p.root, { recursive: true, force: true }));

async function guard(testFiles: readonly string[] = TEST_FILES) {
  const head = p.commitAll("the writer's change");
  p.git("push", "-q", "origin", "factory/PROJ-1");
  return floorGuard({ repo: p.clone, env: p.env, base: "main", branch: "factory/PROJ-1", head, testFiles });
}

async function hits(testFiles?: readonly string[]): Promise<readonly Hit[]> {
  const out = await guard(testFiles);
  if (out.kind === "failed") {
    throw new Error(out.reason);
  }
  return out.value;
}

const java = (body: string) => `class OrderTest {\n  void total() {\n${body}  }\n}\n`;

describe("the floor guard (#190)", () => {
  it("is silent on a diff that only adds a test, or removes a skip", async () => {
    p.write("src/test/java/NewTest.java", "class NewTest {\n  void b() {\n    assertThat(b()).isTrue();\n  }\n}\n");
    expect(await hits()).toEqual([]);
  });

  it("finds an added skip marker in a test file, in each test language", async () => {
    p.write(
      "src/test/java/OrderTest.java",
      java("    @Disabled\n    assertThat(total()).isEqualTo(3);\n    assertThat(count()).isEqualTo(2);\n"),
    );
    p.write("web/cart.test.ts", "describe.skip('cart', () => {});\nxit('adds', () => {});\n");
    p.write("svc/test_cart.py", "@pytest.mark.skip\ndef test_cart():\n    pass\n");
    expect((await hits()).map((h) => `${h.file}:${h.line} ${h.what}`)).toEqual([
      "src/test/java/OrderTest.java:3 adds a skip marker",
      "svc/test_cart.py:1 adds a skip marker",
      "web/cart.test.ts:1 adds a skip marker",
      "web/cart.test.ts:2 adds a skip marker",
    ]);
  });

  it("finds a deleted test file, and follows a moved one", async () => {
    p.git("rm", "-q", "src/test/groovy/OrderSpec.groovy");
    p.git("mv", "src/test/java/OldNameTest.java", "src/test/java/NewNameTest.java");
    expect(await hits()).toEqual([{ file: "src/test/groovy/OrderSpec.groovy", line: 0, what: "deletes a test file" }]);
  });

  it("finds removed assertions, but not a changed one, and follows them across a move", async () => {
    p.write("src/test/java/OrderTest.java", java("    assertThat(total()).isEqualTo(4);\n"));
    p.git("mv", "src/test/java/OldNameTest.java", "src/test/java/Moved.java");
    p.write("src/test/java/Moved.java", "class OldNameTest {\n  void a() {\n  }\n}\n");
    const found = await hits();
    expect(found.map((h) => `${h.file}:${h.line}`)).toEqual([
      "src/test/java/OldNameTest.java:3",
      "src/test/java/OrderTest.java:3",
      "src/test/java/OrderTest.java:4",
    ]);
    expect(found[1]?.what).toBe("removes an assertion (2 removed, 1 added in this file)");
  });

  it("reads every statement of a Spock then: or expect: block as an assertion, and an and: inside it too", async () => {
    p.write(
      "src/test/groovy/OrderSpec.groovy",
      "class OrderSpec extends Specification {\n  def 'totals'() {\n    when:\n    def t = order.total()\n    then:\n    t == 3\n    and:\n  }\n}\n",
    );
    expect((await hits()).map((h) => `${h.file}:${h.line}`)).toEqual(["src/test/groovy/OrderSpec.groovy:8"]);
  });

  it("finds a suppression with no reason on the line above, in any file; a reason there is silent", async () => {
    p.write(
      "src/main/Order.java",
      'class Order {\n  @SuppressWarnings("unchecked")\n  void a() {}\n  // the API hands back a raw list\n  @SuppressWarnings("rawtypes")\n  void b() {}\n}\n',
    );
    p.write("web/cart.ts", "// eslint-disable-next-line no-explicit-any\n// @ts-ignore\nconst x = 1;\n");
    expect((await hits()).map((h) => `${h.file}:${h.line}`)).toEqual([
      "src/main/Order.java:2",
      "web/cart.ts:1",
      "web/cart.ts:2",
    ]);
  });

  it("finds an empty catch, in braces or as except: pass", async () => {
    p.write(
      "src/main/Pay.java",
      "class Pay {\n  void a() {\n    try { go(); } catch (Exception e) {}\n    try { go(); } catch (IOException e) {\n    }\n  }\n}\n",
    );
    p.write("svc/pay.py", "try:\n    go()\nexcept Exception:\n    pass\n");
    expect((await hits()).map((h) => `${h.file}:${h.line}`)).toEqual([
      "src/main/Pay.java:3",
      "src/main/Pay.java:4",
      "svc/pay.py:3",
    ]);
  });

  it("takes the project's own test globs instead of the built-in ones", async () => {
    p.write("checks/cart_check.rb", "skip_this = 1\nxit('adds')\n");
    expect(await hits(["checks/**"])).toMatchObject([{ file: "checks/cart_check.rb", line: 2 }]);
    expect(isTestFile("checks/cart_check.rb", TEST_FILES)).toBe(false);
    expect(isTestFile("src/test/java/A.java", TEST_FILES)).toBe(true);
    expect(isTestFile("test/a.ts", TEST_FILES)).toBe(true);
  });

  it("fails, never passes, when it cannot read the diff: no default branch, or a head that moved", async () => {
    p.write("a.txt", "a\n");
    const head = p.commitAll("a");
    p.git("push", "-q", "origin", "factory/PROJ-1");
    const input = { repo: p.clone, env: p.env, branch: "factory/PROJ-1", testFiles: TEST_FILES };
    expect(await floorGuard({ ...input, base: "no-such-branch", head })).toMatchObject({ kind: "failed" });
    expect(await floorGuard({ ...input, base: "main", head: "1".repeat(40) })).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("the head moved"),
    });
  });

  it("says the hits in one line, the first ten, and how to keep one on purpose", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      file: `t${i}.test.ts`,
      line: i + 1,
      what: "adds a skip marker",
    }));
    const line = hitsLine(many);
    expect(line).toContain("t0.test.ts:1 adds a skip marker");
    expect(line).toContain("and 2 more");
    expect(line).toContain("report asked");
  });
});
