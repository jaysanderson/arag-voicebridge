# Exercise 9 — Configure and push the ElevenLabs agent, against a mock ElevenLabs

**Goal:** take a voice agent that someone wired by hand in the ElevenLabs dashboard, bring it under
this deployment's control from Settings alone, and prove three things: the drift was real, the push
fixed exactly the fields this product owns and nothing else, and the key the tool now carries
actually authenticates a turn.

No ElevenLabs account, no credentials, no network. `starter/mock-elevenlabs.ts` speaks the six
Agents API routes the product uses (`src/services/elevenAgent.ts`'s header lists them), and
`ELEVENLABS_API_BASE` is a first-class setting whose own help text says "override for a regional
endpoint or **a test double**".

This exercise follows Exercise 7 — the key minted there is the key the agent's tool will carry.

## Task

1. **Start the mock ElevenLabs** in its own terminal. It comes pre-loaded with one agent
   (`agent_lab_1`) and one custom server tool (`tool_lab_1`), wired by hand: an old greeting, an
   old prompt, the tool pointing at a stale URL with no `X-API-Key` header at all, and a
   `turn` block (turn-taking sensitivity) that VoiceBridge does not own and must not touch.

   ```bash
   node enablement/developer-track/starter/mock-elevenlabs.ts      # :8791, xi-api-key "xi-lab"
   ```

2. **Start VoiceBridge** against the ARAG mock, in another terminal:

   ```bash
   ARAG_MOCK=1 ADMIN_TOKEN=ex9-token DATA_DIR=/tmp/vb-ex9 PORT=8099 node src/index.ts
   ```

3. Sign in as admin, then look at the agent view **before** configuring anything:

   ```bash
   curl -s -c cookies.txt -X POST http://localhost:8099/api/v1/admin/login \
     -H 'content-type: application/json' -d '{"token":"ex9-token"}'

   curl -s -b cookies.txt "http://localhost:8099/api/v1/admin/voice-agent?prospect=progress" \
     | python3 -m json.tool
   ```

   Read `remote` and `reachable`. With no ElevenLabs key configured, the product does not guess —
   it says so, and returns an empty `diff` rather than inventing one.

4. **Point the deployment at the mock**, through the settings store — not by restarting with
   environment variables:

   ```bash
   curl -s -b cookies.txt -X PATCH http://localhost:8099/api/v1/admin/settings \
     -H 'content-type: application/json' \
     -d '{"elevenlabs": {"apiKey": "xi-lab", "apiBase": "http://127.0.0.1:8791"}}'
   ```

   Read the `elevenlabs` group back afterwards. Note what `apiKey` reports and what it does not.

5. **Point the `progress` prospect at the hand-wired agent.** `PUT /api/v1/admin/prospects/{key}`
   is replace-semantics, so fetch the record, add `agent_id` and `tool_id`, and put the whole thing
   back (this is the **Voice** tab of the Prospects form, doing it by hand):

   ```bash
   curl -s -b cookies.txt http://localhost:8099/api/v1/admin/prospects/progress > /tmp/p.json
   python3 - <<'PY'
   import json
   p = json.load(open('/tmp/p.json'))
   for k in ('id', 'createdAt', 'updatedAt'): p.pop(k, None)
   p['agent_id'] = 'agent_lab_1'
   p['tool_id']  = 'tool_lab_1'
   json.dump(p, open('/tmp/put.json', 'w'))
   PY
   curl -s -b cookies.txt -X PUT http://localhost:8099/api/v1/admin/prospects/progress \
     -H 'content-type: application/json' -d @/tmp/put.json > /dev/null
   ```

6. **Mint the key the tool will carry** (or reuse the one from Exercise 7):

   ```bash
   curl -s -b cookies.txt -X POST http://localhost:8099/api/v1/admin/api-keys \
     -H 'content-type: application/json' -d '{"name":"Exercise 9 ElevenLabs tool"}' > /tmp/key.json
   ```

7. **Read the drift.** `GET /api/v1/admin/voice-agent?prospect=progress` again, and print the
   `diff` array — one row per field this product owns, each with `local`, `remote` and `matches`.
   Every mismatched row is a real difference between what this deployment needs and what a caller
   would hit today.

8. **Push.** Pass the key id so the tool's `X-API-Key` header carries that specific key:

   ```bash
   curl -s -b cookies.txt -X POST http://localhost:8099/api/v1/admin/voice-agent/push \
     -H 'content-type: application/json' \
     -d "{\"prospect\":\"progress\",\"api_key_id\":\"$(python3 -c 'import json;print(json.load(open("/tmp/key.json"))["key"]["id"])')\"}"
   ```

   Read `applied`, `created_agent` and `created_tool`, and note that the response also returns the
   updated prospect record.

9. **Check what the mock actually received and is now holding:**

   ```bash
   curl -s http://127.0.0.1:8791/__calls  | python3 -m json.tool    # every request, in order
   curl -s http://127.0.0.1:8791/__state  | python3 -m json.tool    # the agent and tool as stored
   ```

   Three things to find for yourself, all of them consequences of `DECISIONS.md` V-28 (which
   records what the *real* API refused when this integration was verified against a throwaway
   agent — the unit suite could not have found any of them):

   - the agent PATCH body carries `tool_ids` and **no** inline `tools` array;
   - every property inside the tool's `request_body_schema` carries a `description`;
   - the hand-tuned `conversation_config.turn` block, the `tts` block, the `llm` choice and the
     pre-existing `X-Trace` request header are all still there, untouched.

10. **Close the loop.** Pull the `X-API-Key` value the mock is now holding for the tool — this is
    what ElevenLabs would send on every tool call — and use it against the deployment. Compare an
    anonymous call to the same route.

## Done when

The block below pushes for itself, so if you already pushed in step 8, put the mock back to its
hand-wired starting state first — that is what its `__reset` route is for:

```bash
curl -s -X POST http://127.0.0.1:8791/__reset
```

```bash
KEY_ID=$(python3 -c 'import json;print(json.load(open("/tmp/key.json"))["key"]["id"])')

before=$(curl -s -b cookies.txt "http://localhost:8099/api/v1/admin/voice-agent?prospect=progress")
push=$(curl -s -b cookies.txt -X POST http://localhost:8099/api/v1/admin/voice-agent/push \
  -H 'content-type: application/json' -d "{\"prospect\":\"progress\",\"api_key_id\":\"$KEY_ID\"}")
after=$(curl -s -b cookies.txt "http://localhost:8099/api/v1/admin/voice-agent?prospect=progress")
state=$(curl -s http://127.0.0.1:8791/__state)

python3 - "$before" "$push" "$after" "$state" <<'PY'
import json, sys
before, push, after, state = (json.loads(a) for a in sys.argv[1:5])

assert before["in_sync"] is False, "the hand-wired agent should not already match"
drifted = [r["field"] for r in before["diff"] if not r["matches"]]
assert {"first_message", "system_prompt", "tool_url", "tool_api_key_header"} <= set(drifted), drifted

assert push["created_agent"] is False and push["created_tool"] is False, "both already existed"
assert "agent.tool_ids" in push["applied"], push["applied"]

assert after["in_sync"] is True, [r for r in after["diff"] if not r["matches"]]

agent = state["agents"]["agent_lab_1"]["conversation_config"]
assert agent["turn"] == {"turn_timeout": 7, "mode": "silence"}, "turn-taking must survive a push"
assert agent["tts"]["voice_id"] == "voice_lab_2", "tts must survive a push"
assert agent["agent"]["prompt"]["llm"] == "gpt-4o-mini", "the llm choice must survive a push"
assert "tools" not in agent["agent"]["prompt"], "the deprecated inline tools array must not be sent"

tool = state["tools"]["tool_lab_1"]["tool_config"]
assert tool["api_schema"]["url"].endswith("/api/v1/voice-answer"), tool["api_schema"]["url"]
assert set(tool["api_schema"]["request_headers"]) == {"X-API-Key", "X-Trace"}, "X-Trace must survive"
props = tool["api_schema"]["request_body_schema"]["properties"]
assert all("description" in p for p in props.values()), "every property needs a description"

print("PASS:", len(drifted), "fields had drifted;", len(after["diff"]), "now match;",
      "turn-taking, tts, llm and X-Trace all survived the push")
PY
```

```bash
# the agent's own credential, as ElevenLabs now holds it
SECRET=$(curl -s http://127.0.0.1:8791/__state | python3 -c \
  'import json,sys;print(json.load(sys.stdin)["tools"]["tool_lab_1"]["tool_config"]["api_schema"]["request_headers"]["X-API-Key"])')

anon=$(curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:8099/api/v1/voice-answer \
  -H 'content-type: application/json' \
  -d '{"prospect":"progress","question":"What is binder jetting?","conversation_id":"ex9-anon"}')
agent=$(curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:8099/api/v1/voice-answer \
  -H 'content-type: application/json' -H "X-API-Key: $SECRET" \
  -d '{"prospect":"progress","question":"What is binder jetting?","conversation_id":"ex9-agent"}')

python3 -c "
assert '$anon' == '401', 'a key exists, so anonymous should be refused: $anon'
assert '$agent' == '200', 'the agent tool carries a working key: $agent'
print('PASS: anonymous $anon, as the agent would call it $agent')
"
```

## Think about

- Step 3's response said `reachable: false` before you configured anything — and it *also* says
  `reachable: false` when ElevenLabs answers but holds neither the agent nor the tool. Read the
  handler in `src/routes/settings.ts` and work out what `reachable` actually means. Is that the
  right name for it?
- The push **merges** into what the remote already has, rather than replacing it. Work out what a
  customer who has hand-tuned turn-taking loses on every single prompt edit if it replaced instead.
- `make agent-check` does this same sequence against the *real* API, on a throwaway agent it
  creates and deletes, and refuses to run if the desired configuration names an agent the registry
  already points at. Why is that refusal in the script rather than in a code review checklist?
- The tool's URL came from `PUBLIC_URL` (falling back to `http://localhost:<port>`). What happens
  to a deployment that pushes its agent from a laptop and then deploys to Fly, and where would you
  notice?

## Clean up

```bash
# Ctrl-C both servers
rm -rf /tmp/vb-ex9 /tmp/p.json /tmp/put.json /tmp/key.json
```
