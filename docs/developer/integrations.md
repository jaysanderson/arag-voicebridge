# Integrations

The real-time listening API (`POST /api/v1/listen/sessions` and its transcript/events/end routes,
see [`examples.md`](examples.md#real-time-listening)) is deliberately transcription-source-agnostic
— it accepts conversation chunks from anywhere, and nothing in its request or response shapes
(`TranscriptChunk`, `ListenSession`) names a vendor. Likewise `POST /api/v1/voice-answer` is plain
JSON with no vendor-specific shape. Everything in this page is about the integrations layered on top
of that vendor-neutral core — and one of them, ElevenLabs, is not merely supported but the **default
voice and transcription stack** the product ships with: set `ELEVENLABS_API_KEY` and Live's
microphone, the voice-agent call and the optional spoken cue are all ElevenLabs-powered with no
further wiring. Without it, the product still works end to end via the sample conversation, typed
text, and a telephony webhook or any other STT posting into the same session API.

VoiceBridge has exactly one required upstream — ARAG — and two optional ones. Each optional
integration is fully dormant until its environment variables are set: the routes it powers return
`503` with a message naming the missing variable, and the workspace hides or degrades the
corresponding control instead of erroring — `GET /api/v1/integrations` (Settings → Integrations, in
the workspace) reports exactly which capabilities are configured and which are unavailable, for a
given deployment, without ever exposing a secret.

| Integration | Env vars | Powers | Degrades to when unset |
|---|---|---|---|
| ARAG | `ARAG_KB_ID`, `ARAG_API_KEY`, `ARAG_REGION` (or `ARAG_BASE_URL`), or `ARAG_MOCK=1` | Everything | Boot fails (`assertAragEnv()`) unless `ARAG_MOCK=1` |
| ElevenLabs | `ELEVENLABS_API_KEY` | Live's microphone (Scribe v2 Realtime STT feeding a session), the voice-agent call drawer (Conversational AI), the optional spoken cue and voice list (text-to-speech) | The listen-session API, the Knowledge "ask it something" tester and the golden-set runner still work fully via the sample/typed conversation; `/api/v1/scribe-token`, `/api/v1/speech`, `/api/v1/voice-agent` and `/api/v1/voices` return 503 |
| LiveAvatar + LiveKit | `LIVEAVATAR_API_KEY`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` (+ ElevenLabs key/secret) | `POST /api/v1/avatar/sessions`, for a custom client | Returns 503; no view in the shipped workspace calls it either way — see the note below |

## ElevenLabs — the default voice and transcription stack

One `ELEVENLABS_API_KEY` lights up three independent capabilities, each isolated in its own service
module and each optional on its own — none of them is required for another:

- **Scribe v2 Realtime** (`src/services/scribe.ts`) — live microphone transcription in Live.
- **Conversational AI** (`src/services/voiceAgent.ts`) — the voice-agent call drawer, opened from
  Live, for speaking to the knowledge base directly.
- **Text-to-speech** (`src/services/tts.ts`, `POST /api/v1/speech`) — the opt-in toggle in Live that
  reads the brief's next suggested line aloud into the handler's own ear, never into the call.

`GET /api/v1/voice-agent?prospect=<key>` is the single in-product source of truth for wiring the
agent: it returns the exact custom-server-tool definition and router system prompt to paste into the
ElevenLabs dashboard, derived from the registry rather than hand-copied from a document — Settings →
Integrations renders the same response for the selected prospect, and the voice-agent call drawer in
Live shows a shorter summary of it (agent id, tool method/URL, tool timeout). Both read from the
prospect's own `agent_id`/`voice_id`, so cloning the setup for another prospect is a registry change,
not a code change.

### Conversational AI (the voice-agent call)

This wires an ElevenLabs agent to a deployed VoiceBridge so a caller can **speak** to the knowledge
base and hear grounded, cited answers. VoiceBridge does the hard part; this is the voice wrapper.
The agent is a **router + voice persona** — the answer comes from ARAG via VoiceBridge, and the
agent must speak the tool's `answer` field verbatim (see `GET /api/v1/voice-agent`, or
[`examples.md`](examples.md#the-elevenlabs-agent-tool-definition), for the exact tool schema and
system prompt to paste in).

### Prerequisites

- An ElevenLabs account with Conversational AI / Agents access.
- VoiceBridge deployed somewhere reachable from ElevenLabs' cloud — `localhost` does not work for
  the voice path, only for Knowledge's "ask it something" tester. The tool's response timeout must exceed
  `VOICE_TURN_TIMEOUT_MS` (see the table in `.env.example`).

### Steps

1. **Create the agent** — Agents (Conversational AI) → Create agent → Blank.
2. **Agent settings** — a short greeting, the router system prompt from
   [`examples.md`](examples.md#the-elevenlabs-agent-tool-definition), a fast/cheap LLM (it only
   routes to the tool and relays the result — the real reasoning happens in ARAG), and **Eleven
   Flash v2.5** as the TTS model (lowest first-audio latency).
3. **Add the custom tool** (`voice_answer`) — Tools → Add tool → Webhook/Custom server tool, method
   `POST`, URL `{BRIDGE_URL}/api/v1/voice-answer`, using the request-body schema from
   [`examples.md`](examples.md).
4. **Holding phrase** — if the dashboard exposes a tool-call filler / "message while running"
   field, set a short rotation ("Let me check that.", "One moment — checking the knowledge base.")
   so there is no dead air while VoiceBridge runs the turn; otherwise add a line to the system
   prompt asking the agent to say a brief filler before calling the tool.
5. **Save, test, copy the agent id** — the dashboard's Test/Talk button should get a 2–3 sentence
   grounded answer to an in-scope question and a handoff to an out-of-scope one.
6. **Wire it into the registry** — set the prospect's `agent_id` (and optionally `voice_id`)
   through `/prospects/` (unlocked with `ADMIN_TOKEN`) or `PUT /api/v1/admin/prospects/{key}` (see
   [`examples.md`](examples.md#prospect-crud)). Live's **voice agent call** drawer then shows a
   working "Start call" button for that prospect.

Cloning for another prospect changes exactly the `prospect` constant in the tool body, plus the
agent's voice/greeting/locale — nothing in VoiceBridge itself changes (see
[`extension-points.md`](extension-points.md) for the full per-prospect onboarding ritual).

### Notes

- The bridge answers in roughly 1–3 seconds against a fast model with a `noop` or `predict`
  reranker; the holding phrase masks that. If a demo feels slow, the levers are `reranker`,
  `max_tokens`, `generative_model` and `temperature` on the prospect (or in the stored ARAG search
  configuration — see [`../architecture/arag-integration.md`](../architecture/arag-integration.md)).
- You cannot *speak* a URL or a citation marker — that is exactly why citations are returned as
  data and rendered as chips in Live and Conversations rather than read aloud.
- The bridge endpoint itself has no agent-specific auth: anyone who can reach it and knows a
  prospect key can call `/api/v1/voice-answer`. See
  [`../architecture/security-model.md`](../architecture/security-model.md) for what that does and
  does not expose, and set `API_KEYS` if the deployment needs to close that off.

### Scribe v2 Realtime — the default microphone transcription

Live's microphone starter is one concrete transcription source among many, and it is ElevenLabs
Scribe v2 Realtime by default: the browser streams microphone audio to ElevenLabs' speech-to-text
over a direct browser→ElevenLabs WebSocket (`Microphone` class, `public/app/mic.js`), and as each
partial/committed transcript arrives it is appended to the open listen session with
`POST /api/v1/listen/sessions/{id}/transcript` (`sendChunks()` in `public/app/live.js`) — exactly the
same call a telephony webhook or a meeting bot would make. VoiceBridge itself never sees or touches
audio; Scribe's job ends the moment it hands back text. Live shows the connection state, the
detected language and the latency of the last final transcript alongside the transcript itself
(`ELEVENLABS_SCRIBE_MODEL`, default `scribe_v2_realtime`, picks the model).

The browser must never hold the ElevenLabs API key, so VoiceBridge mints a **single-use, 15-minute**
Scribe token server-side (`src/services/scribe.ts`, `POST /api/v1/scribe-token`) that the browser
passes as the `token` query parameter when it opens the Scribe WebSocket directly. That route
always requires a session/API key/admin token (even with `API_KEYS` unset — minting credentials is
never anonymous, `DECISIONS.md` V-06) and is rate-limited on its own budget
(`VOICE_SCRIBE_RATE_RPS`, default 0.2 rps) because each token spends ElevenLabs quota.

Requires only `ELEVENLABS_API_KEY`. Without it, `/api/v1/scribe-token` and `/api/v1/voices` both
503 and Live's microphone starter stays disabled with "Needs an ElevenLabs key on this deployment"
rather than hanging — the session API underneath it is entirely unaffected, so the sample
conversation, typed/pasted conversation, and any external caller posting transcript chunks keep
working.

### Text-to-speech — the optional spoken cue

With Live's **Read the next line aloud** toggle on, each brief update sends the single most useful
line (a suggested answer, or failing that a suggested question) to `POST /api/v1/speech`
(`src/services/tts.ts`), which synthesises it server-side with ElevenLabs text-to-speech
(`ELEVENLABS_TTS_MODEL`, default `eleven_flash_v2_5`, for low first-audio latency) and returns audio
for the browser to play into the handler's own ear — nothing is ever injected into the call. The
voice used is `ELEVENLABS_TTS_VOICE_ID` unless the prospect has its own `voice_id`. The route is
rate-limited on its own budget (`VOICE_TTS_RATE_RPS`/`VOICE_TTS_RATE_BURST`) because synthesis costs
per character, and 503s cleanly (toggling the switch back off) when `ELEVENLABS_API_KEY` is unset.

## LiveAvatar (HeyGen) + LiveKit — video avatar, API-only in this build

Adds a live talking video avatar alongside the ElevenLabs voice agent. The integration is fully
built server-side (`src/services/liveavatar.ts`, `src/services/livekit.ts`,
`POST /api/v1/avatar/sessions`) and stays dormant until every one of its variables is set — but,
unlike Scribe, Conversational AI and text-to-speech, this workspace has no pane or toggle that calls
it: the route exists for a custom client (an agent desktop, a case system) to start an avatar
session and render it itself. `GET /api/v1/integrations` still reports whether it's configured, for
that client to check.

```
Browser ──POST /api/v1/avatar/sessions──▶ VoiceBridge
                                             │ mints a LiveKit room + two JWTs (node:crypto, HS256 —
                                             │ no LiveKit server SDK needed)
                                             │ starts a LiveAvatar LITE session pointed at that room
                                             ▼
                                        LiveAvatar worker joins the room, bridges the ElevenLabs
                                        agent's audio, and publishes the avatar's video
                                             │
Browser ◀── joins the LiveKit room, renders the avatar's video, publishes its own mic ──┘
```

### Prerequisites (all paid, except LiveKit's free tier)

1. A **paid** ElevenLabs plan (the free tier blocks third-party use) with an API key scoped
   `convai_read`, `user_read`, `voices_read`.
2. A **HeyGen/LiveAvatar** account, API key, and an `avatar_id` (which face).
3. A **LiveKit Cloud** project (free tier is fine): its `wss://…livekit.cloud` URL, API key and API
   secret.
4. The ElevenLabs agent's audio format set to **PCM 24000 Hz** on both TTS output and user input —
   LiveAvatar requires it.

### Configure

```bash
LIVEAVATAR_API_KEY=…
LIVEAVATAR_API_BASE=https://api.liveavatar.com/v1   # default
LIVEAVATAR_SECRETS_PATH=/secrets                    # default
LIVEAVATAR_SESSION_PATH=/sessions                   # default
LIVEAVATAR_ELEVENLABS_SECRET_ID=…                   # pre-registered, or leave empty to register on first use
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=…
LIVEKIT_API_SECRET=…
ELEVENLABS_API_KEY=…                                # needed if LIVEAVATAR_ELEVENLABS_SECRET_ID is unset
```

Give the prospect an `avatar_id` (`PUT /api/v1/admin/prospects/{key}` or `/prospects/`'s JSON
editor). `POST /api/v1/avatar/sessions` then 400s until the prospect also has an `agent_id` — both
are required. On Fly, set these with `fly secrets set …`, never in `fly.toml`.

### Live-verify note

LiveAvatar's exact request/response field names are behind a paid, gated API. They are correct in
*structure* per the public docs but isolated entirely inside `src/services/liveavatar.ts` — the
secrets endpoint is expected to return a `secret_id` (read tolerantly as
`secret_id`/`id`/`data.secret_id`), and the session endpoint is called with
`{ mode: "LITE", avatar_id, elevenlabs_agent_config: {secret_id, agent_id},
custom_livekit_config: {livekit_url, livekit_room, livekit_client_token} }`. Endpoint paths are
env-overridable (`LIVEAVATAR_SECRETS_PATH`, `LIVEAVATAR_SESSION_PATH`) specifically so that if the
live API drifts from this structure, only `liveavatar.ts` needs to change. This mirrors how the
ARAG `/ask` NDJSON item shapes were pinned down against a live Knowledge Box during the original
build — see [`../architecture/limits.md`](../architecture/limits.md) for the current confidence
level on this integration (it has not been exercised against a real LiveAvatar account since the
platform rewrite).
