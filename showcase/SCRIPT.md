# VoiceBridge showcase — narrated script

Target running time: **3:00**. Recorded by `showcase/record.spec.ts` against the mock ARAG
(`ARAG_MOCK=1`, prospect `progress`) — no credentials required. Screen is the demo console
(`/`) and the admin panel (`/admin/`) at 1280×800. Timestamps are approximate; the spec paces
itself off real UI state, not the clock.

VoiceBridge's hero capability is real-time listening: a live conversation streamed in, one
grounded brief kept current throughout the call. That leads the showcase; asking a one-off
question, the quality gate and the admin panel follow as supporting evidence.

---

## 00:00–00:14 — The problem

**On screen:** the console loads on the **Listen** tab — that is the default now, not Ask. No
session is running yet; the panel explains what feeding it a conversation will do.

**Voice-over:**
> "Somebody on a live call cannot stop to read a manual while they are listening. And an
> assistant that fills the silence with an invented answer is worse than no assistant at all.
> VoiceBridge listens to a call as it happens and keeps one brief current — grounded in the
> knowledge base, never guessed — so the person on the call always knows what to ask and what to
> say next."

**Screenshot:** `01-console-loaded.png`

---

## 00:14–01:14 — Play the sample conversation, and watch the brief evolve

**On screen:** press **Play sample conversation**. A scripted discovery call feeds in, roughly a
line every 1.4 seconds. Within moments the brief on the right fills in — caller profile, their
goal, key points, what to ask, what to say, recommended products — with citation chips
accumulating underneath. The version label in the brief's header ticks forward as the call
continues; the transcript pane fills in turn by turn; the session stats show refreshes climbing
against a throttled count that is climbing just as fast.

**Voice-over:**
> "Press play. The bridge is not re-answering from scratch on every sentence — the throttle on
> the server decides when a refresh is actually worth an LLM call, so a burst of turns gets one
> refresh, not ten. Watch the version tick forward: the brief genuinely evolves as the caller says
> more — a machine shop, then binder jetting, then a furnace, then titanium and budget. Every
> claim in it is grounded, and the sources are listed right there. This is the same throttling
> whatever is producing the transcript — a phone call, a meeting bot, or someone typing — because
> it lives on the server, not in this browser tab."

**Screenshots:** `02-brief-midcall.png` (the brief just after its first citation), `03-brief-
evolved.png` (a later version, after the whole call has played through), `04-transcript.png`,
`05-listen-stats.png`

---

## 01:14–01:34 — The same grounding, on demand: a cited answer

**On screen:** switch to the **Ask** tab and ask "Tell me about the Desktop Metal PureSinter
furnace." The "What just happened" pipeline steps light up green in order. The answer bubble
appears with a citation chip and an "answered" badge; the latency strip fills in on the right.

**Voice-over:**
> "The same grounding is available on demand, not only mid-call. Ask it something the knowledge
> base covers and the answer comes back shaped for speech — no markdown, no URLs — with the
> citation shown on screen but never read aloud, and the retrieval, first-token and total latency
> visible on every turn."

**Screenshots:** `06-ask-grounded.png`, `07-citations-latency.png`

---

## 01:34–01:50 — Out of scope: a deterministic handoff, not a guess

**On screen:** ask "What is the capital of France?" The pipeline shows the handoff check
tripping; the answer bubble shows a "handoff" badge and the prospect's handoff line.

**Voice-over:**
> "Ask something the knowledge base has nothing on and VoiceBridge does not improvise. An empty
> retrieval or an out-of-scope question is a string check, not a judgement call — mid-call or in
> a one-off question, it hands off cleanly instead of inventing an answer."

**Screenshot:** `08-ask-handoff.png`

---

## 01:50–02:08 — The quality gate: the golden set, live

**On screen:** switch to the **Golden set** tab — the gate reads "not run". Press **Run golden
set**. Against the mock corpus the run completes in single-digit milliseconds per question, so
the table appears essentially fully populated the instant it finishes: the chip flips straight to
**"gate open"** and the summary reads "10/10 passed".

**Voice-over:**
> "Before any of this goes live, it has to clear a gate: ten golden questions, run through the
> exact same pipeline, right now. Seven should answer with a citation, three should hand off. All
> ten pass, so the gate opens."

**Screenshots:** `09-golden-not-run.png`, `10-golden-gate-open.png`

---

## 02:08–02:14 — Into the admin panel

**On screen:** navigate to **/admin/**, enter the admin token and sign in. The panel loads on the
Overview tab.

**Voice-over:**
> "Everything so far only ever touched the public API. Behind that is an admin panel for the
> people running the deployment."

**Screenshot:** `11-admin-signin.png`

---

## 02:14–02:38 — Admin: the listen session, its brief history and latency

**On screen:** switch to the **Listen sessions** tab and press **Reload**. The session from the
sample call appears in the table — ended, with its refresh and throttled counts and its p50
latency. Selecting it fills the brief history panel: every version the brief passed through,
newest first, each with its own timestamp and refresh latency in milliseconds.

**Voice-over:**
> "Every listening session is kept for review — not just the final brief, but every version it
> passed through and how long each refresh took. An operator can see exactly how the call's
> picture built up, end to end."

**Screenshot:** `12-admin-listen-sessions.png`

---

## 02:38–02:52 — The turn log: a guard trip, redacted

**On screen:** switch to the **Turn log** tab and press **Reload**. Alongside the turns from the
Ask tab earlier, a turn from a prompt-injection attempt sent moments before shows a result column
reading "guard · prompt-injection" and a question column reading "redacted (guard trip)" instead
of the actual text.

**Voice-over:**
> "Every turn is logged — except the ones that trip the input guard. An injection attempt is
> recorded as a reason, never as text, so the log itself cannot leak what someone tried to make
> the agent say."

**Screenshot:** `13-turn-log-redacted.png`

---

## 02:52–03:00 — Close

**On screen:** settle on the console's metrics footer.

**Voice-over:**
> "API-first. Any transcription source — a phone call, a meeting bot, or someone typing. Zero
> runtime dependencies. Apache-2.0. And everything you just watched ran with no credentials at
> all."

**Screenshot:** `14-closing.png`
