# Examples

Copy-pasteable requests for every public route. All examples assume `BASE=http://localhost:8080`
against a mock-backed server (`ARAG_MOCK=1`) with the shipped `progress` prospect. Add
`-H "X-API-Key: $API_KEY"` to every call once `API_KEYS` is set (see
[`../architecture/security-model.md`](../architecture/security-model.md)); the demo console instead
calls `POST /api/v1/session` once and relies on the resulting cookie.

The full machine-readable contract is [`api-reference.md`](api-reference.md) (generated from
`src/openapi.ts` — never hand-edited) and the live Redoc/Swagger UIs at `/api/v1/docs` and
`/api/v1/swagger`.

## Voice turns

### `POST /api/v1/voice-answer`

The endpoint a voice agent's custom tool calls. `POST /v1/voice-answer` is an identical
compatibility alias (same handler, both described in the OpenAPI document — see `DECISIONS.md`
V-01) kept for ElevenLabs agents already configured against the original bridge URL; point new
integrations at `/api/v1/voice-answer`.

```bash
curl -s $BASE/api/v1/voice-answer \
  -H 'Content-Type: application/json' \
  -d '{
    "prospect": "progress",
    "question": "What materials does the PureSinter furnace support?",
    "conversation_id": "conv_abc123",
    "history": [
      { "author": "USER", "text": "Tell me about the PureSinter furnace." },
      { "author": "NUCLIA", "text": "The PureSinter furnace is Desktop Metal's sintering furnace..." }
    ]
  }'
```

```js
const res = await fetch(`${BASE}/api/v1/voice-answer`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ prospect: "progress", question: "What is binder jetting?" }),
});
const { answer, citations, handoff, latency_ms } = await res.json();
```

Response fields: `answer` (the spoken line — ≤3 sentences, no URLs, no markdown, no citation
markers), `citations` (data only, never spoken — up to 4, deduped, sorted by score), `handoff`
(true when the turn must escalate to a human), `latency_ms` (`retrieve`, `first_token`, `total`),
and `handoff_reason` (one of `sentinel | not-found-phrase | empty-answer | no-retrieval |
upstream-error` for a real handoff, or a guard code — see below — when a safety guard fired
instead of ARAG ever being called).

`generative_model` is an optional per-request override (what the console's model dropdown sends).

### `POST /api/v1/brief` — the ambient Listen-mode copilot

Fires roughly every 1.5 s while Listen mode is active; rate-limited separately from
`/voice-answer` because of that (`VOICE_BRIEF_RATE_RPS`, default 1 rps with a burst of 5 — see
`src/services/ratelimit.ts`).

```bash
curl -s $BASE/api/v1/brief \
  -H 'Content-Type: application/json' \
  -d '{
    "prospect": "progress",
    "text": "so does the shop system print stainless steel batches",
    "transcript": "customer: hi I am looking at metal 3d printers for my machine shop...",
    "prev": null
  }'
```

```json
{
  "brief": {
    "topic": "Metal 3D printing for a machine shop",
    "caller_profile": "Runs a machine shop evaluating production-volume metal printing.",
    "their_goal": "Find a printer that can produce stainless steel parts in batches.",
    "stage": "exploring",
    "summary": "The Desktop Metal Shop System is a binder jetting printer built for exactly this.",
    "key_points": ["Shop System prints stainless steel in batches, not one at a time."],
    "suggested_questions": ["What batch sizes are you currently running?"],
    "suggested_answers": ["The Shop System pairs with the PureSinter furnace for sintering."],
    "recommended_products": ["Desktop Metal Shop System — built for machine-shop batch volumes"]
  },
  "citations": [{ "title": "Desktop Metal Shop System", "url": "", "score": 0.81 }],
  "latency_ms": { "retrieve": 180, "first_token": 420, "total": 640 }
}
```

Pass the **previous** brief back as `prev` on the next call — the model is instructed to refine and
extend it, not restart. On any failure (timeout, ARAG error, guard trip) the route returns
`{ brief: null, citations: [], latency_ms }` rather than throwing, so the caller keeps the last
good brief on screen instead of flashing an error.

## Prospects, models and voices

```bash
curl -s $BASE/api/v1/prospects | jq '.items[].key'
curl -s $BASE/api/v1/prospects/progress
curl -s "$BASE/api/v1/models?prospect=progress" | jq '.models[] | {id, label, speed, quality, price}'
curl -s $BASE/api/v1/voices   # 503 if ELEVENLABS_API_KEY is not configured
```

The prospect projection here is non-secret — no `kb_id`, `region` or `ask_config`. The full record
(admin only) is at `GET /api/v1/admin/prospects/{key}`.

## Realtime bootstrap (credential minting)

Both routes below mint third-party credentials, so both **always** require a session, API key or
admin token — even when `API_KEYS` is unset (`DECISIONS.md` V-06). The demo console gets a session
automatically at boot:

```bash
curl -s -c cookies.txt -X POST $BASE/api/v1/session
curl -s -b cookies.txt -X POST $BASE/api/v1/scribe-token
```

```json
{ "token": "…", "expiresInSec": 900 }
```

The browser passes that token as the `token` query parameter when it opens the ElevenLabs Scribe
v2 realtime WebSocket directly — the server-side ElevenLabs key is never sent to the browser. See
[`integrations.md`](integrations.md) for the full Listen-mode wiring.

```bash
curl -s -b cookies.txt -X POST $BASE/api/v1/avatar/sessions \
  -H 'Content-Type: application/json' \
  -d '{"prospect": "progress"}'
```

503s until `LIVEAVATAR_API_KEY`, `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` are all
set, and 400s if the prospect lacks both `agent_id` and `avatar_id`.

## Metrics and golden evaluations

```bash
curl -s $BASE/api/v1/metrics | jq
```

```json
{
  "turns": 42,
  "latency_total_ms": { "p50": 980, "p95": 2100 },
  "latency_first_token_ms": { "p50": 610, "p95": 1400 },
  "handoff_rate": 0.12,
  "citation_coverage": 0.97,
  "guard_trip_rate": 0.0,
  "by_prospect": { "progress": 42 }
}
```

Golden-set runs are async **jobs** — `POST` returns `202` immediately with a job you poll or
stream:

```bash
JOB=$(curl -s -X POST $BASE/api/v1/golden-evals -H 'Content-Type: application/json' \
  -d '{"prospect": "progress"}' | jq -r '.job.id')

# Poll
curl -s $BASE/api/v1/jobs/$JOB | jq '.status'

# Or stream progress as Server-Sent Events
curl -N $BASE/api/v1/jobs/$JOB/events
# event: event  data: {"stage":"question","status":"ok","message":"1/10 pass · Tell me about..."}
# ...
# event: job    data: {"stage":"job","status":"succeeded","job":{...}}

# The result is retrievable by either the eval id or the job id:
curl -s $BASE/api/v1/golden-evals/$JOB | jq '{ok, passed, total, latency_ms}'
```

`scripts/eval.ts` (`make eval P=progress`) is exactly this flow wrapped for CI: it posts the job,
polls to completion, prints every question's pass/fail with the failing checks, and exits non-zero
if `ok` is false.

## Jobs

```bash
curl -s "$BASE/api/v1/jobs?status=running"
curl -s $BASE/api/v1/jobs/$JOB
curl -s -X DELETE $BASE/api/v1/jobs/$JOB   # cancel (204)
```

## Admin (requires `ADMIN_TOKEN`)

```bash
curl -s -X POST $BASE/api/v1/admin/login -H 'Content-Type: application/json' \
  -d '{"token": "'"$ADMIN_TOKEN"'"}' -c admin.txt

curl -s -b admin.txt $BASE/api/v1/admin/health | jq
curl -s -b admin.txt $BASE/api/v1/admin/config | jq
curl -s -b admin.txt $BASE/api/v1/admin/usage | jq
curl -s -b admin.txt "$BASE/api/v1/admin/logs?level=warn&limit=50"
```

Or skip the cookie and send `Authorization: Bearer $ADMIN_TOKEN` directly on every call — both
work (`src/http/app.ts` `authenticate()`).

### Prospect CRUD

```bash
# Create
curl -s -b admin.txt -X POST $BASE/api/v1/admin/prospects \
  -H 'Content-Type: application/json' \
  -d '{
    "key": "acme",
    "config": {
      "display_name": "Acme Corp",
      "kb_id": "00000000-0000-0000-0000-000000000000",
      "region": "aws-us-east-2-1",
      "locale": "en-US",
      "greeting": "Hi, thanks for calling. What can I help you with?",
      "handoff_msg": "Let me hand you to a specialist.",
      "golden_questions": [{ "q": "What do you sell?", "expect": "answer" }]
    }
  }'

# Read / replace / delete
curl -s -b admin.txt $BASE/api/v1/admin/prospects/acme
curl -s -b admin.txt -X PUT $BASE/api/v1/admin/prospects/acme -H 'Content-Type: application/json' -d @acme.json
curl -s -b admin.txt -X DELETE $BASE/api/v1/admin/prospects/acme
```

### Provisioning the stored ARAG search configuration

```bash
curl -s -b admin.txt -X POST $BASE/api/v1/admin/prospects/acme/provision \
  -H 'Content-Type: application/json' -d '{}'                       # idempotent write
curl -s -b admin.txt -X POST $BASE/api/v1/admin/prospects/acme/provision \
  -H 'Content-Type: application/json' -d '{"dry_run": true}'        # preview only, no ARAG call
```

`make provision P=acme` / `make provision P=acme ARGS="--dry-run --reranker predict"` wrap the same
call from the shell (`scripts/provision.ts`), useful before the admin panel exists for a
just-created prospect, or for scripting the onboarding ritual (see
[`extension-points.md`](extension-points.md)).

### Turn log and golden-eval history

```bash
curl -s -b admin.txt "$BASE/api/v1/admin/turns?prospect=progress&limit=50"
curl -s -b admin.txt "$BASE/api/v1/admin/golden-evals?prospect=progress&limit=10"
```

The turn log never carries question text for a turn that tripped a safety guard — it stores the
guard reason and nothing else (`DECISIONS.md` V-08).

## The canonical voice-answer prompt

This is the single highest-leverage reusable asset in the product: it is what turns ARAG's default
*written* answers into *spoken*-shaped ones, and it is a **contract** with the bridge's
deterministic handoff detection (`src/services/handoff.ts`). Built inline for every turn by
`src/services/voicePrompt.ts::buildVoicePrompt()` (used when a prospect has no `ask_config`) and in
the equivalent flattened form by `src/services/provision.ts` when writing a stored search
configuration:

```
You are {DISPLAY_NAME}'s voice support assistant. Your reply is read aloud by text-to-speech, so it
must sound like natural speech. Answer the question using ONLY the information in the provided
context. You may give a brief or partial answer when the context contains relevant facts. You MUST
NOT use any outside or general knowledge, and you must never answer from your own knowledge. Never
guess or invent specifics such as prices, dates, model numbers, or policies. If the context does
not contain information that answers this specific question, reply with exactly this and nothing
else: "HANDOFF: not in the knowledge base." Answer in 2 to 3 short spoken sentences in {LOCALE}
English. Plain language. No markdown, no headings, no lists, no URLs, no citation markers. Do not
mention document names, scores, the retrieval process, or that you are an AI.

Context:
{context}

Question: {question}

Spoken answer:
```

`{DISPLAY_NAME}` and `{LOCALE}` are filled from the prospect's registry entry; `{context}` and
`{question}` are ARAG's own prompt-template placeholders, substituted server-side by ARAG. The
`HANDOFF:` sentinel must stay byte-identical between this prompt and `HANDOFF_SENTINEL` in
`src/services/handoff.ts` — they are two halves of one contract, deliberately kept next to each
other in the source. Belt-and-braces: an empty answer, an empty retrieval, or one of ARAG's own
stock "not enough data" refusal phrasings is *also* treated as a handoff, so a stored configuration
that omits this prompt (or a model that ignores it) still degrades safely rather than hallucinating
— see [`../architecture/arag-integration.md`](../architecture/arag-integration.md).

## The ElevenLabs agent tool definition

To wire a voice agent to VoiceBridge, add one custom server tool. This is the shape the shipped
demo's agent uses (see [`integrations.md`](integrations.md) for the full dashboard walkthrough):

| Field | Value |
|---|---|
| Name | `voice_answer` |
| Method | `POST` |
| URL | `{BRIDGE_URL}/api/v1/voice-answer` |
| Response timeout | `AGENT_TOOL_TIMEOUT_MS` (default 8000 ms) — must exceed the bridge's own `VOICE_TURN_TIMEOUT_MS` (default 6000 ms); boot fails otherwise (`assertVoiceConfig()`, `DECISIONS.md` V-11) |

Request body schema (the agent fills these from the live conversation):

```json
{
  "type": "object",
  "required": ["prospect", "question"],
  "properties": {
    "prospect": { "type": "string", "description": "Always this agent's registry key, e.g. 'progress'." },
    "question": { "type": "string", "description": "The caller's most recent question, transcribed." },
    "conversation_id": { "type": "string", "description": "The conversation id, for correlating logs." },
    "history": {
      "type": "array",
      "description": "Recent prior turns; the bridge caps it to MAX_HISTORY_TURNS.",
      "items": {
        "type": "object",
        "properties": {
          "author": { "type": "string", "enum": ["USER", "NUCLIA"] },
          "text": { "type": "string" }
        }
      }
    }
  }
}
```

Agent-level system prompt (keep it minimal — the agent is a router, not the answer source; the
*answer* is `voice-answer`'s response):

```
You are the voice for {DISPLAY_NAME} support. You are a router, not the answer source.

For ANY factual or support question, you MUST call the `voice-answer` tool. Do not answer factual
questions from your own knowledge — you don't have the knowledge base, the tool does.

When the tool returns, speak its `answer` field VERBATIM. Do not rephrase, summarise, expand, add
to it, or read out any URLs. If the tool returns handoff = true, speak the answer (it is the
handoff line) warmly and, in self-serve mode, hand the caller to a human.

Open the conversation with the configured greeting. Keep your own speech minimal — the tool's
answer is the product.
```

Re-summarising the tool's answer defeats the point twice over: it re-introduces a hallucination
surface the grounded pipeline just closed, and it doubles perceived latency for no benefit. Cloning
this agent for a second prospect changes exactly one thing in the tool body: the `prospect`
constant.
