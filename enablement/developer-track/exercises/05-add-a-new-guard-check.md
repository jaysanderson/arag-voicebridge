# Exercise 5 — Add a guard that blocks a card number before it reaches ARAG

**Goal:** add a new, narrow, deterministic input-guard pattern — different from the one you saw
demonstrated in `../LAB.md` §6 — and prove it does not cause false positives on ordinary
questions.

## Task

A caller might read out what looks like a card number while asking an unrelated question (people
do this on real support calls, usually by mistake). `src/services/safety.ts`'s `guardInput` should
never forward that text to ARAG at all — not because ARAG would misuse it, but because a Knowledge
Box request, and everything downstream of it (logs, traces, a stored search configuration's
history), is not somewhere you want a live PAN-shaped number to end up.

1. Add a new pattern to `OUT_OF_SCOPE_PATTERNS` in `src/services/safety.ts` that matches a
   13–16-digit sequence, optionally grouped with spaces or dashes (a naive card-number shape —
   this is intentionally not real Luhn validation, just enough to stop a spoken-out number
   reaching ARAG).

2. Add two tests to `test/safety.test.ts`:
   - a positive case: a sentence containing something that looks like a card number is rejected
     with `reason: "unsafe-request"`.
   - a **negative** case: an ordinary sentence about payment (e.g. "How do I update my payment
     details?") is still accepted. This is the important half of the exercise — a guard that
     blocks too much is as much a bug as one that blocks too little.

3. Run `make test` and confirm both new tests pass and nothing else broke.

4. Restart the server and confirm both cases live.

## Done when

```bash
# 1. the card-number-shaped question never reaches ARAG
curl -s -X POST http://localhost:8099/api/v1/voice-answer -H 'content-type: application/json' \
  -d '{"prospect":"progress","question":"My card number is 4111 1111 1111 1111, can you check my order?","conversation_id":"ex5-block"}' \
  | python3 -c '
import json, sys
r = json.load(sys.stdin)
assert r["handoff_reason"] == "unsafe-request", r
assert r["citations"] == [], r
print("PASS: blocked before ARAG,", r["handoff_reason"])
'

# 2. an ordinary payment question still works normally (no false positive)
curl -s -X POST http://localhost:8099/api/v1/voice-answer -H 'content-type: application/json' \
  -d '{"prospect":"progress","question":"How do I update my payment details?","conversation_id":"ex5-allow"}' \
  | python3 -c '
import json, sys
r = json.load(sys.stdin)
assert r["handoff_reason"] != "unsafe-request", r
print("PASS: not blocked,", r.get("handoff_reason", "answered"))
'
```

(The second check will still show a handoff — the mock corpus has nothing about payments, so it
hands off via the normal `no-retrieval`/`sentinel` path, not the guard. The point is `reason` is
**not** `"unsafe-request"`: the question reached ARAG and was judged on its merits, it just had
nothing to retrieve.)

## Think about

Why is a whitelist ("only forward text matching a known-safe shape") the wrong design here, when a
blocklist of specific dangerous shapes is what the rest of `guardInput` already does? What would a
whitelist break for a legitimate support conversation?
