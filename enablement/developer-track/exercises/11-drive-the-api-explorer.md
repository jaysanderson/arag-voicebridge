# Exercise 11 — Drive the API explorer, and prove it cannot go stale

**Goal:** use the in-product API explorer to call the API without writing a request by hand, then
prove the claim it rests on — that it is *generated* from `/api/v1/openapi.json` and therefore
cannot drift from the API it documents.

Every other exercise in this track has driven the API from a terminal. This one is about the
surface a partner's developer meets first, before they have a curl command or an SDK: 58
operations, each with its description, its parameters, a try-it form, the request and response as
they really were, and a copyable curl.

## Task

1. Start the server against the mock:

   ```bash
   ARAG_MOCK=1 ADMIN_TOKEN=ex11-token DATA_DIR=/tmp/vb-ex11 PORT=8099 node src/index.ts
   ```

2. Open `http://localhost:8099/api/`. Note the operation count in the header before you do anything
   else — you are going to check it.

3. **Call something read-only.** Find `listProspects` (the search box takes a path or an operation
   id). Press **Send**. Read three things: the status chip, the response body, and the curl.

4. **Call something with a body.** Find `voiceAnswer`. The body is prefilled from the request
   schema in the document, with this deployment's first prospect already in it — you are not
   expected to know the shape. Send it, then edit the question and send again.

5. **Meet the auth model.** Search for `admin/settings` and select `adminGetSettings`. Read the
   auth note. Then sign in at `/admin/` with `ex11-token` in another tab, come back, and send it.
   Nothing about the explorer changed; what changed is the cookie your browser now carries.

6. **Try to break something.** Select `adminDeleteProspect`, put `definitely-not-a-real-prospect`
   in the path field, and press **Send**. Read what happens before anything is sent.

7. **Copy the curl out.** Take the curl the explorer shows for `voiceAnswer`, paste it into a
   terminal, and confirm it returns the same thing. If it does not, the explorer is lying about
   what it did — which is the whole reason it shows you the curl rather than just the result.
   Note that it writes `$API_KEY` (and `$ADMIN_TOKEN` for operator routes) as a shell placeholder
   rather than baking in a credential: a curl you can paste into a ticket is worth more than one
   you have to redact first. On this deployment no key is active yet, so the header is accepted
   and ignored.

8. **Prove it is generated.** The page hand-lists nothing: `public/app/api.js` flattens
   `/api/v1/openapi.json` and renders whatever is in it. Check that from the outside — count the
   operations in the document yourself and compare with the count on the page.

## Done when

The explorer's own count, the document, and a call made through it all agree:

```bash
curl -s http://localhost:8099/api/v1/openapi.json | python3 -c '
import json, sys
from collections import Counter

doc = json.load(sys.stdin)
methods = ["get", "post", "put", "patch", "delete"]
ops = [(m, p, item[m]) for p, item in doc["paths"].items() for m in methods if m in item]

ids = [o[2].get("operationId") for o in ops]
assert all(ids), "every operation needs an operationId — the explorer keys its deep links on it"
assert len(set(ids)) == len(ids), "duplicate operationId"

admin_paths  = {o[1] for o in ops if o[1].startswith("/api/v1/admin")}
admin_tagged = {o[1] for o in ops if "admin" in o[2].get("tags", [])}
assert admin_paths == admin_tagged, admin_paths ^ admin_tagged

print("PASS:", len(doc["paths"]), "paths,", len(ops), "operations,",
      len(admin_paths), "operator-only paths —", dict(Counter(o[2]["tags"][0] for o in ops)))
'
```

Compare the operation number with the `N operations` the page prints. Then, the browser half —
this is the same assertion the shipped e2e suite makes, and it starts its own server, so stop
yours first or let it use its own port:

```bash
PW_DISABLE_TS_ESM=1 bunx playwright test test/e2e/explain.spec.ts -g "the API explorer"
```

```
✓ lists every operation in the document and can call one
✓ prefills a request body from the schema, with the chosen prospect in it
✓ asks before it fires something destructive
✓ marks which operations need an operator
```

## Think about

- The count on the page is `Object.values(doc.paths)` flattened over five methods — the same
  expression the test above uses. What would have to happen for the page and the document to
  disagree, and why is "someone forgot to document the new route" not one of the possibilities?
  (Look at how a route is registered in `src/routes/*.ts`: `validate: operationSchemas(openapi,
  path, method)` — a route with no entry in the document cannot start.)
- Step 6 asked before firing. Find `DESTRUCTIVE` in `public/app/api.js` and notice it is keyed on
  the **method**, not on a list of dangerous operation ids. Which failure does that design prevent
  that a hand-maintained list would not?
- The explorer sends a try-it call with the viewer's own same-origin session cookie by default, and
  lets them paste an API key instead. It never stores the key beyond the page. Why does that
  matter more for this screen than for, say, Settings?
- `DECISIONS.md` V-30 removed two operations from this document because nothing used them and they
  duplicated public routes. Given that this page is generated, what did that removal cost in
  documentation work — and what would it have cost with a hand-written API reference page?

## Clean up

```bash
rm -rf /tmp/vb-ex11
```
