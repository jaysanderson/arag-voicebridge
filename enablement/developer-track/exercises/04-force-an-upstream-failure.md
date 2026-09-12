# Exercise 4 — Force an upstream failure and prove there is no dead air

**Goal:** make the ARAG call itself fail, and confirm the turn still returns something speakable,
within budget, with the correct reason recorded.

## Task

You cannot make the in-process mock error on demand from the outside, so instead you'll shrink the
turn's own timeout budget until the mock cannot possibly answer in time.

1. Stop your server and restart it with an impossibly small `VOICE_TURN_TIMEOUT_MS`. It still has
   to satisfy `assertVoiceConfig` in `src/config.ts` — `VOICE_TURN_TIMEOUT_MS` must stay below
   `AGENT_TOOL_TIMEOUT_MS` or the server refuses to boot at all:

   ```bash
   ARAG_MOCK=1 ADMIN_TOKEN=ex4-token DATA_DIR=/tmp/vb-ex4 PORT=8099 \
     VOICE_TURN_TIMEOUT_MS=1 AGENT_TOOL_TIMEOUT_MS=8000 node src/index.ts
   ```

2. Ask any question of any prospect.

3. Read the server's own log for the line that explains what actually happened upstream — it is
   at `level: "error"`, `msg: "arag.fail"`.

## Done when

- The HTTP response is still `200 OK` with a JSON body — never a 5xx, never a hung connection.
- `handoff_reason` is `"upstream-error"`.
- `latency_ms.total` is small (single-digit-to-low-double-digit milliseconds) — well inside
  `AGENT_TOOL_TIMEOUT_MS` — confirming the caller would not have heard dead air.
- The server log has exactly one `arag.fail` line for your request, with `"kind":"timeout"`.

```bash
RESP=$(curl -s -X POST http://localhost:8099/api/v1/voice-answer -H 'content-type: application/json' \
  -d '{"prospect":"progress","question":"Tell me about the Desktop Metal PureSinter furnace.","conversation_id":"ex4"}')
echo "$RESP" | python3 -c '
import json, sys
r = json.load(sys.stdin)
assert r["handoff_reason"] == "upstream-error", r
assert r["handoff"] is True, r
print("PASS:", r)
'
```

Now try the opposite experiment: set `VOICE_TURN_TIMEOUT_MS=6000` (the shipped default) back and
confirm the same question now answers normally. This is the point — the timeout is a dial, not a
bug, and the pipeline behaves correctly at either end of it.

## Restore before moving on

```bash
# Ctrl-C, then restart with the normal timeout (or just omit VOICE_TURN_TIMEOUT_MS)
ARAG_MOCK=1 ADMIN_TOKEN=ex4-token DATA_DIR=/tmp/vb-ex4 PORT=8099 node src/index.ts
```

## Think about

`src/config.ts`'s `assertVoiceConfig` refuses to let the server start at all if
`VOICE_TURN_TIMEOUT_MS >= AGENT_TOOL_TIMEOUT_MS`. Try setting `VOICE_TURN_TIMEOUT_MS=9000` with
the default `AGENT_TOOL_TIMEOUT_MS=8000` and see what happens at boot. Why is this checked once,
at startup, rather than left as a possible per-turn failure mode? (See `architect-track/WORKSHOP.md`
for the deployment-level version of this same question.)
