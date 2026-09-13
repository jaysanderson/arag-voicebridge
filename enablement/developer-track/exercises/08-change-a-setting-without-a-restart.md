# Exercise 8 — Change a setting and prove it took effect without a restart

**Goal:** change a live setting through the admin API (the same thing the Settings screen does) and
prove, two different ways, that it took effect on the very next request — no restart, no redeploy —
and see what happens when a change would break the one invariant Settings actually enforces.

This deliberately revisits Exercise 4 (forcing an upstream failure by restarting the server with an
impossible `VOICE_TURN_TIMEOUT_MS`). The point here is the difference: that exercise needed a
restart because it set an *environment variable*. This one uses the *settings store*, and needs none.

## Task

1. Start the server against the mock, with the default limits:

   ```bash
   ARAG_MOCK=1 ADMIN_TOKEN=ex8-token DATA_DIR=/tmp/vb-ex8 PORT=8099 node src/index.ts
   ```

2. Sign in as admin, then read the current effective configuration and note
   `voice.turnTimeoutMs` and `voice.agentToolTimeoutMs`:

   ```bash
   curl -s -c cookies.txt -X POST http://localhost:8099/api/v1/admin/login \
     -H 'content-type: application/json' -d '{"token":"ex8-token"}'

   curl -s -b cookies.txt http://localhost:8099/api/v1/admin/config | python3 -c \
     'import json,sys; c=json.load(sys.stdin)["voice"]; print(c["turnTimeoutMs"], c["agentToolTimeoutMs"])'
   ```

3. Ask a normal question and confirm it answers (`"handoff": false`) at the default timeout.

4. **Without restarting anything**, patch the turn budget down to somewhere no real ARAG call could
   possibly finish in time:

   ```bash
   curl -s -b cookies.txt -X PATCH http://localhost:8099/api/v1/admin/settings \
     -H 'content-type: application/json' -d '{"limits": {"turnTimeoutMs": 1}}'
   ```

5. Ask the exact same question again, on the exact same running process. Compare the result to
   step 3.

6. Read `GET /api/v1/admin/config` again and confirm `voice.turnTimeoutMs` is now `1` — this is
   the same live object the pipeline reads from, not a copy Settings keeps to itself.

7. Reset the field back to its environment default with a `null` patch, and confirm one more
   ordinary question answers normally again:

   ```bash
   curl -s -b cookies.txt -X PATCH http://localhost:8099/api/v1/admin/settings \
     -H 'content-type: application/json' -d '{"limits": {"turnTimeoutMs": null}}'
   ```

8. Now try to break the invariant Settings actually checks: patch `turnTimeoutMs` to a number at or
   above `agentToolTimeoutMs` (the value from step 2). Read the response carefully.

## Done when

```bash
before=$(curl -s -X POST http://localhost:8099/api/v1/voice-answer -H 'content-type: application/json' \
  -d '{"prospect":"progress","question":"What is binder jetting?","conversation_id":"ex8-before"}')

curl -s -b cookies.txt -X PATCH http://localhost:8099/api/v1/admin/settings \
  -H 'content-type: application/json' -d '{"limits": {"turnTimeoutMs": 1}}' > /dev/null

after=$(curl -s -X POST http://localhost:8099/api/v1/voice-answer -H 'content-type: application/json' \
  -d '{"prospect":"progress","question":"What is binder jetting?","conversation_id":"ex8-after"}')

curl -s -b cookies.txt -X PATCH http://localhost:8099/api/v1/admin/settings \
  -H 'content-type: application/json' -d '{"limits": {"turnTimeoutMs": null}}' > /dev/null

python3 -c "
import json
before = json.loads('''$before''')
after = json.loads('''$after''')
assert before['handoff'] is False, before
assert after['handoff'] is True, after
assert after.get('handoff_reason') == 'upstream-error', after
print('PASS: same process, same prospect, same question — answered before the patch, handed off after it, with no restart in between')
"
```

## Done when (invariant)

```bash
curl -s -b cookies.txt -X PATCH http://localhost:8099/api/v1/admin/settings \
  -H 'content-type: application/json' -d '{"limits": {"turnTimeoutMs": 9000}}' \
  -o /tmp/ex8-reject.json -w '%{http_code}\n'
python3 -c '
import json
r = json.load(open("/tmp/ex8-reject.json"))
assert r["status"] == 400, r
assert any("turnTimeoutMs" in e.get("path","") or "AGENT_TOOL_TIMEOUT_MS" in e.get("message","") for e in r.get("errors", [])), r
print("PASS: rejected —", r["errors"][0]["message"])
'
curl -s -b cookies.txt http://localhost:8099/api/v1/admin/config | python3 -c \
  'import json,sys; print(json.load(sys.stdin)["voice"]["turnTimeoutMs"])'   # unchanged — the store rolled back, not just the response
```
