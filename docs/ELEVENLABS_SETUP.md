# ElevenLabs setup — step by step

This wires an ElevenLabs **Conversational AI agent** (voice) to the deployed `ask-bridge`, so a
caller can **speak** to the knowledge base and hear grounded, cited answers. The bridge is already
live and doing the hard part; this is the voice wrapper.

- **Bridge URL:** `https://arag-voice-bridge.fly.dev`
- **Tool endpoint the agent calls:** `https://arag-voice-bridge.fly.dev/v1/voice-answer`
- **Prospect for the live KB:** `progress`
- **Time:** ~15 minutes.

> UI labels in the ElevenLabs dashboard shift over time. The **values** below are what matter;
> map them to whatever the current labels are. The architecture (SPEC §6.1): the agent is a
> *router + voice*; the **answer comes from the tool**, and the agent speaks it **verbatim**.

---

## 0. Prerequisites

- An ElevenLabs account with **Conversational AI / Agents** access: <https://elevenlabs.io/app/conversational-ai>.
- Mic permission in your browser for testing.
- You do **not** need to give the bridge your ElevenLabs API key — the agent calls the bridge,
  not the other way round.

---

## 1. Create the agent

1. Go to **Agents** (a.k.a. Conversational AI) → **Create agent** → start from **Blank**.
2. Name it e.g. `ARAG Voice — Progress`.

---

## 2. Agent settings

### First message (the greeting)
```
Hi, thanks for calling. I can help with questions about additive manufacturing and 3D printing systems. What would you like to know?
```

### System prompt (paste verbatim)
This keeps the agent a router that speaks the tool's answer and never invents anything:
```
You are the voice for Progress support. You are a router, not the answer source.

For ANY question the caller asks, you MUST call the `voice_answer` tool. Do not answer questions
from your own knowledge — you do not have the knowledge base, the tool does.

When the tool returns, speak its `answer` field VERBATIM. Do not rephrase, summarise, expand, add
to it, or read out any URLs or citations. If the tool result has `handoff` = true, the `answer`
is a handoff line — say it warmly and offer to connect the caller to a person.

Keep your own speech to a minimum. The tool's answer is the product. Never mention tools, systems,
or that you are an AI.
```

### LLM
Pick a **fast, cheap** model (e.g. GPT-4o mini / Gemini Flash). It only routes to the tool and
relays the result — the *real* reasoning happens in ARAG behind the bridge.

### Voice & TTS
- Choose any voice you like.
- Set the TTS model to **Eleven Flash v2.5** (lowest latency, ~75 ms) — this matters for S1.

### Language / STT
- Language **English (US)** to match the `progress` prospect's locale.
- Use the realtime STT + the proprietary **turn-taking** model (defaults are fine; tune later).

---

## 3. Add the custom tool (`voice_answer`)

In the agent's **Tools** section → **Add tool** → **Webhook / Custom server tool**.

| Field | Value |
|---|---|
| **Name** | `voice_answer` |
| **Description** | `Get the grounded, cited answer to the caller's question from the knowledge base. Call this for every question the caller asks.` |
| **Method** | `POST` |
| **URL** | `https://arag-voice-bridge.fly.dev/v1/voice-answer` |
| **Headers** | `Content-Type: application/json` |
| **Response timeout** | `8` seconds (must be ≥ the bridge's ARAG timeout) |

### Request body parameters

Add these parameters (the agent fills them at call time):

| Parameter | Type | How it's set | Notes |
|---|---|---|---|
| `prospect` | string | **constant** `progress` | Selects the KB/config. The only value that changes if you clone this agent for another prospect. |
| `question` | string | **LLM / dynamic** | The caller's transcribed question. Describe it as: "the caller's most recent question, transcribed." |
| `conversation_id` | string | **system** conversation id | Optional but useful for logs. |
| `history` | array | **LLM**, optional | Recent turns for follow-ups; the bridge caps it. Safe to omit at first. |

If the dashboard lets you paste a JSON schema for the tool body, use this:
```json
{
  "type": "object",
  "required": ["prospect", "question"],
  "properties": {
    "prospect": { "type": "string", "description": "Always the literal string 'progress'." },
    "question": { "type": "string", "description": "The caller's most recent question, transcribed." },
    "conversation_id": { "type": "string", "description": "The conversation id." },
    "history": {
      "type": "array",
      "description": "Recent prior turns.",
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

### What the tool returns
The bridge responds with:
```json
{ "answer": "…", "citations": [ {"title":"…","url":"…","score":0.8} ], "handoff": false,
  "latency_ms": { "retrieve": 210, "first_token": 540, "total": 760 } }
```
The agent should **speak the `answer` field verbatim** (the system prompt above enforces this).
`citations`, `handoff`, and `latency_ms` are extra data — handy for an agent-assist screen.

### Holding phrase (so there's no dead air while the tool runs)
If the dashboard has a "tool-call message" / "filler while running" option, set a short rotation:
```
Let me check that.
One moment — checking the knowledge base.
Sure, let me look that up.
```
If there's no such field, add a line to the system prompt: *"Before calling the tool, say a brief
filler like 'let me check that'."*

---

## 4. Save, test, and grab the IDs

1. **Save** the agent.
2. Use the dashboard's **Test / Talk** button and ask: *"Tell me about the Desktop Metal PureSinter
   furnace."* You should hear a 2–3 sentence grounded answer. Then ask *"What's the capital of
   France?"* — it should hand off, not answer.
3. Copy the **Agent ID** (top of the agent page). Optionally copy the **Voice ID** from voice settings.

---

## 5. Show the live voice widget on the web UI

The deployed control panel (`https://arag-voice-bridge.fly.dev`) auto-mounts the ElevenLabs voice
widget as soon as the `progress` prospect has a real `agent_id`.

1. Edit [`bridge/config/prospects.json`](../bridge/config/prospects.json), in the `progress` entry:
   ```json
   "agent_id": "YOUR_AGENT_ID",
   "voice_id": "YOUR_VOICE_ID"
   ```
2. Redeploy: from `bridge/`, run `fly deploy --remote-only -a arag-voice-bridge`.
3. Open `https://arag-voice-bridge.fly.dev` — the **Voice console** now shows a live "talk" button,
   and the **transcript/citation/latency** panel works alongside it.

### Embed the widget anywhere else (optional)
Make the agent **public** in its settings, then paste this snippet into any web page:
```html
<elevenlabs-convai agent-id="YOUR_AGENT_ID"></elevenlabs-convai>
<script src="https://unpkg.com/@elevenlabs/convai-widget-embed" async type="text/javascript"></script>
```

---

## 6. Notes & gotchas

- **Reachability:** the agent calls the bridge from ElevenLabs' cloud, so the bridge must be public
  — it is (`https://arag-voice-bridge.fly.dev`). `localhost` would not work for the voice path.
- **Latency:** the bridge answers in ~2–3 s; the holding phrase masks it. If a demo feels slow,
  the levers are in the registry (`reranker`, `max_tokens`, `generative_model`, `temperature`) and
  in the agent (Flash v2.5 TTS, fast routing LLM).
- **Citations on voice:** you can't *speak* a URL, which is the point of the agent-assist view — the
  web panel shows citation chips next to the conversation. Lead enterprise demos with that screen.
- **Cloning for another prospect:** duplicate the agent, change only the voice, greeting, and the
  `prospect` constant in the tool body — everything else is identical (SPEC §11).
- **Auth (optional hardening):** the bridge endpoint is currently open. For a public demo you can
  add a shared-secret header check to the bridge and set the same header in the tool config.
