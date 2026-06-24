# Implementation notes & deviations from the spec

The build follows [SPEC.md](SPEC.md) faithfully — same architecture, same contracts, same
nine-step bridge pipeline, same success criteria. A few **implementation choices** differ from
the brief's illustrative wording; they're recorded here so nothing is a silent surprise in review.

| Area | Spec wording | What we built | Why |
|---|---|---|---|
| HTTP server | "Node/TypeScript recommended" (§6.2); diagram shows a generic service | Node's built-in `node:http` — **no web framework** | Zero dependencies → no `npm install`, nothing to vet in a security review, smaller image. The spec recommended Node/TS but did not mandate Fastify. |
| Dependencies | implied normal npm project | **Zero runtime + zero dev dependencies** | npm is unavailable/banned in this environment; a dependency-free service is also the most faithful realisation of "a junior SE stands it up in under an hour." |
| TypeScript | "Node/TypeScript" (§12) | TS kept, executed **natively** via `node --experimental-transform-types` — no build step, no `tsc` | No toolchain to install; `.ts` runs directly. Import specifiers use `.ts` (required by Node's native loader). |
| Tests | golden-set harness (§13) + unit tests | Unit tests on Node's built-in runner (`node --test`) via a tiny `expect` shim over `node:assert`; golden harness unchanged | Same coverage, no vitest install. 43 unit tests + the golden gate. |
| Task runner | npm scripts implied | A `Makefile` (`make test`, `make dev`, `make eval`, …) | Single npm-free entry point; every target is a bare `node`/`python3` command. |

**Everything else matches the spec**, including:

- `ask-bridge` as a stateless service with the exact `POST /v1/voice-answer` request/response
  contract (§6.2.1) and the nine ordered steps (§6.2.2).
- The ARAG `/ask` NDJSON streaming client with all field-name-drift risk isolated in
  [`bridge/src/arag.ts`](../bridge/src/arag.ts) `interpretLine()` (§18).
- Voice-shaping (≤3 sentences, no URLs/markdown/markers — S5), citation extraction as data
  (S4), deterministic sentinel-based handoff (§8.4, S6), input+output safety guards (§10),
  graceful degradation with no dead air (§6.2.3), per-turn metrics + `/metrics` (§13).
- The config registry as the only per-prospect change (§6.4), the control panel with citation
  chips + latency strip + golden-set runner (§6.5), the reusable voice-answer prompt (§8), and
  the Fly.io deploy posture (§12) — the `Dockerfile`/`fly.toml` simply have nothing to install.

## Requirements

- **Node ≥ 22.6** (for native TypeScript execution via `--experimental-transform-types`).
- **Python 3** (only to serve the static control panel; any static file server works).

## What's verified locally

- `make test` → **43/43 unit tests pass** (voice-shaping, citations, handoff, safety, NDJSON
  parsing, full pipeline with an injected ARAG stub).
- Live server smoke test: `/healthz`, `/v1/prospects` (confirmed it leaks **no** `kb_id`/token),
  `/v1/voice-answer` happy + injection + unknown-prospect paths, ARAG-unreachable → graceful
  handoff (no dead air), and `/metrics` aggregation.
- `make provision … --dry-run` and `make eval` both execute on bare Node.

## What needs a live environment (M0)

- Real ARAG `/ask` against a populated KB — to confirm the exact NDJSON item-type names and
  `search_configurations` key paths (§18). Only `arag.ts` and `create-search-config.ts` touch
  those shapes.
- Real ElevenAgent clone wired to the deployed bridge — to validate latency (S1), barge-in (S2),
  turn-taking (S3), and the holding phrase end to end.
