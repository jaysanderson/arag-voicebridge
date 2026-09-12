# AUDIT — VoiceBridge (`arag-voice`)

Audited 2026-09-12. Repo HEAD `49d0290` is byte-identical to the deployed Fly machine (`arag-voice-bridge`, image from 2026-06-24, currently suspended/auto-start).

## Stack

| Item | Value |
|---|---|
| Runtime | Node ≥ 22.6, TypeScript via `--experimental-transform-types`, **zero dependencies** |
| Voice | ElevenLabs Conversational AI agent (custom server tool → bridge), `@elevenlabs/client` loaded from esm.sh in the browser, Scribe v2 realtime STT (single-use tokens minted by the bridge), optional HeyGen LiveAvatar + LiveKit (JWT minted with `node:crypto`) |
| Frontend | Static `bridge/public/` (Call mode + Listen mode), served by the bridge |
| Tests | `node --test`, 7 files, 43 tests (voice shaping, citations, handoff, safety, NDJSON parsing, pipeline with injected ARAG stub, LiveKit JWT) |
| Deploy | `bridge/Dockerfile` (`node:22-slim`), `bridge/fly.toml`, `iad`, 512 MB |
| Config | `ARAG_TOKEN`, `ARAG_REGION_DEFAULT`, `ARAG_TIMEOUT_MS`, `AGENT_TOOL_TIMEOUT_MS`, `MAX_HISTORY_TURNS`, `ALLOWED_ORIGINS`, `ELEVENLABS_API_KEY`, LiveAvatar/LiveKit vars; per-prospect registry `bridge/config/prospects.json` |

## ARAG features used (verified)

- `POST https://{region}.rag.progress.cloud/api/v1/kb/{kb}/ask` (NDJSON) with `context` (conversation history), `features:[semantic,keyword]`, `citations:true`, inline `prompt:{system,user}`, `reranker`, `max_tokens`, `temperature:0`, `generative_model`, or a stored `search_configuration`.
- `answer_json_schema` for the structured live brief (Listen mode), `chat_history`-style context for query rephrasing.
- `POST /search_configurations/{name}` (`kind:"ask"`, `filter_expression`, `security.groups`, prompt) via `scripts/create-search-config.ts`.
- `GET /kb/{kb}/configuration` and `GET /kb/{kb}/schema` to list generative models (tolerant parsing, marked "live-verify").
- NDJSON item shapes (`answer`, `retrieval.results.resources`, `citations`, `status`, `metadata`) were verified live and match the official docs.

## Architecture

`server.ts` (stdlib HTTP, CORS, static) → `pipeline.ts` (nine ordered steps: input guard → build ARAG request → stream → handoff decision → voice shaping → citations → output guard → metrics) with the ARAG caller injected for tests. `registry.ts` loads/validates prospects; `metrics.ts` keeps a 500-turn ring buffer; `brief.ts` runs the structured evolving brief. The browser talks only to the bridge (plus ElevenLabs WebRTC/WebSocket directly, using bridge-minted tokens).

## What works

- Cleanest of the three: explicit contracts (`VoiceAnswerRequest/Response`), deterministic handoff sentinel as a prompt↔bridge contract, defence-in-depth voice shaping, graceful degradation (never dead air), per-turn metrics, golden-set gate, CORS allowlist, body size cap, non-secret registry projection.
- 43 tests all pass under Node 22 (35 pass on Node 26 with strip-types; 2 files fail only because of parameter-property syntax).
- Live bridge healthy; golden set for `progress` reported 10/10; p50 ≈ 3.3 s, p95 ≈ 5.6 s over 17 turns.
- Excellent docs (SPEC with ADRs, onboarding ritual, ElevenLabs/LiveAvatar setup).

## What is broken or weak

1. Same **Node flag rot** as Document Processing (`--experimental-transform-types` removed; parameter properties in `AragError`, `ProspectNotFoundError`, `LiveAvatarError`, `ScribeError`).
2. **Registry is a repo file**: adding a prospect means a redeploy (or `POST /admin/reload`, which is **unauthenticated**, as is `/metrics`, `/v1/models`, `/v1/scribe-token` — the last one mints ElevenLabs tokens for anyone). `prospects.json` in git contains real KB ids and a real ElevenLabs agent id.
3. **Unversioned mix of paths** (`/v1/*`, `/metrics`, `/admin/*`, `/healthz`), no OpenAPI, no request schema validation beyond two `typeof` checks.
4. **No rate limiting** on an endpoint that spends LLM tokens per call; `/v1/brief` is even more expensive (fires every 1.5 s while listening).
5. `README` claims "Fastify" in `index.ts` comments; `ALLOWED_ORIGINS` default only lists `:5173` though the UI is served from the bridge origin (works only because same-origin requests carry no `Origin` header on GET).
6. Golden eval and provisioning are CLI-only; there is no way to run them from the UI or record results.
7. `fetchModels` parsing of `/schema` is speculative; `security.groups` filter is a convenience not an auth boundary (correctly caveated in SPEC).
8. Browser loads `@elevenlabs/client` from esm.sh at runtime (supply-chain + offline risk); ElevenLabs widget snippet in docs references unpkg.
9. No `LICENSE`, `CONTRIBUTING`, `SECURITY`, CI, changelog; `docs/` is spec-shaped rather than the required developer / architect / business structure.

## Security review

| Area | Finding | Action |
|---|---|---|
| Secrets | Server-only, good; registry leaks nothing sensitive to browser | Keep |
| Admin | `/admin/reload` open | Admin token |
| Token minting | `/v1/scribe-token` open → anyone can burn ElevenLabs quota | Require session/API key + rate limit |
| Input validation | Partial | OpenAPI-driven validation (history shape, lengths, prospect key pattern) |
| Prompt injection | Regex guards (documented as demo-grade) | Keep as first line; document extension point for a classifier |
| Rate limiting | None | Platform token bucket, stricter on `/brief` |
| Supply chain | Zero deps; runtime CDN import | Vendor the ElevenLabs client or pin + SRI |

## Keep vs rewrite

| Keep | Rewrite |
|---|---|
| Pipeline (all nine steps), handoff contract, voice shaping, safety guards, citations, metrics, brief schema, LiveKit/LiveAvatar/Scribe adapters, golden eval logic | HTTP layer → `/api/v1` from OpenAPI (keep `/v1/voice-answer` as a documented compatibility alias for existing ElevenLabs tools) |
| Registry validation rules | Registry storage → `DATA_DIR` JSON with admin CRUD API; repo ships an example registry only |
| Tests (port to erasable TS, keep coverage) | Add HTTP/contract tests, mock ARAG, Playwright e2e for console + admin |
| SPEC/ADR content → architecture docs | Auth, rate limiting, request ids, problem+json errors via platform |
