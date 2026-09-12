# Exercise 1 — Add a prospect that answers

**Goal:** register a new prospect through the admin API and get it to answer a real question,
without touching any file under `src/`.

## Task

1. Start the server against the mock, on a port of your choosing (avoid 8080 if something else is
   already using it):

   ```bash
   ARAG_MOCK=1 ADMIN_TOKEN=ex1-token DATA_DIR=/tmp/vb-ex1 PORT=8099 node src/index.ts
   ```

2. Sign in as admin and create a new prospect called `orbital`, with:
   - a `display_name`, `locale`, `greeting` and `handoff_msg` of your choosing
   - a `kb_id` and `region` (any values — under `ARAG_MOCK=1` they are never actually used to
     route the request, but the registry still requires them to be present)
   - at least one `golden_questions` entry

   Remember: the mock ARAG serves the same 8-document additive-manufacturing corpus
   (`src/services/seed.ts`) to **every** prospect, so `orbital`'s question has to be answerable
   from that corpus (furnaces, printers, binder jetting) — not from whatever "Orbital" might sell
   in your imagination. `starter/prospect.atlas.json` is a worked example of exactly this
   constraint if you want a template.

3. Ask `orbital` a question that the corpus can answer, over `/api/v1/voice-answer` — this is a
   public route, you do not need the admin token for this step.

## Done when

- `POST /api/v1/admin/prospects` returned `201 Created` with a `Location` header pointing at
  `/api/v1/admin/prospects/orbital`.
- `GET /api/v1/prospects` (no auth) lists `orbital` alongside `progress`, `tangerine` and
  `northwind`.
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
