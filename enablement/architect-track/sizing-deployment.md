# Sizing and deployment

Every number below is either read directly from the shipped configuration (`fly.toml`,
`Dockerfile`, `.env.example`) or measured against a real instance while writing this document.
Where a number depends on your customer's real Knowledge Box rather than the mock, that is called
out explicitly — do not carry mock-mode latency numbers into a customer sizing conversation.

---

## Concurrency and memory per machine

The shipped `fly.toml` deploys a single machine:

```toml
[[vm]]
  size = "shared-cpu-1x"
  memory = "512mb"

[http_service.concurrency]
  type = "requests"
  soft_limit = 40
  hard_limit = 60
```

VoiceBridge is a single Node process (no worker threads, no cluster mode) with zero runtime
dependencies. A freshly booted instance, mock ARAG included, measures **≈50 MB RSS** at idle — a
Node process serving JSON over HTTP has a small, mostly-fixed baseline; the working set grows with
in-flight request buffers and the size of whatever is loaded from `DATA_DIR` (§ Volume sizing),
not with request *rate*. 512 MB gives roughly 10× that idle baseline as headroom, which is
generous for the request/response sizes this API actually handles (`bodyLimit: 64 * 1024` on
`voice-answer`, `128 * 1024` on `brief` — see `src/routes/voice.ts`).

**Why concurrency is bounded by requests, not CPU.** Every turn is I/O-bound: the bridge does a
small amount of synchronous work (guards, prompt assembly, voice shaping — all plain string/regex
operations, microseconds) and spends the rest of the turn `await`ing ARAG's streamed response.
Node's single event loop can hold many such in-flight awaits concurrently without contending for
CPU. The `shared-cpu-1x` sizing reflects this: you're not sizing for compute, you're sizing for
how many concurrent open connections and how much buffered request/response data you're willing to
hold in memory at once. The 40/60 soft/hard request limits are Fly's connection-admission control,
not a claim about how many turns the process can usefully process in parallel — that number is
realistically much higher for this workload, and 40/60 is a conservative starting point a customer
with real concurrent-call volume should load-test rather than assume.

**When to size up the VM instead of adding machines:** if a customer's real Knowledge Box responds
slowly enough that turns hold their connections open for seconds rather than tens of milliseconds
(see the latency breakdown below), the number of *concurrent* in-flight turns at a given call
volume rises proportionally — more held-open connections, more buffered state, more memory
pressure, still very little CPU pressure. Prefer a bigger `memory` allocation on `shared-cpu-1x`
over adding vCPUs first, and only reach for `performance-*` VM classes if profiling actually shows
CPU contention (unlikely for this workload) rather than assuming it.

---

## Latency budget: STT → bridge → ARAG → TTS

For a phone call, the caller's perceived response time is the **entire** round trip, not just the
bridge's own `latency_ms.total`. Break it down by stage:

| Stage | Who owns it | Typical order of magnitude | VoiceBridge's role |
|---|---|---|---|
| Speech-to-text | The voice platform (ElevenLabs Scribe, or equivalent) | Tens to a few hundred ms, often streaming/partial | None — this happens before the tool call reaches the bridge |
| Agent → bridge tool call | The voice platform's own infrastructure | Single-digit to tens of ms (network) | None |
| **Bridge processing** | VoiceBridge | Guards + prompt build: microseconds. The ARAG call dominates entirely. | `runTurn` — measured as `latency_ms` in every response |
| ARAG retrieval + generation | The Knowledge Box | **This is the number that actually matters** — see below | Bounded by `VOICE_TURN_TIMEOUT_MS` |
| Bridge → agent response | The voice platform | Single-digit to tens of ms | None |
| Text-to-speech | The voice platform | Streaming, starts as soon as text arrives | None |

**Do not size against the mock.** Against `ARAG_MOCK=1`, a full turn (`retrieve` + `first_token` +
`total`) measures single-digit milliseconds — there is no network hop and no real generative
model call. That is correct for the developer/enablement loop (fast iteration, no cost) and
**meaningless for capacity planning**. The one real production data point available in this
repository's history: a golden-set run against the live `progress` Knowledge Box, pre-rewrite,
reported **p50 ≈ 3.3 s, p95 ≈ 5.6 s over 17 turns** (`AUDIT.md`). Use that shape — low single-digit
seconds at the median, meaningfully higher at the tail — as your planning assumption for a real
Knowledge Box until you have your customer's own measured numbers, and always re-measure once
their Knowledge Box, prompt and generative model are actually decided; the reranker choice
(`predict` vs `noop`), `max_tokens`, and the chosen generative model all move this number
substantially.

**This is exactly why `VOICE_TURN_TIMEOUT_MS` (default 6000 ms) exists as a hard ceiling below
`AGENT_TOOL_TIMEOUT_MS`** (see `WORKSHOP.md` §2): a p95 of 5.6 seconds against a real KB leaves
very little room under a 6-second budget. If your customer's own measured p95 approaches their
configured `VOICE_TURN_TIMEOUT_MS`, a meaningful fraction of turns will hit the timeout path
(`handoff_reason: "upstream-error"`) under normal operation, not just under load — that is a
retrieval/generation tuning problem (reranker, `max_tokens`, model choice, KB size) to solve before
go-live, not a bridge configuration problem.

---

## LLM cost drivers

Two independent request types spend LLM tokens, at very different rates:

**Per voice turn** (`POST /api/v1/voice-answer`): one generation per turn, at the prospect's
configured `max_tokens` (default 160) and `temperature` (default 0, for reproducibility — not a
cost lever). Cost per turn scales with call volume directly: N calls × average turns per call ×
per-token cost of the chosen `generative_model`. A guard-tripped or `no-retrieval` turn still costs
a retrieval call if it reached ARAG at all (only guard trips are entirely free — they never call
ARAG); a `sentinel`/`not-found-phrase` handoff still paid for one full generation, since the model
had to run in order to decide it couldn't answer.

**Per listen-session refresh** (real-time listening / agent-assist, `src/services/listen.ts`):
this is the more dangerous cost driver, because it does not scale with conversation *turns* — it
scales with **wall-clock time spent on a live call**, per session, for every session open at once.
As of the current codebase the throttle is entirely server-side (`DECISIONS.md` V-14 — do not size
against an older assumption of a fixed client-side cadence; that architecture was replaced and no
longer exists in the client code, `public/app/live.js`): `DEFAULT_THROTTLE.minGapMs` (1500 ms) is a
**ceiling** of at most 40 refreshes/minute/session, but the similarity and minimum-word checks
(`jaccardMax: 0.85`, `minWords: 4`) mean a natural conversation — new, sufficiently different
content roughly every 10–15 seconds at normal speaking pace — realistically produces on the order
of **4–6 refreshes/minute/session** in steady state, not 40. Budget against that steady-state
figure; treat sustained refresh rates near the ceiling as a signal of a misbehaving client
(re-sending unchanged content as "new"), not as the expected cost.

The output side is capped and constant — up to 600 output tokens per refresh
(`buildBriefRequest`'s `max_tokens: 600` in `src/services/brief.ts`) — but the **input** side is
not: every refresh sends the entire running transcript so far (`transcriptText()`, capped at
`MAX_TRANSCRIPT_CHARS` = 20,000 characters, roughly 5,000 tokens at the ceiling), not just the new
window. A 20-minute call's refresh near the end of the call costs meaningfully more input tokens
than its first refresh did — size a customer's cost estimate off their **longest** expected call
duration, not an average one, and multiply by however many sessions are concurrently open, not by
call *count* for the day. `brief_model` defaults to a fast/cheap tier (`gemini-2.5-flash-lite` in
the shipped `progress` example) precisely to control this; check that any customer prospect using
listening has an explicit, cheap `brief_model` set, not left to fall through to the more expensive
main `generative_model` (`buildBriefRequest`: `req.model || prospect.brief_model ||
prospect.generative_model`). `POST /api/v1/listen/sessions` (opening a session) carries the same
dedicated rate limit as `POST /api/v1/brief` (`VOICE_BRIEF_RATE_RPS`/`BURST`, default 1 rps /
burst 5 per IP, applied as a platform route budget per `DECISIONS.md` V-15) — but note this limits
how fast **sessions can be opened**, not how fast transcript can be appended to one already open;
`POST .../transcript` carries no route-specific rate limit of its own (`src/routes/listen.ts`),
because the refresh *cost* is already capped by the throttle described above, not by request rate.
Do not assume raising `VOICE_BRIEF_RATE_RPS` changes listening's cost exposure at all — it only
changes how fast new sessions can be created.

**Golden-set runs** are a smaller, bursty cost: every question in a prospect's `golden_questions`
array fires one real turn (`runGoldenEval` uses the exact same `runTurn` pipeline, `src/services/
goldenEval.ts`) each time the set is run — in CI, before a demo, or via the Knowledge page's "Run
golden set" button. Ten prospects with ten questions each, run on every CI push, is 100 real generations
per push; budget for this the same way you'd budget for any other test suite that calls a paid
API.

---

## Volume sizing for `DATA_DIR`

`DATA_DIR` holds five JSON files, each a full in-memory `Collection` flushed as one file
(`vendor/arag-platform/src/store/jsonstore.ts` — see `WORKSHOP.md` §4 for the single-writer
implication):

| Collection | Cap | Practical size |
|---|---|---|
| `prospects.json` | Unbounded (grows with number of prospects) | Trivially small — tens of prospects is still kilobytes |
| `turns.json` | `VOICE_TURN_LOG_LIMIT`, default 500 | Small, bounded — oldest evicted on overflow |
| `golden-evals.json` | 50 (hardcoded in `GoldenEvalStore`, not env-configurable) | Small, bounded |
| `jobs.json` | 500 (platform default) | Small, bounded |
| `listen-sessions.json` | 200 (`ListenService`'s `cap`, hardcoded — not wired to an env var) | The largest of the five by far — see below |

`listen-sessions.json` is a different order of magnitude from the other four, because a listen
session carries far more state than a turn record: up to 400 transcript entries
(`MAX_TRANSCRIPT_ENTRIES`), up to 20 full brief snapshots (`MAX_BRIEF_HISTORY`, each a complete
structured object — `topic`, `summary`, `key_points`, `suggested_answers` and the rest), and up to
12 accumulated citations. A realistic session (a handful of minutes of natural conversation, short
transcript entries) lands somewhere in the 10–40 KB range; a long call pushed toward the caps
(400 entries, 20 brief versions) can reach several hundred KB. At the 200-session cap, that puts
`listen-sessions.json` anywhere from a couple of MB to tens of MB in the worst case — still well
inside the shipped 1 GB volume, but no longer "trivially small" the way the other four collections
are, and **the write-amplification cost matters more here than the storage cost**: every single
append and every single refresh completion triggers a debounced rewrite of the *entire file*
(§ "Per listen-session refresh" above put a live session's steady-state refresh rate at roughly
4–6/minute — that's 4–6 whole-file rewrites/minute *per active session*, all sharing one flush
queue). `WORKSHOP.md` §7 covers the correctness risk of the 200-session cap itself (it evicts the
oldest record regardless of live/ended status); this section is only about the size and
write-frequency consequence of that same cap.

The shipped `fly.toml` provisions a 1 GB volume for all of this, which is orders of magnitude more
than the four small collections will ever use, and still generous headroom for
`listen-sessions.json` at its worst case — the volume size is not the constraint a customer running
agent-assist at real volume needs to worry about; the write-amplification above, and the
200-session cap's eviction behaviour (`WORKSHOP.md` §7), are. **The one dial that matters for the
turn log** is `VOICE_TURN_LOG_LIMIT`: raising it substantially (for a customer who wants a much
longer visible turn history on the Quality page or the operator turn log) increases both the
steady-state file size and, more importantly, the cost of every single flush, since the whole
collection is rewritten on every
write, not appended to. For the shipped default (500), this is not worth worrying about; if a
customer asks for 50,000, revisit whether the JSON-file store is still the right choice for that
collection before just raising the number (see `WORKSHOP.md` §4's note that this store is
explicitly meant to be swappable at GA) — the same caution applies even more strongly to raising
the listen-sessions cap, given its already-larger per-record size.

---

## SSE connections per machine

`GET /api/v1/listen/sessions/{id}/events` is registered with `noRateLimit: true`
(`src/routes/listen.ts`) — there is no product-level cap on how many of these a client, or all
clients combined, can hold open. Each one is a long-lived HTTP request that does not resolve until
the viewer disconnects or the session ends, and Fly's `[http_service.concurrency]` admission
control (soft 40 / hard 60 on the shipped `shared-cpu-1x` machine — § "Concurrency and memory per
machine" above) counts it exactly like any other in-flight request, for its entire open duration.

That gives a concrete, if approximate, formula for how many simultaneous listening viewers one
machine can hold before turning away *ordinary* traffic: **available SSE budget ≈ concurrency
limit − expected concurrent `voice-answer`/`brief`/`transcript` requests at peak.** Against the
shipped soft limit of 40, a deployment expecting, say, 15 concurrent ordinary requests at peak has
roughly 25 SSE connections of headroom before it starts competing with them — and every one of
those 25 is consumed for as long as a viewer's browser tab stays open, not just for the duration of
a single turn. A supervisor dashboard that opens one SSE connection per agent it displays is the
fastest way to exhaust this budget: 25 monitored agents from one dashboard, plus each agent's own
Live page *also* watching its own session, is 50 connections against a 40/60 limit designed with
short-lived turns in mind. Size this explicitly for any customer whose design includes a
supervisor or monitoring view, and prefer polling `GET /api/v1/listen/sessions/{id}` on a longer
interval over an SSE subscription for a dashboard that does not need sub-second updates — it trades
freshness for a request that actually completes and frees its slot.

---

## Co-location with the ARAG zone

`fly.toml`: `primary_region = "iad"`, with the comment `# co-locate with the ARAG zone
(aws-us-east-2-1 ⇒ iad) to cut the extra hop`. Every ARAG call happens synchronously inside the
turn's timeout budget (§ Latency budget above) — an extra 40–80 ms of cross-region network latency
on *every single ARAG call in every single turn* is a direct, permanent tax on your already-tight
`VOICE_TURN_TIMEOUT_MS` budget, for zero benefit. Always deploy VoiceBridge in the region
geographically/network-nearest to the customer's Knowledge Box's zone, not the region nearest to
the customer's own offices or callers — the caller never talks to VoiceBridge directly (they talk
to the voice platform, which talks to VoiceBridge, which talks to ARAG); it is the
bridge-to-Knowledge-Box hop that sits inside the turn's hard deadline.

---

## When to add machines vs. regions

**Adding machines (same region, same `DATA_DIR`): not supported today**, full stop — see
`WORKSHOP.md` §4. The store is single-writer; two processes sharing one volume will corrupt each
other's writes. Before scaling to N machines behind one deployment, either (a) accept a hard
ceiling of one machine and scale it vertically (bigger `memory`, and only reach for more vCPU if
profiling shows real CPU contention), or (b) treat the `Store`/`Collection` interface as the
explicit migration seam it was designed to be (`jsonstore.ts`'s own header comment: "swapped for
Postgres/Redis at GA") and do that migration first. There is no safe middle ground of "just add a
second machine" with the shipped storage layer.

**Adding regions:** each region needs its own volume, and therefore its own independent
`DATA_DIR` — its own prospect registry, its own turn log, its own golden-eval history. This is
not automatically a problem (a genuinely regional deployment, e.g. one Knowledge Box per region
for data-residency reasons, wants independent registries anyway) but it does mean "add a region"
is not a capacity-scaling move for a single logical deployment — it is an architectural decision
about whether the customer actually wants N independent VoiceBridge deployments or one deployment
serving all regions from a single, co-located instance (accepting the cross-region latency tax
above for callers far from that one region). Decide which one a customer actually needs before
quoting a multi-region topology as a scaling answer.

---

## Cold starts

`fly.toml`: `auto_stop_machines = "suspend"`, `auto_start_machines = true`, but
**`min_machines_running = 1`** — one instance is always kept warm specifically so the first call
of the day is not a cold start. If a customer's cost sensitivity leads them to ask "can we scale to
zero when idle," the honest answer is: yes, mechanically (`auto_stop_machines` already supports
it), but the first turn after a cold start pays Node process boot time plus `startMockArag`/
`AragClientPool` initialisation (sub-second, this process has no build step and no heavy
dependency graph to load) — small in absolute terms, but on a voice call, *any* added latency on
the very first turn is directly perceptible to a caller who has just been connected. Recommend
`min_machines_running = 1` as the default position for any customer with production call volume,
and reserve scale-to-zero for genuinely low-traffic internal/demo deployments where an occasional
slow first turn is acceptable.
