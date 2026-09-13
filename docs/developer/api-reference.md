# API reference — VoiceBridge API v0.2.0

Grounded, cited and governed voice answers over Progress Agentic RAG (ARAG).

`POST /api/v1/voice-answer` is the endpoint a voice agent's custom tool calls: it runs the nine-step turn pipeline (safety guards → ARAG ask → deterministic handoff → voice shaping → citations) and always returns something speakable within the agent's tool timeout.

`POST /api/v1/brief` powers the ambient copilot: a structured, evolving brief built with ARAG's `answer_json_schema`.

Authentication: public routes are open unless `API_KEYS` is set (then `X-API-Key` or a same-origin session from `POST /api/v1/session`); `/api/v1/admin/*` always requires `ADMIN_TOKEN`.

Generated from `openapi.json` — do not edit by hand. Interactive docs: `/api/v1/docs` (Redoc) and `/api/v1/swagger` (try it out).

## Authentication

- **ApiKey** — apiKey header X-API-Key: Required only when API_KEYS is configured.
- **Bearer** — http bearer : API key or admin token as a bearer token.
- **AdminToken** — http bearer : ADMIN_TOKEN; required for /admin routes.

## listen

### `POST /api/v1/listen/sessions`

**Start a listen session** — Opens a session for a prospect. Feed it conversation with `POST /api/v1/listen/sessions/{id}/transcript` from any source — a realtime STT stream, a telephony webhook, a meeting bot, or someone typing — and read the evolving brief from the SSE stream or by polling the session.

Request body (`application/json`): object

| Field | Type | Required | Description |
|---|---|---|---|
| `prospect` | string | yes |  |
| `locale` | string |  |  |
| `generative_model` | string |  |  |
| `metadata` | object |  | Opaque caller context (agent id, queue, call id…) kept with the session |

Responses:

- `201` Session started — `application/json` [ListenSession](#listensession)
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: ApiKey or Bearer


### `GET /api/v1/listen/sessions`

**Search, filter and page past listen sessions** — Backs the Conversations list. `q` searches the prospect, the brief (topic, summary, goal, profile), the accumulated source titles and the transcript itself, so an operator can find a call by what was said in it rather than by its id.

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `prospect` | query | string |  |  |
| `status` | query | string |  |  |
| `q` | query | string |  | Free text over prospect, brief, source titles and transcript |
| `from` | query | string |  | Only sessions started at or after this instant |
| `to` | query | string |  | Only sessions started at or before this instant |
| `sort` | query | string |  |  |
| `order` | query | string |  |  |
| `limit` | query | integer |  |  |
| `offset` | query | integer |  |  |

Responses:

- `200` OK — `application/json` object
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: ApiKey or Bearer


### `GET /api/v1/listen/sessions/{id}/export`

**Export the whole record of one call** — Returns every brief version with its timestamp and latency, the full transcript, the accumulated citations and the session stats — as JSON, or as Markdown for a handover note.

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `id` | path | string | yes |  |
| `format` | query | string |  |  |

Responses:

- `200` The session record — `application/json` [ListenSessionExport](#listensessionexport)
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: ApiKey or Bearer


### `GET /api/v1/listen/sessions/{id}`

**Session state: brief, citations, stats and a transcript tail**

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `id` | path | string | yes |  |
| `transcript_tail` | query | integer |  |  |

Responses:

- `200` OK — `application/json` [ListenSession](#listensession)
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: ApiKey or Bearer


### `DELETE /api/v1/listen/sessions/{id}`

**End a session (the brief, citations and stats are kept)**

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `id` | path | string | yes |  |

Responses:

- `200` Session ended — `application/json` [ListenSession](#listensession)
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: ApiKey or Bearer


### `POST /api/v1/listen/sessions/{id}/transcript`

**Append conversation to a session** — Accepts final or interim chunks from any transcription source. The server throttles and de-duplicates refreshes (a rolling window of the last words, a minimum gap, and a similarity check), so a chatty client cannot turn every word into an LLM call. The response says what the throttle decided.

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `id` | path | string | yes |  |

Request body (`application/json`): object

| Field | Type | Required | Description |
|---|---|---|---|
| `chunks` | array of [TranscriptChunk](#transcriptchunk) | yes |  |

Responses:

- `202` Accepted — `application/json` object
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `409` The session has ended — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: ApiKey or Bearer


### `POST /api/v1/listen/sessions/{id}/refresh`

**Ask for one more brief refresh now** — The deliberate retry behind a stale brief. Without it the only way to provoke a refresh is to append transcript, which would fabricate conversation that was never said. The throttle's minimum gap still applies, and a refresh that finds nothing leaves the previous brief exactly where it is.

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `id` | path | string | yes |  |

Responses:

- `200` The session after the refresh — `application/json` [ListenSession](#listensession)
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `409` The session has ended — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: ApiKey or Bearer


### `GET /api/v1/listen/sessions/{id}/events`

**Server-sent events for a session (event: brief | transcript | status)**

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `id` | path | string | yes |  |

Responses:

- `200` text/event-stream — `text/event-stream` string
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: ApiKey or Bearer


### `GET /api/v1/listen/sessions/{id}/brief-history`

**Every version of this conversation's brief** — The brief is rebuilt as the call moves, and the interesting question in review is not what it ended as but when it changed its mind. Each snapshot carries the version, the instant and the whole brief, so two versions can be compared field by field.

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `id` | path | string | yes |  |

Responses:

- `200` OK — `application/json` object
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: ApiKey or Bearer

## voice

### `POST /api/v1/voice-answer`

**Answer one voice turn** — Runs the turn pipeline for a prospect and returns a spoken answer, citations and a handoff flag. Never throws at the caller: upstream failures degrade to the prospect's handoff line so the agent never gets dead air.

Request body (`application/json`): [VoiceAnswerRequest](#voiceanswerrequest)


Responses:

- `200` The spoken turn — `application/json` [VoiceAnswerResponse](#voiceanswerresponse)
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: ApiKey or Bearer


### `POST /v1/voice-answer`

**Answer one voice turn (compatibility alias)** — Identical to `POST /api/v1/voice-answer`. Kept so ElevenLabs agents configured against the original bridge URL keep working; new integrations should use the versioned path.

Request body (`application/json`): [VoiceAnswerRequest](#voiceanswerrequest)


Responses:

- `200` The spoken turn — `application/json` [VoiceAnswerResponse](#voiceanswerresponse)
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: ApiKey or Bearer


### `POST /api/v1/brief`

**Refresh the structured live brief** — Listen mode: given the most recent words heard, the running transcript and the previous brief, returns an updated structured brief grounded in the Knowledge Box. Rate-limited more strictly than /voice-answer because it fires continuously while listening.

Request body (`application/json`): [BriefRequest](#briefrequest)


Responses:

- `200` OK — `application/json` [BriefResponse](#briefresponse)
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: ApiKey or Bearer

## prospects

### `GET /api/v1/prospects`

**List prospects (non-secret projection)**

Responses:

- `200` OK — `application/json` object
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: ApiKey or Bearer


### `GET /api/v1/prospects/{key}`

**Get one prospect (non-secret projection)**

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `key` | path | string | yes |  |

Responses:

- `200` OK — `application/json` [Prospect](#prospect)
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: ApiKey or Bearer


### `GET /api/v1/models`

**Generative models available for a prospect's Knowledge Box**

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `prospect` | query | string | yes |  |

Responses:

- `200` OK — `application/json` object
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: ApiKey or Bearer


### `GET /api/v1/voices`

**ElevenLabs voices available to the deployment** — 503 when `ELEVENLABS_API_KEY` is not configured; the demo then uses the agent default.

Responses:

- `200` OK — `application/json` object
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)
- `503` ElevenLabs is not configured — `application/problem+json` [Problem](#problem)

Auth: ApiKey or Bearer

## realtime

### `POST /api/v1/speech`

**Speak a line of the brief aloud (ElevenLabs text-to-speech)** — The optional spoken brief: Live can read the grounded brief, or the single line the handler could say next, into their own ear. Nothing is ever injected into the call — this returns audio to the browser that asked for it, and it is off by default.

Synthesis happens server-side so the ElevenLabs key never reaches a browser. Returns 503 when the deployment has no key, which is how the toggle knows to stay hidden.

Request body (`application/json`): object

| Field | Type | Required | Description |
|---|---|---|---|
| `text` | string | yes |  |
| `voice_id` | string |  | Overrides the configured voice |
| `prospect` | string |  | Use this prospect's configured voice |

Responses:

- `200` The spoken line — `audio/mpeg` string
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)
- `503` ElevenLabs is not configured on this deployment; the toggle stays hidden — `application/problem+json` [Problem](#problem)

Auth: ApiKey or Bearer


### `GET /api/v1/voice-agent`

**The ElevenLabs agent configuration for a prospect** — VoiceBridge is not a voice platform. The agent lives in ElevenLabs Conversational AI and calls `POST /api/v1/voice-answer` as a custom server tool, so every spoken answer still comes from the Knowledge Box. This returns exactly what has to be pasted into the ElevenLabs dashboard — tool definition and router prompt — derived from the registry.

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `prospect` | query | string | yes |  |

Responses:

- `200` OK — `application/json` [VoiceAgentConfig](#voiceagentconfig)
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: ApiKey or Bearer


### `POST /api/v1/scribe-token`

**Mint a single-use ElevenLabs Scribe realtime token** — Requires a same-origin session (`POST /api/v1/session`), an API key or the admin token, and is rate-limited separately: the token spends ElevenLabs quota. The browser never holds the ElevenLabs API key.

Responses:

- `200` OK — `application/json` object
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)
- `503` ElevenLabs is not configured — `application/problem+json` [Problem](#problem)

Auth: ApiKey or Bearer

## quality

### `GET /api/v1/metrics`

**Turn metrics over the recent window**

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `prospect` | query | string |  |  |

Responses:

- `200` OK — `application/json` [Metrics](#metrics)
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: ApiKey or Bearer


### `GET /api/v1/turns`

**The turn log behind the Quality view** — Recent turns, newest first, filterable by outcome so an operator can go straight to the turns that handed off or tripped a safety guard. Question text is stored only for turns that passed the input guard: a guard trip records the reason and nothing else.

Never anonymous, even when `API_KEYS` is unset: a same-origin session (`POST /api/v1/session`, which the workspace calls at boot), an API key or the admin token is required, because the questions people asked are not public.

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `prospect` | query | string |  |  |
| `outcome` | query | string |  |  |
| `source` | query | string |  |  |
| `reason` | query | string |  |  |
| `limit` | query | integer |  |  |
| `offset` | query | integer |  |  |

Responses:

- `200` OK — `application/json` object
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: ApiKey or Bearer


### `GET /api/v1/knowledge`

**What a prospect is grounded in, and whether its golden gate is open** — Backs the Knowledge view: the Knowledge Box a prospect answers from (id partially masked — the full id is admin-only), its connectivity, the models in play, the golden set, and the most recent golden run.

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `prospect` | query | string | yes |  |

Responses:

- `200` OK — `application/json` [KnowledgeStatus](#knowledgestatus)
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: ApiKey or Bearer


### `GET /api/v1/golden-evals`

**Golden-run history**

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `prospect` | query | string |  |  |
| `limit` | query | integer |  |  |
| `offset` | query | integer |  |  |

Responses:

- `200` OK — `application/json` object
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: ApiKey or Bearer


### `POST /api/v1/golden-evals`

**Run a prospect's golden set (async job)** — Runs every golden question through the in-process pipeline and stores the result. Returns 202 with a job; poll `/api/v1/jobs/{id}` or stream `/api/v1/jobs/{id}/events`.

Request body (`application/json`): object

| Field | Type | Required | Description |
|---|---|---|---|
| `prospect` | string | yes |  |

Responses:

- `202` Accepted — `application/json` object
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: ApiKey or Bearer


### `GET /api/v1/golden-evals/{id}`

**Get a golden-set result** — The id is either the evaluation id or the id of the job that produced it.

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `id` | path | string | yes |  |

Responses:

- `200` OK — `application/json` [GoldenEval](#goldeneval)
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: ApiKey or Bearer

## system

### `GET /api/v1/integrations`

**Which optional integrations this deployment has configured** — Booleans and non-secret detail only — never a credential. Backs the Settings view so a partner can see at a glance why the microphone or the spoken brief is unavailable.

Responses:

- `200` OK — `application/json` object
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: ApiKey or Bearer


### `GET /api/v1/branding`

**White-label branding for this deployment** — Public: the console and the admin panel apply it at boot (name, logo, colours, footer, and whether the Progress credit is shown). Partners set `BRAND_*` in the environment; per-prospect overrides are returned with each prospect.

Responses:

- `200` OK — `application/json` [Branding](#branding)
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: public


### `POST /api/v1/session`

**Issue a same-origin session cookie for the demo UI**

Responses:

- `200` OK — `application/json` object
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: public


### `GET /api/v1/setup`

**First-run checklist for this deployment** — What the onboarding wizard renders: each step with whether this deployment has already done it, checked against the live configuration rather than a stored 'dismissed' flag.

Responses:

- `200` OK — `application/json` object
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: ApiKey or Bearer

## jobs

### `GET /api/v1/jobs`

**List jobs**

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `status` | query | string |  |  |
| `limit` | query | integer |  |  |

Responses:

- `200` OK — `application/json` object
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: ApiKey or Bearer


### `GET /api/v1/jobs/{id}`

**Get a job**

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `id` | path | string | yes |  |

Responses:

- `200` OK — `application/json` [Job](#job)
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: ApiKey or Bearer


### `DELETE /api/v1/jobs/{id}`

**Cancel a job**

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `id` | path | string | yes |  |

Responses:

- `204` Cancelled
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: ApiKey or Bearer


### `GET /api/v1/jobs/{id}/events`

**Server-sent events for a job (event: event|job)**

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `id` | path | string | yes |  |

Responses:

- `200` text/event-stream — `text/event-stream` string
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: ApiKey or Bearer

## admin

### `POST /api/v1/admin/login`

**Exchange the admin token for an HttpOnly cookie**

Request body (`application/json`): object

| Field | Type | Required | Description |
|---|---|---|---|
| `token` | string | yes |  |

Responses:

- `200` OK — `application/json` object
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: public


### `GET /api/v1/admin/health`

**Service health plus a per-prospect Knowledge Box connection test**

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `prospect` | query | string |  |  |

Responses:

- `200` OK — `application/json` object
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: AdminToken


### `GET /api/v1/admin/config`

**Effective configuration (secrets redacted)**

Responses:

- `200` OK — `application/json` object
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: AdminToken


### `GET /api/v1/admin/usage`

**Usage counters (requests, ARAG calls, jobs, turns)**

Responses:

- `200` OK — `application/json` object
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: AdminToken


### `GET /api/v1/admin/logs`

**Recent log records, filtered and paged**

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `level` | query | string |  |  |
| `contains` | query | string |  |  |
| `limit` | query | integer |  |  |
| `offset` | query | integer |  | Records to skip, newest first — the log page's pager |

Responses:

- `200` OK — `application/json` object
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: AdminToken


### `GET /api/v1/admin/prospects`

**List registry entries in full**

Responses:

- `200` OK — `application/json` object
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: AdminToken


### `POST /api/v1/admin/prospects`

**Create a prospect**

Request body (`application/json`): [ProspectCreate](#prospectcreate)


Responses:

- `201` Created — `application/json` [ProspectRecord](#prospectrecord)
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `409` Key already exists — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: AdminToken


### `GET /api/v1/admin/prospects/{key}`

**Get a registry entry in full**

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `key` | path | string | yes |  |

Responses:

- `200` OK — `application/json` [ProspectRecord](#prospectrecord)
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: AdminToken


### `PUT /api/v1/admin/prospects/{key}`

**Replace a registry entry**

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `key` | path | string | yes |  |

Request body (`application/json`): [ProspectInput](#prospectinput)


Responses:

- `200` OK — `application/json` [ProspectRecord](#prospectrecord)
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: AdminToken


### `DELETE /api/v1/admin/prospects/{key}`

**Delete a registry entry**

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `key` | path | string | yes |  |

Responses:

- `204` Deleted
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: AdminToken


### `POST /api/v1/admin/prospects/{key}/provision`

**Create or update the prospect's stored ARAG search configuration** — Idempotent. Writes the voice prompt, retrieval governance and latency levers into the Knowledge Box as a stored `ask` search configuration, then points the registry entry at it.

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `key` | path | string | yes |  |

Request body (`application/json`): object

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string |  |  |
| `reranker` | string (`noop`, `predict`) |  |  |
| `generative_model` | string |  |  |
| `dry_run` | boolean |  |  |

Responses:

- `200` OK — `application/json` object
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: AdminToken


### `GET /api/v1/admin/listen-sessions`

**Recent listen sessions with brief history and latency**

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `prospect` | query | string |  |  |
| `limit` | query | integer |  |  |

Responses:

- `200` OK — `application/json` object
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: AdminToken


### `GET /api/v1/admin/settings`

**Every editable setting, with its effective value and where it came from**

Responses:

- `200` OK — `application/json` [SettingsDocument](#settingsdocument)
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: AdminToken


### `PATCH /api/v1/admin/settings`

**Change settings; they take effect immediately** — The store is the authority and the environment is only the default, so a change here survives a restart and needs none. A change that would make every turn dead air (a voice turn budget at or above the agent tool timeout) is rejected and rolled back.

Request body (`application/json`): [SettingsPatch](#settingspatch)


Responses:

- `200` OK — `application/json` [SettingsDocument](#settingsdocument)
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: AdminToken


### `POST /api/v1/admin/settings/reset`

**Drop stored overrides and fall back to the environment**

Request body (`application/json`): object

| Field | Type | Required | Description |
|---|---|---|---|
| `group` | string (`branding`, `connection`, `limits`, `elevenlabs`, `retention`) |  | Omit to reset every group |

Responses:

- `200` OK — `application/json` [SettingsDocument](#settingsdocument)
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: AdminToken


### `POST /api/v1/admin/settings/logo`

**Upload a partner logo and point branding at it** — Stores the file under DATA_DIR/branding/ (served at /branding/) and sets the branding logo URL to it. SVG, PNG, JPEG, WebP and GIF only, 1 MB max.

Request body (`multipart/form-data`): object

| Field | Type | Required | Description |
|---|---|---|---|
| `file` | string | yes |  |

Responses:

- `200` OK — `application/json` object
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: AdminToken


### `DELETE /api/v1/admin/settings/logo`

**Remove the uploaded logo and fall back to the wordmark**

Responses:

- `204` Removed
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: AdminToken


### `GET /api/v1/admin/api-keys`

**The API key store** — `API_KEYS` seeds this store on first boot and then stops being the authority: keys created or revoked here take effect on the next request.

Responses:

- `200` OK — `application/json` object
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: AdminToken


### `POST /api/v1/admin/api-keys`

**Mint an API key** — The secret is in this response and nowhere else, ever again.

Request body (`application/json`): object

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes |  |

Responses:

- `201` Key created — `application/json` object
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: AdminToken


### `PATCH /api/v1/admin/api-keys/{id}`

**Rename a key**

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `id` | path | string | yes |  |

Request body (`application/json`): object

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes |  |

Responses:

- `200` OK — `application/json` [ApiKey](#apikey)
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: AdminToken


### `DELETE /api/v1/admin/api-keys/{id}`

**Revoke a key** — The record stays, marked revoked — a revoked key that vanished would take its own audit trail with it — but it stops authenticating immediately.

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `id` | path | string | yes |  |

Responses:

- `200` OK — `application/json` [ApiKey](#apikey)
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: AdminToken


### `GET /api/v1/admin/voice-agent`

**Compare this prospect's desired agent with what ElevenLabs has**

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `prospect` | query | string | yes |  |

Responses:

- `200` OK — `application/json` object
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: AdminToken


### `POST /api/v1/admin/voice-agent/push`

**Write this prospect's agent configuration to ElevenLabs** — Creates or patches the custom server tool (URL, X-API-Key header, timeout, body schema), then the agent (router prompt, greeting, voice, tool link). Everything is merged into what the remote already has, so configuration this product does not own is left alone.

Request body (`application/json`): object

| Field | Type | Required | Description |
|---|---|---|---|
| `prospect` | string | yes |  |
| `api_key_id` | string |  | Which stored key the tool's X-API-Key header carries; omit to reuse or pick one |

Responses:

- `200` OK — `application/json` object
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: AdminToken


### `DELETE /api/v1/admin/listen-sessions/{id}`

**Delete a conversation and everything recorded with it** — The transcript, the brief history and the citations go with it. Open subscribers are told the session ended before the record is removed.

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `id` | path | string | yes |  |

Responses:

- `204` Deleted
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: AdminToken


### `POST /api/v1/admin/purge`

**Apply the retention windows, or delete a class of records now**

Request body (`application/json`): object

| Field | Type | Required | Description |
|---|---|---|---|
| `scope` | string (`retention`, `turns`, `sessions`, `evals`, `all`) |  | `retention` applies the configured windows; the rest delete regardless of age |

Responses:

- `200` OK — `application/json` [PurgeResult](#purgeresult)
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)

Auth: AdminToken

## Schemas

### Problem

RFC 9457 problem details

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | string | yes |  |
| `title` | string | yes |  |
| `status` | integer | yes |  |
| `detail` | string |  |  |
| `instance` | string |  |  |
| `requestId` | string |  |  |
| `errors` | array of object |  |  |

### Health

| Field | Type | Required | Description |
|---|---|---|---|
| `ok` | boolean | yes |  |
| `version` | string |  |  |
| `arag` | object |  |  |
| `uptimeSec` | number |  |  |

### Job

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes |  |
| `kind` | string | yes |  |
| `status` | string (`queued`, `running`, `succeeded`, `failed`, `cancelled`) | yes |  |
| `progress` | number | yes |  |
| `stage` | string |  |  |
| `message` | string |  |  |
| `input` | object |  |  |
| `result` | object |  |  |
| `error` | object |  |  |
| `events` | array of [JobEvent](#jobevent) |  |  |
| `createdAt` | string | yes |  |
| `updatedAt` | string | yes |  |
| `finishedAt` | string |  |  |
| `durationsMs` | object |  |  |

### JobEvent

| Field | Type | Required | Description |
|---|---|---|---|
| `ts` | string | yes |  |
| `stage` | string | yes |  |
| `status` | string (`start`, `progress`, `ok`, `error`, `skip`) | yes |  |
| `message` | string |  |  |
| `ms` | number |  |  |
| `data` | object |  |  |

### LogRecord

| Field | Type | Required | Description |
|---|---|---|---|
| `ts` | string | yes |  |
| `level` | string | yes |  |
| `msg` | string | yes |  |

### Branding

| Field | Type | Required | Description |
|---|---|---|---|
| `productName` | string | yes |  |
| `tagline` | string |  |  |
| `logoUrl` | string |  |  |
| `primaryColor` | string |  |  |
| `accentColor` | string |  |  |
| `poweredBy` | boolean | yes |  |
| `footerText` | string |  |  |
| `docsUrl` | string |  |  |
| `supportUrl` | string |  |  |

### Citation

| Field | Type | Required | Description |
|---|---|---|---|
| `title` | string | yes | Source document title (shown as a chip, never spoken) |
| `url` | string | yes | Source URL when the resource carries one |
| `score` | number | yes | Best paragraph score for the source |

### TranscriptEntry

| Field | Type | Required | Description |
|---|---|---|---|
| `speaker` | string | yes | Free-form label: caller, agent, a diarisation id… |
| `text` | string | yes |  |
| `ts` | string | yes |  |
| `final` | boolean | yes | False for interim STT hypotheses |

### TranscriptChunk

| Field | Type | Required | Description |
|---|---|---|---|
| `speaker` | string |  |  |
| `text` | string | yes |  |
| `ts` | string |  |  |
| `final` | boolean |  | Set false for an interim hypothesis |

### ListenStats

| Field | Type | Required | Description |
|---|---|---|---|
| `chunks` | integer | yes |  |
| `words` | integer | yes |  |
| `refreshes` | integer | yes | Brief refreshes that produced something usable |
| `skipped` | integer | yes | Refreshes the throttle deliberately skipped |
| `failures` | integer | yes |  |
| `lastLatencyMs` | integer |  |  |
| `p50LatencyMs` | integer |  |  |
| `p95LatencyMs` | integer |  |  |

### ListenSession

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes |  |
| `createdAt` | string |  |  |
| `updatedAt` | string |  |  |
| `prospect` | string | yes |  |
| `locale` | string |  |  |
| `generative_model` | string |  |  |
| `metadata` | object |  |  |
| `status` | string (`live`, `ended`) | yes |  |
| `endedAt` | string |  |  |
| `brief` | object,null | yes | The evolving brief — same shape as POST /api/v1/brief returns |
| `briefVersion` | integer | yes | Increments on every usable refresh |
| `citations` | array of [Citation](#citation) | yes |  |
| `stats` | [ListenStats](#listenstats) | yes |  |
| `transcript` | array of [TranscriptEntry](#transcriptentry) |  |  |
| `transcriptTotal` | integer |  |  |

### BriefSnapshot

| Field | Type | Required | Description |
|---|---|---|---|
| `version` | integer | yes |  |
| `at` | string | yes |  |
| `brief` | object,null | yes |  |
| `latencyMs` | integer |  |  |

### ListenSessionExport

The complete record of one call: every brief version, the whole transcript, sources

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes |  |
| `createdAt` | string |  |  |
| `updatedAt` | string |  |  |
| `endedAt` | string |  |  |
| `prospect` | string | yes |  |
| `locale` | string |  |  |
| `generative_model` | string |  |  |
| `metadata` | object |  |  |
| `status` | string (`live`, `ended`) | yes |  |
| `durationSec` | integer |  |  |
| `brief` | object,null | yes |  |
| `briefVersion` | integer |  |  |
| `briefHistory` | array of [BriefSnapshot](#briefsnapshot) | yes |  |
| `citations` | array of [Citation](#citation) | yes |  |
| `stats` | [ListenStats](#listenstats) | yes |  |
| `transcript` | array of [TranscriptEntry](#transcriptentry) | yes |  |

### KnowledgeStatus

What the selected prospect is grounded in, and whether its golden gate is open

| Field | Type | Required | Description |
|---|---|---|---|
| `prospect` | string | yes |  |
| `display_name` | string | yes |  |
| `kb` | object | yes |  |
| `golden_questions` | array of [GoldenQuestion](#goldenquestion) | yes |  |
| `last_eval` | object |  | The most recent golden run for this prospect, or null when it has never run |

### IntegrationStatus

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string (`arag`, `elevenlabs`) | yes |  |
| `name` | string | yes |  |
| `configured` | boolean | yes |  |
| `primary` | boolean |  | True for the integrations the out-of-the-box experience is built on |
| `purpose` | string | yes | What this integration unlocks in the product |
| `detail` | string |  | Non-secret endpoint or mode, never a credential |
| `setup` | string |  | The environment variables that switch it on |
| `capabilities` | array of object |  | What this deployment actually uses the integration for |
| `config` | object |  | Non-secret settings in force (models, endpoints, ids) — never a credential |

### VoiceAgentTool

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes |  |
| `method` | string | yes |  |
| `url` | string | yes |  |
| `timeoutMs` | integer | yes | Must exceed VOICE_TURN_TIMEOUT_MS |
| `headerNames` | array of string |  | Header names the tool sends. Values (the API key) are never returned. |
| `bodySchema` | object | yes |  |

### VoiceAgentConfig

Everything needed to wire an ElevenLabs Conversational AI agent to this deployment: the custom server tool it calls, and the router prompt that keeps it from answering by itself.

| Field | Type | Required | Description |
|---|---|---|---|
| `prospect` | string | yes |  |
| `display_name` | string | yes |  |
| `provider` | string (`elevenlabs`) | yes |  |
| `agent_id` | string,null |  | Non-secret agent id, null when unwired |
| `tool_id` | string,null |  | The custom server tool's id in ElevenLabs |
| `ready` | boolean |  | An agent id is set and is not the example placeholder |
| `configured` | boolean |  | This deployment holds an ElevenLabs key |
| `voice_id` | string,null |  |  |
| `greeting` | string |  |  |
| `handoff_msg` | string |  |  |
| `tool` | [VoiceAgentTool](#voiceagenttool) | yes |  |
| `system_prompt` | string | yes |  |
| `system_prompt_custom` | boolean |  | The prompt is this prospect's own text rather than the generated default |
| `api_key` | object,null |  | Which stored API key the tool's X-API-Key header carries — never the secret |
| `docs_url` | string |  |  |

### PipelineStep

One step of the nine-step turn pipeline, as run for this question

| Field | Type | Required | Description |
|---|---|---|---|
| `step` | integer | yes |  |
| `id` | string | yes | Stable step id (resolve, guard-input, ask, handoff, …) |
| `label` | string | yes |  |
| `status` | string (`ok`, `skipped`, `tripped`, `handoff`, `error`) | yes |  |
| `ms` | integer | yes | ms from the start of the turn to the end of this step |
| `detail` | string |  | What happened, in one line |

### SettingsField

One editable setting. `value` carries the effective value; a secret carries `set` and a `hint` instead, because a secret is written once and then rotated, never displayed.

| Field | Type | Required | Description |
|---|---|---|---|
| `key` | string | yes |  |
| `group` | string (`branding`, `connection`, `limits`, `elevenlabs`, `retention`) | yes |  |
| `label` | string | yes |  |
| `type` | string (`string`, `text`, `number`, `boolean`, `color`, `secret`, `enum`) | yes |  |
| `env` | string | yes | The environment variable that supplies the default |
| `help` | string | yes |  |
| `options` | array of string |  |  |
| `min` | number |  |  |
| `max` | number |  |  |
| `placeholder` | string |  |  |
| `value` | object |  | Effective value (absent for secrets) |
| `envValue` | object |  | The boot-time default, so the UI can offer 'reset to environment' |
| `set` | boolean |  | Secrets only: is one configured |
| `hint` | string |  | Secrets only: enough to recognise the value, no more |
| `source` | string (`stored`, `env`, `default`) | yes | Where the effective value came from |

### SettingsGroup

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes |  |
| `title` | string | yes |  |
| `description` | string | yes |  |
| `fields` | array of [SettingsField](#settingsfield) | yes |  |

### SettingsDocument

| Field | Type | Required | Description |
|---|---|---|---|
| `groups` | array of [SettingsGroup](#settingsgroup) | yes |  |

### SettingsPatch

Partial update, keyed by group then field. `null` resets a field to its environment default. Unknown groups and fields are rejected rather than ignored.

| Field | Type | Required | Description |
|---|---|---|---|
| `branding` | object |  |  |
| `connection` | object |  |  |
| `limits` | object |  |  |
| `elevenlabs` | object |  |  |
| `retention` | object |  |  |

### ApiKey

A stored API key. The secret is returned exactly once, when the key is created.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes |  |
| `name` | string | yes |  |
| `prefix` | string | yes | Leading characters, enough to recognise the key |
| `origin` | string (`env`, `store`) | yes | Seeded from API_KEYS, or minted here |
| `createdAt` | string | yes |  |
| `lastUsedAt` | string,null |  |  |
| `uses` | integer | yes | Recorded uses (sampled at most every 30 s per key) |
| `revoked` | boolean | yes |  |
| `revokedAt` | string,null |  |  |

### AgentDiffRow

| Field | Type | Required | Description |
|---|---|---|---|
| `field` | string | yes |  |
| `label` | string | yes |  |
| `local` | string | yes | What this deployment wants |
| `remote` | string | yes | What ElevenLabs currently has |
| `matches` | boolean | yes |  |

### RemoteAgentState

The agent and tool as ElevenLabs currently holds them, reduced to the fields this product owns

| Field | Type | Required | Description |
|---|---|---|---|
| `agent` | object | yes |  |
| `tool` | object | yes |  |

### PurgeResult

| Field | Type | Required | Description |
|---|---|---|---|
| `turns` | integer | yes |  |
| `sessions` | integer | yes |  |
| `evals` | integer | yes |  |
| `at` | string | yes |  |
| `windows` | object | yes |  |

### SetupStep

One step of the first-run wizard, with whether this deployment has done it

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes |  |
| `title` | string | yes |  |
| `body` | string | yes |  |
| `done` | boolean | yes |  |
| `optional` | boolean | yes | The product works without this step |
| `detail` | string |  | What the product found when it checked |
| `href` | string |  | Where to go to do it |
| `action` | string |  | Label for the link |

### LatencyMs

| Field | Type | Required | Description |
|---|---|---|---|
| `retrieve` | integer | yes | ms until ARAG returned retrieval results |
| `first_token` | integer | yes | ms until the first answer token |
| `total` | integer | yes | ms for the whole turn, end to end |

### HistoryTurn

| Field | Type | Required | Description |
|---|---|---|---|
| `author` | string (`USER`, `NUCLIA`) | yes |  |
| `text` | string | yes |  |

### VoiceAnswerRequest

| Field | Type | Required | Description |
|---|---|---|---|
| `prospect` | string | yes | Registry key |
| `question` | string | yes | The caller's question |
| `conversation_id` | string |  |  |
| `history` | array of [HistoryTurn](#historyturn) |  |  |
| `generative_model` | string |  | Per-request model override |
| `trace` | boolean |  | Return the per-step pipeline trace alongside the answer. The Ask tester sets this; a voice agent never should (it adds bytes to every turn). |

### VoiceAnswerResponse

| Field | Type | Required | Description |
|---|---|---|---|
| `answer` | string | yes | The spoken line — voice-shaped, ≤3 sentences, no markup |
| `citations` | array of [Citation](#citation) | yes |  |
| `handoff` | boolean | yes | True when the turn must escalate to a human |
| `latency_ms` | [LatencyMs](#latencyms) | yes |  |
| `pipeline` | array of [PipelineStep](#pipelinestep) |  | Present only when the request asked to trace |
| `handoff_reason` | string (`sentinel`, `not-found-phrase`, `empty-answer`, `no-retrieval`, `upstream-error`, `empty-question`, `question-too-long`, `prompt-injection`, `unsafe-request`, `empty-output`, `unspeakable-content`) |  | Why the turn handed off or deflected (never spoken) |

### BriefRequest

| Field | Type | Required | Description |
|---|---|---|---|
| `prospect` | string | yes |  |
| `text` | string | yes | Most recent words heard |
| `transcript` | string |  | Conversation so far (most recent last) |
| `prev` | object |  | Previous brief, to refine not restart |
| `generative_model` | string |  |  |

### BriefResponse

| Field | Type | Required | Description |
|---|---|---|---|
| `brief` | object,null | yes | The structured brief (null when nothing relevant was found in time) |
| `citations` | array of [Citation](#citation) | yes |  |
| `latency_ms` | [LatencyMs](#latencyms) | yes |  |

### GoldenQuestion

| Field | Type | Required | Description |
|---|---|---|---|
| `q` | string | yes |  |
| `expect` | string (`answer`, `handoff`) | yes |  |
| `must_include` | array of string |  |  |

### Prospect

Non-secret projection of a registry entry (safe for browsers)

| Field | Type | Required | Description |
|---|---|---|---|
| `key` | string | yes |  |
| `display_name` | string | yes |  |
| `locale` | string | yes |  |
| `greeting` | string | yes |  |
| `handoff_msg` | string | yes |  |
| `agent_id` | string,null |  | ElevenLabs agent id (non-secret) |
| `voice_id` | string,null |  |  |
| `golden_questions` | array of [GoldenQuestion](#goldenquestion) |  |  |
| `scribe_ready` | boolean |  |  |
| `brand` | [Branding](#branding) |  | Deployment branding with this prospect's overrides applied |

### ProspectInput

Full prospect configuration (admin only — contains KB ids)

| Field | Type | Required | Description |
|---|---|---|---|
| `display_name` | string | yes |  |
| `kb_id` | string |  | ARAG Knowledge Box id. Empty = the deployment default (Settings → Connection). |
| `region` | string | yes | ARAG zone slug |
| `ask_config` | string |  | Stored ask search configuration name |
| `reranker` | string (`noop`, `predict`) |  |  |
| `max_tokens` | integer |  |  |
| `generative_model` | string |  |  |
| `temperature` | number |  |  |
| `brief_model` | string |  |  |
| `brand` | object |  | White-label overrides for this prospect, layered on the deployment's branding |
| `agent_id` | string |  |  |
| `voice_id` | string |  |  |
| `tool_id` | string |  | ElevenLabs custom server tool id |
| `system_prompt` | string |  | Router prompt override; empty uses the generated default |
| `agent_api_key_id` | string |  | Which stored API key the pushed tool's X-API-Key header carries |
| `locale` | string | yes |  |
| `greeting` | string | yes |  |
| `handoff_msg` | string | yes |  |
| `golden_questions` | array of [GoldenQuestion](#goldenquestion) |  |  |

### ProspectRecord

A stored registry entry (admin only)

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Registry key |
| `createdAt` | string |  |  |
| `updatedAt` | string |  |  |
| `display_name` | string | yes |  |
| `kb_id` | string |  | ARAG Knowledge Box id. Empty = the deployment default (Settings → Connection). |
| `region` | string | yes | ARAG zone slug |
| `ask_config` | string |  | Stored ask search configuration name |
| `reranker` | string (`noop`, `predict`) |  |  |
| `max_tokens` | integer |  |  |
| `generative_model` | string |  |  |
| `temperature` | number |  |  |
| `brief_model` | string |  |  |
| `brand` | object |  | White-label overrides for this prospect, layered on the deployment's branding |
| `agent_id` | string |  |  |
| `voice_id` | string |  |  |
| `tool_id` | string |  | ElevenLabs custom server tool id |
| `system_prompt` | string |  | Router prompt override; empty uses the generated default |
| `agent_api_key_id` | string |  | Which stored API key the pushed tool's X-API-Key header carries |
| `locale` | string | yes |  |
| `greeting` | string | yes |  |
| `handoff_msg` | string | yes |  |
| `golden_questions` | array of [GoldenQuestion](#goldenquestion) |  |  |

### ProspectCreate

| Field | Type | Required | Description |
|---|---|---|---|
| `key` | string | yes |  |
| `config` | [ProspectInput](#prospectinput) | yes |  |

### ModelOption

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes |  |
| `label` | string | yes |  |
| `speed` | integer | yes |  |
| `quality` | integer | yes |  |
| `price` | integer | yes |  |

### Metrics

| Field | Type | Required | Description |
|---|---|---|---|
| `turns` | integer | yes |  |
| `latency_total_ms` | object | yes |  |
| `latency_first_token_ms` | object | yes |  |
| `handoff_rate` | number | yes |  |
| `citation_coverage` | number |  |  |
| `guard_trip_rate` | number |  |  |
| `by_prospect` | object |  |  |

### TurnRecord

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes |  |
| `createdAt` | string | yes |  |
| `prospect` | string | yes |  |
| `conversation_id` | string |  |  |
| `question` | string |  | Omitted when a safety guard tripped |
| `total` | integer | yes |  |
| `first_token` | integer |  |  |
| `retrieve` | integer |  |  |
| `citations` | integer |  |  |
| `handoff` | boolean | yes |  |
| `guard_trip` | boolean |  |  |
| `reason` | string |  |  |
| `source` | string (`voice-answer`, `golden-eval`) |  |  |

### GoldenCase

| Field | Type | Required | Description |
|---|---|---|---|
| `q` | string | yes |  |
| `expect` | string (`answer`, `handoff`) | yes |  |
| `answer` | string | yes |  |
| `handoff` | boolean | yes |  |
| `handoff_reason` | string |  |  |
| `citations` | integer |  |  |
| `latency_ms` | integer |  |  |
| `passed` | boolean | yes |  |
| `checks` | array of object | yes |  |

### GoldenEval

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes |  |
| `createdAt` | string |  |  |
| `prospect` | string | yes |  |
| `display_name` | string |  |  |
| `ok` | boolean | yes |  |
| `total` | integer | yes |  |
| `passed` | integer | yes |  |
| `failed` | integer | yes |  |
| `latency_ms` | object |  |  |
| `cases` | array of [GoldenCase](#goldencase) | yes |  |
| `startedAt` | string |  |  |
| `finishedAt` | string |  |  |

### GoldenEvalSummary

A golden run without the per-question detail (fetch it by id to see the cases)

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes |  |
| `createdAt` | string |  |  |
| `prospect` | string | yes |  |
| `display_name` | string |  |  |
| `ok` | boolean | yes |  |
| `total` | integer | yes |  |
| `passed` | integer | yes |  |
| `failed` | integer | yes |  |
| `latency_ms` | object |  |  |
| `startedAt` | string |  |  |
| `finishedAt` | string |  |  |

