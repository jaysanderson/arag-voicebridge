# VoiceBridge documentation

Grounded, cited and governed voice answers over Progress Agentic RAG (ARAG). The hero capability is
**real-time listening**: open a session for a prospect, feed it a live conversation from any
source, and read back an evolving, grounded brief while the call is still happening
(`DECISIONS.md` D-20). Self-serve voice deflection (`POST /api/v1/voice-answer`) is the follow-on.
Start with [`../README.md`](../README.md) for the ninety-second version; everything below goes
deeper.

## Developer

- [`developer/quickstart.md`](developer/quickstart.md) — zero-credential start (play the sample
  conversation and watch the brief evolve), then the two-command listening API, then live
  credentials, then voice-answer as the second act.
- [`developer/api-reference.md`](developer/api-reference.md) — every route, generated from
  `src/openapi.ts` (`make docs`); never hand-edited.
- [`developer/examples.md`](developer/examples.md) — copy-pasteable curl/JS for real-time
  listening (sessions, chunks, SSE, polling, the admin view) and for every other public and admin
  route — settings, API keys, retention/purge, the ElevenLabs agent diff/push — plus the canonical
  voice-answer prompt and the exact tool/prompt shape the push computes.
- [`developer/settings.md`](developer/settings.md) — the settings inventory: every group and
  field, its environment default, and what it affects, transcribed from `SETTINGS_FIELDS`.
- [`developer/integrations.md`](developer/integrations.md) — the listen-session and voice-answer
  APIs stay vendor-neutral; ElevenLabs (Scribe, Conversational AI, text-to-speech) is the default
  voice and transcription stack layered on top, configured from the product's own Settings screen
  with a manual-dashboard fallback, with exact env vars and what degrades when it's missing.
- [`developer/extension-points.md`](developer/extension-points.md) — where to slot in a different
  throttle policy, a different session store, per-session models, post-call summarisation hooks, a
  real moderation classifier, per-prospect credentials, another voice platform, custom golden
  checks, and the onboarding ritual for a new prospect end to end.
- [`developer/white-label.md`](developer/white-label.md) — rebrand a deployment with `BRAND_*`
  environment variables, no fork required: the full variable table, the logo, per-prospect
  overrides, what isn't brandable today, a worked "Contoso Live Assist" example, and how to verify
  it with `GET /api/v1/branding` and the Playwright branding spec.
- [`developer/build-your-own.md`](developer/build-your-own.md) — extend the product: the repository
  map, the platform sync workflow, adding a prospect, changing the voice prompt and handoff contract
  together, swapping in a real safety guard or STT source, adding a route or a UI surface the right
  way, and the test/quality gates a change must pass.
- [`developer/local-dev.md`](developer/local-dev.md) — layout, `make` targets, the mock ARAG
  server, tests, e2e, the coverage gate, running against a live Knowledge Box.
- [`developer/contributing.md`](developer/contributing.md) — links to
  [`../CONTRIBUTING.md`](../CONTRIBUTING.md), plus the product rules: spec-first, the golden set
  must stay green, never edit `vendor/`.

## Architecture

- [`architecture/architecture.md`](architecture/architecture.md) — real-time listening and the turn
  pipeline, the product's surfaces (with diagrams), and the architecture decisions behind the shape
  of the system.
- [`architecture/arag-integration.md`](architecture/arag-integration.md) — the exact `/ask` request
  shape, NDJSON items, citations, the brief's `answer_json_schema`, stored search configurations,
  and why citations and `answer_json_schema` are mutually exclusive.
- [`architecture/data-flow.md`](architecture/data-flow.md) — a listen session's lifecycle, a voice
  turn, a golden eval: what happens and what is persisted where, plus retention and purge.
- [`architecture/deployment-topologies.md`](architecture/deployment-topologies.md) — the single Fly
  machine + volume, co-location with the ARAG zone, multi-region notes, running behind a gateway.
- [`architecture/security-model.md`](architecture/security-model.md) — the threat model, auth
  modes, the API key store, rate limits, guard placement, redaction, session-content retention, and
  why `security.groups` is not an authorisation boundary.
- [`architecture/scaling.md`](architecture/scaling.md) — concurrency and cost of listening
  sessions, LLM cost per turn/brief, cold starts, store limits, retention as a lever, what to swap
  first.
- [`architecture/limits.md`](architecture/limits.md) — an honest list of current limits: listening
  is single-process (SSE fan-out and timers), sessions live in the JSON store, a single shared
  service-account token, demo-grade guards, an in-memory metrics ring, an hourly (not continuous)
  auto-purge, and a mock-only-verified golden corpus.

## Business

- [`business/overview.md`](business/overview.md) — what VoiceBridge is and what makes an answer
  trustworthy.
- [`business/when-to-use.md`](business/when-to-use.md) — the shape of problem this fits, and where
  it doesn't.
- [`business/walkthrough-demo.md`](business/walkthrough-demo.md) — a click-by-click tour of the
  workspace (Live, Conversations, Knowledge, Prospects, Quality, Settings), including the
  golden-set runner.
- [`business/walkthrough-admin.md`](business/walkthrough-admin.md) — a click-by-click tour of the
  Operator views, including onboarding a new prospect.
- [`business/faq.md`](business/faq.md) — common questions, answered precisely rather than glossed.

## Product marketing

- [`product-marketing/positioning.md`](product-marketing/positioning.md)
- [`product-marketing/partner-pitch.md`](product-marketing/partner-pitch.md)
- [`product-marketing/launch-blog.md`](product-marketing/launch-blog.md)

## Hands-on material

- [`../enablement/`](../enablement/) — the developer track and architect track: labs, exercises,
  a sizing/deployment guide and a design-review checklist.
- [`../showcase/`](../showcase/) — the demo script, storyboard and recorded walkthrough.
