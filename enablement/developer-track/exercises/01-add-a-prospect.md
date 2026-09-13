# Exercise 1 — Add a prospect that answers

**Goal:** register a new prospect through the **Prospects** screen's form — not by hand-crafting a
JSON body — and get it to answer a real question, without touching any file under `src/`.

## Task

1. Start the server against the mock, on a port of your choosing (avoid 8080 if something else is
   already using it):

   ```bash
   ARAG_MOCK=1 ADMIN_TOKEN=ex1-token DATA_DIR=/tmp/vb-ex1 PORT=8099 node src/index.ts
   ```

2. Open `http://localhost:8099/prospects/` in a browser. It renders read-only until you unlock it —
   enter `ex1-token` in the banner at the top and confirm the list becomes editable.

3. Press **New prospect**. The editor is a form across four tabs, not a raw JSON textarea (a
   **JSON** tab exists too, for pasting a whole record, but you're not using it here):
   - **Setup** — set the registry key to `orbital`, a display name, a locale, and a `kb_id`/region
     of your choosing. Under `ARAG_MOCK=1` the Knowledge Box id is never actually used to route the
     request, but the form still requires one to be present.
   - **Voice** — write a greeting and a handoff line.
   - **Golden set** — add at least one question with its expected behaviour (`answer` or
     `handoff`).

   Remember: the mock ARAG serves the same 8-document additive-manufacturing corpus
   (`src/services/seed.ts`) to **every** prospect, so `orbital`'s question has to be answerable
   from that corpus (furnaces, printers, binder jetting) — not from whatever "Orbital" might sell
   in your imagination. `starter/prospect.atlas.json` is a worked example of exactly this
   constraint if you want a template for what to type into the form.

4. Press **Save**, then confirm `orbital` appears in the Prospects list.

5. Ask `orbital` a question that the corpus can answer. You can use the **Ask it something** tester
   on `/knowledge/` (switch the prospect switcher to `orbital` first) or the same call directly over
   `/api/v1/voice-answer` — this is a public route, you do not need the admin token for this step.

## Done when

- `GET /api/v1/prospects` (no auth) lists `orbital` alongside `progress`, `tangerine` and
  `northwind` — the form's **Save** button called exactly the same `POST /api/v1/admin/prospects`
  an API-only client would, so the record is indistinguishable from one created by curl.
- Your question to `orbital` returns `"handoff": false` and at least one citation.

Check all three in one go:

```bash
curl -s http://localhost:8099/api/v1/prospects | python3 -c '
import json, sys
keys = [p["key"] for p in json.load(sys.stdin)["items"]]
assert "orbital" in keys, f"orbital missing from {keys}"
print("PASS: orbital is registered —", keys)
'
```

```bash
curl -s -X POST http://localhost:8099/api/v1/voice-answer -H "content-type: application/json" \
  -d '{"prospect":"orbital","question":"<your question here>","conversation_id":"ex1"}' | python3 -c '
import json, sys
r = json.load(sys.stdin)
assert r["handoff"] is False, r
assert len(r["citations"]) >= 1, r
print("PASS: answered with", len(r["citations"]), "citation(s)")
'
```
