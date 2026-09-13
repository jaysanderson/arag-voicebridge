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

**Can I rebrand this for my own customers, without forking it?**
Yes — that's what Settings → Branding is for: product name, tagline, logo (upload a file or paste a
URL), primary and accent colour, footer text and whether the Progress credit is shown, all editable
in the product and applied live, with a preview that redraws as you type. A prospect can also carry
its own overlay on top of the deployment's branding (set in its Prospects editor, also with a live
preview), for one deployment serving several differently-branded customers. Attribution stays in
`LICENSE` and `THIRD_PARTY_NOTICES.md` regardless of what the toggle says. See
[`../developer/white-label.md`](../developer/white-label.md).

**Do I need to redeploy to change a setting?**
No. Every one of the 41 settings behind Settings — connection, branding, limits, the ElevenLabs
stack, retention — is stored in a JSON file the product reads on every request; an environment
variable only supplies the starting value. `PATCH /api/v1/admin/settings` (or the Settings form)
takes effect on the very next request. The one exception that isn't a restart either: a patch that
would put the voice-turn timeout at or above the agent's tool timeout is rejected and rolled back,
not silently applied and then broken. See [`../developer/settings.md`](../developer/settings.md).

**How do I lock the API down?**
Mint a named key under Settings → API keys (or `POST /api/v1/admin/api-keys`). The moment at least
one key is active, every non-operator `/api/v1` route requires `X-API-Key`; with none active, the
API is open to anyone who can reach the deployment, which is the shipped default for a demo, not a
recommendation for a public URL. A key can be renamed and revoked — revocation bites on the very
next request, and a revoked key stays in the list so its audit trail survives. Revoking the last
active key reopens the API; that's documented behaviour, not a bug, and the Settings page says so in
as many words. See [`../architecture/security-model.md`](../architecture/security-model.md).

**Do I have to configure the ElevenLabs agent by hand in their dashboard?**
No, and this is new: Settings → ElevenLabs reads what a prospect's voice agent *should* look like,
compares it field by field against what ElevenLabs actually has right now, and a button pushes the
difference — the router prompt, the greeting, the voice, and the custom tool's URL, method, timeout
and `X-API-Key` header. The dashboard remains a valid fallback if a deployment can't reach
ElevenLabs' API from wherever Settings runs, but it's no longer the only way in. See
[`../developer/integrations.md`](../developer/integrations.md).

**What is kept, and for how long?**
A turn's question text (for turns that passed the input guard), a conversation's transcript and
brief history, and golden-run results are each kept for a configurable number of days — 0 keeps them
until the underlying ring or store rolls over, which is the shipped default. Settings → Retention
sets those windows and can apply them automatically on an hourly timer; **Purge now** applies them on
demand, or, as an explicit, separately-confirmed action, deletes a whole category regardless of age.
A single conversation can also be deleted outright from Operator's Listen sessions view. See
[`../architecture/data-flow.md`](../architecture/data-flow.md#retention-and-purge).

**Can the ambient Live brief leak information across calls?**
No — each listen session's state (the running transcript, the evolving brief and its history) is
scoped to that session's own record in `DATA_DIR/listen-sessions.json`; nothing from one session's
transcript or brief is read into another session's prompt or retrieval. A session's record is kept
after it ends specifically so it can be reviewed afterwards — in Conversations, in Operator's Listen
sessions view, or via `GET /api/v1/listen/sessions/{id}/export` — and that record is scoped to the
prospect it belongs to, filtered the same way a live turn's retrieval is. See
[`../architecture/data-flow.md`](../architecture/data-flow.md).
