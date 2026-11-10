# t1 — examples audit: smoke specs (chiyanram/agent-factory#31)

Scope: `plugins/rulebook/skills/testing/references/examples/smoke-specs.md` (15 pairs) and the 6 pairs in
`smoke-specs.md` (EA1–EA6). The 6 are byte-identical code to the examples file; only caption line-wrap differs
(and EA5 caption uses `:` in one file, `—` in the other). Audited once.

Rule set applied: EA1–EA6, EB2–EB4, EC1–EC5, ED3 · GT1, GT2, GT4, GT5 · S1, TM2, AT1 · V1–V5 · B1–B3 (none apply).
Playwright guidance: playwright.dev/docs/best-practices — "Only test what you control"; "Prefer user-facing attributes
to XPath or CSS selectors"; "Each test should be completely isolated from another test".

## Counts

| | total | clean | Act | Consider |
|---|---|---|---|---|
| Good | 15 | 10 | 1 (EA1) | 4 (EA4, EC1, EA3, EB4) — EA1 also has a Consider |
| Bad breaks its own rule | 15 | 15 | 0 | — |
| Bad also breaks an unrelated rule, confusingly | 15 | 11 | 0 | 4 (EA2, EC2, EC3, ED3) |

No Good uses `waitForTimeout`, `networkidle`, `.first()`, CSS/XPath, `expect(await locator…)`, or form login.
All UI Goods take auth from a fixture (`clerkPage` / `clerkToken`).

## Findings

| pair · side | rule / guidance broken | offending line(s) | bucket | smallest fix |
|---|---|---|---|---|
| EA1 · Good | EC1 — contradicts EC1's own pair: Good relies on a hand-rolled interval-poll helper, the exact shape EC1 Bad condemns | `await pollInvoice(... { maxWaitMs: 30_000, intervalMs: 1_000 })` | Act | `await expect.poll(() => invoiceStatus(...), { timeout, message }).toBe('PAID')`; lesson (poll ≠ assertion) still holds |
| EA1 · Good | EC5 — poll budget 30 s equals Playwright's default test timeout (30 s), not below it; no `setTimeout` shown | `maxWaitMs: 30_000` | Consider (depends on unseen config timeout) | drop budget to 20 s, or show a raised timeout with reason |
| EA4 · Good | EC1 — same helper-poll pattern as EA1 | `pollForPayment(request, invoice.id, clerkToken, 'card-gateway', { maxWaitMs: 15_000,` | Consider | same `expect.poll` rewrite, or a note that the helper wraps `expect.poll` |
| EC1 · Good | EC5 — 60 s poll above default 30 s test timeout; no raised timeout shown, so poll dies without its message | `{ timeout: 60_000, intervals: [1_000] }` | Consider | budget 25 s (job runs every 10 s), or add `test.setTimeout(90_000) // reason` |
| EA3 · Good | S1 / AT1 — API-only test carrying an AC annotation in a smoke spec; AT1 says API AC → IT | `apiRequest(request, 'DELETE', ...)` + `description: '#123 AC-2'` | Consider | drive the delete through the UI, or drop the AC annotation / move framing to an IT |
| EB4 · Good | S1 / AT1 — same: API-only AC test in a smoke spec | `apiRequest(request, 'POST', '/api/payment-gateway/test-connection'` + `'#123 AC-4'` | Consider | same as EA3 |
| EA2 · Bad | also EC1 (`networkidle`), EC3 (`.first()`), EC5 (unreasoned timeouts) | `page.goto('/invoices', { waitUntil: 'networkidle' })`; `.locator('.toggle-wrap').first()` | Consider | drop `networkidle` and timeouts; keep `.first()` only if caption mentions it |
| EC2 · Bad | also EC1 (`networkidle`) | `page.goto(\`/orders/${placedOrder.id}\`, { waitUntil: 'networkidle' })` | Consider | remove `waitUntil: 'networkidle'` |
| EC3 · Bad | also EA2 — CSS-class locators dominate; reader may read the lesson as "use roles" | `page.locator('.row-menu .row-menu-item').first()` | Consider | caption names both, or swap CSS for role locators with `.first()` |
| ED3 · Bad | also EC3 (`.first()`) and EA2 (CSS selector) | `page.locator('textarea, input[type="text"]').first()` | Consider | use a role locator without `.first()` so only the never-clicked route remains |

Checked and clean (Goods): EA2, EA5, EA6, EB2, EB3 (teardown `.catch` is a Decided edge), EC2, EC3, EC4, EC5, ED3.
GT1 not checkable (no scenario titles given); GT2/GT4 met where steps/annotations appear. TM2: `fakeGateway` fakes
a third party — allowed.
