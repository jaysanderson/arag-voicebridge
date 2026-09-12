# VoiceBridge

**Grounded, cited and governed voice answers over Progress Agentic RAG (ARAG).**

A voice agent that can say anything will eventually say something wrong. VoiceBridge is the
service between a voice agent and a Knowledge Box that makes sure it doesn't: every spoken answer
comes from retrieved content, anything the knowledge base cannot support is handed to a human by a
deterministic rule rather than a model's judgement, and every turn is measured.

- **API-first.** One endpoint answers a turn: `POST /api/v1/voice-answer`. Any voice platform that
  can call an HTTP tool can use it (the shipped demo uses ElevenLabs Conversational AI).
- **Never dead air.** Upstream timeouts, errors and empty retrievals all degrade to the prospect's
  configured handoff line inside the agent's tool timeout.
- **Speakable by construction.** Answers are shaped for text-to-speech: ≤ 3 sentences, no URLs, no
  markdown, no citation markers. Citations are returned as data and shown on screen, never read out.
- **Multi-tenant.** A prospect registry maps each caller-facing brand to its own Knowledge Box,
  prompt, voice and golden set. Adding one is an admin API call, not a redeploy.
- **Provable.** A golden set per prospect runs through the same pipeline and gates the demo.

Zero runtime dependencies. Node 22.18+ runs the TypeScript sources directly — no build step.

## Quick start (no credentials needed)

```bash
make install         # bun installs dev tooling only (never npm)
make dev             # starts on :8080 with the in-process mock ARAG + a small demo corpus
open http://localhost:8080
```

The console opens on the **Ask** tab: type a question (or click a suggestion) and you get the exact
line the agent would speak, its citations, the latency breakdown and whether it handed off. Press
**Run golden set** to watch all ten golden questions go through the pipeline.

With real credentials, copy `.env.example` to `.env`, fill in `ARAG_KB_ID`, `ARAG_API_KEY` and
`ARAG_REGION`, then `make dev` again. Add `ELEVENLABS_API_KEY` and an agent id to enable the Call
and Listen tabs.

| Surface | URL | Notes |
|---|---|---|
| Demo console | `/` | Ask · Call · Listen · Golden set; consumes only `/api/v1` |
| Admin panel | `/admin/` | Sign in with `ADMIN_TOKEN` |
| API reference | `/api/v1/docs` · `/api/v1/swagger` | Generated from `src/openapi.ts` |
| OpenAPI document | `/api/v1/openapi.json` | Source of truth for validation and contract tests |
| Health | `/healthz` · `/readyz` | Readiness includes an ARAG connection check |

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
