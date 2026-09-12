# Partner pitch — VoiceBridge for Progress partners and SIs

Audience: a Progress partner or systems integrator deciding whether to add voice as a delivery
line on top of Agentic RAG (ARAG) engagements. This document is the pitch, a slide outline with
speaker notes, objection handling, and a pilot plan.

## The commercial shape

Most voice-AI engagements are sold and built as bespoke integration projects: a new prospect means
new prompt engineering, new plumbing between the telephony layer and the model, and a new set of
guardrails invented from scratch. That is expensive to sell against and expensive to repeat.

VoiceBridge is built to be operated as a **demo factory**: one deployment, many prospects, each
added as data rather than as a new integration.

- **Adding a prospect is an admin API call, not a redeploy.** `POST /api/v1/admin/prospects`
  creates a registry entry (display name, Knowledge Box id, region, locale, greeting, handoff
  line, golden questions); `POST /api/v1/admin/prospects/{key}/provision` writes the voice prompt
  and retrieval settings into the Knowledge Box as a stored search configuration. Both are
  idempotent and both run against a live deployment.
- **Time-to-first-demo is a configuration flow, not an engineering one.** Once a prospect's content
  is in a Knowledge Box, standing up a phone-answerable demo is: create the registry entry, write
  golden questions that describe what it must answer and what it must refuse, provision the stored
  configuration, run the golden set until it's green, point a voice platform's custom tool at
  `/api/v1/voice-answer`. No new code, no new deployment.
- **What the partner owns:** the prospect relationship, the Knowledge Box content and its
  ingestion, the golden questions (the definition of "good enough to demo"), the brand-facing
  configuration (voice, greeting, handoff line), the ElevenLabs (or other voice platform) agent
  configuration, and hosting/operating the bridge instance.
- **What the ARAG platform owns:** retrieval quality and the generative models behind `/ask`, the
  Knowledge Box itself, and the open-source pipeline discipline this product ships —
  input/output safety guards, the deterministic handoff contract, voice shaping, citation
  handling and per-turn metrics — so the partner is not reinventing that discipline per prospect.

## 10-slide outline with speaker notes

**1. Title — "A voice agent that guesses is worse than no voice agent."**
Speaker notes: open on the risk, not the technology. A hallucinated price or policy on a live
call is a decision the caller acts on immediately; there is no "let me check that" the way there is
in a chat window.

**2. The problem with voice + LLMs today.**
Speaker notes: generic voice agents are fluent, not grounded. RAG-less IVRs are safe but brittle.
Closed voice-AI suites solve this but you can't bring your own Knowledge Box or see the pipeline.
DIY glue code re-solves the same problem badly, every time.

**3. What VoiceBridge is.**
Speaker notes: one endpoint, `POST /api/v1/voice-answer`, sits between any voice platform's custom
tool and an ARAG Knowledge Box. It answers, cites, times and — critically — decides when to hand
off, deterministically.

**4. The nine-step turn pipeline.**
Speaker notes: input guard, request build, ARAG `/ask` (streamed), handoff decision, voice
shaping, citation extraction, output guard, metrics — walk the diagram from `README.md`. Every
step is a named, testable unit, not a monolith prompt.

**5. The deterministic handoff — the actual IP.**
Speaker notes: the prompt is contracted to prefix an unanswerable reply with `HANDOFF:`; the
bridge keys off that literal string. Belt-and-braces checks catch an empty answer or zero
retrieval results even if a stored configuration skips the prompt. This is a string check, not a
model's opinion about its own confidence — reproducible, testable, and it's what a compliance
reviewer signs off against.

**6. The demo-factory model.**
Speaker notes: show the prospect registry — `progress`, `tangerine`, `northwind` in the shipped
example config — each with its own Knowledge Box, prompt, voice and golden questions, all served
from one deployment. Adding the next prospect is data entry, not a sprint.

**7. The golden set — the quality gate.**
Speaker notes: every prospect ships questions it must answer and questions it must refuse.
`runGoldenEval` runs each through the exact pipeline the live agent uses and checks behaviour,
grounding (≥1 citation) and voice shape. No prospect goes live — or gets demoed — with a red
golden set.

**8. Live demo.**
Speaker notes: run it in the room. Ask tab for a text turn (no credentials needed) showing the
pipeline steps lighting up; Call tab for a real voice round-trip; Listen tab for the ambient
copilot brief; Golden set tab run live against the audience's own question.

**9. What's open, and the economics.**
Speaker notes: Apache-2.0, OpenAPI-first (`src/openapi.ts` is the single source of truth), zero
runtime dependencies. The partner is not paying a licence fee to inspect or extend the pipeline;
the commercial value is in content, configuration, and the relationship — the same shape as any
other services-led ARAG engagement.

**10. Pilot plan and next steps.**
Speaker notes: propose the four-phase pilot below, with the golden set as the explicit go/no-go
gate at every stage, and agree the two or three prospects to start with.

## Objection handling

| Objection | Response |
|---|---|
| "Isn't this just prompt engineering with extra steps?" | No — the handoff decision is a deterministic string/count check (`decideHandoff`), not the model grading its own confidence. It is reproducible under the same inputs and it's exactly what the golden set asserts, turn after turn. |
| "What happens when the prospect's content changes?" | Re-provision the stored search configuration and re-run the golden set before promoting the change. The gate exists precisely so a content or prompt edit can't silently change behaviour on a live line. |
| "Are we locked into ElevenLabs?" | No — the contract is one HTTP endpoint (`POST /api/v1/voice-answer`) that any voice platform capable of calling a custom tool can use. ElevenLabs is the shipped reference implementation, not a dependency. |
| "How do you keep Knowledge Box credentials and prospect data safe?" | The browser only ever sees a non-secret projection of a prospect (display name, greeting, golden questions) — never a Knowledge Box id or credential. Admin routes that touch that configuration require a separate admin token. |
| "Is this production-ready?" | It's an MVP, and we say so plainly: per-prospect credential isolation and platform-level rate limiting beyond the two product-owned limiters are documented extension points, not shipped guarantees today. What is shipped and tested is the turn pipeline, the handoff contract, voice shaping, citations and the golden-set gate. |
| "What does it cost us to maintain?" | Zero runtime dependencies and an OpenAPI document that drives request validation and contract tests — there is very little surface area to patch, and drift between the spec and the implementation fails the build rather than shipping quietly. |

## Pilot plan

**Phase 1 — Ground the content.** Ingest the pilot prospect's real content into a Knowledge Box.
Write golden questions covering the core questions it must answer and at least two to three
explicit out-of-scope questions it must refuse (billing, medical, legal, or anything else outside
the prospect's remit — see the shipped `config/prospects.example.json` for the shape).

**Phase 2 — Wire it up.** Create the registry entry, provision the stored search configuration,
point the chosen voice platform's custom tool at `/api/v1/voice-answer`, and set
`VOICE_TURN_TIMEOUT_MS` below the voice platform's own tool timeout so a slow turn degrades to the
handoff line instead of dead air.

**Phase 3 — Gate on the golden set.** Run `POST /api/v1/golden-evals` until every case passes
(`ok: true`): correct behaviour on every question, ≥1 citation on every grounded answer, no URLs
or citation markers spoken, three sentences or fewer. No prospect call — demo or pilot — happens
before this gate is green.

**Phase 4 — Shadow, then live.** Run the pilot against real or replayed calls and watch
`GET /api/v1/metrics` (turn count, `handoff_rate`, `citation_coverage`, `guard_trip_rate`, and
p50/p95 latency for both first token and total turn time). Success criteria for exiting the pilot:

- The golden set stays green after every content or prompt change made during the pilot.
- The handoff rate matches expectation for the golden set's own answer/handoff split — materially
  higher or lower is a signal to review either the content coverage or the prompt.
- Turn latency stays comfortably inside the voice platform's tool timeout; the audited reference
  deployment measured roughly p50 3.3s / p95 5.6s end-to-end in the demo environment — treat that
  as a baseline to compare against for the pilot's own Knowledge Box and model choice, not as a
  guaranteed number.
- No guard trip or handoff is silently absorbed: every one is visible in the turn log
  (`/api/v1/admin/turns`) with a reason, ready for the reviewer who asks to see it.
