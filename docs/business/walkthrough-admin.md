# Walkthrough: the Operator views

Operator lives at `/admin/` — the same application shell as the product, with the operator's own
navigation and hash-based routing (`#overview`, `#connection`, `#sessions`, `#turns`, `#evals`,
`#jobs`, `#logs`, `#branding`, `#security`) instead of separate pages. It requires `ADMIN_TOKEN` to
be set; every operator route answers `403` rather than appearing open when it isn't.

## Signing in

Enter the deployment's `ADMIN_TOKEN` in the sign-in card. It is exchanged for an HttpOnly cookie
(`POST /api/v1/admin/login`) and never stored in the page itself — reloading re-checks the cookie
rather than reading anything from browser storage. A wrong token shows an inline error without
revealing whether the token was merely wrong or something else was misconfigured. **Back to the
product** returns to the workspace; from inside Operator, the rail's own **Back to the product**
link does the same.

Once signed in, the same admin token also unlocks editing on `/prospects/` in the main workspace —
Operator itself has no prospect-editing view of its own; see [Managing prospects](#managing-prospects-and-onboarding-a-new-one)
below.

## Overview

A stats row (uptime, total requests, Knowledge Box calls and errors, mean upstream latency, listen
sessions, turns recorded), plus two panels: **Jobs** (queued/running/succeeded/failed counts) and
**Stores** (the service and platform version, and a record count — with the backing file — for each
`DATA_DIR` collection). This is the fastest way to answer "is this deployment doing anything, and is
it healthy" without reading logs.

## Connection

A table of every prospect in the registry with its Knowledge Box id, endpoint, answer model, and a
live connected/unreachable chip with round-trip time — a real, cheap catalog + configuration read
against each prospect's Knowledge Box, run fresh each time this view opens (including through the
mock in a mock-backed deployment, shown as an explicit "mock" chip so nobody mistakes a demo
environment for a live one). Below it, **Effective configuration** is a secrets-redacted dump of
`GET /api/v1/admin/config` — every environment-derived setting, rendered as JSON.

## Listen sessions

Every listen session across every prospect, newest first, filterable by prospect and by status
(live/ended), with a running count. Each row shows start time, prospect, status, and its stats:
chunks heard, refreshes, throttle-skipped, failures and p50 refresh latency. Click a row to open its
detail: the same stats plus the full **brief history** — every refresh that produced a usable brief,
newest first, each rendered as its own card with the version number, when it happened, how long it
took, and the brief itself at that point. **Export** downloads the same session as Markdown. This is
the operator-side equivalent of the Conversations detail drawer in the main workspace (see
[`walkthrough-demo.md`](walkthrough-demo.md#conversations--every-past-session)) — the same underlying
record, reached from the operator's own navigation instead of the product's.

A trash icon on each row, and a **Delete** button in the detail view, permanently removes a
conversation — its transcript, every version of its brief and the sources it gathered — after a
confirmation naming exactly what goes away. This is different from ending a session (which just
stops it accepting new transcript and keeps the record): deleting is the one place in the product
that actually erases a conversation, and it's recorded in the operator log like any other change here.

A session left "live" by a server restart is closed automatically the next time the service starts,
so it shows here as **ended** rather than a session that stays live forever with nobody listening to
it.

## Turn log

Every turn (voice-answer calls and golden-eval runs alike) across every prospect, filterable by
prospect and by outcome (answered / handed off / guard trip). Each row shows the time, prospect,
question text — or, pointedly, "redacted (guard trip)" when the input guard fired instead of a real
question ever reaching the Knowledge Box, see
[`../architecture/security-model.md`](../architecture/security-model.md) for why that redaction
exists — a result chip with its reason, and the total/first-token/citation-count numbers. This is the
practical tool for "why did this turn behave the way it did" across the whole deployment; the
prospect-scoped equivalent lives on Quality in the main workspace.

## Golden runs

A history of every golden-set run across every prospect, not just the most recent one per prospect.
Click a row to see its detail: every question, expected behaviour, pass/fail with the specific
failing checks listed inline, and per-question latency. This is where you'd go to answer "did this
prospect's gate ever fail, and on what" rather than just "is it currently passing" (that question is
answered on Knowledge, in the main workspace, for the currently selected prospect).

## Jobs

Every asynchronous job this deployment has run — today, golden-set evaluations — with its submission
time, kind, reference and status. A queued or running job gets a **Cancel** button; a cancelled run
keeps whatever cases it had already recorded rather than discarding them.

## Logs

A **paged** view over the last 500 in-memory log records, filterable by level and by a
text-contains search, 50 records to a page with **Newer**/**Older** paging and a range readout
(`1–50 of 214`, say). A **Follow** switch turns on a 5-second auto-refresh instead — following and
paging are deliberately mutually exclusive, so a log that reloads under you while you're three pages
into an investigation never happens; paging away from the newest records turns Follow off
automatically. Because secrets are redacted unconditionally at the logger level (see
[`../architecture/security-model.md`](../architecture/security-model.md)), this is safe to leave open
during a live debugging session without a second thought about what might be visible on screen.

## Branding

The deployment's effective branding (product name, tagline, logo, primary/accent colour, whether the
Progress credit is shown, footer text, docs link) read back from the same configuration Settings'
branding preview uses in the main workspace, plus a table of every prospect that carries its own
overlay and what it presents as. This is the read-only, operator-side confirmation that a rebrand or
a per-prospect overlay actually took effect — see
[`../developer/white-label.md`](../developer/white-label.md) for how to set one.

## Security

Two panels — **Access** (whether `ADMIN_TOKEN` is required for every operator route, how many API
keys are active and a link to manage them, the CORS origins in force, and which proxy header is
trusted for rate limiting) and **Budgets** (the global rate limit, the brief/listen-session budget,
the speech-token budget, the max request body size, and the turn/tool timeouts) — plus a **Data
kept** panel spelling out exactly what the turn log, conversations and golden runs retain, whether
automatic purge is on (with a link to change the windows), and, plainly, **where secrets actually
live**: the ARAG service-account token and the ElevenLabs key live in the environment until an
operator rotates them from Settings, at which point the rotated value lives in
`DATA_DIR/settings.json`; API keys live in their own `DATA_DIR/api-keys.json` because authenticating
one needs the plaintext. None of it is ever sent to a browser, returned by an API after it's set, or
written to a log. This is the page to open before telling a compliance reviewer what the deployment
does and does not expose.

## Managing prospects, and onboarding a new one

Operator itself has no prospect-editing view — the registry lives at `/prospects/` in the main
workspace, unlocked for editing once the same admin token used to sign in here has been entered
there. The ritual for a new prospect:

1. Open `/prospects/`, enter the admin token if it's still read-only, then **New prospect**. On the
   **Setup** tab, fill in the display name, a short lowercase registry key, the locale, the Knowledge
   Box id and region. On the **Voice** tab, write the greeting and handoff line. On the **Golden
   set** tab, add a first pass at golden questions (mix answerable and deliberately out-of-scope
   ones). Then **Save**.
2. Press **Provision search config**. Confirm the result shows the configuration name — this is the
   point at which the prospect's Knowledge Box actually has the voice-answer prompt and governance
   filters written into it.
3. Switch prospects in the main workspace, open Knowledge, and use **Ask it something** to run a
   couple of questions by hand — one that should answer, one that should hand off.
4. Still on Knowledge, press **Run golden set** and confirm the gate opens. If it doesn't, go back to
   the Prospects editor, adjust `reranker`/`generative_model`/the golden questions themselves,
   re-provision, and re-run until it does.
5. If the prospect will take live voice calls, open Settings → ElevenLabs for this prospect: it
   reads what this deployment wants the agent to look like and, once an ElevenLabs API key is
   configured, compares it against what ElevenLabs actually has. Press **Push to ElevenLabs** (or
   **Create and push the agent**, the first time) and the tool and the agent are created or updated
   directly — no dashboard copy-paste required. The pushed agent id, tool id and API key id are
   written back onto the prospect automatically, so a second push is a patch. See
   [`../developer/integrations.md`](../developer/integrations.md) for the mechanics, and for the
   manual, dashboard-only path if a deployment can't reach ElevenLabs' API from wherever Settings is
   being operated.

No step here touches application code or requires a redeploy — see
[`../developer/extension-points.md`](../developer/extension-points.md) for the same ritual expressed
as API calls, useful for scripting it.
