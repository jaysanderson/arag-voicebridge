# Walkthrough: the workspace

VoiceBridge is a workspace, not a single page: a dark, Progress-branded left rail (**Live**,
**Conversations**, **Knowledge**, **Prospects**, **Quality**, **Settings**) with one section mounted
per view under `/`, `/conversations/`, `/knowledge/`, `/prospects/`, `/quality/` and `/settings/`.
Every view consumes only `/api/v1` — the browser never holds an ARAG or ElevenLabs credential.
Screenshots are deliberately omitted here (see [`../../showcase/`](../../showcase/) for a recorded
walkthrough) so this page stays accurate as the UI evolves.

A **prospect switcher** in the top bar (present on every section except Live's first run) is which
Knowledge Box/persona you're driving; switching it reloads whatever the current section shows for
that prospect. A link at the foot of the rail opens **Operator** — the same shell, with the
deployment's own views — see [`walkthrough-admin.md`](walkthrough-admin.md).

## Live — the hero path

The workspace opens here (`/`). This is real-time listening: feed a conversation in from a
microphone, a telephony webhook, or typed text, and one evolving, cited brief fills the main pane —
who you're speaking to, what they want, the knowledge that matters right now, and what to say next.
Live itself never speaks; it's a copilot for whoever's on the call, not a participant in it.

### First run

Before any session has been started, Live shows an onboarding panel: what it will do (listen as the
conversation moves and keep one short, cited brief on screen), what it will not do (it never speaks;
nothing is injected into the call; a failed refresh leaves the last good brief in place), and a
**Play sample conversation** button. Press **Skip** instead and the panel is replaced by the three
starting points described below; either way the choice is remembered in the browser, so it only
shows once.

### Play the sample conversation

No credentials are needed. Pressing **Play sample conversation** (in the onboarding panel, or later
from the starter row) feeds a scripted nine-line discovery call — a machine shop asking about metal
3D printing and post-print sintering — into a fresh listen session, one line roughly every 1.4
seconds, so the brief builds in view rather than all at once. **Stop sample** ends it early.

### Watch the brief evolve

The **Brief** card is the main pane. As lines arrive, fields appear and are refined in place rather
than replaced from scratch: a topic line, a one-line profile of the other person, their goal and the
stage of the call, a summary, key points drawn only from the knowledge base, suggested questions to
ask, suggested answers to give, and — when something genuinely fits — recommended products. A
**Sources used so far** row accumulates citation chips underneath as new material is drawn on across
the call. The chip beside "Brief" reads **no session** → **listening** (with a live dot) → **ended**,
and a small note under the title reads "showing the last good brief" — with a **Retry now** button —
if a refresh comes back empty; the brief is never blanked by a failed or throttled refresh, and
retrying asks the server for one more refresh of the same conversation rather than fabricating new
transcript to provoke one.

Alongside the brief, the **Session** card shows the session id, how long ago it started, turns
heard, brief refreshes, refreshes the server-side throttle skipped, and the latency of the last
refresh (with a running p50/p95) — the same numbers a real telephony integration would produce. The
**Transcript** card lists every turn heard so far, with an interim "hearing…" line while the
microphone is live.

### The three ways to start listening

Before a session exists, the main pane offers three starting points:

- **Microphone** — transcribed live by ElevenLabs Scribe v2 Realtime and fed straight into the
  session. Disabled with "Needs an ElevenLabs key on this deployment" when `ELEVENLABS_API_KEY`
  isn't set. Once connected, a small strip shows the connection state, the model, the detected
  language and the latency of the last final transcript — the number that decides whether the brief
  can keep up.
- **Telephony webhook** — opens a drawer with copy-paste `curl` for the whole lifecycle (open a
  session on connect, post transcript chunks as they're recognised, read the brief over SSE or by
  polling, end the call) — this is the vendor-neutral path a phone system, meeting bot or any speech
  service drives with a plain HTTP `POST`.
- **Typed or pasted** — a text box, one line per turn, prefixed `caller:`/`agent:`. Press **Send to
  session** (or Cmd/Ctrl+Enter) and a session starts on the first line if one isn't open yet. This is
  the fastest way to see what the brief would have shown for a real transcript, with no
  credentials at all.

A **Brief model** dropdown (populated from the prospect's available models) lets you pick a specific
fast model for the brief; the default, "Auto — fast default," is what a live call would use.

### The optional spoken cue

Once a session is open and the deployment has an ElevenLabs key, a **Read the next line aloud**
toggle appears. Off by default: turning it on speaks the single most useful line of the current
brief (a suggested answer, or failing that a suggested question) into the handler's own ear over
ElevenLabs text-to-speech each time the brief updates — never into the call. Turning the deployment's
key off later degrades this silently: the toggle stays available but a spoken cue simply fails
quietly.

### The voice agent, in a drawer

**Voice agent call**, in the page's top-right action, opens a drawer for the follow-on capability:
speaking to the agent directly and hearing grounded answers back, over ElevenLabs Conversational AI.
It calls this service's `POST /api/v1/voice-answer` as a custom server tool, so every spoken answer
still comes from the Knowledge Box, and it hands off by the deterministic rule when the content
can't support an answer. It needs the selected prospect's `agent_id` configured (not the shipped
placeholder) — without one, the drawer explains what to set and where (Prospects), rather than
failing silently. This is a tool available from Live, not a destination of its own: supporting the
person on the call is the product.

### End and save

Press **End and save** when you're done. The session, its final brief, its full citation list, its
brief history and its stats are kept — **Open in Conversations** takes you straight to its detail.

## Conversations — every past session

`/conversations/` lists every session this deployment has listened to, newest first. A search box
searches what was actually said — the prospect, the brief's topic/summary/goal/profile, the
accumulated source titles, and the transcript itself — so a session can be found by its content, not
just its id. Filter by prospect or by status (live/ended), sort any column (started, refreshes,
duration), and page through the results; a result count and a `1–20 of N` range sit above and below
the table.

Click a row (or press Enter on it) to open its detail drawer:

- **Stats** — prospect, duration, brief version reached, refreshes (with throttled/failed counts),
  refresh p50/p95, and the number of sources.
- **Final brief** — exactly what Live showed when the session ended, with its citation chips.
- **How the brief evolved** — a timeline of every refresh that produced a usable brief, newest
  first: version number, how long ago, how long that refresh took, and the topic/summary line at
  that point. This is the practical way to answer "how did the brief get here" rather than only
  "what does it look like now."
- **Transcript** — the whole conversation, speaker by speaker.

**Export** downloads the same record as Markdown — a handover note with the final brief, its brief
history, the transcript and the citations — via `GET /api/v1/listen/sessions/{id}/export`.

## Knowledge — what a prospect is grounded in

`/knowledge/` is the content behind every brief and every answer for the selected prospect:

- **Knowledge Box** card — connectivity (with round-trip time), a partially masked Knowledge Box id,
  region, resource count, the answer and brief models in play, the reranker, and whether a stored
  search configuration is provisioned or the pipeline is still building the request inline.
- **Golden set** — the gate before a prospect is trusted to answer on its own: every one of its test
  questions runs through the exact pipeline a live turn uses. Press **Run golden set** to fire a job
  and watch its live timeline; when it finishes, the table fills in with each question, what was
  expected, pass/fail (a failing row names the specific check that failed), and its latency. The chip
  at the top reads **gate open** or **gate closed**. **Run history** below it lists every past run
  for this prospect — click one to see its full per-question detail.
- **Ask it something** — the same nine-step turn pipeline a spoken call would run, as a text
  question. Suggested chips (drawn from the prospect's own golden questions, including one
  deliberately out-of-scope one) are a fast way to see both halves of the story: a grounded, cited
  answer, and a clean handoff instead of a guess. Each answer shows its citations and the
  retrieve/first-token/total latency breakdown.

## Quality — is it behaving?

`/quality/` reports on the deflection pipeline (voice-answer calls and golden-eval runs together,
filterable to either): turns in the current window, p50/p95 total latency, p50 first-token latency,
handoff rate, citation coverage, and guard-trip rate, with what each number means spelled out beside
it. The **turn log** lists individual turns with an outcome filter (answered / handed off / guard
trip) and a source filter (live turns / golden runs); click a row to open its detail — the full
latency breakdown, the outcome and reason, and the question text (or, pointedly, "not stored" when a
safety guard fired instead of a real question reaching the Knowledge Box). A **why turns did not
answer** panel ranks handoff and guard-trip reasons by frequency, so a reviewer can see what's
actually driving handoffs rather than reading through the log row by row. There is still no
equivalent automated gate for the live brief itself — see [`when-to-use.md`](when-to-use.md) — so a
brief's own quality is read from its history in Conversations, not from a number here.

## Prospects — the registry

`/prospects/` lists every prospect this deployment answers for: its Knowledge Box, region, whether a
search configuration is provisioned, its golden-question count, and whether it carries its own brand
overlay. The registry is **read-only** until the deployment's admin token is entered inline — the
same gate the Operator views use. Unlocked, **Edit**/**New** open a JSON editor over the prospect
configuration, with **Provision search config** and **Delete** alongside it; a brand overlay (a
`brand` block layered on the deployment's own `BRAND_*` configuration) is set the same way. Without
the token, a **View** link still shows a prospect's non-secret detail — its locale, greeting,
handoff line and golden questions.

## Settings — connection, branding and integrations

`/settings/` is where a deployment's own configuration is read back: **Connection** (the Knowledge
Box's health, endpoint and answer model, and how many prospects are registered — per-prospect detail
lives under Operator → Connection), a **Branding** preview built from the same `BRAND_*` variables
Settings itself reads, and **Integrations** — every optional integration this deployment ships with,
whether it's configured, and exactly which capability each one powers here (Scribe transcription,
the voice agent, text-to-speech, the video-avatar pane), plus the ElevenLabs agent's exact tool
definition and router system prompt to paste into the ElevenLabs dashboard for the selected
prospect. An **API** card links to the interactive API reference and shows the one `curl` command
that opens a listening session — everything this workspace does, your own application can do the
same way.

## Where to go next

- [`walkthrough-admin.md`](walkthrough-admin.md) — the Operator views, in the same shell.
- [`../developer/integrations.md`](../developer/integrations.md) — setting up the ElevenLabs agent
  referenced from Live's voice-agent drawer and Settings' Integrations card.
- [`../developer/extension-points.md`](../developer/extension-points.md) — the full onboarding
  ritual a new prospect goes through, of which the golden set on Knowledge is the last step.
