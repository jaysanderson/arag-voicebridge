# Design review checklist — before a customer go-live

Work through every item. Each one names exactly what to check and where. An item with no
verification command listed means "read the code/config at the path given and confirm it for this
customer's specific configuration" — there is no generic pass/fail for it.

## Grounding

- [ ] Confirm which path each prospect uses: inline prompt or stored `ask_config`
      (`GET /api/v1/admin/prospects/{key}` — presence of `ask_config`). For a stored
      configuration, confirm it was actually re-provisioned after the *last* edit to the
      prospect's `reranker`/`max_tokens`/`temperature`/`generative_model` fields — those fields
      are silently ignored for a prospect on the stored-configuration path
      (`src/services/pipeline.ts`'s `buildAskRequest` returns before reading them). Check
      `POST /api/v1/admin/prospects/{key}/provision` was run after the last config change, not
      just that the prospect record looks right.
- [ ] Confirm the deployed prompt (inline or stored) actually contains the `HANDOFF:` sentinel
      instruction, word for word, matching `HANDOFF_SENTINEL` in `src/services/handoff.ts`. A
      prompt that has drifted from this exact string still degrades safely via the
      retrieval-count backstop (`no-retrieval`), but loses the primary, faster, more precise
      handoff path.
- [ ] Confirm the brief (`src/services/brief.ts`), if Listen mode is in scope for this customer,
      is understood to be **ungoverned by any stored `ask_config`** — it always builds its own
      inline prompt regardless of the main turn's configuration path. If the customer's main path
      is governed by retrieval filters or a security group, the brief is not automatically
      covered by the same governance.

## Handoff policy

- [ ] Confirm `handoff_msg` is set, non-empty, and actually says something the customer is happy
      for a caller to hear — it is the literal spoken output on every failure path (guard trip,
      sentinel, no-retrieval, upstream error).
- [ ] Confirm the customer understands `handoff_msg` is spoken text, not a routing instruction —
      VoiceBridge does not itself transfer the call anywhere; whatever "hand off" means
      operationally (a warm transfer, a ticket, a callback) is the voice platform's or the
      customer's own responsibility, downstream of this response.
- [ ] Walk through the full `handoff_reason` table (`WORKSHOP.md` §6) with the customer's own
      support team, not just engineering — they need to recognise `upstream-error` in the turn log
      as "the system was slow or broke," distinct from `sentinel`/`no-retrieval` meaning "the
      knowledge base genuinely doesn't cover this."

## Safety guards

- [ ] Confirm the customer has been told, explicitly, that `guardInput`/`guardOutput`
      (`src/services/safety.ts`) are documented as "a demo-grade safety net, not a
      content-moderation product" — regex pattern matching, not a classifier. This is not a defect
      to fix before go-live; it is a scope boundary to set expectations about.
- [ ] If the customer has a compliance requirement stricter than the shipped patterns (regulated
      industry, a explicit policy against certain topics), identify the extension seam explicitly:
      immediately after `guardInput`/before `buildAskRequest` for input, and/or after
      `shapeForVoice`/before `guardOutput` for output (`src/services/pipeline.ts`). Do not present
      the shipped patterns as sufficient for a requirement they were not designed to meet.
- [ ] Confirm conversation history and (if Listen mode is used) transcripts are screened the same
      way as the current question (`screenTurns`/`screenTranscript` in `src/services/safety.ts`) —
      both are caller-supplied and reach the model as context on endpoints that are open by
      default.

## Credentials

- [ ] `ADMIN_TOKEN` is set, unique to this deployment, generated with sufficient entropy
      (`openssl rand -hex 24`, per `.env.example`), and never committed. In production,
      `assertVoiceConfig` (`src/config.ts`) already refuses to boot without one — confirm this
      check actually ran (i.e., `NODE_ENV=production`) rather than the deployment silently running
      in a mode where the check is skipped.
- [ ] Confirm whether `API_KEYS` is set. If unset, every non-admin `/api/v1` route (including
      `voice-answer` and `brief`) is open to anyone who can reach the host. Confirm this is the
      customer's intended posture — it is the shipped default, appropriate for a demo, and a
      deliberate decision to revisit for a production deployment with a public URL.
- [ ] Confirm `POST /api/v1/scribe-token` requires a session, API key or admin token even when
      `API_KEYS` is unset (`DECISIONS.md` V-06) — it mints third-party ElevenLabs credentials, and
      this is the one route deliberately never left open by default. Verify this hasn't been
      changed by a customisation.
- [ ] Confirm how many real credentials are in play: one ARAG service-account token shared across
      **all** prospects today (`DECISIONS.md` V-03 — "per-prospect credentials are a documented
      extension point," not yet implemented). If this customer's compliance model requires
      per-prospect credential isolation (e.g. two brands that must never share a service account),
      flag this as a gap to design around, not something already solved.

## Rate limits

- [ ] Confirm `RATE_LIMIT_RPS`/`RATE_LIMIT_BURST` (global per-IP, platform-level) are set
      appropriately for expected traffic — the shipped default (5 rps / burst 20) is demo-sized.
- [ ] Confirm `VOICE_BRIEF_RATE_RPS`/`BURST` (default 1 rps / burst 5) are in place if Listen mode
      is in scope — this is a **product-owned** limiter (`DECISIONS.md` V-05), separate from the
      platform's global limiter, specifically because the brief fires continuously and each
      refresh costs an LLM generation (see `sizing-deployment.md`'s cost section). Confirm it
      hasn't been raised without recalculating the cost exposure.
- [ ] Confirm `VOICE_SCRIBE_RATE_RPS`/`BURST` (default 0.2 rps / burst 3) are in place if Call mode
      is in scope — this limits how fast third-party ElevenLabs Scribe tokens can be minted per
      caller IP.

## Data retention (turn log)

- [ ] Confirm the customer understands the turn log (`GET /api/v1/admin/turns`,
      `DATA_DIR/turns.json`) retains the **question text** of every turn that passed the input
      guard, up to 500 characters, for as many turns as `VOICE_TURN_LOG_LIMIT` (default 500) keeps
      — this is real customer-conversation content sitting in an admin-visible, on-disk store.
      Confirm this is compatible with the customer's own data-retention and privacy commitments.
- [ ] Confirm the customer understands guard-tripped turns are the deliberate exception: no
      question text is ever written for those (`DECISIONS.md` V-08) — this is a feature, not a
      gap, but it means the turn log is not a complete conversation transcript by design.
- [ ] Confirm who has access to `/admin/` and therefore to this data — it is protected only by
      `ADMIN_TOKEN`, a single shared secret, not per-operator accounts or audit-logged access.

## Observability

- [ ] `/healthz` (liveness) and `/readyz` (readiness, includes a live ARAG connection check) are
      wired into the platform's health-check configuration (`fly.toml`'s `[[http_service.checks]]`
      is the shipped reference — interval 15s, timeout 3s, grace period 10s).
- [ ] `GET /api/v1/metrics` (handoff rate, citation coverage, guard-trip rate, latency
      percentiles) and `GET /api/v1/admin/logs` are both known to whoever will operate this
      deployment day to day, not just to the team that built it.
- [ ] Confirm alerting exists (external to the product — VoiceBridge exposes the data but does not
      push alerts itself) on at least: `/readyz` failing, a sustained rise in `guard_trip_rate` or
      `handoff_rate`, and `arag.fail` log lines with `kind: "timeout"` clustering (an early signal
      the Knowledge Box is degrading before customers notice via failed calls).

## Golden-set gate

- [ ] Every in-scope prospect has a `golden_questions` set covering both "answer" and "handoff"
      cases, and it currently passes: `BASE_URL=<prod-url> node scripts/eval.ts <prospect>` exits
      `0`. Do not accept "it passed once during development" — re-run it against the actual
      production Knowledge Box and prompt immediately before go-live.
- [ ] Confirm this gate is actually wired into whatever change-management process governs future
      prompt or stored-configuration edits for this customer (`DECISIONS.md` V-10 notes the
      product ships the mechanism — an in-process job with a CI-friendly exit code — but not a
      CI integration itself). A golden set that exists but is never re-run after a prompt change
      is not a gate.
- [ ] Confirm golden questions were written against the customer's **real** Knowledge Box content,
      not copied from the shipped `progress`/`tangerine`/`northwind` examples and lightly edited —
      a `must_include` term that was never checked against the actual source document is a false
      sense of security (see the developer track's Exercise 2 for exactly this failure mode).

## Rollback

- [ ] Confirm the rollback path for a **code** change (redeploy the previous image) is understood
      to be independent of the rollback path for a **data** change (`DATA_DIR` persists across
      deploys via the Fly volume) — rolling back the container does not revert the prospect
      registry, the turn log, or golden-eval history. A bad prospect-record edit is rolled back
      with `PUT /api/v1/admin/prospects/{key}`, not with a container redeploy.
- [ ] Confirm the rollback path for a **stored search configuration** change: re-provisioning
      (`POST /api/v1/admin/prospects/{key}/provision`) is idempotent and overwrites the named
      configuration — rolling back means re-running provision with the previous prompt/settings,
      which requires that the previous version was actually recorded somewhere (git history of the
      prospect config, or the provisioning script's inputs) before it was changed. Confirm this
      is actually true for this customer, not assumed.
- [ ] Confirm a plan exists for the one failure mode with no built-in recovery: a corrupted
      `DATA_DIR/prospects.json` silently resets to the shipped example prospects on next boot
      (`WORKSHOP.md` §4/§6). This is rare, but the recovery today is "manually re-create every
      prospect via the admin API" — confirm the customer's prospect configurations are backed up
      somewhere outside `DATA_DIR` (e.g. checked into a private config repo) before go-live, not
      solely relied upon as durable in the running deployment.
