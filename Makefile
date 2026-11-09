.PHONY: help lint test build

help: ## list the targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  make %-6s %s\n", $$1, $$2}'

node_modules/.package-lock.json: package.json package-lock.json
	@npm ci --no-audit --no-fund --ignore-scripts

lint: node_modules/.package-lock.json ## check links, the AGENTS.md size, tmpdir called outside test/temp.ts, the golden set, the eval proof of a reviewer-input change, the coordinator's wall, the AGENTS.md MUSTs code can check, the glossary's words in the main docs, type-check, the Biome format, and the oxlint rules
	@node scripts/check-links.ts .
	@node scripts/check-size.ts .
	@node scripts/check-temp-dirs.ts .
	@node scripts/check-evals.ts .
	@node scripts/check-eval-proof.ts .
	@node scripts/check-coordinator.ts
	@node scripts/check-musts.ts .
	@node scripts/check-words.ts .
	@npm run --silent lint
	@npx --no-install biome ci .
	@node scripts/lint-ratchet.ts

test: node_modules/.package-lock.json ## build, then run the vitest suite
	@npm run --silent build
	@npm test --silent

build: node_modules/.package-lock.json ## compile the TypeScript package to dist/
	@npm run --silent build
