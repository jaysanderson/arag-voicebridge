# Introducing VoiceBridge: grounded, cited and governed voice answers

A voice agent that can say anything will eventually say something wrong. That is not a criticism
of any particular model — it is what happens when you ask a system to speak fluently about things
it was never given the source material for. In a chat window, a wrong answer is an inconvenience:
the user rereads it, doubts it, checks elsewhere. On a phone call, a wrong answer is a decision the
caller acts on before anyone gets a chance to correct it. A hallucinated price, a misstated policy,
a part number that doesn't exist — said with total confidence, in a human voice, in real time — is
worse than the agent simply not being there.

We built VoiceBridge to close that gap: a small, open-source service that sits between a voice
platform and a Progress Agentic RAG (ARAG) Knowledge Box, and makes sure every spoken answer is
grounded in retrieved content, that anything the Knowledge Box can't support gets handed to a
human by a fixed rule rather than the model's judgement, and that every turn is measured so
"it seemed to work in the demo" is never the whole story.

## The idea: handoff by rule, not by vibe

Most voice-AI failure stories share a pattern: the model was asked, implicitly or explicitly, to
decide for itself whether it knew enough to answer. Sometimes it decided wrong, and it said so with
exactly the same confident tone it uses when it's right. There is no way to test that decision in
advance, because it isn't a decision — it's a probability distribution wearing a sentence.

VoiceBridge's core design choice is to take that decision away from the model's self-assessment and
turn it into something you can write a test against. The voice prompt is contracted to prefix any
answer it can't support with a fixed sentinel string, `HANDOFF:`. The bridge checks for that exact
prefix — a string comparison, not a judgement call. And because a prompt can be edited, forgotten,
or swapped out for a stored search configuration that doesn't include it, there are two more
checks behind it: an empty answer, and zero retrieval results. If any of the three trips, the turn
becomes a handoff, the caller gets the prospect's own configured handoff line, and the reason is
logged — never guessed at, never silently absorbed.

That contract is what makes a golden set possible. Every prospect ships a list of questions it must
answer and questions it must refuse, and `runGoldenEval` fires each one through the exact pipeline
the live agent uses, checking not just "did it crash" but behaviour (answer vs handoff), grounding
(at least one citation on every answered question) and voice shape (three sentences or fewer, no
URLs, no citation markers read aloud). Nothing gets demoed, let alone deployed, with a red golden
set.

## What a turn actually returns

`POST /api/v1/voice-answer` is the one endpoint a voice platform's custom tool calls. Ask it
something the Knowledge Box supports and you get back the spoken line, its citations as data (never
read aloud), a `false` handoff flag, and the latency breakdown for that turn:

```json
{
  "answer": "The PureSinter furnace is Desktop Metal's debinding and sintering system for binder jetted metal parts, supporting a range of standard sintering-grade materials.",
  "citations": [
    { "title": "Desktop Metal PureSinter Furnace — Overview", "url": "https://example-kb.internal/puresinter", "score": 0.91 },
    { "title": "Binder Jetting Post-Processing Guide", "url": "https://example-kb.internal/post-processing", "score": 0.78 }
  ],
  "handoff": false,
  "latency_ms": { "retrieve": 410, "first_token": 980, "total": 2150 }
}
```

Ask it something outside the Knowledge Box's remit — a question about the weather, or something
that needs a human — and the shape is identical, just with `handoff: true` and a reason that never
gets spoken to the caller:

```json
{
  "answer": "Let me hand you over to a specialist who can help with that.",
  "citations": [],
  "handoff": true,
  "handoff_reason": "no-retrieval",
  "latency_ms": { "retrieve": 180, "first_token": 0, "total": 640 }
}
```

Same schema, same guarantees, whether the underlying model answered confidently or found nothing at
all. That's deliberate: a voice platform integrating against this endpoint never has to special-case
failure — it always gets something speakable, within its own tool timeout.

## Try it in two minutes, no credentials

The repository runs against an in-process mock ARAG seeded with a small demo Knowledge Box, so
there is nothing to sign up for before you see it work:

```bash
git clone <repo-url> arag-voice-bridge
cd arag-voice-bridge
make install   # bun installs dev tooling only — never npm
make dev       # starts on :8080 with the mock ARAG and a demo corpus
open http://localhost:8080
```

The console opens on the **Ask** tab. Type a question — or click a suggestion — and watch the
pipeline steps light up one by one: input guard, ARAG ask, handoff check, voice shaping, citations,
output guard. You'll see the exact line the agent would speak, its citations, the latency
breakdown, and whether it handed off. Press **Run golden set** to watch all ten golden questions for
the demo prospect go through the same pipeline, live, in the browser.

When you're ready to point it at a real Knowledge Box, copy `.env.example` to `.env`, fill in
`ARAG_KB_ID`, `ARAG_API_KEY` and `ARAG_REGION`, and run `make dev` again. Add an ElevenLabs API key
and agent id to unlock the **Call** and **Listen** tabs — a real voice round-trip, and an ambient
copilot that keeps a structured brief updating while a human agent is on the line.

## What's next

VoiceBridge is an MVP, released as open source under Apache-2.0, and we're upfront about what it
doesn't do yet. The prospect registry pools ARAG credentials per Knowledge Box and zone rather than
issuing separate credentials per tenant; that's a documented extension point, not a shipped
guarantee. Observability is a bounded in-memory turn log and metrics window — good for a
deployment of the size this ships for, not a substitute for a full analytics stack at scale.

What is solid today is the part that matters most for trust: the handoff contract, the voice
shaping, the citation handling, and the golden-set gate that gives you a repeatable answer to
"how do we know it won't say something wrong on a live call" — which was the whole point of
building this in the first place. The API is described end to end in `src/openapi.ts` and served at
`/api/v1/docs`; the code is zero-dependency TypeScript that Node 22.18+ runs directly, with no build
step between reading it and running it. Clone it, read the pipeline, and see what the golden set
says about your own content.
