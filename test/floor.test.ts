import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rmSync } from "node:fs";
import { floorGuard, forHuman, hitsLine, isTestFile, TEST_FILES, type Hit } from "../src/core/ready/floor.js";
import { judgeFiles } from "../src/core/ready/judge.js";
import { project, type Project } from "./review-repo.js";

let p: Project;
beforeEach(() => {
  p = project("feat/x");
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
  return floorGuard({
    repo: p.clone,
    env: p.env,
    base: "main",
    branch: "factory/PROJ-1",
    head,
    testFiles,
    judgeFiles: [],
    waived: "none",
  });
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
    expect(await hits()).toEqual([
      { file: "src/test/groovy/OrderSpec.groovy", line: 0, what: "deletes a test file", check: "test" },
    ]);
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
    expect(found[1]?.what).toBe(
      "removes an assertion (2 removed, 1 added in this file; line count, the weaker check: no mutation command is set (#495))",
    );
  });

  // AC-2 of #485: the weakened assertion of the ticket's own example, as many lines as before
  it("finds an assertion weakened from a value check to a presence check", async () => {
    p.write(
      "src/test/java/OrderTest.java",
      java("    assertThat(total()).isNotNull();\n    assertThat(count()).isEqualTo(2);\n"),
    );
    const found = await hits();
    expect(found.map((h) => `${h.file}:${h.line} ${h.what}`)).toEqual([
      "src/test/java/OrderTest.java:3 weakens an assertion: a value check became a presence check (line count, the weaker check: no mutation command is set (#495))",
    ]);
    expect(forHuman(found)).toBe(true);
  });

  it("is silent on a value check changed to another value check, and on a presence check added beside the value checks", async () => {
    p.write(
      "src/test/java/OrderTest.java",
      java(
        "    assertThat(total()).isEqualTo(4);\n    assertThat(count()).isEqualTo(2);\n    assertThat(order()).isNotNull();\n",
      ),
    );
    expect(await hits()).toEqual([]);
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
    const input = {
      repo: p.clone,
      env: p.env,
      branch: "factory/PROJ-1",
      testFiles: TEST_FILES,
      judgeFiles: [],
      waived: "none",
    };
    expect(await floorGuard({ ...input, base: "no-such-branch", head })).toMatchObject({ kind: "failed" });
    expect(await floorGuard({ ...input, base: "main", head: "1".repeat(40) })).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("the head moved"),
    });
  });

  it("counts every assertion style: assertEquals, self.assertEqual, assert_eq!, Go's t.Errorf", async () => {
    p.write("src/test/java/CalcTest.java", "class CalcTest {\n  void a() {\n    assertEquals(1, a());\n  }\n}\n");
    p.write("svc/test_calc.py", "def test_a(self):\n    self.assertEqual(a(), 1)\n");
    p.write("lib/calc_test.go", 'func TestA(t *testing.T) {\n\tif a() != 1 {\n\t\tt.Errorf("bad")\n\t}\n}\n');
    p.write("tests/calc.rs", "fn a() {\n    assert_eq!(a(), 1);\n}\n");
    p.commitAll("more tests");
    p.git("push", "-q", "origin", "factory/PROJ-1");
    p.git("checkout", "-q", "main");
    p.git("merge", "-q", "--ff-only", "factory/PROJ-1");
    p.git("push", "-q", "origin", "main");
    p.git("checkout", "-q", "factory/PROJ-1");
    p.write("src/test/java/CalcTest.java", "class CalcTest {\n  void a() {\n  }\n}\n");
    p.write("svc/test_calc.py", "def test_a(self):\n    a()\n");
    p.write("lib/calc_test.go", "func TestA(t *testing.T) {\n\tif a() != 1 {\n\t}\n}\n");
    p.write("tests/calc.rs", "fn a() {\n    a();\n}\n");
    expect((await hits()).map((h) => h.file)).toEqual([
      "lib/calc_test.go",
      "src/test/java/CalcTest.java",
      "svc/test_calc.py",
      "tests/calc.rs",
    ]);
  });

  it("finds a test moved out of the test files, and the common skip and focus markers", async () => {
    p.git("mv", "src/test/java/OldNameTest.java", "docs/OldName.txt");
    p.write(
      "web/more.test.ts",
      "it.skipIf(ci)('a', () => {});\ndescribe.skip.each([1])('b', () => {});\nxtest('c');\ntest.only('d');\nfit('e');\n",
    );
    p.write(
      "src/test/java/MoreTest.java",
      "class MoreTest {\n  @DisabledOnOs(OS.MAC)\n  @org.junit.Ignore\n  void a() {}\n}\n",
    );
    p.write(
      "src/test/groovy/MoreSpec.groovy",
      "class MoreSpec extends Specification {\n  @Requires({ false })\n  @IgnoreRest\n  def 'a'() {}\n}\n",
    );
    p.write("svc/test_more.py", "@pytest.mark.xfail\ndef test_a(self):\n    self.skipTest('later')\n");
    p.write("lib/more_test.go", "func TestB(t *testing.T) {\n\tt.SkipNow()\n}\n");
    const found = await hits();
    expect(found.find((h) => h.file === "src/test/java/OldNameTest.java")?.what).toContain("moves a test file out");
    expect(found.filter((h) => h.what === "adds a skip marker").map((h) => `${h.file}:${h.line}`)).toEqual([
      "lib/more_test.go:2",
      "src/test/groovy/MoreSpec.groovy:2",
      "src/test/groovy/MoreSpec.groovy:3",
      "src/test/java/MoreTest.java:2",
      "src/test/java/MoreTest.java:3",
      "svc/test_more.py:1",
      "svc/test_more.py:3",
      "web/more.test.ts:1",
      "web/more.test.ts:2",
      "web/more.test.ts:3",
      "web/more.test.ts:4",
      "web/more.test.ts:5",
    ]);
  });

  it("reads through a .gitattributes that marks the files binary, and a path that looks like a pattern", async () => {
    p.write(".gitattributes", "*.java -diff\n");
    p.write(
      "src/test/java/OrderTest.java",
      java("    @Disabled\n    assertThat(total()).isEqualTo(3);\n    assertThat(count()).isEqualTo(2);\n"),
    );
    expect((await hits()).map((h) => `${h.file}:${h.line}`)).toEqual(["src/test/java/OrderTest.java:3"]);
  });

  it("keeps a Spock block inside its method, and finds a spec by what it extends", async () => {
    p.write(
      "src/test/groovy/OrderSpec.groovy",
      "class OrderSpec extends Specification {\n  def 'totals'() {\n    when:\n    def t = order.total()\n    then:\n    t == 3\n  }\n\n  def helper() {\n    return 1\n  }\n}\n",
    );
    p.write(
      "src/test/groovy/CartTest.groovy",
      "class CartTest extends spock.lang.Specification {\n  def 'a'() {\n    expect:\n    1 == 1\n  }\n}\n",
    );
    p.commitAll("cart");
    p.git("push", "-q", "origin", "factory/PROJ-1");
    p.git("checkout", "-q", "main");
    p.git("merge", "-q", "--ff-only", "factory/PROJ-1");
    p.git("push", "-q", "origin", "main");
    p.git("checkout", "-q", "factory/PROJ-1");
    // the then: line goes, a helper's lines come: they are no assertions; the CartTest spec loses its expect: line
    p.write(
      "src/test/groovy/OrderSpec.groovy",
      "class OrderSpec extends Specification {\n  def 'totals'() {\n    when:\n    def t = order.total()\n    then:\n  }\n\n  def helper() {\n    return 1\n  }\n\n  def other() {\n    return 2\n  }\n}\n",
    );
    p.write(
      "src/test/groovy/CartTest.groovy",
      "class CartTest extends spock.lang.Specification {\n  def 'a'() {\n    expect:\n  }\n}\n",
    );
    expect((await hits()).map((h) => `${h.file}:${h.line}`)).toEqual([
      "src/test/groovy/CartTest.groovy:4",
      "src/test/groovy/OrderSpec.groovy:6",
    ]);
  });

  it("finds a catch whose body the diff emptied, a raise turned into pass, and no reason in a bare comment", async () => {
    p.write(
      "src/main/Pay.java",
      "class Pay {\n  void a() {\n    try {\n      go();\n    } catch (IOException e) {\n      throw new PayFailed(e);\n    }\n  }\n}\n",
    );
    p.write("svc/pay.py", "try:\n    go()\nexcept ValueError:  # bad input\n    raise\n");
    p.commitAll("pay");
    p.git("push", "-q", "origin", "factory/PROJ-1");
    p.git("checkout", "-q", "main");
    p.git("merge", "-q", "--ff-only", "factory/PROJ-1");
    p.git("push", "-q", "origin", "main");
    p.git("checkout", "-q", "factory/PROJ-1");
    p.write(
      "src/main/Pay.java",
      "class Pay {\n  void a() {\n    try {\n      go();\n    } catch (IOException e) {\n    }\n  }\n}\n",
    );
    p.write("svc/pay.py", "try:\n    go()\nexcept ValueError:  # bad input\n    pass\n");
    p.write("src/main/Raw.java", 'class Raw {\n  /**/\n  @SuppressWarnings("rawtypes")\n  void a() {}\n}\n');
    expect((await hits()).map((h) => `${h.file}:${h.line} ${h.what}`)).toEqual([
      "src/main/Pay.java:5 leaves an empty catch",
      "src/main/Raw.java:3 adds a suppression with no reason on the line above",
      "svc/pay.py:3 leaves an empty catch",
    ]);
  });

  it("is silent on a line only moved or re-indented, and on a submodule bump", async () => {
    p.write("src/main/Old.java", 'class Old {\n@SuppressWarnings("all")\nvoid a() {}\n}\n');
    p.commitAll("old");
    p.git("push", "-q", "origin", "factory/PROJ-1");
    p.git("checkout", "-q", "main");
    p.git("merge", "-q", "--ff-only", "factory/PROJ-1");
    p.git("push", "-q", "origin", "main");
    p.git("checkout", "-q", "factory/PROJ-1");
    p.write("src/main/Old.java", 'class Old {\n    @SuppressWarnings("all")\n    void a() {}\n}\n');
    p.git("update-index", "--add", "--cacheinfo", `160000,${p.git("rev-parse", "HEAD")},vendor/lib`);
    expect(await hits()).toEqual([]);
  });

  it("says the hits in one line, the first ten; a test check goes to a person, a code check to the writer", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      file: `t${i}.test.ts`,
      line: i + 1,
      what: "adds a skip marker",
      check: "test" as const,
    }));
    const line = hitsLine(many);
    expect(line).toContain("t0.test.ts:1 adds a skip marker");
    expect(line).toContain("and 2 more");
    expect(line).toContain("A person decides");
    expect(forHuman(many)).toBe(true);
    const code = [{ file: "a.ts", line: 2, what: "leaves an empty catch", check: "code" as const }];
    expect(hitsLine(code)).toContain("Fix the code (VB6)");
    expect(forHuman(code)).toBe(false);
  });
});

// the guard with the judge files a project with a local gate of `make verify` has, and a waiver at a head or none
async function judgedAt(head: string, waived = "none"): Promise<readonly Hit[]> {
  const out = await floorGuard({
    repo: p.clone,
    env: p.env,
    base: "main",
    branch: "factory/PROJ-1",
    head,
    testFiles: TEST_FILES,
    judgeFiles: JUDGE,
    waived,
  });
  if (out.kind === "failed") {
    throw new Error(out.reason);
  }
  return out.value;
}

const JUDGE = judgeFiles({
  gate: { kind: "local", verify: ["make", "verify", "-f", "ci/verify.mk"] },
  ready: { programs: ["make"], timeoutSeconds: 60, testFiles: TEST_FILES, judgeFiles: ["checks/**"] },
  egress: { allow: [] },
});

function pushed(message: string): string {
  const head = p.commitAll(message);
  p.git("push", "-q", "origin", "factory/PROJ-1");
  return head;
}

const lines = (found: readonly Hit[]): readonly string[] => found.map((h) => `${h.file}:${h.line} ${h.what}`);

describe("the judge files (S4, #231)", () => {
  it("stops a build-file edit and a test-config edit, as test checks for a person", async () => {
    p.write("build.gradle", "plugins { id 'java' }\n");
    p.write("web/jest.config.js", "module.exports = { testMatch: [] };\n");
    p.write("svc/conftest.py", "collect_ignore = ['test_cart.py']\n");
    p.write("src/main/Order.java", "class Order {}\n");
    const found = await judgedAt(pushed("judge files"));
    expect(lines(found)).toEqual([
      "build.gradle:0 adds a judge file",
      "svc/conftest.py:0 adds a judge file",
      "web/jest.config.js:0 adds a judge file",
    ]);
    expect(found.every((h) => h.check === "test")).toBe(true);
  });

  it("stops a change, a move or a deletion of the verify command's files and the project's own", async () => {
    p.git("checkout", "-q", "main");
    p.write("Makefile", "verify:\n\ttrue\n");
    p.write("ci/verify.mk", "x:\n\ttrue\n");
    p.write("checks/run.sh", "true\n");
    p.write("pom.xml", "<project/>\n");
    p.commitAll("judge files on main");
    p.git("push", "-q", "origin", "main");
    p.git("checkout", "-q", "-B", "factory/PROJ-1", "main");
    p.write("Makefile", "verify:\n\t@true\n");
    p.git("mv", "ci/verify.mk", "ci/other.mk");
    p.git("rm", "-q", "checks/run.sh");
    p.git("rm", "-q", "pom.xml");
    expect(lines(await judgedAt(pushed("loosen the judges")))).toEqual([
      "Makefile:0 changes a judge file",
      "checks/run.sh:0 deletes a judge file",
      "ci/other.mk:0 moves a judge file",
      "pom.xml:0 deletes a judge file",
    ]);
  });
});

describe("fewer test cases in a test file that stays (S1, #231)", () => {
  it("finds a removed @Test, Spock feature and it(, but not a renamed case or a moved file", async () => {
    p.git("checkout", "-q", "main");
    p.write("src/test/java/CartTest.java", "class CartTest {\n  @Test\n  void a() {}\n  @Test\n  void b() {}\n}\n");
    p.write("web/cart.test.ts", "it('adds', () => {});\nit('drops', () => {});\nconst ok = /x/.test(s);\n");
    p.write("src/test/groovy/CartSpec.groovy", "class CartSpec extends Specification {\n  def 'a'() {}\n}\n");
    p.write("src/test/java/RenameTest.java", "class RenameTest {\n  @Test\n  void old() {}\n}\n");
    p.commitAll("tests on main");
    p.git("push", "-q", "origin", "main");
    p.git("checkout", "-q", "-B", "factory/PROJ-1", "main");
    p.write("src/test/java/CartTest.java", "class CartTest {\n  @Test\n  void a() {}\n}\n");
    p.write("web/cart.test.ts", "it('adds', () => {});\n");
    p.write("src/test/groovy/CartSpec.groovy", "class CartSpec extends Specification {\n}\n");
    p.write("src/test/java/RenameTest.java", "class RenameTest {\n  @Test\n  void renamed() {}\n}\n");
    expect(lines(await judgedAt(pushed("fewer cases")))).toEqual([
      "src/test/groovy/CartSpec.groovy:2 removes a test case (1 removed, 0 added in this file)",
      "src/test/java/CartTest.java:4 removes a test case (1 removed, 0 added in this file)",
      "web/cart.test.ts:2 removes a test case (1 removed, 0 added in this file)",
    ]);
  });
});

describe("a human's waiver at a head (#231)", () => {
  it("clears the hits at its head; a new head that changes the same file flags it again", async () => {
    p.write("build.gradle", "plugins { id 'java' }\n");
    p.write("src/main/Pay.java", "class Pay {\n  void a() {\n    try { go(); } catch (Exception e) {}\n  }\n}\n");
    const first = pushed("a judge file and an empty catch");
    expect(lines(await judgedAt(first))).toEqual([
      "build.gradle:0 adds a judge file",
      "src/main/Pay.java:3 leaves an empty catch",
    ]);
    // the waiver clears the test check at its head; a code check still goes to the writer
    expect(lines(await judgedAt(first, first))).toEqual(["src/main/Pay.java:3 leaves an empty catch"]);
    p.write("src/main/Pay.java", "class Pay {\n  void a() {\n    go();\n  }\n}\n");
    const second = pushed("fix the catch");
    // only the new interdiff is checked: build.gradle did not change again, so it stays cleared
    expect(await judgedAt(second, first)).toEqual([]);
    p.write("build.gradle", "plugins { id 'java'; id 'groovy' }\n");
    p.write("svc/test_cart.py", "@pytest.mark.skip\ndef test_cart():\n    pass\n");
    const third = pushed("change the judge file again, and add a skip");
    expect(lines(await judgedAt(third, first))).toEqual([
      "build.gradle:0 adds a judge file",
      "svc/test_cart.py:1 adds a skip marker",
    ]);
  });

  it("clears nothing when git cannot diff against the waiver's head", async () => {
    p.write("build.gradle", "plugins { id 'java' }\n");
    const head = pushed("a judge file");
    expect(lines(await judgedAt(head, "2".repeat(40)))).toEqual(["build.gradle:0 adds a judge file"]);
  });
});
