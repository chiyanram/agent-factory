.PHONY: help lint test build garden garden-pr

help: ## list the targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  make %-9s %s\n", $$1, $$2}'

node_modules/.package-lock.json: package.json package-lock.json
	@npm ci --no-audit --no-fund --ignore-scripts

lint: node_modules/.package-lock.json ## check links, the AGENTS.md size, tmpdir called outside test/temp.ts, the golden set, the eval proof of a reviewer-input change, the coordinator's wall, the sessions' plugins at the engine's rules-pack tag, the AGENTS.md MUSTs code can check, the glossary's words in the main docs, no new history note in a comment or doc line, a changed decision as a new ADR, a ticket on each safety Today: note, type-check, the Biome format, and the oxlint rules
	@node scripts/check-links.ts .
	@node scripts/check-size.ts .
	@node scripts/check-temp-dirs.ts .
	@node scripts/check-evals.ts .
	@node scripts/check-eval-proof.ts .
	@node scripts/check-coordinator.ts
	@node scripts/check-plugin-pin.ts .
	@node scripts/check-musts.ts .
	@node scripts/check-words.ts .
	@node scripts/check-history.ts .
	@node scripts/check-adrs.ts .
	@node scripts/check-today.ts .
	@npm run --silent lint
	@npx --no-install biome ci .
	@node scripts/lint-ratchet.ts

test: node_modules/.package-lock.json ## build, then run the vitest suite
	@npm run --silent build
	@npm test --silent

build: node_modules/.package-lock.json ## compile the TypeScript package to dist/
	@npm run --silent build

# gardener reads this repository's own git history, as check-links does, never a project's clone. No --transcripts
# (it reads the agent logs on this machine) and no --github: a person adds those by hand.
garden: node_modules/.package-lock.json ## print the code's health: gardener snapshot, hotspots of the last 60 days, and the last 7 days' outcomes
	@npx --no-install gardener snapshot
	@npx --no-install gardener hotspots --days 60 --limit 10
	@npx --no-install gardener window --days 7

BASE ?= origin/main
HEAD ?= HEAD
garden-pr: node_modules/.package-lock.json ## print the module numbers a change moves, merge base against head, and which got worse (BASE=origin/main HEAD=HEAD)
	@node scripts/garden-pr.ts --base $(BASE) --head $(HEAD)
