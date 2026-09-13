# Exercise 7 — Lock the API down with a named key, and prove it

**Goal:** confirm the API is open by default, mint a named API key, prove a call now fails without
it, prove the same call succeeds with it, and understand what happens if you revoke it.

## Task

1. Start the server against the mock, with no `API_KEYS` set at all:

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
   field.

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

## Stretch: what does revoking the only key do?

Revoke the key you just created (`DELETE /api/v1/admin/api-keys/{id}`, using the `id` from the
create response, not the secret) and repeat the unauthenticated call from step 2 one more time.
Before you run it, predict the status code — then check `GET /api/v1/admin/api-keys`'s `open` field
to see why you were right or wrong. This is `DECISIONS.md` V-27's documented "no keys = open"
behaviour: it exists so a deployment never locks its own owner out by accident, and `open: true` is
how an operator notices before a caller does.
