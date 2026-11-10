# T1 value-bar.md — round 1 (find + verify)

File: skills `.claude/worktrees/feat+31-testing-value-bar/plugins/rulebook/skills/testing/references/value-bar.md` (251 lines, contents line present).
Every openclaw cell was re-read against `test-audit/SKILL.md` (:18-29, :31-35, :39-40, :47-66, :71-73, :96-109). All of them hold.

| # | bucket | line | finding (verified) | fix |
|---|---|---|---|---|
| 1 | Act on | :65-66, :73-74, :78-79, :94-95, :101-102, :111-112, :116-117, :125-126, :133-134, :138-139, :143-144, :156-157, :164-165, :175-176, :180-181, :194-195, :205-206, :216-217 | Every one of the 9 code blocks has a doubled fence: "```groovy" twice at the top and "```" twice at the bottom. Each block renders as an empty block, then plain text, then another empty block. The code inside matches 68a byte for byte. | Delete one of each doubled fence line, which removes 18 lines |
| 2 | Act on | :48 | The pointer "Spock form: K8" is wrong. K8 is "one rule per data-driven feature, no `if` on a `where:` column", not a name that promises more than its input. | Delete "; Spock form: K8 (`spock.md`)" |
| 3 | Act on | :46 | The pointer "Spock form: K18" is wrong. K18 says not to `Mock()` value objects. Junk pattern 6 is a mock that implements the asserted behaviour. | Delete "; Spock form: K18 (`spock.md`)" |
| 4 | Consider | :205-215 | The V5 Good asserts `new OrderEntity().status == OrderStatus.DRAFT`. coverage-design.md C1 shows the same line as its Bad (:44-46), and C1 Good says "reads the stored row instead of a field default". | Operator: keep both and say why in V5's caption, or change one pair |
| 5 | Consider | :41 | The pointer "Spock form: K19" is weak. K19 covers an unbound `thrown()` that passes for any exception, which is not a test with no assertion. K1 and K10 ("never asserted", "empty then: still asserts") fit better. | Replace it with K1, or delete it |
| 6 | Consider | :226-228 | The edge "keep a promised default over S2" cites only "V5 Good", an example (pattern 6). openclaw :96-97 states it ("default ... contract"). | Add "(openclaw :96-97)" |
| 7 | Consider | :184 | The V4 Good comment "as in S4 Good" points into the body of strategy.md (checklist 1: no link into another reference's body). It is a byte copy of 68a. | Operator decides |
| 8 | Dismissed | — | Pointers S1, S2, S4, TM1 (`strategy.md`), K4, K13 (`spock.md`) and GT5 (`scenario-to-tests.md`) exist and match their claims. | — |
| 9 | Dismissed | — | The checks cover all 4 questions, all 8 junk rows and all 5 retention rows. | — |
