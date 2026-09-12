# Solution 4 — Force an upstream failure and prove there is no dead air

```bash
ARAG_MOCK=1 ADMIN_TOKEN=ex4-token DATA_DIR=/tmp/vb-ex4 PORT=8099 \
  VOICE_TURN_TIMEOUT_MS=1 AGENT_TOOL_TIMEOUT_MS=8000 node src/index.ts
```

```bash
curl -s -X POST http://localhost:8099/api/v1/voice-answer -H 'content-type: application/json' \
  -d '{"prospect":"progress","question":"Tell me about the Desktop Metal PureSinter furnace.","conversation_id":"ex4"}'
```

```json
{"answer":"Let me hand you over to a specialist who can help with that.","citations":[],"handoff":true,"latency_ms":{"retrieve":0,"first_token":0,"total":9},"handoff_reason":"upstream-error"}
```

The server log names exactly what happened:

```json
{"ts":"...","level":"error","msg":"arag.fail","prospect":"progress","kind":"timeout","message":"ARAG POST /ask timed out after 1 ms","conversation_id":"ex4"}
```

Acceptance check:

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

```
PASS: {'answer': 'Let me hand you over to a specialist who can help with that.', 'citations': [], 'handoff': True, 'latency_ms': {'retrieve': 0, 'first_token': 0, 'total': 9}, 'handoff_reason': 'upstream-error'}
```

Restoring the normal timeout and asking the same question answers it correctly again — the
timeout is purely a dial on how much patience the bridge has, not a permanent state:

```bash
ARAG_MOCK=1 ADMIN_TOKEN=ex4-token DATA_DIR=/tmp/vb-ex4 PORT=8099 node src/index.ts
```

## Why this works

`src/services/pipeline.ts`'s `runTurn` wraps the ARAG call in a `try/catch`:

```ts
try {
  result = await deps.clientFor(prospect).ask(body, { signal: opts.signal, timeoutMs: deps.voice.turnTimeoutMs });
} catch (err) {
  const e = err as { kind?: string; message?: string };
  deps.log.error("arag.fail", { prospect: req.prospect, kind: e.kind ?? "network", message: e.message, ... });
  return finish(prospect.handoff_msg || DEGRADE_LINE, "upstream-error", latency());
}
```

Any failure from the ARAG client — a timeout, a network error, a protocol error — lands in the
same `catch`, and the response is always the prospect's own configured `handoff_msg` (falling back
to the generic `DEGRADE_LINE` if the prospect record is somehow missing one). The caller — mid
phone call — hears a natural-sounding handoff line, not silence, not a dropped call, and not a
raw error. This is the mechanism behind the README's "Never dead air" claim, and it is
indistinguishable, from the caller's perspective, from an ordinary content-driven handoff.

## Boot-time refusal

`src/config.ts`'s `assertVoiceConfig` is checked once, at startup:

```ts
if (v.turnTimeoutMs >= v.agentToolTimeoutMs) {
  throw new Error(
    `VOICE_TURN_TIMEOUT_MS (${v.turnTimeoutMs}) must be < AGENT_TOOL_TIMEOUT_MS (${v.agentToolTimeoutMs}) ` +
      "so the bridge always resolves a turn before the agent's tool call times out.",
  );
}
```

```
Error: VOICE_TURN_TIMEOUT_MS (9000) must be < AGENT_TOOL_TIMEOUT_MS (8000) so the bridge always resolves a turn before the agent's tool call times out.
```

This is checked at boot, not per-turn, because it is a **configuration** error, not a runtime
condition — no request ever needs to discover it, and a misconfigured deployment should fail
loudly during a health check or a deploy pipeline, not silently produce dead air on the first slow
call in production. Catching it once, at the door, is strictly better than catching it (or
failing to catch it) on every single turn thereafter.
