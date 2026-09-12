# Starter material

Everything here is used by `../LAB.md` and the numbered exercises. It only ever talks to the
in-process mock ARAG (`ARAG_MOCK=1`) — nothing here needs a Knowledge Box, an API key or an
ElevenLabs account.

| File | What it is |
|---|---|
| `prospect.atlas.json` | A ready-to-post prospect (`POST /api/v1/admin/prospects` body). Adds "Atlas Additive" to the registry with two golden questions. |
| `curl.sh` | The lab's commands as a runnable script (`BASE=http://localhost:8099 bash curl.sh <step>`). Steps: `health`, `ask`, `handoff`, `guard`, `login`, `create`, `ask-atlas`, `golden`, `turns`. |
| `requests.http` | The same requests as a REST Client / Insomnia / Postman-importable `.http` file, if you prefer clicking "Send" to typing curl. |

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

`.cookies.txt` is a scratch file the script writes next to itself; delete it whenever you like —
it just holds the admin session cookie from `login`.
