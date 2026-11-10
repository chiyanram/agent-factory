# t2 smells.md vs Fowler catalog (agent-factory#32 D11)

Sources: refactoring.com/catalog (66 refactorings, no smell list), martinfowler.com/bliki/CodeSmell.html (no 2e list),
refactoring.guru/refactoring/smells (1e-style names, no 2e). 2e smell names confirmed from my knowledge of the book, NOT fetchable from the public pages.

All 24 Fowler names exact. No wrong names.

| row | verdict | note / corrected text |
|---|---|---|
| Mysterious Name | OK | Rename = Change Function Declaration / Rename Variable / Rename Field |
| Duplicated Code | OK | Extract Function, Slide Statements, Pull Up Method; "only if a rule (DS14)" is repo overlay |
| Feature Envy | OK | Move Function |
| Data Clumps | OK | Extract Class / Introduce Parameter Object / Preserve Whole Object |
| Primitive Obsession | OK | Replace Primitive with Object |
| Repeated Switches | OK | catalog: Replace Conditional with Polymorphism; sealed type is Java adaptation |
| Shotgun Surgery | OK | Move Function/Field, Combine Functions into Class |
| Divergent Change | OK | Split Phase, Extract Class |
| Speculative Generality | OK | Collapse Hierarchy, Inline Function/Class, Remove Dead Code |
| Message Chains | OK | Hide Delegate |
| Middle Man | OK | Remove Middle Man, Inline Function |
| Refused Bequest | OK | Push Down Method/Field, Replace Subclass/Superclass with Delegate |
| Long Function | OK | Extract Function |
| Long Parameter List | OK | Replace Parameter with Query, Preserve Whole Object, Introduce Parameter Object |
| Global Data | OK | Encapsulate Variable ("one owner controlling writes" fits) |
| Mutable Data | OK (narrow) | Covers any data, not only fields. Add: "Encapsulate Variable / Remove Setting Method; final field" |
| Loops | OK | Replace Loop with Pipeline |
| Lazy Element | OK | Inline Function / Inline Class / Collapse Hierarchy |
| Temporary Field | wrong refactoring (partial) | catalog: Extract Class, Move Function, Introduce Special Case. Add "Introduce Special Case" ; sealed variant is our Java idiom |
| Insider Trading | wrong refactoring | Cure absent. Corrected: "Move Function/Field to cut the trade; Hide Delegate; layering rules (project)" |
| Large Class | wrong description | Fowler: too many fields/responsibilities, not line count. Corrected: "class doing too much: Extract Class (1000-line limit is DS2 heuristic)" |
| Alternative Classes w/ Different Interfaces | OK | Change Function Declaration, Move Function, Extract Superclass |
| Data Class | OK | Move Function, Encapsulate Record, Remove Setting Method |
| Comments | OK | Extract Function, Change Function Declaration, Introduce Assertion |
| Conditional Complexity (K) | not checkable here | Kerievsky name exact; cure Decompose Conditional / Replace Conditional with Polymorphism |
| Oddball Solution (K) | not checkable here | name exact |
| Indecent Exposure (K) | not checkable here | name exact; Kerievsky cure: Encapsulate Classes with Factory |
| Dead Code | OK | catalog: Remove Dead Code; guru lists Dead Code |
