# Solution 10 — Compare two versions of a brief and say what changed

```bash
ARAG_MOCK=1 ADMIN_TOKEN=ex10-token DATA_DIR=/tmp/vb-ex10 PORT=8099 node src/index.ts &

SID=$(curl -s -X POST http://localhost:8099/api/v1/listen/sessions \
  -H 'content-type: application/json' -d '{"prospect":"progress"}' \
  | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')
```

**Turn one — no mention of money:**

```bash
curl -s -X POST "http://localhost:8099/api/v1/listen/sessions/$SID/transcript" \
  -H 'content-type: application/json' \
  -d '{"chunks":[{"speaker":"caller","text":"We machine stainless steel manifolds in house and the sintering furnace route looks interesting"}]}' > /dev/null
sleep 2
curl -s -X POST "http://localhost:8099/api/v1/listen/sessions/$SID/refresh" \
  -H 'content-type: application/json' -d '{}' \
  | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d["briefVersion"], d["brief"]["stage"])'
```

```
2 exploring
```

**Turn two — the caller asks for a price:**

```bash
curl -s -X POST "http://localhost:8099/api/v1/listen/sessions/$SID/transcript" \
  -H 'content-type: application/json' \
  -d '{"chunks":[{"speaker":"caller","text":"What would that cost us, can you put a quote together for the printer and the furnace"}]}' > /dev/null
sleep 2
curl -s -X POST "http://localhost:8099/api/v1/listen/sessions/$SID/refresh" \
  -H 'content-type: application/json' -d '{}' \
  | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d["briefVersion"], d["brief"]["stage"])'
```

```
4 evaluating
```

Four versions from two turns, not two. Each append starts a refresh of its own *and* the explicit
`POST .../refresh` runs another — a detail worth noticing before you write a diff, because it is
why "compare the last two versions" is usually the least interesting comparison available.

**The history:**

```bash
curl -s "http://localhost:8099/api/v1/listen/sessions/$SID/brief-history" | python3 -c '
import json,sys
for i in json.load(sys.stdin)["items"]:
    print("v%d at %s  latencyMs %-3s stage=%s" % (i["version"], i["at"], i["latencyMs"], i["brief"]["stage"]))'
```

```
v1 at 2026-09-13T08:49:02.812Z  latencyMs 14  stage=exploring
v2 at 2026-09-13T08:49:04.832Z  latencyMs 4   stage=exploring
v3 at 2026-09-13T08:49:06.385Z  latencyMs 55  stage=evaluating
v4 at 2026-09-13T08:49:06.886Z  latencyMs 2   stage=evaluating
```

The call changed its shape between **v2 and v3** — a second and a half, not the whole call. That is
the answer a supervisor is actually after, and it is legible here because every version kept its own
timestamp rather than the session keeping only "last updated".

**The diff:**

```bash
curl -s "http://localhost:8099/api/v1/listen/sessions/$SID/brief-history" | python3 -c '
import json, sys
items = json.load(sys.stdin)["items"]
first, latest = items[0]["brief"], items[-1]["brief"]

def classify(a, b):
    if a == b: return "unchanged"
    if a is None: return "new"
    if b is None: return "dropped"
    return "changed"

for k in sorted(set(first) | set(latest)):
    kind = classify(first.get(k), latest.get(k))
    if kind == "unchanged": continue
    print("%-12s %-10s %r -> %r" % (k, kind, first.get(k), latest.get(k)))'
```

```
stage        changed    'exploring' -> 'evaluating'
```

## Acceptance run

```
PASS: v1 -> v4, 1 of 9 fields moved: {'stage': 'changed'}
```

## 7. The same thing on screen

`http://localhost:8099/conversations/?id=$SID`, then **Compare two versions**:

- It opens on **v2 → v4**, not v3 → v4. `wireCompare` (`public/app/conversations.js`) walks
  backwards from the latest version until it finds one that actually differs from it, and starts
  there. Opening on the last two would have shown "0 fields moved" — v3 and v4 are identical,
  because a deferred refresh very often fires on a window nothing new has entered. A comparison
  panel whose default answer is "nothing happened" is a form, not an answer.
- The count reads **1 field moved**, matching the diff above.
- **What moved** shows the single `stage` row. **Every field** shows all nine, each labelled
  `unchanged`, `changed`, `new` or `dropped` — in words, next to the colour, so the labels survive
  a screenshot, a colour-blind reader and a printed handover note.

## Why this works

`ListenService.refresh` appends to `briefHistory` **only when the result is usable**
(`isUsableBrief`): a refresh that came back empty, or failed, increments `stats.failures`, emits
`status: "skipped"` over SSE and leaves the previous brief and the history exactly as they were
(`DECISIONS.md` V-24). So the history is a record of what was actually shown to a human, not a
record of every attempt — which is the right shape for a review, and the reason a gap in the
version timestamps is a real signal rather than noise.

The single field that moved is the design, not a limitation of the mock. Every refresh sends three
things: the rolling ~28-word window, the running transcript of final entries, and `prev` — the
session's own previous brief. The brief prompt is written to *revise* what it already inferred
using the new window, rather than re-derive the caller's profile and goal from scratch each time. A
brief that restarted every 1.5 seconds would churn every field on every refresh, and the diff you
just wrote would be useless: everything would always have "changed", so nothing would stand out.
Here, `caller_profile`, `their_goal`, `key_points`, `suggested_questions`, `suggested_answers`,
`recommended_products`, `summary` and `topic` held still, and the one thing that genuinely moved —
the caller crossing from *exploring* to *evaluating* the moment they asked for a quote — is the
whole content of the comparison.

Per-version `latencyMs` answers a different question from `stats.p95LatencyMs`: the percentile tells
you whether this session was slow, the per-version number tells you *which refresh* was slow and
what the brief looked like immediately before and after it. When the complaint is "the brief was
wrong for about thirty seconds in the middle of that call", the session-level percentile cannot
help and the history can.

`GET /api/v1/listen/sessions/{id}/brief-history` is `auth: "api"`, not admin — the same posture as
reading the session itself. On a deployment with no active API key that means anyone who can reach
the host and guess an id can read every version of a real customer's brief. Exercise 7 is how you
close that, and `../../architect-track/design-review-checklist.md` treats "who may read a session"
as its own go-live line item for exactly this reason.
