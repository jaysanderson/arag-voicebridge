# ARAG × ElevenAgents — Voice Demo

A repeatable, world-class **conversational voice demo** over **Progress Agentic RAG (ARAG)**.

> Voice → grounded, cited, governed ARAG answer → voice — plus a control panel that
> re-points the whole thing at a new prospect with a **config change, not a code change**.

This repo is a **demo factory**. Standing up a cited, governed, interruptible voice agent over
any prospect's knowledge box should take a junior SE **under an hour**.

---

## Architecture (one paragraph)

A **cascade voice pipeline**: ElevenAgents owns the voice transport (STT, turn-taking, TTS);
**ARAG owns the retrieval-and-answer slot**, reached through a thin streaming **webhook**
(`ask-bridge`) that calls ARAG's `/ask` endpoint. This is deliberately **not** an MCP
integration — ARAG's MCP server exposes retrieval only, and we want ARAG's *composed, cited,
governed* answer. See [docs/SPEC.md](docs/SPEC.md) for the full specification and the ADRs
behind every decision.

```
User  ──audio──▶  ElevenAgent  ──POST /v1/voice-answer──▶  ask-bridge  ──POST /ask──▶  ARAG
      ◀──audio──               ◀──{answer,citations,…}──               ◀──NDJSON───
```

---

## Repo layout

| Path | What it is |
|---|---|
| [`bridge/`](bridge) | **`ask-bridge`** — the stateless Node/TypeScript service. The only meaningful code we write. |
| [`bridge/config/prospects.json`](bridge/config/prospects.json) | The **config registry** — one entry per prospect. The only thing that changes per prospect. |
| [`client/`](client) | Static **control panel + voice console** (prospect selector, transcript, citation chips, latency strip). |
| [`scripts/`](scripts) | `create-search-config` (provision an ARAG stored `ask` config) and `golden-eval` (the golden-question gate). |
| [`docs/`](docs) | [SPEC](docs/SPEC.md), [ONBOARDING](docs/ONBOARDING.md), [voice-answer prompt](docs/voice-answer-prompt.md), [ElevenAgent template](docs/elevenagent-template.md), [implementation notes/deviations](docs/IMPLEMENTATION.md). |
| [`Makefile`](Makefile) | The npm-free task runner: `make test`, `make dev`, `make client`, `make eval`, `make provision`. |

---

## Quick start

> **No install step. No npm.** The bridge is dependency-free — it runs on the Node standard
> library with TypeScript executed natively (`node --experimental-transform-types`). You only
> need **Node ≥ 22.6** and (for the client) Python 3. A `Makefile` wraps every command.

```bash
# 1. Configure secrets (server-side only; never committed)
cp .env.example bridge/.env        # fill in ARAG_TOKEN etc.

# 2. Verify it works — runs the full test suite (43 tests, zero deps)
make test

# 3. Run the bridge (hot-reload)
make dev                           # http://localhost:8080

# 4. Serve the control panel
make client                        # http://localhost:5173

# 5. Smoke-test the bridge directly
curl -s localhost:8080/v1/voice-answer \
  -H 'content-type: application/json' \
  -d '{"prospect":"tangerine","question":"How do I change my plan?","conversation_id":"c1","history":[]}'
```

Other targets: `make start` (production), `make eval P=tangerine` (golden-set gate),
`make provision P=tangerine ARGS="--dry-run"` (provision an ARAG stored config). Run `make help`
for the full list. Everything also works as plain `node --experimental-transform-types …` if you
prefer not to use `make`.

See [docs/ONBOARDING.md](docs/ONBOARDING.md) for the ~30–60 min per-prospect ritual.

---

## The contract that makes this work

1. **The agent speaks ARAG's answer verbatim.** No agent-side re-summarisation (that re-introduces
   hallucination and doubles latency). The agent is a router + voice persona; the *answer* is ARAG's.
2. **Voice-shaped answers.** ≤ 3 sentences, no URLs, no markdown. Citations are returned as **data**
   and rendered in the UI — never spoken.
3. **Deterministic handoff.** A contract between the voice-answer prompt and the bridge (a sentinel),
   not a fuzzy heuristic. When the KB doesn't cover a question, the agent hands off — on purpose.
4. **Governance is the north star.** Citations + security-filtered retrieval + clean handoff are the
   reason a prospect picks ARAG over a generic voice bot. If the demo doesn't make those three
   *audible and visible*, we're demoing against a free feature and we lose.

---

## Status

Build complete and **locally verified** against `docs/SPEC.md` v1.0:

- **43/43 unit tests pass** (`make test`) — voice-shaping, citations, handoff, safety, NDJSON
  parsing, and the full turn pipeline with an injected ARAG stub.
- Live server smoke-tested: every route, the input/output guards, and the ARAG-unreachable →
  graceful-handoff degradation path (no dead air).
- **Dependency-free** — no `npm install`, no build step. Runs on Node ≥ 22.6 (native TypeScript).
  See [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md) for the deviations from the spec brief and why.

The one thing left for M0 (needs a live KB): confirm exact NDJSON item-type names and
`search_configurations` key paths against
<https://docs.rag.progress.cloud/docs/rag/advanced/ask> — the request/response **shapes** are
correct; field-name drift is isolated in [`bridge/src/arag.ts`](bridge/src/arag.ts).
