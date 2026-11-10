# T2 review round 1 — deslop/SKILL.md (#32)

File: skills worktree feat+32-code-deslop, plugins/rulebook/skills/deslop/SKILL.md (117 lines).
Verified: frontmatter `name: deslop` = folder; description 380 chars with "Use when"; Rules, Steps, "Done when" (:46) present;
DS13/DS5/DS7/DS8/DS9 = plan row 53, ledger meaning + because kept, ≤35 words; DS15 applied (no `shouldXxx`/AssertJ; test shape cites
U2 only); categories traced to oc deslop :12-22 and ctk deslop :12-16; edge 1 = ledger X4/DS5a :535; DS8 blocks byte-identical to
this worktree's 68f; README row added.

## Act on
1. SKILL.md:54 (type laundering) — SE5 owns untrusted JSON only ("no `Map<String,Object>` past the adapter"), not any map where a
   record fits. Edit look-for to "untrusted JSON held as `Map<String, Object>` past the adapter" or drop SE5 from the owner cell.
2. SKILL.md:78 (DS8 Bad) — `if (…) return;` has no braces: breaks JV9 (java.md) as well as DS8. In 68f write
   `if (destination == null || invoiceService == null) {\n        return;\n    }`; re-copy.

## Consider
3. SKILL.md:56 — "a retry" sits under DS5 · DS7, neither of which covers retries. Add CC8 (`concurrency.md`) or drop "retry".
4. SKILL.md:65 — "Fix inline … a `final`": TY4 forbids editing an old line only to add `final`. Write "a `final` on a line the
   branch added (TY4)".
5. SKILL.md:51-60 — owner paths `code/references/…` do not resolve from `deslop/`; only :60 is a real link (`../testing/…`).
   Use `../code/references/<x>.md` links throughout.

## Operator flags
- SKILL.md:13, :39-41 — "keep the pass uncommitted until green; if red, revert the whole pass, do not fix forward" comes only from
  the old agent-platform deslop skill (ours, :138, :150). oc and ctk deslop are silent. Format rule 4: our repo is evidence, not
  a rule source. Approve or drop.

## Noted
- :55 "keep anything that carries a domain name" is oc deslop :17 ("do not add domain meaning").
- :90 Good elision comment is presentation.

## Dismissed
- "Restates a rule another file owns": none found; each row names its owner.
