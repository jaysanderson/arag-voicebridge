# Solution 2 — Write a golden question that catches a real mistake

```bash
curl -s -X PUT http://localhost:8099/api/v1/admin/prospects/orbital \
  -H "Authorization: Bearer ex1-token" -H 'content-type: application/json' \
  -d '{
    "display_name": "Orbital Fabrication",
    "kb_id": "kb-orbital-demo",
    "region": "aws-us-east-2-1",
    "locale": "en-US",
    "greeting": "Hi, thanks for calling Orbital.",
    "handoff_msg": "Let me get an Orbital specialist for that.",
    "golden_questions": [
      { "q": "What is binder jetting?", "expect": "answer", "must_include": ["binder"] },
      { "q": "What materials does the PureSinter furnace support?", "expect": "answer", "must_include": ["aluminium"] }
    ]
  }'

BASE_URL=http://localhost:8099 node scripts/eval.ts orbital
```

```
━━ Orbital Fabrication (orbital) — 2 golden questions ━━
  ✓ "What is binder jetting?" (4 ms)
  ✖ "What materials does the PureSinter furnace support?" (2 ms)
      - FAIL: mentions "aluminium"
  ── 1 passed, 1 failed | latency p50=2 ms p95=4 ms

✖ GOLDEN SET FAILED — gate closed.
```

"Aluminium" is a plausible-sounding guess at a metal-printing material — and completely wrong for
this document. `src/services/seed.ts`'s PureSinter entry actually says: *"The PureSinter furnace
supports materials including stainless steel, tool steel, copper and titanium."* Fix the term and
add the handoff question:

```bash
curl -s -X PUT http://localhost:8099/api/v1/admin/prospects/orbital \
  -H "Authorization: Bearer ex1-token" -H 'content-type: application/json' \
  -d '{
    "display_name": "Orbital Fabrication",
    "kb_id": "kb-orbital-demo",
    "region": "aws-us-east-2-1",
    "locale": "en-US",
    "greeting": "Hi, thanks for calling Orbital.",
    "handoff_msg": "Let me get an Orbital specialist for that.",
    "golden_questions": [
      { "q": "What is binder jetting?", "expect": "answer", "must_include": ["binder"] },
      { "q": "What materials does the PureSinter furnace support?", "expect": "answer", "must_include": ["titanium"] },
      { "q": "What is the weather like today?", "expect": "handoff" }
    ]
  }'

BASE_URL=http://localhost:8099 node scripts/eval.ts orbital; echo "exit code: $?"
```

```
━━ Orbital Fabrication (orbital) — 3 golden questions ━━
  ✓ "What is binder jetting?" (3 ms)
  ✓ "What materials does the PureSinter furnace support?" (2 ms)
  ✓ "What is the weather like today?" (1 ms)
  ── 3 passed, 0 failed | latency p50=2 ms p95=3 ms

✓ GOLDEN SET PASSED — gate open.
exit code: 0
```

## Why this works, and the "think about" answers

`must_include` is checked with `r.answer.toLowerCase().includes(term.toLowerCase())` in
`checkTurn` (`src/services/goldenEval.ts`) — a plain substring check against the exact spoken
answer, nothing fuzzier. That is deliberately unforgiving: if you write a golden question against
what you *assume* the document says rather than what it actually says, it fails, loudly, with the
exact check that failed named in the output (`"FAIL: mentions \"aluminium\""`) rather than a bare
pass/fail. This is what makes golden questions worth writing carefully — they are only as good as
your own knowledge of the corpus.

**Why "answer" questions carry more checks than "handoff" questions:** look at `checkTurn` — every
question gets exactly one check (`behaviour expected=... got=...`), but only `expect: "answer"`
questions get the additional four-or-more checks (grounding, no URLs, no markers, sentence count,
plus any `must_include` terms). That asymmetry is intentional: an "answer" question is asserting
something rich — *this specific claim, grounded, spoken correctly* — while a "handoff" question is
only asserting the single, cheaper, more important safety property: *the bridge correctly refused
to guess.* There is nothing further to check about a handoff's content, because a handoff's
content is always the prospect's own fixed `handoff_msg` — the interesting behaviour to verify is
that the pipeline chose to say it at all, not what it said.
