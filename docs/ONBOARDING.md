# Per-prospect onboarding ritual (~30–60 min)

This is the **variable** part of the demo factory (SPEC §11). Nothing here touches bridge code —
if a prospect ever requires a code change, that's a defect in the abstraction; fix the abstraction.

> **Fixed (built once, never touched per prospect):** ElevenAgent template, `ask-bridge`,
> voice-answer prompt, control panel, observability.

---

## Prerequisites (once)

- **Node ≥ 22.6** and **Python 3**. No `npm install` — the bridge is dependency-free.
- `ARAG_TOKEN` for the target ARAG account, exported in your shell (never committed).
- The bridge running locally or deployed: `make dev` (from repo root).
- The control panel served: `make client` (serves at <http://localhost:5173>).

---

## Step 1 — Ingest the prospect's content into a KB

Create (or reuse) an ARAG knowledge box and ingest the prospect's **public** content. Note the
`kb_id` and the `region` (e.g. `europe-1`). Keep the KB to public material for the demo.

## Step 2 — Create the stored `ask` search configuration

```bash
ARAG_TOKEN=… make provision P=<prospect> ARGS="--reranker noop --model <fast-model>"
# preview without sending (no token needed):
make provision P=<prospect> ARGS="--dry-run"
```

This injects the canonical voice-answer prompt (`scripts/voice-answer-prompt.txt`) with the
prospect's `display_name`/`locale` filled in, plus the governance filters and latency levers
(`noop` reranker, a fast generative model). Start with `noop`; only switch to `--reranker predict`
if the golden set shows quality needs it (SPEC §6.3.2, §9).

## Step 3 — Add a config registry entry

Add the prospect to [`bridge/config/prospects.json`](../bridge/config/prospects.json):

```json
"<prospect>": {
  "display_name": "…",
  "kb_id": "…",
  "region": "europe-1",
  "ask_config": "<prospect>_voice",
  "agent_id": "elevenagent_…",
  "voice_id": "elevenlabs_voice_…",
  "locale": "en-AU",
  "greeting": "…",
  "handoff_msg": "…",
  "golden_questions": [ { "q": "…", "expect": "answer", "must_include": ["…"] } ]
}
```

Then hot-reload the bridge (no redeploy): `curl -XPOST $BRIDGE_URL/admin/reload`.

> `ask_config` **must** match the name you provisioned in step 2 (`<prospect>_voice`).

## Step 4 — Clone the ElevenAgent template

Clone the fixed agent template (see [elevenagent-template.md](elevenagent-template.md)); change only:

- **voice** (`voice_id`), **greeting**, **locale**, and
- the **`voice-answer` tool's `prospect` argument** → this prospect's registry key.

Paste the resulting `agent_id` (and `voice_id`) back into the registry entry and reload.

## Step 5 — Author ≥ 20 golden questions & run the gate

Author at least 20 questions in the registry entry (mix of answerable + deliberate handoffs).
Run the gate against the running bridge:

```bash
BRIDGE_URL=http://localhost:8080 make eval P=<prospect>
```

Tune `--reranker` / `--model` / the prompt until it passes. **No prospect demos until its golden
set passes** (SPEC §13).

## Step 6 — Smoke-test the three demo moments

1. **Barge-in** — interrupt mid-answer; TTS must halt ≤ 200 ms (S2).
2. **Follow-up** — ask a context-dependent follow-up ("and how much does *that* cost?").
3. **Handoff** — ask something deliberately out of the KB; confirm the handoff line fires (S6).

---

## Done

A second person should be able to repeat steps 1–6 for a new prospect in ≤ 60 minutes using
config only (S8). If they can't, the bottleneck is the ritual or the abstraction — log it and fix it.
