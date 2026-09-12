# Contributing

Full contribution mechanics — branching, commit style, PR checklist, issue templates — live in
[`../../CONTRIBUTING.md`](../../CONTRIBUTING.md). This page adds the rules specific to what makes
VoiceBridge a *product* rather than a script, on top of that.

## Spec first

Every `/api/v1` route is described in `src/openapi.ts` **before** it is implemented. The contract
test `missingFromSpec()` fails the build if a registered route is missing from the document, and
`lintSpec()` checks every operation has an `operationId`, `tags`, `summary` and documented error
responses via `standardResponses`. If you are adding or changing a route, edit `src/openapi.ts`
first, then the route handler, then run `make test` to confirm the contract and integration tests
agree with each other.

`docs/developer/api-reference.md` is generated from that same document (`make docs`) — never
hand-edit it. If your change alters the public API surface, regenerate it and include the diff in
your PR.

## The golden set must stay green

`src/services/pipeline.ts` is the one code path every voice turn takes, live or in a golden eval —
`runGoldenEval()` calls the exact same `runTurn()` the `/api/v1/voice-answer` route does. Any
change to the pipeline, the handoff contract (`src/services/handoff.ts`), the voice-answer prompt
(`src/services/voicePrompt.ts`), or voice shaping (`src/services/voiceShape.ts`) must keep every
shipped prospect's golden set passing:

```bash
make dev            # in one terminal, with ARAG_MOCK=1 (the default without live credentials)
make eval P=progress
make eval P=tangerine
make eval P=northwind
```

If a change legitimately needs to change expected behaviour (a new handoff reason, a different
sentence limit), update the affected golden questions in `config/prospects.example.json` in the
same PR and say so in the PR description — a golden set that silently stops testing what it used to
test is worse than one that fails loudly.

## Never edit `vendor/`

`vendor/arag-platform/` is a vendored copy of the shared platform toolkit (`App`, `AragClient`,
`Store`, `JobManager`, the mock ARAG server, the UI kit) — see `../../STANDARDS.md` §9. It is
synced with `make sync-platform` from the platform repo and is never hand-edited in place: a local
edit here would be silently overwritten by the next sync and would not benefit any other product
built on the same platform. If you find a bug or a missing capability in the platform layer while
working on VoiceBridge, fix it upstream in the platform repo, bump `PLATFORM_VERSION`, and re-sync
— do not patch `vendor/arag-platform/` directly, even temporarily.

## Everything else

Zero runtime dependencies unless a `../../DECISIONS.md` entry explains why; `bun` for tooling,
never `npm`; `make check` (Biome, `tsc --noEmit`, ≥ 80% coverage) green before opening a PR; update
`CHANGELOG.md` in the same change. See [`local-dev.md`](local-dev.md) for the full command
reference and [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md) for the workflow and commit-message
conventions.
