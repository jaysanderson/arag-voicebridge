# Security model

## Threat model

VoiceBridge's job is to let an untrusted caller (a voice agent's tool call, or a browser) get a
grounded answer without ever touching an ARAG or ElevenLabs credential, and without a single bad
input turning into a hallucinated or unsafe spoken answer. The assets worth protecting, roughly in
order:

1. **The ARAG service-account token, the ElevenLabs API key, and every VoiceBridge API key** — never
   sent to a browser, never logged (the platform logger redacts any field matching
   `token|key|secret|password`, plus `authorization`/`cookie` headers). Each is now backed by a
   settings/key store rather than only an environment variable (`SettingsService`/`ApiKeyStore`, see
   [`../developer/settings.md`](../developer/settings.md) and "The API key store" below) — the
   environment still supplies the boot-time default, and secrets are write-only over the admin API:
   set once, then reported back as `set` plus a four-character hint, never the value.
2. **The admin surface** — registry CRUD, provisioning, settings, the API key store, the turn log,
   raw logs and effective configuration. Compromise here lets an attacker point a prospect at a
   different Knowledge Box, read recent (non-guard-tripped) question text, mint or revoke API keys,
   or read redacted-but-structurally-informative configuration.
3. **Third-party quota** — minting an ElevenLabs Scribe token, or pushing an agent/tool
   configuration to ElevenLabs, spends or reconfigures someone else's paid account; these routes are
   treated as more sensitive than a normal read.
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
| `api` | `/api/v1/listen/sessions*` (create, append, read, list, events, end), `/api/v1/voice-answer`, `/api/v1/prospects`, `/api/v1/brief`, `/api/v1/metrics`, `/api/v1/jobs/*`, realtime bootstrap | Open when `API_KEYS` is unset; requires `X-API-Key`, `Authorization: Bearer <key>`, an admin token, or a signed `arag_session` cookie once `API_KEYS` is set |
| `admin` | every `/api/v1/admin/*` route, including `/api/v1/admin/listen-sessions` | Always requires `ADMIN_TOKEN` — `Authorization: Bearer <token>` or the `arag_admin` cookie set by `POST /api/v1/admin/login`. If `ADMIN_TOKEN` is unset, admin routes answer `403` (disabled, not "open") |

The `arag_session` cookie exists so the workspace can call `auth: "api"` routes without ever
holding an API key in browser JS: it calls `POST /api/v1/session` once at boot, which issues an
HMAC-signed, 12-hour cookie (`App.issueSession()`); the secret is `ADMIN_TOKEN` if set, otherwise a
random value generated once per process boot (so restarting the server invalidates existing
sessions — acceptable for a self-hosted workspace, not a claim of durable session security).

**Credential-minting routes are never anonymous, even when `API_KEYS` is unset.** `POST
/api/v1/scribe-token` and `POST /api/v1/speech` both call `requireIdentified()`
(`src/routes/realtime.ts`), which demands a session, API key or admin token regardless of the
global `API_KEYS` setting — "open by default" is the right default for reading non-secret prospect
data, but wrong for spending someone else's third-party quota (`DECISIONS.md` V-06). This is a
product-level rule layered on top of the platform's own `auth` modes, not something the platform
enforces generically.

Admin token comparison uses `constantTimeEqual()` — a timing side-channel on the admin token
comparison is a real, practical attack against a static bearer secret, so both the login route and
`App.authenticate()`'s cookie/bearer checks use constant-time comparison rather than `===`.

## The API key store

`API_KEYS` used to be the entire authentication story for `auth: "api"` routes: a comma-separated
environment variable, compared as a flat list, with no name, no revocation and no record of which
key a caller used. `ApiKeyStore` (`src/services/apiKeys.ts`, `DECISIONS.md` V-27) replaces the
authority while keeping `API_KEYS` as the **seed**: on first boot, any key listed there is recorded
as an `origin: "env"` key so an existing deployment's key keeps working and simply shows up in
`GET /api/v1/admin/api-keys` instead of vanishing.

- **Secrets are stored in full**, not hashed, in `api-keys.json`. This is a deliberate trade-off, not
  an oversight: the platform's authenticator needs the plaintext for a constant-time comparison
  (see below), and pushing the ElevenLabs agent's custom tool has to put a *real* key into the
  tool's `X-API-Key` header (`desiredTool()`, `src/services/voiceAgent.ts`) — a one-way hash cannot
  supply that. This is the same trust level as the `.env` file the store replaces. The one place a
  secret is returned is the response to `POST /api/v1/admin/api-keys` that creates it — after that,
  the API only ever shows a `prefix`.
- **Revocation is live, not eventual.** `revoke()` marks the record and calls `sync()`, which
  rewrites the live `env.apiKeys` array in place with the remaining active secrets — the platform's
  `App.authenticate()` reads that same array object, so a revoked key stops authenticating on the
  very next request, no restart. The revoked record itself stays (marked `revoked`, with
  `revokedAt`) rather than being deleted, so the audit trail survives the revocation.
- **Revoking the last key reopens the API.** With zero active keys, `auth: "api"` routes are open by
  default (see the auth-modes table above) — this is the documented, intentional "no keys = open"
  behaviour, not a bug, and it is asserted in the test suite. `GET /api/v1/admin/api-keys` reports
  `open: true` precisely so an operator notices before a caller does.
- **Last-used is throttled, not per-request.** `touch()` samples at most once per 30 seconds per key
  (`TOUCH_INTERVAL_MS`) so a busy deployment does not pay a store write on every authenticated
  request; it runs *after* the middleware chain, because the platform authenticates inside its own
  dispatch and `ctx.auth` is not yet populated on the way in (reported to the platform team, see
  `DECISIONS.md` V-27).

See [`../developer/settings.md`](../developer/settings.md) for the settings store this pairs with,
and [`../developer/quickstart.md`](../developer/quickstart.md) for minting a key from a running
deployment.

## `POST /api/v1/voice-answer` itself has no per-agent auth

Worth stating plainly: with `API_KEYS` unset (the shipped default), anyone who can reach a deployed
VoiceBridge and knows a prospect's registry key (a short, guessable, non-secret string like
`progress`) can call `/api/v1/voice-answer` and spend ARAG/LLM tokens on that prospect's Knowledge
Box. This is intentional for a demo (the whole point is that any voice platform's custom tool can
call it with nothing but the prospect key), but it is a real cost-and-abuse surface for anything
beyond a demo — set `API_KEYS` and put the real key only in the voice agent's tool configuration
(never in client-side code) once this stops being a controlled demo audience.

## Sessions carry conversation content

A listen session holds real conversation text — the same category of sensitive input a voice turn's
`question` is, but retained for the life of the call rather than processed and discarded. Three
things bound what that means in practice:

1. **Retention is capped, not indefinite.** A session's transcript is capped at the most recent 400
   entries / 20,000 characters (`MAX_TRANSCRIPT_ENTRIES`/`MAX_TRANSCRIPT_CHARS`,
   `src/services/listen.ts`), its brief history at 20 versions, and its citation list at 12 — so a
   very long call does not grow a session without bound. The session itself is deleted only when the
   collection's 200-session cap evicts it (oldest `createdAt` first, live or ended alike — see
   [`data-flow.md`](data-flow.md) and [`limits.md`](limits.md)); there is no separate
   time-based expiry or an explicit "purge this session's content" operation today.
2. **The same injection screening as the rest of the product.** The transcript reaches the brief
   prompt as free text, so it gets the same treatment as voice-turn `history`: `screenTranscript()`
   (`src/services/safety.ts`) drops any line matching the injection patterns before it is
   interpolated into the ARAG prompt, and the rolling window itself passes through `guardInput()`
   before a refresh is attempted — a window that reads as an injection attempt or an out-of-scope
   ask produces `brief: null` (nothing usable) rather than being forwarded to ARAG. This is the
   same `unsafeReason()` check used everywhere else in the product (see "Guard placement" below),
   not a separate, session-specific classifier.
3. **No content-specific redaction in the store.** Unlike the turn log's guard-trip redaction
   (below), a listen session's transcript is stored as-is regardless of whether a line tripped the
   injection screen — the screen only affects what gets *sent to ARAG*, not what is written to
   `listen-sessions.json`. An operator with admin access reading `GET /api/v1/admin/listen-sessions`
   sees the same transcript/brief history a caller building a client against the public API would.

## Who can read a session

Every listen-session route — create, append, read, list, the SSE stream, and end — is `auth: "api"`
with no further per-session check: there is no owner or caller identity recorded on a session
beyond the opaque `metadata` object a creator chooses to attach. With `API_KEYS` unset (the shipped
default), anyone who can reach the deployment and knows (or enumerates) a session id can read its
transcript and brief, append to it, or end it — the same shape of exposure documented below for
`POST /api/v1/voice-answer`, extended to conversation content rather than just spend. `GET
/api/v1/listen/sessions` additionally lists **recent sessions for a prospect** with no id needed at
all. Set `API_KEYS` (or rely on the workspace's own `arag_session` cookie, which is scoped to the
browser that created it but is not a per-session credential either) before treating session content
as anything other than shared-within-the-deployment.

## Rate limiting

Two layers stack:

1. **Platform global limiter** — one per-IP-or-API-key token bucket (`RATE_LIMIT_RPS`/
   `RATE_LIMIT_BURST`, default 5 rps / burst 20) applied to every route unless `noRateLimit: true`
   (health checks, the OpenAPI document, the job-events SSE stream and a listen session's own SSE
   stream — a long-lived connection shouldn't be rate-limited as if it were a burst of requests).
   This is what bounds `POST .../transcript` appends and reads of a session: they carry no
   route-specific limiter of their own, so they share the same global budget as any other route.
2. **Per-route limits, declared on the route, enforced by the platform** — `POST
   /api/v1/listen/sessions` (opening a session) and `POST /api/v1/brief` share one budget
   (`VOICE_BRIEF_RATE_RPS`, default 1 rps, burst 5) because opening a session is the gateway to a
   stream of full-LLM-generation refreshes; `/scribe-token` mints ElevenLabs quota
   (`VOICE_SCRIBE_RATE_RPS`, default 0.2 rps, burst 3). These budgets are declared as a `rateLimit:
   { rps, burst }` option on the route registration and enforced by the platform's own
   `App.rateLimited()` (`vendor/arag-platform/src/http/app.ts`) — the product-owned `RateLimiter`
   this used to require (`src/services/ratelimit.ts`) has been deleted now that the platform
   supports per-route limits natively, closing the gap `DECISIONS.md` V-05 originally reported
   (`DECISIONS.md` V-15).

Neither limiter distinguishes "logged in as this admin" from "anonymous caller" beyond the admin
bypass (`!ctx.auth.admin` in the platform's global limiter) — a golden-eval job hammering
`/voice-answer` internally, for instance, is not separately throttled from live traffic, and a
session's own throttle (`decideRefresh()`, see [`architecture.md`](architecture.md)) is a *cost*
control on refreshes, not a rate limiter on the append endpoint itself (see
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

The turn log (`turns.json`, `GET /api/v1/turns`) stores the question text **only** for turns
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
revealing it. `SettingsService.update()`/`reset()` follow the same rule deliberately: every settings
change is logged (`settings.changed`, `settings.reset` — who, which fields, when), but the *values*
are never logged, because some of them are secrets and all of them are already visible in
`GET /api/v1/admin/settings` to anyone who should be looking at them.

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
this product actually needs — ElevenLabs' API and WebSocket hosts, plus `*.livekit.cloud` and
`storage.googleapis.com` — rather than a broad allowlist. `*.livekit.cloud` is not a separate
integration: the vendored `@elevenlabs/client` browser SDK negotiates the voice-agent call's WebRTC
media over LiveKit Cloud internally as part of ElevenLabs Conversational AI, so those hosts belong
to the ElevenLabs entry, not to a video-avatar feature (that integration, and the `avatar_id`
field, were removed from the product — `DECISIONS.md` V-25 — precisely because it had no front end
to exercise it end to end). Every other product on the shared platform keeps the narrower default
CSP; VoiceBridge's extension is additive and scoped to exactly its own third-party integrations.
