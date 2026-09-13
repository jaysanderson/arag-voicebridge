# Exercise 7 — Lock the API down with a named key, rotate it, revoke it

**Goal:** confirm the API is open by default, mint a named API key from the store, prove a call now
fails without it and succeeds with it, rotate it the way a real integration would, and understand
what happens when the last key is revoked.

`API_KEYS` is no longer the mechanism. `ApiKeyStore` (`src/services/apiKeys.ts`, `DECISIONS.md`
V-27) owns named keys with creation, revocation, use counts and last-used timestamps; the
environment variable survives only as a **seed**, read once on first boot so an integration holding
a key from before the upgrade keeps authenticating. Everything below goes through the store.

## Task

1. Start the server against the mock, with no `API_KEYS` seed at all — the store starts empty:

   ```bash
   ARAG_MOCK=1 ADMIN_TOKEN=ex7-token DATA_DIR=/tmp/vb-ex7 PORT=8099 node src/index.ts
   ```

2. Confirm the API is currently open — a plain, unauthenticated call to a public `auth: "api"` route
   succeeds:

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:8099/api/v1/voice-answer \
     -H 'content-type: application/json' \
     -d '{"prospect":"progress","question":"What is binder jetting?","conversation_id":"ex7-open"}'
   ```

   You should see `200`.

3. Sign in as admin and mint a key named after what will use it (Settings' own help text says it
   plainly: name it after the caller, not the person):

   ```bash
   curl -s -c cookies.txt -X POST http://localhost:8099/api/v1/admin/login \
     -H 'content-type: application/json' -d '{"token":"ex7-token"}'

   curl -s -b cookies.txt -X POST http://localhost:8099/api/v1/admin/api-keys \
     -H 'content-type: application/json' -d '{"name":"Exercise 7 telephony bridge"}'
   ```

   The response's `secret` field is shown exactly once — save it into a shell variable before you do
   anything else:

   ```bash
   KEY=<paste the secret here>
   ```

4. Repeat step 2's exact call, unchanged. It should now fail.

5. Repeat it again, this time with the key attached as `X-API-Key`. It should succeed.

6. Look at `GET /api/v1/admin/api-keys` before and after minting the key — specifically the `open`
   field, and, after a couple of authenticated calls, `uses` and `lastUsedAt` on the key itself.

7. **Rotate it**, in the order a live integration actually requires. Mint a second key *first*,
   check that both work, point your caller at the new one, and only then revoke the old. Predict
   what would happen if you revoked first and updated the caller second, before you try it.

## Done when

Script all three states in one go — open, locked, unlocked:

```bash
open_before=$(curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:8099/api/v1/voice-answer \
  -H 'content-type: application/json' \
  -d '{"prospect":"progress","question":"q","conversation_id":"ex7-a"}')

created=$(curl -s -b cookies.txt -X POST http://localhost:8099/api/v1/admin/api-keys \
  -H 'content-type: application/json' -d '{"name":"Exercise 7 check"}')
SECRET=$(echo "$created" | python3 -c 'import json,sys;print(json.load(sys.stdin)["secret"])')

locked=$(curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:8099/api/v1/voice-answer \
  -H 'content-type: application/json' \
  -d '{"prospect":"progress","question":"q","conversation_id":"ex7-b"}')

unlocked=$(curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:8099/api/v1/voice-answer \
  -H 'content-type: application/json' -H "X-API-Key: $SECRET" \
  -d '{"prospect":"progress","question":"q","conversation_id":"ex7-c"}')

python3 -c "
open_before, locked, unlocked = '$open_before', '$locked', '$unlocked'
assert open_before == '200', f'expected open API before any key, got {open_before}'
assert locked in ('401',), f'expected the call to fail once a key exists, got {locked}'
assert unlocked == '200', f'expected the call to succeed with the key attached, got {unlocked}'
print('PASS: open before (', open_before, ') -> locked without a key (', locked, ') -> unlocked with one (', unlocked, ')')
"
```

## Done when (rotation)

```bash
mint() {
  curl -s -b cookies.txt -X POST http://localhost:8099/api/v1/admin/api-keys \
    -H 'content-type: application/json' -d "{\"name\":\"$1\"}"
}
call() {  # $1 = secret
  curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:8099/api/v1/voice-answer \
    -H 'content-type: application/json' -H "X-API-Key: $1" \
    -d '{"prospect":"progress","question":"q","conversation_id":"ex7-rot"}'
}

old_json=$(mint "Telephony bridge (old)")
OLD=$(echo "$old_json" | python3 -c 'import json,sys;print(json.load(sys.stdin)["secret"])')
OLD_ID=$(echo "$old_json" | python3 -c 'import json,sys;print(json.load(sys.stdin)["key"]["id"])')
NEW=$(mint "Telephony bridge (new)" | python3 -c 'import json,sys;print(json.load(sys.stdin)["secret"])')

both_old=$(call "$OLD"); both_new=$(call "$NEW")
curl -s -b cookies.txt -X DELETE "http://localhost:8099/api/v1/admin/api-keys/$OLD_ID" > /dev/null
after_old=$(call "$OLD"); after_new=$(call "$NEW")

python3 -c "
b_old, b_new, a_old, a_new = '$both_old', '$both_new', '$after_old', '$after_new'
assert b_old == '200' and b_new == '200', f'both keys should work while both are active: {b_old} {b_new}'
assert a_old == '401', f'the revoked key should stop working immediately, got {a_old}'
assert a_new == '200', f'the replacement key should be unaffected, got {a_new}'
print('PASS: overlap (', b_old, b_new, ') -> revoke old (', a_old, ') -> new still live (', a_new, ')')
"
```

Revocation bites on the **very next request** — `ApiKeyStore.sync()` rewrites the live
`env.apiKeys` array the authenticator reads, with nothing cached in between. That is exactly why
the order matters: revoke-then-update is an outage for however long the caller takes to redeploy.

## Stretch: what does revoking the only key do?

Revoke every remaining key (`DELETE /api/v1/admin/api-keys/{id}`, using each `id` from the create
response, not the secret) and repeat the unauthenticated call from step 2 one more time.
Before you run it, predict the status code — then check `GET /api/v1/admin/api-keys`'s `open` field
to see why you were right or wrong. This is `DECISIONS.md` V-27's documented "no keys = open"
behaviour: it exists so a deployment never locks its own owner out by accident, and `open: true` is
how an operator notices before a caller does.

## Think about

- Every key you revoked is still listed, marked `revoked: true`, rather than deleted. Who is that
  for, and what would a reporting script get wrong if it filtered revoked keys out of its own
  counts?
- The store keeps each secret in full, in plaintext, in `DATA_DIR/api-keys.json` — it is not
  hashed. Before deciding that is a defect, work out what would break in Exercise 9, where the key
  has to be written into an ElevenLabs tool's `X-API-Key` header as a credential a third party will
  actually send back.
