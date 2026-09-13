# Exercise 8 — Change a setting and prove it took effect without a restart

**Goal:** change a live setting through the admin API (the same thing the Settings screen does) and
prove, on the very next request, that it took effect — no restart, no redeploy — then see the two
different ways a bad change is refused.

This deliberately revisits Exercise 4 (forcing an upstream failure by restarting the server with an
impossible `VOICE_TURN_TIMEOUT_MS`). The point here is the difference: that exercise needed a
restart because it set an *environment variable*. This one uses the *settings store*, and needs
none — an environment variable is only the default, and `DATA_DIR/settings.json` is the authority
from boot onwards (`DECISIONS.md` V-26).

## Task

1. Start the server against the mock, with the default limits:

   ```bash
   ARAG_MOCK=1 ADMIN_TOKEN=ex8-token DATA_DIR=/tmp/vb-ex8 PORT=8099 node src/index.ts
   ```

2. Sign in as admin, then read the current effective configuration:

   ```bash
   curl -s -c cookies.txt -X POST http://localhost:8099/api/v1/admin/login \
     -H 'content-type: application/json' -d '{"token":"ex8-token"}'

   curl -s -b cookies.txt http://localhost:8099/api/v1/admin/config | python3 -c \
     'import json,sys; c=json.load(sys.stdin)["voice"]; print(c["turnTimeoutMs"], c["agentToolTimeoutMs"])'
   ```

3. Read the **limits** group of `GET /api/v1/admin/settings` and note three things about each
   field: its `value` (what is in force), its `source` (`stored`, `env` or `default`) and its
   `min`/`max`. The `source` field is the one that matters operationally — it is how you answer
   "is this deployment actually running what the `.env` says?" without guessing.

4. Fire eight quick `POST /api/v1/voice-answer` calls and confirm every one returns `200`. The
   shipped global limiter (5 rps, burst 20) is nowhere near being hit.

5. **Without restarting anything**, squeeze the global rate limit down to almost nothing:

   ```bash
   curl -s -b cookies.txt -X PATCH http://localhost:8099/api/v1/admin/settings \
     -H 'content-type: application/json' -d '{"limits": {"rateLimitRps": 0.2, "rateLimitBurst": 1}}'
   ```

6. Fire the same eight calls again, on the same process. Compare with step 4.

7. Reset both fields to their environment defaults with a `null` patch, wait a few seconds for the
   token bucket to refill, and confirm the calls succeed again:

   ```bash
   curl -s -b cookies.txt -X PATCH http://localhost:8099/api/v1/admin/settings \
     -H 'content-type: application/json' -d '{"limits": {"rateLimitRps": null, "rateLimitBurst": null}}'
   ```

8. Now get a change refused two different ways, and notice they are not the same kind of check:

   - `{"limits": {"turnTimeoutMs": 1}}` — a **single field, validated in isolation** against its
     own declared `min`.
   - `{"limits": {"turnTimeoutMs": 9000}}` — a legal number for that field on its own, refused
     because of its **relationship to another field** (`agentToolTimeoutMs`, from step 2).

   Read both responses carefully, and afterwards re-read `GET /api/v1/admin/config` to see whether
   anything was left changed.

9. Read the operator log and find your own changes:

   ```bash
   curl -s -b cookies.txt "http://localhost:8099/api/v1/admin/logs?limit=50" | python3 -c '
   import json,sys
   for i in json.load(sys.stdin)["items"]:
       if i.get("msg","").startswith("settings."): print(i["at"], i["msg"], i["actor"], i["fields"])
   '
   ```

   Note what it does **not** contain.

## Done when

```bash
fire() {
  for i in 1 2 3 4 5 6 7 8; do
    curl -s -o /dev/null -w '%{http_code} ' -X POST http://localhost:8099/api/v1/voice-answer \
      -H 'content-type: application/json' \
      -d "{\"prospect\":\"progress\",\"question\":\"What is binder jetting?\",\"conversation_id\":\"ex8-$1-$i\"}"
  done
  echo
}

before=$(fire before)
curl -s -b cookies.txt -X PATCH http://localhost:8099/api/v1/admin/settings \
  -H 'content-type: application/json' -d '{"limits": {"rateLimitRps": 0.2, "rateLimitBurst": 1}}' > /dev/null
after=$(fire after)
curl -s -b cookies.txt -X PATCH http://localhost:8099/api/v1/admin/settings \
  -H 'content-type: application/json' -d '{"limits": {"rateLimitRps": null, "rateLimitBurst": null}}' > /dev/null

python3 -c "
before = '$before'.split()
after  = '$after'.split()
assert before.count('200') == 8, f'expected the shipped limit to allow all eight, got {before}'
assert after[0] == '200', f'the first call should still pass the bucket, got {after}'
assert after.count('429') >= 6, f'expected the patched limit to reject the rest, got {after}'
print('PASS: same process, same route —', before.count('200'), 'x200 before the patch;',
      after.count('200'), 'x200 and', after.count('429'), 'x429 after it, with no restart in between')
"
```

## Done when (the two refusals)

```bash
# a) out of the field's own range
curl -s -b cookies.txt -X PATCH http://localhost:8099/api/v1/admin/settings \
  -H 'content-type: application/json' -d '{"limits": {"turnTimeoutMs": 1}}' \
  -o /tmp/ex8-range.json -w '%{http_code}\n'

# b) legal on its own, illegal next to agentToolTimeoutMs
curl -s -b cookies.txt -X PATCH http://localhost:8099/api/v1/admin/settings \
  -H 'content-type: application/json' -d '{"limits": {"turnTimeoutMs": 9000}}' \
  -o /tmp/ex8-invariant.json -w '%{http_code}\n'

python3 -c '
import json
rng = json.load(open("/tmp/ex8-range.json"))
inv = json.load(open("/tmp/ex8-invariant.json"))
assert rng["status"] == 400 and "at least" in rng["errors"][0]["message"], rng
assert inv["status"] == 400, inv
assert any("AGENT_TOOL_TIMEOUT_MS" in e.get("message","") for e in inv["errors"]), inv
print("PASS (range)    :", rng["errors"][0]["message"])
print("PASS (invariant):", inv["errors"][0]["message"])
'

curl -s -b cookies.txt http://localhost:8099/api/v1/admin/config | python3 -c \
  'import json,sys; print("turnTimeoutMs is still", json.load(sys.stdin)["voice"]["turnTimeoutMs"])'
```

The last line must print `6000`. The two refusals reach that outcome by different routes, and the
difference is the whole point of the exercise — see the solution.

## Think about

- The rate limit is not read once at boot and cached. Find `liveBudget()` in
  `src/services/budget.ts` and work out *why it returns an object of getters* rather than a plain
  `{ rps, burst }`. (`DECISIONS.md` V-31: the platform spreads `route.opts.rateLimit` on every
  request, so a frozen object would make the Settings screen lie.)
- Step 9's log lines carry `actor`, `fields` and `at` — and never the values. What does a customer
  whose change-management process needs "what was it changed *to*" have to build for themselves?
