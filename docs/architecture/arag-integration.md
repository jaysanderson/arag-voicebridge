# ARAG integration

VoiceBridge talks to Progress Agentic RAG through the platform's `AragClient`
(`vendor/arag-platform/src/arag/client.ts`), one instance per `kb_id|baseUrl` pair via
`AragClientPool` (`src/services/clientPool.ts`). This page documents the exact shapes on the wire —
the request VoiceBridge sends, the NDJSON stream it reads back, and the two ARAG surfaces
(`/ask` and stored search configurations) that carry almost the entire product.

## The `/ask` request for a voice turn

Built by `buildAskRequest()` in `src/services/pipeline.ts`. Two paths, chosen per prospect:

**Stored configuration path** (`prospect.ask_config` set — the production path, written by
`POST /api/v1/admin/prospects/{key}/provision`):

```json
{
  "query": "What materials does the PureSinter furnace support?",
  "context": [
    { "author": "USER", "text": "Tell me about the PureSinter furnace." },
    { "author": "NUCLIA", "text": "The PureSinter furnace is Desktop Metal's sintering furnace..." }
  ],
  "features": ["semantic", "keyword"],
  "citations": true,
  "search_configuration": "progress_voice"
}
```

Here the stored configuration owns the prompt, the governance filters, the reranker and the model —
the bridge sends only the query, the trimmed conversation context and the retrieval features.

**Inline path** (no `ask_config` — used automatically when a prospect has not been provisioned
yet, so a brand-new prospect works before anyone runs the provisioning step):

```json
{
  "query": "What materials does the PureSinter furnace support?",
  "context": [...],
  "features": ["semantic", "keyword"],
  "citations": true,
  "prompt": { "system": "You are Progress's voice support assistant...", "user": "Context:\n{context}\n\nQuestion: {question}\n\nSpoken answer:" },
  "reranker": "noop",
  "max_tokens": 160,
  "temperature": 0,
  "generative_model": "gemini-2.5-flash-lite"
}
```

`generative_model` is included only when the request or the prospect specifies one — omitting it
uses the Knowledge Box's own default. `temperature: 0` is deliberate and load-bearing: it is what
makes the golden set deterministic and repeatable run to run
(`src/services/pipeline.ts::buildAskRequest()`, `DECISIONS.md` background). `features` deliberately
excludes `relations` — it is a real latency lever, not an oversight; add it back per-prospect only
if a demo needs NER/graph traversal.

`context` is built by `buildContext()`: the last `MAX_HISTORY_TURNS` turns (a turn = one USER +
one NUCLIA message, so `MAX_HISTORY_TURNS * 2` messages), coerced into ARAG's alternating
`{author: "USER"|"NUCLIA", text}` shape, bounding both generation cost and latency.

## Reading the NDJSON stream

`AragClient.askStream()` (`vendor/arag-platform/src/arag/client.ts`) posts with
`Accept: application/x-ndjson` and yields normalised items; `AragClient.ask()` assembles them into
one `AskResult`. The item shapes that matter to VoiceBridge, confirmed against a live Knowledge Box
(see `CHANGELOG.md` and the original build's live-verification notes):

| Item type | Shape | What VoiceBridge does with it |
|---|---|---|
| `answer` | `{ type: "answer", text }` | Concatenated into `answerText`; `timings.firstTokenMs` is stamped on the first non-empty chunk |
| `retrieval` | `{ type: "retrieval", results: { resources: { <id>: { title, fields: { <field>: { paragraphs: { <id>: { score } } } } } } } }` | Flattened by `citationsFrom()`/`retrievalItems()` (`src/services/citations.ts`) into `{title, url, score}`, deduped, sorted, capped at 4 |
| `citations` | `{ type: "citations", citations: {...} }` | Captured on `AskResult.citations` but not currently used directly — VoiceBridge derives its citation chips from `retrieval` instead, since that is what carries titles and scores |
| `answer_json` | `{ type: "answer_json", object }` | Only when `answer_json_schema` was set (the brief) — becomes `AskResult.answerJson` directly |
| `status` / `error` | `{ status | code, details }` / `{ error, details }` | Recorded on `AskResult.status`/`errorDetail`; not currently surfaced to the caller beyond causing an empty/short answer, which the handoff decision then catches |
| `metadata`, `augmented_context` | varies | Ignored by VoiceBridge today |

`AragClient.ask()` also has a fallback: if `answer_json_schema` was requested but no `answer_json`
item arrived and the concatenated answer text starts with `{`, it attempts to `JSON.parse` the text
— some models honour a JSON schema by emitting valid JSON as plain answer chunks rather than a
typed `answer_json` item.

## Citations

A citation in the public API (`{title, url, score}`, `src/types.ts`) is derived entirely from the
`retrieval` item's `resources` map, not from the `citations` item — `retrievalItems()`
(`src/services/citations.ts`) walks every resource's `fields → paragraphs`, takes the best
(maximum) paragraph score as the resource's score, and best-effort resolves a URL from
`origin.url`/`uri`/`metadata.url`. Citations are **data only** — they are surfaced in the console
and the admin turn log, never spoken (see [`architecture.md`](architecture.md) and
`shapeForVoice()`'s marker-stripping in `src/services/voiceShape.ts`).

## The structured live brief and `answer_json_schema`

Listen mode (`POST /api/v1/brief`, `src/services/brief.ts`) asks ARAG to return a **typed object**
instead of prose, using ARAG's `answer_json_schema` parameter — an OpenAI-function-style schema
(`name`, `description`, `parameters: {type: "object", properties, required}`). VoiceBridge's schema
is `LIVE_BRIEF_SCHEMA`, requiring only `summary` and describing nine fields in total: `topic`,
`caller_profile`, `their_goal`, `stage`, `summary`, `key_points`, `suggested_questions`,
`suggested_answers`, `recommended_products`.

### Why `citations` and `answer_json_schema` are mutually exclusive

ARAG rejects a request that sets both. `AragClient.askStream()` enforces this defensively on the
client side too:

```ts
// vendor/arag-platform/src/arag/client.ts
const req: AskRequest = { features: ["keyword", "semantic"], ...body };
if (req.answer_json_schema && req.citations) delete req.citations;
```

`buildAskRequest()` for a voice turn always sets `citations: true` and never sets
`answer_json_schema`; `buildBriefRequest()` for the brief always sets `answer_json_schema` and
never sets `citations`. The two ARAG surfaces this product uses are intentionally kept on opposite
sides of that line — a voice turn needs inline citation markers/spans it never speaks but wants
retrieval-based citation chips for, while the brief needs a typed object and gets its "citations"
from the same `retrieval` item every other call produces, via `citationsFrom()`.

### The evolving-brief pattern

Each brief refresh sends the model three things in the `user` prompt (`buildBriefRequest()`):
the knowledge-base context (`{context}`, ARAG's own placeholder), the running conversation
transcript (client-accumulated, capped to the last 6000 characters), and the **previous brief**
rendered back as plain `Label: value` lines (capped to 2000 characters) with an explicit instruction
to refine and extend it rather than restart. This is why the brief feels like it is building a
persona of the call rather than re-summarising from scratch on every tick. Retrieval itself is
scoped to just the most recent words heard (`req.text`), not the whole transcript — the model
reasons over the full conversation via the prompt, but retrieval stays focused on the current
topic. `{`/`}` characters are stripped from both the transcript and the previous-brief text before
they go into the prompt, because ARAG's prompt templater only recognises `{context}`/`{question}`
and treats any other curly-brace content as a templating error (400).

The brief uses `reranker: "predict"` by default (higher quality, slower — acceptable because it is
not blocking speech) and a **fast** model chosen in this priority order: the per-request
`generative_model` override, then the prospect's `brief_model`, then its `generative_model`. A slow
model here means the brief times out (`VOICE_BRIEF_TIMEOUT_MS`, default 12 s) before
`answer_json` arrives, and the client keeps showing the last good brief rather than an error — see
`runBrief()`'s catch-all in `src/services/brief.ts`.

## Stored search configurations

`POST /search_configurations/{name}` with `kind: "ask"` (`AragClient.putSearchConfiguration()`,
called from `provisionProspect()` in `src/services/provision.ts`) pins everything the inline path
would otherwise send on every call: governance filters, the reranker, token/temperature limits, the
model, and the voice-answer prompt flattened to a single string. It is idempotent — a 409 on create
is retried as a `PATCH` to the same name, so re-running `provision` after a prospect's settings
change simply updates the configuration in place.

```json
{
  "kind": "ask",
  "config": {
    "filter_expression": {
      "field": { "prop": "language", "language": "en" },
      "paragraph": { "not": { "prop": "kind", "kind": "OCR" } },
      "operator": "and"
    },
    "security": { "groups": ["public"] },
    "reranker": "noop",
    "max_tokens": 160,
    "temperature": 0,
    "prompt": "You are Progress's voice support assistant...\n\nContext:\n{context}\n\nQuestion: {question}\n\nSpoken answer:",
    "citations": true,
    "generative_model": "gemini-2.5-flash-lite"
  }
}
```

`security.groups: ["public"]` is a retrieval **filter**, not a server-side authorisation boundary —
see [`security-model.md`](security-model.md) for exactly what that distinction means in practice
and why it matters for what a reviewer can be told this system guarantees.

## Models and schema endpoints

`GET /api/v1/models?prospect=<key>` (`src/services/models.ts::fetchModels()`) powers the model
picker in both the console (Listen tab) and the admin provisioning flow. It calls two ARAG
endpoints tolerantly, because their schema shapes vary between zones and are not something
VoiceBridge controls:

- `GET /configuration` — the Knowledge Box's current settings; `generative_model` (if present) is
  surfaced as the picker's "current" value.
- `GET /schema` — the learning-configuration schema; `optionsFrom()` tries three different node
  shapes (`schema.generative_model.options`, `schema.properties.generative_model`, the raw schema
  itself) before giving up and returning an empty list, at which point the picker degrades to "KB
  default" rather than erroring.

Both calls are wrapped in `try/catch` with silent fallback — a model-listing failure never blocks a
turn or a brief; it only means the picker shows fewer choices. `classify()` assigns each returned
model a speed/quality/price tier by pattern-matching its id (`flash`/`haiku`/`mini` → fast/cheap;
`opus`/`o1`/`o3`/`o4` → slow/premium; `sonnet`/`4o`/`4.1` → balanced) purely to make the picker
self-explanatory — it has no effect on retrieval or generation itself.
