# Scaling

## Concurrency

VoiceBridge itself is a stateless, single-process Node HTTP server with no CPU-heavy work of its
own — every turn is I/O-bound waiting on ARAG (and, for Listen mode, on ElevenLabs). Node's event
loop handles many concurrent in-flight turns without contention on the bridge side; the practical
ceiling is `http_service.concurrency` in `fly.toml` (soft limit 40, hard limit 60 on the shipped
single `shared-cpu-1x` / 512 MB machine) and, well before that, ARAG's own concurrency and rate
limits on the shared service-account token (see below). The `AragClientPool` reuses one client per
`kb_id|baseUrl` rather than creating one per request, so client construction is not a scaling
concern; the cost that scales with load is entirely ARAG API calls and their generation time.

## LLM cost per turn / per brief

Every voice turn is one ARAG `/ask` call, which is one retrieval pass plus one generation call
against whatever model the prospect (or the stored search configuration) selects. Latency is
dominated by **generation time-to-first-token**, not retrieval — this is why `reranker: "noop"` is
the default (a `predict` cross-encoder rerank is a direct, real latency cost, opted into per
prospect only when the golden set shows quality needs it) and why `features` deliberately excludes
`relations`. `max_tokens: 160` bounds a voice answer's generation cost since answers are capped at
three sentences anyway — there is no reason to let generation run longer than that.

The brief (`POST /api/v1/brief`) is meaningfully more expensive per call than a voice turn: it uses
`reranker: "predict"` by default and `max_tokens: 600` (a structured object with up to nine fields
needs more tokens than three spoken sentences), and it fires roughly every 1.5 seconds for the
entire duration someone is in Listen mode — call it 40 ARAG calls per minute of listening, each a
full generation, against one prospect's Knowledge Box. This is exactly why `/brief` carries its own
stricter rate limit separate from the general API budget (see
[`security-model.md`](security-model.md)) and why choosing a fast `brief_model` per prospect is not
optional polish — a slow model here does not just cost more, it means the brief regularly misses
its own timeout and the UI shows a stale brief instead of a current one.

## Cold starts

`fly.toml` sets `min_machines_running = 1` specifically so the always-suspended-when-idle default
(`auto_stop_machines = "suspend"`) does not turn the first demo turn of the day into a cold-start
delay — Fly keeps one machine warm. A cold start itself is cheap for this product (no build step,
no framework bootstrap, no database connection pool to warm — `node src/index.ts` starts serving
almost immediately), so the warm-machine setting is purely about avoiding Fly's own suspend/resume
latency, not about VoiceBridge's own startup cost.

## Store limits

The JSON `Store` (`vendor/arag-platform/src/store/jsonstore.ts`) loads each collection fully into
memory and rewrites the whole file on every flush. This is fine at MVP/demo scale — a few hundred
prospects, a 500-entry turn-log ring, a few dozen golden-eval results — but it does not scale
indefinitely: every write to a collection eventually rewrites that collection's entire file, so
write cost grows with collection size, and the single-machine, single-writer design (see
[`deployment-topologies.md`](deployment-topologies.md)) is the real ceiling on horizontal scaling,
not request throughput. `turns.json` and `golden-evals.json` are already capped rings (500 and 50
entries respectively) for exactly this reason; `prospects.json` and `jobs.json` are not capped and
would need attention (an archival policy, or the database extension point in
[`../developer/extension-points.md`](../developer/extension-points.md)) well before prospect count
or job history became large enough to matter in practice.

## What to swap first

In rough order of when each one starts to bite as usage grows past a demo:

1. **A shared service-account token across all prospects** (`AragClientPool` — one `ARAG_API_KEY`
   for every Knowledge Box) becomes a shared rate-limit and blast-radius concern before it becomes
   a raw-throughput concern. See the per-prospect-credentials extension point in
   [`../developer/extension-points.md`](../developer/extension-points.md).
2. **The JSON store**, once prospect count, turn-log retention needs, or job history genuinely
   exceed what fits comfortably in memory and a debounced full-file rewrite — see
   [`../developer/extension-points.md`](../developer/extension-points.md) for the `Collection<T>`
   seam this swaps behind.
3. **Single-machine, single-region deployment**, once true multi-region traffic or
   more-than-one-machine redundancy is needed — this requires the store swap above first (see
   [`deployment-topologies.md`](deployment-topologies.md)); scaling `min_machines_running` up on
   the current topology would silently fork registry/turn-log state per machine rather than scale
   it.
4. **In-memory metrics ring** (`MetricsService`, capped at `VOICE_TURN_LOG_LIMIT`) — fine for "what
   does recent traffic look like" but not a real observability pipeline; a genuinely
   production-scale deployment wants these records shipped to a time-series store instead, per the
   note already in `src/services/metrics.ts`'s own header comment.

None of these are latency problems today — the dominant cost in the system, by a wide margin, is
ARAG generation time per call, and every lever in this document (model choice, reranker, token
limits, `relations` exclusion) exists to manage exactly that.
