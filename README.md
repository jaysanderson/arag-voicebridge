# VoiceBridge

**Live, grounded context for people on calls — and for the agents that take them.**

A person on a live call cannot read the manual while listening, and an assistant that invents an
answer is worse than none. VoiceBridge listens to a conversation as it happens and keeps one
evolving brief in front of whoever is handling it: who they are speaking to, what that person
wants, the facts that matter right now — each traceable to a document in a Knowledge Box — and what
to ask or say next. The same grounding can answer a caller directly when nobody is available.

- **Listening is a session, not a widget.** `POST /api/v1/listen/sessions`, then append transcript
  chunks from **any** source — a realtime STT stream, a telephony webhook, a meeting bot, or
  someone typing — and read the evolving brief over SSE. The throttling lives on the server, so
  every client gets the same behaviour and the same cost profile.
- **Grounded or silent.** Everything factual in a brief comes from retrieved content, with the
  sources listed. Nothing is asserted that the Knowledge Box cannot support.
- **Answer directly when needed.** `POST /api/v1/voice-answer` runs the nine-step turn pipeline for
  a voice agent: safety guards, retrieval, a deterministic handoff rule, voice shaping, citations.
  Any platform that can call an HTTP tool can use it (the demo uses ElevenLabs Conversational AI).
- **Never dead air.** Upstream timeouts, errors and empty retrievals degrade to the prospect's
  configured handoff line inside the agent's tool timeout.
- **Multi-tenant.** A prospect registry maps each brand to its own Knowledge Box, prompt, voice and
  golden set. Adding one is an admin API call, not a redeploy.
- **Provable.** A golden set per prospect runs through the same pipeline and gates the demo.

Zero runtime dependencies. Node 22.18+ runs the TypeScript sources directly — no build step.

## Quick start (no credentials needed)

```bash
make install         # bun installs dev tooling only (never npm)
make dev             # starts on :8080 with the in-process mock ARAG + a small demo corpus
open http://localhost:8080
```

The console opens on the **Listen** tab. Press **Play sample conversation** and watch the brief
build and then change as a scripted discovery call unfolds — caller profile, their goal, the key
points from the knowledge base, what to ask next, and the sources underneath. Or paste a
conversation of your own into the box. The **Ask** tab shows the same grounding answering a
question directly, and **Run golden set** puts all ten golden questions through the pipeline.

With real credentials, copy `.env.example` to `.env`, fill in `ARAG_KB_ID`, `ARAG_API_KEY` and
`ARAG_REGION`, then `make dev` again. Add `ELEVENLABS_API_KEY` and an agent id to enable the Call
and Listen tabs.

| Surface | URL | Notes |
|---|---|---|
| Demo console | `/` | Listen · Ask · Call · Golden set; consumes only `/api/v1` |
| Admin panel | `/admin/` | Sign in with `ADMIN_TOKEN` |
| API reference | `/api/v1/docs` · `/api/v1/swagger` | Generated from `src/openapi.ts` |
| OpenAPI document | `/api/v1/openapi.json` | Source of truth for validation and contract tests |
| Health | `/healthz` · `/readyz` | Readiness includes an ARAG connection check |

## How listening works

```
transcript chunks ──▶ rolling window ──▶ throttle (gap · dedupe) ──▶ ARAG ask (answer_json_schema)
   (any source)                                    │                              │
                                            skipped, cheaply          brief + citations + latency
                                                                                  │
                                              SSE: brief | transcript | status ◀──┘
```

Chunks arrive as fast as the transcription produces them. A refresh only happens when the last
~28 words have actually moved on (a minimum gap of 1.5 s, a similarity check against the previous
window), so a chatty client cannot turn every word into an LLM call. Each refresh receives the
previous brief and the conversation so far, so the brief is *refined*, never restarted.

## How a turn works

```
voice agent ──POST /api/v1/voice-answer──▶ input guard ─▶ ARAG /ask (stream) ─▶ handoff decision
                                                                                      │
        spoken line ◀── output guard ◀── citations ◀── voice shaping ◀─────────────────┘
```

1. **Input guard** — length, prompt-injection and out-of-scope checks, before anything leaves the box.
2. **Request build** — the voice prompt (or the prospect's stored ARAG search configuration),
   conversation context clamped to `MAX_HISTORY_TURNS`, reranker and token limits.
3. **ARAG `/ask`** — streamed NDJSON; retrieval, answer chunks and citations.
4. **Handoff decision** — the prompt is contracted to answer `HANDOFF: …` when the context does not
   cover the question; an empty answer or empty retrieval also hands off. This is a string check,
   not a judgement call.
5. **Voice shaping** — strip markup, URLs and citation markers; clamp to three sentences.
6. **Citations** — deduped, scored, capped at four; returned as data.
7. **Output guard** — last line of defence before text-to-speech.
8. **Metrics** — latency, handoff reason, citation count and guard trips land in the turn log.

## Common tasks

```bash
make check                     # biome + tsc + tests with the 80% coverage gate
make e2e                       # Playwright: console + admin against the mock
make eval P=progress           # run a prospect's golden set against a running server
make provision P=progress      # write the prospect's stored ARAG search configuration
make smoke                     # OPT-IN live check: 3 golden questions against the real KB
make docker && make fly-validate
```

## Documentation

Start at [`docs/README.md`](docs/README.md): developer (quickstart, API reference, examples,
extension points, local dev), architecture (diagram, ARAG integration, data flow, deployment,
security model, scaling, limits), business (overview, when to use, walkthroughs, FAQ) and
product marketing. Hands-on material is in [`enablement/`](enablement/), and the demo script and
recording live in [`showcase/`](showcase/).

## Licence

Apache-2.0. See `LICENSE` and `THIRD_PARTY_NOTICES.md`.
