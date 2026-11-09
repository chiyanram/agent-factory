.PHONY: help lint test build

help: ## list the targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  make %-6s %s\n", $$1, $$2}'

node_modules/.package-lock.json: package.json package-lock.json
	@npm ci --no-audit --no-fund --ignore-scripts

lint: node_modules/.package-lock.json ## check links, the AGENTS.md size, tmpdir called outside test/temp.ts, the golden set, the eval proof of a reviewer-input change, the coordinator's wall, type-check, the Biome format, and the oxlint rules
	@node scripts/check-links.ts .
	@node scripts/check-size.ts .
	@node scripts/check-temp-dirs.ts .
	@node scripts/check-evals.ts .
	@node scripts/check-eval-proof.ts .
	@node scripts/check-coordinator.ts
	@npm run --silent lint
	@npx --no-install biome ci .
	@node scripts/lint-ratchet.ts

test: node_modules/.package-lock.json ## build, then run every tests/*.test.sh and the vitest suite; fail if any one fails
	@npm run --silent build
	@status=0; for t in tests/*.test.sh; do echo "== $$t"; bash "$$t" || status=1; done; \
	echo "== vitest"; npm test --silent || status=1; exit $$status

build: node_modules/.package-lock.json ## compile the TypeScript package to dist/
	@npm run --silent build
