# 49 · Modern Java rules for JDK 25 (T18 #60)

Candidate rules that make an agent write current, idiomatic Java 25. Target: JDK 25 (operator, 2026-11-04); a feature
still preview in JDK 25 gets no "use it" rule. Bar: ≥2 independent sources, the operator's stated preference, or for
one vendor's own API the vendor's docs (decision V). The reference will hold no provenance; sources stay here and in
the skills ledger.

Two research passes, kept as written: §1 language features, §2 libraries and runtime. Both numbered their candidates
from MJ1; in §0 the library candidates are renumbered MJ10–MJ17 (§2's MJn = MJ(n+9)), and §2 MJ2 (copyOf in records)
merges into §1 MJ2.

## 0 · Summary and approvals

Approvals:

- **Batch 1, language** (operator, 2026-11-04): MJ1, MJ2 (merged with §2 MJ2: "In a record or class holding a
  collection, store `List.copyOf`/`Set.copyOf`/`Map.copyOf` of the argument, never the argument, a view or an array,
  because the caller keeps the original and can change the object later"), MJ3, MJ4, MJ5, MJ6, MJ8, MJ9 as in §1, and
  the JV5 decided edge (record pattern: component type or `_`, not `var`). Not added: MJ7 (`import module`, one
  source); flexible constructor bodies stay rejected (JV11, 2026-10-02).

## 1 · Language features


Scope: records, compact/canonical constructors, sealed types, pattern matching (`instanceof`, `switch`), record
patterns, `when` guards, switch expressions and exhaustiveness, unnamed `_`, text blocks, `var`, flexible
constructor bodies, module imports, compact source files, primitive patterns, preview policy.

Existing rules read on `chiyanram/skills` `origin/main` (fetched 2026-11-04):
`plugins/rulebook/skills/code/references/{java,types,concurrency,errors,smells}.md`. Prior research checked:
`research/49-g9b-candidates.md` §1 (JV1–JV12) and `research/29-java-standards.md` G-A. **JV11 (REJECTED 2026-10-02,
operator): "JEP 513 … not rules — no line of code can break them"**, and **JV10: no JPMS** (decided edge).

### 1 · Feature status in JDK 25 (official: javac source at tag `jdk-25-ga`)

From `Source.java` `enum Feature` (minimum level) and `Preview.java#isPreview` (the only feature returning `true`
is `PRIMITIVE_PATTERNS`):

| feature | final since | in JDK 25 |
|---|---|---|
| `var` (LOCAL_VARIABLE_TYPE_INFERENCE) | 10 | final |
| switch rules / switch expressions / multiple case labels | 14 | final |
| text blocks | 15 | final |
| pattern matching for `instanceof`; records | 16 | final |
| sealed classes | 17 | final |
| pattern `switch`, `case null`, record patterns (nested deconstruction), `when` guards | 21 | final |
| unnamed variables and patterns `_` | 22 | final |
| compact source files / instance `main` (IMPLICIT_CLASSES; `java.lang.IO` `@since 25`) | 25 | final |
| flexible constructor bodies (FLEXIBLE_CONSTRUCTORS) | 25 | final |
| module import declarations (MODULE_IMPORTS) | 25 | final |
| primitive types in patterns, `instanceof`, `switch` (PRIMITIVE_PATTERNS) | — | **preview** (`isPreview` → `true`) |

Preview APIs in 25 per `jdk/internal/javac/PreviewFeature.java`: Structured Concurrency (JEP 505, fifth preview),
Stable Values (JEP 502), PEM encodings (JEP 470). Not language scope; covered by MJ9's policy.

### 2 · Sources

All read in this session. Repos cloned shallow at default branch (commit noted) or fetched from
`raw.githubusercontent.com`. **Organisation** column marks independence: E* and G1 are both Google, so they count
as one; S* and A* are both OpenJDK, so they count as one.

| key | org | what | how read |
|---|---|---|---|
| S1 | OpenJDK | javac `Source.java` feature levels | raw `openjdk/jdk/jdk-25-ga/src/jdk.compiler/share/classes/com/sun/tools/javac/code/Source.java` |
| S2 | OpenJDK | javac `Preview.java` (`isPreview`) | raw `openjdk/jdk/jdk-25-ga/…/javac/code/Preview.java` |
| S3 | OpenJDK | javac diagnostics `compiler.properties` | raw `openjdk/jdk/jdk-25-ga/src/jdk.compiler/share/classes/com/sun/tools/javac/resources/compiler.properties` |
| S4 | OpenJDK | `java.lang.Record` javadoc | raw `openjdk/jdk/jdk-25-ga/src/java.base/share/classes/java/lang/Record.java` |
| S5 | OpenJDK | `PreviewFeature` annotation (preview API list) | raw `openjdk/jdk/jdk-25-ga/src/java.base/share/classes/jdk/internal/javac/PreviewFeature.java` |
| A1 | OpenJDK | Goetz, "Data Classes and Sealed Types" | `openjdk/amber-docs@058be2f` `site/design-notes/records-and-sealed-classes.md` |
| A2 | OpenJDK | Goetz, "Pattern Matching for Java" | `amber-docs` `site/design-notes/patterns/pattern-matching-for-java.md` |
| A3 | OpenJDK | Bimpoudis/Buckley/Goetz, "Safe Switching over Sealed APIs" (2026-08-11) | `amber-docs` `site/guides/exhaustiveness-guide.md` |
| A4 | OpenJDK | Goetz, "Type Patterns in switch" | `amber-docs` `site/design-notes/patterns/type-patterns-in-switch.md` |
| A5 | OpenJDK | Goetz, "Paving the On-Ramp" | `amber-docs` `site/design-notes/on-ramp.md` |
| A6 | OpenJDK | Marks, LVTI style guide | `amber-docs` `site/guides/lvti-style-guide.md` |
| A7 | OpenJDK | Laskey/Marks, text blocks guide | `amber-docs` `site/guides/text-blocks-guide.md` |
| G1 | Google | Google Java Style Guide | `google/styleguide@a3fdba1` (gh-pages) `javaguide.md` |
| E1 | Google | Error Prone `PatternMatchingInstanceof` | `google/error-prone@cc6fd9a` `docs/bugpattern/PatternMatchingInstanceof.md` |
| E2 | Google | Error Prone `IfChainToSwitch` | same repo, `docs/bugpattern/IfChainToSwitch.md` |
| E3 | Google | Error Prone `StatementSwitchToExpressionSwitch` | `docs/bugpattern/StatementSwitchToExpressionSwitch.md` |
| E4 | Google | Error Prone `UnnamedVariable` | `docs/bugpattern/UnnamedVariable.md` |
| E5 | Google | Error Prone `RecordAccessorInCompactConstructor` | `docs/bugpattern/RecordAccessorInCompactConstructor.md` |
| E6 | Google | Error Prone `ArrayRecordComponent` | `docs/bugpattern/ArrayRecordComponent.md` |
| E7 | Google | Error Prone `WildcardImport`, `TraditionalSwitchExpression`, `StringConcatToTextBlock` | `docs/bugpattern/*.md` |
| P1 | jabrena | plinth 141 modern features | `jabrena/plinth@45ead2d` `skills/141-java-refactoring-with-modern-features/references/141-java-refactoring-with-modern-features.md` |
| P2 | jabrena | plinth 142 functional programming | `skills/142-java-functional-programming/references/142-java-functional-programming.md` |
| P3 | jabrena | plinth 128 generics; 123 persistence patterns; 144 DOP | `skills/128-java-generics/references/128-java-generics.md`, `skills/123-java-design-patterns/references/123-database-persistence-patterns.md`, `skills/144-java-data-oriented-programming/references/144-java-data-oriented-programming.md` |
| H1 | Lynricsy | HyperSkills "Java 17 → 21 → 25 in a Spring application" | raw `Lynricsy/HyperSkills/main/skills/java-spring/references/java-language.md` |
| D1 | gleicon | devskills Java 25 review checklist | raw `gleicon/devskills/main/skills/ds-java-review/25.md` |
| K1 | JetBrains | Kotlin KEEP-0454 (explains JEP 513 init order) | raw `Kotlin/KEEP/main/proposals/KEEP-0454-better-immutability-value-classes-MFVC.md` |
| J1 | Jeffallan | claude-skills java-architect | `Jeffallan/claude-skills@078a25c` `skills/java-architect/SKILL.md` |

Not cited (read, judged unreliable): P1 Example 8 puts `import module …` inside `module-info.java`, which is not
legal Java; `wenshao/jdk_internal` `jeps/language/jep-513.md` calls an instance method before `super()`, which
JEP 513 forbids. No GitHub mirror of the JEP texts themselves was found (code search for JEP 513/512 wording).

### 3 · Candidates

### MJ1 — Records for data carriers · final since 16 · **NEW**

> Declare an immutable data carrier as a record, never a class with hand-written accessors, `equals` and
> `hashCode`, because a field added later is easily left out of `equals` and `hashCode`.

Not covered: TY13 governs how a value is *constructed* (constructor or factory, no builder), TY8 when to wrap; no
rule says what a carrier is *declared* as.

- A1: "repetitive code is a good place for bugs to hide; if we can, it is best to eliminate their hiding spots
  outright." / "To write a simple data carrier class responsibly, we have to write a lot of low-value, repetitive
  code: constructors, accessors, `equals()`, `hashCode()`, `toString()`".
- S4: "The implicit declaration of the … `equals`, `hashCode`, and `toString` methods are derived from all of the
  component fields."
- H1: "**Records** (17) are the default shape for DTOs, `@ConfigurationProperties` groups, events and value objects:
  immutable, `equals`/`hashCode` for free, and a compact constructor for validation."
- P3 (144 Ex2): "Use records (which are inherently immutable) whenever possible for data carriers."
- J1: "Use Java 21 LTS features (records, sealed classes, pattern matching)".

Decided edge (H1): "They are the wrong shape for JPA entities — Hibernate needs a mutable, non-final class with a
no-arg constructor." → Skip when the class is a JPA entity.
Misreadable? No. Review check: for each `public boolean equals(`/`public int hashCode(`
(`grep -nE 'public (boolean equals|int hashCode)\('`), a class whose fields are all `final` and whose methods are
only accessors plus these is a finding.

### MJ2 — Defensive copy in the compact constructor · final since 16 · **NEW** (beside TY3)

> In a record's compact constructor, reassign each `List`, `Set` or `Map` component to its `copyOf`, and declare no
> array component, because a record is only shallowly immutable, so the caller's later mutation changes it.

TY3 covers *which* checks go in the compact constructor; nothing covers mutable components.

- S4: "A record class is a shallowly immutable, transparent carrier …" / "The primary reasons to provide an explicit
  declaration for the canonical constructor … are to validate constructor arguments, perform defensive copies on
  mutable components, or normalize groups of components".
- E6: "Arrays are mutable, but records should not be mutable. A client of a record with an array component can
  change the contents of the array." and "Two distinct arrays are never considered equal by `equals` even if their
  contents are the same."
- P3 (128): `public MultiContainer { items = List.copyOf(items); // Defensive copy }`; (123 persistence)
  `Order { lines = List.copyOf(lines); … }`.
- A1: "it is generally incorrect to base the semantics of `equals()` and `hashCode()` on mutable state; doing so
  creates risks that such elements could silently disappear from a `HashSet` or `HashMap`."

Misreadable? Yes — an agent may think `final` on the component is enough.

**Bad**
```java
public record Invoice(InvoiceId id, List<InvoiceLine> lines) {}

final List<InvoiceLine> lines = new ArrayList<>(draftLines);
final Invoice invoice = new Invoice(invoiceId, lines);
lines.clear();
```
The record keeps the caller's list. `lines.clear()` empties the issued invoice, and its hash code changes in any set.

**Good**
```java
public record Invoice(InvoiceId id, List<InvoiceLine> lines) {
    public Invoice {
        lines = List.copyOf(lines);
    }
}
```
The record holds its own unmodifiable copy, so no caller can change it after construction.

Review check: `grep -nE 'record [A-Z][A-Za-z0-9]*(<[^>]*>)?\([^)]*(\b(List|Set|Map|Collection)<|\[\])'`. A
collection component not reassigned to a `copyOf` (or another unmodifiable copy) in the compact constructor is a
finding; an array component is a finding.

Fold-in (one guidance source only, so not a rule): E5 — "using the accessor method (like `d()`) inside a compact
constructor reads the record's underlying field before it has been set". Mechanism confirmed by A1: fields "are
implicitly initialized from their corresponding arguments (`this.x = x`) on exit". Suggest adding to the TY3 review
check: "a compact constructor that calls its own accessor is a finding".

### MJ3 — `instanceof` binds; no cast after a test · final since 16 · **NEW**

> Test and bind in one step with `x instanceof Type t`; never follow an `instanceof` test with a cast, because the
> repeated type name can drift from the test and the cast then throws `ClassCastException`.

- A2: "the needless repetition of the type name provides opportunities for errors to creep unnoticed into
  programs."
- E1: pattern matching "is more concise than an instanceof and a separate cast" (Bad shows
  `if (o instanceof Point) { Point point = (Point) o; … }`).
- P2 (Ex9): "Utilize Pattern Matching for `instanceof` to simplify type checks and casts in a single step."

Misreadable? No (one-liner). Scope it to `.java` files: Groovy flow-types after `instanceof`, so the Spock example
at `testing/references/property-based.md:110` (`if (result instanceof Discount.Applied) {`, no cast) is not a hit.
Review check:
`grep -nE 'instanceof [A-Za-z_][A-Za-z0-9_.]*(<[^>]*>)?[[:space:]]*(\)|&&|\|\|)'`. A test with no binding that is
followed by a cast of the same expression is a finding.

### MJ4 — Pattern `switch` over a sealed type, not an `instanceof` chain · final since 21 · **NEW** (or fold into TY2)

> Dispatch on the subtypes of a sealed type with a pattern `switch`, never an `if`/`else if` chain of `instanceof`
> tests, because the chain has no exhaustiveness check, so a new subtype silently takes the last branch.

TY2 says *how* to switch over a closed set (arrow-form, every case, no `default`) but not that a type test chain
must become that switch; its review check does not catch a chain. Alternative: add "or an `instanceof` chain over
it" to TY2's review check and skip MJ4.

- A2: "the approach allows coding errors to remain hidden -- because we've used an overly-general control
  construct. … there is nothing here that enables the compiler to verify this actually happens."
- E2: "an `if` in the chain could unintentionally have a slightly different condition than others, an ordering bug".
- H1: "Sealed interfaces (17) plus pattern matching for `switch` … turn a result type into something the compiler
  checks" / "no default: adding a case breaks the build".
- A3 (supports TY2 too): "A `default` label is almost never the right answer"; "Where practical, the best approach is
  to handle each permitted subtype with its own `case`."

Misreadable? Yes, it touches TY9 (the trailing "never happens" throw).

**Bad**
```java
String describe(final Payment payment) {
    if (payment instanceof Payment.Card card) {
        return "card ending " + card.last4();
    } else if (payment instanceof Payment.Transfer transfer) {
        return "transfer " + transfer.reference();
    }
    throw new IllegalStateException("unknown payment");
}
```
A new `Payment` subtype compiles and reaches the throw at runtime.

**Good**
```java
String describe(final Payment payment) {
    return switch (payment) {
        case Payment.Card card -> "card ending " + card.last4();
        case Payment.Transfer transfer -> "transfer " + transfer.reference();
    };
}
```
A new subtype fails the build at this switch, and the "never happens" throw is gone.

Review check: `grep -nE 'else if \(.*instanceof'`. A chain of two or more type tests on one sealed-typed variable is
a finding.

### MJ5 — Every `switch` arrow-form; a value-producing switch is an expression · final since 14 · **NEW** (generalises TY2's arrow-form)

> Write every `switch` arrow-form (`case X ->`), and make one that yields a value a switch expression, because a
> colon-form case without `break` falls through and a statement case can forget to assign.

TY2 requires arrow-form only for a sealed type or an enum. MJ5 extends this to `int`/`String` switches at adapters,
and to assignment.

- E3: "Misunderstanding the control flow of a `switch` is a common source of bugs. … new-style arrow (`->`) switches
  are encouraged" / "No `case`s fall through; no control flow analysis needed".
- G1 §4.8.4.4: "Switch expressions must be new-style switches"; §4.8.4.2: "There is no fall-through in new-style
  switches." (Same organisation as E3.)
- A4: "Fallthrough is everyone's least favorite feature of `switch` … (The mistake was making fallthrough the default
  behavior, but that ship has sailed.)"
- A2 (assignment): "If some block -- perhaps one that is executed rarely in practice -- forgets to assign to
  `formatted`, we have a bug."
- P2 (Ex): "Prefer Switch Expressions … over traditional switch statements for assigning the result of a multi-way
  conditional to a variable. … less error-prone (e.g., no fall-through by default …)".

Misreadable? Yes.

**Bad**
```java
PaymentResult result;
switch (responseCode) {
    case 200:
    case 201:
        result = PaymentResult.ACCEPTED;
    case 402:
        result = PaymentResult.DECLINED;
        break;
    default:
        result = PaymentResult.RETRY;
}
```
The missing `break` lets 200 fall into 402, so an accepted payment reads as declined.

**Good**
```java
final PaymentResult result = switch (responseCode) {
    case 200, 201 -> PaymentResult.ACCEPTED;
    case 402 -> PaymentResult.DECLINED;
    default -> PaymentResult.RETRY;
};
```
No case can fall through, and the compiler rejects a case that yields nothing. (`default` is right here: the
selector is an `int`, not a closed set — A3: "For primitive types other than `boolean`, `default` is the only label
that covers all the unlisted values".)

Review check: `grep -nE '\b(case [^>]*|default)[[:space:]]*:([[:space:]]|$)'` (a colon-form label) and
`grep -nE '\byield\b'`. Each hit is a finding. Mechanical, so per OQ3 it could be gated (Error Prone
`StatementSwitchToExpressionSwitch`/`TraditionalSwitchExpression`) instead.

### MJ6 — Unnamed `_` for an intentionally unused variable · final since 22 · **NEW**

> Name an intentionally unused catch parameter, lambda parameter or pattern variable `_`, because a named unused
> variable reads as used and hides a forgotten use from the unused-variable check.

The rulebook already writes `case OpenEnded _ ->` (`code/references/smells.md:118`, `services.md:61`), but no rule
asks for it.

- G1 §5.2.9: "The `_` syntax for unnamed variables and parameters is allowed wherever it is applicable." and §6.2's
  example `} catch (NumberFormatException _) { // it's not numeric; that's fine, just continue }`.
- E4 (same org as G1): "Prefer using an unnamed variable (`_`) to denote variables and patterns that are
  intentionally unused."
- H1: "Unnamed variables and patterns (`_`) — JEP 456 | 22 | Removes unused `catch`/lambda parameters that lint rules
  flag".

Interaction: an empty `catch (… _)` still needs its "why" comment (ER3).

**Bad**
```java
return switch (payment) {
    case Payment.Card card -> Fee.CARD;
    case Payment.Transfer transfer -> Fee.NONE;
};
```
**Good**
```java
return switch (payment) {
    case Payment.Card _ -> Fee.CARD;
    case Payment.Transfer _ -> Fee.NONE;
};
```
The names `card` and `transfer` suggest the arm reads the payment. `_` states that only the type decides.

Review check: reading only (unused-variable detection is the compiler's or Error Prone `UnusedVariable`'s job). A
named binding, catch parameter or lambda parameter that the body never reads is a finding.

### MJ7 — No `import module` · final since 25 · **NO-RULE** (one firm source; offer as an operator preference)

Candidate text, if the operator wants it:
> Import each type with a single-type import; never write `import module`, because it pulls in every exported
> package, so a second module or upgrade adding a same-named type makes the name ambiguous and breaks compilation.

- G1 §3.3.1.1: "Module imports **are not used**." (§3.3.1: "Wildcard ("on-demand") imports, static or otherwise, are
  not used.")
- E7 `WildcardImport` (same org): "They make code brittle and difficult to reason about, both for programmers and
  for tools."
- S3 confirms the failure mode exists: `compiler.err.ref.ambiguous = reference to {0} is ambiguous`.
- Partial / against: D1 "`import module M;` … where a class draws broadly from one module and an explicit import list
  is just noise — not a blanket replacement for targeted imports"; H1 "convenience, not architecture".

Only Google states a ban; the independent sources allow narrow use. Mechanical, so if adopted it is a Checkstyle /
build gate (OQ3), not a review check: `grep -rnE '^import module '`.

### MJ8 — Compact source files only for scripts · final since 25 · **NEW** (low priority)

> Write production code as named classes in a package; keep compact source files (no class header) to scripts
> outside `src/main`, because a compact source file cannot declare a package, so no class can import it.

- S3 (fact): `compiler.err.implicit.class.should.not.have.package.declaration = compact source file should not have
  package declaration`.
- A5 (intent): "simple programs live in the unnamed package, so cannot be accessed from any other package anyway";
  the feature exists so that "simple programs be expressed more simply".
- H1: "Compact source files and instance `main` — JEP 512 | 25 | Scripts and spikes; not application code".
- D1: "Compact source files / instance `main` (JEP 512) only for scripts and small single-file programs … production
  types stay explicitly declared".

Misreadable? No. Review check: `grep -rLE '^[[:space:]]*((public|protected|private|abstract|final|sealed|non-sealed|static|strictfp)[[:space:]]+)*(class|interface|enum|record|@interface)[[:space:]]' --include='*.java' src/main`
(ignore `package-info.java`, `module-info.java`). Each file listed is a finding.

### MJ9 — Preview-feature policy · **NEW**

> Never compile or run production code with `--enable-preview`; use only features final in the target JDK, because a
> preview feature may change or vanish next release, and its class files load only on that JDK.

- S3: `compiler.warn.preview.feature.use = {0} is a preview feature and may be removed in a future release.`;
  `compiler.err.preview.feature.disabled.classfile = class file for {0} uses preview features of Java SE {1}. (use
  --enable-preview to allow loading of class files which contain preview features)`; `compiler.warn.is.preview = {0}
  is a preview API and may be removed in a future release.`
- H1: "A preview feature needs `--enable-preview` at compile *and* run time, and class files compiled with it refuse
  to load on any other JDK version. … Keep production on standard features only." and "Structured concurrency (JEP
  505) is still a preview API in 25 — do not build on it in production."
- D1 (supporting fact): "`StructuredTaskScope` … still **preview** in 25 … so it needs `--enable-preview`".

In JDK 25 this rule bans: primitive patterns (S2), `StructuredTaskScope` (S5), `StableValue` (S5), PEM API (S5).
Misreadable? No. Review check:
`grep -rnE -- '--enable-preview|enablePreview' --include=pom.xml --include='*.gradle' --include='*.kts' --include='*.properties' .`
Each hit outside a test-only or tooling module is a finding; mechanical, so a build gate is the better home (OQ3).

### Status-only and covered items

| item | status in 25 | verdict | note |
|---|---|---|---|
| Primitive patterns (`instanceof int`, `case int i`) | preview (S2 `case PRIMITIVE_PATTERNS -> true`) | **NO-RULE** (preview) | MJ9 bans it. |
| Flexible constructor bodies (statements before `super`) | final 25 (S1) | **NO-RULE** — rejected as JV11 (operator 2026-10-02) | If the operator reopens it, here is a candidate with a concrete failure. Text: "In a subclass constructor, validate arguments and assign this class's fields before `super(...)`, because a superclass constructor that calls an overridden method otherwise reads those fields as null." Sources: D1 "to validate arguments or initialize fields **before** `super(...)`/`this(...)` — instead of static-helper workarounds or an overridable method observing a half-built object"; K1 "initializers run *after* the `super()` call and fields could be seen in a partially initialized state"; H1 "Validate arguments before delegating, instead of in a static helper"; P1 Ex12. The codebase rarely subclasses (records, sealed types), so this matters little. |
| Sealed types | final 17 | **COVERED-BY TY2, TY3** | A3 (2026-08-11) backs TY2: "By default, avoid `default`"; "a `default` is not a true catch-all: it does not handle a `null` selector". Possible TY2 decided edge (only one source, A3): when a permitted subtype is inaccessible, cover the rest with the narrowest match-all `case Payment other`, never `default` or `case Object`. |
| Switch exhaustiveness / no `default` | final 21 | **COVERED-BY TY2** | A3 and H1 above. |
| `case null` | final 21 | **COVERED-BY TY1/TY12** | A3: "preferably, use `Objects.requireNonNull` to reject `null` before the `switch`"; nulls end at the adapter (TY12). |
| Record patterns / nested deconstruction | final 21 | **NO-RULE** | Sources (A2, H1) show it as nicer to read, with no failure named. Use it in Good examples. |
| `var` in a record pattern (`case Paid(var amount, var at)`) | final 21 | **REWORD JV5 (decided edge)** | Proposed edge: "A `var` in a record pattern has no initializer to name the type, so write the component type, or `_` when unused (JV5, MJ6)." A2: "the choice of whether to use a nested type pattern or a nested `var` pattern is solely one of whether the manifest type adds to or distracts from readability" (the same trade-off as for locals). A6 P2: "If understanding a `var` declaration requires the reader to look at several locations … it might not be a good situation in which to use `var`." Confidence medium. H1 writes `case Declined(var reason, var code)`, which is the habit this edge stops. |
| `when` guards | final 21 | **NO-RULE** | javac rejects a dominated case, and guarded cases do not count toward exhaustiveness. The compiler already prevents the failure, and no source gives guidance. |
| Compact constructor validation | final 16 | **COVERED-BY TY3** | S4/A1 back it ("specify only argument validation and normalization"). Add E5's accessor check to TY3's review check (see MJ2). |
| Text blocks | final 15 | **COVERED-BY JV7** | Backed by G1 §4.8.9, E7 `StringConcatToTextBlock`, A7 G1/G2 ("If a string fits on a single line … continue to use a string literal"). No reword needed. |
| `var` | final 10 | **COVERED-BY JV5** | A6 G3 ("Consider `var` when the initializer provides sufficient information"), G6 ("Take care when using `var` with diamond"). |

### 4 · Summary

| id | feature | final since | verdict | sources (independent orgs) |
|---|---|---|---|---|
| MJ1 | records for data carriers | 16 | NEW | A1/S4 (OpenJDK), H1, P3, J1 |
| MJ2 | `copyOf` collection components; no array components | 16 | NEW (+E5 into TY3 check) | S4 (OpenJDK), E6 (Google), P3 |
| MJ3 | `instanceof` binding, no cast | 16 | NEW | A2 (OpenJDK), E1 (Google), P2 |
| MJ4 | pattern `switch`, not `instanceof` chain, over sealed type | 21 | NEW (or fold into TY2 check) | A2/A3 (OpenJDK), E2 (Google), H1 |
| MJ5 | arrow-form switches; switch expression for a value | 14 | NEW | E3/G1 (Google), A2/A4 (OpenJDK), P2 |
| MJ6 | `_` for intentionally unused | 22 | NEW | G1/E4 (Google), H1 |
| MJ7 | no `import module` | 25 | NO-RULE (one firm source; operator-preference candidate) | G1 (Google); D1/H1 partial-against |
| MJ8 | compact source files only for scripts | 25 | NEW (low priority) | S3/A5 (OpenJDK, fact), H1, D1 |
| MJ9 | no `--enable-preview` in production | policy | NEW | S3 (OpenJDK), H1, D1 |
| — | primitive patterns | preview | NO-RULE (preview; MJ9) | S2 |
| — | flexible constructor bodies | 25 | NO-RULE (JV11 rejected; re-proposal text given) | D1, K1, H1, P1 |
| JV5 | `var` in record patterns | 21 | REWORD JV5 (decided edge) | A2, A6 (both OpenJDK; edge of an approved rule) |
| — | sealed, exhaustiveness, `case null`, compact-ctor validation, text blocks, `var` | ≤21 | COVERED-BY TY2/TY1/TY12/TY3/JV7/JV5 | A3, G1, A6, A7 |
| — | record patterns, `when` guards | 21 | NO-RULE (no failure named / compiler enforces) | A2 |

## 2 · Libraries and runtime


Scope: the library and runtime side. That covers collections, streams, `Optional`, `String`, `Math`, `Objects`,
`HttpClient`, concurrency APIs, deprecated or removed APIs, and the `--release` build flag. Language features are in
49a.

Existing rules checked: `java.md`, `types.md`, `concurrency.md`, `errors.md` and `smells.md` at
`chiyanram/skills` `origin/main`, fetched on 2026-11-04.

JDK 25 status was read from the `jdk-25-ga` tag of `openjdk/jdk`, from the `@PreviewFeature`, `@since` and
`@Deprecated` markers in the source.

### 1. Sources

All sources were read on 2026-11-04. A key with one prefix is one organisation. All `OJ-*` keys together count as ONE
source (OpenJDK). `EP-*` and `GJG` together count as one source (Google).

| key | what | how read (repo @ ref, path) |
|---|---|---|
| OJ-STREAM | `Stream` javadoc (`toList`, `gather`) | raw.githubusercontent.com `openjdk/jdk@jdk-25-ga` `src/java.base/share/classes/java/util/stream/Stream.java` |
| OJ-COLL | `Collectors` javadoc | same tag, `.../java/util/stream/Collectors.java` |
| OJ-GATH | `Gatherer` javadoc | same tag, `.../java/util/stream/Gatherer.java` |
| OJ-LIST | `List` javadoc (unmodifiable lists, `copyOf`) | same tag, `.../java/util/List.java` |
| OJ-SET / OJ-MAP | `Set` / `Map` javadoc (`of` factories) | same tag, `.../java/util/Set.java`, `.../java/util/Map.java` |
| OJ-SEQ | `SequencedCollection` javadoc | same tag, `.../java/util/SequencedCollection.java` |
| OJ-REC | `Record` javadoc | same tag, `.../java/lang/Record.java` |
| OJ-OPT | `Optional` javadoc | same tag, `.../java/util/Optional.java` |
| OJ-MATH | `Math` class javadoc (overflow, `*Exact`) | same tag, `.../java/lang/Math.java` |
| OJ-OBJS | `Objects` javadoc (`requireNonNull`) | same tag, `.../java/util/Objects.java` |
| OJ-VEC / OJ-HT / OJ-STK / OJ-SB | `Vector`, `Hashtable`, `Stack`, `StringBuffer` javadoc | same tag, `.../java/util/Vector.java`, `Hashtable.java`, `Stack.java`, `.../java/lang/StringBuffer.java` |
| OJ-INT | `Integer` constructors | same tag, `.../java/lang/Integer.java` |
| OJ-OBJECT | `Object.finalize` javadoc | same tag, `.../java/lang/Object.java` |
| OJ-THR / OJ-SYS / OJ-SM | `Thread.stop`, `System.setSecurityManager`, `SecurityManager` | same tag, `.../java/lang/Thread.java`, `System.java`, `SecurityManager.java` |
| OJ-SV / OJ-STS | `ScopedValue`, `StructuredTaskScope` | same tag, `.../java/lang/ScopedValue.java`, `.../java/util/concurrent/StructuredTaskScope.java` |
| OJ-HTTP | `HttpClient` javadoc | same tag, `src/java.net.http/share/classes/java/net/http/HttpClient.java` |
| OJ-JAVAC | javac manual (`--release`) | same tag, `src/jdk.compiler/share/man/javac.md` |
| OJ-JAVACMSG | javac's own warning texts | same tag, `src/jdk.compiler/share/classes/com/sun/tools/javac/resources/compiler.properties` |
| EP-OBS | Error Prone `JdkObsolete` | raw.githubusercontent.com `google/error-prone@master` `docs/bugpattern/JdkObsolete.md` |
| EP-BOX | Error Prone `BoxedPrimitiveConstructor` | same, `docs/bugpattern/BoxedPrimitiveConstructor.md` |
| EP-FIN | Error Prone `Finalize` (quotes Google Java Style §6.4) | same, `docs/bugpattern/Finalize.md` |
| EP-ILM | Error Prone `IntLongMath` | same, `docs/bugpattern/IntLongMath.md` |
| EP-MMR | Error Prone `MixedMutabilityReturnType` | same, `docs/bugpattern/MixedMutabilityReturnType.md` |
| EP-ONP | Error Prone `OptionalNotPresent` | same, `docs/bugpattern/OptionalNotPresent.md` |
| CS-II | Checkstyle `IllegalInstantiation` | clone of `checkstyle/checkstyle@master` (9706aad), `src/site/xdoc/checks/coding/illegalinstantiation.xml` |
| CS-NF | Checkstyle `NoFinalizer` | same clone, `src/site/xdoc/checks/coding/nofinalizer.xml` |
| PL-141 | plinth, refactoring with modern features | clone of `jabrena/plinth@main` (45ead2d), `skills/141-java-refactoring-with-modern-features/references/141-java-refactoring-with-modern-features.md` |
| PL-142 | plinth, functional programming | same clone, `skills/142-java-functional-programming/references/142-java-functional-programming.md` |
| PL-112 / PL-110 | plinth, Maven compiler plugin and Maven best practices | same clone, `skills/112-java-maven-plugins/references/112-java-maven-plugins-maven-compiler-plugin.md`, `skills/110-java-maven-best-practices/references/110-java-maven-best-practices.md` |
| EJS | community summary of *Effective Java* 3e | clone of `david-sauvage/effective-java-summary@master` (a329f11), `README.md` |

Not counted as separate sources:

- `jabrena/cursor-rules-java` is the same organisation and content as plinth.
- `Jeffallan/claude-skills` `java-architect` has no guidance on any of these APIs.
- The JEP pages could not be read, because openjdk.org cannot be reached from this session.
- `apache/maven-compiler-plugin@master` documents the `release` parameter but gives no guidance on it.

### 2. Candidates

### MJ1: `Stream.toList()` versus `Collectors.toList()` (mutability)

- **Status in JDK 25:** final. `Stream.toList()` arrived in JDK 16; `Collectors.toCollection` is older.
- **Verdict:** NEW. No existing rule covers the mutability of a collected list. TY7 is only about `null` versus an
  empty collection.
- **Rule:** Collect a stream with `toList()` when no one mutates the result, and with
  `Collectors.toCollection(ArrayList::new)` when the caller must; never mutate a `Collectors.toList()` result,
  because `toList()` throws on mutation and `Collectors.toList()` promises no mutability. *(32 words)*
- **Sources:**
  - OJ-STREAM: "The returned List is unmodifiable; calls to any mutator method will always cause
    `UnsupportedOperationException` to be thrown" … "@apiNote If more control over the returned object is
    required, use `Collectors#toCollection(Supplier)`."
  - OJ-COLL (`Collectors.toList`): "There are no guarantees on the type, mutability, serializability, or
    thread-safety of the `List` returned; if more control over the returned `List` is required, use
    `toCollection(Supplier)`."
  - EP-MMR: "It is dangerous for a method to return a mutable instance in some circumstances, but immutable in
    others. Doing so may lead users of your API to make incorrect assumptions about the mutability of the return
    type."
  - PL-142, Example 2: "Utilize collectors that produce immutable collections (e.g.,
    `Collectors.toUnmodifiableList()`)."
- **Edge for "Decided edges":** `toList()` keeps `null` elements, but `Collectors.toUnmodifiableList()` throws
  `NullPointerException` on them (OJ-COLL: "disallows null values"). TY12 already keeps nulls out of domain lists.
- **Misreadable?** Yes. An agent sorts or adds to the result in place.

  **Bad**
  ```java
  List<Invoice> overdueInvoices(final List<Invoice> invoices, final Instant now) {
      final List<Invoice> overdue = invoices.stream()
              .filter(invoice -> invoice.dueAt().isBefore(now))
              .toList();
      overdue.sort(Comparator.comparing(Invoice::dueAt));
      return overdue;
  }
  ```
  `sort` throws `UnsupportedOperationException`, because `toList()` is unmodifiable.

  **Good**
  ```java
  List<Invoice> overdueInvoices(final List<Invoice> invoices, final Instant now) {
      return invoices.stream()
              .filter(invoice -> invoice.dueAt().isBefore(now))
              .sorted(Comparator.comparing(Invoice::dueAt))
              .toList();
  }
  ```
  The sort happens inside the pipeline. A caller that must add to the result collects with
  `Collectors.toCollection(ArrayList::new)`.
- **Review check:** `grep -nE "Collectors\.toList\(\)"`. Each hit is a finding: it becomes `toList()`, or
  `toCollection(ArrayList::new)` where the caller mutates the list. For each `.toList()`, look for a later `add`,
  `remove`, `sort` or `set` on the same variable.

### MJ2: copy collections into records and value classes with `List.copyOf`

- **Status in JDK 25:** final. `List.copyOf`, `Set.copyOf` and `Map.copyOf` arrived in JDK 10, records in JDK 16.
- **Verdict:** NEW. TY4 makes the field `final`, but nothing stops the caller from mutating the list behind that
  field.
- **Rule:** In a record or class holding a collection, store `List.copyOf` (or `Set`/`Map.copyOf`) of the argument,
  never the argument or an `unmodifiableList` view, because the caller keeps the original and can change the object
  after construction. *(34 words)*
- **Sources:**
  - OJ-REC: "A record class is a shallowly immutable, transparent carrier" … "The primary reasons to provide an
    explicit declaration for the canonical constructor … are to validate constructor arguments, perform defensive
    copies on mutable components".
  - OJ-LIST: lists made by `List.copyOf` "are unmodifiable. Elements cannot be added, removed, or replaced."
  - EJS, Item 50: "If a class has mutable components that comes from or goes to the client, the class needs to make
    defensive copies of those components."
  - PL-142, Example 1: "Ensure the incoming list is defensively copied to an immutable list" …
    `this.hobbies = List.copyOf(hobbies);`.
- **Edge:** `copyOf` throws `NullPointerException` on a `null` element (OJ-LIST: "They disallow null elements").
  That is the intended behaviour under TY12, because nulls are parsed away at the adapter.
- **Misreadable?** Yes. A `final` field looks immutable even when the list it holds is not.

  **Bad**
  ```java
  record Order(OrderId id, List<OrderLine> lines) {
  }

  final List<OrderLine> lines = new ArrayList<>(List.of(firstLine));
  final Order order = new Order(orderId, lines);
  lines.add(lateLine);
  ```
  After construction, the order has silently gained a second line.

  **Good**
  ```java
  record Order(OrderId id, List<OrderLine> lines) {
      Order {
          lines = List.copyOf(lines);
      }
  }
  ```
  The record holds its own unmodifiable copy. Later changes to the caller's list do not reach it.
- **Review check:** `grep -nE "record \w+\(.*(List|Set|Map)<"`. A record with a collection component and no
  `copyOf` in its compact constructor is a finding. So is a class constructor that assigns a collection parameter
  directly, or through `Collections.unmodifiable*`.

### MJ3: unwrap an `Optional` without `get()`

- **Status in JDK 25:** final. `orElseThrow()` arrived in JDK 10, `ifPresentOrElse` and `or` in JDK 9.
- **Verdict:** NEW. JV6, TY1 and TYN1 cover where an `Optional` appears and that it is never `null`. None of them
  covers how it is unwrapped.
- **Rule:** Unwrap an `Optional` with `map`, `orElse`, `orElseGet` or `orElseThrow`; never call `get()`, and never
  test `isPresent()` then `get()`, because `get()` hides that it throws `NoSuchElementException` when empty.
  *(31 words)*
- **Sources:**
  - OJ-OPT, `get()`: "@apiNote The preferred alternative to this method is `orElseThrow()`."
  - PL-142, Example 14: "Prefer `map`, `flatMap`, `filter`, `orElseGet`, and `orElseThrow` to express transformations
    and defaults declaratively. Avoid `isPresent()` + `get()` imperative patterns."
  - PL-141 (weaker): "Avoid calling `Optional.get()` directly without first checking `isPresent()`. Prefer functional
    alternatives."
  - EP-ONP (supporting): "Calling `get()` on an `Optional` that is not present will result in a
    `NoSuchElementException`."
- **Misreadable?** No. A grep decides it.
- **Review check:** `grep -nE "\.isPresent\(\)|\.get\(\)"`. Look at each `.get()` whose receiver is an `Optional`. A
  `get()` is a finding, and so is an `isPresent()` that guards a `get()`.

### MJ4: overflow-checked arithmetic on counts and minor-unit money

- **Status in JDK 25:** final. `Math.*Exact` arrived in JDK 8.
- **Verdict:** NEW. TY5 allows money as a `long` of minor units but says nothing about overflow.
- **Rule:** Add, multiply or narrow counts and minor-unit money with `Math.addExact`, `multiplyExact` and
  `toIntExact`, never bare `+`, `*` or an `(int)` cast, because `int` and `long` overflow wraps silently to a wrong
  value. *(33 words)*
- **Sources:**
  - OJ-MATH (class javadoc): "The best practice is to choose the primitive type and algorithm to avoid overflow. In cases
    where the size is `int` or `long` and overflow errors need to be detected, the methods whose names end with
    `Exact` throw an `ArithmeticException` when the results overflow."
  - EP-ILM: "Performing an arithmetic expression on arguments of type int and then assigning the result to a long is
    error-prone … the intermediate results may overflow." Its example "overflows to `-1857093632`".
- **Note:** this is the weakest NEW rule. Both sources state the failure. Only OpenJDK names `*Exact` as the remedy;
  Error Prone's remedy is a wider type. Keep it scoped to money and quantities, as written, or drop it.
- **Misreadable?** Yes. Agents treat `long` as "big enough".

  **Bad**
  ```java
  long lineTotalMinor(final OrderLine line) {
      return line.unitPriceMinor() * line.quantity();
  }
  ```
  A large quantity wraps to a negative total, and no exception is thrown.

  **Good**
  ```java
  long lineTotalMinor(final OrderLine line) {
      return Math.multiplyExact(line.unitPriceMinor(), line.quantity());
  }
  ```
  An overflow throws `ArithmeticException` at the multiplication instead of saving a wrong invoice total.
- **Review check:** `grep -nE "\(int\) *[a-zA-Z(]"` finds narrowing casts. For arithmetic on amount and quantity
  fields (`*Minor`, `quantity`, `count`), read each `+`, `*` and cast. One that does not use `*Exact` is a finding.

### MJ5: no legacy synchronized collections or `StringBuffer`

- **Status in JDK 25:** these classes are not deprecated, but the JDK's own javadoc points to their replacements.
- **Verdict:** NEW.
- **Rule:** Use `ArrayList`, `HashMap`, `ArrayDeque` and `StringBuilder`, never `Vector`, `Hashtable`, `Stack` or
  `StringBuffer`; share state through a `java.util.concurrent` type, because the legacy classes synchronize every
  call and pay for locking nobody needs. *(31 words)*
- **Sources:**
  - OJ-VEC: "If a thread-safe implementation is not needed, it is recommended to use `ArrayList` in place of `Vector`."
  - OJ-HT: "it is recommended to use `HashMap` in place of `Hashtable`. If a thread-safe highly-concurrent
    implementation is desired, then it is recommended to use `ConcurrentHashMap`."
  - OJ-STK: "A more complete and consistent set of LIFO stack operations is provided by the `Deque` interface …
    which should be used in preference to this class."
  - OJ-SB: "The `StringBuilder` class should generally be used in preference to this one … it is faster, as it
    performs no synchronization."
  - EP-OBS: "`Vector` performs synchronization that is usually unnecessary; prefer `ArrayList`" … "`Hashtable` …
    prefer `LinkedHashMap` or `HashMap`" … "`Stack` … prefer `ArrayDeque`" … "`StringBuffer` performs
    synchronization that is rarely necessary and has significant performance overhead."
- **Misreadable?** No.
- **Review check:** `grep -nE "\b(Vector|Hashtable|Stack|StringBuffer)\b"`. Each hit is a finding, unless it is
  required by a third-party API signature.

### MJ6: no boxed-primitive constructors

- **Status in JDK 25:** `new Integer(int)` and the other wrapper constructors are `@Deprecated(since="9")`.
  `jdk-25-ga` no longer marks them `forRemoval`.
- **Verdict:** NEW, but low value. javac already warns about deprecated use, so this rule could be merged into
  MJ5's review check as one "obsolete JDK API" grep.
- **Rule:** Box a primitive by autoboxing or `valueOf`, never `new Integer(..)`, `new Long(..)` or another wrapper
  constructor, because each constructor call allocates a fresh object that `==` and the value caches treat as
  distinct. *(32 words)*
- **Sources:**
  - OJ-INT: "It is rarely appropriate to use this constructor. The static factory `valueOf(int)` is generally a better
    choice, as it is likely to yield significantly better space and time performance."
  - EP-BOX: "The explicit constructors always return a fresh instance, resulting in unnecessary allocations …
    Relying on the unique reference identity of the instances returned by the explicit constructors is extremely
    bad practice."
  - CS-II: "Constructor invocations should be replaced by calls to `Boolean.valueOf()`." Checkstyle is a third
    organisation.
- **Misreadable?** No.
- **Review check:** `grep -nE "new (Integer|Long|Short|Byte|Character|Boolean|Double|Float)\("`. Each hit is a
  finding.

### MJ7: no `finalize()`

- **Status in JDK 25:** `Object.finalize` is `@Deprecated(since="9", forRemoval=true)`, and
  `Runtime.runFinalization` is `@Deprecated(since="18", forRemoval=true)` (JEP 421).
- **Verdict:** NEW. JV8 covers closing a resource at the call site, but nothing covers a class that cleans up after
  itself.
- **Rule:** Never override `finalize()`; release a resource through `close()` under try-with-resources, or register
  a `Cleaner` as a safety net, because finalization is deprecated for removal and may run late or never.
  *(31 words)*
- **Sources:**
  - OJ-OBJECT: "Finalization is deprecated and subject to removal in a future release. The use of finalization can lead
    to problems with security, performance, and reliability." … "Use `Cleaner` and `PhantomReference` as safer ways
    to release resources … Alternatively, add a `close` method … and implement `AutoCloseable`."
  - EP-FIN (quoting Google Java Style §6.4): "Do not override `Object.finalize`." … "Tip: Don't do it."
  - CS-NF: "Finalizers are unpredictable, often dangerous, and generally unnecessary."
  - EJS, Item 8: "Finalizers and cleaners are not guaranteed to be executed."
- **Misreadable?** No.
- **Review check:** `grep -nE "void finalize\(\)|runFinalization"`. Each hit is a finding.

### MJ8: compile with `--release`, not `-source`/`-target`

- **Status in JDK 25:** `--release` has existed since JDK 9, and javac recommends it in its own warning text.
- **Verdict:** NEW. This rule belongs to the build file rather than to Java source, so `java.md` or a build
  reference must decide whether it takes rules about build files.
- **Rule:** Set the Java level with `--release` (Maven `maven.compiler.release` or `<release>`), never
  `-source`/`-target` or `maven.compiler.source`/`target`, because those compile against the build JDK's API and
  can emit classes that fail on the target JDK. *(32 words)*
- **Sources:** this rule enters under decision V, as one vendor's own guidance about its own tool.
  - OJ-JAVACMSG, javac's own warning: "not setting the location of system modules may lead to class files that
    cannot run on JDK {0}\n--release {0} is recommended instead of -source {0} -target {1} because it sets the
    location of system modules automatically".
  - OJ-JAVAC: "`--release` … Source code is compiled against the combined Java SE and JDK API for the specified
    release."
  - Supporting: PL-112 configures `<release>${java.version}</release>` with "explicit Java release". PL-110 still
    shows `<source>`/`<target>` in several examples, so plinth is not a clean second source.
- **Misreadable?** No.
- **Review check:** `grep -nE "maven\.compiler\.(source|target)|<source>[0-9]|<target>[0-9]|-source |-target "` over
  `pom.xml` and build scripts. Each hit without `release` is a finding.

### Candidates that get no new rule

| topic | status in JDK 25 | verdict | why |
|---|---|---|---|
| Sequenced collections (`getFirst`, `getLast`, `reversed`, `addFirst`) | final since 21 (OJ-SEQ, `@since 21`) | NO-RULE | Only OpenJDK describes them, and the javadoc gives no "prefer" guidance. No independent second source was found; plinth's `getFirst` is a user-defined method. `get(0)` gives no concrete failure beyond style. |
| Stream gatherers (`Stream.gather`, `Gatherers`) | final since 24 (OJ-GATH, `@since 24`, no `@PreviewFeature`) | NO-RULE; possible JV3 "When X, use Y" row | OJ-GATH: "grouping elements into batches (windowing functions); de-duplicating consecutively similar elements; incremental accumulation functions (prefix scan)". PL-142 only says "investigate Stream Gatherers (JEP 461)" and cites the preview JEP. If the operator wants it, add a JV3 row: "a stateful per-element step (window, running total, consecutive dedupe) → a `Gatherer` from `Gatherers`, not a lambda that mutates outer state". |
| `List.of`/`Set.of`/`Map.of` nulls and duplicates | final since 9 | COVERED by MJ2's edge and TY12 | OJ-LIST: "They disallow null elements"; PL-141: "`Map.of()` does not permit duplicate keys". Both throw at once, so the failure is loud. |
| `Set.of`/`Map.of` iteration order | final since 9 | NO-RULE (one source) | OJ-SET and OJ-MAP: "The iteration order … is unspecified and is subject to change." No second source was read. Worth a candidate if a second source turns up, because tests that depend on this order flake. |
| `Optional.stream()`, `or`, `ifPresentOrElse` | final since 9 | folded into MJ3 | These are style, with no failure of their own. |
| `String` `isBlank`, `strip`, `lines`, `repeat`, `formatted` | final since 11/15 | NO-RULE | Only OpenJDK documents them. PL-141, PL-142 and PL-143 themselves use `trim().isEmpty()`, so they are not a source. No concrete failure: blank checks at the boundary go through ER6's `@NotBlank`. |
| `HttpClient` | final since 11; `AutoCloseable` since 21 | COVERED-BY CC3 | CC3 already requires connect and read timeouts, and its Good example builds `HttpClient` with them. No second source for a "reuse one client" rule. |
| `java.time` | final | COVERED-BY JV1 and U4 | Nothing to add. |
| `Objects.requireNonNull` / `checkIndex` | final since 7 / 9 | COVERED-BY TY3 and TY9 | OJ-OBJS: "designed primarily for doing parameter validation in methods and constructors". EJS Item 49: "The `Objects.requireNonNull` method should be used for nullability checks." TY9 already moves a null check "into the type, where the value is built", and TY3 puts checks in the compact constructor. Optional: add `Objects.requireNonNull` as the named tool in TY3's "When X, use Y" row. There is no rule for `checkIndex`, because no failure was found. |
| Virtual threads | final since 21; JEP 491 (no pinning on `synchronized`) in 24 | COVERED-BY CC1 | Nothing to add. |
| `ScopedValue` | **final in JDK 25** (OJ-SV: `@since 25`, no `@PreviewFeature`) | COVERED-BY CC7 | CC7 may name it as it does today. |
| Structured concurrency (`StructuredTaskScope`) | **preview in JDK 25** (OJ-STS: `@PreviewFeature(feature = STRUCTURED_CONCURRENCY)`) | NO-RULE (preview) | **Flag:** CC7's decided edge says "a `ScopedValue` reaches only threads forked in a `StructuredTaskScope`". That points at a preview API. Reword it so that in JDK 25 without `--enable-preview` a `ScopedValue` reaches no other thread, and context crossing an executor hop goes as a parameter. |
| `Thread.stop`, `suspend`, `resume` | `stop()` always throws `UnsupportedOperationException` (OJ-THR). `suspend` and `resume` are gone from `jdk-25-ga` `Thread.java`. | NO-RULE | Enforced by the JDK: the call either does not compile or always throws. |
| Security Manager | `System.setSecurityManager` "Throws `UnsupportedOperationException` … always" (OJ-SYS). `SecurityManager` "This feature no longer exists" (OJ-SM). | NO-RULE | Enforced by the JDK. |
| `Date`, `Calendar` | — | COVERED-BY JV1 | |
| `LinkedList`, `Enumeration`, `SortedMap` (EP-OBS) | — | optional, as part of MJ5's grep | EP-OBS is the only source for `LinkedList`, so it is not added to the rule text. |

### 3. Summary

| id | topic | JDK 25 status | verdict | sources (independent orgs) | Good/Bad |
|---|---|---|---|---|---|
| MJ1 | `toList()` versus `Collectors.toList()` mutability | final (16) | NEW | OpenJDK, Error Prone, plinth | yes |
| MJ2 | `List.copyOf` into records and value classes | final (10/16) | NEW | OpenJDK, EJ summary, plinth | yes |
| MJ3 | unwrap `Optional` without `get()` | final (10) | NEW | OpenJDK, plinth (+ Error Prone supporting) | no |
| MJ4 | `Math.*Exact` for money and counts | final (8) | NEW (weakest) | OpenJDK, Error Prone (failure only) | yes |
| MJ5 | no `Vector`/`Hashtable`/`Stack`/`StringBuffer` | not deprecated; JDK says prefer | NEW | OpenJDK, Error Prone | no |
| MJ6 | no `new Integer(..)` | deprecated since 9 | NEW (low value; merge into MJ5 check?) | OpenJDK, Error Prone, Checkstyle | no |
| MJ7 | no `finalize()`; `close()` or `Cleaner` | deprecated for removal | NEW | OpenJDK, Google (EP and style), Checkstyle, EJ summary | no |
| MJ8 | `--release`, not `-source`/`-target` | since 9 | NEW (decision V) | OpenJDK javac (vendor guidance) | no |
| — | `ScopedValue` | **final in 25** | COVERED-BY CC7 | OpenJDK | — |
| — | `StructuredTaskScope` | **preview in 25** | NO-RULE; **fix CC7's decided edge** | OpenJDK | — |
| — | Gatherers | final (24) | NO-RULE; optional JV3 row | OpenJDK (+ plinth, vague) | — |
| — | Sequenced collections, `String` APIs, `Set.of`/`Map.of` order | final | NO-RULE (one source / no failure) | OpenJDK only | — |
| — | `HttpClient`, `java.time`, virtual threads, `requireNonNull` | final | COVERED-BY CC3, JV1/U4, CC1, TY3/TY9 | — | — |
| — | `Thread.stop`, Security Manager | the JDK throws or has removed them | NO-RULE (the JDK enforces it) | OpenJDK | — |
