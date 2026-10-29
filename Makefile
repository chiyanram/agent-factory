.PHONY: help lint test

help: ## list the targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  make %-6s %s\n", $$1, $$2}'

lint: ## check relative links in every tracked .md file and the root AGENTS.md size
	@scripts/check-links.sh .
	@scripts/check-size.sh .

test: ## run every tests/*.test.sh; fail if any one fails
	@status=0; for t in tests/*.test.sh; do echo "== $$t"; bash "$$t" || status=1; done; exit $$status
