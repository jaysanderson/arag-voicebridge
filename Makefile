# VoiceBridge — task runner. bun installs dev tooling only; npm is never used.
BUN ?= bun
NODE ?= node
PORT ?= 8080

.PHONY: help install dev start test coverage e2e lint typecheck check docs showcase smoke agent-check eval provision docker fly-validate mock

help:
	@echo "make install       bun install (dev tooling, exact pins)"
	@echo "make dev           run with --watch on :$(PORT) (ARAG_MOCK=1 unless .env has credentials)"
	@echo "make start         run in production mode"
	@echo "make test          unit + integration + contract tests (node:test, mock ARAG)"
	@echo "make coverage      tests with the 80% line gate on src/"
	@echo "make e2e           Playwright (console + admin) against a mock-backed server"
	@echo "make lint          biome check"
	@echo "make typecheck     tsc --noEmit"
	@echo "make check         lint + typecheck + coverage"
	@echo "make docs          regenerate docs/developer/api-reference.md from the running server"
	@echo "make showcase      record the showcase walkthrough (video + screenshots) into showcase/out"
	@echo "make smoke         OPT-IN live test: 3 golden questions against the real KB using .env"
	@echo "make agent-check   OPT-IN live test: create, configure and delete a throwaway ElevenLabs agent"
	@echo "make eval P=<key>  run a prospect's golden set against a running server"
	@echo "make provision P=<key> [ARGS=--dry-run]  write the stored ARAG search configuration"
	@echo "make docker        build the container image"
	@echo "make fly-validate  validate fly.toml"
	@echo "make mock          run the mock ARAG server standalone on :8790"

install:
	$(BUN) install --frozen-lockfile || $(BUN) install

dev:
	@test -f .env || cp .env.example .env
	@grep -q "^ARAG_API_KEY=.\+" .env 2>/dev/null && $(NODE) --watch src/index.ts || ARAG_MOCK=1 $(NODE) --watch src/index.ts

start:
	$(NODE) src/index.ts

test:
	$(NODE) --test --test-reporter=spec 'test/*.test.ts'

coverage:
	$(NODE) --test --experimental-test-coverage --test-coverage-include='src/**' --test-coverage-lines=80 'test/*.test.ts'

e2e:
	PW_DISABLE_TS_ESM=1 $(BUN)x playwright test

lint:
	$(BUN)x biome check .

typecheck:
	$(BUN)x tsc --noEmit -p tsconfig.json

check: lint typecheck coverage

docs:
	$(NODE) vendor/arag-platform/scripts/openapi-to-md.ts http://localhost:$(PORT)/api/v1/openapi.json docs/developer/api-reference.md

showcase:
	SHOWCASE=1 PW_DISABLE_TS_ESM=1 $(BUN)x playwright test showcase/record.spec.ts --config playwright.config.ts

smoke:
	$(NODE) scripts/smoke.ts $(ARGS)

# Creates a throwaway ElevenLabs agent + tool, configures them, then deletes both.
# It never touches an agent this deployment's registry points at.
agent-check:
	$(NODE) scripts/agent-check.ts

eval:
	@test -n "$(P)" || (echo "Usage: make eval P=<prospect> [BASE_URL=http://localhost:8080]"; exit 1)
	$(NODE) scripts/eval.ts $(P)

provision:
	@test -n "$(P)" || (echo "Usage: make provision P=<prospect> [ARGS=--dry-run]"; exit 1)
	$(NODE) scripts/provision.ts $(P) $(ARGS)

docker:
	docker build -t arag-voice-bridge:local .

fly-validate:
	fly config validate -c fly.toml

mock:
	$(NODE) vendor/arag-platform/src/arag/mock/cli.ts
