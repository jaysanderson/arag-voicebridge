# VoiceBridge showcase — narrated script

Target running time: **2:48**. Recorded by `showcase/record.spec.ts` against the mock ARAG
(`ARAG_MOCK=1`, prospect `progress`) — no credentials required. The screen is the rebuilt
workspace: the Live, Conversations, Knowledge, Quality, Settings and API sections at `/`, and the
Operator panel at `/admin/`, all at 1280×800. The timestamps below are taken from a real recording,
not estimated. The spec prints two timelines and this file is re-timed from them: each section
heading below is the moment that section's screen was *ready* — the assertions proving the new
state have passed — and each screenshot time is when that still was actually captured, several
seconds into the beat. The clock starts at the first painted frame, and the spec puts the recording
back on a real-time clock before it finishes (Playwright's screencast writes a slightly stretched
timeline), so these are video times. They still drift a little between runs, because the spec paces
itself off real UI state (a version number moving forward, a chip changing, text appearing) rather
than the clock.

VoiceBridge's hero capability is real-time listening: a live conversation streamed in, one
grounded brief kept current throughout the call. That leads the showcase. A one-off question, the
quality gate, the guard and the Operator panel follow as supporting evidence that this is a
product, not a demo. The take then closes on what the product gained in this pass: a deployment
rebranded live without a restart, the ElevenLabs voice agent configured from inside the product,
and every API operation callable from the workspace itself.

---

## 00:00–00:07 — The problem

**On screen:** the workspace loads on **Live** — that is the default screen, not a search bar or
an "Ask" tab. No session is running. The first-run banner explains what starting one will do, and
what it will not.

**Voice-over:**
> "Someone on a live call needs to know what is true right now, not after it ends. This is Live,
> the screen VoiceBridge opens on. Nothing is running yet — the banner says what starting a session
> will do, and just as importantly what it will not: it never speaks, and a failed refresh leaves
> the last good brief in place rather than blanking it."

**Screenshot:** `01-live-first-run.png` (00:07)

---

## 00:07–00:28 — Play the sample conversation, and watch the brief evolve

**On screen:** press **Play sample conversation** from the banner. A scripted nine-line discovery
call feeds in, roughly one line every 1.4 seconds. Within a few lines the brief on the left fills
in — topic, caller profile, their goal, key points, what to ask, what to say, products to
recommend — with a citation chip appearing underneath. The version number in the brief's header
ticks forward as the call continues; by the time the sample finishes on its own, several more
citations have accumulated underneath.

**Voice-over:**
> "Press play. The brief is not being redrawn from scratch on every line — the version number in
> its header only moves forward when the server's own throttle decides a refresh is actually worth
> an LLM call, so a burst of turns produces one refresh, not nine. Watch it climb through several
> real versions as the caller says more: a machine shop, then binder jetting, then a furnace, then
> titanium and budget. Every claim in it is grounded, and the sources are listed right there,
> building up underneath as the call goes on."

**Screenshots:** `02-brief-first-citation.png` (00:16 — the brief's first grounded version, with
its first citation), `03-brief-evolved.png` (00:28 — a later version, after the whole sample call
has played through)

---

## 00:28–00:40 — The transcript and the session's own numbers

**On screen:** alongside the brief, the full transcript of the scripted call, caller and agent
lines labelled. The session card's own numbers: turns heard, brief refreshes, how many were
skipped by the throttle, and the latency of the last refresh.

**Voice-over:**
> "Next to the brief, the actual transcript, and the numbers behind what just happened: how many
> refreshes ran, how many the throttle skipped, and how long the last one took. Against the mock
> Knowledge Box that is a handful of milliseconds — against a real one, expect a few seconds, which
> is still comfortable against a caller speaking for eight to fifteen seconds a turn."

**Screenshots:** `04-transcript.png` (00:34), `05-session-stats.png` (00:40)

---

## 00:40–00:59 — End the call, then find it again in Conversations

**On screen:** **End and save**. The session card confirms the brief is kept and offers to open it
in Conversations. Switch to **Conversations**, search for something the caller actually said —
"titanium" — and open the matching record: the final brief, a version-by-version timeline of how
it got there, the full transcript, and an export link.

**Voice-over:**
> "Ending a session does not lose anything — the brief, its sources and how it developed are kept.
> Conversations lists every call this deployment has listened to. Searching for something the
> caller actually said finds this one. Opening it shows the same final brief, the transcript in
> full, and — scrolling down — every version the brief passed through on the way there, oldest at
> the bottom, each one timestamped and timed."

**Screenshots:** `06-conversation-brief.png` (00:52 — the drawer's final brief and citations),
`07-conversation-evolution.png` (00:59 — the same drawer, scrolled to "How the brief evolved")

---

## 00:59–01:20 — Knowledge: what it is grounded in, a cited answer, and the pipeline behind it

**On screen:** **Knowledge**. Which Knowledge Box this prospect is grounded in, honestly marked as
sample content on this deployment. The Ask tester runs the same pipeline a live turn does: ask it
something the content covers, and the answer comes back with a citation, an "answered" chip, and
the nine pipeline steps that produced it — retrieval, citation extraction, the handoff decision,
the output guard — each with its own timing. Ask something out of scope — the capital of France —
and it hands off with the prospect's own handoff line rather than guessing.

**Voice-over:**
> "Knowledge shows what a prospect is actually grounded in — this deployment is deliberately
> running sample content, marked as such rather than pretending otherwise. The Ask tester runs the
> exact same pipeline a live turn does, and shows its work: nine steps, timed, from retrieval to
> the output guard. Ask it something it knows, and the answer carries a citation. Ask it something
> it does not, and it hands off — a fixed rule, not a judgement call."

**Screenshots:** `08-knowledge-box.png` (01:05), `09-knowledge-ask-grounded.png` (01:12),
`10-knowledge-ask-handoff.png` (01:18)

---

## 01:20–01:28 — The quality gate: the golden set, live

**On screen:** the golden-set card is brought into frame first, reading *"Nothing has run in this
session"*, and held there for a beat. Then **Run golden set** is pressed. Ten questions — seven
that should answer, three that should hand off — are posted and run through the exact same pipeline
a live turn uses, and the results stream back over the card's own event stream: the chip goes to
*running*, then settles on **"gate open"**, and the table fills in question by question, ten out of
ten passed. The narration below starts on the settled gate, not on the press — the run itself takes
a few real seconds, and they are the point.

**Voice-over:**
> "Before a prospect is trusted to answer, it has to clear this gate: the same ten questions, run
> right now, through the same pipeline used on a real call. All ten pass, so the gate opens. This
> is the one automated quality check in the product today — there is no equivalent gate yet for the
> live brief itself, only for this deflection path."

**Screenshot:** `11-knowledge-golden-gate-open.png` (01:27)

---

## 01:28–01:35 — Quality: the numbers, and a guard trip redacted

**On screen:** **Quality**. The metrics strip — turns in the window, latency percentiles, handoff
rate, citation coverage, guard-trip rate. Filtered to guard trips, the turn log shows a row whose
result reads "guard · prompt-injection" and whose question column reads "redacted (guard trip)"
rather than the text itself.

**Voice-over:**
> "Quality is where all of that gets checked in aggregate. And when someone tries an injection, the
> guard trips before the model ever sees it — the log keeps the reason, never the text, so the log
> itself cannot leak what was attempted."

**Screenshot:** `12-quality.png` (01:35)

---

## 01:35–01:49 — Into the Operator panel

**On screen:** sign in at **/admin/** with the deployment's admin token. Overview reports Knowledge
Box call counts and store sizes. Switching to **Listen sessions** and opening this exact call shows
the same brief history, from the other side: every version, its own timestamp, its own refresh
latency.

**Voice-over:**
> "Behind the product is an Operator panel for whoever runs the deployment, behind its own token.
> It sees the same session Conversations showed, but from the operator's side — every version the
> brief passed through, and exactly how long each refresh took to produce."

**Screenshots:** `13-admin-overview.png` (01:42), `14-admin-session-brief-history.png` (01:49)

---

## 01:49–01:55 — Settings: read-only until it is unlocked

**On screen:** **Settings**. The connection's real health is on the page for anyone — connected,
answering from the mock Knowledge Box — but every group of values is withheld behind a single
banner: *viewing this deployment read-only*, with a token field and **Unlock** beside it. The same
token that opened the Operator panel unlocks the forms here, in place.

**Voice-over:**
> "Settings is where the deployment is configured. Until this browser proves it is an operator it
> is a reading screen: the health of the connection, and everything else held back behind one
> unlock. The same token the Operator panel took opens it — in place, on this page. Nobody is sent
> to a separate admin application to change a setting and then sent back."

**Screenshot:** `15-settings-read-only.png` (01:55)

---

## 01:55–02:18 — Rebrand it while you watch

**On screen:** unlock, and every group becomes a form. Type a partner's product name into
**Branding** and the preview beside it repaints on the keystroke — new name, "including unsaved
changes" — while the rail still says VoiceBridge. Press **Save**: "Saved — live now, no restart",
and the rail, the breadcrumb and the browser tab all change to the partner's name without a
reload. Then **Reset to the environment**, confirm, and the deployment falls straight back to what
its environment variables say.

**Voice-over:**
> "Every setting this product reads from configuration is editable here, and the store overrides
> the environment rather than replacing it. Type a partner's name into Branding: the preview
> repaints as you type, before anything is saved, and says so — the workspace around it has not
> moved. Save, and it does move. The rail, the tab title and the action colour repaint underneath
> you: no reload, no redeploy, no restart. And because the environment is still the default behind
> the store, resetting the group puts the deployment straight back."

**Screenshots:** `16-settings-brand-preview.png` (02:03 — the preview changed, the rail not yet),
`17-settings-brand-live.png` (02:12 — saved, and the rail repainted)

---

## 02:18–02:30 — The voice agent is configured from the product

**On screen:** the **ElevenLabs** section. Every capability it powers here — Scribe v2 Realtime for
live transcription, Conversational AI for the voice channel, text-to-speech for the optional spoken
cue, the voice library — listed with what it does in this product and its status. No key is set on
this deployment, so every one of them reads **unavailable** and the integration reads **not
configured**. Below it, the voice-agent panel: the agent this deployment wants for the selected
prospect — the custom server tool it would register, at which URL, with which timeout, the greeting,
and the router prompt that tells the agent to speak the tool's answer verbatim. Against that,
what ElevenLabs has: nothing, because there is no key, so there is no diff table and the push
button is disabled rather than inviting a click that could not go anywhere.

**Voice-over:**
> "Everything voice runs on ElevenLabs, and it is configured from in here rather than from their
> dashboard. This deployment has no key, so the page says so plainly: every capability unavailable,
> nothing to compare against, and the push button off. What it does have is real — the tool it will
> register, the eight-second timeout it registers it with, the greeting, and the prompt that makes
> the agent a router rather than the answer source. Put a key in the form above and the same panel
> reads the live agent and shows you, field by field, where the two disagree."

**Screenshots:** `18-settings-elevenlabs.png` (02:23), `19-settings-voice-agent.png` (02:29)

---

## 02:30–02:48 — The API explorer: everything the workspace does, callable

**On screen:** **API**. Every operation this deployment exposes, grouped by tag and built from its
own OpenAPI document, with the auth each one needs marked on it. Search for the voice turn, open
it, and the try-it form is already filled in from the schema with the selected prospect in the
body. **Send**: 200 OK in single-digit milliseconds, and the live response — the answer, its
citations, the handoff flag, the per-stage latency. Underneath, the same call written out as curl.

**Voice-over:**
> "And everything you have just watched the workspace do, an application can do. This explorer is
> built from the deployment's own OpenAPI document, so an operation cannot be added to the API and
> forgotten here. Find the voice turn, send it with the body already filled in, and the answer
> comes back with its citations and its timings — the same call the ElevenLabs agent makes, and the
> same one written out as curl, ready to paste. The session API is transport-agnostic: anything
> that can post JSON can drive a brief."

**Screenshots:** `20-api-explorer.png` (02:35), `21-api-try-it.png` (02:43), `22-api-curl.png`
(02:48)
