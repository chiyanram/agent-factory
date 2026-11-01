# 48 · Industry re-check of the code/ rule files and deslop (T2 #32)

The operator's rule (2026-10-31, agent-factory#34, map #30 Notes): a rule stays only if ≥2 independent industry or
reference sources state it, and its because names a maintainability, performance, scaling, correctness or security
failure. One project's history is not a reason. This file re-checks every rule in chiyanram/skills
`plugins/rulebook/skills/code/references/*.md` and `deslop/SKILL.md` as merged on main, 2026-10-31.

Method: five research passes, one per file group (§1–§5 below, kept as written). Only GitHub was reachable, so every
source was read from its own repository; blocked hosts are named in each section. Nothing here is approved until §0
records the operator's yes.

## 0 · Summary and approvals

| file | rules | KEEP | REWORD | DROP | NEW |
|---|---|---|---|---|---|
| types.md | 13 | 2 | 10 | 1 | 1 |
| java.md | 11 | 2 | 7 | 2 | 2 |
| design.md | 1 | 0 | 1 | 0 | 2 |
| comments.md | 6 | 2 | 4 | 0 | 1 |
| errors.md | 10 | 2 | 7 | 1 | 2 |
| smells.md | 23 | 6 | 11 | 6 | 0 |
| deslop/SKILL.md | 5 | 3 | 2 | 0 | 0 |
| spring.md | 27 | 5 | 11 | 11 | 1 |
| services.md | 3 | 1 | 2 | 0 | 1 |
| messaging.md | 2 | 0 | 2 | 0 | 2 |
| security.md | 32 | 17 | 8 | 7 | 3 |
| concurrency.md | 10 | 4 | 6 | 0 | 1 |
| angular-ui.md | 14 | 6 | 8 | 0 | 1 |
| **total** | **157** | **50** | **79** | **28** | **17** |

Approvals:

- **V · vendor exception** (operator, 2026-10-31, option a): a rule about one framework's or library's own behaviour
  may rest on that vendor's official docs alone, when the docs state it as guidance; every other rule needs ≥2
  independent sources. Rescued: SC3, SC6, SC20, SS2 (reworded to Spring's example), SS17, JV4, SC7's core. Still
  dropped: SC19 (a reference project contradicts it), SC10 and SC13's prefix (project choices).
- **SC22** (operator, 2026-10-31): reword approved — `@Retryable` on the `@Transactional` method or on a caller with no
  open transaction, never inside an outer transaction (Spring Framework 7 resilience docs).
- **TY4** (operator, 2026-10-31): narrowed to fields — every field `final` unless reassigned after construction.
  `final` locals and parameters leave the generic rulebook; a project that wants them keeps its own gate and docs.
  Supersedes OQ2 / G-OQ2 for the rulebook.
- **CM3** (operator, 2026-10-31): reword approved — try a rename, extracted method or type first; keep a comment only
  for what code cannot say (non-obvious reason, outside constraint, contract, license, link). Supersedes X1 and the D1
  closed keep-list.
- **CM7, NGA2** (operator, 2026-11-01): rewords approved — fix first; a proven-safe suppression is scoped to one
  declaration with a comment saying why; NGA2 = `unknown` and narrow, never `any`. Supersedes the X6 "never suppress,
  even with a reason" edge.

## 1 · 48a — Industry re-check: types.md, java.md, design.md, comments.md (T2, agent-factory#32)


Rules read from `git show origin/main:plugins/rulebook/skills/code/references/<file>.md` (fetched 2026-10-31).
Every non-GitHub host was blocked in this session (refactoring.com, openjdk.org/jeps, docs.oracle.com, rules.sonarsource.com,
checkstyle.org, martinfowler.com all fail DNS). All sources below were read from GitHub clones in
the session scratchpad (not kept). Effective Java, Clean Code and APOSD were read only through the pages named below.

Counting rule used: one organisation = one source. **OpenJDK javadoc and amber-docs are one source (OJ). Google Java
Style and Error Prone are one source (GOOG).** The Ousterhout–Martin debate repo is one source (APOSD), with each voice quoted.

### 1. Sources

| key | what | read at |
|---|---|---|
| OJ | OpenJDK: JDK javadoc (`Optional`, `Clock`, `SimpleDateFormat`, `Collectors`, `java.util.stream` package, `ForkJoinPool`, `AutoCloseable`) + amber-docs guides (LVTI style guide, text-blocks guide, exhaustiveness guide, records-and-sealed design note) | github.com/openjdk/jdk @483fc2ba `src/java.base/share/classes/java/...`; github.com/openjdk/amber-docs @058be2f `site/guides/*.md`, `site/design-notes/records-and-sealed-classes.md` |
| GOOG | Google Java Style Guide + Error Prone bug-pattern docs | github.com/google/styleguide @70d70c9 `javaguide.md`; github.com/google/error-prone @0202185 `docs/bugpattern/*.md` |
| SON | SonarSource Java rule descriptions (S-numbers) | github.com/SonarSource/sonar-java `sonar-java-plugin/src/main/resources/org/sonar/l10n/java/rules/java/S*.html`; defaults from `java-checks/.../MethodComplexityCheck.java` |
| EJ | Effective Java 3e, via a third-party item-by-item summary (paraphrase, not Bloch's words) | github.com/david-sauvage/effective-java-summary @a329f11 `README.md` |
| PS | pstack (Cursor plugin) | github.com/cursor/plugins @4dd1d05 `pstack/agents/comment-sicko.md`, `pstack/skills/{principle-type-system-discipline,principle-boundary-discipline,typescript-best-practices}/…` |
| MP | mattpocock/skills | github.com/mattpocock/skills @a496f55 `skills/engineering/{codebase-design,code-review}/SKILL.md` |
| AD | addyosmani/agent-skills | github.com/addyosmani/agent-skills @eb07f19 `skills/{code-simplification,code-review-and-quality}/SKILL.md` |
| APOSD | Ousterhout vs Martin debate (APOSD vs Clean Code) | github.com/johnousterhout/aposd-vs-clean-code @2ce0742 `README.md` |
| CCJS | Clean Code adapted to JS (ryanmcdermott) | github.com/ryanmcdermott/clean-code-javascript @5311f64 `README.md` |
| CS | Checkstyle check docs (used only as a counter-source) | github.com/checkstyle/checkstyle `src/site/xdoc/checks/coding/missingswitchdefault.xml` |
| NA | Uber NullAway README | github.com/uber/NullAway `README.md` |

Not reached: Fowler's refactoring.com catalog, JEP pages, Oracle docs, Sonar web, the EJ/APOSD books themselves.

### 2. Verdicts

### types.md (13 rules)

**TY1 · REWORD**
- Now: never let `null` decide a case; absence is `Optional`, sealed+records or enum, because nullable fields let contradictory combinations compile.
- Proposed: "Return absence as an `Optional`, and model a field that may be absent as a sealed case or an enum, never as a nullable field that picks a branch, because a forgotten null check throws `NullPointerException`."
- Sources: OJ `Optional` apiNote: "primarily intended for use as a method return type where there is a clear need to represent "no result," and where using `null` is likely to cause errors." · PS ts patterns.md:33: "Boolean + optionals lets contradictory states exist." / SKILL.md:14 "No optional-field bags." · NA: "a tool to help eliminate `NullPointerException`s".
- Why: the old text says "model absence as an `Optional`" while JV6 bans `Optional` fields, so the two clash. Split by position.
- Pair: still fits. The Bad has a nullable field picking a path, and the Good uses an enum with an exhaustive switch.

**TY2 · REWORD**
- Now: closed set → sealed or enum; switch over it with no `default` arm.
- Proposed: "Model a closed set as a sealed type or an enum, and switch over it with an arrow-form switch that lists every case and has no `default`, because a `default` lets a new case compile and be silently mishandled."
- Sources: GOOG EP `UnnecessaryDefaultInEnumSwitch`: "Removing the unnecessary default allows Error Prone to enforce that the switch continues to handle all cases, even if new values are added to the enum" · OJ amber exhaustiveness guide: "It is almost never necessary to use `default` when switching over a `sealed` type -- and often not the best option." · PS typescript-best-practices:23 (exhaustiveness via `never`).
- Why: KEEP in substance. Narrow the rule to switches the compiler checks for exhaustiveness. CS `MissingSwitchDefault` still asks for a `default` in old-style *statements* ("introduction of new types in an enumeration type" is its own reason) and skips switch expressions. GOOG style §4.8.4.3 counts an enum switch that covers every value as exhaustive. Without the arrow-form narrowing, the rule fights common Checkstyle configs.
- Pair: none of its own. TY1 and TY3 Goods use it and still fit.

**TY3 · KEEP**
- Now: forbidden combinations → sealed variants first; compact constructor rejects only the rest.
- Proposed (wording only): "Make forbidden field combinations unbuildable with sealed record variants; check in a compact constructor only the invariants the variants cannot exclude, because a record that admits forbidden combinations leaves every caller re-checking them."
- Sources: PS typescript-best-practices:16: "Build the shape so the illegal value can't be constructed … Not a runtime guard" · OJ records-and-sealed: "Some data aggregates (such as numeric ranges) have invariants that, if enforced by the constructor, can thereafter be relied upon" · EJ Item 23 "Tagged classes" (summary heading; book: prefer class hierarchies to tagged classes).
- Pair: fits (D5 already dropped `@JsonTypeInfo`).

**TY7 · REWORD (reason only)**
- Proposed: "Return an empty collection or array, never `null`, from a method whose type is a collection or array, because every caller must null-check and one that forgets throws `NullPointerException`."
- Sources: EJ Item 54: "Always return an empty array or collection instead." · SON S1168: "Returning null instead of an actual array, collection or map forces callers of the method to explicitly test for nullity" (cites CERT MET55-J).
- Why: "and causes bugs" names no concrete failure.
- Pair: none.

**TY9 · DROP**
- Now: strengthen a type only where partiality appears (cast, null check, "never happens" throw).
- Sources: only PS (typescript-best-practices:17 and patterns.md:98, "The tells are `!`, `arr[0] as T`, and a 'should never happen' throw"). The principle file and the TS skill come from one organisation. MP, AD, GOOG, SON, EJ and OJ say nothing on it.
- Why: one source. The ledger already marks it NO-REASON. The operator may keep it as house style.
- Pair: the BetweenBounds pair really shows "parse once at the boundary". Move it to TY12 rather than lose it.

**TY12 · REWORD**
- Now: `null` only while mapping a wire DTO; convert in the adapter.
- Proposed: "Parse external data (request bodies, rows, config) into domain types in its adapter, turning each nullable wire field into an `Optional`, a sealed case or an enum there, because an unparsed null reaches logic and throws `NullPointerException`."
- Sources: PS principle-type-system-discipline: "External data is untyped until parsed … Have a parse function at every boundary that turns unstructured input into the typed model." · PS boundary-discipline: "Parse raw data into domain types at the boundary" (same org) · AD code-review-and-quality:75: "Are external data flows validated at system boundaries before use in logic or rendering?"
- Why: two independent sources for parsing at the boundary. The null detail is the Java form of it.
- Pair: none now. Use TY9's pair (see above).

**TY8 · KEEP**
- Proposed (wording only): "Wrap a primitive or `String` in a small record when two same-typed parameters could swap or the value carries an invariant, because swapped ids compile and corrupt data silently."
- Sources: PS type-system-discipline: "If two arguments share a primitive type but mean different things, brand them." · MP code-review:49 (Fowler smell): "Primitive Obsession: a primitive or string standing in for a domain concept that deserves its own type. → give the concept its own small type." · EJ Item 62: "Avoid Strings when other types are more appropriate".
- Pair: fits (E1 `long` ids).

**TY4 · REWORD (narrow), contradicts OQ2 / G-OQ2**
- Now: fields `final` always; locals and params `final` in new code; never edit old lines only for `final`.
- Proposed: "Declare every field `final` unless it is reassigned after construction, because a mutable field makes an object unsafe to share across threads."
- Sources (fields): EJ Item 17: "Make all fields final" · SON S9438: "Private fields that are never reassigned after construction should be declared "final"".
- Against (locals/params): GOOG EP `Var`: "explicitly marking local variables and parameters as `final` is discouraged." No source found for it.
- Why: the field half has two sources. The local half has none and the main Java style owner speaks against it. **This contradicts operator decisions OQ2 and G-OQ2 (Checkstyle `FinalLocalVariable` gate).** The operator may keep `final` locals as house style, gated as it is now.
- Pair: none of its own. The `final` locals in every Good are style and break nothing.

**TY5 · REWORD**
- Now: money is `BigDecimal` with explicit scale and rounding; `double` only for latencies and scores.
- Proposed: "Hold money as `BigDecimal` (built from a `String` or `valueOf`) or as a `long` of minor units, never `float` or `double`, because binary floating point cannot represent 0.10 exactly and totals drift."
- Sources: EJ Item 60: "Float and double types are not suited for monetary calculations. Use BigDecimal, int or long" · SON S2164: "BigDecimal is the best alternative" · GOOG EP `BigDecimalLiteralDouble`: "`new BigDecimal(0.1)` … `0.1000000000000000055511151231257827021181583404541015625`".
- Why: "double only for latencies and scores" and "explicit scale and rounding" have no source. The `long` minor-units form is the sourced permitted alternative.
- Pair: none.

**TY6 · REWORD**
- Now: closed set of states → enum, never a string literal; persist as `EnumType.STRING`; reason cites a project incident.
- Proposed: "Model a closed set of states, roles or modes as an enum, never a `String` or `int` constant, and persist it by name, never by ordinal, because a misspelt string compiles and a reordered enum remaps stored ordinals."
- Sources: EJ Item 34: "Prior to enums it was common to use int to represent enum types. Doing so is now obsolete and enum types must be used." + Item 62 · MP code-review:49 Primitive Obsession (quoted above) · GOOG EP `EnumOrdinal`: "The ordinal of a given enum value is not guaranteed to be stable across builds because of the potential for enum values to be added, removed, or reordered."
- Why: the reason was one project's incident (#622), so it is replaced with the general failure. `EnumType.STRING` is JPA's spelling of "by name".
- Pair: none.

**TY11 · REWORD**
- Now: make enum-vs-`String` `equals` fail the build (EP `EqualsIncompatibleType` or ArchUnit); reason cites a project incident.
- Proposed: "Compare enum values with `==`, and turn on a compile-time check (Error Prone `EqualsIncompatibleType` or equivalent) that fails on `equals` between unrelated types, because such an `equals` compiles and is always false."
- Sources: GOOG EP `EqualsIncompatibleType`: "the compiler will happily allow us to pass an Integer to the equals method. That method will always return false" · SON S4551: `==` on enums "provides compile-time (static) checking rather than runtime checking".
- Why: same incident-reason problem as TY6.
- Pair: none.

**TY10 · REWORD**
- Now: no raw generic types; `@SuppressWarnings("unchecked")` on one statement with a reason.
- Proposed: "Write no raw generic types; put `@SuppressWarnings("unchecked")` on the smallest declaration (one local variable), with a comment saying why the cast is safe, because a raw type turns a compile error into a runtime `ClassCastException`."
- Sources: EJ Item 26: "using raw types will probably result in error during runtime" · EJ Item 27: "use the annotation @SuppressWarnings("unchecked") as close as possible to the declaration. Also, comment on why it is safe." · SON S3740: "Explicit type casts are necessary … which may fail with a ClassCastException" · GOOG EP `SuppressWarningsWithoutExplanation`: "`@SuppressWarnings` should have an accompanying comment to explain why the javac warning is safe to ignore."
- Why: Java cannot annotate a statement, only a declaration, so "one statement" is not something an author can do.
- Pair: none.

**TY13 · REWORD (operator X2/TY13a already amended it)**
- Now: build values by record constructor or static factory; no builder classes, no `Impl` suffix, no nested-class hierarchies.
- Proposed: "Build a simple value with its record constructor or a static factory; write a builder only when a type has many optional parts, because a hand-written builder for a simple value is a second construction API to keep in step."
- Sources: EJ Item 1 (static factories: "They have a name") and Item 2: "Builder are interesting when your constructor may need many arguments" · SON S6206: "Records should be used instead of ordinary classes when representing immutable data structure".
- Why: the outright builder ban contradicts EJ Item 2 and was already relaxed by X2. "No `Impl` suffix" and "no nested-class hierarchies" have no source, so drop them. E2's edge becomes moot.
- Pair: none.

**New rules the sources share that types.md lacks**
1. **NEW-TY-a** — "Never return `null` from a method whose type is `Optional`, and never compare an `Optional` to `null`, because a null `Optional` throws `NullPointerException` where the caller expected empty." OJ `Optional` apiNote: "A variable whose type is `Optional` should never itself be `null`" · SON S2789: "It is a bad practice to use null with Optional" · GOOG EP `NullOptional`.

### java.md (11 rules)

**U4 · REWORD (narrow)**
- Now: in logic a test must pin, take an injected `Clock` (and `Supplier<UUID>`), never `Instant.now()` / `LocalDate.now()` / `UUID.randomUUID()`.
- Proposed: "In logic that reads the current time, take an injected `Clock` and call `now(clock)`, never no-argument `now()`, because the wall clock cannot be fixed in a test, so the test flakes at midnight or across zones."
- Sources: OJ `Clock` javadoc: "Best practice for applications is to pass a `Clock` into any method that requires the current instant and time-zone." · SON S8692: "Tests that rely on the current wall-clock time are "flaky": they may pass today but fail tomorrow" · SON S8688: "`.now()` methods should specify a ZoneId or a Clock".
- Why: the `Supplier<UUID>` half has no source, so it goes (operator may keep as house style).
- Pair: fits.

**JV1 · REWORD (reason)**
- Proposed: "Compute time as `Instant`, `Duration` or another `java.time` type, never `Date`, `Calendar` or a raw `long` of millis; convert only at a library or display edge, because `Date` and its formatters are mutable and not thread-safe."
- Sources: GOOG EP `JavaUtilDate`: "should be avoided at all costs. Prefer the `java.time` APIs" + EP `StronglyTypeTime`: "`java.time.Duration` fields should be strongly typed rather than stored as integral primitives" · SON S2143: "Date and Calendar classes have always been confusing and error-prone, particularly in a multi-threaded context" · OJ `SimpleDateFormat`: "Date formats are not synchronized."
- Why: the Bad shows a raw `long` of millis, which the old reason (shared `SimpleDateFormat`) never covered. The reworded text names both.
- Pair: fits once "raw `long`" is in the rule.

**JV2 · REWORD (weak; flag to operator)**
- Proposed: "Use sequential streams in request- or queue-serving code; never `parallelStream()` or `.parallel()`, because parallel streams run on the one JVM-wide common pool, so one blocking task stalls every other user of it."
- Sources: OJ `ForkJoinPool`: "The common pool is used by any ForkJoinTask that is not explicitly submitted to a specified pool." · EJ Item 48 (summary): "Parallelizing a pipeline is unlikely to increase its performance if it comes from a Stream.iterate or the limit method is used."
- Why: two sources say parallel streams are shared and rarely faster. Neither says "never in request code" outright. The book's item ("use caution when making streams parallel") was not read directly. It is kept because the shared-pool fact is normative, but it is the weakest KEEP here.
- Pair: none.

**JV3 · REWORD (reason)**
- Proposed: "Keep `map`, `filter` and other stream lambdas free of I/O, logging and mutation, and do not use `peek` for work, because the stream may skip those calls, so the effect silently does not happen."
- Sources: OJ `java.util.stream`: "Side-effects in behavioral parameters to stream operations are, in general, discouraged … side-effects of behavioral parameters may not always be executed" · EJ Item 46: "Programming with stream pipelines should be side effect free." · SON S3864: "the Stream implementation is free to skip calls to peek()".
- Why: "hard to test" was weak. The sourced failure is an effect that is skipped.
- Pair: none.

**JV4 · DROP**
- Now: give `toMap` a merge function unless a DB constraint (named in a comment) makes keys unique.
- Sources: OJ `Collectors.toMap` only: "If the mapped keys might have duplicates, use `toMap(Function, Function, BinaryOperator)` instead." No second organisation found (GOOG, SON, EJ summary, PS, MP, AD are silent). The "DB constraint named in a comment" clause is a house choice.
- Why: one source. The operator may keep it as house style, since the JDK javadoc is normative.

**JV5 · REWORD**
- Now: `final var` only when the right-hand side shows the type.
- Proposed: "Use `var` only when the initializer names the type (a constructor, a factory or a literal); otherwise write the type, and never pair `var` with `<>`, because the reader cannot see the type and diamond infers `Object`."
- Sources: OJ amber LVTI guide G3: "Consider `var` when the initializer provides sufficient information to the reader" and G6: "DANGEROUS: infers as PriorityQueue<Object>" · SON S6212: flags only where "the type can be easily inferred by the reader, either when the type is already mentioned in the name or the initializer".
- Why: the `final` in `final var` belongs to TY4's local half, which has no source (see TY4). The decided edge (Spring bans `var`) stays.
- Pair: fits.

**JV6 · REWORD (reason)**
- Proposed: "Use `Optional` only as a return type, never as a field, parameter or collection element, because an `Optional` parameter has three states (null, empty, present) and every callee must check all three."
- Sources: OJ `Optional` apiNote (quoted at TY1) · SON S3553: "With an Optional parameter, you go from having 2 possible inputs: null and not-null, to three" · EJ Item 55 (return Optionals).
- Why: "an `Optional` field cannot serialise" is true (`Optional` is not `Serializable`) but no source above gives it as the reason.
- Pair: none.

**JV7 · KEEP**
- Proposed (wording only): "Write a multi-line SQL, JSON or HTML string as a text block, never as `+`-joined literals with `\n`, because escaped concatenation hides the text's shape and invites a missing newline."
- Sources: OJ amber text-blocks guide G1: "You should use a text block when it improves the clarity of the code, particularly with multi-line strings." · SON S6126: "String multiline concatenation should be replaced with Text Blocks".
- Pair: none.

**JV8 · KEEP**
- Proposed (wording only): "Open every I/O-backed `AutoCloseable` (stream, reader, connection) in a try-with-resources header, because a resource not closed when an exception fires leaks until the process runs out of handles."
- Sources: OJ `AutoCloseable`: "This construction ensures prompt release, avoiding resource exhaustion exceptions" (it also says try-with-resources is "in general unnecessary" for non-I/O streams, hence "I/O-backed") · EJ Item 9: "Always use try with resources instead of try-finally." · SON S2093 · GOOG EP `MustBeClosedChecker`.
- Pair: none.

**JV9 · REWORD (reason)**
- Proposed: "Put braces on every `if`, `else`, `for`, `do` and `while` body, because a line added under a brace-less body looks guarded but always runs."
- Sources: GOOG style §4.1.1: "Braces are used with `if`, `else`, `for`, `do` and `while` statements, even when the body is empty or contains only a single statement." · SON S121: "the two calls seem to be attached to the if statement, but only the first one is".
- Why: the old reason ("agents copy nearby code … a 'copy this' example") is one project's story.
- Pair: none.

**CV3 · DROP**
- Now: wrap Java/Groovy at the formatter's line length; TypeScript wrapping is Prettier's.
- Why: this is one project's tooling setup (120/110, Prettier), not an industry rule. GOOG sets 100, and Prettier's docs were not read, so there are no two sources for it. Move it to project config/AGENTS (D9 approved its reason, but a reason is not a source).
- Pair: goes with the rule.

**New rules the sources share that java.md lacks**
1. **NEW-JV-a** — "Compare `BigDecimal` values with `compareTo`, never `equals`, because `equals` treats 2.0 and 2.00 as different." SON S9351: "`new BigDecimal("2.0").equals(new BigDecimal("2.00"))` evaluates to false" · GOOG EP `BigDecimalEquals`: "`BigDecimal`'s equals method compares the scale of the representation as well as the numeric value, which may not be expected."
2. **NEW-JV-b** — "Never `catch` and ignore an exception silently; at least log or rethrow it, because a swallowed exception hides the failure." GOOG style §6.2 "Caught exceptions: not ignored" · EJ Item 77 "Don't ignore exceptions". (May already be owned by errors.md; check first.)

### design.md (1 rule)

**SEAM1 · REWORD (split; the composite is house style)**
- Now: every seam has one job, record in, sealed result out, pure decisions, I/O that decides nothing, rule lists, cyclomatic complexity ≤5.
- Proposed SEAM1: "Make each decision a function that does no I/O, and keep I/O in a thin method that chooses no outcome, because logic tangled with I/O cannot be tested without the I/O."
- Sources: PS boundary-discipline: "Business logic lives in pure functions. The shell is thin and mechanical." / "Keep logic out of framework wiring so it can be tested without the framework." · MP codebase-design: "Return results, don't produce side effects." (under "Designing for testability") and "Accept dependencies, don't create them."
- Dropped parts, each with its own reason:
  - "record in, sealed out" and "rule lists not if-ladders": one project's seam rules (ADR-0017), with no second source.
  - "complexity ≤5": the threshold is unsourced. SON's default is 10 (`MethodComplexityCheck DEFAULT_MAX = 10`) and AD flags nesting at "3+ levels".
  - "one job": MP "Divergent Change … split so each module changes for one reason" is the only clear source.
- Contradiction: **this narrows D9 / agent-factory#21 Q3**, which approved the composite. The operator may keep the rest as the project's seam rules in that project's own docs.
- Pair: none.

**New rules the sources share that design.md lacks**
1. **NEW-DS-a** — "Keep each method under the project's complexity gate (cyclomatic 10 if none is set), splitting by guard clauses or extracted helpers, because a highly branched method hides paths no test reaches." SON S1541 ("Complex code … difficult to understand and therefore to maintain"; default 10) · AD code-simplification: "Deep nesting (3+ levels) … Extract conditions into guard clauses or helper functions".
2. **NEW-DS-b** — "Add a seam (interface) only when two adapters exist or are needed now, because a one-adapter interface adds a layer without a variation." MP codebase-design: "One adapter means a hypothetical seam. Two adapters means a real one." · AD code-simplification: "Over-engineered patterns | Factory-for-a-factory, strategy-with-one-strategy | Replace with the simple direct approach".

### comments.md (6 rules)

**CM1 · KEEP**
- Proposed (wording only): "Write no banner or divider comments (`// ====`, `// --- Helpers ---`), because a divider outlives the section it labelled once code moves; use a new method or file instead."
- Sources: PS comment-sicko:12: "Narration, banners, commented-out corpses, workaround sermons. I want them all." · CCJS: "Avoid positional markers. They usually just add noise. Let the functions and variable names along with the proper indentation and formatting give the visual structure".
- Pair: none.

**CM2 · KEEP**
- Proposed (wording only): "Write no comment that restates the code, a name or a config value, because it adds nothing and goes stale when the code changes; rename instead."
- Sources: AD code-simplification:144: "Comments explaining "what" | `// increment counter` above `count++` | Delete the comment — the code is clear enough" · APOSD (Martin, Ousterhout agreeing): "The first sentence is redundant with the name `isMultipleOfNthPrimeFactor` and so could be deleted." / "I agree that the first sentence is largely redundant with the name" · PS comment-sicko:12 ("Narration").
- Pair: none.

**CM3 · REWORD, contradicts X1 (operator 2026-10-03) and D1**
- Now: keep a comment only for what code cannot show (external dependency or protocol, public-API contract, license, issue/RFC link, must-not-fail boundary catch); else reshape, because a why-comment about our code rots.
- Proposed: "Before writing a comment, try a rename, an extracted method or a type; keep a comment only for what code cannot say (a non-obvious reason, an outside constraint, a contract, a license, a link), because prose duplicating code goes stale."
- Sources: AD code-simplification:145: "Comments explaining "why" | `// Retry because the API is flaky under load` | Keep these — they carry intent the code can't express" · APOSD (Ousterhout): "The second general reason for comments is for important information that is not obvious from the code." and (both agree) "implementation code only needs comments when the code is nonobvious" · CCJS: "Only comment things that have business logic complexity." · PS comment-sicko:14-20 (keep-list).
- Why: only PS says that a why-comment about *our own* code must die. AD and Ousterhout say the opposite and keep "why" comments, and Martin agrees comments are needed where code is non-obvious. Two sources back "reshape first, comment the non-obvious". None but PS backs the closed keep-list. **This contradicts operator decision X1 ("settled by CM3 per pstack") and the D1 keep-clause wording.** The operator may keep the strict list as house style.
- Pair: still fits. The Bad's comment explains what two enum parameters can show, and it is false.

**CM4 · REWORD (narrow)**
- Now: check each comment's claim before it lands; replace a 'do not remove' note with a type, test or lint.
- Proposed: "Check a comment's factual claim against the code before it lands, and delete or fix any that is false, because readers act on a false comment."
- Sources: APOSD (Martin): "I look at every comment as potential misinformation … The worst are those that waste my time telling me something obvious, or incorrect." · PS comment-sicko:26: "If its claim is not obvious there, I run `/how`, `/why` … on the named symbol".
- Why: "replace 'do not remove' with a type, test or lint" is PS-only (no-comments step 5). Drop it or keep it as house style.
- Pair: fits. The Bad claims a doc section that does not exist, and the Good's spec is optional extra.

**CM5 · REWORD**
- Now: Javadoc on an interface only when its contract is not obvious from the signature; none on its implementation.
- Proposed: "Document a public interface method's contract (what the signature cannot say: nulls, errors, side effects); skip it for a self-explanatory member, and write none on an override, because a copied doc drifts from the original."
- Sources: GOOG style §7.3.1: "Javadoc is optional for "simple, obvious" members … *if* there *really and truly* is nothing else worthwhile to say" and §7.3.2: "Javadoc is not always present on a method that overrides a supertype method." · APOSD (Ousterhout): "writing a header comment that describes the method's *interface* (all the information someone needs in order to invoke the method)"; (Martin) agrees "for public APIs" · PS comment-sicko:19: "Doc comments that define a public API contract."
- Why: all three lean toward documenting the contract more than "only when not obvious". GOOG's minimum is Javadoc on every visible member. The reword makes contract docs the default and names the sourced exceptions.
- Pair: none.

**CM7 · REWORD; also fixes a clash with TY10**
- Now: fix the type instead of suppressing a correctness lint or compiler rule; style-only rules may be suppressed.
- Proposed: "Fix the code instead of suppressing a compiler or lint warning that guards correctness; when a suppression is proven safe, scope it to one declaration and add a comment saying why, because a bare suppression hides the next real bug."
- Sources: EJ Item 27: "Try as hard as possible to eliminate them … When you prove your code is safe but you can't remove this warning use … @SuppressWarnings("unchecked") … comment on why it is safe." · GOOG EP `SuppressWarningsWithoutExplanation` (quoted at TY10) · PS comment-sicko:24: "If it catches real bugs or protects correctness or safety, kill the suppression".
- Why: the old "never" contradicts TY10, which allows a reasoned `unchecked` suppression, and EJ. Two sources give "fix first, else narrow and explained". **It loosens X6 / NGA2 ("never suppress no-explicit-any, even with a reason")**, which the operator may keep for TypeScript `any` as house style.
- Pair: fits, since the Bad's suppression has no proof and no reason.

**New rules the sources share that comments.md lacks**
1. **NEW-CM-a** — "Delete commented-out code, because it is never compiled, goes stale, and version control already keeps it." SON S125: "Commented-out code … quickly becomes out of date and invalid. Commented-out code should be deleted and can be retrieved from source control history" · CCJS: "Don't leave commented out code in your codebase" · AD code-simplification:152 ("commented-out blocks | Remove") · PS comment-sicko:12 ("commented-out corpses").

### 3. Summary

| file | KEEP | REWORD | DROP | NEW |
|---|---|---|---|---|
| types.md (13) | 2 (TY3, TY8) | 10 (TY1, TY2, TY4, TY5, TY6, TY7, TY10, TY11, TY12, TY13) | 1 (TY9) | 1 |
| java.md (11) | 2 (JV7, JV8) | 7 (U4, JV1, JV2, JV3, JV5, JV6, JV9) | 2 (JV4, CV3) | 2 |
| design.md (1) | 0 | 1 (SEAM1, split) | 0 (sub-parts dropped) | 2 |
| comments.md (6) | 2 (CM1, CM2) | 4 (CM3, CM4, CM5, CM7) | 0 | 1 |
| **total (31)** | **6** | **22** | **3** | **6** |

Contradictions with earlier operator decisions: TY4 vs OQ2/G-OQ2 (`final` locals), CM3 vs X1/D1 (closed keep-list), CM7 vs
X6/NGA2 ("never, even with a reason"), SEAM1 vs D9/#21 Q3 (composite), TY13 builder ban (already relaxed by X2; E2 edge becomes moot).

## 2 · 48b — Industry re-check: errors.md, smells.md, deslop (T2, agent-factory#32)


Rules read from `origin/main` of chiyanram/skills (fetched 2026-10-31). Rule: KEEP/REWORD only with ≥2 independent
sources (one organisation = one source). Only GitHub was reachable: refactoring.com, martinfowler.com,
industriallogic.com, informit.com, refactoring.guru, rfc-editor.org, cwe.mitre.org, wiki.sei.cmu.edu, errorprone.info,
google.github.io all fail DNS in this session. Nothing below cites a page I did not read.

### 1. Sources

| key | what I read (repo path) | org |
|---|---|---|
| EJ | _Effective Java_ 2e Items 57–65 (= 3e Items 69–77), read as quoted in `HugoMatilla/Effective-JAVA-Summary` README.md §57–65. A summary, not the book text | Bloch |
| OWASP-EH | `OWASP/CheatSheetSeries` cheatsheets/Error_Handling_Cheat_Sheet.md | OWASP |
| OWASP-REST / OWASP-IV | same repo, REST_Security_Cheat_Sheet.md / Input_Validation_Cheat_Sheet.md (same org as OWASP-EH, so they count once) | OWASP |
| RFC9457 | `ietf-wg-httpapi/rfc7807bis` draft-ietf-httpapi-rfc7807bis.md (the WG source of RFC 9457; rfc-editor is blocked) | IETF |
| SPRING | `spring-projects/spring-framework` framework-docs …/mvc-controller/ann-advice.adoc, …/webmvc/mvc-ann-rest-exceptions.adoc | Spring |
| JDK | `openjdk/jdk` java/lang/Error.java and InterruptedException.java javadoc | OpenJDK |
| GOOG | `google/styleguide` javaguide.md §6.2 (GJS) · `google/eng-practices` review/reviewer/looking-for.md (GEP) · `google/error-prone` docs/bugpattern/InterruptedExceptionSwallowed.md (EP). **One org: they count once** | Google |
| NET | `dotnet/docs` docs/standard/exceptions/best-practices-for-exceptions.md | Microsoft |
| RUST | `rust-lang/book` src/ch09-03-to-panic-or-not-to-panic.md | Rust project |
| PMD | `pmd/pmd` pmd-java/…/category/java/{errorprone,design,bestpractices,codestyle}.xml + rule defaults in …/rule/design/*.java | PMD |
| CS | `checkstyle/checkstyle` src/site/xdoc/checks/{sizes/parameternumber,sizes/filelength,coding/illegalcatch,blocks/emptycatchblock,coding/nestedifdepth}.xml | Checkstyle |
| SONAR | `SonarSource/sonar-java` sonar-java-plugin/…/rules/java/S*.html + java-checks/…/*Check.java defaults. Read for calibration only (SM5); short quotes here, never vendored | SonarSource |
| OTEL | `open-telemetry/opentelemetry-specification` specification/logs/data-model.md | OpenTelemetry |
| CCJS | `ryanmcdermott/clean-code-javascript` README.md ("principles from Robert C. Martin's _Clean Code_, adapted for JavaScript") | McDermott/Martin |
| LUZ | `Luzkan/smells` content/smells/*.md (7f3f7da): a smell catalog that quotes Fowler 1999/2018, Kerievsky 2005, Wake 2004, Martin 2008 with sources per smell | Jerzyk |
| MP | `mattpocock/skills` (a496f55) skills/engineering/code-review/SKILL.md, codebase-design/SKILL.md | Pocock |
| ADDY | `addyosmani/agent-skills` (eb07f19) skills/{code-simplification,code-review-and-quality,api-and-interface-design,security-and-hardening,observability-and-instrumentation,deprecation-and-migration}/SKILL.md | Osmani |
| PS | `cursor/plugins` pstack/skills/principle-*/SKILL.md (HEAD 4dd1d05); interrogate/references/{code-quality-review,rubric}.md read at 2eb7ed46 (removed from HEAD) | Cursor |
| CTK | `cursor/plugins` cursor-team-kit/skills/deslop/SKILL.md. **Same org as PS: they count once** | Cursor |

Independence caveats: ADDY code-review-and-quality's "relocate complexity", "~1000 total lines" and "silent fallback"
lines closely mirror PS code-quality-review dimensions 0–5. I count them as two sources but they may share a lineage.
openclaw `.agents/skills/deslop` (the old DS13 source) is gone from openclaw HEAD (cba74db); not re-read, not cited.

---

### 2a. `code/references/errors.md` (10 rules)

**ER1 · REWORD**
- Now: foreseeable non-success is a sealed outcome in the return type; only faults throw.
- Proposed: "Return a foreseeable non-success (not found, already exists, over limit) as a case of a sealed return type; throw only for faults, because a thrown expected case is invisible in the signature and callers skip it."
- Sources: RUST "when failure is expected, it's more appropriate to return a `Result` than to make a `panic!` call" · NET "Another way to avoid exceptions is to return `null` … for most common error cases … A common error case can be considered a normal flow of control" · EJ §57 "Never use or (expose in the API) exceptions for ordinary control flow" · PMD ExceptionAsFlowControl "obscures control flow".
- Why: four independent sources agree on "expected failure is not an exception". EJ §58 still prefers a *checked* exception for recoverable cases; the sealed return is the typed alternative, not EJ's. Pair (Bad lambda throw / Good `InsertionResult`) still fits.

**ER2 · REWORD** (split; drop the house parts)
- Now: fault throws the project's base exception with a catalogue `ErrorCode`; no checked exceptions; never a bare `ResponseEntity…build()`.
- Proposed: "Throw a fault as an unchecked exception carrying a code from the one error catalogue, and answer every error with a body, because clients branch on a machine-readable code, never on free text or an empty body."
- Sources: RFC9457 "a 'problem detail' to carry machine-readable details of errors" and "Consumers MUST use the 'type' URI … as the problem type's primary identifier" · ADDY api "Every error response follows the same shape … code: string; // Machine-readable" · SPRING mvc-ann-rest-exceptions "include details in the body of error responses … RFC 9457".
- Why: one shape with a machine code is well sourced. "No checked exceptions" has only EJ §59 ("Avoid unnecessary use of checked exceptions"), which is weaker than a ban (EJ §58 keeps them for recoverable cases): house style once ER1 owns the recoverable case. The `traceId` reason is our response shape; dropped. No pair.

**ER7 · DROP** — one project's choice. No source bans `Either`/VAVR; RUST's `Result` is the same shape the rule forbids. The reason (a left "never reaches the handler … loses its `traceId`") is our handler design. ER1's sealed return already names the alternative. Operator may keep as house style.

**ER10 · REWORD** (reason only)
- Proposed: "Put only the catalogue message in an error body; never an exception's `getMessage()`, a stack trace or SQL, because they reveal framework versions, schema and data to an attacker. Log the detail server-side."
- Sources: OWASP-EH "a generic response is returned … but the error details are logged server side … and not returned to the user"; "Using error messages that do not provide implementation details is important to avoid information leakage" · RFC9457 §Security "avoid making implementation details such as a stack dump available through the HTTP interface" · ADDY security "Never expose stack traces or internal error details to users".
- Why: three orgs; old reason was an incident. Pair (driver message in body / catalogue message + WARN log) fits.

**ER11 · REWORD**
- Proposed: "Map exceptions to error responses in one global `@RestControllerAdvice`; declare no `@ExceptionHandler` in a controller, because a local handler runs first and bypasses the shared, sanitised error shape."
- Sources: OWASP-EH "configure a global error handler … when an unexpected error occurs then a generic response is returned" · ADDY api "Pick one error strategy and use it everywhere … Don't mix patterns" · SPRING ann-advice "Global `@ExceptionHandler` methods, from an `@ControllerAdvice`, are applied _after_ local ones, from the `@Controller`".
- Why: the "no local handler" half rests on SPRING's precedence fact plus OWASP/ADDY's one-handler advice; the old reason was an incident. No pair.

**ER3 · REWORD**
- Proposed: "When you rethrow, pass the caught exception as the cause; never leave a catch block empty: handle it, rethrow it, or log its class and message, because a dropped cause loses the stack trace and a silent catch hides the failure."
- Sources: EJ §61 "pass the lower-level to the higher-level exception" and §65 "Don't let catch blocks empty" · PMD PreserveStackTrace "The stack trace of the original exception could be lost" · SONAR S1166 "the original exception's message and stack trace should be logged or passed forward" · NET "the stack trace is restarted at the current method" · GOOG GJS §6.2 "It is very rarely correct to do nothing in response to a caught exception" · CCJS "Don't ignore caught errors".
- Why: very well sourced. **Conflict:** GJS §6.2 allows an empty catch "explained in a comment", and CS EmptyCatchBlock by default "allows empty catch block with any comment inside". The review check's "an empty block, even one that holds a comment (ledger R37-D7)" is stricter than every source: operator's house choice, now stated as such. No pair.

**ER4 · KEEP** (wording kept; ≤35 words)
- Text: "Catch the narrowest type; `catch (Exception)` only at a must-not-fail boundary, with a comment; never `Throwable`, because a broad catch hides failures; `Throwable` even swallows `OutOfMemoryError`."
- Sources: CS IllegalCatch "catching java.lang.Exception, java.lang.Error or java.lang.RuntimeException is almost never acceptable … inadvertently catches NullPointerException, OutOfMemoryError" · PMD AvoidCatchingGenericException "can hide real problems"; AvoidCatchingThrowable "includes runtime issues such as OutOfMemoryError" · SONAR S1181 "Catching either Throwable or Error will also catch OutOfMemoryError" · JDK Error "serious problems that a reasonable application should not try to catch" · NET "When your code can't recover from an exception, don't catch that exception".
- Pair (catch `Exception` around a JSON parse / catch `JacksonException`) fits.

**ER5 · REWORD** (reason only)
- Proposed: "When you catch `InterruptedException`, rethrow it or call `Thread.currentThread().interrupt()`, because otherwise the interrupt request is lost and the thread can no longer be cancelled or shut down."
- Sources: JDK InterruptedException "Code that catches InterruptedException should rethrow the exception, or restore the current thread's interrupted status" · SONAR S2142 "the information that the thread was interrupted will be lost … Simply logging the exception is not sufficient" · GOOG EP "important for correctness and performance that thread interruption is handled properly".
- Why: "quiet hang" was an incident summary; the sources name the lost signal. No pair.

**ER6 · KEEP**
- Text unchanged ("Validate request input at the boundary with Bean Validation; inside, trust the types and use `requireNonNull` only for programming errors, because a service re-validating … drifts").
- Sources: PS boundary-discipline "Inside the system: typed data, error propagation, no re-validation. Trust the types"; "No redundant nil checks deep in call chains if the boundary already validated" · ADDY api "Trust internal code. Validate at system edges where external input enters"; "Where validation does NOT belong: Between internal functions that share type contracts" · OWASP-IV "validate the resulting values before business processing or storage".
- No pair.

**ER8 · REWORD** (reason only; D2 kept: points to LG3)
- Proposed: "A best-effort metric or audit call may catch, log at WARN with class and message (LG3) and continue; never an empty block, because a failure below WARN is invisible to production alerting."
- Sources: ADDY observability "`warn` | Degraded but handled (retry succeeded, fallback used)" · OTEL "WARN … Not an error but is likely more important than an informational event" · (not-empty half) GOOG GJS §6.2 "Typical responses are to log it", SONAR S1166.
- Pair (silent audit catch / WARN with class and message) fits.

**New rules the sources share (errors)**
1. "Return 4xx for a client error and 500 with a generic body for an unforeseen fault; never a 2xx carrying an error, because clients and monitoring read the status." — OWASP-EH "use 4xx … for requests that are due to an error on the part of the HTTP client … 5xx … due to an unforeseen bug"; ADDY api status mapping "500 → Server error (never expose internal details)"; RFC9457 "Generators MUST use the same status code in the actual HTTP response".
2. "Leave state as it was when a method fails: validate and compute before you mutate, because a half-applied change corrupts data." — EJ §64 "A failed method invocation should leave the object in the state that it was in prior to the invocation"; NET "Callers should be able to assume that there are no side effects when an exception is thrown".

---

### 2b. `code/references/smells.md` (23 rules)

**DS11 · DROP** (one source) — "Review every diff against the smell baseline … labelled heuristic … a documented repo rule overrides." Only MP states this ("Each smell is a labelled heuristic … never a hard violation"; "A documented repo standard always wins"). I found no second source for "labelled heuristic" or "repo overrides". The file already says the operator kept it without a source. **Operator may keep as house style.** It is the file's process frame, and the OQ1 Decided edge (D3) still holds without it; this verdict does not contradict D3.

**SM1 · REWORD** (absorbs SM2 and FW9)
- Proposed: "Review against Fowler's 2e chapter-3 smells plus Kerievsky's Oddball Solution, Indecent Exposure and Conditional Complexity, skipping any a running gate fails, because a partial list lets known smells through unreviewed."
- Sources: LUZ lists the 2018 (2e) names with Fowler as source (Global Data, Mutable Data, Loops, Insider Trading, Lazy Element, Repeated Switching) and Kerievsky's _Refactoring to Patterns_ 2005 for Oddball Solution and Indecent Exposure · MP "a fixed set of Fowler code smells (_Refactoring_, ch.3)" (a 12-smell subset, which is the gap SM1 fixes) · MP "skip anything tooling already enforces".
- Why: the old "because" was about our own list's size. **Discrepancy:** LUZ credits Conditional Complexity to Steve Smith (2013) and maps it to Fowler's Repeated Switching, not Kerievsky. The Industrial Logic cheatsheet (K 41) could not be reached to confirm. D11's refactoring.com check of the 12 names is not re-done here (host blocked).

**SM2 · DROP** — merged into SM1 (same baseline, two rules). Its sources move with it.

**SM3 · DROP** — duplicate. The Dead Code smell is DS7 (deslop) plus the table row; a separate "treat as a baseline smell" rule adds nothing. The row's sources stand: SONAR S1144 "A method that is never called is dead code, and should be removed"; PMD UnusedPrivateMethod/UnusedPrivateField; CCJS "Remove dead code".

**FW9 · DROP** — merged into SM1. Long Function, Long Parameter List and Data Class are 2e smells, so SM1 covers them. Its reason ("the 12-smell list … misses Long Function") was about our list.

**SM5 · DROP** (as a code rule) — a repo authoring policy with one source (the sonar-java licence). Move it to CONTRIBUTING.md as repo policy; it never fires on product code.

**DS1 · REWORD**
- Proposed: "Before you accept a change, look for a restructure that deletes a branch, mode or layer rather than moving it; a moved branch is a finding, because the copies of one rule diverge."
- Sources: PS model-the-domain "A structure that matches the domain makes invalid states unrepresentable and deletes branches"; PS code-quality-review "If you can delete complexity rather than rearrange it, push hard for that" · ADDY code-review "Does this refactor reduce complexity or just relocate it? … prefer the restructuring that makes whole branches, modes, or layers disappear".
- Why: the old reason was an incident. Lineage caveat (ADDY may derive from PS). Pair fits (two callers decode one sentinel / sealed `GracePeriod`).

**DS3 · REWORD** (reason)
- Proposed: "Add no one-off `if` or second boolean to an existing flow; model the case as a sealed type, enum switch, table or state machine, because two flags that must agree drift apart."
- Sources: PS model-the-domain "A state machine instead of scattered booleans … The sign that you skipped this is … a second boolean that must stay in sync with the first" · MP Repeated Switches "replace with polymorphism, or one map both sites share" · LUZ flag-argument "a cocoon phase before it develops into … Conditional Complexity" · CCJS "Avoid conditionals".
- Pair fits.

**DS4 · KEEP**
- Text unchanged ("Remove a pass-through method, a single-caller wrapper or an adapter with one implementation, and apply the deletion test, because a pass-through adds a layer to trace and hides nothing").
- Sources: MP codebase-design "The deletion test … If complexity vanishes, it was a pass-through"; "One adapter means a hypothetical seam" · ADDY code-simplification "Wrapper that adds no value | Inline the wrapper" · PS refactoring playbook "collapse one-caller wrappers" · LUZ middle-man.
- Pair (examples/smells.md DS4) fits.

**FW8 · REWORD**
- Proposed: "Cure a message chain with Hide Delegate and a middle man with Remove Middle Man only where it removes coupling at real call sites, because over-curing one smell creates the other."
- Sources: LUZ middle-man "This is the opposite of the Message Chains"; "This can happen due to over-zealous refactorization of Message Chains" (quoting Fowler) · MP "Message Chains → hide the walk behind one method"; "Middle Man → cut it, call the real target direct".
- Why: the old sources (refactoring.com) were unreachable. The inverse claim rests on LUZ only, so it is weakly sourced. No pair.

**DS6 · REWORD** (drop the unsourced clause)
- Proposed: "Add no parameter, config key, hook or pattern for a case no current caller has, because unused generality is complexity every later change must carry."
- Sources: GOOG GEP "over-engineering … Encourage developers to solve the problem they know needs to be solved now, not the problem that the developer speculates might need" · MP Speculative Generality "delete it; inline back until a real need shows" · ADDY code-simplification "Don't preserve speculative abstractions … complexity without value" · PS subtract "Design for observed usage, not speculative edge cases".
- Why: "name the design pressure before you name a pattern" has no source. ADDY's "strategy-with-one-strategy" is close, but it is about patterns already in place. Drop that clause. No pair.

**DS12 · REWORD** (reason)
- Proposed: "Define a predicate or literal that encodes a rule (a prefix, a status, a limit) once and call it from every site, because copies of one rule change separately and disagree."
- Sources: ADDY code-simplification "Repeated conditionals | Same `if` check in multiple places | Extract to a well-named predicate function" · CCJS "Duplicate code is bad because it means that there's more than one place to alter something" · MP Duplicated Code.
- Why: the old reason was an incident. Pair (examples DS12) fits.

**DS14 · REWORD**
- Proposed: "Extract a shared helper only when the duplicate encodes one rule (DS12); leave two or three similar lines inline, because a helper serving unrelated callers grows a mode flag per caller."
- Sources: PS rubric "Premature abstraction is worse than duplication"; "Three lines of duplication beat a premature abstraction" · ADDY code-review "Don't generalize until the third use case"; code-simplification "Duplicated logic | Same 5+ lines" · LUZ flag-argument (mode flag causes Conditional Complexity).
- Pair fits.

**DS2 · REWORD**
- Proposed: "Treat a change that pushes a file past 1000 lines as a finding; decompose first unless a structural reason is stated, because a long file is hard to understand and review."
- Sources: CS FileLength "If a source file becomes very long it is hard to understand … should usually be refactored" (default 2000) · SONAR S104 (default 750) · PS code-quality-review "Do not let a PR push a file from under 1k lines to over 1k lines without a very strong reason" · ADDY "around 1000 total lines in a single file … Decompose, then add".
- Why: the shape is well sourced. The number 1000 comes only from PS/ADDY (possibly one lineage); the tools default to 750/2000. The old reason was an incident. No pair.

**FW1 · REWORD** (the threshold is now sourced)
- Proposed: "Treat a constructor or method with more than 7 parameters as a finding: split the class or introduce a parameter object, because a long list is hard to call correctly and signals an over-busy object."
- Sources: CS ParameterNumber "max … int 7" (METHOD_DEF, CTOR_DEF) · SONAR S107 `constructorMax` default 7, "maintainers must figure out the role of each parameter and keep track of their position" · PMD ExcessiveParameterList "prone to mix-ups … the method is trying to do too much" · CCJS "Function arguments (2 or fewer ideally)".
- Why: two tools independently default to 7, so the file's note "the limit of 7 is ours" is out of date. No pair.

**FW2 · KEEP**
- Text unchanged ("boolean parameter that selects which operation runs is a finding: split … or take a sealed or enum input, because callers cannot tell what true or false means").
- Sources: LUZ flag-argument (Martin 2008 / Fowler) "`book(marcel, false)` … precisely what `false`?" · CCJS "Flags tell your user that this function does more than one thing … Split out your functions" · ADDY "Boolean parameter flags | `doThing(true, false, true)` | … separate functions".

**FW5 · KEEP**
- Text unchanged.
- Sources: GOOG GEP "comments … should not be explaining what some code is doing. If the code isn't clear enough to explain itself, then the code should be made simpler" · LUZ what-comment "If a comment describes what is happening … it is probably trying to mask some other Code Smell" · CCJS "Functions should do one thing"; ADDY "Comments explaining 'what' … Delete the comment".

**FW6 · KEEP**
- Text unchanged. "Records and values, not entities" is a scope limit (X5), not a claim.
- Sources: MP Feature Envy "move the method onto the data it envies" · PMD DataClass "may indicate that their behaviour is defined elsewhere, which is a sign of poor data-behaviour proximity" · LUZ message-chain "Tell, Don't Ask Principle Violation".

**FW3 · REWORD**
- Proposed: "A method that returns a value changes no observable state, except a modifier returning its own outcome or a fluent `this`, because a hidden side effect makes call order and repeat calls matter."
- Sources: LUZ side-effects "method and function names should tell what they do and do only what is anticipated" · CCJS "A function produces a side effect if it does anything other than take a value in and return another value".
- Why: CQS proper (Meyer; MF/CommandQuerySeparation) was not reachable. The two sources back "no hidden side effects", not the exact CQS wording. The CAS/fluent exceptions are ours. No pair.

**NM1 · KEEP**
- Text unchanged.
- Sources: ADDY "Generic names | `data`, `result`, `temp`, `val`, `item`"; "Use full words unless the abbreviation is universal (`id`, `url`, `api`)" · CCJS "Use meaningful and pronounceable variable names", "Avoid Mental Mapping" · GOOG GEP "A good name is long enough to fully communicate what the item is or does" · MP Mysterious Name. (The id/url/api list is ADDY's alone.)

**NM2 · DROP** (one source) — only MP says it ("if no honest name comes, the design's murky"). I found no second readable source (Ousterhout, who makes the same point, was not reachable). Operator may keep as house style.

**NM3 · KEEP**
- Text unchanged.
- Sources: ADDY "Misleading names | Function named `get` that also mutates state" · PMD LinguisticNaming "checks, that getters return something and setters won't" · LUZ side-effects / fallacious-method-name.

**NM4 · REWORD** (reason)
- Proposed: "Give one family of types one naming pattern and aligned method signatures (`*Outcome`, `*Port`), because a reader who learns one member should predict the rest; a mismatch reads as a difference."
- Sources: LUZ inconsistent-names (Wake 2004) · CCJS "Use the same vocabulary for the same type of variable" · MP/LUZ Alternative Classes with Different Interfaces.

**New rules the sources share (smells)**: none strong enough to add. One candidate, with a caveat: "a method above
cognitive complexity 15 is a finding" (SONAR S3776 default 15; PMD CognitiveComplexity default 15). PMD implements
Sonar's metric, so this is effectively one source. Operator decision.

---

### 2c. `deslop/SKILL.md` (5 rules)

**DS13 · REWORD** (reason)
- Proposed: "Run deslop on the branch diff only, before review and never instead of it; fix only behaviour-neutral cleanups and report the rest, because an unreviewed behaviour change ships untested."
- Sources: CTK deslop "Check the diff against main"; "Keep behavior unchanged unless fixing a clear bug" · ADDY code-simplification "reducing complexity while preserving exact behavior"; "This is a judgment call — flag it, don't auto-refactor"; ADDY code-review "Every change gets reviewed before merge — no exceptions".
- Why: the old reason ("deslop checks style only") was circular. D7 (no "revert, no fix forward") still holds. No pair.

**DS5 · REWORD**
- Proposed: "When an API has no external consumer, migrate every caller and delete the old path; leave no compatibility shim, because two live paths must both be maintained and drift apart."
- Sources: PS migrate-callers "Migrate callers and delete the old API in the same wave instead of preserving compatibility layers"; rubric "Don't leave compatibility layers that will become permanent" · ADDY deprecation "Only after all consumers have migrated: [remove the old system]"; ADDY code-review lists "backwards-compat shims" as dead code.
- Why: "in the same change" is PS-only; ADDY migrates incrementally. The reworded rule keeps "delete the old path", which both state. The ParallelChange edge stays. No pair.

**DS7 · KEEP**
- Text unchanged.
- Sources: ADDY code-review "Don't leave dead code lying around — it confuses future readers and agents"; "`// removed` comments" · CCJS "Remove dead code"; "Don't leave commented out code … Version control exists for a reason" · SONAR S1144; PMD UnusedFormalParameter/UnusedPrivateMethod.

**DS8 · KEEP**
- Text unchanged.
- Sources: PS fix-root-causes "If the state should never exist, a check where it broke hides the bug … Guards, retries, swallowed errors … are the usual ways to hide a bug"; "Check for the pattern, not just the instance" (CTK "Defensive checks or try/catch blocks that are abnormal for trusted code paths" is the same org) · ADDY api "Where validation does NOT belong: Between internal functions that share type contracts" · PMD AvoidCatchingNPE "A catch block may hide the original error".
- Pair (null guard on an injected field / one constructor + sealed target) fits.

**DS9 · KEEP**
- Text unchanged.
- Sources: ADDY "Deep nesting (3+ levels) | … guard clauses"; "Nested ternaries | Requires mental stack to parse" · PMD AvoidDeeplyNestedIfStmts "harder to read and error-prone to maintain" (default depth 3) · SONAR S3358 "Nested ternaries are hard to read"; S134 (default max 3) · CTK "Deeply nested code … simplified with early returns".

**New rules (deslop)**: none. The sources' cleanup items are covered by DS7–DS9 or owned elsewhere.

---

### 3. Conflicts with earlier operator decisions

- **R37-D7** (an empty catch with a comment is still a finding): stricter than GOOG §6.2 and the CS default. Kept as house style; the rule text should say so.
- **D3 / OQ1**: unaffected. DS11 drops as a rule, but its Decided edge stays.
- **D11**: refactoring.com unreachable, not re-verified. LUZ disagrees on Conditional Complexity's origin.
- The smells.md header note ("FW1's limit of 7 is ours, because no first-party number exists") is out of date: CS and SONAR both default to 7.
- No contradiction with D1, D2, D4–D10, D12, E1, E2.

### 4. Summary

| file | KEEP | REWORD | DROP | NEW |
|---|---|---|---|---|
| code/references/errors.md (10) | 2 (ER4, ER6) | 7 (ER1, ER2, ER10, ER11, ER3, ER5, ER8) | 1 (ER7) | 2 |
| code/references/smells.md (23) | 6 (DS4, FW2, FW5, FW6, NM1, NM3) | 11 (SM1, DS1, DS3, FW8, DS6, DS12, DS14, DS2, FW1, FW3, NM4) | 6 (DS11, SM2, SM3, FW9, SM5, NM2) | 0 (1 caveated candidate) |
| deslop/SKILL.md (5) | 3 (DS7, DS8, DS9) | 2 (DS13, DS5) | 0 | 0 |

## 3 · T2 industry re-check: spring.md · services.md · messaging.md (agent-factory#32)


Read 2026-10-31. Rules read with `git show origin/main:plugins/rulebook/skills/code/references/<file>.md` in `/home/user/skills`.
Only GitHub is reachable from this session: docs.spring.io, microservices.io, enterpriseintegrationpatterns.com,
martinfowler.com, odrotbohm.de, baeldung, kafka.apache.org and confluent all failed DNS, so every source below was read
from its GitHub repository (raw file or shallow clone). Local copies are in
the session scratchpad (not kept). I could not clone pstack (`poteto/pstack` is not public), so no
pstack lead from the ledger is used here.

**Independence rule applied:** FW, BOOT and SK are one organisation (Spring). SONAR, PMD and CS are three separate tool
vendors. SBS, PL, JF, ADDY, MP and DDH are independent authors.

### 1. Sources

| key | what | where read (repo @ commit · path) |
|---|---|---|
| FW | Spring Framework reference | spring-projects/spring-framework @2ed3a55 · `framework-docs/modules/ROOT/pages/` `core/beans/dependencies/factory-collaborators.adoc`, `core/beans/factory-nature.adoc`, `core/beans/factory-scopes.adoc`, `core/beans/java/basic-concepts.adoc`, `core/aop/proxying.adoc`, `core/aot.adoc`, `core/resilience.adoc`, `data-access/transaction/declarative/annotations.adoc` |
| BOOT | Spring Boot reference (same org as FW) | spring-projects/spring-boot @bcd4641 · `documentation/spring-boot-docs/src/docs/antora/modules/reference/pages/` `using/spring-beans-and-dependency-injection.adoc`, `features/external-config.adoc`, `features/spring-application.adoc`, `features/developing-auto-configuration.adoc`, `testing/spring-boot-applications.adoc` |
| SK | Spring for Apache Kafka reference (same org as FW) | spring-projects/spring-kafka @b4fd372 · `spring-kafka-docs/src/main/antora/modules/ROOT/pages/kafka/serdes.adoc`, `annotation-error-handling.adoc` |
| SONAR | SonarSource Java rules | SonarSource/sonar-java @50267c6 · `sonar-java-plugin/src/main/resources/org/sonar/l10n/java/rules/java/S<n>.html` |
| PMD | PMD Java rules | pmd/pmd @e08cc0e · `pmd-java/src/main/resources/category/java/{bestpractices,design,errorprone}.xml` |
| CS | Checkstyle docs | checkstyle/checkstyle @9706aad · `src/site/xdoc/checks/design/hideutilityclassconstructor.xml` |
| JDK | `java.lang.Record` javadoc | openjdk/jdk @483fc2b · `src/java.base/share/classes/java/lang/Record.java` |
| OWASP-L / ASVS | OWASP Logging Cheat Sheet · ASVS 5.0 V13 | OWASP/CheatSheetSeries @87a1faf `cheatsheets/Logging_Cheat_Sheet.md` · OWASP/ASVS @9ccce0e `5.0/en/0x22-V13-Configuration.md` |
| KAFKA | Apache Kafka design docs | apache/kafka @98fa512 · `docs/design/design.md` |
| SBS | rrezartprebreza/spring-boot-skills | @c2c23fe · `skills/spring-boot-4/{configuration-properties,transactional-patterns,layered-architecture,hexagonal-architecture,event-driven-messaging,idempotency-patterns}/SKILL.md` |
| PL | jabrena/plinth | @e0b6fb1 · `skills/301-frameworks-spring-boot-core/references/301-frameworks-spring-boot-core.md` (PL301), `skills/123-java-design-patterns/references/123-kafka-event-driven-patterns.md` (PL123) |
| JF | jeffallan/claude-skills | @078a25c · `skills/spring-boot-engineer/SKILL.md` |
| ADDY | addyosmani/agent-skills | @eb07f19 · `skills/api-and-interface-design/SKILL.md`, `skills/code-review-and-quality/SKILL.md` |
| MP | mattpocock/skills | @a496f55 · `skills/engineering/codebase-design/{SKILL,DEEPENING}.md` |
| DDH | Sairyss/domain-driven-hexagon README (ports-and-adapters guide, quotes Cockburn) | @5c2d15a · `README.md` |

### 2. spring.md

**LY6 · REWORD** — now: one constructor; optional collaborator is an `ObjectProvider<T>` resolved at use; never setter, no-arg constructor or `@Autowired(required=false)`.
- Proposed: *Take every required dependency through the constructor into a `final` field; never field or setter injection. For an optional collaborator, take an `ObjectProvider<T>` and resolve it where it is used, because a field- or setter-injected bean can be built with a null dependency.* (35 words)
- Sources: FW factory-collaborators: "The Spring team generally advocates constructor injection, as it lets you implement application components as immutable objects and ensures that required dependencies are not `null`." · BOOT: "We generally recommend using constructor injection to wire up dependencies" · SONAR S6813: "field injection is discouraged. It allows the creation of objects in an invalid state" · SONAR S3306: "really a NullPointerException waiting to happen" · JF MUST NOT: "Use field injection (`@Autowired` on fields)".
- Why: the constructor half has three independent sources. The `ObjectProvider`-resolved-at-use half is in FW only (aot.adoc: "use `@Lazy` injection points or `ObjectProvider` to lazily access"). FW also allows setters "for optional dependencies that can be assigned reasonable default values". So keep it as the permitted alternative and drop "never a setter" for optional dependencies, or keep it as house style.
- Pair: the Bad/Good tests the `ObjectProvider` sub-clause, not the core rule. It still fits if that clause stays. Add a field-injection Bad. The Bad's note "in orders-api" names an application: make it neutral.

**SC1 · REWORD** — now: never `@Autowired` in production; exactly one constructor; no test-only second constructor.
- Proposed: *Give each bean exactly one constructor and no `@Autowired` on it; never add a second constructor for tests, because with several constructors the container chooses by its own rules and tests exercise wiring production never uses.* (35 words)
- Sources: FW aot.adoc "Avoid Multiple Constructors": "relying on that is not a best practice" · BOOT: "If a bean has more than one constructor, you will need to mark the one you want Spring to use with `@Autowired`" · PL301 Ex 7 title: "Prefer one constructor and final fields for required dependencies"; Ex 7: "`@Autowired` optional on a single constructor since Spring 4.3" · JF: "constructor injection — no @Autowired" · SONAR S6818: "`@Autowired` should only be used on a single constructor".
- Why: the old "because" was one project's incident. The sources agree on one constructor with `@Autowired` redundant. No source bans `@Autowired` outright (it remains the marker when several constructors exist), so the ban follows from the one-constructor rule. Could merge into LY6.
- Pair: none.

**SC2 · REWORD** — now: cut a cycle; else an `ObjectProvider` field resolved at call time, with a comment naming the cycle.
- Proposed: *Cut every bean dependency cycle; where it cannot be cut, inject `ObjectProvider<T>` and resolve it at call time, because a constructor cycle fails startup with `BeanCurrentlyInCreationException` and an AOT context refuses it.* (33 words)
- Sources: FW factory-collaborators: "the Spring IoC container detects this circular reference at runtime, and throws a `BeanCurrentlyInCreationException`" · FW aot: "an AOT-optimized context will fail to start with explicit circular dependencies … you can use `@Lazy` injection points or `ObjectProvider`" · ADDY code-review-and-quality:58: "Are dependencies flowing in the right direction (no circular dependencies)?"
- Why: "avoid cycles" has two organisations. The `ObjectProvider` fallback and the "comment naming the cycle" are Spring-only and house style. Keep the comment only as house style.
- Pair: none.

**SC3 · DROP** — never `@Lazy` on an `ObjectProvider`; never global lazy init.
- Sources found: BOOT spring-application: "A downside of lazy initialization is that it can delay the discovery of a problem with the application." FW factory-collaborators: "This potentially delayed visibility of some configuration issues is why `ApplicationContext` implementations by default pre-instantiate singleton beans." Both are Spring, so one organisation.
- Reason: no second organisation found. The failure is real, so the operator may keep it as house style. FW aot itself recommends `@Lazy` injection points for an unavoidable cycle, which contradicts the `@Lazy` half.

**SC4 · DROP** — never `@Primary`/`@Fallback`.
- Reason: one project's choice, and its "because" is one incident (a PKIX failure). PL301 Ex 10 recommends the opposite: "mark the default with `@Primary` or inject by name using `@Qualifier`". FW ships `@Fallback` for this case.

**SC7 · DROP** — choose implementations only by `@ConditionalOnProperty`; no `@ConditionalOnMissingBean` stub.
- Reason: the selection scheme is one project's design and its "because" is an incident. The sourced kernel is BOOT only: "we recommend using only `@ConditionalOnBean` and `@ConditionalOnMissingBean` annotations on auto-configuration classes (since these are guaranteed to load after any user-defined bean definitions have been added)". PL301 Ex 6 uses `@ConditionalOnMissingBean` in a user configuration. The operator may keep the BOOT kernel as house style.

**SC9 · DROP** — an `ApplicationContextRunner` spec for each property-selected bean.
- Reason: it depends on SC7. Runner tests for conditional beans are BOOT only ("`ApplicationContextRunner` provides a great way to achieve that"), and the "because" is an incident. Runner tests for settings binding are well sourced and kept under SC15.

**SC5 · REWORD** — `@Configuration(proxyBeanMethods = false)`; collaborators as `@Bean` parameters, never a `@Bean` call.
- Proposed: *Declare each configuration class `@Configuration(proxyBeanMethods = false)` and pass collaborators as `@Bean` method parameters, never by calling another `@Bean` method, because proxying adds a CGLIB subclass and, without it, a direct call builds a second instance.* (35 words)
- Sources: FW basic-concepts: "every such call can be expressed through a factory method argument instead. The positive side-effect here is that no CGLIB subclassing has to be applied at runtime, reducing the overhead and the footprint." · SONAR S3305: "using parameter injection instead of field injection for dependencies that are only used in a single `@Bean` method" · SONAR S6838: "the bean is created multiple times instead of being created once … [fix:] injecting the bean … by means of `@Bean` method parameters."
- Why: two organisations. The new "because" names both failures, the startup cost and the duplicate singleton. Note that FW also says full `@Configuration` "helps to reduce subtle bugs". The rule is safe only together with its "never call a `@Bean` method" half.
- Pair: none.

**SC6 · DROP** — a `@Bean` method returns its most specific type.
- Sources found: FW aot: "make sure that the return type of an `@Bean` factory method is as precise as possible". BOOT developing-auto-configuration: "if your bean's concrete class implements an interface the bean method's return type should be the concrete class". Both are Spring.
- Reason: one organisation. The operator may keep it as house style, since the failure (type-based conditions and AOT see only the declared type) is concrete.

**SC8 · KEEP** — `@Enable*` feature switches on a dedicated `@Configuration`, never on the `@SpringBootApplication` class.
- Text unchanged (it is already within budget and grep-decidable).
- Sources: BOOT testing: "you should avoid adding configuration settings that are specific to a particular area on the main method's application class" · PL301 Ex 1: "No additional annotations — such as `@EnableScheduling`, `@EnableKafka`, `@EnableAsync` … should ever appear on the main class."
- Pair: none.

**LY7 · REWORD** — grouped settings in one validated `@ConfigurationProperties` record; `@Value` only for a single scalar.
- Proposed: *Bind related settings to one `@ConfigurationProperties` record, each key in one place; use `@Value` only for a lone scalar no other class reads, because scattered `@Value` reads each carry their own default and skip validation.* (34 words)
- Sources: BOOT external-config: "If you define a set of configuration keys for your own components, we recommend you group them in a POJO annotated with `@ConfigurationProperties`" · PL301 Ex 4: "avoid scattering many `@Value` fields and hardcoded secrets across the codebase" · SBS configuration-properties: "Use a typed ConfigurationProperties record for a related group of settings" · JF: "`@ConfigurationProperties(prefix = "app")` bound to a record/class".
- Why: well sourced. The reworded "because" is generic, where the old one was an incident.
- Pair: fits (one key with two placeholder defaults, then one record).

**SC12 · DROP** — move a key read in two classes into the record that owns it.
- Reason: it duplicates LY7 ("each key in one place"), and its "because" is the same incident. Fold its review check into LY7.

**SC11 · REWORD** — register a properties record with `@EnableConfigurationProperties`, never also `@Component`/`@Bean`.
- Proposed: *Register a settings record with `@EnableConfigurationProperties` or `@ConfigurationPropertiesScan`, never as `@Component` or a `@Bean` method, because constructor binding does not apply to a record created that way.* (29 words)
- Sources: BOOT external-config: "You cannot use constructor binding with beans that are created by the regular Spring mechanisms (for example `@Component` beans, beans created by using `@Bean` methods…)" · SBS: "Register it with EnableConfigurationProperties or ConfigurationPropertiesScan; a record is not automatically a bean." · PL301 Ex 4: "Register properties with `@EnableConfigurationProperties` or `@ConfigurationPropertiesScan` on those configuration classes".
- Why: all three sources allow scanning, so name it as the alternative. "On the module's configuration class" is house style.
- Pair: none.

**SC13 · DROP** — config only through binding/`Environment`, kebab-case under the project prefix; never `System.getenv`.
- Sources found: BOOT external-config: "You should always refer to property names in the placeholder using their canonical form (kebab-case using only lowercase letters)." BOOT also describes configtree imports. No second organisation says "never `System.getenv`". SBS only says to "validate actual environment-variable binding in a test".
- Reason: one organisation, and the project prefix is a project choice. The operator may keep it as house style: the failure (configtree secrets skipped, tests cannot override) is concrete.

**SC10 · DROP** — `@ConditionalOnProperty` key kebab-case under the prefix, stating `havingValue` and `matchIfMissing`.
- Reason: BOOT only ("use a unique namespace"; it documents `havingValue`/`matchIfMissing` but does not require stating them). The ledger has no reason for it, and the prefix is a project choice.

**SC14 · KEEP** — times and sizes as `Duration`/`DataSize` with a unit, never a `long` named `*-ms`.
- Text unchanged.
- Sources: BOOT developing-auto-configuration (internal rules): "Use `Duration` rather than `long`"; BOOT external-config: "A regular `long` representation (using milliseconds as the default unit…)" · SBS: "Use explicit units for durations and sizes"; gotcha: "Agent uses a bare numeric timeout - use explicit units."
- Pair: none.

**SC15 · REWORD** — a settings record rejects bad values at startup with a message naming the key, proven by a runner spec.
- Proposed: *Put `@Validated` and Jakarta constraints on each settings record, and prove with an `ApplicationContextRunner` that a missing or invalid value fails startup, because otherwise a bad value surfaces only when the code first reads it.* (35 words)
- Sources: BOOT external-config: "You can use JSR-303 `jakarta.validation` constraint annotations directly on your configuration class" · PL301 Ex 11: "This surfaces binding errors during context startup instead of after the app is running." · SBS: "Use ApplicationContextRunner with EnableConfigurationProperties to assert valid binding and startup failure on missing or invalid settings."
- Why: well sourced. "A message naming the key" is what Bean Validation produces, so it is dropped as a separate demand.
- Pair: none.

**SC16 · REWORD** — no default for a secret or a required endpoint; absence fails startup or selects a named degraded mode with one WARN.
- Proposed: *Give a secret or required endpoint no default value, so its absence fails startup, because a shipped default credential or blank key silently runs production insecure.* (26 words)
- Sources: SBS: "missing credentials or required endpoints should fail startup"; gotcha: "Agent adds a default credential - fail fast" · ASVS 13.2.3: "the credential being used by the consumer is not a default credential" · ASVS V13 intro: "The application's default configuration must be secure for use on the Internet."
- Why: the core is sourced twice. The "named degraded mode that logs once at WARN" escape and its Decided edge are house style.
- Pair: none.

**SC17 · REWORD** — keep a secret out of every `@ConfigurationProperties` record (its `toString` prints it).
- Proposed: *Never hold a secret as a plain `String` component of a settings record; wrap it in a type whose `toString` redacts it, because a record's generated `toString` prints every component value into logs.* (32 words)
- Sources: SBS: "Do not turn a full API token into a record component: generated toString can expose secrets. Resolve secrets at the integration boundary or use a redacting value type." · JDK `Record.toString` @implSpec: "returns a string which contains the name of the record class, the names of components of the record, and string representations of component values" · OWASP-L (never log): "Access tokens … Authentication passwords … Encryption keys and other primary secrets".
- Why: it now names the permitted alternative. This agrees with D7, which dropped "via Environment".
- Pair: none.

**X6 · REWORD** — never `@PostConstruct` in main code.
- Proposed: *Limit `@PostConstruct` to checking injected state; move I/O, calls to other beans and thread or container starts to an `ApplicationRunner` or `SmartLifecycle`, because `@PostConstruct` runs inside the singleton creation lock and can deadlock.* (35 words)
- Sources: FW factory-nature: "`@PostConstruct` and initialization methods in general are executed within the container's singleton creation lock … only meant for validating the configuration state … Otherwise there is a risk for an initialization deadlock." · PL301 Ex 3: "avoid heavy work in `@PostConstruct` when it blocks startup" (Bad: `@PostConstruct void init() { performHeavyMigration(); }`).
- Why: no source bans `@PostConstruct` outright; FW permits validation in it. The proposed text is the ledger's SC18 wording. The total ban is house style and a gate (Checkstyle `IllegalImport`, OQ3). If the gate stays, the rule can stay as the gate's text, with this reword as the generic version.
- Pair: none.

**SC19 · DROP** — `ApplicationRunner` for startup work before traffic; hand later work to a thread from `ApplicationReadyEvent`.
- Sources found: BOOT: "Event listeners should not run potentially lengthy tasks as they execute in the same thread by default"; "Tasks expected to run during startup should be executed by `CommandLineRunner` and `ApplicationRunner`". Both are Spring.
- Reason: one organisation, and PL301 Ex 3 contradicts it (its Good runs work in `@EventListener(ApplicationReadyEvent)`). `ApplicationRunner` survives as the permitted alternative in X6. The operator may keep it as house style.

**SC20 · DROP** — background start/stop work as a `SmartLifecycle` bean, never new-ed by hand.
- Reason: FW factory-nature only ("consider implementing `SmartLifecycle`"; "The default per-phase timeout is 30 seconds"). No second organisation found.

**SC21 · KEEP** — call a proxied-annotation method only from another bean; no self-injection, no `AopContext`.
- Text unchanged.
- Sources: FW proxying: "self invocation via an explicit or implicit `this` reference will bypass the advice"; "The best approach … is to refactor your code such that the self invocation does not happen"; `AopContext` "is highly discouraged" · SONAR S6809: "calling an `@Async`, `@Cacheable`, or `@Transactional` method from its own class bypasses the proxy … Move the annotated operation to a separate Spring-managed bean" · SBS: "self-invocation bypasses Spring proxy, @Transactional ignored" · PL301 Ex 2: "proxy bypassed — inner @Transactional is ignored".
- Pair: fits.

**SC22 · REWORD (contradicts the current FW docs)** — now: `@Retryable` on a caller bean, never on the same method or bean as `@Transactional`.
- Proposed: *Put `@Retryable` on the `@Transactional` method or on a caller with no open transaction, never inside an outer transaction, because each attempt then joins a transaction already marked rollback-only and repeats inside it.* (34 words)
- Sources: FW resilience.adoc: "When `@Transactional` and `@Retryable` are used together, the advice chain is: Retry (OUTER) → Transaction (INNER) … Each retry attempt starts a fresh transaction" and "retry advice is always applied outside `@Transactional` and `@Cacheable`" · SBS: "Retrying inside the failed transaction re-runs code in a TX already marked rollback-only"; "A retrying facade must not already hold a transaction that each attempt's `REQUIRED` method would join."
- Why: with Framework 7's own `@Retryable`, the same-method form is documented as correct. The real failure is a retry running inside an outer transaction. Review check: a `@Retryable` method that is itself called inside an open transaction is a finding. SBS still prefers a separate facade "to make the boundary explicit", so that form remains allowed.
- Pair: none.

**SX18 · KEEP** — a static-only class is `final` with a private constructor.
- Sources: SONAR S1118: "you should define a non-public constructor. This will prevent the compiler from implicitly generating a public parameterless constructor." · SONAR S2974: "Classes with only private constructors should be marked final" · CS HideUtilityClassConstructor: "Instantiating utility classes does not make sense … A common mistake is forgetting to hide the default constructor." · PMD ClassWithOnlyPrivateConstructorsShouldBeFinal.
- Why: it is generic Java rather than Spring. Consider moving it to the Java style file. It keeps its gate-owned review check (D4 amended).

**SX19 · KEEP** — write output through the logger, never `System.out`/`System.err`/`printStackTrace()`.
- Sources: SONAR S106: "Those requirements are not met if a program directly writes to the standard outputs … defining and using a dedicated logger is highly recommended." · PMD SystemPrintln: "By using a logger one can enable/disable this behaviour at will (and by priority)"; PMD AvoidPrintStackTrace: "Avoid printStackTrace(); use a logger call instead." · SBS layered: "Logging: use `@Slf4j` — never `System.out.println`".
- Why: also generic Java, so the same move applies.

**SX14 · DROP** — in a package-private class, `public` only on an override.
- Reason: one source only, PMD PublicMemberInNonPublicType ("their visibility is effectively limited … making the use of the public modifier misleading"). Sonar and Checkstyle are silent. The current "because" overstates the failure: nothing widens until the type is made public. The operator may keep it as house style.

### New rules the sources share that spring.md lacks

1. **SC-N1** — *Never inject a prototype-, request- or session-scoped bean straight into a singleton; inject `ObjectProvider<T>` and resolve it per use, because the singleton keeps the first instance forever.* FW factory-scopes: "The prototype instance is the sole instance that is ever supplied to the singleton-scoped bean." SONAR S6832: "it retains the same instance of that bean, even when new instances are created for each Request or Session."

### 3. services.md

**LY1 · KEEP** — a controller binds, delegates and shapes; a branch that chooses an outcome lives in a service.
- Text unchanged.
- Sources: SBS layered: "`@RestController` ← HTTP only. No business logic."; "Calls ONE service method per endpoint — no orchestration in controllers" · DDH: "Controller is a user-facing API that is used for parsing requests, triggering business logic and presenting the result back to the client." · JF: "`@Service` for business logic … `@RestController` for HTTP".
- Pair: fits. The Decided edge (an exhaustive switch over a returned outcome counts as shaping) is house style but consistent with "presenting the result".

**LY2 · REWORD** — an interface only for a faked boundary or a module boundary, one package-private `Default<Name>`.
- Proposed: *Add an interface only where two implementations exist now, such as a production adapter and a test fake, or at a module boundary; otherwise depend on the class, because a one-implementation interface is indirection without a seam.* (35 words)
- Sources: MP codebase-design:65: "One adapter means a hypothetical seam. Two adapters means a real one."; DEEPENING:29: "A single-adapter seam is just indirection." · DDH: "abusing ports/interfaces may lead to unnecessary abstractions … In a lot of cases it's totally fine to depend on a concrete implementation instead of abstracting it with an interface."
- Why: the core is sourced twice. `Default<Name>`, package-private and the `*Impl` ban are one project's naming choice: drop them, or keep them as house style. SBS hexagonal-architecture makes an interface for every use case, so the industry is split. That is why the reword ties the decision to a second implementation that exists.
- Pair: fits (`*Impl` behind an interface, then a concrete class tested with fakes). Retitle without `Default<Name>`.

**LY3 · REWORD** — two operations that must not be split go behind one method and one transaction at use-case level.
- Proposed: *Put operations that must succeed or fail together, such as a change and its audit row, in one use-case method under one transaction, because two calls left to the caller let one commit without the other.* (35 words)
- Sources: SBS transactional-patterns: "Place multi-step business transactions at the application/service boundary." · DDH: "in a service we execute a global transaction to make sure all the changes … are stored atomically (all or nothing)."
- Why: sourced twice. The old "because" ("shipping an unaudited lookup", #150) was one incident.
- Pair: none.

### New rules the sources share that services.md lacks

1. **LY-N1** — *Return response DTOs from a controller, never persistence entities, because an entity in a response leaks every field it owns and ties the API to the schema.* SBS layered: "No JPA entities in responses"; gotcha "Agent returns `List<Entity>` from controllers — always map to `List<ResponseDto>`". DDH: "clients only receive data described in DTOs contract, not everything that your model/entity owns (which may result in data leaks)".

### 4. messaging.md

**MS6 · REWORD** — every state-changing operation answers "runs twice / crashed halfway?"; reconcile when leftovers matter.
- Proposed: *Make each state-changing consumer or job safe to run twice: claim the work atomically with a unique constraint or row lock in the same transaction as the change, because delivery is at-least-once.* (33 words)
- Sources: KAFKA design: "the consumer process crashes after processing messages but before saving its position … the first few messages it receives will already have been processed. This corresponds to the 'at-least-once' semantics" · ADDY api:335: "No queue does [exactly-once] across a consumer crash … Design for at-least-once with idempotent processing."; ADDY:173 "Claim atomically. A check followed by an act is a race" · SBS idempotency: "record a unique consumer/event pair and apply the projection in one transaction"; event-driven-messaging: "Make every handler idempotent with a durable marker" · PL123: "Consumers that change state must handle duplicate records safely".
- Why: the old text is a question and is hard to decide. The reword makes it checkable by grep or reading: find the atomic claim. The "reconcile leftovers" half is SBS-sourced ("Reconcile uncertain outcomes before retrying irreversible effects"), so it can stay as the rule's second sentence or as a review check. It agrees with D8 (row lock kept).
- Pair: fits. The Bad's FAILED row being rolled back is exactly SBS: "Do not save failure state and then throw a rollback-triggering exception from the same transaction: that erases the state."

**MS4 · REWORD** — skip an unparseable message we did not author, logging partition and offset; never skip our own failures.
- Proposed: *Send a record that fails deserialization to a dead-letter topic, or log its topic, partition and offset and skip it; retry only transient failures, because a poison record fails every retry and blocks its partition.* (35 words)
- Sources: SK annotation-error-handling: "The `DefaultErrorHandler` considers certain exceptions to be fatal, and retries are skipped for such exceptions … `DeserializationException`" · PL123: "Poison records block progress | Retry topic and DLT | Transient failures should retry while permanent failures are isolated" · SBS event-driven-messaging: "Route permanent or exhausted failures to a dead-letter destination with diagnostic headers."
- Why: the "we did not author" test is one project's distinction. The sources split on deserialize-failure vs transient and default to a DLT, not a silent skip.
- Pair: none.

### New rules the sources share that messaging.md lacks

1. **MS-N1** — *Acknowledge or commit the offset only after the state change has committed, because acking first loses the message if the consumer crashes in between.* KAFKA: "read the messages, then save its position … and finally process … corresponds to 'at-most-once' semantics … messages may not be processed". SBS idempotency: "acknowledge only after commit."
2. **MS-N2** — *When a database change must also publish an event, write the event to an outbox table in the same transaction and publish from there, because publishing beside the write loses or invents events on a crash.* PL123 Ex 2: "Use outbox when a service updates a database and must publish an event without a dual-write race." SBS event-driven-messaging: "Use a transactional outbox when a database write and message must agree"; gotcha "Agent publishes directly after a repository call". DDH links "Transactional outbox" for integration events.

### 5. Summary

| file | KEEP | REWORD | DROP | NEW |
|---|---|---|---|---|
| spring.md (27) | 5 (SC8, SC14, SC21, SX18, SX19) | 11 (LY6, SC1, SC2, SC5, LY7, SC11, SC15, SC16, SC17, X6, SC22) | 11 (SC3, SC4, SC7, SC9, SC6, SC12, SC13, SC10, SC19, SC20, SX14) | 1 |
| services.md (3) | 1 (LY1) | 2 (LY2, LY3) | 0 | 1 |
| messaging.md (2) | 0 | 2 (MS6, MS4) | 0 | 2 |

**Contradictions with earlier decisions or the docs:**
- SC22: the current text forbids `@Retryable` on the `@Transactional` method, but the FW 7 reference documents exactly that form as correct.
- X6: rewording it narrows the gate-owned total ban, which the operator decided under OQ3/D4. Say yes or no explicitly.
- D7 and D8 are respected.

**Spring-only drops the operator may keep as house style:** SC3, SC6, SC13, SC19, SC20 and the SC7 kernel. Each has a concrete failure, but all its sources come from the Spring docs, which are one organisation.

## 4 · 48d — Industry re-check: `plugins/rulebook/skills/code/references/security.md`


Read at `origin/main` (fetched 2026-10-31; identical to the working tree). 32 rules. Ledger leads from
`research/19-approved-rules.md:279-286, 436-467`. Operator decisions D1–D12, E1, E2 on agent-factory#32 do not touch
this file; D4 (amended) bears on SS12 only (see there).

Network: only GitHub was reachable. cwe.mitre.org, rfc-editor.org, ietf.org, docs.spring.io, pages.nist.gov,
genai.owasp.org all failed DNS. **cwe.mitre.org (and rfc-editor.org) must be allowed in the session's network
settings** to cite CWE or the final RFCs directly. Every source below was read from its own GitHub repo.

### 1. Sources

All OWASP keys (CS-*, ASVS, LLM) are **one organisation**. Every KEEP/REWORD pairs OWASP with a non-OWASP source.

| key | what | read at (GitHub) |
|---|---|---|
| CS-SSRF, CS-SQLI, CS-XSS, CS-DESER, CS-MASS, CS-LLMPI, CS-CRYPTO, CS-KEYMGMT, CS-PWD, CS-AUTHZ, CS-AUTHZTEST, CS-AUTHN, CS-CSRF, CS-HDR, CS-REST, CS-JWT, CS-LOG, CS-SECRETS, CS-SYMFONY | OWASP Cheat Sheet Series | `OWASP/CheatSheetSeries` `cheatsheets/<Name>_Cheat_Sheet.md` @ master |
| ASVS | OWASP ASVS 5.0 | `OWASP/ASVS` `5.0/en/0x1*-V*.md` |
| LLM | OWASP Top 10 for LLM Apps 2025 | `OWASP/www-project-top-10-for-large-language-model-applications` `2_0_vulns/LLM05*.md`, `LLM10_UnboundedConsumption.md` |
| SSR | Spring Security reference (Spring team) | `spring-projects/spring-security` `docs/modules/ROOT/pages/…` (paths per row) |
| SBS | spring-boot-skills (independent author) | `rrezartprebreza/spring-boot-skills` `skills/spring-boot-4/spring-security-jwt/SKILL.md`, `…/testing-pyramid/SKILL.md` |
| ADDY | addyosmani agent-skills (reference repo) | `addyosmani/agent-skills` `skills/security-and-hardening/SKILL.md`, `references/security-checklist.md` |
| NG | Angular security guide | `angular/angular` `adev/src/content/guide/security.md` |
| NIST | NIST SP 800-63B-4 | `usnistgov/800-63-4` `sp800-63b/authenticators/index.html` |
| OAUTH21 | IETF OAuth 2.1 draft (OAuth WG) | `oauth-wg/oauth-v2-1` `draft-ietf-oauth-v2-1.md` |
| JWTBCP | IETF JWT BCP update (RFC 8725bis draft, OAuth WG) | `oauth-wg/draft-ietf-oauth-rfc8725bis` `draft-ietf-oauth-rfc8725bis.md` |
| JACKSON | jackson-databind source javadoc | `FasterXML/jackson-databind` `src/main/java/tools/jackson/databind/jsontype/PolymorphicTypeValidator.java` |
| JDK | OpenJDK `MessageDigest.isEqual` javadoc | `openjdk/jdk` `src/java.base/share/classes/java/security/MessageDigest.java:562-579` |

OAUTH21 and JWTBCP are one organisation (IETF OAuth WG). Spring Security and Spring Boot docs are one organisation.

### 2. Verdicts

### Untrusted input and output

**SE10 · KEEP**
- Now: treat model output and tool arguments as untrusted; schema-check before SQL/shell/`innerHTML`/path; permissions in code.
- Sources: LLM05 "Treat the model as any other user, adopting a zero-trust approach, and apply proper input validation on responses coming from the model to backend functions." · CS-LLMPI "Enforce permissions and parameter validation at the tool boundary"; "do not treat text labels or prompt wording as an enforcement boundary" · ADDY SKILL:158-159 "Model output is untrusted input … Never into `eval`, SQL, a shell, `innerHTML`, or a file path; parse defensively, validate against a schema" / "The system prompt is not a security boundary; enforce permissions in code."
- Why: OWASP + ADDY state both halves; failure (hijacked prompt reaches a sink) is concrete. No pair.

**SE1 · REWORD**
- Now: fetch a URL not in code only through "the checked-fetch type": http/https, private IPs refused after DNS, no redirects.
- Proposed: "Fetch a URL that is not a literal in code only after one URL check: http or https only, every resolved IP outside private and reserved ranges, connect to that IP, redirects off, because a user-influenced URL can reach internal services." (35 words)
- Sources: CS-SSRF "Disable the support for the following of the redirection in your web client"; "Validate the resolved destination IP addresses … then ensure the HTTP client connects only to validated addresses"; allowed protocols "(`HTTP` or `HTTPS`)" · ADDY SKILL:111 "Allowlist scheme and host, resolve **all** DNS records and reject any private or reserved address … and forbid redirects. That check still has a DNS-rebinding TOCTOU gap" · ASVS 1.3.6.
- Why: "the checked-fetch type" names one codebase's class; both sources add the rebinding gap (connect to the validated IP), which the current text misses. SE1 Good/Bad still fits (it shows the remote-named URL going through the check on a no-redirect client).

**SE3 · KEEP**
- Now: bind every SQL parameter; dynamic identifier from an allowlist in code.
- Sources: CS-SQLI "Parameter markers represent data values, not table names, column names … map their selection to a small set of application-owned tokens … reject unknown choices"; "Continue binding all data values, even when they pass type, length, or format checks" · ADDY checklist:62 "SQL queries parameterized (no string concatenation)".
- Why: two orgs, exact match. No pair.

**SE4 · REWORD**
- Now: `toRealPath()` then `startsWith(base)`; destructive op also checks depth and ownership.
- Proposed: "Resolve a caller-supplied path and its base with `toRealPath()`, then check `Path.startsWith(base)`; before a delete, move or overwrite also check the caller owns the target, because `normalize()` lets a symlink escape the base." (34 words)
- Sources: CS-SYMFONY "Resolve the base directory and requested path with `realpath()` … Check the caller's permission to access the resolved file separately" · ADDY checklist:66 "Destructive path operations …: symlinks resolved, allowlisted root, minimum depth, ownership evidence read before the call"; ADDY SKILL:117.
- Why: realpath + containment + ownership have two orgs; "minimum depth" is ADDY only, so it goes. Note for reviewers: `Path.startsWith(Path)` compares whole components (safe); `String.startsWith` does not (CS-SYMFONY adds the separator for that reason) — worth a review-check line.

**SE5 · REWORD**
- Now: bind untrusted JSON to a fixed record DTO; no default or polymorphic typing; no `Map<String,Object>` past the adapter.
- Proposed: "Bind untrusted JSON to a fixed DTO holding only the fields the caller may set, with no default typing and no class-name type ids (`Id.CLASS`), because payload-chosen classes let the attacker pick what is instantiated." (35 words)
- Sources: CS-DESER "jackson-databind … can be used safely as long as polymorphism is not used" · JACKSON `PolymorphicTypeValidator` "class-name - based subtypes used with Polymorphic Deserialization: both via \"default typing\" and explicit `@JsonTypeInfo` when using Java Class name as Type Identifier … to avoid security problems that occur with unlimited class names" · CS-MASS "Prefer dedicated input objects, such as Data Transfer Objects (DTOs), containing only fields the caller may edit" · ADDY SKILL:104 "downstream code uses only the parsed, typed value".
- Why: JACKSON pins the danger to default typing and class-name ids; `@JsonTypeInfo(use = Id.NAME)` over a closed sealed set is not the threat, so the review check's blanket `@JsonTypeInfo` finding is over-broad (consistent with D5). `Map<String,Object>` is covered by "fixed DTO". No pair here.

**SE6 · KEEP**
- Now: `[innerHTML]` / `bypassSecurityTrust*` only for code-controlled content.
- Sources: NG "binding a value that an attacker might control into `innerHTML` normally causes an XSS vulnerability"; `bypassSecurityTrust*` values are not sanitized · CS-XSS lists "Angular's `bypassSecurityTrustAs*` functions" as framework escape hatches; "refactor your code to remove references to unsafe sinks like innerHTML".
- Why: two orgs. No pair.

### Secrets

**SE2 · DROP**
- Now: stop when decryption fails; never fall back to unauthenticated, cached or default credentials.
- Only ASVS 16.5.3 ("preventing fail-open conditions") states the general principle; no second org states it (ADDY:117 "never fall back to a broader default" is about delete paths). The decrypt-credential framing and its reason come from one project's incident. Operator may keep as house style; the general fail-closed idea already lives in SS4.

**SE7 · REWORD**
- Now: AES-GCM via "the credential encryptor", masked in responses; BCrypt passwords; never MD5/SHA-1/DES.
- Proposed: "Encrypt a stored credential the code must send later with AES-GCM (Spring's `AesGcmBytesEncryptor`), never ECB or MD5, SHA-1 or DES, and mask it in every response, because unauthenticated or weak ciphers expose it." (34 words)
- Sources: CS-CRYPTO "authenticated modes should always be used … The most commonly used authenticated modes are GCM"; "ECB should not be used" · SSR `features/integrations/cryptography.adoc:28` "`AesGcmBytesEncryptor` uses 256-bit AES encryption with Galois Counter Mode (GCM), providing authenticated encryption" · masking: ASVS 14.2.6 "only returns the minimum required sensitive data" + ADDY checklist:136 "Sensitive fields excluded from API responses" · weak hashes: ASVS 11.4.1 "Disallowed hash functions, such as MD5, must not be used"; SSR password-storage:32 "cryptographic hashes (like SHA-256) are no longer secure" (for passwords).
- Why: "the credential encryptor" is one project's class; the password half duplicates SS21 and moves there. No pair.

**SS21 · KEEP**
- Now: passwords via `DelegatingPasswordEncoder` (bcrypt ≥10); machine secrets ≥128 bits via server-keyed HMAC-SHA-256, constant-time compare.
- Sources: SSR password-storage:44-47 "validating a username and password for every request can significantly degrade the performance … exchange the long term credentials … for a short term credential" · CS-PWD "For legacy systems using bcrypt, use a work factor of 10 or more" · NIST 800-63B §3.1.2 "Look-up secrets that are shorter than … 112 bits … SHALL be stored in a salted and hashed form using a suitable password hashing scheme" (so ≥112-bit secrets need only an approved hash) · constant time: ASVS 11.2.4 "no 'short-circuit' operations in comparisons"; JDK `MessageDigest.isEqual` "the calculation time depends only on the length of `digesta`".
- Why: three orgs; reason (CPU sink) is Spring's own wording. SS21 Good/Bad still fits.

**SE7a · REWORD**
- Now: hash each secret by type (= SS21); keep the credential-encryption key distinct from the JWT signing key.
- Proposed: "Give each key one purpose: the credential-encryption key, each token-signing key and each HMAC key are separate secrets, because a key shared across purposes lets output made for one pass as another." (33 words)
- Sources: CS-KEYMGMT:123 "According to NIST, in general, a single key should be used for only one purpose (e.g., encryption, authentication …)" (NIST SP 800-57 as quoted) · JWTBCP:749 "Use different keys for different kinds of JWTs. Then the keys used to validate one kind of JWT will fail to validate other kinds" · CS-CRYPTO:128 "they should be fully independent from each other".
- Why: the hashing half restates SS21 (drop it); the key-separation half is well sourced. Its old reason (CPU sink) did not fit the key part.

**SE8 · REWORD**
- Now: rate limiting active before any LLM call reaches a provider, because … (OWASP LLM10).
- Proposed: "Pass every LLM provider call through a per-caller rate limit and quota before it is sent, because uncapped calls let one caller run up unbounded cost and exhaust the provider quota." (32 words)
- Sources: LLM10 §3 "Apply rate limiting and user quotas to restrict the number of requests a single source entity can make" · ADDY SKILL:160 "cap tokens, request rate, and recursion depth (LLM10)".
- Why: two orgs; the old "because" named a source, not a failure.

### Filter chain and authorization

**SS1 · KEEP**
- Now: end `authorizeHttpRequests` with `anyRequest().denyAll()`; every endpoint public or explicit.
- Sources: SSR `servlet/authorization/authorize-http-requests.adoc:420,561` examples end `.anyRequest().denyAll()`; method-security.adoc:305 "unannotated methods are not secured. To protect against this, declare a catch-all authorization rule" · CS-AUTHZ "Adopt a 'deny-by-default' mentality … explicit configuration should be preferred over relying on framework or library defaults".
- Why: two orgs. Its Decided edge ties `denyAll()` to SS12's ArchUnit gate; with SS12 dropped, the edge should read: `authenticated()` last only while existing endpoints lack explicit matchers.

**SS12 · DROP**
- Now: every handler gets `@PreAuthorize` or a public-path entry, enforced by an ArchUnit rule.
- SSR's own remedy for unannotated methods is the catch-all rule (= SS1), and CS-AUTHZ prefers checks "for global, application-wide configuration rather than needing to be applied individually to every method or class". Per-handler annotation plus an ArchUnit gate is one project's choice. Operator may keep as house style (if kept, D4-amended wording applies: "only where no gate enforces it").

**SS2 · DROP**
- Now: permit `ERROR` and `ASYNC` in one matcher; never `REQUEST` or `FORWARD`.
- Only SSR states the mechanism (Spring Boot docs are the same org), and SSR's example permits `FORWARD` and `ERROR` (`authorize-http-requests.adoc:559`), so "never FORWARD" contradicts its only source; `ASYNC` appears in neither. Operator may keep as house style, reworded to SSR's example.

**SS3 · KEEP**
- Now: register a custom security `Filter` in the chain; disable its servlet registration.
- Sources: SSR `servlet/architecture.adoc:268-272` "That may cause the filter to be invoked twice, once by the container and once by Spring Security and in a different order … setting its `enabled` property to `false`" · SBS SKILL:66-67 "Register a filter bean only in the security chain: disable servlet-container registration with a `FilterRegistrationBean` … whose `enabled` flag is false".
- Why: two orgs. No pair.

**SS4 · KEEP**
- Now: invalid/expired/wrong-type token → 401 at once, on public paths too.
- Sources: SBS SKILL:62,80 "Invalid supplied tokens are rejected even on public endpoints"; "An invalid supplied token returns 401 even when the route permits anonymous access" · OAUTH21:2487-2490 "`invalid_token`: The access token provided is expired, revoked, malformed, or invalid … SHOULD respond with the 401" · ASVS 16.5.3 "preventing fail-open conditions".
- Why: three orgs. No pair.

**SS5 · KEEP**
- Now: CORS only for a named client via `http.cors(…)` with an origin allowlist; never `*` with credentials.
- Sources: ASVS 3.4.2 "Access-Control-Allow-Origin … is a fixed value … or … validated against an allowlist of trusted origins" · SSR `servlet/integrations/cors.adoc` "integrate the `CorsFilter` with Spring Security by providing a `CorsConfigurationSource`", example `allowedOrigins = listOf("https://example.com")` · CS-HDR "set specific origins instead of `*`".
- Why: two orgs. No pair.

**SS16 · REWORD**
- Now: guards on controller handlers, services trust callers; a service called from a worker/scheduler states its own check; because docs claimed checks the code lacked.
- Proposed: "Give a service method called from a non-HTTP entry point (worker, scheduler, listener) its own authorization check, because the filter chain and controller guards never see that call." (29 words)
- Sources: CS-AUTHZ "Permission should be validated correctly on every request, regardless of whether the request was initiated by an AJAX script, server-side, or any other source" · SSR method-security.adoc:305 "unannotated methods are not secured" (method security guards any bean, not only controllers).
- Why: "controllers only" is a choice SSR calls "taste" (method-security.adoc:292) and SBS contradicts (it puts `@PreAuthorize` on service methods); the old reason was one project's docs drift. The second-entry-point half is sourced. Its Decided edge stays.

**SS17 · DROP**
- Now: never `@PostAuthorize`/`@PostFilter` on a writing method; filter in the query.
- Only SSR states it (method-security.adoc:550 "`@PostAuthorize` is not recommended for classes that perform database writes"; :803 "In-memory filtering can obviously be expensive"); no second org found (SBS uses `@PostAuthorize` on a read only). Operator may keep as house style; it is SSR's own warning.

**SS26 · DROP**
- Now: adapt Spring Security's pattern after reading its source; because hand-rolled OIDC skipped checks.
- An operator decision (ledger :467 "operator 2026-10-03") with a one-project reason; no source states it as a rule. The OIDC half is SS11. Operator may keep as house style; this verdict differs from that 2026-10-03 approval, which predates the ≥2-source bar.

### Tokens and sessions

**SS6 · KEEP**
- Now: access tokens ≤15 min; read membership and account status from the database at decision time.
- Sources: ASVS 8.3.2 "changes to values on which authorization decisions are made are applied immediately. Where changes cannot be applied immediately (such as when relying on data in self-contained tokens), there must be mitigating controls"; 7.4.2 "terminates all active sessions when a user account is disabled" · SBS SKILL:59 "checks the current user's enabled, locked, account-expired and credentials-expired flags"; :132 "access-token-expiration: 900000 # 15 minutes"; Gotchas "validate current account status as well as claims" · CS-JWT "short expiration time".
- Why: two orgs for the database read. The 15-minute figure is SBS's number only; OWASP says "short". Keep it as the decidable bound, noting its source.

**SS7 · KEEP**
- Now: own key and `typ` per token purpose; pin the algorithm; check `exp`.
- Sources: JWTBCP §3.11/§3.12 "Use different keys for different kinds of JWTs"; "Distinct types make cross-JWT substitution harder when validators check \"typ\""; §3.1 "MUST NOT employ any algorithms outside" the permitted set · ASVS 9.1.2 algorithm allowlist; 9.2.1 "'nbf' and 'exp' must be verified"; 9.2.2 correct token type · SBS "the bearer filter must accept `type=access` tokens only".
- Why: three orgs. Its Decided edge (`iss`/`aud` optional for a single-purpose self-issued key) matches CS-JWT §MAC per the ledger and ASVS 9.2.4.

**SS8 · KEEP**
- Now: access/refresh token or long-lived secret in a header, HttpOnly cookie or single-use ticket, never a URL.
- Sources: OAUTH21:2284-2285 "clients MUST NOT send the access token in a URI query parameter, and resource servers MUST ignore access tokens in a URI query parameter" · ASVS 14.2.1 "the URL and query string do not contain sensitive information, such as an API key or session token" · CS-REST "security tokens, and API keys should not appear in the URL, as this can be captured in web server logs".
- Why: two orgs. Its webhook Decided edge is one project's migration and should be cut from the generic file (or kept as a generic "deprecate the URL form one release" edge if the operator wants).

**SS9 · KEEP**
- Now: credential cookie `HttpOnly; Secure; SameSite=Strict`, narrow `Path`; reject cross-site `Origin`.
- Sources: SSR `features/exploits/csrf.adoc:266-273` "What if my application is stateless? That does not necessarily mean you are protected … an application that uses a custom cookie that contains all the state … is vulnerable to CSRF attacks"; :191 `Strict` semantics · ASVS 3.3.1 `Secure`, 3.3.2 `SameSite` "set according to the purpose", 3.3.4 `HttpOnly`, 3.5.1 origin validation · CS-CSRF "Verifying Origin with standard headers".
- Why: two orgs. `Strict` is stricter than ASVS requires; fine as a decidable choice.

**SS10 · KEEP**
- Now: rotate refresh token on every use; revoke all of a user's refresh tokens on password change/reset, deactivation, role change.
- Sources: OAUTH21:2174-2176 "Refresh token rotation: the authorization server issues a new refresh token with every access token refresh response. The previous refresh token is invalidated"; :2158 "validate that the grant corresponding to this refresh token is still active" · ASVS 10.4.5 (rotation), 7.4.2 (disable → end sessions), 7.4.3 (terminate other sessions after "password change via reset or recovery") · SBS:137 "rotate the refresh token on every use, and revoke the previous token".
- Why: three orgs. Role change is the weakest trigger (ASVS 8.3.2 "applied immediately" covers it).

**SS11 · KEEP**
- Now: IdP `id_token` via Spring `oauth2Login` with signature, `iss`, `aud`, `exp`, `nonce` checks and browser-bound `state`.
- Sources: OAUTH21:1013-1016 "validating the `nonce` parameter provides CSRF protection. Otherwise, one-time-use CSRF tokens carried in the `state` parameter that are securely bound to the user agent MUST be used" · ASVS 10.1.2 (same user-agent session), 10.5.1 nonce, 10.5.3 issuer, 10.5.4 "'aud' … equal to the 'client_id'" · SSR `servlet/oauth2/login/advanced.adoc:968` `OidcIdTokenValidator(clientRegistration)`.
- Why: three orgs. "Through `oauth2Login`" is the permitted alternative SSR documents.

### Errors and headers

**SS19 · KEEP**
- Now: production error body = code, fixed message, trace id; `include-message` and binding errors off.
- Sources: ASVS 16.5.1 "a generic message is returned … ensuring no exposure of sensitive internal system data such as stack traces, queries, secret keys" · ADDY SKILL:98 "Error bodies are generic; internals go to server logs only"; :73 "Never expose stack traces or internal error details" · CS-AUTHZ "Ensure sensitive information … is not exposed in error messages".
- Why: two orgs for the principle; the property names are the Spring Boot mechanism.

**SS20 · REWORD**
- Now: keep every Spring default security header; name the threat in the MR for any CSP/HSTS/frame-options change.
- Proposed: "Keep every Spring Security default response header; a change may tighten CSP, HSTS or framing but never removes or loosens one, because each default header is a browser protection that disappears silently." (32 words)
- Sources: SSR `features/exploits/headers.adoc:22` "Spring Security provides a default set of security related HTTP response headers to provide secure defaults" · ASVS 3.4.1 HSTS, 3.4.4 nosniff, 3.4.6 frame-ancestors · ADDY SKILL:96 "CSP starts from `default-src 'self'` and is tightened, not loosened".
- Why: "name the threat in the MR" is a process choice no source states; it is not decidable from code. The ledger row had no reason; this one names the failure.

### Security tests

**SS22 · KEEP**
- Now: security ITs authenticate through the real login and filter chain; `@WithMockUser`/`jwt()` only in a guard bean's unit spec.
- Sources: SSR `servlet/test/method.adoc:189-191` "`@WithMockUser` … populate the `SecurityContextHolder` for the test thread. This cannot apply to full HTTP requests a test makes to a running server … authenticate the request itself" · SBS testing-pyramid:142 "`@WithMockUser` does not authenticate a request sent over HTTP to a random-port server"; :66 "`@WithMockUser` only authenticates".
- Why: two orgs.

**SS23 · DROP**
- Now: matrix IT per guarded controller: caller kind × endpoint → status.
- Only OWASP states the matrix (CS-AUTHZTEST "authorization matrix"; CS-AUTHZ "Create Unit and Integration Test Cases"); ADDY covers the IDOR check, not its test. "Other-tenant member" and "API key" are one project's caller kinds. Operator may keep as house style.

**SS24 · KEEP**
- Now: ITs send forged, expired, `alg:none`, wrong-key and wrong-`typ` tokens and expect 401.
- Sources: JWTBCP §2.1 "The algorithm can be changed to \"none\" by an attacker, and some libraries would trust this value"; RS256→HS256 confusion "(see McLean and CVE-2015-9235)"; §3.2 "JWT libraries MUST NOT consume JWTs using \"none\"" · ASVS 9.1.1 signature, 9.1.2 "must not include the 'None' algorithm", 9.2.1 `exp`, 9.2.2 type.
- Why: two orgs; the reason (libraries shipped such flaws) is JWTBCP's own text.

**SS25 · DROP**
- Now: each public-path entry has an IT proving its replacement check refuses a bad caller (wrong secret → 401, unknown id → 404, setup done → 400).
- No source. The reason and the status examples come from one project's setup endpoint. Operator may keep as house style.

### 3. New rules the sources share that the file lacks

1. **Login rate limit** — "Rate-limit failed authentication attempts per account, because an unthrottled login or key check lets an attacker guess passwords online." NIST 800-63B "The verifier SHALL implement a rate-limiting mechanism that effectively limits the number of failed authentication attempts" · CS-AUTHN "The counter of failed logins should be associated with the account itself" · ADDY checklist:41 "Rate limiting on login endpoint".
2. **No secrets in logs** — "Never log a password, token, session id or key; log a hash or the id instead, because logs reach more readers than the secret should." CS-LOG "should usually not be recorded … Access tokens … Authentication passwords … Encryption keys" · SBS:65 "Never log bearer tokens."
3. **Secrets from the environment** — "Read every key and credential from the environment or a secret store, never a literal in code or config, because committed secrets survive in history." CS-SECRETS "secrets themselves should never be hardcoded"; "Secrets in code could have commit history" · SBS "Agent stores JWT secret in code — always `${JWT_SECRET}` from environment" · ADDY SKILL:89 "The session secret comes from the environment, never from code."

### 4. Summary

| file | KEEP | REWORD | DROP | NEW |
|---|---|---|---|---|
| code/references/security.md | 17 | 8 | 7 | 3 |

KEEP: SE10, SE3, SE6, SS21, SS1, SS3, SS4, SS5, SS6, SS7, SS8, SS9, SS10, SS11, SS19, SS22, SS24.
REWORD: SE1, SE4, SE5, SE7, SE7a, SE8, SS16, SS20.
DROP: SE2, SS12, SS2, SS17, SS26, SS23, SS25.

Knock-on edits if adopted: SS1's Decided edge (drops its SS12 dependency); the SS2 edge goes with SS2; the SS8 webhook
edge is one project's migration; the SE5 review check should flag `Id.CLASS`/default typing, not every `@JsonTypeInfo`;
SE7's password clause and SE7a's hashing clause fold into SS21; "When X, use Y" rows for SE7/SS26 change accordingly.

## 5 · T2 re-check: `concurrency.md` and `angular-ui.md` (agent-factory#32)


Read 2026-10-31. Rules taken from `git show origin/main:plugins/rulebook/skills/code/references/{concurrency,angular-ui}.md`
after `git fetch origin main`. Only GitHub was reachable. All sources were fetched with curl from
`raw.githubusercontent.com` at the default branch on that date, and `:N` is a line in that fetched file. No source here
is pinned to a commit, so re-pin them before you merge. **Not read:** openjdk.org (JEP 444, JEP 491), docs.oracle.com,
angular.dev, typescript-eslint.io, MDN and w3.org sites, and learn.microsoft.com. Each was blocked (DNS refused).
Where those hosts have GitHub sources, I read those instead. Books (JCP, Effective Java) were not reachable through
any page, so none is cited.

### 1. Sources

Independence: each bullet group is one organisation. Two pages from one group count as one source.

**JDK (OpenJDK)**: `openjdk/jdk` master, `src/java.base/share/classes/java/...`
- `jdk-cf` `util/concurrent/CompletableFuture.java` :72-74 (no-executor async → common pool), :2545-2547 (cancel does not interrupt)
- `jdk-fjp` `util/concurrent/ForkJoinPool.java` :88-89
- `jdk-tpe` `util/concurrent/ThreadPoolExecutor.java` :170-185 · `jdk-ex` `util/concurrent/Executors.java` :76-91
- `jdk-thread` `lang/Thread.java` :105-111 · `jdk-sv` `lang/ScopedValue.java` :138-148, :181-191

**Spring**: `spring-projects/*` main
- `sf-sched` spring-framework `framework-docs/modules/ROOT/pages/integration/scheduling.adoc` :697-699
- `sf-webflux` spring-framework `…/pages/web/webflux/new-framework.adoc` :216-219
- `sb-app` spring-boot `documentation/spring-boot-docs/…/reference/pages/features/spring-application.adoc` :408-411

**Other industry sources**
- `grpc-dl`, `grpc-retry`: `grpc/grpc.io` `content/en/docs/guides/deadlines.md` :24-27, `retry.md` :11, :67
- `ms-tf`, `ms-cb`, `ms-storm` (Microsoft, one source): `MicrosoftDocs/architecture-center` `docs/best-practices/transient-faults.md` :58, :82, :96, :106, :187; `docs/patterns/circuit-breaker.md` :29; `docs/antipatterns/retry-storm/index.md` :43
- `polly`: `App-vNext/Polly` `docs/strategies/retry.md` :36-37, :106, :110
- `ietf-idem`: `ietf-wg-httpapi/idempotency` `draft-ietf-httpapi-idempotency-key-header.md` :53, :64
- `hikari`: `brettwooldridge/HikariCP` `README.md` :190-193
- `guava`: `google/guava` wiki `CachesExplained.md` :25-30 · `caffeine`: `ben-manes/caffeine` wiki `Eviction.md` :17
- `pg`: `postgres/postgres` `doc/src/sgml/mvcc.sgml` :1546-1549
- `go`: `golang/website` `_content/doc/effective_go.html` :2725-2726

**Reference skill repos** (each is its own author)
- `pl125`, `pl126`, `pl142`, `pl123cc`: `jabrena/plinth` main, `skills/125-java-concurrency/references/125-java-concurrency.md` (numbered list #8-#15), `126-…/126-java-exception-handling.md` #6, #12, `142-…/142-java-functional-programming.md` Example 19, `123-java-design-patterns/references/123-cross-cutting-integration-patterns.md` :22, :42-43, :92-94, :150
- `addy-api`, `addy-perf`, `addy-a11y`, `addy-fe`: `addyosmani/agent-skills` main, `skills/api-and-interface-design/SKILL.md` :163, :171, :215; `references/performance-checklist.md` :114-116, :181, :232, :240; `references/accessibility-checklist.md` :28, :57-67; `skills/frontend-ui-engineering/SKILL.md` :185-186, :202
- `ps-*`: `cursor/plugins` main `pstack/skills/`: `principle-separate-before-serializing-shared-state/SKILL.md` :15-17; `principle-make-operations-idempotent/SKILL.md`; `typescript-best-practices/SKILL.md` (rules table); `principle-type-system-discipline/SKILL.md` :13-14
- `jf-*`: `Jeffallan/claude-skills` main `skills/java-architect/SKILL.md` :55; `skills/angular-architect/SKILL.md` MUST/MUST NOT lists

**Angular (Google, one source)**: `angular/angular` main (package 22.3.0-next.3)
- `ng-bp` `packages/core/resources/best-practices.md` :5-59 (this is the angular.dev `assets/context/best-practices.md`)
- `ng-sg` `adev/src/content/best-practices/style-guide.md` :111-118, :218-243
- `ng-effect` `adev/src/content/guide/signals/effect.md` :19, :29-31
- `ng-cf` `adev/src/content/guide/templates/control-flow.md` :53-71
- `ng-tud` `adev/src/content/ecosystem/rxjs-interop/take-until-destroyed.md` :5, :29
- `ng-onpush` `adev/src/content/best-practices/runtime-performance/skipping-subtrees.md` :3, :9, :20
- `ng-zl` `adev/src/content/guide/zoneless.md` :7, :14
- `ng-ttc` `adev/src/content/tools/cli/template-typecheck.md` :6-7, :30

**angular-eslint** (community project, separate from Google): `angular-eslint/angular-eslint` main, `packages/eslint-plugin{,-template}/docs/rules/`, rules `prefer-standalone`, `prefer-on-push-component-change-detection`, `prefer-inject`, `prefer-signals`, `prefer-output-emitter-ref`, `prefer-signal-model`, `no-implicit-take-until-destroyed`, `prefer-control-flow`, `prefer-class-binding`, `interactive-supports-focus`, `button-has-type`, `elements-content`

**TypeScript**
- `ts-hb` (Microsoft): `microsoft/TypeScript-Website` v2 `packages/documentation/copy/en/handbook-v2/Narrowing.md` :416-432, :658, :709-736; `Everyday Types.md` :39-46; `release-notes/TypeScript 4.9.md` :47, :66; `tsconfig-reference/copy/en/options/strict.md` :6-8
- `gts` (Google): `google/styleguide` gh-pages `tsguide.md` :3054-3075, :4219-4310
- `tse` (typescript-eslint): `typescript-eslint/typescript-eslint` main `packages/eslint-plugin/docs/rules/{no-non-null-assertion,no-explicit-any,switch-exhaustiveness-check}.mdx`
- `oats` (openapi-ts): `openapi-ts/openapi-typescript` main `packages/openapi-fetch/README.md` :44-48, `packages/openapi-typescript/README.md` :3
- `react` (Meta): `reactjs/react.dev` main `src/content/learn/you-might-not-need-an-effect.md` :63

**Accessibility**
- `apg-names`, `apg-button` (W3C): `w3c/aria-practices` main `content/practices/names-and-descriptions/names-and-descriptions-practice.html` :132, :434-435; `content/patterns/button/button-pattern.html` :96-98
- `wcag-kbd` (W3C): `w3c/wcag` main `understanding/20/keyboard.html` :19
- `using-aria` (W3C, discontinued draft kept for reference): `w3c/using-aria` gh-pages `index.html` :198
- `mdn-btn`, `mdn-title` (Mozilla): `mdn/content` main `files/en-us/web/accessibility/aria/reference/roles/button_role/index.md` :24, :31; `files/en-us/web/html/reference/global_attributes/title/index.md` :101-111

---

### 2a. `concurrency.md`

**CC1 · REWORD**
- Current: virtual threads for blocking I/O fan-out, never pooled; `synchronized` fine on 25; avoid blocking in a class initialiser, because a blocking class initialiser still pins.
- Proposed: **CC1** — Run blocking I/O fan-out on `Executors.newVirtualThreadPerTaskExecutor()`, one virtual thread per task, never a pool of virtual threads, because a pool caps concurrency at its size and blocked tasks then queue behind it.
- Sources:
  - pl125 #8: "Embrace virtual threads via `Executors.newVirtualThreadPerTaskExecutor()` for I/O-bound tasks … Avoid pooling virtual threads."
  - jdk-thread :108-110: "a single Java virtual machine may support millions of virtual threads … suitable for executing tasks that spend most of the time blocked."
  - sb-app :410-411: "properties which configure thread pools don't have an effect anymore. That's because virtual threads are scheduled on a JVM wide platform thread pool and not on dedicated thread pools."
- Why:
  - The "never pool" core has three sources. The current "because" rests only on the class-initialiser and `synchronized` clauses, and their source (JEP 491) could not be read because openjdk.org is blocked. A search snippet (InfoQ) says JEP 491 still pins in class initialisers, but I did not read the JEP.
  - Keep those two clauses as a Decided edge marked "source unread: JEP 491" until someone reads it. pl125 #13 still states the pre-491 pinning advice, so it is stale, as the file already says.
  - **Contradicts D6 in part:** D6 kept CC1's "avoid" wording in the check. This proposal moves that clause out of the rule.
- Good/Bad: none.

**CC2 · KEEP**
- Text: unchanged (current, 30 words).
- Sources:
  - jdk-cf :72-74: "All *async* methods without an explicit Executor argument … are performed using the ForkJoinPool#commonPool()."
  - jdk-fjp :88-89: "no such adjustments are guaranteed in the face of blocked I/O or other unmanaged synchronization."
  - pl125 #12: "Avoid blocking I/O within the common pool; if blocking is unavoidable, use `ForkJoinPool.ManagedBlocker` or a dedicated executor."
- Why: two independent sources, JDK and plinth. The failure (common-pool starvation) is concrete.
- Good/Bad: none.

**CC3 · KEEP (light reword for decidability)**
- Proposed: **CC3** — Give every remote call a client connect and read timeout (or deadline) that ends the call; `orTimeout` alone only stops the wait, because a call with no stopping timeout holds its thread and connection forever.
- Sources:
  - grpc-dl :24-26: "By default, gRPC does not set a deadline which means it is possible for a client to end up waiting for a response effectively forever. To avoid this you should always explicitly set a realistic deadline."
  - ms-tf :96: "Set timeouts on every outbound call … Timeouts that are too long cause threads and connections to accumulate during outages."
  - pl123cc :42: "Remote calls must have explicit timeouts before retries are considered."
  - jdk-cf :2545-2547: `cancel`'s "mayInterruptIfRunning … has no effect in this implementation because interrupts are not used to control processing." This supports the `orTimeout` clause.
- Good/Bad: the CC3 pair still fits.

**CC9 · REWORD**
- Proposed: **CC9** — Treat a remote call with a side effect that times out after connecting as unknown, not failed; resend it only with the initiator's idempotency key, because the effect may have applied and a new key duplicates it.
- Sources:
  - addy-api :215: "Every call has three outcomes, not two: success, failure, and _unknown_. A timeout tells you nothing about whether the effect applied."
  - addy-api :171: "The key comes from the client or the initiating event — never from the layer doing the retrying."
  - ietf-idem :53: "the request timed out. The client is left uncertain about the status of the resource … does not know if it can safely retry."
  - ietf-idem :64: "An idempotency key is a unique value generated by the client which the resource uses to recognize subsequent retries of the same request."
- Why:
  - The "record intent before the call" clause has one source (addy-api :215). pstack's idempotency principle is adjacent and does not state it. I removed that clause from the rule. The operator may keep it as house style or as a Decided edge.
- Good/Bad: still fits. The Good still records intent, which does no harm.

**CC8 · KEEP**
- Text: unchanged (30 words).
- Sources:
  - ms-tf :58: "Retry tasks only when the faults are transient."
  - ms-tf :82: "Use an exponential back-off strategy with jitter."
  - ms-tf :187: "If … the operations aren't idempotent, inconsistencies can occur."
  - grpc-retry :11: "determine the number of retry attempts."
  - grpc-retry :67: "Jitter of plus or minus 20% is applied … to avoid hammering servers."
  - polly :106/:110: `MaxRetryAttempts`, `UseJitter`.
  - pl123cc :42-43: "TIMEOUTS REQUIRED … Never retry immediately in tight loops; use bounded attempts and jitter."
- Why: four independent sources (Microsoft, gRPC, Polly, plinth).
- Good/Bad: none.

**CC4 · KEEP**
- Text: unchanged.
- Sources:
  - jdk-tpe :170-180: an unbounded queue "admits the possibility of unbounded work queue growth when commands continue to arrive on average faster than they can be processed."
  - jdk-ex :88-91: `newFixedThreadPool` builds `new LinkedBlockingQueue<Runnable>()`.
  - sf-sched :697-699: "By default, the queue is unbounded, but this is rarely the desired configuration, because it can lead to `OutOfMemoryError`."
  - pl125 #10: "Prevent unbounded work queues … by using bounded queues, appropriate rejection policies."
- Why: JDK, Spring and plinth all state it. The reason matches Spring's wording.
- Good/Bad: the CC4 pair still fits.
- Note: the pl142 Example 19 Good itself uses `newFixedThreadPool(4)`. Do not copy it.

**CC5 · REWORD**
- Proposed: **CC5** — Give each concurrent writer its own key or file and merge where it is read; when one shared target is real, acquire its locks in one documented global order, because shared writes race and opposite lock orders deadlock.
- Sources:
  - ps-separate :15-16: "Default: eliminate the shared write target … Give each actor its own owned file, key, branch."
  - go :2725-2726: "Do not communicate by sharing memory; instead, share memory by communicating."
  - pg :1546-1549: "The best defense against deadlocks is generally to avoid them by being certain that all applications … acquire locks on multiple objects in a consistent order."
  - pl125 #11: "Establish global lock ordering."
- Why: I found no source for "a lock has one owner", so that clause is dropped. Both remaining halves have two sources each.
- Good/Bad: none.

**CC6 · REWORD (scope narrowed)**
- Proposed: **CC6** — Never block with `join()`, `get()` or `block()` on an event-loop or common-pool thread; compose with `thenApply`/`thenCompose`/`allOf`, or run the flow on a virtual thread, because a blocked event-loop thread stalls every request it serves.
- Sources:
  - sf-webflux :218-219: "In Spring WebFlux … it is assumed that applications do not block. Therefore, non-blocking servers use a small, fixed-size thread pool."
  - pl142 Ex. 19: "Avoid premature `join()`/`get()` in the middle of the flow; keep blocking at the outer boundary."
  - jf-java :55 (MUST NOT): "Use blocking code in reactive applications."
  - jdk-fjp :88-89 (common pool and blocked I/O).
- Why:
  - The current rule bans a mid-pipeline `join()` in all request-serving code. That conflicts with CC1, because on a virtual thread a blocking `join()` is the intended style (jdk-thread :109-110).
  - The sources support the ban only where a few shared threads serve many requests.
- Good/Bad: none. The check's grep stays, but a hit inside a virtual-thread task is not a finding.

**CC7 · REWORD (reason was wrong)**
- Proposed: **CC7** — Pass request-scoped context (tenant, principal, depth) as a parameter or a `ScopedValue`, never a new `ThreadLocal`, because a `ThreadLocal` outlives the request on a reused thread unless removed, leaking context into the next request.
- Sources:
  - jdk-sv :181-189: "A `ScopedValue` should be preferred over a `ThreadLocal` … A `ThreadLocal` has an unbounded lifetime and thus continues to have a value after a method completes, unless explicitly removed."
  - pl125 #14: "propagate contextual data with `ScopedValue` instead of `ThreadLocal`."
  - pl125 #8: "Prefer `ScopedValue` over `ThreadLocal` …"
- Why:
  - The current reason, that a ThreadLocal "does not reach an async thread", is equally true of `ScopedValue`. jdk-sv :138-144 says it is inherited only by threads forked in a `StructuredTaskScope`, which is still preview in Java 25.
  - Add a Decided edge: across a `CompletableFuture` or executor hop, pass the value as a parameter.
- Good/Bad: none.

**CC10 · REWORD**
- Proposed: **CC10** — Give every in-process cache a maximum size or weight and an eviction policy, and every connection pool a maximum size and an acquire timeout, because an unbounded cache leaks memory and an untimed pool queues callers forever.
- Sources:
  - addy-perf :181: "Eviction policy and memory ceiling set (an unbounded cache is a memory leak)."
  - guava :25-30: "a `ConcurrentMap` persists all elements … A `Cache` is generally configured to evict entries automatically, in order to constrain its memory footprint."
  - caffeine :17: "If your cache should not grow beyond a certain size, use `Caffeine.maximumSize(long)`."
  - addy-perf :116: "`connectionTimeoutMillis` set so exhaustion fails fast instead of queueing forever."
  - hikari :190-193: "`connectionTimeout` … maximum number of milliseconds that a client … will wait for a connection from the pool."
- Why: "one pool per database per process" has one source (addy-perf :114, :240), so it is dropped from the rule. The operator may keep it as house style.
- Good/Bad: none.

### New rules the sources share that `concurrency.md` lacks

- **CC11** — Put a circuit breaker on a remote dependency whose failures repeat, beside the timeout and retry, because retrying a dependency that is down wastes threads and amplifies the outage.
  - ms-cb :29: "prevent an application from repeatedly trying to run an operation that's likely to fail."
  - ms-storm :43: "Use the Circuit Breaker pattern … designed specifically to help avoid retry storms."
  - pl123cc :22 and :92-94: "circuit breaker when repeated failures would waste resources."
- No other candidate had two independent sources. Restoring the interrupt flag is only in plinth (pl125 #9, pl126 #6). Retrying at one layer only is only in Microsoft (ms-tf :106).

---

### 2b. `angular-ui.md`

**NGA1 · REWORD**
- Proposed: **NGA1** — Keep `strict` and `strictTemplates` on and fix the type error instead of setting any strict flag to `false`, because a disabled check lets null and type errors through to runtime.
- Sources:
  - ng-bp :5: "Use strict type checking."
  - ng-ttc :30: "Strict mode is the default, and is enabled when the `strictTemplates` flag is `true` or not set."
  - ts-hb strict.md :6: strict "results in stronger guarantees of program correctness."
  - jf-angular MUST: "Use strict TypeScript configuration."
- Why: Angular (ng-ttc :7) and TypeScript (strict.md :8) both document turning flags off "temporarily" or "as needed". "Never" is stricter than they are. It stays defensible for app code, so the reason is tightened to the concrete failure.
- Good/Bad: none.

**NGA2 · REWORD**
- Proposed: **NGA2** — Type a value of unknown shape as `unknown` and narrow it, never `any`, because `any` turns off type checking on every use of that value.
- Sources:
  - tse no-explicit-any: "The `any` type in TypeScript is a dangerous 'escape hatch' … If the type is not known, using the safer `unknown` type."
  - gts :4222: "`any` is dangerous - it can mask severe programming errors."
  - gts :4276: "Use the built-in type `unknown` … much safer as it does not allow dereferencing arbitrary properties."
  - ts-hb Everyday Types :46: "Using `any` disables all further type checking."
  - ng-bp :7.
- Why:
  - The "never suppress `no-explicit-any`" clause contradicts gts :4302-4306. Google allows a suppression with a documented reason, for example a partial mock in a test.
  - **This contradicts the operator's X6 edge** (19:377, "never, even with a stated reason"). Keep that edge as house style if the operator wishes, but no industry source backs it.
- Good/Bad: none.

**NGA3 · KEEP**
- Text: unchanged.
- Sources:
  - gts :3056-3062: "Type assertions (`x as SomeType`) and non-nullability assertions (`y!`) are unsafe. Both only silence the TypeScript compiler … they can cause your program to crash at runtime."
  - tse no-non-null-assertion: "Using assertions to tell the type system new information is often a sign that code is not fully type-safe."
  - ps-ts: "Every `as` is a runtime crash waiting."
- Why: Google allows an assertion "with an obvious or explicit reason". The existing edge for untouched lines is house style.
- Good/Bad: none.

**NGA5 · KEEP**
- Text: unchanged.
- Sources:
  - ts-hb Narrowing :711-736: "rely on `never` turning up to do exhaustive checking in a `switch`", with `const _exhaustiveCheck: never = shape;`.
  - ps-ts: "Inline `const _exhaustive: never = x;` in default arms so the compiler errors when a new variant is added."
  - tse switch-exhaustiveness-check: "if the union type or the enum changes, it's easy to forget to modify the cases." This is the lint alternative.
- Good/Bad: none.

**NGA6 · REWORD**
- Proposed: **NGA6** — Narrow a union by its discriminant, `in`, `typeof` or an `isX` type predicate, and check a value against a type with `satisfies`, not `as`, because `as` skips the check that `satisfies` performs.
- Sources:
  - ts-hb Narrowing :420/:658: type predicates and "discriminated union … can narrow out the members."
  - ts-hb 4.9 :47: "`satisfies` … validate that the type of an expression matches some type, without changing the resulting type."
  - ts-hb 4.9 :66: "`satisfies` can be used to catch lots of possible errors."
  - ps-ts: "Narrowing hierarchy … `satisfies` over `as`."
- Why: the fixed order and the "guard that lies" reason are pstack-only, so both are dropped. A guard that checks less than it claims is still caught by NGA3's spirit and by review.
- Good/Bad: none.

**NGA7 · KEEP**
- Text: unchanged.
- Sources:
  - ps-types :13: "When a protocol buffer, OpenAPI spec … owns a shape, derive from it instead of hand-rolling a parallel type."
  - oats openapi-fetch :44-48: "no manual typing … every manual assertion could lead to a bug!"
  - oats openapi-typescript :3: "turns OpenAPI 3.0 & 3.1 schemas into TypeScript."
- Good/Bad: none.

**NGB1 · REWORD (reason was not a code failure)**
- Proposed: **NGB1** — Write standalone components, never an NgModule, and omit `standalone: true`, the default since v20, because NgModule declarations hide each component's dependencies and weaken tree-shaking.
- Sources:
  - ng-bp :11-12: "Always use standalone components over NgModules. Must NOT set `standalone: true` … It's the default in Angular v20+."
  - angular-eslint prefer-standalone: "Each standalone component declares its own dependencies directly … also enable better tree-shaking."
  - jf-angular MUST NOT: "Use NgModule-based components."
- Why: the old reason, that agents copy the flag, describes agent behaviour, not a code failure. The file says "v21 default", but Angular says v20+.
- Good/Bad: none.

**NGB2 · REWORD (consistent with D10)**
- Proposed: **NGB2** — Keep every component on OnPush (set it on Angular 21, omit it on 22+) and never add `Eager`, `Default` or Zone.js, because an eager component re-checks its whole subtree on every event.
- Sources:
  - ng-onpush :9: "OnPush is the default change detection strategy in Angular (since v22)."
  - ng-onpush :20: "With the `Eager` strategy, the framework executes change detection on the entire component tree."
  - ng-zl :7: ZoneJS triggers synchronization "more frequently than necessary."
  - ng-bp :13.
  - angular-eslint prefer-on-push-component-change-detection: "the v22 migration adds an explicit `ChangeDetectionStrategy.Eager` to existing components."
  - jf-angular MUST: "Use OnPush change detection strategy."
- Why: on v22, `ng update` writes `Eager` onto old components, so "never opt out" is the check that still matters.
- Good/Bad: none.

**NGB3 · KEEP**
- Text: unchanged.
- Sources:
  - ng-effect :19: "If you find yourself copying data from one signal to another with an effect, it's a sign you should … use `computed()` or `linkedSignal()`."
  - ng-effect :29: "Avoid using effects for propagation of state changes."
  - react :63: "When something can be calculated from the existing props or state, don't put it in state … you avoid bugs caused by different state variables getting out of sync."
  - ps-reader :14: "Derive instead of sync."
- Why: consistent with D6.
- Good/Bad: the pair still fits. Consider naming `linkedSignal()` as the permitted alternative for state that is both derived and set by hand (ng-bp :31).

**NGC1 · REWORD**
- Proposed: **NGC1** — Inject with `inject()` in a field initialiser, never through constructor parameters, because constructor injection does not work in functional guards, interceptors or field initialisers, so the code ends up with two DI styles.
- Sources:
  - ng-sg :113-117: "Prefer using the `inject` function over injecting constructor parameters … more readable … better type inference."
  - angular-eslint prefer-inject: "enables dependency injection outside of constructors … required for using many modern Angular features like functional guards, interceptors."
- Why: two sources agree. The rule is mostly maintainability and style. The reason now names a concrete cost, mixed DI styles, but the operator may class it as house style.
- Good/Bad: none.

**NGC3 · REWORD**
- Proposed: **NGC3** — Bind a subscription that outlives one HTTP call with `takeUntilDestroyed()`, or render it with the `async` pipe, because an unbound subscription keeps a destroyed component and its handlers alive.
- Sources:
  - ng-tud :5: "automatically unsubscribe … when a component or directive is destroyed. This prevents common memory leaks."
  - jf-angular MUST NOT: "Forget to unsubscribe from observables (use `takeUntilDestroyed` or `async` pipe)."
  - addy-perf: "Memory leaks | Growing memory, eventual crash | Clean up listeners, intervals."
- Why:
  - The `async` pipe is a sourced permitted alternative.
  - "until the page crashes" overstates the failure.
  - The check should add one finding: a `takeUntilDestroyed()` call outside an injection context with no `DestroyRef` (ng-tud :29; angular-eslint no-implicit-take-until-destroyed).
- Good/Bad: none.

**NGD1 · KEEP (reason tightened)**
- Proposed: **NGD1** — Use `@if`, `@for` with `track`, `@switch`, `[class.x]` and `[style.x]`, never `*ngIf`, `*ngFor`, `ngClass`, `ngStyle` or `CommonModule`, because the directives add runtime cost and `@for` without a stable `track` rebuilds DOM.
- Sources:
  - ng-bp :35-37, :50.
  - ng-sg :243: "`NgClass` and `NgStyle` directives incur an additional performance cost."
  - ng-cf :55, :63 on `track`.
  - angular-eslint prefer-control-flow: "more readable, performant, and type-safe."
  - angular-eslint prefer-class-binding: "better performance than ngClass."
- Why: angular-eslint notes that `ngClass` is still needed for space-separated keys in one entry. That could be a Decided edge.
- Good/Bad: none.

**NGD2 · KEEP**
- Text: unchanged.
- Sources:
  - addy-a11y :66: "NEVER use div/span as buttons."
  - addy-fe :185: "`<div onClick>` ✗ Not focusable."
  - mdn-btn :31: "If using `role="button"` instead of the semantic `<button>` … you will need to make the element focusable and define event handlers."
  - using-aria :198: First rule of ARIA, use the native element.
  - wcag-kbd :19: "Many people rely on the keyboard interface."
  - angular-eslint interactive-supports-focus: "Elements that trigger actions must be focusable."
  - angular-eslint button-has-type: "Buttons default to `type="submit"` … triggers a form submission." This backs the `type="button"` part.
- Good/Bad: none.

**NGD3 · REWORD (reason was factually wrong)**
- Proposed: **NGD3** — Give an icon-only button an `aria-label` or visually hidden text, not only a `title`, because `title` is a last-resort name that assistive technology exposes inconsistently and keyboard and touch users never see.
- Sources:
  - apg-names :132: "`title` and `placeholder` attributes are used as last resort sources of content for accessible names."
  - apg-names :434-435: title "is not particularly discoverable, and is also not accessible to visual users without a pointing device."
  - mdn-title :103-111: "highly problematic for … touch-only devices … keyboards … screen readers … due to inconsistent browser support."
  - angular-eslint elements-content: "'<button><mat-icon>delete</mat-icon></button>' is not accessible because screen readers will just announce 'button'."
  - addy-a11y :28: "Icon-only buttons have `aria-label`."
- Why: the current reason, "has no name to read", is false when a `title` is present, because accessible-name computation uses `title` as a fallback.
- Good/Bad: none.

### New rules the sources share that `angular-ui.md` lacks

- **NGB4** — Declare inputs, outputs and two-way bindings with `input()`, `output()` and `model()`, queries with `viewChild()`, and host bindings in `host: {}`, never the `@Input`/`@Output`/`@ViewChild`/`@HostBinding`/`@HostListener` decorators, because decorator inputs are not signals that `computed()` can read.
  - ng-bp :16, :28-29.
  - angular-eslint prefer-signals: "Signal-based APIs like input(), viewChild() … integrate seamlessly with computed."
  - angular-eslint prefer-output-emitter-ref and prefer-signal-model.
  - Ledger row NGB4 (19:329) exists and is APPROVED but is missing from the file. Its reason is new.
- No other candidate is both new and well sourced. Template a11y linting is a gate (NGF1), and `track` by id is already inside NGD1.

---

### 4. Summary

| file | KEEP | REWORD | DROP | NEW |
|---|---|---|---|---|
| concurrency.md | 4 (CC2, CC3, CC4, CC8) | 6 (CC1, CC5, CC6, CC7, CC9, CC10) | 0 | 1 (CC11 circuit breaker) |
| angular-ui.md | 6 (NGA3, NGA5, NGA7, NGB3, NGD1, NGD2) | 8 (NGA1, NGA2, NGA6, NGB1, NGB2, NGC1, NGC3, NGD3) | 0 | 1 (NGB4 signal APIs) |

**Clauses dropped inside REWORDs** (fewer than two independent sources):
- CC1: class-initialiser pinning and `synchronized` on 25. JEP 491 was unreadable, so this becomes a Decided edge pending a read.
- CC5: "a lock has one owner".
- CC9: "record intent before the call" (addy only).
- CC10: "one pool per database per process" (addy only).
- NGA2: "never suppress `no-explicit-any`" (contradicts Google TS; operator's X6).
- NGA6: the fixed narrowing order and "a guard that lies" (pstack only).

**Wrong reasons fixed:** CC7 (ScopedValue does not reach an executor thread either), NGD3 (`title` is a fallback name), and NGB1 (the old reason described agent behaviour). CC6 is narrowed because it conflicted with CC1.

**Operator decisions touched:**
- D10 consistent (NGB2).
- D6 consistent for NGB3 and CC4. It conflicts in part with CC1, because the "avoid" clause moves out of the rule.
- D7 unaffected.
- X6 (19:377) is contradicted by Google's TS style guide (NGA2).

