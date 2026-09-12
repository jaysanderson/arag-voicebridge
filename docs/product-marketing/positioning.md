# Positioning — VoiceBridge

> Working name: **VoiceBridge**. Treat it as a placeholder — see "Naming" below for the
> recommendation. The repository and deployed app keep the name `arag-voice-bridge` regardless of
> which product name is chosen.

## Positioning statement

VoiceBridge is the discipline layer between a voice agent and a Progress Agentic RAG (ARAG)
Knowledge Box that makes every spoken answer grounded, cited and — when it can't be grounded —
handed to a human by rule rather than by guess.

## The problem, and why it matters

A voice agent that can say anything will eventually say something wrong. Text chatbots get a
second chance: the user rereads, screenshots, complains. A phone call gets none. A voice agent
that hallucinates a price, a policy exception or a part number doesn't produce a wrong paragraph —
it produces a decision the caller acts on: they hang up believing a return is free, a part fits, a
claim is covered. A caller who is told "I don't know, let me get someone who does" has lost thirty
seconds. A caller who is told the wrong thing confidently has lost trust, and the business may have
lost a return, a warranty dispute or a compliance finding.

The industry's default answer — "prompt it to be careful" — is not a control, it's a hope. A model
that decides for itself whether it knows enough is the same model that occasionally decides wrong.
VoiceBridge's premise is narrow and testable: retrieval must ground every answer, the decision to
hand off must be a deterministic check rather than a judgement call, and that check must be provable
against a fixed set of questions before a prospect's demo — or a production line — is allowed to go
live.

## Naming

Three candidates, evaluated on how they read as a product name, not just a repo name.

1. **VoiceBridge** (current placeholder). Pronounceable and immediately legible — "bridge between a
   voice agent and a knowledge base" needs no explanation. Trademark risk is real: "Bridge" is one
   of the most overloaded words in enterprise software (integration bridges, VoIP bridges, data
   bridges), so clearance and differentiation would take work. It signals infrastructure/plumbing
   more than a governed-answer product, which undersells the handoff and citation discipline that
   is the actual differentiator. Said aloud on a call — "you're speaking with VoiceBridge support" —
   it reads as a technical component name rather than a product a caller would trust.

2. **GroundLine**. "Ground" carries the core claim (grounded in retrieved content) and "Line" keeps
   the phone metaphor without overclaiming AI-ness. Pronounces cleanly in one pass, no ambiguous
   syllables. Trademark exposure is lower than "Bridge" — the combined term is uncommon in
   voice-AI branding, though "Ground" alone appears in some safety/compliance products and would
   need a clearance check. It signals the product's actual mechanism (grounding) rather than its
   architecture (bridging), which is a better fit for a compliance-literate buyer. Said aloud —
   "thanks for calling, this is GroundLine" — it sounds calm and infrastructure-grade without
   sounding like a component.

3. **Handrail**. An ordinary English word repurposed as a safety metaphor: something you hold onto
   so you don't fall, which maps directly onto the handoff/guardrail behaviour. Highly
   pronounceable, no ambiguity, memorable because it's a real word used unexpectedly. Trademark
   risk is low in the voice-AI category (no known direct collision), though "Handrail" is used by
   some workplace-safety software, so category separation matters. It signals safety net rather
   than AI capability, which undersells the retrieval/grounding half of the story. Said aloud —
   "you've reached Handrail" — it's memorable but slightly odd out of context without a follow-up
   line explaining what it does.

**Recommendation: GroundLine.** It names the mechanism the buyer is actually paying for
(grounding, not bridging), carries materially lower trademark risk than "VoiceBridge", and reads
as calm and trustworthy when said aloud on a live call — the one context where the name itself is
part of the product experience. "VoiceBridge" is a fine engineering codename and should stay as
the repository, binary and Fly app name (`arag-voice-bridge`) regardless of the outcome of this
decision.

## Personas

| Persona | Job to be done | Objection they raise |
|---|---|---|
| **Solutions engineer** running prospect demos | Stand up a credible, on-brand voice demo against a new prospect's own content inside a single sales cycle — without a bespoke integration project. | "The last voice demo we built said something embarrassing live in front of the prospect. How do I know this one won't?" |
| **Contact-centre operations lead** | Deflect routine call volume from human agents without increasing complaint or escalation rates. | "What happens when it doesn't know the answer — does the caller get stuck in a loop, or told something wrong with total confidence?" |
| **Platform / AI engineering lead** | Wire a voice channel into an existing ARAG Knowledge Box without taking on another heavyweight service to operate, patch and secure. | "Is this actually a thin, inspectable layer, or is it another opaque platform with its own lock-in and dependency tree?" |
| **Compliance / risk reviewer** | Sign off a voice channel before it goes anywhere near a real caller, with evidence rather than a demo that happened to go well once. | "Show me the test set, show me what happens on the questions it should refuse, and show me that behaviour doesn't drift when someone edits the prompt." |

## Use cases

1. **Grounded phone support.** A production voice agent answers caller questions from a Knowledge
   Box, citing sources as data and escalating on a fixed rule rather than a vibe.
2. **Pre-sales demo factory, per prospect.** A solutions engineer adds a new prospect — its own
   Knowledge Box, prompt, voice and golden questions — as an admin API call, not a redeploy, and
   gets a working phone demo against that prospect's real content.
3. **Ambient call copilot (Listen mode).** While a human agent is on the call, the bridge listens
   and maintains a structured, evolving brief — topic, caller goal, suggested answers, citations —
   so the agent (not the caller) gets the assist.
4. **Escalation-by-design.** Call flows where "hand off to a human" is a first-class, testable
   outcome of the pipeline, not a silent failure mode discovered after go-live.
5. **Quality gate before go-live.** A prospect's golden set — the questions it must answer and the
   ones it must refuse — runs through the exact production pipeline and blocks the demo or the
   deploy until every case passes.
6. **Multi-brand, multi-Knowledge-Box routing.** One bridge deployment serves several brands or
   business units, each mapped to its own Knowledge Box, system prompt, voice and golden set,
   selected per call by a prospect key.

## Competitive framing

- **Generic LLM voice agents** (an LLM plus a system prompt, no retrieval). Fluent and fast to
  build, but nothing stops the model from answering confidently from parametric memory. There is
  no citation to check and no deterministic point at which it must stop and hand off.
- **RAG-less IVR / scripted bots.** Safe in the narrow sense that they cannot hallucinate — they
  also cannot answer anything outside their menu tree, and callers route around them at the first
  question the script didn't anticipate.
- **Closed, end-to-end voice-AI suites.** Bundle telephony, models and a knowledge layer behind one
  proprietary surface. Fast to buy, hard to bring your own Knowledge Box to, and the grounding and
  handoff logic — the part that actually matters for risk — is not inspectable.
- **DIY glue code.** Teams wiring an LLM, a vector store and a telephony provider together
  themselves. Every team reinvents voice shaping, citation handling, handoff logic and turn metrics
  from scratch, and the discipline usually arrives after the first bad call, not before it.

### Where we don't win

- VoiceBridge is not a telephony or PBX product. It needs a voice platform in front of it that can
  place or receive calls and speak the answer (the shipped demo uses ElevenLabs Conversational AI);
  without one, it is an HTTP API with no phone number attached.
- It is not a Knowledge Box. Retrieval quality is ARAG's job; VoiceBridge cannot make a poorly
  indexed or thin Knowledge Box answer well — it can only refuse cleanly when the content isn't
  there.
- It is not a contact-centre platform. There is no CRM, ticketing, workforce management or
  omnichannel routing here — only the voice-turn discipline layer.
- Today's architecture pools ARAG credentials per Knowledge Box and zone rather than per prospect;
  strict per-tenant credential isolation is a documented extension point, not a shipped guarantee.
- Observability is a 500-turn in-memory ring buffer plus a turn log, not a full analytics or BI
  stack — fine for a demo or a single deployment, not a substitute for a metrics platform at scale.

## Proof points (true today)

- **Deterministic handoff, not a judgement call.** The voice prompt is contracted to prefix any
  unanswerable reply with a fixed sentinel (`HANDOFF:`); the bridge keys off that exact string, with
  belt-and-braces checks for an empty answer, zero retrieval results, or ARAG's own stock refusal
  phrasings — so a turn degrades safely even if a stored configuration omits the prompt.
- **A golden-set gate, not a demo that happened to go well.** Every prospect ships a set of
  questions it must answer and questions it must refuse; `runGoldenEval` runs each one through the
  exact production pipeline and asserts behaviour (answer vs handoff), grounding (≥1 citation),
  and voice shape (≤3 sentences, no URLs, no citation markers) before the demo is trusted.
- **Citations as data, never spoken.** Every response carries a `citations` array (title, URL,
  score) for the console or the human agent to see; the spoken line never contains a URL or a
  citation marker — checked by the golden set, not just by convention.
- **Per-turn latency, on every response.** Every `voice-answer` response returns
  `latency_ms.retrieve`, `latency_ms.first_token` and `latency_ms.total` — measured in the demo
  environment at roughly p50 3.3s / p95 5.6s across a small live sample against the shipped demo
  Knowledge Box — so a partner can hold a real number against their voice platform's tool timeout
  rather than guessing.
- **Zero runtime dependencies.** Node 22.18+ runs the TypeScript sources directly with no build
  step and no third-party package to audit at runtime.
- **OpenAPI-first.** `src/openapi.ts` is the single source of truth for every `/api/v1` route;
  requests are validated against it and contract tests fail the build on drift.
- **Apache-2.0.** The full pipeline — guards, handoff, voice shaping, citations, metrics, golden
  evaluation — is open source and inspectable, not a black box behind an API key.
