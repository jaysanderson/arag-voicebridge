# Positioning — VoiceBridge

> Working name: **VoiceBridge**. Treat it as a placeholder — see "Naming" below for the
> recommendation, re-evaluated now that real-time listening is the hero feature. The repository and
> deployed app keep the name `arag-voice-bridge` regardless of which product name is chosen.

## Positioning statement

VoiceBridge listens to a live conversation — from any source, on any call it's connected to — and
keeps one evolving, cited brief in front of whoever needs it: who the other person is, what they
want, and what to say next, grounded in a Progress Agentic RAG (ARAG) Knowledge Box and updated as
the conversation moves. When a human is available, they get the brief. When nobody is, the same
grounding can answer the caller directly — and, either way, anything the knowledge base can't
support is handed off by a deterministic rule rather than a guess.

## The problem, and why it matters

A person on a live call — a new support agent, a sales engineer fielding a discovery call they
didn't script, anyone picking up an escalation mid-conversation — has to know what's true right now,
not after the call, and not from memory. Get it wrong and it isn't a typo someone edits later: it's
a sentence said out loud that the other person acts on. The usual fixes are both incomplete. A
static script or knowledge-base search only works if the person stops the conversation to go look;
a general-purpose AI copilot that reasons over the conversation without grounding will eventually
say something fluent and wrong, with the same confident tone whether it's right or not. And when
nobody is available to take the call at all, someone still has to decide, in real time, whether to
guess or make the caller wait.

VoiceBridge's premise is narrow and testable in both directions. While the conversation is live, it
maintains a single structured brief — topic, who the other person is, their goal, the stage the
conversation is at, a summary, key points and suggested answers — refined turn by turn, with every
factual claim traceable to a citation in the Knowledge Box. The server does the throttling (a
rolling window of recent words, a minimum gap between refreshes, a similarity check that skips
restating the same thing), so any client — a web console, a softphone plugin, a telephony bridge —
gets the same behaviour and the same cost profile, not whatever a naive integration happens to fire
per word. And when the same grounding is asked to answer on its own rather than brief a person, the
decision to hand off is a deterministic check against the pipeline's output, not the model's opinion
of its own confidence.

## Naming

> **Shipped name: VoiceBridge.** The analysis below is kept for the record; the programme ships the product as VoiceBridge, and a partner white-labels it under their own name (DECISIONS D-30, D-31 in the workspace).

Three candidates, re-evaluated against the new hero: a live listener that briefs a person, not (only)
an automated answer endpoint.

1. **VoiceBridge** (current placeholder). This name fits distinctly worse under the new framing than
   it did when the hero feature was a single automated answer endpoint. "Bridge" describes a passive
   conduit between two systems — a voice platform and a knowledge base — which was a reasonable
   description of `/api/v1/voice-answer`. The hero capability now is a service that *listens* to a
   conversation and *builds* something (an evolving brief), which isn't bridging anything. It's also
   no longer accurately "Voice": a listen session ingests transcript chunks from any source — a
   realtime STT stream, a telephony webhook, a meeting bot, or someone typing — and several of the
   use cases below (an agent reading a pasted transcript, an after-call summary) never touch audio
   at all. Trademark risk is unchanged and still real ("Bridge" is heavily overloaded in enterprise
   software). Recommend retiring it as the product name.
2. **GroundLine**. "Ground" is the claim that now has to hold across *two* products in one: the live
   brief's key points and suggested answers must be grounded in the Knowledge Box exactly as
   strictly as an automated spoken answer must be, and citations are the visible proof in both
   places. "Line" still reads naturally for a live conversation, on a phone or otherwise, without
   overclaiming what the product automates. Trademark exposure remains lower than "Bridge" and the
   name says nothing that becomes false when the conversation isn't a phone call. Said aloud, or
   read on a screen an agent glances at mid-call ("GroundLine is listening"), it stays calm and
   infrastructure-grade rather than reading as a chatbot brand.
3. **Handrail**. Re-evaluated, this metaphor arguably fits the new hero *better* on one axis — a
   handrail is something you use continuously while you're doing something, not just when you'd
   otherwise fall, which maps well onto a brief that updates every turn of a live conversation
   rather than only intervening on failure. It still undersells the grounding/citation mechanism
   that both the assist and the deflection paths depend on, and "safety net" framing sits oddly
   against a feature whose main value is proactive (suggested questions, suggested answers,
   recommended products), not just defensive. Trademark risk remains low but category separation
   from workplace-safety software still needs a real check.

**Recommendation: GroundLine.** The single claim a buyer has to believe — that what's on screen (or
spoken) traces to real content, not the model's confidence — is the one thing that has to be true
whether a human or the pipeline is the one acting on the brief, and "Ground" says exactly that.
"VoiceBridge" should be retired as the product name: it describes an architecture (bridging two
systems) that the hero feature doesn't have, and a transport ("Voice") the hero feature doesn't
require. "VoiceBridge" stays as the repository, binary and Fly app name (`arag-voice-bridge`)
regardless of this decision.

## Personas

| Persona | Job to be done | Objection they raise |
|---|---|---|
| **Contact-centre supervisor / enablement lead** | Get agents — especially new ones — to say the right thing on a live call without waiting for them to memorise the knowledge base, and see afterwards what the call actually covered. | "My agents already have a knowledge-base search bar. Why is a brief that updates itself better than search, and how do I know it isn't just another window they have to babysit?" |
| **Sales engineer** running discovery calls | Keep track of what a prospect has said, what they're really trying to solve, and what to ask or offer next — without breaking eye contact with the call to go searching for a spec sheet. | "The moment I have to type a query mid-conversation, I've lost the thread. Does this actually keep up with where the conversation is, or is it one turn behind?" |
| **AI platform lead** | Add a live-conversation copilot to an existing telephony/CRM/meeting stack without taking on a new STT vendor dependency or a bespoke integration per channel. | "Is the session API actually independent of how the transcript gets to it, or am I locked into one speech-to-text vendor's SDK?" |
| **Compliance reviewer** | Sign off a system that puts suggestions in front of a person handling a live conversation, with evidence that every factual claim traces to approved content and that the system degrades honestly when it doesn't know. | "Show me that a suggested answer can always be traced to a citation, that the brief doesn't invent product facts, and what happens on the questions the knowledge base can't support." |

## Use cases

1. **Live sales discovery copilot.** A person qualifying a prospect gets an evolving read of who
   they're speaking to, their goal, the stage of the conversation, and grounded talking points and
   product fits as the discovery call moves — the shipped demo's own sample conversation (a
   3D‑printing discovery call) is built around exactly this case.
2. **Support agent assist.** A person handling a live support call gets suggested, cited answers
   drawn only from the Knowledge Box, so a newer agent doesn't have to choose between guessing and
   putting the caller on hold to go searching.
3. **Onboarding new agents.** The brief is a continuously-updating handrail for someone who doesn't
   yet know the knowledge base by heart — they read what's suggested rather than having to know what
   to search for.
4. **Escalation prep.** Whoever picks up an escalated call inherits the session's current brief and
   accumulated citations instead of starting cold — the topic, the caller's goal and the stage of the
   conversation are already there.
5. **After-call summary from the session record.** Ending a session keeps its brief, its full
   citation list and its stats for review — a session's brief history (every version that was ever
   shown, with its timestamp and latency) is available afterwards in Conversations, not just
   during the call.
6. **Self-serve deflection.** The follow-on: the same grounded-answer pipeline, without a human on
   the call, answers a caller directly over `POST /api/v1/voice-answer` and hands off by a
   deterministic rule when the knowledge base can't support an answer.

## Competitive framing

- **Agent-assist / real-time coaching incumbents.** Mature products in this category typically add
  call recording, sentiment and talk-time analytics, CRM and dialer integrations, and coaching/QA
  scoring on top of a live transcript. VoiceBridge doesn't do any of that — it does one thing,
  a grounded, cited, evolving brief, and does it independently of which STT vendor or telephony
  stack sits underneath. A buyer who wants the wider coaching/analytics suite should look there
  first; a buyer who specifically needs the brief to be provably grounded and inspectable, not a
  black-box model call, is the fit.
- **Generic LLM meeting copilots / notetakers.** Fluent, fast to set up, and good at summarising what
  was said — but nothing stops them answering a factual question from the model's general knowledge
  rather than the buyer's own content, and there's no citation to check the claim against. The brief
  here is deliberately more conservative: key points and suggested answers are drawn only from the
  Knowledge Box, and the schema leaves a field empty rather than inventing something to fill it.
- **RAG-less IVR / scripted bots.** Still relevant for the deflection follow-on: safe in the sense
  that they can't hallucinate, but they also can't answer anything outside a fixed menu tree.
- **DIY glue code.** Teams wiring a realtime STT feed, an LLM and a prompt together themselves get a
  working demo quickly and then discover the throttling, citation handling and "what happens on
  failure" problems this ships with already solved — usually after the first call where an
  unthrottled client fired an LLM call on every word, or a failed refresh blanked the screen instead
  of leaving the last good brief up.
- **A hand-wired ElevenLabs Conversational AI setup.** Wiring a voice agent to a custom backend
  normally means hand-copying a system prompt, a tool schema and a webhook URL into the ElevenLabs
  dashboard, once per customer, with no record of what was actually pushed versus what's in the
  prompt file. VoiceBridge's Settings screen reads the desired configuration, diffs it against what
  ElevenLabs actually has, and pushes the difference — the same operation is a repeatable API call
  (`POST /api/v1/admin/voice-agent/push`), not a dashboard ritual someone has to remember correctly
  for the tenth customer.

### Where we don't win

- VoiceBridge does not do speech-to-text, diarisation, or telephony. A session ingests transcript
  chunks; something else — a realtime STT vendor, a telephony webhook, a meeting bot, or the shipped
  browser microphone client — has to produce them. Bring-your-own-transcription is deliberate, but
  it does mean there is no built-in audio pipeline to point at a phone number.
- There is no coaching, scoring, sentiment or talk-time analytics layer, and no CRM or dialer
  integration. This is the brief and nothing else; a buyer expecting a full agent-assist suite will
  need to add those separately.
- There is no automated quality gate for the live brief today. The golden-set gate — the
  answer/handoff pass-fail check — covers the deflection pipeline (`/api/v1/voice-answer`) only;
  reviewing whether a live brief was actually useful on a given call is a manual read of the brief
  history in Conversations, not a scored test suite.
- It is not a Knowledge Box. Retrieval quality is ARAG's job; a poorly indexed or thin Knowledge Box
  produces a thin brief no matter how good the throttling and prompt discipline are.
- Session state is a single-machine, in-memory store with a 200-session cap and a bounded brief
  history (the last 20 versions per session); a process restart ends any session left "live". This
  is a strong demo/pilot shape, not a durable, horizontally-scaled session store.
- Today's architecture pools ARAG credentials per Knowledge Box and zone rather than per prospect;
  strict per-tenant credential isolation is a documented extension point, not a shipped guarantee.

## Deployable by a partner, not just demoable

Everything a deployment needs to be operated — not merely shown — is now a screen, not a redeploy:

- **Every configurable value is editable in the product.** Branding, the Knowledge Box connection,
  every rate limit and timeout, the ElevenLabs stack — all 43 settings behind Settings are stored,
  not just read from the environment, and a change takes effect on the next request. An environment
  variable is only the starting value.
- **A voice agent pushed from the product, not pasted into a dashboard.** Settings reads what a
  prospect's ElevenLabs Conversational AI agent should look like, diffs it field by field against
  what ElevenLabs actually has, and a single action pushes the difference — the router prompt, the
  greeting, the voice, and the custom tool's URL, method, timeout and authentication header. Cloning
  the setup for the next customer is a registry entry and a button, not a second trip through the
  dashboard.
- **A real API key store.** Named, revocable keys with last-used tracking replace a single shared
  environment variable; revoking one bites on the very next request, and the record survives its own
  revocation for the audit trail.

## Proof points (true today)

- **One evolving brief, not a fresh answer each time.** Every refresh receives the running
  transcript and the previous brief and is instructed to refine and extend it rather than restart —
  the brief carries a `topic`, `caller_profile`, `their_goal`, `stage`, `summary`, `key_points`,
  `suggested_questions`, `suggested_answers` and `recommended_products`, all grounded in the
  Knowledge Box except the persona/intent reasoning, which is explicitly over the conversation.
- **Server-side throttling, not per-client guesswork.** A refresh only fires on a genuinely new
  window of conversation: at least 4 words, at least 1.5 seconds since the last refresh, and not
  merely a re-statement of the last window (a similarity check skips anything more than 85% the same
  as what was just asked about) — the same rule for a web console, a softphone plugin, or a
  telephony bridge.
- **A refresh failure never blanks the brief.** `ListenService.refresh` never throws: an upstream
  error, a timeout, or a brief with nothing usable in it leaves the previous brief exactly as it
  was, rather than flashing an error at someone mid-call.
- **Citations accumulate across the whole call.** Sources seen in any refresh are deduped by title
  and URL and kept at their best score, capped at twelve, so the citation list under a brief reflects
  everything relevant said so far — not just the most recent refresh.
- **Per-session latency stats, on every session.** Every session tracks refreshes, throttled
  (skipped) refreshes, failures, the latency of the last refresh, and rolling p50/p95 latency over
  its own recent refreshes — visible on the session and in Conversations.
- **Deterministic handoff for the deflection follow-on.** The voice prompt is contracted to prefix
  any unanswerable reply with a fixed sentinel (`HANDOFF:`); the pipeline keys off that exact string,
  with belt-and-braces checks for an empty answer, zero retrieval results, or ARAG's own stock
  refusal phrasings.
- **A golden-set gate for the deflection pipeline.** Every prospect ships a set of questions it must
  answer and questions it must refuse; `runGoldenEval` runs each one through the exact production
  pipeline and asserts behaviour, grounding (≥1 citation) and voice shape before a deployment is
  trusted to answer on its own.
- **Per-turn latency, on every deflection response.** Every `voice-answer` response returns
  `latency_ms.retrieve`, `latency_ms.first_token` and `latency_ms.total` — measured in the demo
  environment at roughly p50 3.3s / p95 5.6s across a small live sample against the shipped demo
  Knowledge Box.
- **Zero runtime dependencies.** Node 22.18+ runs the TypeScript sources directly with no build step
  and no third-party package to audit at runtime.
- **OpenAPI-first.** `src/openapi.ts` is the single source of truth for every `/api/v1` route,
  including the listen-session endpoints; requests are validated against it and contract tests fail
  the build on drift.
- **Apache-2.0.** The full pipeline — the listen service, the brief schema, the deflection pipeline,
  guards, handoff, voice shaping, citations, metrics, golden evaluation — is open source and
  inspectable, not a black box behind an API key.
