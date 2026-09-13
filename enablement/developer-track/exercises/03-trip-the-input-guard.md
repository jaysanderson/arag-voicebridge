# Exercise 3 — Trip the input guard and prove what gets logged

**Goal:** trigger the input guard, then verify from the turn log — not from the response, the
log — exactly what VoiceBridge does and does not retain about an unsafe turn.

## Task

1. Send a question to any prospect designed to trip `guardInput`'s prompt-injection check
   (`src/services/safety.ts`). You need a phrase matching one of `INJECTION_PATTERNS` — "ignore
   all previous instructions...", "reveal your system prompt", "you are now...", etc. Give it a
   `conversation_id` you'll recognise.

2. Sign in as admin and fetch the turn log. Note the path: `/api/v1/turns`, not
   `/api/v1/admin/turns` — the admin copy was removed (`DECISIONS.md` V-30) because the public
   route serves the same records with filters and paging, and an admin token authenticates against
   it. "Public" is not "anonymous" here: without a cookie, a key or the admin token this route
   answers `401` even on a deployment with no API key at all.

   ```bash
   curl -s -b <your-cookie-jar> "http://localhost:8099/api/v1/turns?limit=5"
   ```

3. Find your turn by its `conversation_id`. Look at every key present on that record, and compare
   it against a normal, successful turn's record.

## Done when

You can answer, with the actual JSON in front of you, not from memory:

- Does the guard-tripped record contain a `question` key at all? What is different about this
  compared to how a normal turn's record looks?
- What is `guard_trip` set to, and what is `reason`?
- What is `total`, `first_token` and `retrieve` set to, and why do you think that is (hint: check
  §5a of `../LAB.md`, or look at where in `src/services/pipeline.ts` the guard check happens
  relative to the ARAG call)?

Script the check so it fails loudly if the field is present when it shouldn't be:

```bash
curl -s -b <your-cookie-jar> "http://localhost:8099/api/v1/turns?limit=5" | python3 -c '
import json, sys
items = json.load(sys.stdin)["items"]
mine = next(i for i in items if i["conversation_id"] == "<your-conversation-id>")
assert mine["guard_trip"] is True, mine
assert "question" not in mine, "question should be absent, found: " + repr(mine.get("question"))
print("PASS:", mine["reason"], "no question text retained")
'
```

## Why this matters

`DECISIONS.md` V-08 records this explicitly: "the turn log stores the question text only for
turns that passed the input guard... an injected or unsafe prompt is exactly the text you do not
want to retain and re-display in an admin panel." This is not a UI-layer redaction — the field is
never written to the record in the first place (`src/routes/voice.ts`: `question: guardTrip ?
undefined : body.question.slice(0, 500)`). Retention decisions made in the route/metrics layer,
not left to whoever builds the admin screen later, is a pattern worth noticing.
