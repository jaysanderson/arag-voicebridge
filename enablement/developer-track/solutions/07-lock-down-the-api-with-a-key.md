# Solution 7 — Lock the API down with a named key, rotate it, revoke it

```bash
ARAG_MOCK=1 ADMIN_TOKEN=ex7-token DATA_DIR=/tmp/vb-ex7 PORT=8099 node src/index.ts &
```

**Before any key exists, the API is open:**

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:8099/api/v1/voice-answer \
  -H 'content-type: application/json' \
  -d '{"prospect":"progress","question":"What is binder jetting?","conversation_id":"ex7-open"}'
```

```
200
```

**Mint a key:**

```bash
curl -s -c cookies.txt -X POST http://localhost:8099/api/v1/admin/login \
  -H 'content-type: application/json' -d '{"token":"ex7-token"}'

curl -s -b cookies.txt -X POST http://localhost:8099/api/v1/admin/api-keys \
  -H 'content-type: application/json' -d '{"name":"Exercise 7 telephony bridge"}'
```

```json
{
  "key": {
    "id": "key_7dd87cc5ac9de8f8",
    "name": "Exercise 7 telephony bridge",
    "prefix": "vbk_Zn6jiT",
    "origin": "store",
    "createdAt": "2026-09-13T08:40:29.706Z",
    "lastUsedAt": null,
    "uses": 0,
    "revoked": false,
    "revokedAt": null
  },
  "secret": "vbk_Zn6jiTZ1GWlf81VrL1nZ6HN0g-HORzDd"
}
```

`origin` is `"store"` — this key was minted here. A key seeded from the old `API_KEYS` variable on
first boot reads `"env"` instead, which is how you tell, months later, which credentials predate
the store (`DECISIONS.md` V-27). `prefix` is the only part of the secret any later read will show
you; `secret` appears exactly once, in this response.

```bash
KEY=vbk_Zn6jiTZ1GWlf81VrL1nZ6HN0g-HORzDd   # the full secret from the response above, not the prefix
```

**Now the same call fails:**

```bash
curl -s -X POST http://localhost:8099/api/v1/voice-answer \
  -H 'content-type: application/json' \
  -d '{"prospect":"progress","question":"What is binder jetting?","conversation_id":"ex7-locked"}'
```

```json
{
  "type": "https://arag.dev/problems/unauthorized",
  "title": "Unauthorized",
  "status": 401,
  "detail": "API key required (X-API-Key or Authorization: Bearer)",
  "instance": "/api/v1/voice-answer",
  "requestId": "d3608afb-e67a-4e60-ab2d-e37c79c93459"
}
```

**With the key attached, it succeeds again:**

```bash
curl -s -X POST http://localhost:8099/api/v1/voice-answer \
  -H 'content-type: application/json' -H "X-API-Key: $KEY" \
  -d '{"prospect":"progress","question":"What is binder jetting?","conversation_id":"ex7-unlocked"}'
```

```json
{
  "answer": "The Desktop Metal Shop System is a binder jetting metal 3D printer built for machine shops that need production volumes. Desktop Metal printers in this family print stainless steel parts in batches rather than one at a time.",
  "citations": [{ "title": "Desktop Metal Shop System", "url": "", "score": 1 }],
  "handoff": false,
  "latency_ms": { "retrieve": 3, "first_token": 3, "total": 4 }
}
```

**`GET /api/v1/admin/api-keys` before and after:**

```bash
curl -s -b cookies.txt http://localhost:8099/api/v1/admin/api-keys | python3 -c 'import json,sys;d=json.load(sys.stdin);print("open:",d["open"],"active:",d["active"])'
```

```
open: False active: 1
```

**Use is attributed to the key, not just counted globally:**

```bash
curl -s -b cookies.txt http://localhost:8099/api/v1/admin/api-keys | python3 -c '
import json,sys;d=json.load(sys.stdin)
for i in d["items"]: print(i["name"], "| uses", i["uses"], "| lastUsedAt", i["lastUsedAt"])'
```

```
Exercise 7 telephony bridge | uses 1 | lastUsedAt 2026-09-13T08:40:29.842Z
```

`lastUsedAt` is sampled at 30 s per key rather than written on every request — a busy deployment
should not pay a store flush per turn — so a burst of calls inside the same half-minute shows one
timestamp, not the last one.

## Rotation, in the only safe order

```bash
mint() {
  curl -s -b cookies.txt -X POST http://localhost:8099/api/v1/admin/api-keys \
    -H 'content-type: application/json' -d "{\"name\":\"$1\"}"
}
call() {
  curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:8099/api/v1/voice-answer \
    -H 'content-type: application/json' -H "X-API-Key: $1" \
    -d '{"prospect":"progress","question":"q","conversation_id":"ex7-rot"}'
}

old_json=$(mint "Telephony bridge (old)")
OLD=$(echo "$old_json" | python3 -c 'import json,sys;print(json.load(sys.stdin)["secret"])')
OLD_ID=$(echo "$old_json" | python3 -c 'import json,sys;print(json.load(sys.stdin)["key"]["id"])')
NEW=$(mint "Telephony bridge (new)" | python3 -c 'import json,sys;print(json.load(sys.stdin)["secret"])')

echo "both active — old: $(call "$OLD")  new: $(call "$NEW")"
curl -s -b cookies.txt -X DELETE "http://localhost:8099/api/v1/admin/api-keys/$OLD_ID" > /dev/null
echo "old revoked  — old: $(call "$OLD")  new: $(call "$NEW")"
```

```
both active — old: 200  new: 200
old revoked  — old: 401  new: 200
```

That overlap window is the whole technique. Two active keys authenticate independently, so the
caller can be moved from one to the other at its own pace; revocation then takes effect on the very
next request. Do it the other way round — revoke, then update the caller — and every call in
between is a 401, which on a live telephony bridge is an outage, not a formality. The mechanism
does not protect you from getting the order wrong; only the process does.

```bash
curl -s -b cookies.txt http://localhost:8099/api/v1/admin/api-keys | python3 -c '
import json,sys;d=json.load(sys.stdin)
print("open",d["open"],"active",d["active"])
for i in d["items"]: print(" ",i["name"],"| revoked",i["revoked"])'
```

```
open False active 1
  Telephony bridge (new) | revoked False
  Telephony bridge (old) | revoked True
  Exercise 7 telephony bridge | revoked True
```

## Stretch — revoking the only key

```bash
curl -s -b cookies.txt -X DELETE http://localhost:8099/api/v1/admin/api-keys/key_7dd87cc5ac9de8f8
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:8099/api/v1/voice-answer \
  -H 'content-type: application/json' \
  -d '{"prospect":"progress","question":"q","conversation_id":"ex7-after-revoke"}'
```

```
200
```

```bash
curl -s -b cookies.txt http://localhost:8099/api/v1/admin/api-keys | python3 -c 'import json,sys;d=json.load(sys.stdin);print("open:",d["open"],"active:",d["active"],"items:",[(i["name"],i["revoked"]) for i in d["items"]])'
```

```
open: True active: 0 items: [('Exercise 7 telephony bridge', True)]
```

## Why this works

`ApiKeyStore` (`src/services/apiKeys.ts`, `DECISIONS.md` V-27) rewrites the live `env.apiKeys` array
the platform's `App.authenticate()` reads on every request — there is no cache to invalidate and no
restart to wait for, because minting or revoking a key *is* mutating the exact array the middleware
checks. That is why the "locked" call fails the instant the key exists, before you have done
anything with the key itself, and why the "unlocked" call works the instant you attach it.

Revoking the record leaves it in the store marked `revoked: true` rather than deleting it — the
`GET /api/v1/admin/api-keys` response above still lists it — so a security review can see that a key
existed and was retired, and when, rather than a gap in the history. And revoking the *last* active
key reopens `auth: "api"` routes rather than locking everyone out, including whoever is trying to
mint a replacement key — a deliberate "no keys = open" behaviour (`DECISIONS.md` V-27), not a bug,
and `open: true` in the same response is exactly how an operator is meant to notice.

One more thing worth knowing before Exercise 9: the store keeps each secret **in full, in
plaintext**, in `DATA_DIR/api-keys.json`, rather than hashing it. That is a considered trade-off,
not an oversight, and it has two reasons. The platform's `App.authenticate()` compares an incoming
`X-API-Key` against the stored value in constant time on every request — this is a bearer
credential checked per request, not a password checked at login. And pushing the ElevenLabs agent's
custom server tool has to put a *real, usable* key into the tool's `X-API-Key` header
(`desiredTool()`, `src/services/voiceAgent.ts`); a hash cannot supply a credential a third-party
service will actually send back. The trust level is the same as the `.env` file the store replaced.
Exercise 9 watches that key travel into the tool definition and come back as a working turn.
