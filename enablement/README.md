# VoiceBridge enablement

Two tracks, each sized to a **half day**, each running entirely against the in-process mock ARAG
(`ARAG_MOCK=1`) — no Knowledge Box, no API key, no ElevenLabs account, no network. Every command in
both tracks was executed against a running server while it was written; where a response is quoted,
it is what the server actually returned.

| Track | For | Shape | Time |
|---|---|---|---|
| [`developer-track/`](developer-track/) | engineers who will extend, integrate with or operate the product | a guided lab, eleven independent exercises with runnable acceptance checks and worked solutions, a knowledge check | ≈ 3 h 30 m |
| [`architect-track/`](architect-track/) | architects and technical leads evaluating or deploying it for a customer | a workshop, a sizing and deployment guide, a go-live design-review checklist, a knowledge check | ≈ 3 h 40 m |

Run them in either order. They overlap deliberately at three points — the turn budget, the settings
store and the API-key store — and say different things about each: the developer track asks *how
does this behave*, the architect track asks *what does this commit us to*.

## Developer track

| | | Time |
|---|---|---|
| [`LAB.md`](developer-track/LAB.md) | eight sections: run it against the mock, listening end to end, the anatomy of a turn, multi-tenancy, the golden gate, breaking it on purpose, extending the pipeline, and a tour of the workspace those calls surface in | 85–100 min |
| [`exercises/`](developer-track/exercises/) + [`solutions/`](developer-track/solutions/) | eleven short, independent exercises, each with a scripted acceptance check | 70 min for five or six |
| [`starter/`](developer-track/starter/) | a ready-to-post prospect, the lab's commands as a script, a `.http` file, and a mock ElevenLabs Agents API | — |
| [`knowledge-check.md`](developer-track/knowledge-check.md) | 29 questions with answers | 25 min |

The exercises, and the surface each one is about:

| | Exercise | Surface |
|---|---|---|
| 01 | Add a prospect that answers | the registry |
| 02 | Write a golden question that catches a real mistake | the golden gate |
| 03 | Trip the input guard and prove what gets logged | safety, and what is not retained |
| 04 | Force an upstream failure and prove there is no dead air | degradation |
| 05 | Add a guard that blocks a card number before it reaches ARAG | extending the pipeline |
| 06 | Drive a listening session from a script | the throttle |
| 07 | Lock the API down with a named key, rotate it, revoke it | the API-key store |
| 08 | Change a setting and prove it took effect without a restart | the settings store |
| 09 | Configure and push the ElevenLabs agent, against a mock ElevenLabs | the voice agent |
| 10 | Compare two versions of a brief and say what changed | conversation review |
| 11 | Drive the API explorer, and prove it cannot go stale | the API surface itself |

If there is only time for three, take **06, 09 and 10** — they cover the parts of the product that
exist nowhere else.

## Architect track

| | | Time |
|---|---|---|
| [`WORKSHOP.md`](architect-track/WORKSHOP.md) | ten sections: the turn budget, where grounding is enforced, multi-tenant routing, stored configurations, failure modes, designing for agent-assist, the vendor-neutral contract and its ElevenLabs default, retention and purge, and a group design exercise | 155 min |
| [`sizing-deployment.md`](architect-track/sizing-deployment.md) | concurrency, latency, LLM cost drivers, volume sizing, SSE budget, co-location, cold starts | read alongside the exercise |
| [`design-review-checklist.md`](architect-track/design-review-checklist.md) | go-live checklist: grounding, handoff, guards, configuration authority, credentials, the voice channel and portability, rate limits, retention and purge, listening, observability, the golden gate, rollback | 30 min |
| [`knowledge-check.md`](architect-track/knowledge-check.md) | 20 questions with answers | 25 min |

## Before you start

```bash
node --version          # 22.18 or later
bun --version           # any recent 1.x — dev tooling only, never npm
```

Work from the repo root. Set `ARAG_MOCK=1`, `PORT` and `DATA_DIR` explicitly on every command: a
checkout whose `.env` already holds real credentials will otherwise talk to a real Knowledge Box
(`LAB.md` §0 explains exactly why).
