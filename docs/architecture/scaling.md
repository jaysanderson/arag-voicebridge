# Scaling

## Concurrency

VoiceBridge itself is a stateless-per-request, single-process Node HTTP server with no CPU-heavy
work of its own — every turn and every brief refresh is I/O-bound waiting on ARAG (and, for
listening from a microphone, on ElevenLabs). Node's event loop handles many concurrent in-flight
turns and refreshes without contention on the bridge side; the practical ceiling is
`http_service.concurrency` in `fly.toml` (soft limit 40, hard limit 60 on the shipped single
`shared-cpu-1x` / 512 MB machine) and, well before that, ARAG's own concurrency and rate limits on
the shared service-account token (see below). The `AragClientPool` reuses one client per
`kb_id|baseUrl` rather than creating one per request, so client construction is not a scaling
concern; the cost that scales with load is entirely ARAG API calls and their generation time. Listen
sessions add one thing to this picture that a single voice turn does not have: per-session state
(the transcript, throttle bookkeeping, SSE subscriber list, and a deferred-refresh `setTimeout`) held
in the one process's memory for as long as the session is live — see "Many concurrent sessions"
below.

## Cost and concurrency of listening

A listen session's LLM cost is governed entirely by the server-side throttle
(`decideRefresh()`, `src/services/listen.ts`), not by how often a client appends transcript. With
the defaults — a minimum 1.5 s gap between refreshes, and a refresh skipped outright when the last
~28 words haven't moved on enough (identical, or >0.85 Jaccard-similar) — a single session refreshes
**at most ~40 times a minute**, and considerably less than that in practice once a conversation
settles into normal back-and-forth rather than continuous fast speech. This is deliberately a
server-side property: the throttle lives in `ListenService`, not in the browser or in whatever STT
vendor is producing chunks, specifically so that a chatty, naive or misbehaving client — one that
resends its interim hypothesis every 200 ms, say — cannot turn every word into an LLM call. A client
that wants a *cheaper* session can post less often; it can never make one refresh more expensive or
more frequent than the throttle allows.

Each refresh is meaningfully more expensive than a voice turn: the brief uses `reranker: "predict"`
by default and `max_tokens: 600` (a structured object with up to nine fields needs more tokens than
three spoken sentences), so at the throttle's ceiling one active session costs roughly 40 full
ARAG generations per minute against one prospect's Knowledge Box. This is exactly why session
creation shares `/brief`'s own stricter rate limit rather than the general API budget (see
[`security-model.md`](security-model.md)), and why choosing a fast `brief_model` per prospect is not
optional polish — a slow model here does not just cost more, it means the brief regularly misses
`VOICE_BRIEF_TIMEOUT_MS` and the UI shows a stale brief instead of a current one.

**Many concurrent sessions.** Each live session holds its own transcript, throttle state, brief
history and a `Set` of SSE subscribers in the one process's memory, plus (only while a `too-soon`
append is pending) one deferred-refresh timer. None of this is CPU-heavy, but it is per-session
memory and — at the throttle's ceiling — per-session ARAG traffic that scales linearly with the
number of simultaneous live calls: ten sessions all talking continuously means roughly 400 ARAG
generations a minute in aggregate, against whichever Knowledge Boxes their prospects use. There is
no cross-session cap today beyond the shared `ARAG_API_KEY`'s own rate limits and the store's
200-session cap (see [`limits.md`](limits.md)) — a deployment expecting many simultaneous long calls
should watch ARAG-side throughput and the shared token's budget before session count itself becomes
the bottleneck.

**SSE connection limits.** Every open `GET .../events` stream is a long-lived HTTP connection held
open on the single process (`noRateLimit: true` on that route specifically because a live stream
should not be counted as a burst of requests). It counts against the same
`http_service.concurrency` ceiling as every other in-flight request in `fly.toml`, and — because
`ListenService.listeners` is an in-process `Map`, not a broker — every subscriber to a given session
must be connected to the *same* process; there is no fan-out across machines. This is fine at the
shipped single-machine topology and is exactly the kind of thing that needs a pub/sub layer (Redis,
or similar) the moment listening runs on more than one process — see
[`../developer/extension-points.md`](../developer/extension-points.md) and
[`limits.md`](limits.md).

**Store growth.** `listen-sessions.json` grows by one write per session create, per transcript
append, and per refresh — busier than `turns.json`'s one write per completed turn — but it is
capped at 200 sessions (oldest evicted by `createdAt` regardless of `status`), so unlike
`prospects.json`/`jobs.json` it cannot grow without bound; see [`limits.md`](limits.md) for what
that cap costs a very active demo (a still-live session can in principle be evicted if 200 newer
ones are created first).

## LLM cost per turn

Every voice turn is one ARAG `/ask` call, which is one retrieval pass plus one generation call
against whatever model the prospect (or the stored search configuration) selects. Latency is
dominated by **generation time-to-first-token**, not retrieval — this is why `reranker: "noop"` is
the default (a `predict` cross-encoder rerank is a direct, real latency cost, opted into per
prospect only when the golden set shows quality needs it) and why `features` deliberately excludes
`relations`. `max_tokens: 160` bounds a voice answer's generation cost since answers are capped at
three sentences anyway — there is no reason to let generation run longer than that.

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
not request throughput. `turns.json`, `golden-evals.json` and `listen-sessions.json` are already
capped rings (500, 50 and 200 entries respectively) for exactly this reason — and
`listen-sessions.json` is also the busiest of the three, since a single active session writes on
every append and every refresh, not once per completed interaction; `prospects.json` and `jobs.json`
are not capped and would need attention (an archival policy, or the database extension point in
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
   the current topology would silently fork registry/turn-log/listen-session state per machine
   rather than scale it, and — specifically for listening — would strand a session's SSE
   subscribers on whichever process happened to accept each connection, since
   `ListenService.listeners` and its deferred-refresh timers are in-process state with no pub/sub
   layer behind them today.
4. **In-memory metrics ring** (`MetricsService`, capped at `VOICE_TURN_LOG_LIMIT`) — fine for "what
   does recent traffic look like" but not a real observability pipeline; a genuinely
   production-scale deployment wants these records shipped to a time-series store instead, per the
   note already in `src/services/metrics.ts`'s own header comment.

None of these are latency problems today — the dominant cost in the system, by a wide margin, is
ARAG generation time per call, and every lever in this document (model choice, reranker, token
limits, `relations` exclusion) exists to manage exactly that.
