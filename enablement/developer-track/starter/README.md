# Starter material

Everything here is used by `../LAB.md` and the numbered exercises. It only ever talks to the
in-process mock ARAG (`ARAG_MOCK=1`) — nothing here needs a Knowledge Box, an API key or an
ElevenLabs account.

| File | What it is |
|---|---|
| `prospect.atlas.json` | A ready-to-post prospect (`POST /api/v1/admin/prospects` body — note the `{key, config}` shape the create route takes; `PUT` takes the config flat). Adds "Atlas Additive" to the registry with two golden questions. |
| `curl.sh` | The lab's commands as a runnable script (`BASE=http://localhost:8099 bash curl.sh <step>`). Steps: `health`, `ask`, `handoff`, `guard`, `login`, `create`, `ask-atlas`, `golden`, `turns`. |
| `requests.http` | The same requests as a REST Client / Insomnia / Postman-importable `.http` file, if you prefer clicking "Send" to typing curl. |
| `mock-elevenlabs.ts` | A stand-in for the ElevenLabs Agents API, used by **Exercise 9**. Speaks the six routes the product actually calls, keeps what it is sent so a `PATCH` can be read back, records every request, and reproduces the real API's refusal of an agent write carrying both `tools` and `tool_ids`. `node mock-elevenlabs.ts` listens on `:8791`. Zero dependencies, like the product. |

## The ElevenLabs mock, briefly

It starts holding one agent (`agent_lab_1`) and one custom server tool (`tool_lab_1`), wired the way
a partner would have wired them by hand before this product existed: an old greeting and prompt, the
tool pointing at a stale URL with no `X-API-Key` header, and a `conversation_config.turn` block that
VoiceBridge does not own and must not touch. Exercise 9 brings that agent under the deployment's
control and checks that the hand-tuning survived.

Three routes exist only for the exercise and are not ElevenLabs routes: `GET /__calls` (every
request received, in order, with its body), `GET /__state` (the agents and tools it is holding) and
`POST /__reset` (back to the hand-wired starting state). `MOCK_STRICT=0` switches off its
reproduction of the `tools`-plus-`tool_ids` refusal if you want to see what that failure looks like
from the other side. Point the product at it from Settings — `ELEVENLABS_API_BASE`'s own help text
says "override for a regional endpoint or a test double" — rather than by restarting with
environment variables.

## Why "Atlas Additive" asks about binder jetting

The mock ARAG (`src/services/seed.ts`) serves the **same** eight documents about metal additive
manufacturing to every prospect, regardless of which `kb_id` is in its registry entry — in mock
mode the client pool routes every prospect to the one mock Knowledge Box
(`src/services/clientPool.ts`). That is why `prospect.atlas.json`'s golden questions are about
binder jetting rather than whatever "Atlas Additive" might really sell: against the mock, every
prospect's questions have to be answerable from that same eight-document corpus, or they will
always hand off no matter how the prospect is configured. This is also why the shipped
`tangerine` and `northwind` prospects' own golden sets **fail** under `ARAG_MOCK=1` — they are
written for their real, telco/health Knowledge Boxes, not the mock. Only `progress`'s golden set
is written to match the mock corpus. Keep this in mind when you write your own prospects for
practice: ask about furnaces, printers and binder jetting, not about your prospect's real domain.

## Running the script

```bash
# In one terminal: start the lab server (see LAB.md §1)
ARAG_MOCK=1 ADMIN_TOKEN=lab-token DATA_DIR=/tmp/voicebridge-lab PORT=8099 node src/index.ts

# In another terminal, from this directory:
BASE=http://localhost:8099 bash curl.sh health
BASE=http://localhost:8099 bash curl.sh ask
BASE=http://localhost:8099 bash curl.sh handoff
BASE=http://localhost:8099 bash curl.sh guard
BASE=http://localhost:8099 bash curl.sh login      # writes .cookies.txt next to this file
BASE=http://localhost:8099 bash curl.sh create     # adds "atlas" from prospect.atlas.json
BASE=http://localhost:8099 bash curl.sh ask-atlas
BASE=http://localhost:8099 bash curl.sh golden
BASE=http://localhost:8099 bash curl.sh turns
```

(`turns` reads `GET /api/v1/turns`. The `/api/v1/admin/turns` copy was removed in `DECISIONS.md`
V-30 — the public route carries the same records plus filters, paging and the `reasons` facet, and
the admin cookie authenticates against it.)

`.cookies.txt` is a scratch file the script writes next to itself; delete it whenever you like —
it just holds the admin session cookie from `login`.
