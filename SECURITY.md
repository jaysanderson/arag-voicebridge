# Security policy

## Supported versions
The `main` branch and the latest tagged release receive security fixes.

## Reporting a vulnerability
Email the maintainers (see the repository owner's profile) with a description, reproduction steps and impact. Please do not open public issues for security reports. We aim to acknowledge within 3 business days and to publish a fix or mitigation within 30 days for high/critical issues.

## Design notes
- Secrets are read only from environment variables and never logged or sent to browsers.
- Admin routes require `ADMIN_TOKEN`; public APIs can require API keys and are rate limited.
- All inputs are validated against the OpenAPI schema; uploads are size- and type-limited.
- Dependencies are pinned; `bun audit` runs in CI; runtime dependencies are zero for Node products.
- ARAG `security.groups` filtering is a retrieval filter, not an authorisation boundary; do not present it as one.

## VoiceBridge specifics
- The browser never holds the ARAG token, the ElevenLabs key or the LiveKit secret. `POST /api/v1/scribe-token` mints a single-use ElevenLabs token server-side and requires a same-origin session or an API key, with its own stricter rate limit.
- `GET /api/v1/prospects` is a deliberately narrow projection: Knowledge Box ids, zones, stored-configuration names and avatar ids never reach a browser.
- The input safety guard runs **before** the ARAG call and before anything is stored, so the text of an unsafe or injected prompt is never written to the turn log — only the reason is.
- `POST /api/v1/brief` costs an LLM call per request and carries a stricter per-IP budget (`VOICE_BRIEF_RATE_RPS`) than the rest of the API.
- The prompt-injection and out-of-scope guards are demo-grade regex filters and are documented as such; `docs/developer/extension-points.md` shows where to slot in a classifier.
