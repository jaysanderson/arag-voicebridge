# Quickstart

VoiceBridge has zero runtime dependencies and no build step: Node 22.18+ runs the TypeScript
sources directly (erasable syntax only — no enums, no parameter properties). You can be answering
questions against a mock Knowledge Box in under a minute, with no ARAG or ElevenLabs credentials.

## 1. Zero-credential start

```bash
git clone <repo> && cd arag-voice
make install         # bun installs dev tooling only (biome, playwright) — never npm
make dev             # copies .env.example to .env if missing, then starts on :8080
```

`make dev` checks `.env` for `ARAG_API_KEY`. If it is not set, the server starts with
`ARAG_MOCK=1`, which boots an in-process mock ARAG server seeded with eight short documents about
additive manufacturing (`src/services/seed.ts`) — enough for the `progress` prospect's ten-question
golden set to pass with no external calls at all.

Open <http://localhost:8080>. The workspace opens on **Live** — real-time listening (agent-assist) is
the product's hero capability, so it is what you see first:

1. Press **Play sample conversation**. A scripted nine-line discovery call is fed into a listen
   session one line at a time (`SAMPLE` in `public/app/live.js`), exactly as a live caller's words
   would arrive.
2. Watch the transcript fill in on one side and the brief — a caller profile, their inferred goal,
   key points, suggested questions and answers, all grounded in the mock Knowledge Box — build up
   and refine itself on the other, over Server-Sent Events.
3. The session card (turns heard / refreshes / skipped / latency) shows the server-side throttle at
   work: not every line triggers a fresh LLM call — see
   [`../architecture/architecture.md`](../architecture/architecture.md) for why.
4. Press **End and save**, then open **Conversations** to see the same session: its final brief, how
   the brief evolved version by version, the full transcript and its citations. Open **Knowledge** to
   fire a single question through the **Ask it something** tester instead (you get back the exact
   line the agent would speak, its citations, the latency breakdown, and whether the turn handed
   off), or press **Run golden set** to fire all ten golden questions for the current prospect
   through the turn pipeline and watch the gate open or close live.

Nothing here needs an ElevenLabs key: Live's sample conversation and typed-conversation paths, the
Knowledge "ask it something" tester, and the golden-set runner all exercise the full pipeline as
text. Live's **Microphone** starter and its **Voice agent call** drawer are visible but degrade
politely — the microphone stays disabled with "Needs an ElevenLabs key on this deployment," and the
voice-agent drawer explains what to configure — while typing or pasting a conversation into Live
still works with no credentials at all.

## 2. Live credentials

Copy `.env.example` to `.env` (if `make dev` has not already done it for you) and fill in:

```bash
ARAG_KB_ID=<your Knowledge Box id>
ARAG_API_KEY=<your KB service-account token>
ARAG_REGION=aws-us-east-2-1   # or set ARAG_BASE_URL to override the host entirely
```

Then `make dev` again (or just restart it) — leaving `ARAG_API_KEY` set is what tips `make dev`
into starting without `ARAG_MOCK=1`.

The shipped `config/prospects.example.json` carries placeholders rather than anybody's real
identifiers (`DECISIONS.md` V-12). On the **first** boot with an empty `DATA_DIR`, the seeder
substitutes your `ARAG_KB_ID` — and `VOICE_DEFAULT_AGENT_ID`, if you set one — into the first
prospect, so it answers from your own Knowledge Box with no file edits. If the registry has
already been seeded, change it through `/prospects/` instead (unlock editing with `ADMIN_TOKEN` —
see [`../business/walkthrough-admin.md`](../business/walkthrough-admin.md)) or add a new prospect.

To light up Live's **microphone** starter (transcribing you via ElevenLabs Scribe v2 Realtime,
instead of the sample or typed conversation), the optional spoken cue (ElevenLabs text-to-speech),
and the **voice agent call** drawer (ElevenLabs Conversational AI), add:

```bash
ELEVENLABS_API_KEY=<server-side only — never sent to the browser>
```

and give the prospect a real `agent_id` in the registry for the voice-agent call specifically. See
[`integrations.md`](integrations.md) for the full ElevenLabs setup and what each optional
integration needs — none of it is required for the listen-session API itself, which accepts
conversation text from any source.

## 3. Your first API call: real-time listening

A listen session is the hero path: open it once, append conversation as it happens from wherever
it comes from, read the evolving brief. Two calls after creating the session show the whole shape:

```bash
BASE=http://localhost:8080

# Open a session for a prospect.
SESSION=$(curl -s $BASE/api/v1/listen/sessions \
  -H 'Content-Type: application/json' \
  -d '{"prospect": "progress"}' | jq -r '.id')

# Append conversation — final text from any source: a realtime STT stream, a telephony webhook, a
# meeting bot, or someone typing.
curl -s $BASE/api/v1/listen/sessions/$SESSION/transcript \
  -H 'Content-Type: application/json' \
  -d '{"chunks": [
        {"speaker": "caller", "text": "we run a machine shop and need to print stainless steel parts fast"}
      ]}' | jq '{refresh, reason}'
```

```json
{ "refresh": "started", "reason": "ok" }
```

The refresh runs in the background (it is one ARAG call), so give it a moment, then read the
session back:

```bash
sleep 1
curl -s $BASE/api/v1/listen/sessions/$SESSION | jq '{briefVersion, brief, citations}'
```

```json
{
  "briefVersion": 1,
  "brief": {
    "topic": "Metal 3D printing for a machine shop",
    "caller_profile": "Runs a machine shop, evaluating production-volume metal printing.",
    "summary": "The caller wants faster stainless steel part production than machining allows.",
    "key_points": ["..."],
    "suggested_questions": ["..."],
    "suggested_answers": ["..."]
  },
  "citations": [{ "title": "Desktop Metal Shop System", "url": "", "score": 0.81 }]
}
```

A real client would instead open `GET /api/v1/listen/sessions/$SESSION/events` (Server-Sent Events:
`brief` / `transcript` / `status`) rather than polling, and end the call with
`DELETE /api/v1/listen/sessions/$SESSION`. See
[`examples.md`](examples.md#real-time-listening) for the full set — SSE with `EventSource`, the
polling fallback, driving it from a telephony webhook versus a browser's own speech recognition,
and the admin view of a session's brief history.

## 4. A single, stateless turn: `POST /api/v1/voice-answer`

Not every integration wants an ongoing session — a voice agent's custom tool typically wants one
question in, one spoken answer out, with no session to manage. That is `POST /api/v1/voice-answer`,
the second act after listening: every voice platform that can call an HTTP tool can use it — the
shipped demo happens to use ElevenLabs.

```bash
curl -s http://localhost:8080/api/v1/voice-answer \
  -H 'Content-Type: application/json' \
  -d '{
    "prospect": "progress",
    "question": "Tell me about the Desktop Metal PureSinter furnace.",
    "history": []
  }' | jq
```

```json
{
  "answer": "The PureSinter furnace is Desktop Metal's sintering furnace. It debinds and sinters printed metal parts in a single run, with a sealed retort that keeps each batch clean.",
  "citations": [
    { "title": "Desktop Metal PureSinter furnace", "url": "", "score": 0.87 }
  ],
  "handoff": false,
  "latency_ms": { "retrieve": 240, "first_token": 610, "total": 980 }
}
```

Ask something out of scope and it hands off deterministically instead of guessing:

```bash
curl -s http://localhost:8080/api/v1/voice-answer \
  -H 'Content-Type: application/json' \
  -d '{"prospect": "progress", "question": "What is the capital of France?"}' | jq '.handoff, .handoff_reason'
```

```
true
"sentinel"
```

That is the stateless half of the product contract in one call. From here:

- [`examples.md`](examples.md) — real-time listening in full, plus every other public route, with
  copy-pasteable curl/JS.
- [`../architecture/architecture.md`](../architecture/architecture.md) — the nine-step pipeline
  and the ADRs behind it.
- [`../business/walkthrough-demo.md`](../business/walkthrough-demo.md) — a click-by-click tour of
  the workspace, including the golden-set runner.
- [`extension-points.md`](extension-points.md) — the onboarding ritual for a new prospect, and
  where to slot in a real moderation classifier or another voice platform.

Public routes are open by default; if you set `API_KEYS`, see
[`../architecture/security-model.md`](../architecture/security-model.md) for the auth modes and
what the demo UI does automatically (`POST /api/v1/session`).
