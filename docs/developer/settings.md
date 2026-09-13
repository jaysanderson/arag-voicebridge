# Settings

Every configurable value in VoiceBridge is one row in a single declarative table,
`SETTINGS_FIELDS` in `src/services/settings.ts` — 41 fields across five groups. **The tables below
are transcribed from that one source; if this page and `SETTINGS_FIELDS` ever disagree, the code
wins** (regenerate this page by re-reading it rather than trusting a stale copy).

## How this works

An environment variable is a **default**, not the authority. `SettingsService` reads the
environment once at boot (the same values `readVoiceEnv()`/`readEnv()` produce), and from then on
the JSON store (`DATA_DIR/settings.json`) is what's authoritative: `apply()` walks every field and
writes the effective value — the stored override if one exists, else the boot-time default —
directly into the same `PlatformEnv`/`VoiceConfig` objects every route and service already holds. A
change made through `PATCH /api/v1/admin/settings` therefore takes effect on the **next request**,
with no restart, because nothing needs to be rebuilt or re-wired — only re-assigned.

- **Secrets are write-only.** A `type: "secret"` field (an ARAG service-account token, the
  ElevenLabs API key) is never read back over the API — `GET /api/v1/admin/settings` reports `set:
  true` plus a four-character `hint` (`maskSecret()`: `••••` + the last four characters) instead of
  a `value`. Set it once, then rotate it the same way; there is no "reveal" operation.
- **`null` resets a field** to its environment default (`PATCH` with a field value of `null`), and
  `POST /api/v1/admin/settings/reset` resets a whole group (or everything, with no `group` in the
  body).
- **A connection field marked `rewiresClients` below** invalidates the cached per-prospect ARAG
  clients on change (`onRewire()`), so a new Knowledge Box id, region, base URL, API key or client
  timeout takes effect for the *next* ARAG call, not a request already in flight against a stale
  client.
- **One invariant is enforced, not just validated:** `VOICE_TURN_TIMEOUT_MS` must stay below
  `AGENT_TOOL_TIMEOUT_MS`, or every voice turn risks dead air (the agent's tool call gives up before
  the bridge resolves). A patch that would break this is applied, checked with the same
  `assertVoiceConfig()` boot uses, and **rolled back** if it fails — the store and the live config
  both revert to what they were before the patch, and the request gets a 400 problem document
  naming the invariant.
- **Every change is audited**, not silently applied: `settings.changed`/`settings.reset` land in
  the operator log with who, which fields, and when — never the values, since some of them are
  secrets and the rest are already visible to whoever can read `GET /api/v1/admin/settings`.
- **Unknown groups or fields are rejected**, not ignored — a typo in a settings call fails loudly
  (400, with an `errors` array naming each bad path) rather than silently doing nothing.

See [`../architecture/security-model.md`](../architecture/security-model.md#the-api-key-store) for
the sibling store this pairs with (`ApiKeyStore`), and
[`../architecture/data-flow.md`](../architecture/data-flow.md#retention-and-purge) for what the
`retention` group's fields actually do.

## Routes

| Route | What it does |
|---|---|
| `GET /api/v1/admin/settings` | Every group and field, with its effective value, its source (`stored`/`env`/`default`) and secrets masked. |
| `PATCH /api/v1/admin/settings` | Apply a partial patch, keyed by group then field. Validated, audited, applied live; rolled back if it would break the turn-budget invariant. |
| `POST /api/v1/admin/settings/reset` | Drop stored overrides for one group (or all) and fall back to the environment. |
| `POST /api/v1/admin/settings/logo` | Upload a partner logo (SVG/PNG/JPEG/WebP/GIF, 1 MB max) into `DATA_DIR/branding/` and point `branding.logoUrl` at it. |
| `DELETE /api/v1/admin/settings/logo` | Remove the uploaded logo and fall back to the wordmark. |

## Branding

How this deployment identifies itself. A partner rebrands without a fork; per-prospect overlays
layer on top of these under Prospects (see [`white-label.md`](white-label.md)).

| Setting | Type | Env default | What it affects |
|---|---|---|---|
| Product name | string | `BRAND_PRODUCT_NAME` | Shown on the rail, in the tab title and in the docs. |
| Tagline | string | `BRAND_TAGLINE` | One line under the product name. |
| Logo | string | `BRAND_LOGO_URL` | Replaces the Progress wordmark on the rail. Upload a file (`POST .../settings/logo`) or paste a URL. |
| Primary colour | color | `BRAND_PRIMARY_COLOR` | The action colour. |
| Accent colour | color | `BRAND_ACCENT_COLOR` | The liveness colour on dark surfaces. |
| Footer text | string | `BRAND_FOOTER_TEXT` | Shown at the foot of the rail. |
| Docs link | string | `BRAND_DOCS_URL` | Where the rail's API-docs link points. |
| Support link | string | `BRAND_SUPPORT_URL` | Optional support destination. |
| Show the Progress credit | boolean | `BRAND_POWERED_BY` | Off removes the wordmark and the credit from the UI. Attribution stays in `LICENSE` and `THIRD_PARTY_NOTICES.md`. |

## Connection

How the bridge reaches Progress Agentic RAG. The Knowledge Box here is the deployment default — a
prospect may point at its own (see
[`../architecture/arag-integration.md`](../architecture/arag-integration.md)).

| Setting | Type | Env default | What it affects | Rewires clients |
|---|---|---|---|---|
| Knowledge Box id | string | `ARAG_KB_ID` | The deployment default. A prospect with no `kb_id` of its own answers from this one. | yes |
| Service-account token | secret | `ARAG_API_KEY` | Sent as `X-NUCLIA-SERVICEACCOUNT`. Set once, then rotated — never displayed. | yes |
| Region | string | `ARAG_REGION` | Zone slug, e.g. `aws-us-east-2-1`. Used to build the host when no base URL is set. | yes |
| Base URL override | string | `ARAG_BASE_URL` | Full API base, e.g. `https://aws-us-east-2-1.dp.progress.cloud/api/v1`. Empty = derive from the region. | yes |
| Generative model | string | `ARAG_GENERATIVE_MODEL` | Empty = the Knowledge Box default. A prospect may override it. | no |
| Reranker | enum (`predict`, `noop`) | `ARAG_RERANKER` | `predict` reranks retrieval with the platform model; `noop` keeps the retrieval order. | no |
| Public URL | string | `PUBLIC_URL` | How the outside world reaches this deployment. The ElevenLabs tool URL is built from it, so getting it wrong is the usual reason a pushed agent cannot call back. | no |
| Client timeout | number (ms) | `ARAG_TIMEOUT_MS` | Default per-request budget for ARAG calls. The voice turn uses its own, shorter one (see Limits below). | no |

## Limits and timeouts

The budgets that keep a voice turn inside the agent's tool timeout and stop one caller spending
everyone's quota.

| Setting | Type | Env default | What it affects |
|---|---|---|---|
| Voice turn budget | number (ms) | `VOICE_TURN_TIMEOUT_MS` | Per-turn ARAG budget. Must stay below the agent tool timeout or the caller hears silence. |
| Agent tool timeout | number (ms) | `AGENT_TOOL_TIMEOUT_MS` | The timeout configured on the ElevenLabs custom server tool. Pushed to the agent. |
| Brief budget | number (ms) | `VOICE_BRIEF_TIMEOUT_MS` | Listen-mode brief budget. Longer than a turn because it never blocks speech. |
| History turns | number | `MAX_HISTORY_TURNS` | Prior turns forwarded to ARAG as context (one turn = caller + agent). |
| Turn log size | number | `VOICE_TURN_LOG_LIMIT` | How many recent turns the ring keeps for metrics and the turn log. |
| API rate limit | number (rps) | `RATE_LIMIT_RPS` | Global per-IP requests per second for `/api/v1`. 0 disables the limiter. |
| API burst | number | `RATE_LIMIT_BURST` | Bucket size for the global per-IP limiter. |
| Max request body | number (bytes) | `MAX_BODY_BYTES` | Largest accepted request body. |
| Brief rate limit | number (rps) | `VOICE_BRIEF_RATE_RPS` | Per-IP requests per second for `/api/v1/brief` and listen transcript ingest — each spends a generation. |
| Brief burst | number | `VOICE_BRIEF_RATE_BURST` | Bucket size for the brief limiter. |
| Scribe token rate limit | number (rps) | `VOICE_SCRIBE_RATE_RPS` | Per-IP requests per second for minting ElevenLabs Scribe tokens. |
| Scribe token burst | number | `VOICE_SCRIBE_RATE_BURST` | Bucket size for the Scribe-token limiter. |
| Speech rate limit | number (rps) | `VOICE_TTS_RATE_RPS` | Per-IP requests per second for the spoken brief — it costs per character. |
| Speech burst | number | `VOICE_TTS_RATE_BURST` | Bucket size for the speech limiter. |

## ElevenLabs

The default voice stack: Scribe transcription, the Conversational AI agent and the optional spoken
brief.

| Setting | Type | Env default | What it affects |
|---|---|---|---|
| API key | secret | `ELEVENLABS_API_KEY` | Server-side only. Mints Scribe tokens, lists voices, synthesises speech and configures agents. |
| API base URL | string | `ELEVENLABS_API_BASE` | Override for a regional endpoint or a test double. |
| Transcription model | string | `ELEVENLABS_SCRIBE_MODEL` | Realtime model used by the Live microphone. |
| Speech model | string | `ELEVENLABS_TTS_MODEL` | Low-latency model for the spoken brief. |
| Default voice | string | `ELEVENLABS_TTS_VOICE_ID` | Voice for the spoken brief when a prospect has none of its own. |
| Default agent id | string | `VOICE_DEFAULT_AGENT_ID` | Agent used by a prospect that has none of its own. |

## Retention

How long recorded turns, conversations and golden runs are kept before purging (see
[`../architecture/data-flow.md`](../architecture/data-flow.md#retention-and-purge) for the purge
mechanics and `POST /api/v1/admin/purge`).

| Setting | Type | Env default | What it affects |
|---|---|---|---|
| Keep turns for | number (days) | `VOICE_RETENTION_TURN_DAYS` | Days a recorded turn is kept. 0 keeps them until the ring evicts them. |
| Keep conversations for | number (days) | `VOICE_RETENTION_SESSION_DAYS` | Days an ended listen session (with its transcript) is kept. |
| Keep golden runs for | number (days) | `VOICE_RETENTION_EVAL_DAYS` | Days a golden-set evaluation result is kept. |
| Purge automatically | boolean | `VOICE_RETENTION_AUTO_PURGE` | Apply the retention windows on an hourly timer as well as on demand. |
