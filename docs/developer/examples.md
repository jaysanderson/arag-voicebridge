# Examples

Copy-pasteable requests for every public route. All examples assume `BASE=http://localhost:8080`
against a mock-backed server (`ARAG_MOCK=1`) with the shipped `progress` prospect. Add
`-H "X-API-Key: $API_KEY"` to every call once `API_KEYS` is set (see
[`../architecture/security-model.md`](../architecture/security-model.md)); the demo console instead
calls `POST /api/v1/session` once and relies on the resulting cookie.

The full machine-readable contract is [`api-reference.md`](api-reference.md) (generated from
`src/openapi.ts` — never hand-edited) and the live Redoc/Swagger UIs at `/api/v1/docs` and
`/api/v1/swagger`.

## Real-time listening

The hero path. A session is opened for a prospect; conversation is appended as chunks from
**any** source — a realtime STT stream, a telephony webhook, a meeting bot, or someone typing —
and the server keeps the rolling transcript, throttles and de-duplicates brief refreshes, maintains
one evolving brief, accumulates citations across the call, and tracks per-session latency. Clients
read the brief over SSE or by polling. See
[`../architecture/architecture.md`](../architecture/architecture.md) for the throttle policy and
[`../architecture/data-flow.md`](../architecture/data-flow.md) for the full session lifecycle.

### Create a session

```bash
SESSION=$(curl -s $BASE/api/v1/listen/sessions \
  -H 'Content-Type: application/json' \
  -d '{"prospect": "progress", "metadata": {"queue": "sales", "call_id": "abc123"}}' | jq -r '.id')
```

`metadata` is opaque and kept with the session (call id, queue, agent id — whatever the caller
wants back later); `generative_model` and `locale` are also accepted and default to the prospect's
own settings.

### Append conversation

```bash
curl -s $BASE/api/v1/listen/sessions/$SESSION/transcript \
  -H 'Content-Type: application/json' \
  -d '{"chunks": [
        {"speaker": "caller", "text": "we run a machine shop and need stainless steel parts fast"},
        {"speaker": "agent", "text": "have you looked at binder jetting for that volume"}
      ]}'
```

```json
{ "session": { "...": "..." }, "refresh": "started", "reason": "ok" }
```

`refresh` is what the server-side throttle decided to do with *this* append, so a client can show
useful status without guessing:

| `refresh` | `reason` | Meaning |
|---|---|---|
| `started` | `ok` | Enough new, distinct words arrived — a brief refresh (one ARAG call) is running now. |
| `scheduled` | `too-soon` | Inside the minimum gap (1.5 s) since the last refresh; a refresh is queued to fire once the gap elapses, so the update is coalesced rather than dropped. |
| `skipped` | `too-few-words` | The rolling window (last ~28 words) is under 4 words — not enough to ask about yet. |
| `skipped` | `unchanged` | The window is byte-identical to the last one refreshed. |
| `skipped` | `too-similar` | The window is >0.85 Jaccard-similar to the last one — "the same sentence again", e.g. a re-sent STT hypothesis. |

A chatty client — one line every 200 ms — cannot turn every word into an LLM call; the throttle
lives on the server so every client (web console, softphone plugin, telephony bridge) gets the same
behaviour and the same cost profile. Send an **interim** hypothesis with `"final": false`; the next
chunk (final or interim) for that session replaces it rather than accumulating duplicates:

```bash
curl -s $BASE/api/v1/listen/sessions/$SESSION/transcript \
  -H 'Content-Type: application/json' \
  -d '{"chunks": [{"speaker": "caller", "text": "we need stain", "final": false}]}'
curl -s $BASE/api/v1/listen/sessions/$SESSION/transcript \
  -H 'Content-Type: application/json' \
  -d '{"chunks": [{"speaker": "caller", "text": "we need stainless steel", "final": true}]}'
```

Interim chunks never reach the brief prompt — only `final` transcript text is sent to ARAG
(`ListenService.transcriptText()`), so a half-formed hypothesis cannot pollute the grounded context.
`chunks` accepts up to 50 entries per call (`text` up to 4000 characters each), so a burst of
buffered STT output can be flushed in one request.

### Read the session

```bash
curl -s "$BASE/api/v1/listen/sessions/$SESSION?transcript_tail=20" | jq '{status, briefVersion, brief, citations, stats, transcriptTotal}'
```

`stats` carries `chunks`, `words`, `refreshes` (usable brief updates), `skipped` (throttled),
`failures` (a refresh that errored or returned nothing usable — the previous brief stays on screen
either way), and `lastLatencyMs`/`p50LatencyMs`/`p95LatencyMs` over the session's refreshes.
`transcript_tail` (default 50, max 400) bounds how much transcript comes back; `transcriptTotal` is
the full count so a client can tell there is more.

### Consume the brief over SSE

```bash
curl -N $BASE/api/v1/listen/sessions/$SESSION/events
# event: brief      data: {"brief":{...},"version":1,"citations":[...],"stats":{...}}
# event: status     data: {"status":"live"}
# event: transcript data: {"entries":[...],"stats":{...}}
# event: status     data: {"status":"refreshing"}
# event: brief      data: {"brief":{...},"version":2,...}
```

The stream sends the session's *current* state (`brief`, then `status`) the moment it connects, so a
late subscriber is not staring at an empty pane, then streams `transcript`/`brief`/`status` events
as they happen. `status` is `refreshing` while a brief call is in flight, `skipped` with a `reason`
when a refresh ran but returned nothing usable, and `ended` when the session closes (the server then
closes the stream itself).

```js
const es = new EventSource(`${BASE}/api/v1/listen/sessions/${sessionId}/events`, {
  withCredentials: true, // same-origin session cookie — EventSource cannot send X-API-Key
});
es.addEventListener("brief", (e) => {
  const { brief, version, citations, stats } = JSON.parse(e.data);
  renderBrief(brief, citations, version, stats);
});
es.addEventListener("transcript", (e) => appendTranscript(JSON.parse(e.data).entries));
es.addEventListener("status", (e) => {
  const { status, reason } = JSON.parse(e.data);
  if (status === "ended") es.close();
});
```

Because the browser `EventSource` API cannot set custom request headers, a browser client must
authenticate the SSE connection with the same-origin `arag_session` cookie from
`POST /api/v1/session` (what the workspace does at boot) rather than `X-API-Key` — a server-to-server client
(a telephony bridge, say) can instead pass `X-API-Key` on a plain `fetch`/`curl` request since it
is not bound by that restriction.

### Poll as a fallback

A brief can land in the gap between opening a session and an event stream attaching (or a proxy can
drop long-lived connections), so the shipped console also polls every three seconds while a session
is live, in addition to its SSE subscription, and only renders a poll's brief if its `briefVersion`
is newer than what SSE already rendered:

```js
setInterval(async () => {
  const s = await fetch(`${BASE}/api/v1/listen/sessions/${sessionId}?transcript_tail=30`).then((r) => r.json());
  if (s.brief && s.briefVersion > renderedVersion) renderBrief(s.brief, s.citations, s.briefVersion);
}, 3000);
```

A pure-polling client (no SSE at all) works too — poll a little faster than the throttle's 1.5 s
minimum gap and you will not miss a refresh for long.

### End a session, list sessions

```bash
curl -s -X DELETE $BASE/api/v1/listen/sessions/$SESSION | jq '{status, briefVersion}'
curl -s "$BASE/api/v1/listen/sessions?prospect=progress&limit=10" | jq '.items[] | {id, status, stats}'
```

Ending a session keeps its final brief, citations and stats (for review); it stops accepting new
transcript (`409 Conflict` on a further append) and closes any open SSE stream.

### Driving it from a telephony webhook

A telephony platform's transcription webhook typically delivers one final utterance at a time, from
a server, so it is the simple case: create the session when the call starts, `POST` one `chunks`
entry per webhook delivery with `X-API-Key` (or an admin token) since it is a server-to-server call,
and `DELETE` the session when the call ends. There is nothing telephony-specific in the API to
configure — `speaker` is a free-form string, so use whatever the webhook calls the two legs (e.g.
`"caller"`/`"agent"`).

### Driving it from a browser's own speech recognition

A browser running its own STT (the Web Speech API, or a vendor's realtime WebSocket like ElevenLabs
Scribe) typically produces a stream of interim hypotheses followed by a final one per utterance:
send each interim as `{"text": "...", "final": false}` for live-typing feedback in the UI, and the
committed/final text as `{"final": true}` (the default) once the vendor confirms it — that is
exactly the shape Live's own microphone path uses (`Microphone.connect()` in `public/app/mic.js`),
except the shipped console currently only forwards the *final* transcript to the session and shows
interim text locally rather than sending it — sending interims too is supported by the API and
would make the brief able to react a little earlier, at the cost of the throttle seeing (and
discarding) more near-duplicate windows.

### The admin view

```bash
curl -s -b admin.txt "$BASE/api/v1/admin/listen-sessions?limit=25" | jq '.items[] | {id, prospect, status, stats, briefHistory}'
```

Same session projection as the public API, plus `briefHistory` — every usable refresh this session
has produced (capped at the most recent 20), each with its own `version`, timestamp and latency, so
an operator can see how the brief evolved over the call rather than only its current state.

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

`generative_model` is an optional per-request override (what Live's brief-model picker sends).

### `POST /api/v1/brief` — the stateless brief primitive

This is the primitive a listen session calls internally on every refresh (`ListenService.refresh()`
→ `runBrief()`) — the session API above manages the throttling, the transcript and `prev` for you.
Call it directly when you want a single, one-off structured brief with no session to open or close:
you pass `prev`/`transcript` yourself and decide yourself how often to call it. Rate-limited
separately from `/voice-answer` (`VOICE_BRIEF_RATE_RPS`, default 1 rps with a burst of 5 — the
platform's per-route limiter in `vendor/arag-platform/src/http/app.ts`) because each call is a full
LLM generation and a listening client can otherwise fire it continuously.

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
