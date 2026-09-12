# API reference — VoiceBridge API v0.1.0

Grounded, cited and governed voice answers over Progress Agentic RAG (ARAG).

`POST /api/v1/voice-answer` is the endpoint a voice agent's custom tool calls: it runs the nine-step turn pipeline (safety guards → ARAG ask → deterministic handoff → voice shaping → citations) and always returns something speakable within the agent's tool timeout.

`POST /api/v1/brief` powers the ambient copilot: a structured, evolving brief built with ARAG's `answer_json_schema`.

Authentication: public routes are open unless `API_KEYS` is set (then `X-API-Key` or a same-origin session from `POST /api/v1/session`); `/api/v1/admin/*` always requires `ADMIN_TOKEN`.

Generated from `openapi.json` — do not edit by hand. Interactive docs: `/api/v1/docs` (Redoc) and `/api/v1/swagger` (try it out).

## Authentication

- **ApiKey** — apiKey header X-API-Key: Required only when API_KEYS is configured.
- **Bearer** — http bearer : API key or admin token as a bearer token.
- **AdminToken** — http bearer : ADMIN_TOKEN; required for /admin routes.

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


### `POST /api/v1/avatar/sessions`

**Start a LiveAvatar session in a bridge-owned LiveKit room**

Request body (`application/json`): object

| Field | Type | Required | Description |
|---|---|---|---|
| `prospect` | string | yes |  |

Responses:

- `201` Session started — `application/json` object
- `400` Validation failed — `application/problem+json` [Problem](#problem)
- `401` Authentication required — `application/problem+json` [Problem](#problem)
- `403` Forbidden — `application/problem+json` [Problem](#problem)
- `404` Not found — `application/problem+json` [Problem](#problem)
- `429` Rate limited — `application/problem+json` [Problem](#problem)
- `502` Upstream (ARAG) error — `application/problem+json` [Problem](#problem)
- `503` LiveAvatar/LiveKit are not configured — `application/problem+json` [Problem](#problem)

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

## system

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

**Recent log records**

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `level` | query | string |  |  |
| `contains` | query | string |  |  |
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


### `GET /api/v1/admin/turns`

**Recent turn log (latency, handoff reason, guard trips)** — The question text is omitted for turns where a safety guard tripped.

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


### `GET /api/v1/admin/golden-evals`

**Golden-set evaluation history**

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

### Citation

| Field | Type | Required | Description |
|---|---|---|---|
| `title` | string | yes | Source document title (shown as a chip, never spoken) |
| `url` | string | yes | Source URL when the resource carries one |
| `score` | number | yes | Best paragraph score for the source |

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

### VoiceAnswerResponse

| Field | Type | Required | Description |
|---|---|---|---|
| `answer` | string | yes | The spoken line — voice-shaped, ≤3 sentences, no markup |
| `citations` | array of [Citation](#citation) | yes |  |
| `handoff` | boolean | yes | True when the turn must escalate to a human |
| `latency_ms` | [LatencyMs](#latencyms) | yes |  |
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
| `avatar_ready` | boolean |  |  |
| `scribe_ready` | boolean |  |  |

### ProspectInput

Full prospect configuration (admin only — contains KB ids)

| Field | Type | Required | Description |
|---|---|---|---|
| `display_name` | string | yes |  |
| `kb_id` | string | yes | ARAG Knowledge Box id |
| `region` | string | yes | ARAG zone slug |
| `ask_config` | string |  | Stored ask search configuration name |
| `reranker` | string (`noop`, `predict`) |  |  |
| `max_tokens` | integer |  |  |
| `generative_model` | string |  |  |
| `temperature` | number |  |  |
| `brief_model` | string |  |  |
| `agent_id` | string |  |  |
| `voice_id` | string |  |  |
| `avatar_id` | string |  |  |
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
| `kb_id` | string | yes | ARAG Knowledge Box id |
| `region` | string | yes | ARAG zone slug |
| `ask_config` | string |  | Stored ask search configuration name |
| `reranker` | string (`noop`, `predict`) |  |  |
| `max_tokens` | integer |  |  |
| `generative_model` | string |  |  |
| `temperature` | number |  |  |
| `brief_model` | string |  |  |
| `agent_id` | string |  |  |
| `voice_id` | string |  |  |
| `avatar_id` | string |  |  |
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

