# Partner pitch — VoiceBridge for Progress partners and SIs

Audience: a Progress partner or systems integrator deciding whether to add a live-conversation
copilot as a delivery line on top of Agentic RAG (ARAG) engagements. This document is the pitch, a
slide outline with speaker notes, objection handling, and a pilot plan built around real-time
listening (agent-assist) as the lead offer, with self-serve deflection as phase two.

## The commercial shape

Most agent-assist and voice-AI engagements are sold and built as bespoke integration projects: a new
customer means new prompt engineering, new plumbing into whatever telephony or meeting stack they
already run, and a new set of guardrails invented from scratch. That is expensive to sell against
and expensive to repeat.

VoiceBridge is built to be operated as a **demo factory** for a live-conversation copilot: one
deployment, many prospects, each added as data rather than as a new integration, with the listening
session API sitting independent of whichever speech-to-text vendor or telephony stack the customer
already uses.

- **Who buys it.** The buyer for the lead offer is whoever owns how live conversations get handled —
  a contact-centre operations or enablement lead for support, a sales engineering or sales
  enablement lead for discovery calls. They are buying a brief on someone's screen, not a phone
  system: nothing about their existing telephony, softphone or CRM has to change for a pilot to
  start.
- **What changes on day one.** Nothing upstream. The session API takes transcript chunks from
  whatever is already producing them — a realtime STT vendor's stream, a telephony webhook, a
  meeting bot, or a person typing — so a pilot can start by feeding it a manual transcript before any
  telephony integration exists at all. What changes for the person on the call is a live brief pane:
  who they're speaking to, what that person wants, and grounded, cited suggestions for what to say
  next, refined as the conversation moves rather than reset every turn.
- **Adding a prospect is an admin API call, not a redeploy.** `POST /api/v1/admin/prospects` creates
  a registry entry (display name, Knowledge Box id, region, locale, greeting, handoff line, golden
  questions); `POST /api/v1/admin/prospects/{key}/provision` writes retrieval settings into the
  Knowledge Box as a stored search configuration. Both are idempotent and both run against a live
  deployment.
- **What the partner owns:** the prospect relationship, the Knowledge Box content and its ingestion,
  whatever feeds the session API (an STT integration, a telephony webhook, or nothing at all if the
  pilot starts with typed or pasted transcripts), the brand-facing configuration (greeting, handoff
  line), and hosting/operating the bridge instance.
- **What the ARAG platform owns:** retrieval quality and the generative models behind the brief and
  the deflection pipeline, the Knowledge Box itself, and the open-source discipline this product
  ships — the throttled listening service, the evolving-brief schema, input/output safety guards,
  the deterministic handoff contract for deflection, citation handling and per-session/per-turn
  metrics — so the partner is not reinventing that discipline per customer.

## 10-slide outline with speaker notes

**1. Title — "The assistant listens, and tells the person what's true."**
Speaker notes: open on the person handling the call, not the technology. A new agent, or anyone
fielding a conversation outside their depth, either stalls to go searching or says something with
more confidence than they have grounds for. That's the gap the brief closes, live.

**2. The problem with live conversations today.**
Speaker notes: a static knowledge-base search only helps if someone stops the conversation to use
it. A general-purpose AI meeting copilot is fluent but not grounded — nothing stops it answering a
factual question from the model's own memory instead of the customer's content, and there's no
citation to check. Mature agent-assist suites solve grounding but bundle it with coaching, scoring
and CRM integrations a pilot doesn't need to prove the core idea.

**3. What VoiceBridge is.**
Speaker notes: a session API that listens to a live conversation from any source and maintains one
evolving, cited brief — who the other person is, what they want, the stage of the conversation, and
grounded suggestions for what to say next. Independent of any one STT vendor or telephony stack.

**4. How a session works.**
Speaker notes: open a session for a prospect, feed it conversation as chunks, read the brief back
over Server-Sent Events or by polling — walk through the shapes in `src/openapi.ts`. The throttling
(minimum words, minimum gap, a similarity check) lives on the server, so it's the same for every
client, not something each integration has to reinvent.

**5. The evolving brief — the actual IP.**
Speaker notes: each refresh gets the previous brief and is told to refine and extend it, not restart.
Persona and intent fields (`caller_profile`, `their_goal`, `stage`) reason over the conversation;
factual fields (`key_points`, `suggested_answers`, `recommended_products`) are drawn only from the
Knowledge Box, and the schema leaves them empty rather than inventing something. A failed refresh
never blanks the screen — the previous brief stays up.

**6. The demo-factory model.**
Speaker notes: show the prospect registry — each entry with its own Knowledge Box, prompt and golden
questions, all served from one deployment. Adding the next customer is data entry, not a sprint.

**7. The deflection follow-on.**
Speaker notes: the same grounded pipeline, without a human on the call, answers directly over
`POST /api/v1/voice-answer` and hands off by a deterministic rule (`HANDOFF:` sentinel, backed by
empty-answer and zero-retrieval checks) rather than the model's own confidence. Gated by a golden
set of questions it must answer and questions it must refuse.

**8. Live demo.**
Speaker notes: run it in the room. Listen tab, sample conversation — no credentials needed — showing
the brief build up live; Ask tab for the deflection pipeline as a text turn; Call tab for a real
voice round-trip once an agent is configured; Golden set tab run live against the audience's own
question.

**9. What's open, and the economics.**
Speaker notes: Apache-2.0, OpenAPI-first (`src/openapi.ts` is the single source of truth), zero
runtime dependencies. The partner is not paying a licence fee to inspect or extend either the
listening service or the deflection pipeline; the commercial value is in content, configuration and
the relationship — the same shape as any other services-led ARAG engagement.

**10. Pilot plan and next steps.**
Speaker notes: propose the phased pilot below — agent-assist first, deflection as phase two — and
agree the two or three prospects to start with.

## Objection handling

| Objection | Response |
|---|---|
| "Isn't this just a meeting copilot with extra steps?" | No — the factual fields in the brief (`key_points`, `suggested_answers`, `recommended_products`) are constrained to the Knowledge Box by both the schema and the prompt, and every citation shown is checkable. A generic copilot has no equivalent constraint and no citation to verify. |
| "Are we locked into one speech-to-text or telephony vendor?" | No — `POST /api/v1/listen/sessions/{id}/transcript` accepts chunks from anything: a realtime STT stream, a telephony webhook, a meeting bot, or typed text. Nothing in the session API assumes a transport. |
| "What happens if a brief refresh fails mid-call?" | The previous brief stays exactly as it was — `ListenService.refresh` never throws, and a failed or unusable refresh is logged as a failure in the session's own stats rather than shown as an error. |
| "How do we know the throttle isn't burning cost on every word?" | The throttle lives on the server (minimum words, minimum gap between refreshes, a similarity check against the previous window), so every client gets the same, provable cost profile — not whatever discipline a given integration happens to build in. |
| "Is there a pass/fail gate for the brief, the way there is for the deflection answer?" | Not today, honestly. The golden-set gate covers the deflection pipeline (`/api/v1/voice-answer`) only; reviewing whether a live brief was useful on a given call is a manual read of the session's brief history in the admin panel. |
| "Is this production-ready?" | It's an MVP, and we say so plainly: session state is a single-machine, in-memory store with a 200-session cap; per-prospect credential isolation is a documented extension point, not a shipped guarantee. What is shipped and tested is the throttled listening service, the evolving-brief schema, the deflection pipeline's handoff contract, and the golden-set gate for deflection. |
| "What does it cost us to maintain?" | Zero runtime dependencies and an OpenAPI document that drives request validation and contract tests — there is very little surface area to patch, and drift between the spec and the implementation fails the build rather than shipping quietly. |

## Pilot plan

**Phase 1 — Ground the content.** Ingest the pilot customer's real content into a Knowledge Box.
For the listening path there are no golden questions to write yet — start Phase 2 with typed or
pasted conversation to see the brief work against real content before any live call touches it.

**Phase 2 — Wire up listening.** Create the registry entry, decide what will feed the session API
(a realtime STT integration, a telephony webhook, or a manual transcript to start), and put a brief
pane in front of the pilot's agents or sales engineers. Nothing about existing telephony or CRM has
to change for this phase.

**Phase 3 — Watch it on real conversations.** Run the pilot on real or replayed calls and watch each
session's stats (`chunks`, `refreshes`, `skipped`, `failures`, `p50LatencyMs`, `p95LatencyMs` — all
in `GET /api/v1/listen/sessions/{id}` or the admin Listen sessions tab) alongside direct feedback
from whoever's using the brief. There is no automated pass/fail gate for this phase; success is a
combination of the session stats staying healthy (refreshes happening, failures low) and the people
using the brief saying it helped.

- Failures (`stats.failures`) should stay low and not climb as call volume grows — a rising failure
  rate points at the upstream Knowledge Box or model, not the throttle.
- Skipped refreshes (`stats.skipped`) are expected and healthy in normal use — they mean the
  throttle is doing its job, not that something is broken.
- Latency (`p50LatencyMs` / `p95LatencyMs`) should sit comfortably inside however quickly the person
  using the brief needs an update — treat any number reported here as measured in that pilot's own
  environment, not a guaranteed figure to plan around elsewhere.

**Phase 4 — Add deflection, if it's wanted.** Once the listening path is trusted, write golden
questions (answerable and deliberately out-of-scope), provision the stored search configuration, run
`POST /api/v1/golden-evals` until every case passes, and point a voice platform's custom tool at
`/api/v1/voice-answer` for the cases where nobody needs to be on the call at all. No self-serve
deflection goes live before this gate is green.
