# Walkthrough: the admin panel

The admin panel lives at `/admin/` and consumes `/api/v1/admin/*` (plus a handful of public
`/api/v1` routes for the health check). It requires `ADMIN_TOKEN` to be set — with it unset, admin
routes answer `403` rather than appearing open.

## Signing in

Enter the deployment's `ADMIN_TOKEN` in the sign-in card. It is exchanged for an HttpOnly cookie
(`POST /api/v1/admin/login`) and never stored in the page itself — reloading the page re-checks the
cookie rather than re-reading anything from browser storage. A wrong token shows an inline error
without revealing whether the token was merely wrong or something else was misconfigured.

Once signed in, six tabs are available: **Overview**, **Prospects**, **Turn log**, **Golden evals**,
**Configuration**, **Logs**.

## Overview

Two panels side by side. **Knowledge Box health** lists every prospect in the registry with its
connection status — a KB id prefix, a connected/unreachable chip, and the round-trip time in
milliseconds. Press **Test connections** to re-run the check live (this calls
`GET /api/v1/admin/health`, which does a real, cheap catalog + configuration read against each
prospect's Knowledge Box — including through the mock in a mock-backed deployment, shown as an
explicit "mock" chip so nobody mistakes a demo environment for a live one). Alongside it, a **Usage**
panel shows raw counters: total requests, ARAG calls and errors, job counts by status, and the
current metrics snapshot.

## Prospects — the registry, and the onboarding ritual

The left-hand table lists every registry entry (key, display name, region, and its stored search
configuration name if provisioned). Click **Edit** on any row to load it into the editor on the
right, or **New** to start from a blank template.

The editor is deliberately a raw JSON textarea over the prospect configuration, not a form with one
field per property — this keeps the editor honest about exactly what is stored (nothing more, and
nothing hidden), and means a new field added to the schema is immediately editable here with no UI
change required. Three actions sit below it:

- **Save** — `POST` for a new prospect (the Key field must still be editable) or `PUT` for an
  existing one. Validation errors from the API surface inline, field by field, rather than as a
  generic failure.
- **Provision search config** — only available once a prospect has been saved. Calls
  `POST /api/v1/admin/prospects/{key}/provision`, which writes the canonical voice-answer prompt,
  governance filters and latency levers into the prospect's Knowledge Box as a stored ARAG search
  configuration, then updates the registry entry to point at it. The result (the configuration name
  and its full body) renders below the buttons so you can see exactly what was written. Re-running
  this after editing a prospect's `reranker`/`generative_model`/`temperature` updates the same
  stored configuration in place — it is safe to run again.
- **Delete** — removes the registry entry. There is no undo; re-adding it means re-entering the
  configuration (and re-provisioning).

### Onboarding a new prospect, click by click

1. **Prospects** tab → **New**. Fill in `display_name`, `kb_id`, `region`, `locale`, `greeting`,
   `handoff_msg`, and a first pass at `golden_questions` (mix answerable and deliberately
   out-of-scope ones). Set the **Key** field to a short lowercase identifier. Press **Save**.
2. Press **Provision search config**. Confirm the result panel shows the configuration name and a
   sensible `reranker`/`prompt`/`temperature` — this is the point at which the prospect's Knowledge
   Box actually has the voice-answer prompt and governance filters written into it.
3. Switch to the demo console (`/`), select the new prospect, and run a couple of questions on the
   Ask tab by hand — one that should answer, one that should hand off.
4. Back in the console, press **Run golden set** and confirm the gate opens. If it doesn't, come
   back to the admin editor, adjust `reranker`/`generative_model`/the golden questions themselves,
   re-provision, and re-run the golden set until it does.
5. If the prospect will take live voice calls, add its ElevenLabs `agent_id` (and optionally
   `voice_id`) here and save again — see
   [`../developer/integrations.md`](../developer/integrations.md) for setting up that agent in the
   first place.

No step here touches application code or requires a redeploy — this is the entire cost of adding a
prospect (see [`../developer/extension-points.md`](../developer/extension-points.md) for the same
ritual expressed as API calls, useful for scripting it).

## Turn log

A live feed of recent turns (voice-answer calls and golden-eval runs alike), filterable by
prospect. Each row shows the time, prospect, question text (or, pointedly, "redacted (guard trip)"
when the input guard fired instead of a real question ever reaching ARAG — see
[`../architecture/security-model.md`](../architecture/security-model.md) for why that redaction
exists), a result chip (answered / handoff · reason / guard · reason), and the total/first-token/
citation-count numbers. This is the practical tool for "why did this turn behave the way it did" —
the `reason` on a handoff or guard trip row is the same enum value the pipeline itself decided on
(`sentinel`, `no-retrieval`, `prompt-injection`, and so on).

## Golden evals

A history of every golden-set run across every prospect — not just the most recent one. Click a row
to see its detail: every question, expected behaviour, pass/fail with the specific failing checks
listed inline, and per-question latency. This is where you'd go to answer "did this prospect's gate
ever fail, and on what" rather than just "is it currently passing."

## Configuration

A read-only, secrets-redacted dump of the effective configuration (`GET /api/v1/admin/config`) —
every environment-derived setting, which integrations are configured (booleans, never the values),
current rate limits, and the full route list the server has registered. Useful for confirming what
a specific deployment actually has configured without ever risking exposing a secret — a set secret
renders as `•••(N chars)`, confirming presence and rough length without revealing the value.

## Logs

A live-refreshing (every 5 seconds) tail of the last 500 in-memory log records, filterable by level
and by a text-contains search. Because secrets are redacted unconditionally at the logger level
(see [`../architecture/security-model.md`](../architecture/security-model.md)), this is safe to
leave open during a live debugging session without a second thought about what might be visible on
screen.
