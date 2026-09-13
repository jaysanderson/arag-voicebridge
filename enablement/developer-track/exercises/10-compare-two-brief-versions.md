# Exercise 10 — Compare two versions of a brief and say what changed

**Goal:** make a listening session change its mind, then answer the question a supervisor actually
asks after a call — *when* did the brief change, and *what* moved — from the API and from the
Conversations screen.

The brief is not a transcript summary produced once at the end. It is rebuilt as the call moves,
each refresh handed the previous brief so it *refines* rather than restarts (`src/services/
brief.ts`). Every version is kept: up to `MAX_BRIEF_HISTORY` (20) snapshots per session, each with
its version, its timestamp and the latency of that specific refresh.

## Task

1. Start the server against the mock:

   ```bash
   ARAG_MOCK=1 ADMIN_TOKEN=ex10-token DATA_DIR=/tmp/vb-ex10 PORT=8099 node src/index.ts
   ```

2. Open a session for `progress` and append a first turn that is squarely about the mock corpus
   (furnaces, printers, binder jetting) but says nothing about money:

   ```bash
   SID=$(curl -s -X POST http://localhost:8099/api/v1/listen/sessions \
     -H 'content-type: application/json' -d '{"prospect":"progress"}' \
     | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')

   curl -s -X POST "http://localhost:8099/api/v1/listen/sessions/$SID/transcript" \
     -H 'content-type: application/json' \
     -d '{"chunks":[{"speaker":"caller","text":"We machine stainless steel manifolds in house and the sintering furnace route looks interesting"}]}' > /dev/null
   ```

3. Wait past the throttle's minimum gap, then ask for a refresh explicitly rather than waiting on
   the deferred timer — `POST .../refresh` exists so a client that knows something important just
   happened can say so:

   ```bash
   sleep 2
   curl -s -X POST "http://localhost:8099/api/v1/listen/sessions/$SID/refresh" \
     -H 'content-type: application/json' -d '{}' \
     | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d["briefVersion"], d["brief"]["stage"])'
   ```

4. Now say the thing that changes the call. Append a second turn that mentions price, then refresh
   again:

   ```bash
   curl -s -X POST "http://localhost:8099/api/v1/listen/sessions/$SID/transcript" \
     -H 'content-type: application/json' \
     -d '{"chunks":[{"speaker":"caller","text":"What would that cost us, can you put a quote together for the printer and the furnace"}]}' > /dev/null
   sleep 2
   curl -s -X POST "http://localhost:8099/api/v1/listen/sessions/$SID/refresh" \
     -H 'content-type: application/json' -d '{}' \
     | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d["briefVersion"], d["brief"]["stage"])'
   ```

5. Read the whole history — this route is public, no admin token needed, because a client that owns
   a session can review it:

   ```bash
   curl -s "http://localhost:8099/api/v1/listen/sessions/$SID/brief-history" | python3 -m json.tool
   ```

6. Write a diff. Compare the **first** version against the **latest** one, field by field, and
   classify each field as `unchanged`, `changed`, `new` or `dropped` — the same four labels the
   Conversations screen uses. Print only the ones that moved.

7. Open `http://localhost:8099/conversations/?id=$SID` and find **Compare two versions**. Check
   three things against your own diff:
   - which pair of versions it opens on, and why that is not simply "the last two";
   - the `N fields moved` count;
   - what the **Every field** view shows that **What moved** does not.

## Done when

```bash
curl -s "http://localhost:8099/api/v1/listen/sessions/$SID/brief-history" | python3 -c '
import json, sys

items = json.load(sys.stdin)["items"]
assert len(items) >= 2, f"need at least two versions to compare, got {len(items)}"

first, latest = items[0]["brief"], items[-1]["brief"]

def classify(a, b):
    if a == b: return "unchanged"
    if a is None: return "new"
    if b is None: return "dropped"
    return "changed"

rows = {k: classify(first.get(k), latest.get(k)) for k in sorted(set(first) | set(latest))}
moved = {k: v for k, v in rows.items() if v != "unchanged"}

assert rows.get("stage") == "changed", rows
assert first["stage"] == "exploring" and latest["stage"] == "evaluating", (first["stage"], latest["stage"])
assert rows.get("caller_profile") == "unchanged", "the brief refines, it does not restart"
assert rows.get("key_points") == "unchanged", "the brief refines, it does not restart"

print("PASS: v%d -> v%d, %d of %d fields moved: %s"
      % (items[0]["version"], items[-1]["version"], len(moved), len(rows), moved))
'
```

## Think about

- Only one field moved, and the other eight held still. That is the design working: `prev` is sent
  on every `BriefRequest`, so a refresh is asked to *revise* a brief it can already see, not to
  re-derive one from scratch. What would a supervisor's review look like if each refresh restarted
  from the transcript — and which of the two would you rather read after a forty-minute call?
- `brief-history` carries `latencyMs` per version, not just an average for the session. What
  question does a per-version latency answer that `stats.p95LatencyMs` cannot?
- The Conversations screen does not open on "the last two versions". Read `wireCompare` in
  `public/app/conversations.js` and work out what it opens on instead, and why the obvious default
  would usually show you nothing. (Hint: a deferred refresh often fires on a window that has not
  actually moved.)
- The history is capped at 20 snapshots and the session store at 200 sessions, oldest-by-creation
  evicted first regardless of whether a session is still live. For a contact centre, which of those
  two caps bites first, and what does the operator see when it does?
  (`../../architect-track/WORKSHOP.md` §7.)

## Clean up

```bash
curl -s -X DELETE "http://localhost:8099/api/v1/listen/sessions/$SID" > /dev/null
rm -rf /tmp/vb-ex10
```
