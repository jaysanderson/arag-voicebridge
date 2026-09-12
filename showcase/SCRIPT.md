# VoiceBridge showcase — narrated script

Target running time: **2:45**. Recorded by `showcase/record.spec.ts` against the mock ARAG
(`ARAG_MOCK=1`, prospect `progress`) — no credentials required. The screen is the rebuilt
workspace: the Live, Conversations, Knowledge, Quality and Settings sections at `/`, and the
Operator panel at `/admin/`, all at 1280×800. Timestamps are approximate — the spec paces itself
off real UI state (a version number moving forward, a chip changing, text appearing), not the
clock, so the exact second a beat lands will drift slightly from one recording to the next.

VoiceBridge's hero capability is real-time listening: a live conversation streamed in, one
grounded brief kept current throughout the call. That leads the showcase. Asking a one-off
question, the quality gate, the Operator panel and the ElevenLabs stack follow as supporting
evidence that this is a product, not a demo.

---

## 00:00–00:15 — The problem

**On screen:** the workspace loads on **Live** — that is the default screen, not a search bar or
an "Ask" tab. No session is running. The first-run banner explains what starting one will do, and
what it will not.

**Voice-over:**
> "Someone on a live call needs to know what is true right now, not after it ends. This is Live,
> the screen VoiceBridge opens on. Nothing is running yet — the banner says what starting a session
> will do, and just as importantly what it will not: it never speaks, and a failed refresh leaves
> the last good brief in place rather than blanking it."

**Screenshot:** `01-live-first-run.png`

---

## 00:15–01:00 — Play the sample conversation, and watch the brief evolve

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

**Screenshots:** `02-brief-first-citation.png` (the brief's first grounded version, with its first
citation), `03-brief-evolved.png` (a later version, after the whole sample call has played through)

---

## 01:00–01:16 — The transcript and the session's own numbers

**On screen:** alongside the brief, the full transcript of the scripted call, caller and agent
lines labelled. The session card's own numbers: turns heard, brief refreshes, how many were
skipped by the throttle, and the latency of the last refresh.

**Voice-over:**
> "Next to the brief, the actual transcript, and the numbers behind what just happened: how many
> refreshes ran, how many the throttle skipped, and how long the last one took. Against the mock
> Knowledge Box that is a handful of milliseconds — against a real one, expect a few seconds, which
> is still comfortable against a caller speaking for eight to fifteen seconds a turn."

**Screenshots:** `04-transcript.png`, `05-session-stats.png`

---

## 01:16–01:36 — End the call, then find it again in Conversations

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

**Screenshots:** `06-conversation-brief.png` (the drawer's final brief and citations),
`07-conversation-evolution.png` (the same drawer, scrolled to "How the brief evolved")

---

## 01:36–01:54 — Knowledge: what it is grounded in, and a cited answer

**On screen:** **Knowledge**. Which Knowledge Box this prospect is grounded in, honestly marked as
sample content on this deployment. The Ask tester runs the same pipeline a live turn does: ask it
something the content covers, and the answer comes back with a citation and an "answered" chip.
Ask something out of scope — the capital of France — and it hands off with the prospect's own
handoff line rather than guessing.

**Voice-over:**
> "Knowledge shows what a prospect is actually grounded in — this deployment is deliberately
> running sample content, marked as such rather than pretending otherwise. The Ask tester runs the
> exact same pipeline a live turn does. Ask it something it knows, and the answer carries a
> citation. Ask it something it does not, and it hands off — a fixed rule, not a judgement call."

**Screenshots:** `08-knowledge-box.png`, `09-knowledge-ask-grounded.png`,
`10-knowledge-ask-handoff.png`

---

## 01:54–02:07 — The quality gate: the golden set, live

**On screen:** press **Run golden set**. Ten questions — seven that should answer, three that
should hand off — run through the exact same pipeline, right now. Against the mock corpus the run
finishes in single-digit milliseconds per question; the chip settles on **"gate open"** and the
table fills in, ten out of ten passed.

**Voice-over:**
> "Before a prospect is trusted to answer, it has to clear this gate: the same ten questions, run
> right now, through the same pipeline used on a real call. All ten pass, so the gate opens. This
> is the one automated quality check in the product today — there is no equivalent gate yet for the
> live brief itself, only for this deflection path."

**Screenshot:** `11-knowledge-golden-gate-open.png`

---

## 02:07–02:19 — Quality: the numbers, and a guard trip redacted

**On screen:** **Quality**. The metrics strip — turns in the window, latency percentiles, handoff
rate, citation coverage, guard-trip rate. Filtered to guard trips, the turn log shows a row whose
result reads "guard · prompt-injection" and whose question column reads "redacted (guard trip)"
rather than the text itself.

**Voice-over:**
> "Quality is where all of that gets checked in aggregate. And when someone tries an injection, the
> guard trips before the model ever sees it — the log keeps the reason, never the text, so the log
> itself cannot leak what was attempted."

**Screenshot:** `12-quality.png`

---

## 02:19–02:33 — Into the Operator panel

**On screen:** sign in at **/admin/** with the deployment's admin token. Overview reports Knowledge
Box call counts and store sizes. Switching to **Listen sessions** and opening this exact call shows
the same brief history, from the other side: every version, its own timestamp, its own refresh
latency.

**Voice-over:**
> "Behind the product is an Operator panel for whoever runs the deployment, behind its own token.
> It sees the same session Conversations showed, but from the operator's side — every version the
> brief passed through, and exactly how long each refresh took to produce."

**Screenshots:** `13-admin-overview.png`, `14-admin-session-brief-history.png`

---

## 02:33–02:45 — White-label, and the ElevenLabs stack

**On screen:** **Settings**. The Connection card is honest about running against the mock Knowledge
Box; the Branding card previews what a partner rebrand would look like — Progress by default,
changed with environment variables alone. Integrations lists **ElevenLabs** as a primary
integration: Scribe v2 Realtime for live transcription, Conversational AI for the voice channel,
text-to-speech for the optional spoken cue — all correctly shown as unavailable on this deployment,
with the agent tool definition and system prompt generated and ready to paste in.

**Voice-over:**
> "This deployment is white-labelled by configuration alone, and everything voice runs on
> ElevenLabs: Scribe for transcription, Conversational AI for the channel, text-to-speech for the
> optional spoken cue. None of it is switched on here, and the page says so plainly rather than
> pretending — but the tool definition an agent needs is generated and ready to paste in the moment
> it is."

**Screenshots:** `15-settings-connection-brand.png`, `16-settings-elevenlabs.png`
