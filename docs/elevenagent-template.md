# ElevenAgent template (fixed; cloned per prospect)

This is the **fixed** voice-transport template (SPEC §6.1). Build it once in the ElevenLabs
Conversational AI dashboard; cloning per prospect only changes voice, greeting, locale, and the
`prospect` argument on the tool. The agent is a **router + voice persona** — the *answer* comes
from ARAG via the bridge. It must **speak the tool's `answer` field verbatim** and never
re-summarise (re-summarising re-introduces hallucination and doubles latency).

---

## Settings

| Setting | Value | Why |
|---|---|---|
| **STT** | Scribe v2 Realtime, locale per prospect (default `en-AU`) | streaming, semantic endpointing |
| **Turn-taking** | ElevenAgents turn-taking model (semantic end-of-turn) | tune on the golden set → 0 false interruptions (S3) |
| **Barge-in** | enabled; TTS halts ≤ 200 ms | S2 |
| **TTS** | Eleven Flash v2.5 (~75 ms), voice per prospect | lowest first-audio latency (S1) |
| **Holding phrase** | rotate short fillers on tool dispatch | masks the retrieval+generation gap (S1) |

Because we use a **custom server tool** (webhook), the MCP-only `pre_tool_speech` field does
**not** apply — implement the filler via the agent's tool-call holding-phrase behaviour. Keep a
small rotation so repeats don't sound robotic:

```
"Let me check that."
"One moment — checking the knowledge base."
"Sure, let me look that up."
```

---

## System prompt (agent-level — keep minimal)

```text
You are the voice for {DISPLAY_NAME} support. You are a router, not the answer source.

For ANY factual or support question, you MUST call the `voice-answer` tool. Do not answer factual
questions from your own knowledge — you don't have the knowledge base, the tool does.

When the tool returns, speak its `answer` field VERBATIM. Do not rephrase, summarise, expand, add
to it, or read out any URLs. If the tool returns handoff = true, speak the answer (it is the
handoff line) warmly and, in self-serve mode, hand the caller to a human.

Open the conversation with the configured greeting. Keep your own speech minimal — the tool's
answer is the product.
```

---

## Custom server tool: `voice-answer`

| Field | Value |
|---|---|
| **Type** | Server tool (webhook) |
| **Method** | `POST` |
| **URL** | `{ASK_BRIDGE_URL}/v1/voice-answer` |
| **Timeout** | `AGENT_TOOL_TIMEOUT_MS` (default 8 s) — must be **>** the bridge's `ARAG_TIMEOUT_MS` |
| **Response var to speak** | `answer` |

**Request body mapping** (the agent fills these from the live conversation):

```json
{
  "prospect": "<this prospect's registry key>",
  "question": "{{transcribed_user_utterance}}",
  "conversation_id": "{{conversation_id}}",
  "history": "{{recent_turns_as_USER_NUCLIA_pairs}}"
}
```

- `prospect` is the **only** value that changes when cloning the template.
- `history` should carry the last few turns so follow-ups resolve (the bridge caps it anyway).
- The agent should render citations / `latency_ms` on screen in **agent-assist** mode — the
  control panel already does this when driving the bridge directly.

---

## Cloning checklist (per prospect)

- [ ] Clone template → new agent.
- [ ] Set voice (`voice_id`) + greeting + STT/TTS locale.
- [ ] Set the `voice-answer` tool's `prospect` argument to the registry key.
- [ ] Confirm tool URL points at the deployed bridge (`ASK_BRIDGE_URL`).
- [ ] Copy the new `agent_id` (+ `voice_id`) into `bridge/config/prospects.json` and reload.
- [ ] Tune turn-taking on the golden set until S3 (0 false interruptions) holds.
