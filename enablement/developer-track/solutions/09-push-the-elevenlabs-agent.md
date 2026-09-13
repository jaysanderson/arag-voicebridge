# Solution 9 — Configure and push the ElevenLabs agent, against a mock ElevenLabs

```bash
node enablement/developer-track/starter/mock-elevenlabs.ts &
ARAG_MOCK=1 ADMIN_TOKEN=ex9-token DATA_DIR=/tmp/vb-ex9 PORT=8099 node src/index.ts &
curl -s -c cookies.txt -X POST http://localhost:8099/api/v1/admin/login \
  -H 'content-type: application/json' -d '{"token":"ex9-token"}'
```

Every output below is a real run. The one thing normalised is the port: this was executed on a
machine where `8099` was already taken, so `8099` here stands in for whatever port you actually
start on — and it matters in exactly one place, the tool URL the push writes to the vendor, which
is built from `PUBLIC_URL` (or `http://localhost:<port>`). If your `Tool URL` row shows a different
port from the one below, that is correct, not drift.

## 3. Before anything is configured

```bash
curl -s -b cookies.txt "http://localhost:8099/api/v1/admin/voice-agent?prospect=progress" \
  | python3 -c 'import json,sys;d=json.load(sys.stdin);print("reachable",d["reachable"],"in_sync",d["in_sync"],"diff rows",len(d["diff"]));print(json.dumps(d["remote"]))'
```

```
reachable False in_sync False diff rows 0
{"agent": {"found": false, "error": "ElevenLabs is not configured"}, "tool": {"found": false}}
```

`desired` is still fully populated — the router prompt, the tool URL, the body schema are all
derivable from the registry and this deployment's own settings without touching the network
(`src/services/voiceAgent.ts` is deliberately pure). What is empty is `diff`: with nothing to
compare against, the product returns no rows rather than presenting "everything differs".

## 4. Point it at the mock, through the store

```bash
curl -s -b cookies.txt -X PATCH http://localhost:8099/api/v1/admin/settings \
  -H 'content-type: application/json' \
  -d '{"elevenlabs": {"apiKey": "xi-lab", "apiBase": "http://127.0.0.1:8791"}}' > /dev/null

curl -s -b cookies.txt http://localhost:8099/api/v1/admin/settings | python3 -c '
import json,sys
for g in json.load(sys.stdin)["groups"]:
    if g["id"] != "elevenlabs": continue
    for f in g["fields"]:
        if f["key"] in ("apiKey", "apiBase"): print(json.dumps(f))'
```

```json
{"key": "apiKey", "group": "elevenlabs", "label": "API key", "type": "secret", "env": "ELEVENLABS_API_KEY", "source": "stored", "set": true, "hint": "••••", "envSet": false, "help": "Server-side only. …"}
{"key": "apiBase", "group": "elevenlabs", "label": "API base URL", "type": "string", "env": "ELEVENLABS_API_BASE", "source": "stored", "value": "http://127.0.0.1:8791", "envValue": "https://api.elevenlabs.io", "help": "Override for a regional endpoint or a test double."}
```

Two different shapes for two different kinds of field. `apiBase` is an ordinary string, so it
reports both its effective `value` and the `envValue` it would fall back to. `apiKey` is typed
`secret`, so it has **no `value` at all** — only `set: true` and a masked `hint`. Secrets are
write-only over the API: you can set one and rotate one, and nothing in the product will read one
back to you (`DECISIONS.md` V-26). `envSet: false` is how you know this deployment's environment
never supplied one, so the stored value is the only one there is.

No restart happened here. The next ElevenLabs call in the process picked up both.

## 5–6. Wire the prospect, mint the key

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

curl -s -b cookies.txt -X POST http://localhost:8099/api/v1/admin/api-keys \
  -H 'content-type: application/json' -d '{"name":"Exercise 9 ElevenLabs tool"}' > /tmp/key.json
```

The read-modify-write is not ceremony: `PUT` is replace-semantics, so sending only `agent_id` would
delete the greeting, the handoff line and the golden set. (`id`, `createdAt` and `updatedAt` are
server-owned and must come off before the PUT.)

## 7. The drift

```bash
curl -s -b cookies.txt "http://localhost:8099/api/v1/admin/voice-agent?prospect=progress" | python3 -c '
import json,sys
d = json.load(sys.stdin)
print("reachable", d["reachable"], "in_sync", d["in_sync"])
for r in d["diff"]:
    print(("  " if r["matches"] else "x ") + r["label"].ljust(24),
          "local:", repr(r["local"][:44]), " remote:", repr(r["remote"][:44]))'
```

```
reachable True in_sync False
  Agent id                 local: 'agent_lab_1'  remote: 'agent_lab_1'
x Greeting                 local: 'Hi, thanks for calling. I can help with ques'  remote: "Hello, you've reached the lab. How can I hel"
x System prompt            local: 'You are the voice for Progress support. You '  remote: 'Be helpful and answer from what you know.'
x Tool URL                 local: 'http://localhost:8099/api/v1/voice-answer'  remote: 'https://example.invalid/v1/voice-answer'
  Tool method              local: 'POST'  remote: 'POST'
x X-API-Key header         local: 'set'  remote: 'missing'
x Tool timeout             local: '8s'  remote: '20s'
x Tool linked to the agent local: 'tool_lab_1'  remote: 'not linked'
```

Six of the eight rows differ, and every one of them is something a caller would actually hit: the
tool points at a dead host, carries no credential, allows 20 s against an 8 s turn budget, and is
not even linked to the agent — so the agent would answer from the model's own knowledge rather
than from the Knowledge Box. This is the screen a partner looks at before a demo. Note the
`X-API-Key` row says `set` / `missing`, never the secret itself; `redactSecrets()` in
`src/services/elevenAgent.ts` makes sure the diff cannot leak a credential into a screenshot.

## 8. The push

```bash
KEY_ID=$(python3 -c 'import json;print(json.load(open("/tmp/key.json"))["key"]["id"])')
curl -s -b cookies.txt -X POST http://localhost:8099/api/v1/admin/voice-agent/push \
  -H 'content-type: application/json' -d "{\"prospect\":\"progress\",\"api_key_id\":\"$KEY_ID\"}" \
  | python3 -c 'import json,sys;d=json.load(sys.stdin);print("applied:",d["applied"]);print("created_agent",d["created_agent"],"created_tool",d["created_tool"]);print("prospect.agent_api_key_id",d["prospect"]["agent_api_key_id"])'
```

```
applied: ['tool.url', 'tool.request_headers', 'tool.timeout', 'tool.body_schema', 'agent.system_prompt', 'agent.first_message', 'agent.tool_ids']
created_agent False created_tool False
prospect.agent_api_key_id key_10abb00948c73f04
```

The tool is written **before** the agent, deliberately: the agent write has to link to a tool id,
so the id has to exist first. Both already existed here, so both were patched; against an empty
account you would see `['tool.created', 'agent.created']` and the new ids written back into the
prospect record, which is how the product remembers what to compare against next time.

## 9. What the mock received

```bash
curl -s http://127.0.0.1:8791/__calls | python3 -c '
import json,sys
for c in json.load(sys.stdin)["items"]: print(c["method"], c["path"])'
```

```
GET   /v1/convai/tools/tool_lab_1
PATCH /v1/convai/tools/tool_lab_1
GET   /v1/convai/agents/agent_lab_1
PATCH /v1/convai/agents/agent_lab_1
GET   /v1/convai/agents/agent_lab_1
GET   /v1/convai/tools/tool_lab_1
```

Read before write, both times. The last two are the diff read that follows the push.

(That is the list after `curl -s -X POST http://127.0.0.1:8791/__reset` immediately before the
push. If you read the drift a few times first, the same six calls are there with the extra `GET`
pairs from each read interleaved.)

**The agent PATCH body:**

```bash
curl -s http://127.0.0.1:8791/__calls | python3 -c '
import json,sys
for c in json.load(sys.stdin)["items"]:
    if c["method"] == "PATCH" and "agents" in c["path"]:
        cc = c["body"]["conversation_config"]
        print("conversation_config keys:", sorted(cc))
        print("prompt keys:", sorted(cc["agent"]["prompt"]))
        print("tool_ids:", cc["agent"]["prompt"]["tool_ids"])'
```

```
conversation_config keys: ['agent']
prompt keys: ['prompt', 'tool_ids']
tool_ids: ['tool_lab_1']
```

Two things here are load-bearing, and both come from `DECISIONS.md` V-28 — findings from running
`make agent-check` against the **real** API on a throwaway agent, which the unit suite could not
have produced because it runs against an in-process fake with no opinion on what ElevenLabs
accepts:

- `conversation_config` carries only `agent`. Nothing about `turn`, `tts` or `asr` is sent, so a
  merge on the far side cannot disturb them.
- `prompt` carries `tool_ids` and **not** `tools`. A `GET` from the real API returns *both* the
  deprecated inline `tools` array and `tool_ids`; sending both back is refused with
  `400 Cannot specify both tools and tool IDs`. `agentPatchBody()` drops the inline copy. The mock
  reproduces that refusal — run it with `MOCK_STRICT=0` and the check goes away, which is a fast
  way to see what the failure would have looked like in production.

**The tool's body schema:**

```bash
curl -s http://127.0.0.1:8791/__state | python3 -c '
import json,sys
s = json.load(sys.stdin)["tools"]["tool_lab_1"]["tool_config"]["api_schema"]
print("url:", s["url"]); print("headers:", sorted(s["request_headers"]))
for k, v in s["request_body_schema"]["properties"].items():
    print("  %-16s description? %s" % (k, "description" in v))'
```

```
url: http://localhost:8099/api/v1/voice-answer
headers: ['X-API-Key', 'X-Trace']
  prospect         description? True
  question         description? True
  conversation_id  description? True
  history          description? True
```

`X-Trace: keep-me` — a header the product knows nothing about — is still there beside the new
`X-API-Key`. The merge goes down to the header map, not just the object. And every property carries
a `description`: the third V-28 finding was that the real API answers `422` without them.

**What survived:**

```bash
curl -s http://127.0.0.1:8791/__state | python3 -c '
import json,sys
a = json.load(sys.stdin)["agents"]["agent_lab_1"]["conversation_config"]
print("turn:", json.dumps(a["turn"]))
print("tts :", json.dumps(a["tts"]))
print("llm :", a["agent"]["prompt"]["llm"])
print("greeting:", a["agent"]["first_message"][:46])'
```

```
turn: {"turn_timeout": 7, "mode": "silence"}
tts : {"voice_id": "voice_lab_2", "model_id": "eleven_flash_v2_5"}
llm : gpt-4o-mini
greeting: Hi, thanks for calling. I can help with questio
```

The greeting is this deployment's; the turn-taking, the voice and the model choice are still
whoever configured them by hand. That is the difference between a push and a replacement, and it is
what makes "push again after every prompt edit" something an operator can do without a change
window.

## Acceptance run

```
PASS: 6 fields had drifted; 8 now match; turn-taking, tts, llm and X-Trace all survived the push
PASS: anonymous 401, as the agent would call it 200
```

## 10. The loop closed

```bash
SECRET=$(curl -s http://127.0.0.1:8791/__state | python3 -c \
  'import json,sys;print(json.load(sys.stdin)["tools"]["tool_lab_1"]["tool_config"]["api_schema"]["request_headers"]["X-API-Key"])')

curl -s -X POST http://localhost:8099/api/v1/voice-answer -H 'content-type: application/json' \
  -H "X-API-Key: $SECRET" \
  -d '{"prospect":"progress","question":"What is binder jetting?","conversation_id":"ex9-agent"}'
```

```json
{"answer":"The Desktop Metal Shop System is a binder jetting metal 3D printer built for machine shops that need production volumes. …","citations":[…],"handoff":false,"latency_ms":{"retrieve":4,"first_token":4,"total":6}}
```

The same call without the header is a `401`, because minting a key in step 6 closed the API
(Exercise 7). The header the mock is holding is a real, usable secret — which is exactly why
`ApiKeyStore` stores secrets in plaintext rather than hashing them: a hash cannot be handed to a
third party as a credential it will send back to you.

## Answers to "think about"

- **`reachable`** is computed as `agent.found || tool.found` — it means "we found something",
  not "ElevenLabs answered". Before step 4 it is `false` because the product never called; after
  step 4 against an account holding neither object it would *also* be `false`, even though the
  network round trip succeeded. The name flatters it. If you were extending this, the honest
  version distinguishes *unconfigured* / *unreachable* / *reachable but empty*, because the
  operator's next action differs in all three cases.
- **Replace instead of merge** would silently reset turn-taking sensitivity, the ASR provider and
  any evaluation criteria every time an operator edited the router prompt — a change nobody asked
  for, made by a button labelled "push prompt", discoverable only as "calls started cutting people
  off this afternoon".
- **`make agent-check`'s refusal** to touch a registry agent is in the script because a script is
  what gets run in a hurry, on the wrong shell, with the wrong `.env` loaded. A checklist item
  cannot refuse.
- **`PUBLIC_URL`** is what the tool URL is built from, falling back to `http://localhost:<port>`.
  Push from a laptop and ElevenLabs stores a `localhost` URL that resolves, on their servers, to
  their own machine — so the tool call fails silently for every caller while the agent itself looks
  perfectly healthy in the dashboard. You would notice it as "the agent answers, but never uses the
  knowledge base", which reads like a prompt problem and is not. The diff panel shows the full
  `Tool URL` for exactly this reason: read it before the demo, not after.
