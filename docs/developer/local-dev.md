# Local development

## Layout

```
src/
  config.ts        product env (VOICE_* vars) on top of the platform's shared env
  index.ts         entrypoint: load env, build the app, listen, shut down cleanly
  server.ts        createProduct(): wires stores, clients, jobs and every route module
  openapi.ts       the OpenAPI 3.1 document — source of truth, written before routes
  types.ts         the public request/response contract + registry shapes
  routes/          one module per resource (voice, prospects, realtime, quality, jobs, admin)
  services/        domain logic, no HTTP types — pipeline, handoff, voiceShape, safety, citations,
                    brief, registry, clientPool, goldenEval, provision, metrics, seed, models,
                    voices, scribe, liveavatar, livekit, ratelimit, voicePrompt
public/            demo console (static, framework-free) — consumes only /api/v1
admin/             admin panel (static) — consumes only /api/v1 (+ /api/v1/admin)
vendor/arag-platform/  vendored platform (App, AragClient, Store, JobManager, …) — never edited here
test/              unit, integration (mock ARAG), contract, e2e (Playwright)
scripts/           eval.ts, provision.ts, smoke.ts — thin clients over the running server's API
config/            prospects.example.json — seeds the registry store on first boot
data/              DATA_DIR default (gitignored) — prospects.json, turns.json, jobs.json, golden-evals.json
```

`src/` has **zero runtime dependencies**. TypeScript is erasable-syntax only (no enums, no
parameter properties, no namespaces), so Node 22.18+ runs `.ts` files directly with no build step
and no `tsc` in the loop. `bun` is used only for dev tooling (Biome, Playwright, `tsc --noEmit`) —
`npm`/`package-lock.json` are never used in this repo.

## Make targets

```
make install       bun install (dev tooling, exact pins)
make dev           run with --watch on :8080 (ARAG_MOCK=1 unless .env has ARAG_API_KEY)
make start         run in production mode (node src/index.ts, no --watch)
make test          unit + integration + contract tests (node:test, mock ARAG)
make coverage      the same tests with the 80% line-coverage gate on src/**
make e2e           Playwright (console + admin) against a mock-backed server
make lint          biome check
make typecheck     tsc --noEmit
make check         lint + typecheck + coverage — this is what CI runs
make docs          regenerate docs/developer/api-reference.md from a RUNNING server's openapi.json
make showcase      record the showcase walkthrough (video + screenshots) into showcase/out
make smoke         opt-in LIVE check: 3 golden questions against the real KB using .env
make eval P=<key>  run a prospect's golden set against a running server
make provision P=<key> [ARGS=--dry-run]   write the prospect's stored ARAG search configuration
make docker        build the container image
make fly-validate  validate fly.toml
make mock          run the mock ARAG server standalone on :8790
```

## The mock ARAG server

`ARAG_MOCK=1` (which `make dev` sets automatically when `.env` has no `ARAG_API_KEY`) boots
`startMockArag()` (platform-provided, `vendor/arag-platform/src/arag/mock/`) in-process, seeded from
`src/services/seed.ts` — eight short, original documents about additive manufacturing, written so
each paragraph is quotable aloud in two sentences and deliberately containing nothing about
geography, health or weather (so the shipped golden set's out-of-scope questions retrieve nothing
and hand off, rather than accidentally matching). Every prospect resolves to this same mock KB
while `ARAG_MOCK=1` is set — `AragClientPool.baseUrlFor()` short-circuits to the mock's URL
regardless of the prospect's configured `kb_id`/`region`. This is what makes the demo, the tests
and the golden evals runnable with no ARAG credentials at all, and it is also exactly why the
`progress` prospect's ten-question golden set is guaranteed to pass offline.

Run it standalone (e.g. to poke at it with `curl` while developing another client) with
`make mock`, which starts it on `:8790` outside of the main product process.

## Tests

```bash
make test       # node --test --test-reporter=spec 'test/*.test.ts'
make coverage   # + --experimental-test-coverage --test-coverage-lines=80 on src/**
make e2e        # Playwright, console + admin, PW_DISABLE_TS_ESM=1 so it runs the .ts sources directly
```

Test files (`test/*.test.ts`) cover: voice shaping, citation extraction, deterministic handoff,
safety guards, the full turn pipeline against an injected ARAG stub, the prospect registry
(validation, CRUD, seeding), the third-party integrations (Scribe/voices/LiveAvatar, `fetch`
injected so nothing touches the network), LiveKit JWT minting, and two whole-product suites:
`integration.test.ts` (every route, in-process, against the mock ARAG server) and
`contract.test.ts` (the OpenAPI document lints clean, every registered route appears in the spec,
and real responses validate against their declared schemas). `test/e2e/*.spec.ts` drives the actual
console and admin panel in a browser against a mock-backed server — golden-set run included.

`make check` is lint + typecheck + coverage and is what CI (`.github/workflows/ci.yml`) runs on
Node 22 and 24 for every push and PR.

## Running against a live Knowledge Box

Copy `.env.example` to `.env`, set `ARAG_KB_ID`, `ARAG_API_KEY` and `ARAG_REGION` (or
`ARAG_BASE_URL`), then:

```bash
make dev          # picks up the real credentials automatically (no ARAG_MOCK)
make smoke        # opt-in: 3 golden questions against the real KB, read-only, never prints secrets
make smoke ARGS="progress 5"   # a specific prospect + question count
```

`scripts/smoke.ts` runs the *same* `runTurn()` the live agent and the golden-eval job use — it is
not a separate code path — reading the registry straight from `DATA_DIR/prospects.json` if it
exists, falling back to `config/prospects.example.json` otherwise. It is intentionally excluded
from `make check`/CI: it costs real ARAG/LLM calls and needs real credentials, so it is opt-in only.

## Regenerating the API reference

```bash
make dev                 # in one terminal
make docs                # in another — needs the server actually running on :8080
```

`make docs` calls the platform's `scripts/openapi-to-md.ts` against the *running* server's
`/api/v1/openapi.json` and overwrites `docs/developer/api-reference.md`. That file is generated —
never hand-edit it; change `src/openapi.ts` and regenerate instead.
