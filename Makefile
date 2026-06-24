# ARAG Voice — task runner. npm is NOT used anywhere in this project; everything runs on
# bare Node (TypeScript executed natively) plus Python's stdlib http.server for the client.
# There are zero dependencies to install.
#
# Usage:
#   make test                 run the bridge test suite
#   make dev                  run the bridge with --watch (hot reload)
#   make start                run the bridge (production mode)
#   make ui                   the bridge serves the web UI itself — just run `make dev`
#                             and open http://localhost:8080 (or the deployed URL)
#   make eval P=tangerine     run a prospect's golden set against a running bridge
#   make provision P=tangerine ARGS="--reranker noop --model <m>"   provision ARAG config
#   make provision P=tangerine ARGS="--dry-run"                     preview without sending

NODE := node --experimental-transform-types
BRIDGE := bridge

.PHONY: help install test dev start eval provision

help:
	@grep -E '^#   make' Makefile | sed 's/^# //'

# Explicit no-op so muscle-memory `make install` doesn't fail or reach for npm.
install:
	@echo "Nothing to install — ask-bridge is dependency-free (Node stdlib + native TS)."
	@echo "Requires Node >= 22.6. Run 'make test' to verify."

test:
	cd $(BRIDGE) && $(NODE) --test test/*.test.ts

dev:
	cd $(BRIDGE) && $(NODE) --watch src/index.ts

start:
	cd $(BRIDGE) && $(NODE) src/index.ts

eval:
	@test -n "$(P)" || (echo "Usage: make eval P=<prospect>"; exit 1)
	$(NODE) scripts/golden-eval.ts $(P)

provision:
	@test -n "$(P)" || (echo "Usage: make provision P=<prospect> [ARGS=...]"; exit 1)
	$(NODE) scripts/create-search-config.ts $(P) $(ARGS)
