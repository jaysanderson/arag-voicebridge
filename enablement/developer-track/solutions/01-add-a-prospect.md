# Solution 1 — Add a prospect that answers

```bash
ARAG_MOCK=1 ADMIN_TOKEN=ex1-token DATA_DIR=/tmp/vb-ex1 PORT=8099 node src/index.ts &

curl -s -c cookies.txt -X POST http://localhost:8099/api/v1/admin/login \
  -H 'content-type: application/json' -d '{"token":"ex1-token"}'

curl -s -b cookies.txt -X POST http://localhost:8099/api/v1/admin/prospects \
  -H 'content-type: application/json' -d '{
    "key": "orbital",
    "config": {
      "display_name": "Orbital Fabrication",
      "kb_id": "kb-orbital-demo",
      "region": "aws-us-east-2-1",
      "locale": "en-US",
      "greeting": "Hi, thanks for calling Orbital.",
      "handoff_msg": "Let me get an Orbital specialist for that.",
      "golden_questions": [
        { "q": "What is binder jetting?", "expect": "answer", "must_include": ["binder"] }
      ]
    }
  }'
```

```
HTTP/1.1 201 Created
Location: /api/v1/admin/prospects/orbital
{"id":"orbital","display_name":"Orbital Fabrication", ...}
```

```bash
curl -s -X POST http://localhost:8099/api/v1/voice-answer -H 'content-type: application/json' \
  -d '{"prospect":"orbital","question":"What is binder jetting?","conversation_id":"ex1"}'
```

```json
{
  "answer": "The Desktop Metal Shop System is a binder jetting metal 3D printer built for machine shops that need production volumes. Desktop Metal printers in this family print stainless steel parts in batches rather than one at a time.",
  "citations": [
    {"title": "Desktop Metal Shop System", "url": "", "score": 1},
    {"title": "Binder jetting explained", "url": "", "score": 1},
    {"title": "Binder jetting versus laser powder bed fusion", "url": "", "score": 1},
    {"title": "Post-processing printed metal parts", "url": "", "score": 0.5}
  ],
  "handoff": false,
  "latency_ms": {"retrieve": 3, "first_token": 3, "total": 3}
}
```

## Why this works

`POST /api/v1/admin/prospects` writes straight into `DATA_DIR/prospects.json` via
`ProspectRegistry.create` (`src/services/registry.ts`) — there is no in-memory registry to reload
and no redeploy, because the registry itself **is** the store (`DECISIONS.md` V-02). The moment
the write succeeds, `POST /api/v1/voice-answer` for `"prospect":"orbital"` resolves through
`deps.registry.require("orbital")` in `src/routes/voice.ts`, and the same nine-step pipeline runs
for it as for `progress`. Nothing about `runTurn` (`src/services/pipeline.ts`) knows or cares
whether a prospect was seeded at boot or created ten seconds ago by a curl command — that
uniformity is the entire point of keeping "which prospect" as data, not as a compile-time branch.

The `kb_id` you supplied (`kb-orbital-demo`) is never actually dereferenced while `ARAG_MOCK=1`:
`AragClientPool.for()` (`src/services/clientPool.ts`) checks `this.deps.mock` first and, if set,
routes **every** prospect to the one mock Knowledge Box regardless of its own `kb_id`. That is
also why the question has to be about the shared 8-document corpus (`src/services/seed.ts`)
rather than anything specific to "Orbital" — see `starter/README.md` for the longer version of
this same point, and why the shipped `tangerine`/`northwind` golden sets fail under the mock for
exactly this reason.
