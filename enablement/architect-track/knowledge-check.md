# Architect track — knowledge check

20 questions with answers, about 25 minutes.

---

**1. Recall.** State the turn-budget inequality VoiceBridge enforces at boot, and name the
variable that owns each side of it.

> `VOICE_TURN_TIMEOUT_MS` (VoiceBridge's own ARAG-call budget, default 6000 ms) must be strictly
> less than `AGENT_TOOL_TIMEOUT_MS` (the voice platform's timeout on its tool call, default
> 8000 ms — not read or enforced by VoiceBridge, just checked against). `src/config.ts`'s
> `assertVoiceConfig` refuses to boot the server if this doesn't hold.

---

**2. Judgement.** A customer wants `VOICE_TURN_TIMEOUT_MS` raised to 7900, one hundred
milliseconds under their `AGENT_TOOL_TIMEOUT_MS` of 8000, to give their slow Knowledge Box more
time. What's wrong with this, even though it satisfies the boot-time check?

> The check only enforces a non-zero gap; it does not enforce a *sufficient* one. 100 ms has to
> cover network latency bridge→agent, JSON serialisation, and the bridge's own handling overhead —
> in practice, far too tight a margin. A turn that fails over right at the ARAG timeout could still
> lose the race against the agent's own clock, which started at the same moment. The right fix is
> to solve the slow-Knowledge-Box problem directly (reranker choice, `max_tokens`, model, KB size —
> see `sizing-deployment.md`), not to shrink the margin that exists specifically to absorb
> everything the boot-time check can't see.

---

**3. Recall.** Name the three independent places grounding is enforced, and which of them still
holds even if the deployed prompt is wrong or missing the `HANDOFF:` sentinel instruction.

> (1) The prompt contract — the sentinel string check in `decideHandoff`. (2) The
> retrieval-count backstop — zero retrieved items forces a handoff regardless of what the model
> said (`reason: "no-retrieval"`). (3) The output guard — a last check on the shaped, about-to-be-
> spoken text. Layers 2 and 3 hold even if the prompt is wrong or the sentinel is missing; layer 1
> is the fastest and most precise path but is the only one that depends on the prompt being
> deployed correctly.

---

**4. Judgement.** Can two VoiceBridge instances safely share one `DATA_DIR` behind a load
balancer, in the shipped configuration? Why or why not?

> No. `DATA_DIR`'s store (`vendor/arag-platform/src/store/jsonstore.ts`) loads its whole
> collection into an in-memory `Map` at boot and rewrites the entire file on every write. Two
> processes each hold an independent in-memory copy and will race to overwrite each other's writes
> on flush — a classic single-writer store used as if it were multi-writer. The shipped `fly.toml`
> reflects this: exactly one machine, `min_machines_running = 1`.

---

**5. Recall.** What happens if `DATA_DIR/prospects.json` becomes corrupted (unreadable JSON)?

> `jsonstore.ts` renames the corrupt file to `<file>.json.corrupt-<timestamp>` and starts the
> collection empty — silently, with no alert. On the next boot, `ProspectRegistry.seedFromFile`
> sees an empty store and re-seeds it from the shipped `config/prospects.example.json`, which
> means **every prospect added since the last successful boot is gone**, replaced by the three
> example prospects. There is no automatic recovery of the lost prospects.

---

**6. Judgement.** A prospect has `ask_config` set. An operator edits its `max_tokens` field from
160 to 300 through the admin API, expecting longer answers. What actually happens on the next
turn, and why?

> Nothing changes. `buildAskRequest` (`src/services/pipeline.ts`) returns immediately once it sees
> `ask_config` is set — the `reranker`/`max_tokens`/`temperature`/`generative_model` lines that
> would read the edited field never execute for that prospect. The stored search configuration in
> the Knowledge Box, not the prospect record, owns those settings once a prospect is on that path.
> The operator needed to re-run `POST /api/v1/admin/prospects/{key}/provision` (which itself reads
> the prospect's `max_tokens` to *build* a new stored configuration) to actually apply the change.

---

**7. Recall.** Does the live brief (`POST /api/v1/brief`) use a prospect's stored `ask_config`?

> No, never. `buildBriefRequest` (`src/services/brief.ts`) always builds its own prompt and
> `answer_json_schema` inline, regardless of whether the prospect's main turn path uses a stored
> configuration. Any retrieval governance (language filters, security groups) applied via a stored
> configuration to the main answer path is not automatically extended to the brief.

---

**8. Recall.** Why does the shipped `fly.toml` set `primary_region = "iad"` for a Knowledge Box in
`aws-us-east-2-1`, rather than picking a region near the customer's own offices or call centre?

> Every ARAG call happens synchronously inside the turn's already-tight timeout budget. Extra
> cross-region latency on that hop is a direct, permanent tax on `VOICE_TURN_TIMEOUT_MS` for zero
> benefit — the caller never talks to VoiceBridge directly, so latency between the bridge and the
> caller's own region is not the hop that matters; latency between the bridge and the Knowledge
> Box is.

---

**9. Judgement.** Why is the live brief a more dangerous LLM cost driver than the main voice turn,
even though a single brief call is not obviously more expensive than a single turn?

> The turn's cost scales with **conversation turns** — a natural, bounded unit tied to the
> caller actually asking things. The brief's cost scales with **wall-clock time spent listening**,
> refreshed roughly every 1.5 seconds regardless of whether anything new was said
> (`DECISIONS.md` V-05). A 5-minute Listen session alone generates on the order of 200 brief
> calls, each requesting up to 600 output tokens — cost accrues continuously and independently of
> how much the caller is actually engaging, which is why it needs its own dedicated rate limit
> (`VOICE_BRIEF_RATE_RPS`/`BURST`) on top of the platform's global limiter, and why `brief_model`
> should always be an explicit, cheap model choice rather than falling through to the main
> `generative_model`.

---

**10. Recall.** Name two rate limiters in VoiceBridge that exist in **product code**, separate
from the platform's global per-IP limiter, and why each needed its own budget.

> `VOICE_BRIEF_RATE_RPS`/`BURST` — the brief fires continuously while listening and each refresh
> costs a generation, which one global budget shared with ordinary turns can't isolate.
> `VOICE_SCRIBE_RATE_RPS`/`BURST` — `POST /api/v1/scribe-token` mints third-party ElevenLabs
> credentials; an attacker (or a bug) hammering this endpoint burns someone else's quota, not
> VoiceBridge's own compute, which is a different risk shape than a normal request flood.
> (`DECISIONS.md` V-05 records both as a documented gap in the platform toolkit — per-route limits
> belong there eventually, and today's product-owned `RateLimiter` is the interim solution.)

---

**11. Judgement.** A bad prospect-record edit goes to production. The on-call engineer rolls back
the container to the previous image. Does this fix it? What is the correct fix?

> No. `DATA_DIR` — and therefore the prospect registry — persists on the Fly volume independently
> of the container image; rolling back the code does not touch the data. The correct fix is a data
> rollback: `PUT /api/v1/admin/prospects/{key}` with the previous, correct configuration. The same
> logic applies to a bad stored-search-configuration change: the fix is re-running
> `POST /api/v1/admin/prospects/{key}/provision` with the previous settings, which only works if
> the previous settings were recorded somewhere outside the running deployment (e.g. in a config
> repo) before they were overwritten.

---

**12. Judgement.** `DECISIONS.md` V-03 records that all prospects currently share one ARAG
service-account token. A customer needs two brands whose Knowledge Box credentials must never be
shared or visible to each other's operations team, for contractual reasons. Is this already
solved by the per-prospect client pool (`AragClientPool`)?

> No — the client pool solves *routing* (which Knowledge Box and zone a prospect's client points
> at), not *credential isolation*. It currently still reads one shared `apiKey` from the
> environment for every non-mock client it builds. Per-prospect credentials are explicitly called
> out as "a documented extension point," not an implemented feature. Flag this as a gap to design
> and build before committing to that customer's requirement — it is not something a configuration
> change alone can satisfy today.

---

**13. Judgement.** A customer asks whether changing their Knowledge Box region in production
requires a maintenance window. What is actually true, and what is the one thing that *does* need to
happen even though nothing restarts?

> No maintenance window: `PATCH /api/v1/admin/settings` with `{"connection": {"region": "..."}}`
> takes effect on the next request, because `SettingsService.apply()` writes the value straight into
> the live `PlatformEnv` object. What does have to happen is that the region field (like every
> connection field) is marked `rewiresClients`, so `onRewire()` drops the cached per-Knowledge-Box
> `AragClient` in `AragClientPool` — without that, requests already in flight against the old
> client finish against the old region, but every *new* client would otherwise be built from a
> pool entry keyed on the old value and never notice the change. The customer-facing claim ("no
> restart") is true; the reason it's true is a specific invalidation step, not an accident of how
> objects happen to be shared.

---

**14. Recall.** `ApiKeyStore` stores every key's secret in full, in plaintext, in
`DATA_DIR/api-keys.json`, rather than hashing it. Name the two reasons this is a considered
trade-off rather than an oversight, and the one place the plaintext is deliberately returned.

> (1) `App.authenticate()`'s comparison against an incoming `X-API-Key` header is a constant-time
> comparison against the stored value, which needs the plaintext on both sides — a one-way hash
> would need to be re-hashed and compared, which is fine for a password but this is a bearer
> credential checked on every request, not a login. (2) Pushing the ElevenLabs agent's custom tool
> has to put a *real*, usable key into the tool's `X-API-Key` header (`desiredTool()`,
> `src/services/voiceAgent.ts`) — a hash cannot supply a credential a third-party service will
> actually send back. The plaintext is returned exactly once: the response to
> `POST /api/v1/admin/api-keys` that creates it. Every read after that (`GET
> /api/v1/admin/api-keys`, the diff panel in Settings) shows only a `prefix`.

---

**15. Judgement.** `POST /api/v1/admin/voice-agent/push` is documented as *merging* into whatever
ElevenLabs already has for an agent, rather than replacing the agent's configuration wholesale. Why
does that matter for a customer who has already hand-tuned their agent's turn-taking or ASR settings
in the ElevenLabs dashboard, and what would go wrong if the push instead sent a full replacement?

> A full replacement would silently discard any setting VoiceBridge does not itself own — turn-taking
> sensitivity, ASR provider choice, evaluation configuration — every time an operator pushes an
> update to the router prompt or the tool definition, even though nothing about those other settings
> was supposed to change. `pushAgent()` reads the agent ElevenLabs currently has and patches only the
> fields this product manages (prompt, greeting, voice, tool link), leaving the rest as the customer
> left it. This is what makes "push again after editing the prompt" a safe, repeatable operation
> rather than one that quietly undoes hand-tuning done outside the product.

---

**16. Judgement.** A partner wants to know whether locking down the API (minting a key under
Settings → API keys) is safe to do on a live deployment mid-demo, without warning anyone watching.
What actually happens to a call already in flight, and to the workspace UI itself, the moment the
key becomes active?

> A request already accepted by the process (already past `App.authenticate()`) completes normally —
> the key only gates authentication at the start of the request, not mid-flight. The *next* call from
> anything that doesn't carry the new key (a script, a telephony bridge, an agent's tool call) starts
> failing with 401 immediately, since `ApiKeyStore.sync()` rewrites the live `env.apiKeys` array the
> authenticator reads with no restart in between. The workspace UI itself keeps working: it
> authenticates with a same-origin `arag_session` cookie minted at boot, which is accepted
> independently of the `X-API-Key` check (see the auth-modes table in `security-model.md`) — so an
> operator watching the workspace sees nothing change, while any *external* caller lacking the key
> starts getting locked out that instant. Warn whoever owns those external integrations before doing
> this on a live deployment, not after.

---

**17. Judgement.** A partner asks: "is this locked into ElevenLabs?" Give the answer you would put
in writing, in two lists, and name the one sentence that keeps it honest.

> **Vendor-neutral:** `POST /api/v1/voice-answer` (one question, one speakable grounded answer,
> callable by any platform that can make an HTTP tool call) and the whole listen session API
> (`/listen/sessions`, `…/transcript`, `…/events`, `…/refresh` — a chunk is `{speaker, text,
> final}` and the server neither knows nor cares what produced it). Behind those contracts, nothing
> mentions a vendor: the nine-step pipeline, the handoff sentinel and retrieval backstop, both
> safety guards, the throttle, the brief and its history, the golden set, and every workspace
> screen. **ElevenLabs-specific:** three implementations beside the contract — `/scribe-token` for
> Live's microphone, `/speech` for the spoken cue, and `/admin/voice-agent[/push]` for configuring
> the Conversational AI agent. A customer moving to another stack posts their own transcript into
> `/transcript`, points their own platform's tool at `/voice-answer`, and keeps everything else —
> what they lose is the automation, not the capability: nobody diffs and pushes a non-ElevenLabs
> agent for them, so keeping the tool's URL, timeout and API-key header in step becomes their
> runbook. The honest sentence: **the ElevenLabs path is the one verified end to end against the
> real API (`make agent-check`, `DECISIONS.md` V-28); another provider is a supported extension
> point, not an equally-exercised path.** Say that instead of implying parity.

---

**18. Judgement.** A customer's agent answers callers fluently and confidently, cites nothing, and
the turn log on the deployment shows **no turns at all**. `/readyz` is green and the golden set
passes. What would you check first, and why is this failure mode specific to the agent-push design?

> The `Tool URL` row of `GET /api/v1/admin/voice-agent?prospect={key}`. The tool URL is built from
> `PUBLIC_URL`, falling back to `http://localhost:<port>` — so an agent pushed from someone's laptop
> has a `localhost` URL stored at the vendor, which resolves on *their* servers to their own
> machine. The tool call fails, the agent falls back to the model's own knowledge, and every
> symptom points at the prompt: the bridge is healthy, the Knowledge Box is healthy, the golden set
> passes (it calls the pipeline directly, never through the vendor), and the turn log is empty
> because no turn ever arrived. It is specific to this design because the product writes a URL into
> a third party's configuration and cannot observe whether the third party ever calls it — the diff
> panel showing the full URL is the mitigation, and reading it before a demo is the discipline.

---

**19. Judgement.** Settings → Retention shows `turnDays`, `sessionDays` and `evalDays` all set to
30, and the customer presents this as a 30-day retention policy. Is it? What are they missing, and
which store would you be most concerned about?

> Not yet. `autoPurge` is off by default, and with it off the windows are applied only when an
> operator presses **Purge now** or something calls `POST /api/v1/admin/purge` — a policy that
> depends on someone remembering is not enforced. This is the most common way the screen is
> misread: the fields are filled in and nothing is happening. The store to be most concerned about
> is `listen-sessions.json`: a turn record keeps at most 500 characters of one question (and none
> at all for a guard-tripped turn), whereas a listen session keeps the **entire transcript
> verbatim** — up to 400 entries — plus up to 20 full brief snapshots. `screenTranscript` screens
> chunks for injection patterns but redacts nothing; it is a safety guard, not a DLP pass. A
> customer who signed off the turn-log answer has not thereby signed off this one.

---

**20. Recall.** Name four things a configured retention window does **not** delete.

> (1) The operator log (`GET /api/v1/admin/logs`) — a separate ring, purged by neither window nor
> scope; it holds no conversation content but does hold who did what and when. (2) Anything at the
> voice vendor: ElevenLabs' (or any platform's) own recordings and transcripts are a second data
> processor with a second retention conversation, and VoiceBridge's windows have no reach into it.
> (3) Whatever a `DATA_DIR` volume snapshot or backup holds — the Fly volume is the store, and a
> backup of it outlives any purge. (4) One specific call on request: an erasure request aimed at a
> named session is `DELETE /api/v1/admin/listen-sessions/{id}`, which removes that session
> regardless of its age; the windows are a clock, not a search.
