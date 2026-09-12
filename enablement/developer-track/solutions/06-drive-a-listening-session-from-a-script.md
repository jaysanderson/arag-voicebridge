# Solution 6 — Drive a listening session from a script

```bash
ARAG_MOCK=1 ADMIN_TOKEN=ex6-token DATA_DIR=/tmp/vb-ex6 PORT=8099 node src/index.ts
```

```bash
SID=$(curl -s -X POST http://localhost:8099/api/v1/listen/sessions \
  -H 'content-type: application/json' -d '{"prospect":"progress"}' \
  | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')
echo "$SID"
```

A small bash loop over five distinct sentences, 0.5 s apart:

```bash
CONVO=(
  "We run a machine shop and mostly print stainless steel brackets"
  "We also do small batches of titanium brackets for aerospace work"
  "Machining the manifolds by hand is slow and wasteful for us"
  "We are comparing binder jetting against laser powder bed fusion"
  "Cost per part and lead time both matter a lot to us"
)
for line in "${CONVO[@]}"; do
  esc=$(python3 -c "import json,sys;print(json.dumps(sys.argv[1]))" "$line")
  resp=$(curl -s -X POST "http://localhost:8099/api/v1/listen/sessions/$SID/transcript" \
    -H 'content-type: application/json' \
    -d "{\"chunks\":[{\"speaker\":\"caller\",\"text\":$esc}]}")
  echo "$resp" | python3 -c 'import json,sys;d=json.load(sys.stdin);print("appended -> refresh:", d["refresh"], "reason:", d["reason"])'
  sleep 0.5
done
sleep 2
```

Real output:

```
appended -> refresh: started reason: ok
appended -> refresh: scheduled reason: too-soon
appended -> refresh: scheduled reason: too-soon
appended -> refresh: scheduled reason: too-soon
appended -> refresh: scheduled reason: too-soon
```

```bash
curl -s "http://localhost:8099/api/v1/listen/sessions/$SID" | python3 -c '
import json, sys
d = json.load(sys.stdin)
s = d["stats"]
print("chunks:", s["chunks"], "refreshes:", s["refreshes"], "skipped:", s["skipped"], "briefVersion:", d["briefVersion"])
'
```

```
chunks: 5 refreshes: 3 skipped: 4 briefVersion: 3
```

**PASS** — 5 appends, only 3 refreshes: the first append refreshed immediately (`started`), and the
other four were all declared `"too-soon"` at append time (hence `skipped: 4`, since every
non-refreshing append except a "too-few-words" one increments `stats.skipped`). But `refreshes`
ends at 3, not 1 — two of those four `"too-soon"` appends still turned into a real refresh, later,
once the 1500 ms gap had actually elapsed. The exact split between "fired later" and "superseded by
a newer append before its turn came" depends on your timing and will vary run to run; what's
invariant is `refreshes < chunks` and `refreshes >= 1`.

## Why the numbers land this way

`ListenService.schedule()`:

```ts
private schedule(id: string, waitMs: number): void {
  if (this.timers.has(id)) return;
  const timer = setTimeout(() => {
    this.timers.delete(id);
    const session = this.col.get(id);
    if (!session || session.status === "ended") return;
    const decision = decideRefresh(this.window(session), session.throttle, this.now(), this.opts);
    if (decision.refresh) void this.refresh(id, decision.norm);
  }, Math.max(10, waitMs));
  ...
}
```

Only **one** deferred timer exists per session at a time (`if (this.timers.has(id)) return;`). Every
`"too-soon"` append while a timer is already pending does not create a second timer — it just adds
more transcript for the eventual timer to see when it fires. When the timer does fire, it
re-evaluates `decideRefresh` against whatever the transcript window looks like **at that moment**,
not against the append that originally triggered the timer. So five appends 0.5 s apart, with a
1.5 s minimum gap, naturally coalesce into roughly one refresh per 1.5 s of wall-clock time, not
one refresh per append — this run landed on 3 (1 immediate + 2 coalesced), a different run might
land on 2 or 4 depending on exact timing, but it will always be fewer than 5.

**What would break with a new timer per append instead of the guard.** If `schedule` set a fresh
`setTimeout` on every `"too-soon"` call rather than returning early when one is already pending, a
burst of chunks would queue up a burst of timers, and every one of them would eventually fire and
call `decideRefresh` again — most finding `"too-soon"` or `"unchanged"` still true and doing
nothing useful, but a few landing far enough apart to slip through and fire genuinely duplicate
LLM calls for content that had already been refreshed. The single-timer guard turns "N chunks
arrived while busy" into "the transcript changed while busy; check once, when the gap allows" —
exactly the coalescing behaviour a chatty STT source needs.

**Where the "extra" refreshes come from.** Nothing in this script asks for a second or third
refresh — every one beyond the first is the server's own clock deciding "the minimum gap has now
passed, and the window has moved on enough to be worth another look," entirely inside `schedule`'s
`setTimeout` callback. That is the point of V-14 (`DECISIONS.md`): the throttle is a property of
the session on the server, not something a well-behaved client has to implement by pacing its own
requests. A client — this script, a telephony bridge, a softphone plugin — can post as fast as it
likes; the server decides when an LLM call is actually worth spending.

## Why this has to live in the service, not a request-rate limiter

`src/routes/listen.ts` only attaches an explicit `rateLimit` (the same stricter budget as
`POST /api/v1/brief`) to `createListenSession`; `appendListenTranscript` carries no route-level
rate limit of its own; it relies on whatever the platform's global per-IP limiter allows. That is
deliberate, not an oversight: a request-rate limiter can only ever say "no more than N requests per
second from this IP," which is the wrong unit of control here. It has no idea whether two
requests one second apart carry the same sentence twice (`"unchanged"`/`"too-similar"`) or two
genuinely new sentences, and it can't distinguish "five chunks from one caller's realtime STT
stream, all worth eventually seeing" from "five chunks that should be squashed into one LLM call."
`decideRefresh`'s window/gap/similarity policy operates on the *content* of what was said, not on
the arrival rate of requests, so it can safely let every chunk through the HTTP layer (nothing is
ever rejected for arriving too fast) while still capping how often the expensive part — the ARAG
call — actually runs. A rate limiter in front of `/transcript` would either be loose enough to do
nothing useful, or tight enough to start dropping legitimate transcript chunks, neither of which is
what you want from a component whose only job is to record what was said.
