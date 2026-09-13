# Solution 8 — Change a setting and prove it took effect without a restart

```bash
ARAG_MOCK=1 ADMIN_TOKEN=ex8-token DATA_DIR=/tmp/vb-ex8 PORT=8099 node src/index.ts &

curl -s -c cookies.txt -X POST http://localhost:8099/api/v1/admin/login \
  -H 'content-type: application/json' -d '{"token":"ex8-token"}'
```

**Read the starting point:**

```bash
curl -s -b cookies.txt http://localhost:8099/api/v1/admin/config | python3 -c \
  'import json,sys; c=json.load(sys.stdin)["voice"]; print(c["turnTimeoutMs"], c["agentToolTimeoutMs"])'
```

```
6000 8000
```

**Before the patch, an ordinary question answers normally:**

```bash
curl -s -X POST http://localhost:8099/api/v1/voice-answer -H 'content-type: application/json' \
  -d '{"prospect":"progress","question":"What is binder jetting?","conversation_id":"ex8-before"}'
```

```json
{ "answer": "The Desktop Metal Shop System is a binder jetting metal 3D printer built for machine shops that need production volumes.", "citations": [{ "title": "Desktop Metal Shop System", "url": "", "score": 1 }], "handoff": false, "latency_ms": { "retrieve": 3, "first_token": 3, "total": 4 } }
```

**Patch the turn budget — no restart, same process:**

```bash
curl -s -b cookies.txt -X PATCH http://localhost:8099/api/v1/admin/settings \
  -H 'content-type: application/json' -d '{"limits": {"turnTimeoutMs": 1}}'
```

```json
{ "ok": true, "groups": { "limits": { "id": "limits", "title": "Limits and timeouts", "fields": [ { "key": "turnTimeoutMs", "value": 1, "source": "stored" } ] } } }
```

**The exact same question, on the exact same running process, now hands off:**

```bash
curl -s -X POST http://localhost:8099/api/v1/voice-answer -H 'content-type: application/json' \
  -d '{"prospect":"progress","question":"What is binder jetting?","conversation_id":"ex8-after"}'
```

```json
{ "answer": "Let me get a team member for that.", "citations": [], "handoff": true, "handoff_reason": "upstream-error", "latency_ms": { "retrieve": 0, "first_token": 0, "total": 1 } }
```

```bash
curl -s -b cookies.txt http://localhost:8099/api/v1/admin/config | python3 -c \
  'import json,sys; print(json.load(sys.stdin)["voice"]["turnTimeoutMs"])'
```

```
1
```

**Reset it, and confirm normal behaviour returns:**

```bash
curl -s -b cookies.txt -X PATCH http://localhost:8099/api/v1/admin/settings \
  -H 'content-type: application/json' -d '{"limits": {"turnTimeoutMs": null}}'

curl -s -X POST http://localhost:8099/api/v1/voice-answer -H 'content-type: application/json' \
  -d '{"prospect":"progress","question":"What is binder jetting?","conversation_id":"ex8-reset"}'
```

```json
{ "answer": "The Desktop Metal Shop System is a binder jetting metal 3D printer built for machine shops that need production volumes.", "citations": [{ "title": "Desktop Metal Shop System", "url": "", "score": 1 }], "handoff": false, "latency_ms": { "retrieve": 3, "first_token": 3, "total": 4 } }
```

**Try to break the invariant instead:**

```bash
curl -s -b cookies.txt -X PATCH http://localhost:8099/api/v1/admin/settings \
  -H 'content-type: application/json' -d '{"limits": {"turnTimeoutMs": 9000}}'
```

```json
{ "type": "https://.../problems/validation-failed", "title": "Validation failed", "status": 400, "errors": [ { "path": "/limits", "message": "VOICE_TURN_TIMEOUT_MS (9000) must be < AGENT_TOOL_TIMEOUT_MS (8000)" } ] }
```

```bash
curl -s -b cookies.txt http://localhost:8099/api/v1/admin/config | python3 -c \
  'import json,sys; print(json.load(sys.stdin)["voice"]["turnTimeoutMs"])'
```

```
6000
```

Unchanged — the reset from the previous step is still in force, exactly as if the rejected patch had
never been attempted.

## Why this works

`SettingsService.apply()` (`src/services/settings.ts`, `DECISIONS.md` V-26) doesn't rebuild the
`VoiceConfig`/`PlatformEnv` objects the pipeline reads from — it writes the effective value directly
*into* the same objects every route and service already holds a reference to. There is nothing to
re-wire and nothing to restart, because the object identity never changes, only a field on it. That
is why the second `voice-answer` call, on the same process, sees the new value instantly: it was
never reading a cached copy in the first place.

The invariant check is what makes this safe to expose as a live PATCH rather than only a boot-time
assertion: `assertVoiceConfig()` runs again after every `apply()`, and if a patch would leave
`turnTimeoutMs` at or above `agentToolTimeoutMs` — the exact condition that would leave a caller
hearing silence, because the agent's own tool call would give up before the bridge ever resolves —
the patch is applied, checked, found unsafe, and **rolled back**, store and live config both, before
the request returns. The 400 you get back is the same shape a script would get; nothing about it is
UI-only.
