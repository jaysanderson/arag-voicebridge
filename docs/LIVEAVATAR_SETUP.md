# LiveAvatar (HeyGen) video avatar — setup

Adds a **live talking video avatar** to the demo. The avatar (HeyGen/LiveAvatar) streams as video
over **LiveKit**, *alongside* the ElevenLabs voice agent — it is **not** part of the `<elevenlabs-convai>`
widget. The bridge already has the full integration built; it stays **dormant** until the secrets
below are set (the `/v1/avatar/session` endpoint returns 503 and the UI hides the **Avatar** toggle
until then).

> Architecture: browser → `POST /v1/avatar/session` → bridge mints a **LiveKit** room + viewer token,
> starts a LiveAvatar **LITE** session pointed at that room, and returns `{livekit_url, room, token}`.
> The browser joins the room (publishes mic, renders the avatar's video). LiveAvatar's worker bridges
> the **ElevenLabs agent** ↔ room, so the avatar speaks the agent's (grounded, bridge-backed) answers.

## Prerequisites (all paid except LiveKit's free tier)

1. **Paid ElevenLabs plan** + an API key (Settings → API Keys) with scopes `convai_read`,
   `user_read`, `voices_read`. The free tier blocks third-party use.
2. **HeyGen / LiveAvatar account** + a **LiveAvatar API key**, and an **`avatar_id`** (which face).
3. **LiveKit Cloud** project (free tier is fine): its `wss://…livekit.cloud` URL, an **API key**, and
   an **API secret**.
4. The ElevenLabs **agent's audio set to PCM 24000 Hz** — in the agent: *Voice → TTS output format*
   and *Advanced → User input audio format* both `pcm_24000`. (LiveAvatar requires this.)

## Configure

Set these as Fly secrets (never in the repo):
```bash
fly secrets set \
  LIVEAVATAR_API_KEY='…' \
  LIVEKIT_URL='wss://your-project.livekit.cloud' \
  LIVEKIT_API_KEY='…' \
  LIVEKIT_API_SECRET='…' \
  ELEVENLABS_API_KEY='…' \
  -a arag-voice-bridge
# (or set LIVEAVATAR_ELEVENLABS_SECRET_ID instead of ELEVENLABS_API_KEY if you pre-registered it)
```
Add the avatar to the prospect in [`bridge/config/prospects.json`](../bridge/config/prospects.json):
```json
"progress": { …, "avatar_id": "YOUR_HEYGEN_AVATAR_ID" }
```
Then `fly deploy` from `bridge/`. The **Avatar** toggle appears in the Voice console; click
**Start avatar call**.

## Verify at integration time (live API)

LiveAvatar's exact request/response shapes are behind a paid API. They're isolated in
[`bridge/src/liveavatar.ts`](../bridge/src/liveavatar.ts), with the endpoint paths overridable via
`LIVEAVATAR_SECRETS_PATH` / `LIVEAVATAR_SESSION_PATH`. On first wiring, confirm against the live API:
- the **secrets** endpoint returns a `secret_id` (we read `secret_id`/`id`/`data.secret_id`);
- the **session** endpoint accepts `{ mode:"LITE", avatar_id, elevenlabs_agent_config:{secret_id,
  agent_id}, custom_livekit_config:{livekit_url, livekit_room, livekit_client_token} }`;
- if the field names differ, adjust only `liveavatar.ts` — nothing else changes.

This mirrors how the ARAG `/ask` NDJSON schema was verified live at M0 (see docs/IMPLEMENTATION.md).
