# Changelog

All notable changes to this project are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning: SemVer.

## [0.2.0] - 2026-09-12

Real-time listening becomes the product's hero capability (workspace decision D-20): VoiceBridge
now ingests a live conversation and streams back an evolving, grounded, cited brief.

### Added
- **White-label branding**: `BRAND_PRODUCT_NAME`, `BRAND_TAGLINE`, `BRAND_LOGO_URL`,
  `BRAND_PRIMARY_COLOR`, `BRAND_ACCENT_COLOR`, `BRAND_POWERED_BY`, `BRAND_FOOTER_TEXT`,
  `BRAND_DOCS_URL` and `BRAND_SUPPORT_URL` rebrand a deployment without a fork; `GET
  /api/v1/branding` is public and both UIs apply it at boot; the registry gains an optional
  per-prospect `brand` block that layers on top; partner logos are served from
  `DATA_DIR/branding/`. See `docs/developer/white-label.md` and `docs/developer/build-your-own.md`.
- **Listening sessions** (`src/services/listen.ts`): rolling transcript (final and interim chunks),
  server-side throttling and de-duplication of brief refreshes, one evolving brief per session,
  citations accumulated across the call, and per-session latency statistics. Sessions are persisted
  in `DATA_DIR/listen-sessions.json` (capped at 200).
- **Listening API**: `POST /api/v1/listen/sessions`, `POST /api/v1/listen/sessions/{id}/transcript`
  (chunks from any transcription source — realtime STT, a telephony webhook, a meeting bot, typed
  text), `GET /api/v1/listen/sessions/{id}`, `GET /api/v1/listen/sessions/{id}/events` (SSE:
  `brief`, `transcript`, `status`), `DELETE /api/v1/listen/sessions/{id}`,
  `GET /api/v1/listen/sessions`, and `GET /api/v1/admin/listen-sessions` (brief history + latency).
- Demo console opens on **Listen**: a scripted sample conversation, a paste-or-type box, the
  evolving brief with citations, the transcript and live session statistics. Microphone capture
  (ElevenLabs Scribe) now feeds the same session API.
- Admin panel gains a **Listen sessions** tab.

### Fixed
- A Knowledge Box that rejects a per-request `generative_model` (403/530) no longer loses the
  brief: the refresh retries once on the Knowledge Box default and remembers the rejection.

### Changed
- `POST /api/v1/brief` is now documented as the stateless primitive behind sessions; it is
  unchanged for callers that want to own the loop.
- Per-route rate limits come from the platform (`rateLimit: { rps, burst }`); the product-local
  limiter is gone. Listening sessions share the brief budget.
- The console's tab order leads with Listen; Ask, Call and Golden set follow.

## [0.1.0] - 2026-09-12

First open-source MVP. The prototype's ask-bridge is rebuilt on the shared ARAG platform as an
API-first product with an admin panel, a demo console, documentation and an enablement track.

### Added
- **Versioned API** `/api/v1` described by `src/openapi.ts` (OpenAPI 3.1), served at
  `/api/v1/openapi.json` with Redoc (`/api/v1/docs`) and Swagger UI (`/api/v1/swagger`); every
  route is validated against the spec and covered by contract tests.
- `POST /api/v1/voice-answer` (nine-step turn pipeline), `POST /api/v1/brief` (structured live
  brief), `GET /api/v1/prospects[/{key}]`, `GET /api/v1/models`, `GET /api/v1/voices`,
  `POST /api/v1/scribe-token`, `POST /api/v1/avatar/sessions`, `GET /api/v1/metrics`,
  `POST /api/v1/golden-evals` + `GET /api/v1/golden-evals/{id}`, `GET /api/v1/jobs…` (+ SSE),
  `POST /api/v1/session`.
- **Admin API** `/api/v1/admin/*`: per-prospect Knowledge Box health, configuration, usage, logs,
  prospect registry CRUD, stored-search-configuration provisioning, turn log, golden-eval history.
- **Prospect registry** persisted in `DATA_DIR/prospects.json` with validation and admin CRUD;
  the repo ships `config/prospects.example.json`, which seeds the store on first boot.
- **Demo console** (`/`): text turn tester (works with no ElevenLabs credentials), Call mode via a
  vendored `@elevenlabs/client`, Listen mode (Scribe → evolving brief), prospect selector, golden-set
  runner and a live metrics footer.
- **Admin panel** (`/admin/`): sign-in, health, prospects CRUD + provision, turn log, golden-eval
  history with pass/fail detail, configuration and logs.
- Golden-set evaluation runs in-process as a job, with persisted history.
- Tests: unit, service, integration against the mock ARAG, contract and Playwright e2e; ≥ 80 % line
  coverage gate; `make smoke` for an opt-in live check.
- Docker image, `fly.toml` with a `data` volume, GitHub Actions CI.

### Changed
- ARAG access moved to the platform `AragClient` behind an `AragClientPool` (one client per
  Knowledge Box + zone), replacing the bespoke NDJSON client.
- HTTP layer moved to the platform `App`: request ids, security headers, CORS allowlist, token-bucket
  rate limiting, RFC 9457 problem responses, OpenAPI-driven validation.
- The registry moved from a committed JSON file to `DATA_DIR` with admin CRUD; `POST /admin/reload`
  is gone.
- TypeScript is erasable-syntax only so Node 22.18+ runs the sources directly; no build step.

### Security
- `/api/v1/admin/*` requires `ADMIN_TOKEN` (constant-time compare); `POST /api/v1/scribe-token`
  requires a session or API key and has its own rate limit; `/api/v1/brief` is rate-limited more
  strictly than the rest of the API.
- The ElevenLabs browser client is vendored and pinned instead of imported from a CDN at runtime.
- The turn log never stores the text of an input that tripped a safety guard.
- Conversation history and Listen-mode transcripts are screened for injection with the same
  patterns as the question; poisoned turns are dropped rather than forwarded as model context.
- `config/prospects.example.json` ships placeholders only; the deployment's own `ARAG_KB_ID` and
  `VOICE_DEFAULT_AGENT_ID` are substituted into the first prospect at first boot.
