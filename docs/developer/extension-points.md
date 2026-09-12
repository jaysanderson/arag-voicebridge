# Extension points

VoiceBridge is deliberately small and the seams are intentional. This page lists where to slot in
richer behaviour without touching the pipeline's shape, and closes with the onboarding ritual for
adding a new prospect — the one workflow the whole architecture exists to make cheap.

## A real moderation classifier

`src/services/safety.ts` implements `guardInput()` and `guardOutput()` as regex checks —
deliberately "demo-grade": deterministic, fast, free, and logged, but not a content-moderation
product. They exist to make the seam obvious, not to be the last word on safety. To swap in a real
classifier:

1. Keep the `GuardResult` shape (`{ ok, deflection?, reason? }`) so `src/services/pipeline.ts`
   (steps 2 and 8) needs no change.
2. Replace the body of `guardInput`/`guardOutput` with a call to a moderation API or a local model.
   Both guards run synchronously in the turn's latency budget today; a network-calling classifier
   should get its own timeout well inside `VOICE_TURN_TIMEOUT_MS`, and should fail open or closed
   deliberately (the current regex guards fail open — a false negative just reaches the existing
   ARAG-grounding-and-handoff defence; a hung classifier should not eat the whole turn budget).
3. Extend `GuardReason` in `src/types.ts` and the `handoff_reason` enum in `src/openapi.ts` if the
   classifier introduces new reasons — the contract test `missingFromSpec()` will catch a mismatch.

## Per-prospect ARAG credentials

Today `AragClientPool` (`src/services/clientPool.ts`) gives every prospect its own `AragClient`
keyed by `kb_id|baseUrl`, but all of them share one `ARAG_API_KEY` service-account token
(`ProspectTarget` only carries `kb_id`/`region`, not a credential). To support per-prospect tokens:

1. Add a `credential_ref` (never the raw secret) field to `ProspectConfig` in `src/types.ts` and
   `ProspectInput` in `src/openapi.ts` — store the secret itself in an env var or a secrets
   manager, never in the registry JSON (the registry is a `Store` collection, not a vault).
2. Resolve the secret in `AragClientPool.for()` (`src/services/clientPool.ts`) instead of reading
   `this.deps.env.arag.apiKey`, and include the credential source in the pool's cache key so two
   prospects with different tokens against the same KB don't share a client.
3. Update `describeVoiceConfig()`/`describeEnv()`-style redaction so a new secret never leaks
   through `GET /api/v1/admin/config`.

## Another voice platform

The pipeline (`src/services/pipeline.ts`) and the public contract (`POST /api/v1/voice-answer`)
have no ElevenLabs-specific shape at all — `VoiceAnswerRequest`/`VoiceAnswerResponse` are plain
JSON. Any platform whose agent can call an HTTP tool with a JSON body and speak back a JSON string
field can front VoiceBridge: point its custom tool at `/api/v1/voice-answer` with the same
`{prospect, question, conversation_id, history}` body (see
[`examples.md`](examples.md#the-elevenlabs-agent-tool-definition)) and have it speak the `answer`
field verbatim. Only three things are ElevenLabs-specific and isolated behind their own modules:

- `src/services/scribe.ts` (Scribe realtime STT token minting) — Listen mode only.
- `src/services/voices.ts` (voice list for the Call tab's picker).
- `public/vendor/elevenlabs-client.js` (the vendored browser SDK used by the Call tab).

A different platform's realtime STT or browser SDK would live in equivalent new modules; the turn
pipeline, handoff contract, voice shaping, citations and golden-set gate are all platform-agnostic
already.

## A different store

`src/services/registry.ts`, `src/services/metrics.ts` and `src/services/goldenEval.ts` all depend
only on the platform's `Collection<T>` interface (`get/put/list/delete`, see
`vendor/arag-platform/src/store/jsonstore.ts`), not on its JSON-file implementation. To move to
Postgres/Redis at scale (see [`../architecture/scaling.md`](../architecture/scaling.md)):

1. Implement `Collection<T>` and `Store` against the new backend inside `vendor/arag-platform` (per
   `../../STANDARDS.md` §9, the platform is vendored and never edited in place — the change belongs
   upstream in the platform repo, then re-synced with `make sync-platform`).
2. Nothing in `src/services/*.ts` or `src/routes/*.ts` needs to change: they only call the
   `Collection`/`Store` interface, never touch the JSON files directly.
3. `DATA_DIR` and the Fly volume mount become irrelevant once the store is external — see
   [`../architecture/deployment-topologies.md`](../architecture/deployment-topologies.md) for what
   that changes about multi-machine deployment.

## Custom golden checks

`src/services/goldenEval.ts::checkTurn()` is a small, pure function: given a `GoldenQuestion` and a
turn's `{answer, handoff, citations}`, it returns a list of `{ok, label}` checks. To add a new
check (e.g. a minimum-length answer, a banned-phrase check, an LLM-judge quality score):

1. Add the check inside `checkTurn()` for `gq.expect === "answer"` (or unconditionally, if it
   should also apply to handoffs).
2. `GoldenCase.checks` and the admin/console UIs already render an arbitrary list of `{ok, label}`
   rows, so a new check needs no UI change — it just shows up as another row in the golden-set
   table and the admin eval detail view.
3. Keep checks deterministic where possible; the pipeline runs at `temperature: 0` by design (see
   [`../architecture/arag-integration.md`](../architecture/arag-integration.md)) specifically so
   the golden set is repeatable run to run.

## Onboarding a new prospect end to end

This is the **only** thing that should change when a new customer/demo target is added — nothing
in `src/` should need to change for it (`config/prospects.example.json` ships three worked
examples: `progress`, `tangerine`, `northwind`). If a prospect ever needs a code change, that is a
defect in the abstraction, not a one-off to work around.

### 1. Registry entry

Create the prospect through the admin panel (Prospects tab → New) or the API:

```bash
curl -s -b admin.txt -X POST $BASE/api/v1/admin/prospects \
  -H 'Content-Type: application/json' \
  -d '{
    "key": "acme",
    "config": {
      "display_name": "Acme Corp",
      "kb_id": "<the Knowledge Box id>",
      "region": "aws-us-east-2-1",
      "locale": "en-US",
      "greeting": "Hi, thanks for calling. What can I help you with?",
      "handoff_msg": "Let me hand you to a specialist who can help with that.",
      "golden_questions": []
    }
  }'
```

`key` must match `^[a-z0-9][a-z0-9_-]{1,40}$`. No redeploy needed — the registry is a `DATA_DIR`
store with admin CRUD (`DECISIONS.md` V-02), unlike the prototype's committed `prospects.json`.

### 2. Provision the stored ARAG search configuration

```bash
curl -s -b admin.txt -X POST $BASE/api/v1/admin/prospects/acme/provision \
  -H 'Content-Type: application/json' -d '{}'
```

This writes the canonical voice-answer prompt (with `{DISPLAY_NAME}`/`{LOCALE}` filled in), the
governance filters (English only, public security group, no OCR noise) and the latency levers
(`reranker`, `max_tokens`, `temperature`) into the Knowledge Box as a named `ask` search
configuration, then points the registry entry's `ask_config` at it. It is idempotent — re-running
updates the same configuration in place. Skip this step and the prospect still works: with no
`ask_config`, the pipeline builds the same prompt inline on every turn instead
(`src/services/pipeline.ts::buildAskRequest()`). Provisioning is the production path because it
keeps the request small and lets the configuration be tuned in the ARAG console directly.

### 3. Golden set

Author at least ten questions (the three shipped examples average ten to twelve) mixing answerable
questions with deliberate out-of-scope ones, each as `{q, expect: "answer"|"handoff",
must_include?: [...]}`, then run the gate:

```bash
curl -s -b admin.txt -X PUT $BASE/api/v1/admin/prospects/acme -H 'Content-Type: application/json' \
  -d @acme-with-golden-questions.json
make eval P=acme
```

Tune `reranker`/`generative_model`/the prompt and re-provision until it passes. **No prospect
demos until its golden set passes** — this is the whole point of the gate (see
[`../business/walkthrough-demo.md`](../business/walkthrough-demo.md) for what a passing/failing run
looks like in the console).

### 4. Demo gate

Confirm in the console: select the prospect, run a couple of manual questions on the Ask tab
(one answerable, one deliberately out of scope to see the handoff fire), then **Run golden set**
and confirm the gate shows "gate open". If ElevenLabs is configured, set the prospect's `agent_id`
(see [`integrations.md`](integrations.md)) and smoke-test the Call tab. A second person should be
able to repeat steps 1–4 for a new prospect with no code changes — if they can't, the bottleneck is
the ritual or the abstraction, not the prospect.
