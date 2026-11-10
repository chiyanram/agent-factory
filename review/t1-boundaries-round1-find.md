## Intent
T1 (#31, map #30): boundaries.md (B1-B3) plus a good `## Rules (ours)` fixture and its test case.

## Standards
No critical findings. Verified: code blocks in all 3 Good/Bad pairs are byte-identical to 68a:488-594; B1-B3 keep ledger meaning and reason; no Aruvii names; `check_sizes.py` exits 0 on the file; fixture goes red when the heading is broken (`## Rules (our)` -> "no ## Rules section", rc 1). pytest not installed here, so the test file itself was not run.

### 1. [warning] Review B1 is weaker than Rule B1   Standards
Location  boundaries.md:150-151 (vs :16-17, table :31-38)
Rule      B1; checklist 10 ("one check per Rule")
Finding   The rule demands every CORRECT letter per input. The check says "find the cases its table row names"; the number row names Range only. A file with Range cases and no Conformance/Existence passes B1.
Evidence  Row "a number" = "Range"; check opens only that row.

### 2. [warning] Review B2 needs judgement to map a case to a letter   Standards
Location  boundaries.md:152-154
Rule      B2; checklist 2/11 (decidable by grep or reader)
Finding   The check says "find all seven letters", but only `skip:` lines are greppable. Nothing says where a covered letter is named. The `CORRECT for parse:` header exists only in the Good example (:104-108), not in the rule or the check.
Evidence  `grep -n "skip:"` finds skips; no pattern finds covered letters.

### 3. [warning] Table cells and row 6 have no approved source   Standards
Location  boundaries.md:33-38, :40
Rule      Map #30 ("no rule invented"); checklist 5
Finding   Row 6 (Reference) is outside the ledger's B2 trigger list and duplicates C2 (dependency unavailable, coverage-design.md). "One case whose order differs" and "each with its own expected result" appear in no ledger row or cited plinth line (plinth correct.md:67 says "exact order assertions"). The only citation is a bare filename, `plinth 130-...correct.md`, with no line.
Evidence  19-approved-rules.md:20 B2 trigger list; plinth correct.md:119, :67, :149.

### 4. [warning] Second Decided edge restates P2 and points into another ref   Standards
Location  boundaries.md:140-142
Rule      Checklist 1 (no link into another ref's body), 9, WD7 (one owner)
Finding   P2 belongs to property-based.md. The edge is not an exception, it is P2 restated. `property-based.md` does not exist yet (testing/ holds only boundaries.md). The name is correct once T1 lists it (34 §1: testing/references/property-based.md, same folder), so the pointer survives, but it dangles until then.
Evidence  34-l1-file-plan.md:57; ledger P2.

### 5. [nit] Dangling or unsourced pointers and claims
Location  boundaries.md:41, :89, :115, :137; edge "Confidence high" (:137, :142)
Finding   `plinth` is undefined for a plugin reader and the file is not shipped. "(Real evidence: ledger row B1)" is template-sanctioned (00-reference-format skeleton) but names a file the installed plugin lacks. No source states "high".

### 6. [nit] Decided edge 1 restates B2
Location  boundaries.md:137-139
Finding   "Do not skip when the reason is left out" is B2's own text, not an exception. The "Skip when" predicate rests only on the 68a Good header.

### 7. [nit] Register
Location  boundaries.md:3-4 (33 words), :29-30 (25 words)
Rule      00-reference-format Register (sentences <=20 words)

### 8. [nit] Fixture is thin
Location  tests/fixtures/sizes/rules-heading-ours/.../demo.md
Finding   Its one short rule proves the heading matches, not that the section is measured. Checked in scratch: a 40-word rule under `(ours)` does fail, so behaviour is right but unproven by the fixture.

## Spec
B1-B3 met (:16-22); Good/Bad pairs match source; five sections present in order; fixture and CASES entry present. Review checks gap: findings 1-2.

## Receipts
boundaries.md, test_fixture_checks.py diff, fixture demo.md, check_sizes.py, 19-approved-rules.md:15-24, 68a:480-600, 00-reference-format.md, 34-l1-file-plan.md, plinth correct.md, gh issues 30/31.
