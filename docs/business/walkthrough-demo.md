# Walkthrough: the demo console

The console lives at `/` and consumes only `/api/v1` — it never holds an ARAG or ElevenLabs
credential. Everything below matches the current build; screenshots are deliberately omitted here
(see [`../../showcase/`](../../showcase/) for a recorded walkthrough) so this page stays accurate
as the UI evolves.

## Layout

Across the top: a **prospect selector** (which Knowledge Box/persona you're driving), a greeting
line, and a **Run golden set** button. Below that, four tabs, in the order they're presented:
**Listen**, **Ask**, **Call**, **Golden set**. Along the bottom, a live **metrics footer** (turn
count, p50/p95 total latency, p50 first-token latency, handoff rate, citation coverage) that
refreshes every 5 seconds and reflects the deflection pipeline's own turns.

Switching prospects reloads the greeting, the suggested-question chips on the Ask tab (drawn from
that prospect's own golden questions), the model picker for Listen mode, and resets the golden-set
tab to "not run."

## Listen — the hero path

The console opens here. This is real-time listening: feed a conversation in and a structured brief
on the right keeps up with it — who you're speaking to, what they want, the knowledge that matters
right now, and what to say next. The console itself stays silent; it's a copilot for whoever's on
the call, not a participant in it.

1. Press **Play sample conversation**. No credentials are needed — this plays a scripted
   3D-printing discovery call (a machine shop asking about metal 3D printing and post-print
   sintering) line by line into a fresh listen session, roughly one line every 1.4 seconds, so you
   can watch the brief build in real time rather than all at once. Press **Stop sample** to end it
   early.
2. Watch the **live brief** panel on the right fill in as fields become available: a topic line, a
   goal/stage chip row, a one-line profile of the other person, a summary, key points drawn only
   from the knowledge base, suggested questions to ask, suggested things to say, and — when
   something in the knowledge base genuinely fits — recommended products. A running list of citation
   chips accumulates underneath as new sources are used across the call.
3. The **session stats** panel on the left shows the session id, chunks received, brief refreshes,
   refreshes the server-side throttle skipped, and the latency of the last refresh — this is the
   same throttling and the same numbers a real telephony or STT integration would produce, not a
   demo-only shortcut.
4. Instead of (or alongside) the sample, paste or type your own conversation into the **paste or
   type a conversation** box — one line per turn, prefixed with `caller:` or `agent:` — and press
   **Send to session** to feed it into the same session and watch the brief react.
5. With an ElevenLabs key configured on the server, **Listen to microphone** opens a real realtime
   transcription feed instead of the sample or typed text — what's said out loud appears under
   "hearing" as an interim hypothesis, and finalised text feeds the same session API as everything
   else on this tab.
6. The **Brief model** dropdown lets you pick a specific fast model for the brief; the default,
   "Auto — fast default," is exactly what a live call would use.
7. Press **End session** when you're done. The session, its final brief, its full citation list and
   its stats are kept for review — see [`walkthrough-admin.md`](walkthrough-admin.md#listen-sessions)
   for where to find them afterwards.

## Ask (text) — the deflection pipeline, as a text turn

This tab runs the deflection follow-on: the identical pipeline a phone call would use
(`DECISIONS.md` V-07), with no ElevenLabs credentials needed at all.

1. Type a question, or click one of the suggested chips below the input, and press **Ask** (or hit
   Enter).
2. The right-hand panel, "What just happened," lights up each pipeline step as the turn completes:
   input safety guard, ARAG ask, deterministic handoff check, voice shaping, citations, output
   safety guard. A step shows as skipped rather than failed when it legitimately didn't run (e.g.
   voice shaping is skipped on a handoff, since there is nothing to shape).
3. The answer bubble shows the exact spoken line, a badge (**answered** or **handoff · reason**),
   any citation chips (hover one to see its score), and the latency breakdown (retrieve / first
   token / total).
4. The facts panel on the right restates handoff status, citation count and the three latency
   numbers for the most recent turn.

Try one in-scope question (e.g. "Tell me about the Desktop Metal PureSinter furnace" against the
`progress` prospect) and one deliberately out-of-scope one (e.g. "What is the capital of France?")
back to back — this is the fastest way to show both halves of the deflection story: grounded answers
with citations, and a clean, honest handoff instead of a guess.

## Call — real voice

Requires the selected prospect to have a real `agent_id` configured (not the shipped placeholder).
Without one, pressing **Start call** shows "No ElevenLabs agent configured for this prospect — use
the Ask tab, or set agent_id in Admin" rather than failing silently.

With a configured agent: **Start call** connects over WebRTC via the vendored ElevenLabs client
(`public/vendor/elevenlabs-client.js` — never a runtime CDN import, see
[`../architecture/security-model.md`](../architecture/security-model.md)). The chip next to "Voice
call" tracks connection state (connecting → connected → listening/agent speaking); the transcript
panel on the right logs both sides of the conversation as the agent relays it. A **Voice** dropdown
(populated from `GET /api/v1/voices`, which needs `ELEVENLABS_API_KEY`) lets you preview a
different ElevenLabs voice as a session override — if the agent's own configuration doesn't allow
voice overrides, the console detects the resulting error and falls back to the agent's default
voice automatically rather than leaving the call broken.

## Golden set — the deflection quality gate

The demo gate for the deflection pipeline: every one of the selected prospect's golden questions
runs through the same pipeline the live agent uses, and each must behave correctly — an answerable
question must answer with at least one citation in three spoken sentences or fewer, with no URLs or
citation markers leaking through; an out-of-scope question must hand off. There is no equivalent
automated gate for the Listen brief today — see [`when-to-use.md`](when-to-use.md).

1. Press **Run golden set** (from this tab, or the shortcut button in the top bar — either starts
   the same job and switches to this tab automatically).
2. A job timeline shows live progress as each question completes (this uses the same
   Server-Sent-Events job stream a script or CI pipeline would consume — see
   [`../developer/examples.md`](../developer/examples.md#metrics-and-golden-evaluations)).
3. When the job finishes, the table fills in: each question, what was expected, pass/fail (a
   failing row also lists exactly which check failed — e.g. "≤3 sentences [4]" or "no citation
   markers"), and its latency in milliseconds.
4. The chip at the top of the panel reads **gate open** (green) when every question passed, or
   **gate closed** (red) otherwise, alongside a summary line (`N/M passed · p50 … ms · p95 … ms`).

A prospect should not be answered on its own live until its gate reads open — see
[`../developer/extension-points.md`](../developer/extension-points.md) for the full onboarding
ritual this gate is the last step of.
