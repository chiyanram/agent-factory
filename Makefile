.PHONY: help lint test build

help: ## list the targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  make %-6s %s\n", $$1, $$2}'

node_modules/.package-lock.json: package.json package-lock.json
	@npm ci --no-audit --no-fund --ignore-scripts

lint: node_modules/.package-lock.json ## check links, the AGENTS.md size, and type-check the TypeScript package
	@scripts/check-links.sh .
	@scripts/check-size.sh .
	@npm run --silent lint

test: node_modules/.package-lock.json ## run every tests/*.test.sh and the vitest suite; fail if any one fails
	@status=0; for t in tests/*.test.sh; do echo "== $$t"; bash "$$t" || status=1; done; \
	echo "== vitest"; npm test --silent || status=1; exit $$status

build: node_modules/.package-lock.json ## compile the TypeScript package to dist/
	@npm run --silent build
