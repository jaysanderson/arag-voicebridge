# Exercise 6 — Drive a listening session from a script

**Goal:** feed a short scripted conversation into a listen session fast enough that the server's
throttle actually has to do its job, and measure the difference between how many turns you sent
and how many brief refreshes it actually let through.

## Task

`src/services/listen.ts`'s `DEFAULT_THROTTLE` allows a refresh at most once every 1500 ms
(`minGapMs`), requires at least 4 words of genuinely new content (`minWords`), and skips a window
that is more than 85% similar (Jaccard) to the last one it refreshed on. A realtime STT source, or
someone typing quickly, can easily produce transcript chunks faster than that — that's exactly the
case this exercise reproduces.

1. Start the server against the mock:

   ```bash
   ARAG_MOCK=1 ADMIN_TOKEN=ex6-token DATA_DIR=/tmp/vb-ex6 PORT=8099 node src/index.ts
   ```

2. Open a session for `progress`:

   ```bash
   SID=$(curl -s -X POST http://localhost:8099/api/v1/listen/sessions \
     -H 'content-type: application/json' -d '{"prospect":"progress"}' \
     | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')
   echo "$SID"
   ```

3. Write a short script (bash, Python, whatever you're comfortable in) that posts **five** short,
   genuinely different sentences to `/api/v1/listen/sessions/$SID/transcript` — one chunk per
   request, each a new, distinct topic sentence so the throttle's similarity check doesn't skip it
   for being "the same thing again" — with only a short pause between them (0.5 s is plenty; that
   is well under the 1.5 s minimum gap). Print each response's `refresh` and `reason`.

4. After the loop, `sleep 2` (long enough for the last deferred refresh to fire) and fetch the
   session. Compare `stats.chunks` (how many appends you made) against `stats.refreshes` (how many
   actually resulted in a usable brief update) and `stats.skipped`.

## Done when

Your script's output shows the same shape as this real run (your exact reasons and final numbers
may differ by one depending on timing, but `refreshes` must be strictly less than `chunks`, and
the *first* append must show `"refresh":"started"`):

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
assert s["chunks"] == 5, s
assert s["refreshes"] < s["chunks"], "the throttle should have refused at least one refresh"
assert s["refreshes"] >= 1, "at least the first append should have refreshed"
print("PASS:", s["chunks"], "appends produced", s["refreshes"], "refreshes (", s["skipped"], "marked skipped at append time)")
'
```

## Think about

- Every append after the first came back `"scheduled"`, not `"skipped"` outright — the throttle
  didn't just drop the ones that were too soon, `ListenService.schedule` coalesced them into a
  single deferred timer. Read `schedule()`: what would go wrong (in terms of duplicate LLM calls
  or wasted work) if it set a **new** timer on every `"too-soon"` append instead of the
  `if (this.timers.has(id)) return;` guard it actually has?
- Notice that `stats.refreshes` at the end is usually more than 1 but less than the number of
  appends. Where did the "extra" refreshes beyond the first come from, given you never manually
  asked for one after the first append? What does that tell you about who decides *when* a
  coalesced refresh finally runs — you, or the server's clock?
- This throttle lives entirely inside `ListenService`, not as a request-rate limit on the
  `/transcript` route itself (compare `src/routes/listen.ts`: only `createListenSession` carries
  an explicit `rateLimit`; `appendListenTranscript` does not). What would a customer lose if you
  tried to reproduce this same cost control purely with an HTTP-level rate limiter instead?
