# Walkthrough: the workspace

VoiceBridge is a workspace, not a single page: a dark, Progress-branded left rail (**Live**,
**Conversations**, **Knowledge**, **Prospects**, **Quality**, **API**, **Settings**) with one
section mounted per view under `/`, `/conversations/`, `/knowledge/`, `/prospects/`, `/quality/`,
`/api/` and `/settings/`. Every view consumes only `/api/v1` — the browser never holds an ARAG or
ElevenLabs credential. Screenshots are deliberately omitted here (see
[`../../showcase/`](../../showcase/) for a recorded walkthrough) so this page stays accurate as the
UI evolves.

A **prospect switcher** in the top bar (present on every section except Live's first run) is which
Knowledge Box/persona you're driving; switching it reloads whatever the current section shows for
that prospect. Below the main sections, the rail also carries **Set up** — a first-run checklist,
described below, that stays in the rail (with a badge counting what's still required) until the
deployment reports itself complete — and, at the foot, a link that opens **Operator**, the same
shell with the deployment's own views — see [`walkthrough-admin.md`](walkthrough-admin.md).

## Set up — the first-run checklist

`/setup/` is not a tour or a dismissible banner: it's a checklist computed fresh, every time the
page is opened, from this deployment's live configuration (`GET /api/v1/setup`), not from a stored
"dismissed" flag. If a deployment later loses its Knowledge Box connection, or its only active API
key gets revoked, that step comes back rather than staying quietly checked off. A progress meter
splits **Required** from **Optional**: only three steps are required, because the sample
conversation, the Ask tester and the whole session API already work with no credentials at all — the
required steps point the product at your own content and, if you want it, your own voice channel.
Each step shows what it needs, whether it's done, and a button straight to the screen that fixes it
(Settings → Connection, Settings → ElevenLabs, Prospects). **Check again** re-reads the
configuration on demand, and the page also re-checks itself whenever you switch back to its tab.

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
- **Compare two versions** — pick any two versions from the same history and see a field-by-field
  diff: which fields changed, which stayed the same, and, for a list field like key points or
  citations, exactly which items were added or dropped. It opens on the most recent pair that
  actually differ (comparing the final two versions is often "nothing moved" once the conversation
  has gone quiet, which isn't the interesting comparison), and a segmented control switches between
  "changed fields only" and "every field." This is the answer to "the brief changed its mind at some
  point in this call — where, and to what," without reading the whole history line by line.
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
  retrieve/first-token/total latency breakdown, and an expandable **How this turn was answered**
  panel underneath walks all nine pipeline steps in order — resolve the prospect, the input guard,
  building the request, calling the Knowledge Box, shaping the answer for voice, citations, the
  handoff decision, the output guard, recording metrics — each with its own timing and, when it
  fired, a chip for what happened (a guard tripping, a handoff, a step with nothing to do). This is
  the same trace a voice agent's turn never pays for; asking here is the way to actually watch the
  guards and the handoff rule operate rather than take the claim on faith.

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
same gate the Operator views use. Without the token, a **View** link still shows a prospect's
non-secret detail — its locale, greeting, handoff line and golden questions.

Unlocked, **Edit**/**New prospect** open a form, not a JSON textarea — every field in a prospect's
configuration gets a real control, a label and a help line, laid out across four tabs:

- **Setup** — identity (display name, the registry key, locale), the Knowledge Box (its id, region,
  and the name of a stored search configuration if one has been provisioned), and the inline
  answering settings used when no stored configuration is named (generative model, brief model,
  reranker, max tokens, temperature).
- **Voice** — the greeting and handoff line (written to be heard, with a character count), and the
  voice agent's own identifiers (agent id, voice id, tool id, which stored API key its tool call
  carries, and an optional custom router prompt — empty uses the prompt generated from the display
  name).
- **Golden set** — add, edit and remove golden questions inline, each with its expected behaviour
  (answer or handoff) and, for an answer, terms it must include.
- **Branding** — the prospect's own overlay on the deployment's branding, next to a **live
  miniature** of the workspace that redraws on every keystroke: type a product name or pick a colour
  and the rail, the nav and the citation-credit line in the preview update immediately, with a
  dotted rule under anything this prospect overrides and a legend naming what's inherited from the
  deployment versus owned here. Seeing the *result* before saving is the point — a `brand` block is
  otherwise just a handful of optional strings with no way to tell whether they'll look right
  together.

A **JSON** tab is still there, for pasting a whole record at once, but it's a tab now, not the
editor. **Provision search config** and **Delete** sit in the editor's footer alongside **Save**.

## Settings — every configurable value, editable here

`/settings/` is not a read-back of the environment: it's the editor. The rule behind the whole page
is that an environment variable is a **default**, not the authority — the JSON store is, and a
change made here takes effect on the very next request, with no restart. Unlocked with the
deployment's admin token (the same gate as Prospects and Operator), every one of the 43 settings
across six groups gets a real control; signed out, the page still shows what's configured, just not
editable. A sticky index down the left jumps between sections as you scroll:

- **Connection** — how the bridge reaches Progress Agentic RAG: Knowledge Box id, the service-account
  token (a secret — see below), region or a base-URL override, the generative model, the reranker,
  this deployment's own public URL, and the ARAG client timeout. Above the form, a live health check
  shows whether the connection actually works right now, with a warning banner if this deployment is
  still answering from the built-in mock Knowledge Box. Changing a connection field drops the cached
  ARAG client, so the very next call uses it — nothing needs a restart to pick up a new Knowledge Box
  or a rotated token.
- **Branding** — product name, tagline, logo (paste a URL or upload a file), primary and accent
  colour, footer text, docs and support links, and whether the Progress credit is shown — next to a
  live preview of the rail that redraws as you type, exactly like the one on a prospect's own
  overlay in Prospects.
- **Limits and timeouts** — the voice turn budget, the agent tool timeout, the brief budget, how many
  prior turns are forwarded as context, how many turns the turn log keeps, and every rate limit
  (global API, brief, scribe token, speech) with its burst. One invariant is enforced, not just
  validated: the voice turn budget must stay below the agent tool timeout, or a caller could hear
  silence. A patch that would break it is applied, checked, and **rolled back** if it fails — the
  form reports the same 400 a script would get.
- **ElevenLabs** — the API key (a secret), the API base URL, the transcription and speech models, and
  the default voice and agent id. Below the form, a capability table shows exactly which of Scribe
  transcription, the voice agent and text-to-speech are configured and in use right now. Below that
  is the strongest new capability in this pass: **the voice agent, configured from here.** For the
  selected prospect, the panel reads what this deployment *wants* the agent to look like — its
  greeting, its router system prompt, the tool's method/URL/timeout, the voice, and whether an
  `X-API-Key` header is attached — and compares it field by field against what ElevenLabs *actually
  has*, with a chip for each: same, or differs. Press **Push to ElevenLabs** (or **Create and push
  the agent**, if none exists yet) and the tool is written first, then the agent, merging into
  whatever ElevenLabs already has so turn-taking, ASR and evaluation settings this product doesn't
  own survive the write. A partner wires a working phone call without ever opening the ElevenLabs
  dashboard.
- **API keys** — the named-key store that replaces the `API_KEYS` environment variable as the
  authority (it still seeds the store on first boot). A banner says plainly whether the public API is
  currently open (no active key) or requires one, and how many keys are active. **Create key** names
  and mints one; the secret is shown exactly once, in a panel that says so, with nowhere else it will
  ever be shown again. The table lists every key — name, prefix, how it was created, when, when it
  was last used, how many times — including revoked ones, so revoking a key never erases why it
  existed. **Revoke** bites on the very next request; revoking the last active key reopens the API,
  which is the documented behaviour, not a bug.
- **Retention** — how many days a turn, a conversation or a golden run is kept (0 keeps it until the
  ring evicts it), and whether the windows are applied automatically on an hourly timer. A **Purge
  now** control applies the configured windows on demand, or — a separate, explicitly dangerous
  choice, confirmed by typing the scope back — deletes every turn, every conversation, every golden
  run, or everything, regardless of age.
- **API** — links to the API explorer, the human-readable reference and the raw OpenAPI document,
  plus the one `curl` command that opens a listening session: everything this workspace does, your
  own application can do the same way.

## API — every operation, with a try-it form

`/api/` is a live explorer built entirely from this deployment's own OpenAPI document
(`GET /api/v1/openapi.json`) — nothing here is hand-listed, so an operation cannot be added to the
API and forgotten on this page. A searchable list on the left, grouped by tag, opens each operation's
detail on the right: its description, its parameters, a **Try it** form that calls the live endpoint
with real inputs, a copyable `curl` command built from what you typed, and the response exactly as
the server returned it. A try-it call goes out with your own browser session by default, or an API
key you paste into the page (kept there only, never sent anywhere else); operator-only operations
return 401 until you sign in at Operator, and the page says so rather than failing silently.

## Where to go next

- [`walkthrough-admin.md`](walkthrough-admin.md) — the Operator views, in the same shell.
- [`../developer/integrations.md`](../developer/integrations.md) — setting up the ElevenLabs agent
  referenced from Live's voice-agent drawer and Settings' ElevenLabs section.
- [`../developer/settings.md`](../developer/settings.md) — the full inventory behind the Settings
  screen, field by field.
- [`../developer/extension-points.md`](../developer/extension-points.md) — the full onboarding
  ritual a new prospect goes through, of which the golden set on Knowledge is the last step.
