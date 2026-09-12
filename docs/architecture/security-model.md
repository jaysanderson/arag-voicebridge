# Security model

## Threat model

VoiceBridge's job is to let an untrusted caller (a voice agent's tool call, or a browser) get a
grounded answer without ever touching an ARAG or ElevenLabs credential, and without a single bad
input turning into a hallucinated or unsafe spoken answer. The assets worth protecting, roughly in
order:

1. **The ARAG service-account token and the ElevenLabs/LiveAvatar/LiveKit API keys** — never sent
   to a browser, never logged (the platform logger redacts any field matching
   `token|key|secret|password`, plus `authorization`/`cookie` headers), read only from environment
   variables.
2. **The admin surface** — registry CRUD, provisioning, the turn log, raw logs and effective
   configuration. Compromise here lets an attacker point a prospect at a different Knowledge Box,
   read recent (non-guard-tripped) question text, or read redacted-but-structurally-informative
   configuration.
3. **Third-party quota** — minting an ElevenLabs Scribe token or a LiveKit/LiveAvatar session
   spends someone else's paid quota; these routes are treated as more sensitive than a normal read.
4. **The spoken answer itself** — grounding and the deterministic handoff are the actual
   anti-hallucination control, not a security control in the traditional sense, but they exist for
   the same reason: an ungrounded or unsafe spoken answer is the worst outcome this product can
   produce in front of a customer.

What is explicitly **not** in scope as a hard guarantee today: a determined attacker with a stolen
API key crafting adversarial prompts against the safety guards, or PII handling beyond "don't log
guard-tripped question text" — see [`limits.md`](limits.md) for the honest list.

## Auth modes

Three modes, checked by the platform's `App.authenticate()`/`enforceAuth()`
(`vendor/arag-platform/src/http/app.ts`), applied per route via the `auth` route option:

| Mode | Route examples | Behaviour |
|---|---|---|
| `none` (default) | `/healthz`, `/readyz`, OpenAPI/docs pages, `POST /api/v1/session` | Always public |
| `api` | `/api/v1/voice-answer`, `/api/v1/prospects`, `/api/v1/brief`, `/api/v1/metrics`, `/api/v1/jobs/*`, realtime bootstrap | Open when `API_KEYS` is unset; requires `X-API-Key`, `Authorization: Bearer <key>`, an admin token, or a signed `arag_session` cookie once `API_KEYS` is set |
| `admin` | every `/api/v1/admin/*` route | Always requires `ADMIN_TOKEN` — `Authorization: Bearer <token>` or the `arag_admin` cookie set by `POST /api/v1/admin/login`. If `ADMIN_TOKEN` is unset, admin routes answer `403` (disabled, not "open") |

The `arag_session` cookie exists so the demo console can call `auth: "api"` routes without ever
holding an API key in browser JS: it calls `POST /api/v1/session` once at boot, which issues an
HMAC-signed, 12-hour cookie (`App.issueSession()`); the secret is `ADMIN_TOKEN` if set, otherwise a
random value generated once per process boot (so restarting the server invalidates existing
sessions — acceptable for a demo console, not a claim of durable session security).

**Credential-minting routes are never anonymous, even when `API_KEYS` is unset.** `POST
/api/v1/scribe-token` and `POST /api/v1/avatar/sessions` both call `requireIdentified()`
(`src/routes/realtime.ts`), which demands a session, API key or admin token regardless of the
global `API_KEYS` setting — "open by default" is the right default for reading non-secret prospect
data, but wrong for spending someone else's third-party quota (`DECISIONS.md` V-06). This is a
product-level rule layered on top of the platform's own `auth` modes, not something the platform
enforces generically.

Admin token comparison uses `constantTimeEqual()` — a timing side-channel on the admin token
comparison is a real, practical attack against a static bearer secret, so both the login route and
`App.authenticate()`'s cookie/bearer checks use constant-time comparison rather than `===`.

## `POST /api/v1/voice-answer` itself has no per-agent auth

Worth stating plainly: with `API_KEYS` unset (the shipped default), anyone who can reach a deployed
VoiceBridge and knows a prospect's registry key (a short, guessable, non-secret string like
`progress`) can call `/api/v1/voice-answer` and spend ARAG/LLM tokens on that prospect's Knowledge
Box. This is intentional for a demo (the whole point is that any voice platform's custom tool can
call it with nothing but the prospect key), but it is a real cost-and-abuse surface for anything
beyond a demo — set `API_KEYS` and put the real key only in the voice agent's tool configuration
(never in client-side code) once this stops being a controlled demo audience.

## Rate limiting

Two layers stack:

1. **Platform global limiter** — one per-IP-or-API-key token bucket (`RATE_LIMIT_RPS`/
   `RATE_LIMIT_BURST`, default 5 rps / burst 20) applied to every route unless `noRateLimit: true`
   (health checks, the OpenAPI document, the job-events SSE stream — a long-lived connection
   shouldn't be rate-limited as if it were a burst of requests).
2. **Product-owned per-route limiters** (`src/services/ratelimit.ts::RateLimiter`) stacked on top
   for the two endpoints where the global budget is provably wrong for the traffic pattern: `/brief`
   fires roughly every 1.5 s while Listen mode is active (`VOICE_BRIEF_RATE_RPS`, default 1 rps,
   burst 5) and each call costs a full LLM generation; `/scribe-token` mints ElevenLabs quota
   (`VOICE_SCRIBE_RATE_RPS`, default 0.2 rps, burst 3). `DECISIONS.md` V-05 records this as a
   reported gap in the shared platform toolkit — per-route limits belong there long-term, but live
   here as product code today.

Neither limiter distinguishes "logged in as this admin" from "anonymous caller" beyond the admin
bypass (`!ctx.auth.admin` in the platform's global limiter) — a golden-eval job hammering
`/voice-answer` internally, for instance, is not separately throttled from live traffic (see
[`limits.md`](limits.md)).

## Guard placement

The turn pipeline has exactly two safety checkpoints (`src/services/safety.ts`, steps 2 and 8 of
[`architecture.md`](architecture.md)'s pipeline): an **input guard** before anything reaches ARAG,
and an **output guard** on the already voice-shaped answer, just before it would be spoken. Both
are deliberately lightweight, deterministic, pattern-based checks — not a content-moderation
product — logged with a reason but never with the offending text for a trip (see redaction below).
They exist to make the extension seam obvious: see
[`../developer/extension-points.md`](../developer/extension-points.md) for how a real classifier
slots in behind the same `GuardResult` shape. The output guard is specifically a backstop against
voice shaping missing something (`hasSpeakableViolation()` re-checks for URLs/markers/markdown
after `shapeForVoice()` has already tried to strip them) — belt-and-braces, not the primary
defence, which is grounding-and-handoff itself.

## Redaction

The turn log (`turns.json`, `GET /api/v1/admin/turns`) stores the question text **only** for turns
that passed the input guard (`DECISIONS.md` V-08) — a turn that tripped a guard records the reason
(`prompt-injection`, `unsafe-request`, etc.), the prospect and the latency, and nothing else. This
is exactly backwards from an intuition that "the interesting text to keep is the bad text" — an
injected or unsafe prompt is precisely the text you do not want retained and re-displayed in an
admin panel. `test/e2e/admin.spec.ts` and the admin turn-log UI both assert/render this as
"redacted (guard trip)" rather than the actual text.

Secrets never appear in logs at all: the platform logger's redaction (`token|key|secret|password`
field-name matching, plus header redaction for `authorization`/`cookie`) is unconditional, and
`describeEnv()`/`describeVoiceConfig()` (used by `GET /api/v1/admin/config`) redact the same way for
the admin configuration page — a secret shows as `•••(N chars)`, confirming it is set without
revealing it.

## `security.groups` is not an authorisation boundary

The stored ARAG search configuration sets `security: { groups: ["public"] }`
(`src/services/provision.ts::buildSearchConfiguration()`). This is a **retrieval filter** — it
controls which documents a query is allowed to retrieve *given the groups the caller is presented
as belonging to* — not a server-side access-control boundary enforced on the documents themselves.
VoiceBridge does not currently vary the groups sent per caller (every request goes through as
`["public"]`), so in the current implementation this setting demonstrates that governed retrieval
filtering *works*, but it does not by itself prove that a specific caller cannot see a specific
restricted document — that would require the caller's identity to be authenticated and mapped to
groups upstream of this filter, which VoiceBridge does not do today. State this distinction
precisely to anyone evaluating the system: "the filter works as configured" is a true and
demonstrable claim; "this is an authorisation boundary" is not.

## Vendored client and CSP

`public/vendor/elevenlabs-client.js` is a pinned, vendored copy of `@elevenlabs/client` (1.14.0
IIFE bundle) rather than a runtime `esm.sh`/CDN import (`DECISIONS.md` V-09) — a CDN import is a
live code-execution dependency on a third party that can change what it serves at any time; a
vendored, pinned file is inspectable and stable. Its licence is recorded in
`THIRD_PARTY_NOTICES.md`; re-vendoring a new version is a documented two-step (download the pinned
build, update the notice).

The Content-Security-Policy (`securityHeaders()`, `vendor/arag-platform/src/http/app.ts`, extended
in `src/server.ts` for this product) allows `connect-src`/`media-src` only to the specific hosts
this product actually needs — ElevenLabs' API and WebSocket hosts, and `*.livekit.cloud` for the
avatar pane's WebRTC signalling and its video via `storage.googleapis.com` — rather than a broad
allowlist. Every other product on the shared platform keeps the narrower default CSP; VoiceBridge's
extension is additive and scoped to exactly its own third-party integrations.
