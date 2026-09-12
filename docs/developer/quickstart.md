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

Open <http://localhost:8080>. The console opens on the **Ask** tab:

1. Type a question (or click one of the suggested chips) and press **Ask**.
2. You get back the exact line the agent would speak, its citations, the latency breakdown
   (retrieve / first token / total) and whether the turn handed off.
3. The "What just happened" panel lights up each of the nine pipeline steps
   (see [`../architecture/architecture.md`](../architecture/architecture.md)) as they run.
4. Press **Run golden set** to fire all ten golden questions for the current prospect through the
   same pipeline and watch the demo gate open or close live.

Nothing here needs an ElevenLabs key: the Ask tab and the golden-set runner exercise the full turn
pipeline as text. The **Call** and **Listen** tabs are visible but degrade politely — Call reports
"No ElevenLabs agent configured", Listen's mic button works but minting a Scribe token 503s.

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
already been seeded, change it through the admin panel instead (see
[`../business/walkthrough-admin.md`](../business/walkthrough-admin.md)) or add a new prospect.

To light up **Call** (real voice) and **Listen** (ambient Scribe + evolving brief), add:

```bash
ELEVENLABS_API_KEY=<server-side only — never sent to the browser>
```

and give the prospect a real `agent_id` in the registry. See
[`integrations.md`](integrations.md) for the full ElevenLabs agent setup and what each optional
integration needs.

## 3. Your first API call

Every voice platform that can call an HTTP tool can use VoiceBridge — the shipped demo happens to
use ElevenLabs. The one endpoint that matters is `POST /api/v1/voice-answer`:

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

That is the whole product contract in one call. From here:

- [`examples.md`](examples.md) — every public route, with copy-pasteable curl/JS.
- [`../architecture/architecture.md`](../architecture/architecture.md) — the nine-step pipeline
  and the ADRs behind it.
- [`../business/walkthrough-demo.md`](../business/walkthrough-demo.md) — a click-by-click tour of
  the console, including the golden-set runner.
- [`extension-points.md`](extension-points.md) — the onboarding ritual for a new prospect, and
  where to slot in a real moderation classifier or another voice platform.

Public routes are open by default; if you set `API_KEYS`, see
[`../architecture/security-model.md`](../architecture/security-model.md) for the auth modes and
what the demo UI does automatically (`POST /api/v1/session`).
