# Solution 7 — Lock the API down with a named key, and prove it

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
  "key": { "id": "key_7f3e0a1b9c2d4e56", "name": "Exercise 7 telephony bridge", "prefix": "vbk_4d81a0c7", "origin": "created", "revoked": false, "createdAt": "2026-09-13T10:00:00.000Z", "lastUsedAt": null, "uses": 0 },
  "secret": "vbk_4d81a0c7f5e6…"
}
```

```bash
KEY=vbk_4d81a0c7f5e6...   # the full secret from the response above, not the prefix
```

**Now the same call fails:**

```bash
curl -s -X POST http://localhost:8099/api/v1/voice-answer \
  -H 'content-type: application/json' \
  -d '{"prospect":"progress","question":"What is binder jetting?","conversation_id":"ex7-locked"}'
```

```json
{ "type": "https://.../problems/authentication-required", "title": "Authentication required", "status": 401, "detail": "An API key, bearer token or admin session is required." }
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

## Stretch — revoking the only key

```bash
curl -s -b cookies.txt -X DELETE http://localhost:8099/api/v1/admin/api-keys/key_7f3e0a1b9c2d4e56
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
