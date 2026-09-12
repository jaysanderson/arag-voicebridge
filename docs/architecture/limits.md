# Limits

An honest list of what this system does not (yet) guarantee, so nobody — including a future
contributor — discovers it the hard way. Where a limit has a clear extension point, it is linked;
some genuinely just need attention. Listening is the product's hero capability, so its limits are
listed first.

## Listening is single-process: SSE fan-out and throttle timers do not span machines

A listen session's live behaviour — who is subscribed to its SSE stream (`ListenService.listeners`)
and the deferred-refresh timer that fires a coalesced "too-soon" refresh once the throttle's gap has
elapsed (`ListenService.timers`) — lives only in the Node process's memory, not in
`DATA_DIR`. This is fine at the shipped single-machine topology, but it means: a subscriber can only
receive events from the process that accepted its SSE connection, there is no cross-process pub/sub
today, and running more than one machine (`min_machines_running > 1`) would silently split a
session's traffic across processes that cannot see each other's subscribers or timers rather than
scaling listening capacity. See [`scaling.md`](scaling.md) and the session-store extension point in
[`../developer/extension-points.md`](../developer/extension-points.md) for what closing this gap
would need.

## Listen sessions live in the same JSON store as everything else

A session's transcript, evolving brief, brief history, citations and stats are written to
`DATA_DIR/listen-sessions.json` on every append and every refresh — busier writes than any other
collection in the product (see [`scaling.md`](scaling.md)) — and are capped at 200 sessions, oldest
`createdAt` evicted first **regardless of `status`**. In the shipped demo this is invisible; in a
deployment running many long-lived concurrent calls, a still-`live` session could in principle be
evicted if 200 newer sessions are created before it ends, silently losing its transcript and brief
history from the store (the caller holding that session id would then get a 404 on its next read).
There is no warning today when a session is approaching eviction.

## No authorisation boundary between sessions

Every listen-session route checks only the platform's `api`/`admin` auth modes (see
[`security-model.md`](security-model.md)) — there is no concept of "the caller that opened this
session" versus any other caller holding the same API key or session cookie. With `API_KEYS` unset
(the shipped default), anyone who can reach the deployment and knows or enumerates a session id can
read, append to, or end **any** session for **any** prospect, and `GET /api/v1/listen/sessions` lists
recent sessions with no id needed at all. This is the same shape of gap already documented for
`POST /api/v1/voice-answer`, extended from "spend ARAG tokens" to "read and mutate live conversation
content" — a materially more sensitive thing to leave open. Set `API_KEYS` before running this
beyond a controlled demo audience.

## No speaker diarisation of its own

`ListenService` trusts whatever `speaker` string a caller sends on each chunk (truncated to 40
characters) — it does not distinguish voices, infer turns, or correct a mislabelled speaker itself.
A single realtime STT stream that does not diarise its own audio (most single-channel transcription
does not) will label every chunk with whatever the client hardcodes (`"caller"`, in Live's
own microphone path), and the brief's inferred `caller_profile`/`their_goal` fields are reasoning about
"the other person" from conversational content, not from a verified speaker identity. A source that
needs real diarisation must do it upstream (a diarising STT vendor, or per-channel audio in a
telephony bridge) and send the correct label per chunk — the API has no diarisation step of its own
to fall back on.

## Single shared ARAG service-account token

`AragClientPool` builds one `AragClient` per `kb_id|baseUrl` pair, but every one of them
authenticates with the same `ARAG_API_KEY`. There is no per-prospect credential today, which means:
one leaked or over-quota token affects every prospect at once, and there is no way to scope a
demo's blast radius to a single Knowledge Box's own rate limits. See the per-prospect-credentials
extension point in [`../developer/extension-points.md`](../developer/extension-points.md) — it is
designed for, not yet built.

## Demo-grade safety guards

`src/services/safety.ts`'s input/output guards are a small set of deterministic regex patterns
(injection phrasings, a couple of clearly out-of-scope categories), not a moderation product. They
will miss anything not shaped like the patterns they check for, and they make no attempt at
semantic understanding of intent. They are documented as a first line of defence specifically
*because* grounding-and-handoff (the model refuses to answer from outside the retrieved context, and
the bridge deterministically detects that refusal) is the real anti-hallucination control — the
guards exist to catch obviously bad input before it costs an ARAG call, and to catch obviously bad
output before it is ever spoken, not to be a complete content-safety system. See
[`security-model.md`](security-model.md) and the classifier extension point in
[`../developer/extension-points.md`](../developer/extension-points.md).

## No per-agent authentication on the core endpoint

With `API_KEYS` unset (the shipped default), `POST /api/v1/voice-answer` is reachable by anyone who
knows a prospect's registry key — there is no agent-specific credential distinguishing "the
configured ElevenLabs agent" from "anyone who found the URL." This is intentional for a demo and a
real cost/abuse surface beyond one — see [`security-model.md`](security-model.md) for the full
reasoning and the `API_KEYS` mitigation.

## `security.groups` is a filter, not an authorisation boundary

The stored search configuration's `security: { groups: ["public"] }` demonstrates governed
retrieval filtering working as configured; it is not a claim that a specific caller's identity has
been checked against a specific document's access rules, because VoiceBridge does not authenticate
callers into groups today — every request is filtered as `["public"]` regardless of who is asking.
See [`security-model.md`](security-model.md) for the precise wording to use with a reviewer.

## In-memory, capped metrics ring

`MetricsService` and the turn log (`turns.json`) are a 500-entry ring, computed fresh from whatever
is currently in memory/on disk — there is no long-term retention, no export pipeline, and a
restart's worth of history is exactly what was flushed to disk at the time (debounced 50 ms, so a
hard crash can lose the last few turns' log entries, though not the turns' actual responses to
their callers). This is explicitly demo-grade telemetry; a production deployment would ship these
records to a time-series store instead. See [`scaling.md`](scaling.md).

Golden-eval traffic is recorded into the same turn log as live traffic (tagged
`source: "golden-eval"`), so running a golden set visibly moves `GET /api/v1/metrics`'s
turn count and handoff rate — there is no way to exclude synthetic traffic from the live metrics
snapshot today.

## Mock-only golden corpus (and the listening demo built on the same corpus)

The `progress` prospect's ten-question golden set is guaranteed to pass against the **mock** ARAG
server (`src/services/seed.ts`'s eight fictional documents) because both were authored together and
`temperature: 0` makes ARAG's real behaviour deterministic once it *is* live. It has not been
re-verified against the live `progress` Knowledge Box since the platform rewrite — `make smoke` (an
opt-in, credentialed, 3-question live check) exists precisely to close that gap before a real demo,
but it is not part of `make check`/CI and is not run automatically. Treat "the golden set passes"
as a statement about the mock corpus and the pipeline logic until `make smoke` (or a full
`make eval` against the live KB) has actually been run for a given prospect. Live's own
zero-credential demo (`SAMPLE` in `public/app/live.js`, `DECISIONS.md` V-16) was written
against this same eight-document mock corpus for the same reason — the brief it produces is a
faithful demonstration of the throttle and the evolving-brief mechanics against real ARAG semantics
in mock mode, not evidence that a live Knowledge Box's grounding quality has been checked for a
given prospect's real content.

## LiveAvatar integration shapes are unverified

`src/services/liveavatar.ts` is complete and unit-tested with an injected `fetch`, but its exact
request/response field names were written against LiveAvatar's *public documentation*, not
confirmed against a live, paid LiveAvatar account — the module's own header comment flags this
explicitly (`⚠️ LIVE-VERIFY`). Endpoint paths are environment-overridable specifically so a
mismatch can be fixed without touching any other file, but until someone with a LiveAvatar API key
runs it end to end, treat `POST /api/v1/avatar/sessions` as "built to spec, not yet live-verified"
rather than "known working" — unlike the ARAG `/ask` integration, whose NDJSON item shapes *were*
confirmed live during the original build (see [`arag-integration.md`](arag-integration.md)). The
current workspace has no pane or toggle that calls this route at all — see
[`../developer/integrations.md`](../developer/integrations.md) — so today it is reachable only by a
custom client calling the API directly.

## Single-writer JSON store

Everything in `DATA_DIR` assumes one process writing to it (see
[`deployment-topologies.md`](deployment-topologies.md) and [`scaling.md`](scaling.md)) — there is
no locking or coordination for multiple machines sharing a volume, and none is needed at the
shipped scale, but it means the deployment cannot be horizontally scaled without first swapping the
store (see [`../developer/extension-points.md`](../developer/extension-points.md)).

## What is not a limit (things fixed in this rewrite, in case old notes suggest otherwise)

For anyone comparing against the original prototype's own audit notes: the Node
`--experimental-transform-types` flag dependency and TypeScript parameter-property usage that broke
on newer Node versions are both gone — `package.json` requires Node `>=22.18` (native type
stripping, no flag) and the codebase is erasable-syntax only throughout (the platform repository's `STANDARDS.md` §10).
The registry no longer lives in a committed file with real Knowledge Box/agent ids in git,
`/admin/reload` no longer exists (or needs to), and the API is versioned under `/api/v1` with an
OpenAPI document, contract tests and RFC 9457 error responses throughout.
