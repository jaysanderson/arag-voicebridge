# Solution 8 — Change a setting and prove it took effect without a restart

```bash
ARAG_MOCK=1 ADMIN_TOKEN=ex8-token DATA_DIR=/tmp/vb-ex8 PORT=8099 node src/index.ts &
curl -s -c cookies.txt -X POST http://localhost:8099/api/v1/admin/login \
  -H 'content-type: application/json' -d '{"token":"ex8-token"}'
```

**The configuration in force:**

```bash
curl -s -b cookies.txt http://localhost:8099/api/v1/admin/config | python3 -c \
  'import json,sys; c=json.load(sys.stdin)["voice"]; print(c["turnTimeoutMs"], c["agentToolTimeoutMs"])'
```

```
6000 8000
```

**The limits group, as the Settings screen reads it.** Each field carries its effective `value`,
where that value came from (`source`), and the range it will accept:

```bash
curl -s -b cookies.txt http://localhost:8099/api/v1/admin/settings | python3 -c '
import json,sys
for g in json.load(sys.stdin)["groups"]:
    if g["id"] != "limits": continue
    for f in g["fields"]:
        print("%-20s value=%-8s source=%-8s min=%s max=%s" % (f["key"], f["value"], f["source"], f.get("min"), f.get("max")))
'
```

```
turnTimeoutMs        value=6000     source=default  min=500 max=60000
agentToolTimeoutMs   value=8000     source=default  min=1000 max=120000
briefTimeoutMs       value=12000    source=default  min=1000 max=120000
maxHistoryTurns      value=6        source=default  min=0 max=40
turnLogLimit         value=500      source=default  min=10 max=10000
rateLimitRps         value=5        source=default  min=0 max=1000
rateLimitBurst       value=20       source=default  min=1 max=10000
maxBodyBytes         value=26214400 source=default  min=1024 max=67108864
briefRps             value=1        source=default  min=0 max=100
briefBurst           value=5        source=default  min=1 max=1000
scribeRps            value=0.2      source=default  min=0 max=100
scribeBurst          value=3        source=default  min=1 max=1000
ttsRps               value=1        source=default  min=0 max=100
ttsBurst             value=6        source=default  min=1 max=1000
```

`source` is the operationally interesting one. `default` means nobody has set it anywhere; `env`
means this deployment's environment supplied it at boot; `stored` means someone has since patched
it and **the environment no longer describes what is running**. That last case is why a go-live
review reads this endpoint rather than the `.env` file (`architect-track/design-review-checklist.md`,
"Configuration authority").

**Eight calls at the shipped limit — all fine:**

```bash
fire() {
  for i in 1 2 3 4 5 6 7 8; do
    curl -s -o /dev/null -w '%{http_code} ' -X POST http://localhost:8099/api/v1/voice-answer \
      -H 'content-type: application/json' \
      -d "{\"prospect\":\"progress\",\"question\":\"What is binder jetting?\",\"conversation_id\":\"ex8-$1-$i\"}"
  done
  echo
}
fire before
```

```
200 200 200 200 200 200 200 200
```

**Patch the limiter, change nothing else, restart nothing:**

```bash
curl -s -b cookies.txt -X PATCH http://localhost:8099/api/v1/admin/settings \
  -H 'content-type: application/json' -d '{"limits": {"rateLimitRps": 0.2, "rateLimitBurst": 1}}' > /dev/null
fire after
```

```
200 429 429 429 429 429 429 429
```

One request fills the bucket; every other one in the same second is refused. Same process, same
route, same second — the only thing that changed is a row in `DATA_DIR/settings.json`.

**Put it back:**

```bash
curl -s -b cookies.txt -X PATCH http://localhost:8099/api/v1/admin/settings \
  -H 'content-type: application/json' -d '{"limits": {"rateLimitRps": null, "rateLimitBurst": null}}' > /dev/null
sleep 5     # the token bucket has to refill; it is not reset by the patch
fire restored
```

```
200 200 200 200 200 200 200 200
```

`null` is not "zero" — it removes the stored override, so the field falls back to the environment
value, or to the shipped default if the environment never set one. Check `source` afterwards and it
reads `default` again.

**The two refusals.** They look alike from a distance and are not the same mechanism:

```bash
curl -s -b cookies.txt -X PATCH http://localhost:8099/api/v1/admin/settings \
  -H 'content-type: application/json' -d '{"limits": {"turnTimeoutMs": 1}}'
```

```json
{"type":"https://arag.dev/problems/validation","title":"Validation failed","status":400,
 "detail":"Invalid body: /limits/turnTimeoutMs must be at least 500",
 "errors":[{"path":"/limits/turnTimeoutMs","message":"must be at least 500"}],"in":"body"}
```

That one never reached the settings service at all. `min: 500` is declared on the field in
`src/services/settings.ts`'s one table, the OpenAPI document is generated from that same table, and
`operationSchemas(...)` refused the body at the edge of the route — `"in": "body"` is the giveaway.
It is a statement about one number and nothing else.

```bash
curl -s -b cookies.txt -X PATCH http://localhost:8099/api/v1/admin/settings \
  -H 'content-type: application/json' -d '{"limits": {"turnTimeoutMs": 9000}}'
```

```json
{"status":400,"title":"Validation failed",
 "errors":[{"path":"/limits","message":"VOICE_TURN_TIMEOUT_MS (9000) must be < AGENT_TOOL_TIMEOUT_MS (8000) so the bridge always resolves a turn before the agent's tool call times out."}]}
```

`9000` is a perfectly legal value for a field whose range is 500–60000, so schema validation passed
it. It was refused *afterwards*, by `assertVoiceConfig()` — the same function `src/config.ts` runs
at boot — re-run against the live configuration **after** the patch had already been applied. Note
the `path`: `/limits`, the group, not `/limits/turnTimeoutMs`, because the thing that is wrong is a
relationship between two fields, not either field on its own.

```bash
curl -s -b cookies.txt http://localhost:8099/api/v1/admin/config | python3 -c \
  'import json,sys; print(json.load(sys.stdin)["voice"]["turnTimeoutMs"])'
```

```
6000
```

Unchanged — and that is the part worth dwelling on. The 9000 *was* written, the invariant was
checked against the real object, it failed, and both the store and the live config were **rolled
back** before the response was sent. A rejection alone would not have been enough: by the time you
can evaluate a cross-field invariant you have already changed the thing you are evaluating.

**The audit trail:**

```bash
curl -s -b cookies.txt "http://localhost:8099/api/v1/admin/logs?limit=50" | python3 -c '
import json,sys
for i in json.load(sys.stdin)["items"]:
    if i.get("msg","").startswith("settings."): print(i["at"], i["msg"], i["actor"], i["fields"])
'
```

```
2026-09-13T08:41:33.103Z settings.changed operator ['limits.rateLimitRps', 'limits.rateLimitBurst']
2026-09-13T08:41:33.001Z settings.changed operator ['limits.rateLimitRps', 'limits.rateLimitBurst']
```

Who, which fields, when — and deliberately **not what to**. Some settings are secrets (the ARAG
API key, the ElevenLabs key) and a log that recorded values would be a log that leaked them, so
none of them record values. The rejected patches are not in the list at all: nothing was changed,
so nothing was audited.

## Why this works

`SettingsService.apply()` (`src/services/settings.ts`, `DECISIONS.md` V-26) doesn't rebuild the
`VoiceConfig`/`PlatformEnv` objects the pipeline reads from — it writes the effective value directly
*into* the same objects every route and service already holds a reference to. There is nothing to
re-wire and nothing to restart, because the object identity never changes, only a field on it.

The rate limit needed one extra thing on top of that, and it is the most instructive detail in the
exercise. The platform reads `route.opts.rateLimit` **per request**, but the product used to hand it
a plain, frozen `{ rps, burst }` captured at boot — so the Settings screen would happily report a
new limit that the limiter was never going to apply. `DECISIONS.md` V-31 calls that what it is: "a
setting that cannot take effect without a restart is a bug, not a caveat." The fix is
`liveBudget()` in `src/services/budget.ts`, which returns an object of **getters**; the platform's
spread evaluates them on every request, so the limiter reads today's value, not boot's. Two other
values were wrong in the same way and fixed in the same pass (the turn-log ring cap, and the
deployment's `ARAG_GENERATIVE_MODEL`/`ARAG_RERANKER` defaults) — worth reading V-31 in full before
you add a setting of your own, because "I put it in the table" is not the same as "the product
reads it".

The invariant check is what makes this safe to expose as a live PATCH rather than only a boot-time
assertion: `assertVoiceConfig()` runs again after every `apply()`, and if a patch would leave
`turnTimeoutMs` at or above `agentToolTimeoutMs` — the exact condition that would leave a caller
hearing silence, because the agent's own tool call would give up before the bridge ever resolves —
the patch is applied, checked, found unsafe, and rolled back, store and live config both, before
the request returns. The 400 you get back is the same shape a script would get; nothing about it is
UI-only. It is also the *only* cross-field check Settings has: every other field is validated in
isolation, and nothing stops an operator setting a retention window to zero on every group at once.
