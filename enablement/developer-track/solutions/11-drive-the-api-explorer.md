# Solution 11 — Drive the API explorer, and prove it cannot go stale

```bash
ARAG_MOCK=1 ADMIN_TOKEN=ex11-token DATA_DIR=/tmp/vb-ex11 PORT=8099 node src/index.ts &
open http://localhost:8099/api/
```

The header reads **58 operations**. Hold that number.

## 3. `listProspects`

Status chip `200 OK`, a body listing `progress`, `tangerine` and `northwind`, and:

```
curl -X GET 'http://localhost:8099/api/v1/prospects'
```

No auth header, because the document says this operation is open — that is not the explorer being
lax, it is the explorer reading `security` off the operation.

## 4. `voiceAnswer`

The body arrives prefilled:

```json
{
  "prospect": "progress",
  "question": "What is binder jetting?",
  "conversation_id": "",
  "history": [
    { "author": "USER", "text": "" }
  ],
  "generative_model": "",
  "trace": false
}
```

Nothing in the page knows what a `voice-answer` body looks like. `exampleFor()` walks the request
schema in the document — honouring each property's `example`, then `default`, then the first value
of an `enum` (that is where `"USER"` comes from), then a per-type placeholder — and `prefill()`
then substitutes the deployment's own currently-selected prospect and a question the mock corpus
can actually answer. Add a property to `VoiceAnswerRequest` in `src/openapi.ts` and it appears here
on the next reload, with no front-end change.

Send it as-is and it answers. Note what that proves about the schema: `history[]` arrived with an
empty `text`, and the turn still ran, because only `prospect` and `question` are `required` — the
example is a form to edit, not a body to trust.

## 5. `adminGetSettings`

Before signing in, the auth note reads:

> Sent with your operator cookie. Sign in under Operator if this returns 401.

and the operation is marked `operator` in the list. Sending it now returns `401`. Sign in at
`/admin/` with `ex11-token`, come back, press **Send** again, and the same request returns the six
settings groups. The explorer did not change; your browser gained the `arag_admin` cookie. The
curl it offers uses a placeholder rather than your token:

```
curl -X GET 'http://localhost:8099/api/v1/admin/settings'
  -H 'Authorization: Bearer $ADMIN_TOKEN'
```

## 6. `adminDeleteProspect`

Nothing is sent. A confirmation appears first, saying the action cannot be undone, and **Cancel**
dismisses it with no request made. `DESTRUCTIVE` in `public/app/api.js` is a set containing
`"delete"` — the *method*, not a curated list of operation ids.

## 7. The curl, pasted

```bash
curl -X POST 'http://localhost:8099/api/v1/voice-answer' \
  -H 'X-API-Key: $API_KEY' \
  -H 'content-type: application/json' \
  -d '{"prospect":"progress","question":"What is binder jetting?","conversation_id":"","history":[{"author":"USER","text":""}],"generative_model":"","trace":false}'
```

```json
{"answer":"The Desktop Metal Shop System is a binder jetting metal 3D printer built for machine shops that need production volumes. …","citations":[…],"handoff":false,"latency_ms":{"retrieve":3,"first_token":3,"total":4}}
```

Same body as on screen. `$API_KEY` is left as a shell variable deliberately; on this deployment no
key is active, so `auth: "api"` routes are open and the header is accepted and ignored (Exercise 7
is what changes that).

## 8. Acceptance run

```
PASS: 47 paths, 58 operations, 18 operator-only paths — {'listen': 9, 'voice': 3, 'prospects': 4, 'realtime': 3, 'quality': 6, 'system': 4, 'jobs': 4, 'admin': 25}
```

58, matching the page. (18 *paths* under `/api/v1/admin`, carrying 25 operations between them — a
path with both a `GET` and a `DELETE` is one path and two operations, which is exactly the
distinction the explorer's count is careful about.)

```bash
PW_DISABLE_TS_ESM=1 bunx playwright test test/e2e/explain.spec.ts -g "the API explorer"
```

```
Running 4 tests using 1 worker
  ✓  1 …the API explorer › lists every operation in the document and can call one (462ms)
  ✓  2 …the API explorer › prefills a request body from the schema, with the chosen prospect in it (372ms)
  ✓  3 …the API explorer › asks before it fires something destructive (311ms)
  ✓  4 …the API explorer › marks which operations need an operator (224ms)
  4 passed (3.0s)
```

The first of those four does not assert "there are 58 operations" — it reads the document at run
time, counts, and asserts the page shows *that* number. A test with the number written into it
would need editing every time the API grew, and would therefore eventually be edited without
anyone checking the page.

## Answers to "think about"

- **How could the page and the document disagree?** Only by the page failing to render something
  that is in the document — a rendering bug, which the e2e count catches. The other direction is
  closed further upstream: every `/api/v1` route is registered with
  `validate: operationSchemas(openapi, path, method)`, which throws at startup if the document has
  no entry for that path and method. A route nobody documented does not become an undocumented
  route; it becomes a server that will not boot. That is the same property from the other end —
  the document cannot fall behind the code, and the page cannot fall behind the document.
- **`DESTRUCTIVE` keyed on the method** prevents the failure a curated list always eventually has:
  a new destructive operation is added and nobody remembers to add it to the list. There is no list
  to forget. The cost is that a `DELETE` which is not really destructive also prompts — a cheap
  false positive, and the right way round for a confirmation.
- **Why key handling matters more here.** This is the one screen whose entire purpose is to send
  requests the viewer composes, and the one a partner is most likely to be driving over a shared
  screen or in a recorded call. A key persisted in `localStorage` would outlive the session, the
  demo and the laptop's owner; a key echoed into the curl would end up in a ticket. Settings, by
  contrast, never displays a secret back at all — the explorer has to *use* one, so the rule is
  "hold it in the page, print a placeholder".
- **What V-30 cost.** Deleting two operations from `src/openapi.ts` and the routes behind them. The
  explorer lost two rows on its next reload, `make docs` regenerated `api-reference.md`, and no
  human edited a page describing the API. A hand-written reference page is where removals go to be
  forgotten, which is how an API reference ends up documenting endpoints that answer `404`.
