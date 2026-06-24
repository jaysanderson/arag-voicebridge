# ARAG × ElevenAgents — Voice Demo Build Specification
**A repeatable, world-class conversational voice demo over Progress Agentic RAG (ARAG).**

| | |
|---|---|
| **Owner** | Jay Sanderson (Vested Technology) |
| **Audience** | Engineering team building the demo |
| **Status** | Build-ready spec, v1.0 |
| **Product surface** | Voice → grounded ARAG answer → voice, plus a control panel |
| **Build target** | Demo-grade, but engineered to production patterns so it survives a security review |

---

## 0. Read this first (TL;DR)

We are building a **demo factory**, not a one-off demo. The deliverable is a reusable system where pointing the demo at a new prospect is a **configuration change, not a code change**.

The architecture is a **cascade voice pipeline** (the SOTA choice for knowledge-grounded voice): ElevenAgents owns the voice transport (speech-to-text, turn-taking, text-to-speech); **ARAG owns the retrieval-and-answer slot**, reached through a thin streaming **webhook** that calls ARAG's `/ask` endpoint. This is deliberately **not** an MCP integration, because ARAG's MCP server exposes retrieval only and we need ARAG's *composed, cited, governed* answer.

**Definition of done in one line:** a junior SE can stand up a cited, governed, interruptible voice agent over any prospect's knowledge box in under an hour, and it sounds natural enough to demo live without anyone wincing at latency.

Everything below is the detail required to hit that bar.

---

## 1. Objective & success criteria

### 1.1 What we're proving

ARAG is an enterprise-grade, governed retrieval-and-answer layer that can power a real-time voice agent — with **cited answers**, **security-filtered retrieval**, and a **clean human handoff** when the knowledge box doesn't cover a question. The demo must make those three differentiators *audible and visible* in under 90 seconds, because they are the entire reason a prospect would choose ARAG over a generic voice bot or ElevenLabs' own built-in knowledge base.

### 1.2 Success criteria (measurable)

| # | Criterion | Target |
|---|---|---|
| S1 | Perceived response latency (user stops talking → first audio back, including holding phrase) | p50 ≤ 1.2 s, p95 ≤ 2.5 s |
| S2 | Barge-in: user can interrupt; TTS halts | ≤ 200 ms |
| S3 | False-interruption rate on the golden set | 0 |
| S4 | Every substantive answer carries ≥ 1 citation surfaced in the UI | 100% |
| S5 | Spoken answer contains no URLs, no markdown, ≤ 3 sentences | 100% |
| S6 | Handoff fires when the KB lacks the answer, and is demoed deliberately | works |
| S7 | Security filter verified: a restricted document never surfaces | verified |
| S8 | Re-point to a new prospect using config only | ≤ 60 min |
| S9 | Unattended 10-minute stress run without degradation | passes |

---

## 2. Scope

### 2.1 Two demo modes (build both; lead with the second)

1. **Self-serve voice deflection.** Caller talks to the agent; the agent answers tier-1 questions from ARAG and hands off to a human when it can't.
2. **Agent-assist / "whisper".** ARAG answers stream to a **human agent's screen** with citations while they handle the call. This is the lower-risk enterprise wedge — it sidesteps "can I trust a bot with my customers" and "you can't speak a URL", and puts citations exactly where a reviewer wants them.

**Recommendation:** make **agent-assist the primary demo narrative**, with self-serve as the "and it can also run autonomously" follow-on.

### 2.2 In scope

- Web-based voice console (the demo surface) and a control panel to switch prospects.
- The `ask-bridge` webhook service.
- ARAG stored search configurations and the reusable voice-answer prompt.
- The config registry and the per-prospect setup ritual.
- Observability and a golden-question evaluation harness.

### 2.3 Out of scope (for the demo; note as v2 candidates)

- Telephony/SIP (Twilio) — web first; telephony is a config add later.
- Predictive prefetch cache (dual-agent pattern) — defer unless latency forces it.
- Partner self-service onboarding UI — v2.

---

## 3. Architecture decision records (ADRs)

Engineers: do not relitigate these without raising it. They are grounded in the ARAG capabilities and the current voice-agent state of the art.

### ADR-1 — Cascade pipeline, not speech-to-speech

We use a cascade (STT → LLM/RAG → TTS), not an audio-native speech-to-speech model. For knowledge-grounded enterprise voice this is the practical SOTA: cascade keeps reasoning on **text** with large context and full tool control, whereas audio-native models spend their context budget on audio tokens and degrade when you load in background knowledge. Cascade also lets us put **ARAG** in the reasoning slot, which is the whole point.

### ADR-2 — Pattern B (webhook over `/ask`), not Pattern A (MCP retrieval)

ARAG's MCP server exposes **retrieval only** (`search_documents`, `get_document`, `batch_get_documents`). If we bind the agent to ARAG over MCP, ElevenLabs' own LLM composes the answer and we lose ARAG's composed answer, multi-model routing, prompt control, and citation formatting — i.e. we commoditise ARAG into a vector lookup. Instead we call ARAG's **`/ask`** endpoint (REST, NDJSON streaming) from a webhook, preserving the governed answer. Cost: a thin middleware service. Worth it.

### ADR-3 — Why ARAG and not ElevenAgents' native knowledge base

ElevenAgents ships a built-in knowledge base. A prospect *will* ask why they need ARAG. The answer, which the demo must show: ARAG provides **label/security-filtered retrieval, cross-encoder reranking, pre-queries, multi-model routing, and audit-grade citations**. The native KB is adequate for an FAQ; it is not a governed enterprise retrieval layer that passes a security review. If the demo doesn't surface citations + governance + handoff, we are demoing against a free feature and we lose. This is the north star of the build.

---

## 4. System architecture

### 4.1 Components

```
┌──────────────────────────────────────────────────────────────────────┐
│  CLIENT (web)                                                          │
│  • Voice console (mic, state orb, transcript, citations, latency)      │
│  • Control panel (prospect selector, golden-question launcher)         │
└───────────────┬──────────────────────────────────────────────────────┘
                │  WebRTC / WebSocket (audio)
┌───────────────▼──────────────────────────────────────────────────────┐
│  ELEVENAGENTS  (fixed template, cloned per prospect)                   │
│  • Scribe v2 Realtime STT  • Turn-taking model  • Barge-in             │
│  • Flash v2.5 TTS (~75 ms)  • Holding-phrase on tool call              │
│  • Custom SERVER TOOL → ask-bridge                                     │
└───────────────┬──────────────────────────────────────────────────────┘
                │  HTTPS  POST /v1/voice-answer   (question + history + prospect)
┌───────────────▼──────────────────────────────────────────────────────┐
│  ASK-BRIDGE  (our service — the only meaningful code we write)         │
│  • Resolves prospect → {kb_id, region, ask_config, ...}               │
│  • Calls ARAG /ask (NDJSON stream)                                     │
│  • Strips citations from spoken text; returns citations as data       │
│  • Detects "not in KB" → handoff signal                               │
│  • Injects conversation context (ARAG is stateless)                   │
│  • Emits per-turn latency + safety guard checkpoints                  │
└───────────────┬──────────────────────────────────────────────────────┘
                │  HTTPS  POST /api/v1/kb/{kb_id}/ask   (X-NUCLIA-SERVICEACCOUNT)
┌───────────────▼──────────────────────────────────────────────────────┐
│  ARAG  (Progress Agentic RAG)                                          │
│  • Stored ask search_configuration (prompt, filters, security, models)│
│  • Hybrid retrieval → RRF rank fusion → reranker (noop|predict)       │
│  • Multi-model routing → fast generative model                        │
│  • Streams NDJSON: retrieval items, answer chunks, citations          │
└──────────────────────────────────────────────────────────────────────┘
```

### 4.2 Happy-path sequence

```mermaid
sequenceDiagram
    participant U as User
    participant EA as ElevenAgent
    participant BR as ask-bridge
    participant AR as ARAG /ask
    U->>EA: speaks question
    Note over EA: Scribe v2 transcribes while speaking;<br/>turn-taking model detects end-of-turn
    EA->>EA: play holding phrase ("let me check…")
    EA->>BR: POST /v1/voice-answer {question, history, prospect}
    BR->>AR: POST /ask {query, context, features:[semantic,keyword], search_configuration}
    AR-->>BR: NDJSON: retrieval → answer chunks → citations
    BR->>BR: assemble spoken answer (≤3 sentences), strip URLs, extract citations
    BR-->>EA: {answer, citations, handoff:false, latency}
    EA->>U: Flash v2.5 speaks answer (~75 ms TTS)
    EA-->>U: UI shows citations + latency strip
```

---

## 5. The latency budget (the one law)

Latency is the KPI. Human conversational turn-taking is ~200 ms; the 2026 production bar is sub-800 ms; we accept ~1 s *perceived* because a holding phrase masks the retrieval+generation gap. **LLM generation dominates total latency — not retrieval.** Optimise generation TTFT first.

| Stage | Budget | Lever |
|---|---|---|
| STT (Scribe v2 realtime) | overlaps user speech | streaming; semantic endpointing |
| End-of-turn decision | ~50–150 ms | turn-taking model, not raw VAD |
| Holding phrase starts | immediate | masks everything below |
| Tool dispatch + network → bridge | < 50 ms | co-locate bridge region with caller |
| ARAG retrieval (`/find` inside `/ask`, `noop` rerank) | 100–300 ms | `noop` reranker; `features:[semantic,keyword]` (no relations) |
| ARAG answer generation (TTFT, fast model) | 300–800 ms | **fast generative model via multi-model routing** — biggest lever |
| Bridge assemble + return | < 50 ms | parse NDJSON incrementally |
| TTS first audio (Flash v2.5) | ~75 ms | Flash v2.5, not Turbo |
| **Perceived total (with filler)** | **~1 s** | target |

**Non-negotiables:** stream ARAG's `answer` chunks as they arrive (don't wait for the full answer); start the holding phrase the instant the tool call is dispatched; never request `relations` unless a demo needs NER/graph (it slows answers).

---

## 6. Component specifications

### 6.1 ElevenAgent template (fixed; cloned per prospect)

Configure one agent template with these settings; cloning per prospect only changes voice, greeting, and the prospect identifier.

- **STT:** Scribe v2 Realtime, locale per prospect (default `en-AU`).
- **Turn-taking:** ElevenAgents proprietary turn-taking model (semantic end-of-turn). Tune sensitivity on the golden set to hit S3 (zero false interruptions).
- **Barge-in:** enabled. TTS must halt ≤ 200 ms on user speech (S2).
- **TTS:** Eleven Flash v2.5 (~75 ms). Voice per prospect.
- **Holding phrase / pre-tool speech:** on tool-call start, speak a short, content-relevant filler. Because we are on the **webhook (custom server tool)** path, the MCP-only `pre_tool_speech` field does **not** apply — implement the filler via the agent's tool-call holding-phrase behaviour. Keep a small rotation of phrases ("let me check that", "one moment, checking the knowledge base") so it doesn't sound robotic on repeat.
- **System prompt (agent-level):** minimal. The agent is a router/voice persona; the *answer* comes from the tool. Instruct it to always call the `voice-answer` tool for any factual/support question and to verbalise the tool's `answer` field verbatim (do not re-summarise — that would re-introduce hallucination and double latency).
- **Custom server tool:** `voice-answer` → `POST {ASK_BRIDGE_URL}/v1/voice-answer`. Pass the transcribed question, conversation id, and recent history. On `handoff:true`, the agent speaks the prospect's handoff message and (in self-serve mode) triggers escalation.

### 6.2 ask-bridge service (the core build)

A small, **stateless** HTTP service (Node/TypeScript recommended; deploy on Fly.io). Stateless because ARAG's `/ask` is stateless and we pass conversation context per call.

#### 6.2.1 Endpoint: `POST /v1/voice-answer`

**Request (from the ElevenAgent tool):**

```json
{
  "prospect": "tangerine",
  "question": "How do I change my plan?",
  "conversation_id": "conv_abc123",
  "history": [
    { "author": "USER",   "text": "earlier user question" },
    { "author": "NUCLIA", "text": "earlier agent answer" }
  ]
}
```

**Response (to the agent):**

```json
{
  "answer": "You can change your plan in the My Account portal under Plans. Pick the new plan and it applies from your next billing cycle.",
  "citations": [
    { "title": "Managing your plan", "url": "https://…", "score": 0.82 }
  ],
  "handoff": false,
  "latency_ms": { "retrieve": 210, "first_token": 540, "total": 760 }
}
```

#### 6.2.2 What the bridge does, in order

1. **Resolve prospect** from the config registry → `{ kb_id, region, ask_config, handoff_msg, locale }`.
2. **Input safety checkpoint** (guard before ARAG): reject/redirect obviously out-of-scope or unsafe input. Log it.
3. **Build the ARAG `/ask` request** (see 6.3.1). Map `history` → ARAG `context` (alternating `USER`/`NUCLIA`).
4. **Stream the NDJSON response.** Parse line-by-line. Collect `retrieval` items (for citations) and concatenate `answer` chunks. **Begin returning as soon as the first complete sentence is available** if the agent tool supports streamed/partial results; otherwise return the assembled short answer (answers are ≤ 3 sentences, so the simple path is acceptable for the demo).
5. **Shape for voice:** strip citation markers (`[1]`, `[2]`…), strip URLs/markdown, collapse whitespace, enforce ≤ 3 sentences.
6. **Extract citations** from `retrieval`/citation items → `{title, url, score}` (max 4).
7. **Detect handoff:** if ARAG returns no grounded answer / the answer indicates "not covered", set `handoff:true` and substitute the prospect handoff message. (Implement a deterministic check — see 8.4 — not vibes.)
8. **Output safety checkpoint** (guard before TTS): final scan of the spoken text. Log it.
9. **Return** `{answer, citations, handoff, latency_ms}` and emit metrics.

#### 6.2.3 Error & degradation handling

| Failure | Behaviour |
|---|---|
| ARAG timeout (> N ms, default 6 s) | Speak a graceful line, set `handoff:true`. Never leave dead air. |
| ARAG 5xx / network | Same as timeout; log + alert. |
| Empty retrieval | `handoff:true` with handoff message. |
| Malformed NDJSON line | Skip the line, continue; never crash the turn. |
| Safety guard trip | Return a safe deflection; do not pass through. |

The holding phrase buys ~1 s; the bridge must always resolve a turn within the agent's tool timeout or the agent will stall. Set the agent tool timeout and the bridge's ARAG timeout coherently.

### 6.3 ARAG configuration (per prospect, via stored search configuration)

#### 6.3.1 The `/ask` call the bridge makes

```
POST https://{region}.rag.progress.cloud/api/v1/kb/{KB_ID}/ask
Headers:
  X-NUCLIA-SERVICEACCOUNT: Bearer {ARAG_TOKEN}
  Content-Type: application/json
  Accept: application/x-ndjson
Body:
{
  "query": "How do I change my plan?",
  "context": [
    { "author": "USER",   "text": "…" },
    { "author": "NUCLIA", "text": "…" }
  ],
  "features": ["semantic", "keyword"],
  "search_configuration": "tangerine_voice",
  "citations": true
}
```

Notes:

- `features` deliberately excludes `relations` — the platform default changed to `[semantic, keyword]` for faster answers; only add `relations` if a specific demo needs NER/graph.
- Passing `search_configuration` means we don't re-send filters/prompt/model per call — they live in the stored config. The bridge only sends `query` + `context`.
- Response is **NDJSON**: iterate lines, each is a JSON object with an item (e.g. `retrieval`, `answer`, citations, status). Confirm exact item type names against `docs.rag.progress.cloud/docs/rag/advanced/ask` during implementation.

#### 6.3.2 The stored search configuration (created once per prospect)

```
POST https://{region}.rag.progress.cloud/api/v1/kb/{KB_ID}/search_configurations/{prospect}_voice
Headers: X-NUCLIA-SERVICEACCOUNT: Bearer {ARAG_TOKEN}
Body:
{
  "kind": "ask",
  "config": {
    "filter_expression": {
      "field": { "prop": "language", "language": "en" },
      "paragraph": { "not": { "prop": "kind", "kind": "OCR" } },
      "operator": "and"
    },
    "security": { "groups": ["public"] },
    "<reranker / rag_strategies / generative_model / prompt fields>": "see below"
  }
}
```

Configure inside this stored config (map field names to the search-configurations, RAG-strategy, reranker, prompt, and models docs during build):

- **Reranker:** `noop` for the fast default. Use `predict` (cross-encoder, higher quality, slower) only if answer quality on the golden set demands it. This is a direct latency lever — choose per prospect.
- **Generative model (multi-model routing):** pick a **fast** answer model. Generation TTFT dominates total latency, so this is the single most important quality/speed dial. ARAG supports OpenAI-compatible custom models and your own key if needed.
- **Pre-queries (optional):** if a prospect has distinct doc classes (e.g. manuals vs FAQs), use weighted pre-queries to boost authoritative sources. Skip for simple KBs — it adds latency.
- **Prompt:** the reusable **voice-answer prompt** (Section 8). This is what makes ARAG's written answers sound spoken. One template, applied to every prospect.

#### 6.3.3 Governance to verify (S7)

- Confirm `security.groups` filtering actually withholds a restricted document in a live query. Note: `security.access_groups` is a **filter convenience, not server-side enforced security** — for the demo's "governance" story, show the filter working, and be precise in claims to reviewers (it controls what the retrieval returns given the caller's groups; it is not an auth boundary on the documents themselves).

### 6.4 Config registry (the only thing that changes per prospect)

One entry per prospect. Start as a JSON file in the repo; promote to a small table if the control panel needs runtime edits.

```json
{
  "tangerine": {
    "display_name": "Tangerine",
    "kb_id": "df8b4c24-2807-4888-ad6c-ae97357a638b",
    "region": "europe-1",
    "ask_config": "tangerine_voice",
    "agent_id": "elevenagent_xxx",
    "voice_id": "elevenlabs_voice_xxx",
    "locale": "en-AU",
    "greeting": "Hi, you've reached Tangerine support. How can I help?",
    "handoff_msg": "I'll put you through to a team member who can help with that.",
    "golden_questions": ["…", "…"]
  }
}
```

### 6.5 Control panel (v1 demo surface)

- Prospect dropdown (reads the registry) → launches the matching ElevenAgent.
- Live transcript with **citations rendered as chips** (this is where the governance story lands — especially in agent-assist mode).
- A **latency strip** per turn (retrieve / first-token / total) — visibly proves the latency story.
- A "run golden set" button for repeatable, deterministic demos.
- No browser storage of secrets; all ARAG/ElevenLabs calls go through the bridge/backend, never the client.

---

## 7. Critical flows

1. **Happy path** — Section 4.2.
2. **Follow-up (context):** bridge appends prior `USER`/`NUCLIA` turns to `context` so "and how much does *that* cost?" resolves. Cap history length to control latency/cost.
3. **No answer → handoff:** ARAG returns no grounded answer → `handoff:true` → agent speaks handoff message → (self-serve) escalate. **Demo this on purpose** — it's the trust moment.
4. **Barge-in:** user interrupts → TTS halts ≤ 200 ms → new turn starts. In-flight bridge/ARAG call for the abandoned turn is cancelled.
5. **Degradation:** ARAG slow/erroring → graceful line + handoff, never dead air.

---

## 8. The voice-answer prompt (reusable asset)

This single prompt, stored in each prospect's `ask` config, converts ARAG's default written output into spoken-shaped answers. It is the highest-leverage reusable artifact in the build — tune it once, reuse everywhere. See [voice-answer-prompt.md](voice-answer-prompt.md).

**Requirements the prompt must enforce:**

1. Answer in **2–3 short, spoken sentences**. No markdown, no headings, no bullet lists.
2. **No URLs or citation markers in the spoken text** (citations are returned separately as data).
3. Plain language, prospect-appropriate tone, the configured locale's English.
4. If the retrieved context does not contain the answer, respond with a short, explicit "I don't have that" so the bridge can deterministically detect handoff (see 8.4) — **do not invent**.
5. Never expose internal document names, scores, or system details.

**8.4 Deterministic handoff detection.** Have the prompt prefix unanswerable responses with a fixed sentinel (e.g. the answer begins with a known phrase) OR rely on ARAG returning empty/again-no-grounding, and key the bridge's `handoff` flag off that signal. Do not infer handoff from fuzzy heuristics — make it a contract between the prompt and the bridge.

---

## 9. Latency engineering playbook

1. **Pick a fast generative model** in ARAG multi-model routing. Biggest lever; generation dominates.
2. **`noop` reranker first**, `predict` only where quality requires it.
3. **`features:[semantic, keyword]`** — never add `relations` unless required.
4. **Stream `answer` chunks**; speak the first sentence as soon as it's complete (where the tool path supports partial returns).
5. **Holding phrase on dispatch** — masks the whole gap; rotate phrases.
6. **Co-locate** the bridge region with the prospect/caller and pick the nearest ARAG region.
7. **Cap context/history length** to bound generation cost.
8. **(v2, only if needed) Predictive prefetch cache** — the dual-agent "fast talker / slow thinker" pattern can cut retrieval dramatically on warm, topically-coherent turns, but remember retrieval savings are often invisible behind generation latency. Don't build this until a benchmark says you must.

---

## 10. Safety, governance, security

- **Two checkpoints:** input guard before ARAG, output guard before TTS (Section 6.2.2).
- **Grounding + handoff** is the anti-hallucination strategy: the agent speaks ARAG's answer verbatim; if ungrounded, it hands off rather than improvises.
- **Citations** on every substantive answer, surfaced in the UI (and on the human agent's screen in agent-assist mode).
- **Security filtering** via the stored config's `security.groups` — demoed, with accurate claims (see 6.3.3).
- **Secrets:** ARAG token and ElevenLabs key live only in the bridge/backend (Fly.io secrets / env), never client-side. No keys in artifacts or the repo.
- **Data residency:** choose the ARAG region per prospect; note ElevenLabs zero-retention/residency options if a prospect requires it.
- **PII:** if a prospect KB contains PII, enable ARAG anonymisation in the routing config and confirm transcripts/logs honour retention rules.

---

## 11. Repeatability — the demo factory ritual

**Fixed (built once, never touched per prospect):** ElevenAgent template, ask-bridge service, voice-answer prompt, control panel, observability.

**Variable (per prospect, ~30–60 min):**

1. Ingest the prospect's public content into a KB (new or reused).
2. Create the `{prospect}_voice` stored `ask` search configuration (filters, security, fast model, voice-answer prompt).
3. Add a config registry entry.
4. Clone the ElevenAgent template; set voice, greeting, locale.
5. Author ≥ 20 golden questions; run the eval harness; tune reranker/model until it passes.
6. Smoke-test barge-in, a follow-up, and the handoff path.

If any step requires touching the bridge code, that's a defect in the abstraction — fix the abstraction, not the prospect.

---

## 12. Tech stack & deployment

- **Bridge:** Node/TypeScript, stateless, Fly.io (matches existing PartnerForge deployment posture). One small service.
- **Client:** static web app (control panel + voice console) talking to ElevenAgents over WebRTC/WebSocket and to the bridge for citations/latency where needed.
- **Config:** registry JSON in-repo for v0/v1.
- **Secrets (Fly.io):** `ARAG_TOKEN`, `ELEVENLABS_API_KEY`, per-prospect IDs in registry (non-secret).
- **Env vars:** `ASK_BRIDGE_URL`, `ARAG_REGION_DEFAULT`, `ARAG_TIMEOUT_MS`, `AGENT_TOOL_TIMEOUT_MS`.
- **Regions:** pick bridge + ARAG region nearest the demo audience.

---

## 13. Observability & evaluation

**Per-turn metrics (logged):** retrieve ms, first-token ms, total ms, citation count, handoff (bool), barge-in (bool), safety-guard trips.

**Dashboards:** p50/p95 perceived latency, handoff rate, citation coverage, false-interruption count.

**Golden-question harness:** ≥ 20 questions per prospect with expected behaviour (answerable vs handoff). Run before every demo. This is the gate — no prospect demos until its golden set passes.

**Weekly review loop:** review failures, tune prompt/reranker/model/turn-taking, re-run. Quality compounds.

---

## 14. Build plan & milestones

| Milestone | Deliverable | Acceptance |
|---|---|---|
| **M0 — First call (½ day)** | ElevenAgent → bridge → ARAG `/ask`, one prospect, no polish | A spoken, ARAG-grounded answer to one question |
| **M1 — v0 answer layer (week 1)** | Citations extracted, voice-shaped answers, handoff path, holding phrase | S4, S5, S6 pass for one prospect |
| **M2 — Latency + barge-in (week 2)** | Streaming, fast model, turn-taking tuned, barge-in | S1, S2, S3 pass |
| **M3 — v1 control panel + factory (week 3)** | Registry, control panel, golden-set harness, second prospect onboarded via config only | S8, S9 pass; two prospects live |
| **M4 — Hardening (week 4)** | Safety guards, observability, degradation, docs | Full DoD (Section 15) |

---

## 15. Definition of done — world-class bar

- [ ] All success criteria S1–S9 (Section 1.2) pass on at least two prospects.
- [ ] Agent speaks ARAG's answer verbatim; no agent-side re-summarisation.
- [ ] Holding phrase masks the gap; no dead air on any turn, including failures.
- [ ] Barge-in halts TTS ≤ 200 ms; zero false interruptions on the golden set.
- [ ] Every substantive answer: ≥ 1 citation in UI, 0 URLs spoken, ≤ 3 sentences.
- [ ] Handoff path fires deterministically and is demoed deliberately.
- [ ] Security/labelset filter verified live, with accurate reviewer-facing claims.
- [ ] New prospect onboarded in ≤ 60 min using config only — verified by a second person.
- [ ] Input + output safety guards live and logged.
- [ ] Per-turn observability + golden-set harness in place; weekly loop defined.
- [ ] Secrets server-side only; nothing sensitive in the client or repo.
- [ ] 10-minute unattended stress run passes without degradation.

---

## 16. Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Extra network hop (agent→bridge→ARAG) inflates latency | Demo feels sluggish | Fast gen model, `noop` rerank, streaming, holding phrase, region co-location |
| Generation TTFT variance | p95 spikes | Fast model; cap context; set coherent timeouts; degrade gracefully |
| "Why not ElevenLabs' native KB?" objection | Loses the deal | ADR-3 positioning; make citations + governance + handoff visible |
| Citations can't be spoken | Differentiator invisible on voice | Surface in UI; lead with agent-assist mode |
| Hallucination | Trust failure in front of prospect | Verbatim answer + grounding + deterministic handoff + output guard |
| Poor per-prospect ingestion | Bad answers | Golden-set gate before any demo |
| Vendor coupling to ElevenLabs | Lock-in concern | Cascade keeps LLM/RAG swappable; only voice transport is ElevenLabs |

---

## 17. Open decisions (resolve before M2)

1. Primary demo mode: **agent-assist** (recommended wedge) vs self-serve as headline.
2. Which fast generative model in ARAG routing (name it; benchmark TTFT).
3. Telephony in demo scope? (Default: no — web only.)
4. Region/data-residency policy per prospect.
5. Whether to build the predictive-prefetch cache now (default: defer to v2).

---

## 18. Appendix — ARAG reference (verify against docs during build)

- **Ask:** `POST /api/v1/kb/{kb_id}/ask` — NDJSON stream; internally runs `/find`, passes top paragraphs to the generative model; returns citations. Stateless: pass conversation via `context` (`author: USER` / `author: NUCLIA`).
- **Auth:** `X-NUCLIA-SERVICEACCOUNT: Bearer {token}`.
- **Features:** default `[semantic, keyword]` (relations excluded for speed).
- **Search configurations:** `POST /api/v1/kb/{kb_id}/search_configurations/{name}` with `kind: "ask"`; reuse via the `search_configuration` parameter on `/ask`.
- **Retrieval pipeline:** hybrid search → Reciprocal Rank Fusion → optional cross-encoder reranker (`noop` fast default | `predict` higher quality, slower); optional weighted pre-queries.
- **Models:** multi-model routing for answer generation, summarisation, semantic search, extraction, anonymisation; OpenAI-compatible custom models + own key supported.
- **MCP (context):** ARAG's MCP server is **retrieval-only** (`search_documents`, `get_document`, `batch_get_documents`) — which is exactly why this build uses `/ask` over a webhook, not MCP.
- Docs: `https://docs.rag.progress.cloud/docs/rag/advanced/ask`, `.../search-configurations`, `.../advanced/score-rank-and-rerank`, `.../rag/llms`.

*Confirm exact NDJSON item type names, the `/ask` body field names for citations/relations, and the precise key paths inside `search_configurations` against the live docs during M0 — the shapes above are correct in structure; field-name drift is the only thing to watch.*
