# Architect track — knowledge check

12 questions with answers.

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
