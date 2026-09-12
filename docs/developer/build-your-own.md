# Building your own product on VoiceBridge

VoiceBridge is an open-source reference product ("accelerator") on Progress Agentic RAG, not a
closed appliance. Partners are expected to extend it — add prospects, swap a guard, change the
prompt, add a route, add a UI surface — and to take the result to market as their own. This page is
the map for doing that safely: what each layer owns, the seams that are meant to be touched, the
gates a change must pass, and the boundary between "fix it in the platform" and "keep it in the
product". For rebranding without touching code at all, see
[`white-label.md`](white-label.md).

## Repository map — what each layer owns

```
src/
  config.ts        product env (VOICE_* / BRAND_* vars) on top of the platform's shared env
  index.ts         entrypoint: load env, build the app, listen, shut down cleanly
  server.ts        createProduct(): wires stores, clients, jobs and every route module
  openapi.ts       the OpenAPI 3.1 document — source of truth, written before routes
  types.ts         the public request/response contract + registry shapes (ProspectConfig, ProspectBrand, …)
  routes/          one module per resource: voice, prospects, listen, realtime, quality, jobs, admin
  services/        domain logic, no HTTP types — pipeline, handoff, voiceShape, safety, citations,
                    brief, registry, clientPool, goldenEval, provision, metrics, seed, models,
                    voices, scribe, liveavatar, livekit, voicePrompt
public/            demo console (static, framework-free) — consumes only /api/v1
admin/             admin panel (static) — consumes only /api/v1 (+ /api/v1/admin)
vendor/arag-platform/  vendored platform (App, AragClient, Store, JobManager, the UI kit) — never edited here
test/              unit, integration (mock ARAG), contract, e2e (Playwright)
scripts/           eval.ts, provision.ts, smoke.ts — thin clients over the running server's API
config/            prospects.example.json — seeds the registry store on first boot
data/              DATA_DIR default (gitignored) — prospects.json, turns.json, jobs.json, golden-evals.json
```

The full annotated version (with the complete `services/` list and dependency notes) is in
[`local-dev.md`](local-dev.md#layout). The layering that matters when extending the product:

- **`vendor/arag-platform/`** owns generic, product-agnostic infrastructure: the HTTP app (`App`),
  the ARAG client, the JSON `Store`/`Collection`, the job manager, branding, and the shared UI kit
  (`arag-ui.js`/`arag-ui.css`, `<arag-shell>`). If a capability would be useful to *any* product
  built on ARAG, it belongs here, not in `src/`.
- **`src/services/`** owns VoiceBridge's own domain logic — the turn pipeline, handoff detection,
  the voice prompt, safety guards, the prospect registry, golden evaluation. This is almost always
  where a product-specific extension lands.
- **`src/routes/`** is a thin HTTP layer over `services/` — parses the request, calls a service,
  shapes the response. It should contain no business logic of its own.
- **`public/`/`admin/`** are static, framework-free pages that only ever talk to `/api/v1*` — no
  server-side rendering, no build step.

## The platform sync workflow

`vendor/arag-platform/` is a **vendored copy**, synced from the platform repo — it is never
hand-edited in place (`docs/developer/contributing.md`'s "Never edit `vendor/`" rule). The current
vendored version is recorded in `vendor/arag-platform/PLATFORM_VERSION` (`0.1.6` at the time of
writing) and the sync date is in `vendor/arag-platform/README.md`.

To pull in a platform change:

```bash
# from a checkout of the arag-platform repo, not from this repo
make sync-platform TARGET=../arag-voice
```

This copies the platform's `src/` and `ui/` into this repo's `vendor/arag-platform/` and rewrites
`PLATFORM_VERSION`. If you find a bug or a missing capability in the platform layer while working on
VoiceBridge (a UI kit component, a `Store` backend, the branding config), **fix it upstream in the
platform repo first**, bump its version, then re-sync — a local edit under `vendor/` is silently
discarded by the next sync and does not benefit any other product built on the same platform.

**What to upstream vs keep in the product:** if the change is generic — a new `Store` backend, a
new UI-kit component, a new branding field, an HTTP-layer feature (`App`, auth, rate limiting) —
it belongs in the platform repo. If the change is VoiceBridge-specific — the turn pipeline, the
voice prompt, handoff detection, the prospect registry shape, golden evaluation — it belongs here,
in `src/`.

## Adding a prospect

Onboarding a new prospect (registry entry → provisioning → golden set → demo gate) should be the
**only** thing that changes when a new customer or demo target is added — see
[`extension-points.md#onboarding-a-new-prospect-end-to-end`](extension-points.md#onboarding-a-new-prospect-end-to-end)
for the full four-step ritual with working `curl` examples, and
[`white-label.md#per-prospect-overrides`](white-label.md#per-prospect-overrides) if that prospect
also needs its own branding on a shared deployment. If a prospect ever needs a change under `src/`,
that is a defect in the abstraction, not a one-off to work around.

## Changing the voice prompt and the handoff contract together

`src/services/voicePrompt.ts::buildVoicePrompt()` and `src/services/handoff.ts::decideHandoff()`
are two halves of one contract, not independent pieces:

- The prompt instructs the model to reply with the exact sentinel `HANDOFF:` (`HANDOFF_SENTINEL`
  in `handoff.ts`) followed by a reason, whenever the supplied context does not answer the
  question.
- `decideHandoff()` keys off that exact prefix (`trimmed.toUpperCase().startsWith(HANDOFF_SENTINEL)`)
  as its **primary, deterministic** path, with two belt-and-braces fallbacks for when the sentinel
  is missing: ARAG's own stock refusal phrasings (`NOT_FOUND_PREFIXES`), and simply an empty answer
  or zero retrieved items.

If you change the prompt's wording around the sentinel, or introduce a new refusal phrasing, update
`decideHandoff()` in the same change — and if you introduce a genuinely new *reason* (not just a new
phrasing of an existing one), extend `HandoffReason` in `src/types.ts` and the `handoff_reason` enum
in `src/openapi.ts` together; the contract test (`missingFromSpec()`/`lintSpec()`, see
[`local-dev.md#tests`](local-dev.md#tests)) fails the build on a mismatch. `voicePromptForSearchConfig()`
(same file) is the stored-search-configuration form of the identical prompt used by
`src/services/provision.ts` — keep both forms in sync; they must produce the same behaviour whether
a prospect uses inline prompting or a provisioned ARAG search configuration
(`src/services/pipeline.ts::buildAskRequest()` picks between them).

Whatever you change here, the golden set is the actual regression test — see
[Test and quality gates](#test-and-quality-gates) below; `docs/developer/contributing.md` calls this
out explicitly as "the golden set must stay green".

## Adding or replacing a safety guard

`src/services/safety.ts` implements `guardInput()`/`guardOutput()` as demo-grade regex checks,
called from `src/services/pipeline.ts` at steps 2 (input) and 8 (output) of the turn pipeline. To
add a new guard or replace the whole implementation with a real moderation classifier, keep the
`GuardResult` shape (`{ ok, deflection?, reason? }`) so `pipeline.ts` needs no change, give a
network-calling classifier its own timeout well inside `VOICE_TURN_TIMEOUT_MS`, and decide
deliberately whether it fails open or closed. Full walkthrough, including how to extend
`GuardReason` safely, is in
[`extension-points.md#a-real-moderation-classifier`](extension-points.md#a-real-moderation-classifier).

## Swapping the STT/telephony source feeding listen sessions

The real-time listening API (`POST /api/v1/listen/sessions` and its transcript/events/end routes)
is deliberately transcription-source-agnostic: nothing in `TranscriptChunk` or `ListenSession`
names a vendor, and it accepts conversation chunks from anywhere via a plain HTTP `POST`. ElevenLabs
Scribe (`src/services/scribe.ts`) is one *optional* way to get a live transcript into a session —
the one Live's own microphone source uses — not a requirement of the API. A telephony
platform's transcription webhook, a meeting bot, or a customer's existing STT vendor can feed the
same session directly. See [`integrations.md`](integrations.md) for the exact env vars and
degrade-to-503 behaviour of each optional integration, and
[`extension-points.md#another-voice-platform`](extension-points.md#another-voice-platform) for the
three ElevenLabs-specific modules (`scribe.ts`, `voices.ts`,
`public/vendor/elevenlabs-client.js`) that are the *only* vendor-specific surface — the turn
pipeline, handoff contract, voice shaping, citations and golden-set gate are all platform-agnostic
already.

## Adding a new API route the right way

Every `/api/v1` route is spec-first (`docs/developer/contributing.md`):

1. **Describe it in `src/openapi.ts` before writing the handler** — the operation needs an
   `operationId`, `tags`, `summary`, a request/response schema, and documented error responses via
   `standardResponses`.
2. **Implement the handler in the right `src/routes/*.ts` module** (or a new one, registered in
   `src/server.ts`), calling into `src/services/` for any actual logic. Pass
   `validate: operationSchemas(openapi, "<path>", "<method>")` in the route options — see
   `src/routes/prospects.ts` for the pattern — so the platform's `App` validates every request and
   response against the spec you just wrote.
3. **Run `make test`.** `test/contract.test.ts` fails if a registered route is missing from the
   spec (`missingFromSpec()`) or the spec doesn't lint clean (`lintSpec()`); `test/integration.test.ts`
   exercises every route in-process against the mock ARAG server.
4. **Regenerate the reference:** `make docs` (needs the server running — `make dev` in another
   terminal) overwrites `docs/developer/api-reference.md` from the live `/api/v1/openapi.json`.
   Never hand-edit that file.

## Adding a UI surface on the shared UI kit

Both static front ends (`public/`, `admin/`) load the platform's UI kit directly —
`<link rel="stylesheet" href="/ui/arag-ui.css">` and `<script type="module" src="/ui/arag-ui.js">`
— served from `vendor/arag-platform/ui` via `app.static("/ui", ...)` in `src/server.ts`. A new page
follows the same pattern: wrap its content in an `<arag-shell product="..." nav="Label=/path,...">`
custom element (see `public/index.html`/`admin/index.html` for a working example of the attributes:
`tagline`, `admin-href`, `docs-href`, `branding-src`), and call the exported helpers
(`window.aragUI.api()`, `.toast()`, `.sse()`, `.highlightJson()`, `.fmtMs()`, `.fmtBytes()`) instead
of hand-rolling fetch/formatting logic. The shell fetches and applies branding automatically from
`GET /api/v1/branding` unless you pass `branding-src="none"` — see
[`white-label.md#colours-the-ui-kit-sets`](white-label.md#colours-the-ui-kit-sets). If the page
needs a UI-kit component that doesn't exist yet, build it in the platform repo (it is generic
infrastructure, per the sync-workflow rule above) and re-sync, rather than inlining one-off markup
that every product would benefit from.

## Test and quality gates

A change must pass, in order of how often you run them:

```bash
make test        # unit + integration + contract tests, mock ARAG, no external calls
make coverage     # same tests + 80% line-coverage gate on src/**
make check        # lint (biome) + typecheck (tsc --noEmit) + coverage — this is what CI runs
make e2e          # Playwright: console + admin, against a mock-backed server
make eval P=progress   # golden set for each shipped prospect
make eval P=tangerine
make eval P=northwind
```

`make check` is exactly what `.github/workflows/ci.yml` runs on Node 22 and 24 for every push and
PR. If you touched the turn pipeline, the handoff contract, the voice prompt, or voice shaping, the
golden set is the change's actual regression test — every shipped prospect's golden set must stay
green, and if a change legitimately changes expected behaviour, update the affected golden
questions in `config/prospects.example.json` in the same PR rather than letting the gate go quiet.
Full detail on the mock ARAG server, what each test file covers, and running against a live
Knowledge Box is in [`local-dev.md`](local-dev.md).

See [`contributing.md`](contributing.md) and [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md) for
the full workflow (branching, commit style, PR checklist) on top of these gates.
