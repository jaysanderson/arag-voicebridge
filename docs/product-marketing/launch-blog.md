# Introducing VoiceBridge: the assistant listens, and tells the person what's true

A live conversation moves faster than anyone can look things up. A new support agent, a sales
engineer fielding a discovery call they didn't script, anyone who picks up an escalation
mid-conversation — they all have the same problem: they need to know what's true *right now*, not
after the call, and not from memory. Stop to search and you've lost the thread. Guess and you might
be saying something the knowledge base would have told you was wrong.

We built VoiceBridge to close that gap. It listens to a conversation as it happens — from a
realtime speech-to-text stream, a telephony webhook, a meeting bot, or someone simply typing — and
keeps one evolving, structured brief in front of whoever's handling the call: who the other person
is, what they want, where the conversation has got to, and what to say next, grounded in a Progress
Agentic RAG (ARAG) Knowledge Box and cited so nobody has to take it on faith. When nobody's
available to take the call at all, the same grounding can answer the caller directly, and hand off
by a fixed rule — never a guess — when the knowledge base can't support an answer.

## How it works: a session, not a request

Most "ask a question, get an answer" APIs are stateless. A live conversation isn't, so the listening
path isn't either. You open a session for a prospect, feed it conversation as it arrives, and read
the brief back as it evolves — over Server-Sent Events, or by polling the session.

Start a session:

```bash
curl -sX POST http://localhost:8080/api/v1/listen/sessions \
  -H 'content-type: application/json' \
  -d '{"prospect": "progress"}'
```

```json
{
  "id": "b3f1c9a2-...",
  "createdAt": "2026-09-12T09:00:00.000Z",
  "updatedAt": "2026-09-12T09:00:00.000Z",
  "prospect": "progress",
  "status": "live",
  "brief": null,
  "briefVersion": 0,
  "citations": [],
  "stats": { "chunks": 0, "words": 0, "refreshes": 0, "skipped": 0, "failures": 0,
             "lastLatencyMs": 0, "p50LatencyMs": 0, "p95LatencyMs": 0 },
  "transcript": [],
  "transcriptTotal": 0
}
```

Feed it a line of conversation, from any source — the shape is the same whether it came from a
telephony webhook or a person typing:

```bash
curl -sX POST http://localhost:8080/api/v1/listen/sessions/b3f1c9a2-.../transcript \
  -H 'content-type: application/json' \
  -d '{"chunks": [
        {"speaker": "caller", "text": "We run a machine shop — mostly stainless steel brackets, a few hundred a week."}
      ]}'
```

```json
{
  "session": { "...": "the same session shape as above, transcript now non-empty" },
  "refresh": "started",
  "reason": "ok"
}
```

`refresh` tells you what the server-side throttle decided: `started` (worth an LLM call),
`scheduled` (too soon since the last refresh, deferred rather than dropped), or `skipped` (too few
words, unchanged, or too similar to the window just processed). The throttle lives on the server
precisely so this decision doesn't depend on how disciplined a given client is.

Read the brief as it evolves over the session's SSE stream:

```bash
curl -N http://localhost:8080/api/v1/listen/sessions/b3f1c9a2-.../events
```

```
event: brief
data: {"brief":{"topic":"metal 3D printing for machined parts","caller_profile":"Runs a machine shop producing stainless steel brackets and manifolds at volume.","their_goal":"Replace slow, wasteful machining of manifolds with metal 3D printing.","stage":"exploring","summary":"The caller is evaluating binder jetting to replace machining for manifolds and is asking about the post-print furnace step.","key_points":["Binder jetting requires a separate debinding and sintering step after printing."],"suggested_questions":["What volumes and tolerances do the manifolds need?"],"suggested_answers":["The furnace handles debinding and sintering for binder-jetted parts in a single system."],"recommended_products":[]},"version":3,"citations":[{"title":"Binder Jetting Post-Processing Guide","url":"https://example-kb.internal/post-processing","score":0.86}],"stats":{"chunks":6,"words":74,"refreshes":3,"skipped":2,"failures":0,"lastLatencyMs":1180,"p50LatencyMs":1150,"p95LatencyMs":1320}}
```

Every field in that `brief` object comes from the same schema whether the conversation is a sales
discovery call or a support escalation: `topic`, `caller_profile`, `their_goal` and `stage` are the
model's read of the *conversation*; `summary`, `key_points`, `suggested_answers` and
`recommended_products` are drawn only from the Knowledge Box, and the schema requires the model
leave a field empty rather than invent something to fill it. Each refresh receives the previous
brief and is told to refine and extend it, not start over — which is why the brief above already has
a `stage` and a `caller_profile` a few turns in, rather than restarting cold every time.

## Try it in two minutes, no credentials

The repository runs against an in-process mock ARAG seeded with a small demo Knowledge Box, so
there's nothing to sign up for before you see the hero feature work:

```bash
git clone <repo-url> arag-voice-bridge
cd arag-voice-bridge
make install   # bun installs dev tooling only — never npm
make dev       # starts on :8080 with the mock ARAG and a demo corpus
open http://localhost:8080
```

The workspace opens on **Live**, the hero page. Press **Play sample conversation** and watch a scripted
3D-printing discovery call play out line by line — no microphone, no ElevenLabs key, nothing to
configure — while the brief panel on the right fills in: a topic line, a goal/stage chip row, a
profile of the caller, a summary, key points from the knowledge base, suggested questions, suggested
answers and, when something genuinely fits, recommended products. A running list of citation chips
accumulates underneath as new sources are used, and the stats panel shows chunks received, refreshes
run, refreshes the throttle skipped, and the latency of the last one.

You can also paste or type your own conversation into the box below the sample button — one line
per turn, prefixed with `caller:` or `agent:` — and send it to the same session to see the brief
react to a different conversation entirely.

When you're ready to point it at a real Knowledge Box, copy `.env.example` to `.env`, fill in
`ARAG_KB_ID`, `ARAG_API_KEY` and `ARAG_REGION`, and run `make dev` again. Set `ELEVENLABS_API_KEY`
and Live's microphone switches to real ElevenLabs Scribe v2 Realtime transcription feeding the same
session API, and giving a prospect a real ElevenLabs `agent_id` turns on the voice-agent call in
Live's drawer, where the same grounding answers the caller directly when nobody's available — see
the next section.

## The same grounding, when nobody's on the line

The listening path assumes a person is handling the call and the brief is there to help them. The
follow-on assumes nobody is: `POST /api/v1/voice-answer` runs the same kind of grounded retrieval
against the Knowledge Box and returns a spoken-shaped answer directly, with citations as data and a
`handoff` flag that trips on a deterministic rule — a fixed sentinel the prompt is contracted to use
(`HANDOFF:`), backed up by checks for an empty answer or zero retrieval results — rather than the
model's own opinion of whether it knows enough. Every prospect ships a golden set of questions it
must answer and questions it must refuse, and nothing is demoed or deployed until that set is green.

## What's next

VoiceBridge is an MVP, released as open source under Apache-2.0, and we're upfront about what it
doesn't do yet. There's no built-in speech-to-text or telephony — a session takes transcript chunks
from whatever produces them, which is deliberate, but it does mean there's no audio pipeline
included. There's no automated quality gate for the live brief the way there is for the deflection
path; reviewing whether a brief was actually useful on a given call is a manual read of the brief
history in Conversations today. Session state lives in a single-machine, in-memory store with a
200-session cap, which is a strong shape for a demo or a pilot, not yet a durable, horizontally
scaled session store.

What's solid today is the part that matters most: a session that listens from any source, throttles
itself so a naive client can't turn every word into an LLM call, keeps one evolving brief instead of
restarting cold, and never blanks the screen when a single refresh fails. The API is described end
to end in `src/openapi.ts` and served at `/api/v1/docs`; the code is zero-dependency TypeScript that
Node 22.18+ runs directly, with no build step between reading it and running it. Clone it, play the
sample conversation, and see what the brief says about your own content.
