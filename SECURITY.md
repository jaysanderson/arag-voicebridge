# Security policy

## Supported versions
The `main` branch and the latest tagged release receive security fixes.

## Reporting a vulnerability
Email the maintainers (see the repository owner's profile) with a description, reproduction steps and impact. Please do not open public issues for security reports. We aim to acknowledge within 3 business days and to publish a fix or mitigation within 30 days for high/critical issues.

## Design notes
- Secrets are never logged and never sent to a browser. They are **not** environment-only: the
  environment supplies the defaults, and an operator who rotates a credential in the product writes
  it to the deployment's own store (see "Where secrets live" below).
- Admin routes require `ADMIN_TOKEN`; public APIs can require API keys and are rate limited.
- All inputs are validated against the OpenAPI schema; uploads are size-limited and typed by their own bytes, not by the type the client declared.
- Dependencies are pinned; `bun audit` runs in CI; runtime dependencies are zero for Node products.
- ARAG `security.groups` filtering is a retrieval filter, not an authorisation boundary; do not present it as one.

## Where secrets live
Configuration in this product is a store, not a set of environment variables: `.env` (or Fly
secrets) supplies the defaults, and from first boot `DATA_DIR` is the authority. That moves the
threat model, so it is stated plainly here.

- `DATA_DIR/settings.json` holds any credential an operator has rotated **in the product** — the
  ARAG service-account token and the ElevenLabs API key. Until one is rotated, the environment's
  value is what is in force and nothing is written.
- `DATA_DIR/api-keys.json` holds API keys **in full**. Authenticating a key needs a constant-time
  comparison against the plaintext, and the ElevenLabs agent push has to put a real key into the
  agent's `X-API-Key` header, so a hash would not do. This is the same trust level as the `.env`
  file the store replaces.
- Consequences an operator must plan for: anyone who can read the volume (a snapshot, `fly ssh`,
  a backup) can read those credentials; and once a credential has been rotated in the product,
  `fly secrets` no longer holds the current value. Treat the volume as secret material.
- What is still true everywhere: no secret is returned by the settings API after it is set
  (`GET /api/v1/admin/settings` reports `set: true` and a four-character hint), no secret reaches a
  browser, and no secret is written to a log — including inside an upstream error message, which is
  scrubbed of every secret the request carried before it is surfaced.
- Removing a key from `API_KEYS` and restarting does **not** revoke it; the store is the authority.
  Revoke it in Settings → API keys. A key the variable no longer names is flagged in that list.

## VoiceBridge specifics
- The browser never holds the ARAG token or the ElevenLabs key. `POST /api/v1/scribe-token` mints a single-use ElevenLabs token server-side and requires a same-origin session or an API key, with its own stricter rate limit.
- `GET /api/v1/prospects` is a deliberately narrow projection: Knowledge Box ids, zones and stored-configuration names never reach a browser.
- An operator-supplied branding URL (the logo, the docs and support links) must be a site-relative path or an `http(s)` URL, and an uploaded logo is typed by its own magic bytes and refused if it is an SVG carrying script, an event handler, an entity declaration or a link-rewriting animation. `/branding/*` is served under `default-src 'none'; sandbox` regardless.
- The input safety guard runs **before** the ARAG call and before anything is stored, so the text of an unsafe or injected prompt is never written to the turn log — only the reason is.
- `POST /api/v1/brief` costs an LLM call per request and carries a stricter per-IP budget (`VOICE_BRIEF_RATE_RPS`) than the rest of the API.
- The prompt-injection and out-of-scope guards are demo-grade regex filters and are documented as such; `docs/developer/extension-points.md` shows where to slot in a classifier.
