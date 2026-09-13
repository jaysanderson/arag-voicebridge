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

| Integration | Env vars (defaults — see [`settings.md`](settings.md) for the live store) | Powers | Degrades to when unset |
|---|---|---|---|
| ARAG | `ARAG_KB_ID`, `ARAG_API_KEY`, `ARAG_REGION` (or `ARAG_BASE_URL`), or `ARAG_MOCK=1` | Everything | Boot fails (`assertAragEnv()`) unless `ARAG_MOCK=1` |
| ElevenLabs | `ELEVENLABS_API_KEY` | Live's microphone (Scribe v2 Realtime STT feeding a session), the voice-agent call drawer (Conversational AI, configured from Settings), the optional spoken cue and voice list (text-to-speech) | The listen-session API, the Knowledge "ask it something" tester and the golden-set runner still work fully via the sample/typed conversation; `/api/v1/scribe-token`, `/api/v1/speech`, `/api/v1/voices` and `POST /api/v1/admin/voice-agent/push` return 503. The two `GET …/voice-agent` reads answer 200 whatever the key situation — the configuration they describe is non-secret, and it is most useful *before* you have a key |

## ElevenLabs — the default voice and transcription stack

One `ELEVENLABS_API_KEY` lights up three independent capabilities, each isolated in its own service
module and each optional on its own — none of them is required for another:

- **Scribe v2 Realtime** (`src/services/scribe.ts`) — live microphone transcription in Live.
- **Conversational AI** (`src/services/voiceAgent.ts`) — the voice-agent call drawer, opened from
  Live, for speaking to the knowledge base directly.
- **Text-to-speech** (`src/services/tts.ts`, `POST /api/v1/speech`) — the opt-in toggle in Live that
  reads the brief's next suggested line aloud into the handler's own ear, never into the call.

`GET /api/v1/voice-agent?prospect=<key>` is the read-only, non-admin preview of what this prospect's
agent should look like — the custom-server-tool definition and router system prompt, derived from
the registry rather than hand-copied from a document. The voice-agent call drawer in Live shows a
short summary of it (agent id, tool method/URL, tool timeout). But wiring the agent up is no longer
a copy-paste exercise: `GET /api/v1/admin/voice-agent?prospect=<key>` compares that same desired
configuration against what ElevenLabs actually has right now (agent found or not, greeting, system
prompt, tool URL/method/timeout, whether the `X-API-Key` header and the tool link are in place) and
`POST /api/v1/admin/voice-agent/push` writes it — Settings → Integrations is the UI for this diff-
and-push flow. Both read from the prospect's own `agent_id`/`tool_id`/`voice_id`, so cloning the
setup for another prospect is a registry change, not a code change.

### Conversational AI (the voice-agent call)

This wires an ElevenLabs agent to a deployed VoiceBridge so a caller can **speak** to the knowledge
base and hear grounded, cited answers. VoiceBridge does the hard part; this is the voice wrapper.
The agent is a **router + voice persona** — the answer comes from ARAG via VoiceBridge, and the
agent must speak the tool's `answer` field verbatim.

### Prerequisites

- An ElevenLabs account with Conversational AI / Agents access, and `ELEVENLABS_API_KEY` set on this
  deployment (Settings → ElevenLabs, or the environment variable as its default).
- VoiceBridge deployed somewhere reachable from ElevenLabs' cloud — `localhost` does not work for
  the voice path, only for Knowledge's "ask it something" tester. The tool's response timeout
  (`AGENT_TOOL_TIMEOUT_MS`) must exceed the bridge's own turn budget (`VOICE_TURN_TIMEOUT_MS`) —
  Settings rejects a change that would break that invariant (see [`settings.md`](settings.md)).
- At least one active API key (Settings → API keys, or `POST /api/v1/admin/api-keys`) if you want
  the pushed tool to carry an `X-API-Key` header — recommended once this stops being a controlled
  demo audience (see [`../architecture/security-model.md`](../architecture/security-model.md)).

### Configure it from Settings (the primary path)

1. Open Settings → Integrations for the prospect and confirm ElevenLabs shows configured (a key is
   set) and an API key exists to hand to the tool.
2. The panel calls `GET /api/v1/admin/voice-agent?prospect=<key>` and renders the diff: whether the
   agent exists yet, and, field by field, what this deployment wants versus what ElevenLabs
   currently has (`AgentDiffRow[]` — `agent_id`, greeting, system prompt, tool URL/method/timeout,
   the `X-API-Key` header, and whether the tool is linked to the agent).
3. Press **Push**. `POST /api/v1/admin/voice-agent/push` writes the tool first (creating one if the
   prospect has none, otherwise patching it), then the agent (creating one if `agent_id`/
   `VOICE_DEFAULT_AGENT_ID` is empty, otherwise patching it and linking the tool) — merging into
   whatever ElevenLabs already has, so turn-taking, ASR and evaluation configuration this product
   does not own survives the write. The response records the created/updated agent and tool ids
   back onto the prospect (`agent_id`, `tool_id`, `agent_api_key_id`), so a second push is a patch,
   not a second create.
4. Test it: the dashboard's own Test/Talk button, or Live's **voice agent call** drawer, should now
   get a 2–3 sentence grounded answer to an in-scope question and a handoff to an out-of-scope one.

Cloning for another prospect is the same two steps against a different prospect key — nothing in
VoiceBridge itself changes (see [`extension-points.md`](extension-points.md) for the full
per-prospect onboarding ritual).

### If you'd rather configure it by hand

The dashboard remains a valid fallback — useful for a first look at what gets created, or when a
deployment cannot reach ElevenLabs' API from wherever Settings is being operated:

1. **Create the agent** — Agents (Conversational AI) → Create agent → Blank.
2. **Agent settings** — a short greeting, the router system prompt from
   [`examples.md`](examples.md#the-elevenlabs-agent-tool-definition), a fast/cheap LLM (it only
   routes to the tool and relays the result — the real reasoning happens in ARAG), and **Eleven
   Flash v2.5** as the TTS model (lowest first-audio latency).
3. **Add the custom tool** (`voice_answer`) — Tools → Add tool → Webhook/Custom server tool, method
   `POST`, URL `{BRIDGE_URL}/api/v1/voice-answer`, using the request-body schema from
   [`examples.md`](examples.md#the-elevenlabs-agent-tool-definition) — every property in that schema
   needs a `description`, or ElevenLabs rejects the tool (422; see "Notes" below).
4. **Holding phrase** — if the dashboard exposes a tool-call filler / "message while running"
   field, set a short rotation ("Let me check that.", "One moment — checking the knowledge base.")
   so there is no dead air while VoiceBridge runs the turn; otherwise add a line to the system
   prompt asking the agent to say a brief filler before calling the tool.
5. **Save, test, copy the agent id and the tool id.**
6. **Wire it into the registry** — set the prospect's `agent_id`/`tool_id` (and optionally
   `voice_id`) through `/prospects/` (unlocked with `ADMIN_TOKEN`) or `PUT /api/v1/admin/prospects/{key}`
   (see [`examples.md`](examples.md#prospect-crud)). From here, a future push from Settings adopts
   and patches these ids instead of creating new ones.

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
  does not expose, and mint an API key (Settings → API keys, or `POST /api/v1/admin/api-keys`) if
  the deployment needs to close that off.

**Three live-API constraints the push (and the manual path) both have to respect** — found by
`make agent-check`'s throwaway-agent verification against the real ElevenLabs API, not by the unit
suite, and now each a named regression test as well as a fix:

1. **Every `request_body_schema` property needs a `description`.** ElevenLabs rejects a tool schema
   with a bare property — including a nested one, like `history[].author` — with a 422. This is why
   every field in the schema in
   [`examples.md`](examples.md#the-elevenlabs-agent-tool-definition), nested ones included, carries
   one.
2. **A patch must not send both the deprecated inline `tools` array and `tool_ids`.** A `GET` on an
   existing agent can return both; sending both back on a `PATCH` is refused with a 400 ("Cannot
   specify both tools and tool IDs"). `pushAgent()` (`src/services/elevenAgent.ts`) speaks `tool_ids`
   only and drops the inline `tools` copy from what it sends back.
3. **Deleting a tool a linked agent still references needs `force`.** `DELETE
   /v1/convai/tools/{id}` 409s ("Tool is still in use") without `?force=true` — the throwaway-agent
   check deletes the agent first, then the tool, with `force` set, since by then nothing should be
   referencing it.

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

