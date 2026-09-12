# FAQ

**Does the caller ever hear a URL, a document name, or a citation marker?**
No. Citations are extracted as structured data (`{title, url, score}`) and shown as chips in the
UI; voice shaping actively strips URLs, markdown and citation markers from anything that would be
spoken, with a second output-side check as a backstop. See
[`../architecture/architecture.md`](../architecture/architecture.md).

**What happens when the knowledge base doesn't have the answer?**
The caller hears the prospect's own configured handoff line — not a guess, not a hedge, not silence.
This is detected deterministically: the prompt is instructed to reply with a fixed phrase when the
retrieved context doesn't cover the question, and the bridge keys off that exact phrase. An empty
answer or empty retrieval is treated the same way, so a stored configuration that omits the prompt
still degrades safely. See [`../architecture/arag-integration.md`](../architecture/arag-integration.md).

**What happens if ARAG is slow or down during a call?**
The turn always resolves within the voice agent's own tool timeout — VoiceBridge's internal ARAG
timeout is configured to be strictly shorter than the agent's tool timeout, and a timeout or error
degrades to the same handoff line a caller would hear for an unanswerable question. There is no
path that leaves the caller with silence.

**Can this system prove a restricted document was never surfaced?**
It can prove a retrieval filter is applied and working as configured. It cannot, in the current
implementation, prove that a specific caller's identity was checked against document-level access
rules, because VoiceBridge does not authenticate callers into distinct security groups today —
every request is filtered identically. This distinction matters and should be stated precisely to
anyone asking; see [`../architecture/security-model.md`](../architecture/security-model.md).

**Is this locked into ElevenLabs?**
No, though it is the default and the shipped experience when `ELEVENLABS_API_KEY` is set: Scribe v2
Realtime transcribes the microphone in Live, Conversational AI is the default voice channel, and the
optional spoken cue uses ElevenLabs text-to-speech. The public contract underneath all three
(`POST /api/v1/listen/sessions/*/transcript`, `POST /api/v1/voice-answer`) is plain, vendor-neutral
JSON — any voice platform whose agent can call an HTTP tool and speak back a JSON string field can
front it, and any transcription source can feed a listen session. ElevenLabs-specific code (Scribe
token minting, text-to-speech, the voice list, the vendored browser SDK) is isolated in its own
modules, and with no key set the product still works end to end via the sample conversation, typed
text and the telephony webhook. See
[`../developer/extension-points.md`](../developer/extension-points.md).

**How long does it take to add a new prospect (customer/demo target)?**
No code change and no redeploy: a registry entry, a provisioning call, a golden set, and a pass
through the demo gate — all through `/prospects/` and Knowledge, or a handful of API calls. See
[`../business/walkthrough-admin.md`](walkthrough-admin.md) and
[`../developer/extension-points.md`](../developer/extension-points.md) for the full ritual.

**What does "golden set passes" actually guarantee?**
That every one of that prospect's test questions, run through the exact same pipeline a live call
uses, behaved as expected — answerable questions answered with at least one citation in three
spoken sentences or fewer, out-of-scope questions handed off. It is not a guarantee about questions
outside that set, and — worth stating plainly — the shipped `progress` golden set is verified
against the mock Knowledge Box; running it against a live one (`make smoke` or a live `make eval`)
is a separate, recommended step before a customer-facing demo. See
[`../architecture/limits.md`](../architecture/limits.md).

**Does this scale to production call volumes today?**
It is a strong MVP: a genuinely stateless turn pipeline, a real golden-set gate, and per-prospect
configuration with no code changes. It is not yet hardened for large-scale, multi-tenant production
traffic — the single shared ARAG token, the single-machine JSON store, and the in-memory metrics
ring are all real, named limits with a clear path forward, not silent gaps. See
[`../architecture/scaling.md`](../architecture/scaling.md) and
[`../architecture/limits.md`](../architecture/limits.md) for specifics, and
[`when-to-use.md`](when-to-use.md) for whether this is the right stage to adopt it at.

**Where do citations come from if the knowledge base document has no URL?**
The citation still appears (title and score), just without a clickable link — VoiceBridge does not
require a URL to surface a source, only a usable title. See
[`../architecture/arag-integration.md`](../architecture/arag-integration.md).

**Can the ambient Live brief leak information across calls?**
No — each listen session's state (the running transcript, the evolving brief and its history) is
scoped to that session's own record in `DATA_DIR/listen-sessions.json`; nothing from one session's
transcript or brief is read into another session's prompt or retrieval. A session's record is kept
after it ends specifically so it can be reviewed afterwards — in Conversations, in Operator's Listen
sessions view, or via `GET /api/v1/listen/sessions/{id}/export` — and that record is scoped to the
prospect it belongs to, filtered the same way a live turn's retrieval is. See
[`../architecture/data-flow.md`](../architecture/data-flow.md).
