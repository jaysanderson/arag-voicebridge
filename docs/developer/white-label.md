# White-labelling VoiceBridge

VoiceBridge is one of the open-source reference products ("accelerators") built on Progress
Agentic RAG that Progress's ISV partner network can white-label, extend, or use as a blueprint and
take to market across its own customer reach. This page covers the white-label half: presenting a
deployment as your own product without forking the repository. See
[`build-your-own.md`](build-your-own.md) for the extend half.

Rebranding is entirely environment-driven — `BRAND_*` variables read by `readBranding()`
(`vendor/arag-platform/src/config/branding.ts`) and layered onto the product's own defaults in
`readVoiceBranding()` (`src/config.ts`). No code changes, no rebuild: set the variables and restart
(or, on Fly, `fly secrets set` and the machine picks them up on its next deploy). A second
deployment of the exact same image with different `BRAND_*` values is a real, tested example of
this — see [Verifying it worked](#verifying-it-worked) below.

## The `BRAND_*` variables

| Variable | Default | Effect |
|---|---|---|
| `BRAND_PRODUCT_NAME` | `VoiceBridge` (`BRAND_DEFAULTS.productName`, `src/config.ts`) | Rail wordmark text (`[data-brand-name]`), top-bar breadcrumb (`[data-brand-name-crumb]`), browser tab title, and the `productName` field of `GET /api/v1/branding`. |
| `BRAND_TAGLINE` | `live, grounded call context` | The small tagline under the product name on the rail (`[data-brand-tagline]`); hidden entirely when empty. |
| `BRAND_LOGO_URL` | *(empty — the Progress Agentic RAG wordmark)* | `<img>` `src` for the rail's logo mark (`[data-brand-mark]`). Either an absolute URL, or a path served by VoiceBridge itself — see [The logo](#the-logo) below. Left empty, the default identity shows: the official "Progress Agentic RAG" wordmark, vendored at `public/brand/`. |
| `BRAND_PRIMARY_COLOR` | *(empty — platform default)* | Sets `--arag-brand-600`, `--arag-brand-500` and `--arag-brand-700` on `document.documentElement`, i.e. the primary accent used throughout the shared UI kit (buttons, active nav, etc). Any CSS colour (`#rgb`, `#rrggbb`, `rgb(...)`, `hsl(...)`, or a CSS colour keyword) validated by `COLOR_RE` in `branding.ts`; an invalid value is silently ignored and the default is kept. |
| `BRAND_ACCENT_COLOR` | *(empty — Progress green `#5ce500`)* | Sets `--arag-accent-500` and `--arag-accent-400` (platform UI kit), and `--vb-accent` (`public/app/shell.js`'s own `applyBrand()`) — the accent used for the live-session dot, focus rings and a handful of VoiceBridge-specific controls. Same validation as the primary colour. |
| `BRAND_POWERED_BY` | `1` (true) | `0`/`false`/`no`/`off` hides the "Built on Progress Agentic RAG" credit line in the rail footer (`[data-powered-by]`). With no `BRAND_LOGO_URL` set, it also replaces the Progress wordmark image with a plain text wordmark of `BRAND_PRODUCT_NAME` — a white-labelled deployment shows no Progress mark at all. **Hiding the credit is a UI change only** — see [What hiding the credit does *not* do](#what-hiding-the-credit-does-not-do). |
| `BRAND_FOOTER_TEXT` | `Open source · Apache-2.0` | Replaces the footer text (`[data-brand-footer]`) — e.g. a partner's own copyright line. |
| `BRAND_DOCS_URL` | `/api/v1/docs` | Where the rail's "API docs" link (`[data-docs-link]`) points. Set this to a partner-hosted docs site instead of the built-in Swagger UI. |
| `BRAND_SUPPORT_URL` | *(empty)* | Carried through the `Branding` payload as `supportUrl`; nothing in the shipped workspace renders it yet (see [What is not brandable today](#what-is-not-brandable-today)) — it exists for a partner's own front end to read `GET /api/v1/branding` and show its own support link. |

All defaults above are VoiceBridge's own (`BRAND_DEFAULTS` in `src/config.ts`); the platform's
own fallback, used only if a product sets no default, is `productName: "ARAG Product"`,
`poweredBy: true`, and `docsUrl: "/api/v1/docs"` (`readBranding()`'s own defaults).

## The logo

There is no `BRAND_LOGO_PATH` variable — `BRAND_LOGO_URL` is either:

- an absolute URL (any HTTPS logo host you already use), or
- `/branding/logo.svg` (or any filename), served directly from `DATA_DIR/branding/` — `app.static("/branding", resolve(env.dataDir, "branding"), { cache: "public, max-age=300" })` in `src/server.ts`. Drop a file into that directory on the machine (or into the Fly volume) and point `BRAND_LOGO_URL` at `/branding/<filename>`; no route to upload it exists today, so this is a file-copy operation, not an API call.

## Colours the UI kit sets

`applyBranding()` (`vendor/arag-platform/ui/arag-ui.js`) is the only place colours are applied, and
it only ever sets four CSS custom properties on `<html>`:

```
--arag-brand-600, --arag-brand-500, --arag-brand-700   ← BRAND_PRIMARY_COLOR
--arag-accent-500, --arag-accent-400                    ← BRAND_ACCENT_COLOR
```

Every `<arag-shell>` instance on the page (the console at `/` and the admin panel at `/admin/`)
picks these up automatically because both mount the shell with its default
`branding-src="/api/v1/branding"` — see `AragShell.connectedCallback()`. If you build your own page
on the UI kit (see [`build-your-own.md`](build-your-own.md#adding-a-ui-surface-on-the-shared-ui-kit)), call
`window.aragUI.applyBranding(branding)` yourself, or set `branding-src="none"` on your `<arag-shell>`
and apply branding before it mounts if you need it earlier than the shell's own fetch.

## The powered-by toggle

`BRAND_POWERED_BY=0` hides two DOM elements: the top "Built on Progress Agentic RAG" band
(`[data-powered-by]`) and the footer credit span (`[data-powered-by-credit]`). That is the whole
effect — a CSS/DOM change made by `AragShell.applyBranding()`.

### What hiding the credit does *not* do

VoiceBridge is Apache-2.0 licensed (`LICENSE`) and ships a vendored MIT-licensed dependency
(`@elevenlabs/client`, documented in `THIRD_PARTY_NOTICES.md`). Turning off `BRAND_POWERED_BY`
removes a friendly on-screen mention; it does **not** remove any attribution obligation that
licence actually imposes — the Apache-2.0 `NOTICE`-style attribution and the MIT copyright/licence
text in `THIRD_PARTY_NOTICES.md` must still travel with any distribution of the software regardless
of what the running UI displays. Read `LICENSE` and `THIRD_PARTY_NOTICES.md` before you ship a
white-labelled build to a customer, and keep those files (or your own equivalent notices) in
whatever you distribute.

## Per-prospect overrides

A single deployment can serve several of a partner's own customers, each with its own branding
layered on top of the deployment's `BRAND_*` values. `ProspectConfig.brand` (`src/types.ts`,
`ProspectBrand`) accepts the same fields, minus `docsUrl` and `supportUrl` (those two are
deployment-wide only):

```ts
export interface ProspectBrand {
  productName?: string;
  tagline?: string;
  logoUrl?: string;
  primaryColor?: string;
  accentColor?: string;
  footerText?: string;
  poweredBy?: boolean;
}
```

`ProspectRegistry.brandFor(p)` (`src/services/registry.ts`) computes the effective branding: the
deployment's `Branding` object, spread first, then every *non-empty* field from `p.brand` on top
(`Object.entries(over).filter(([, v]) => v !== undefined && v !== "")`). This is served as the
`brand` field of every prospect returned from `GET /api/v1/prospects/:key` and
`GET /api/v1/admin/prospects/:key`, and consumed by anything driving multiple prospects from one
console. Unknown keys or wrong types are rejected by `validateProspect()` — `/brand/<key> is not a
branding field` or `must be a string`/`must be a boolean`.

A real admin `PUT` payload to override branding for one prospect:

```bash
curl -s -b admin.txt -X PUT $BASE/api/v1/admin/prospects/acme \
  -H 'Content-Type: application/json' \
  -d '{
    "display_name": "Acme Corp",
    "kb_id": "<the Knowledge Box id>",
    "region": "aws-us-east-2-1",
    "locale": "en-US",
    "greeting": "Hi, thanks for calling. What can I help you with?",
    "handoff_msg": "Let me hand you to a specialist who can help with that.",
    "brand": {
      "productName": "Acme Assist",
      "primaryColor": "#0a5c36",
      "poweredBy": false
    }
  }'
```

(`PUT` replaces the whole prospect record — see
[`extension-points.md`](extension-points.md#onboarding-a-new-prospect-end-to-end) for the full
onboarding ritual this fits into.)

## What is not brandable today

- **The OpenAPI document's `info.title`.** `app.docs("/api/v1", openapi, { title: "VoiceBridge API" })` (`src/server.ts`) and `info.title: "VoiceBridge API"` (`src/openapi.ts`) are hard-coded strings, not read from `Branding`. A partner's hosted Swagger UI (`/api/v1/docs`) will say "VoiceBridge API" regardless of `BRAND_PRODUCT_NAME`.
- **The demo's sample conversation.** `SAMPLE_CONVERSATION` in `public/app.js` is a fixed script about a fictional manufacturer, matching the mock knowledge base's seed documents (`src/services/seed.ts`). It is not read from configuration or per-prospect, so "Play sample conversation" always plays the same script regardless of branding.
- **E-mail/support text beyond `BRAND_SUPPORT_URL`.** The variable is carried through the API payload but nothing in the shipped console or admin panel currently renders a support link from it — see the table above. There is no other configurable support/contact copy anywhere in the product (no support e-mail template, no help-desk footer text beyond `BRAND_FOOTER_TEXT`).
- **Prospect `brand.docsUrl`/`brand.supportUrl`.** Only the deployment-wide `BRAND_DOCS_URL`/`BRAND_SUPPORT_URL` exist; `ProspectBrand` does not include either field, so every prospect on one deployment shares the same docs link.

## Worked example: "Contoso Live Assist"

Docker:

```bash
docker build -t arag-voice-bridge:local .
docker run -p 8080:8080 \
  -e ARAG_MOCK=1 -e ADMIN_TOKEN=change-me \
  -e BRAND_PRODUCT_NAME="Contoso Live Assist" \
  -e BRAND_TAGLINE="grounded call context" \
  -e BRAND_PRIMARY_COLOR="#6b2fa0" \
  -e BRAND_FOOTER_TEXT="© Contoso" \
  -e BRAND_POWERED_BY=0 \
  arag-voice-bridge:local
```

Fly (an existing `fly.toml` app, secrets set out of band per the file's own header comment):

```bash
fly secrets set \
  BRAND_PRODUCT_NAME="Contoso Live Assist" \
  BRAND_TAGLINE="grounded call context" \
  BRAND_PRIMARY_COLOR="#6b2fa0" \
  BRAND_FOOTER_TEXT="© Contoso" \
  BRAND_POWERED_BY=0 \
  --app contoso-live-assist
```

(Add `BRAND_LOGO_URL` once Contoso's logo is reachable, either as an absolute URL or as a file
dropped into the Fly volume's `branding/` directory — see [The logo](#the-logo).)

## Verifying it worked

```bash
curl -s $BASE/api/v1/branding | jq
# { "productName": "Contoso Live Assist", "tagline": "grounded call context",
#   "primaryColor": "#6b2fa0", "poweredBy": false, "footerText": "© Contoso", ... }
```

then load `/` and `/admin/` and confirm the header, colours, and (hidden) credit band. This is
exactly what `test/e2e/branding.spec.ts` automates: `playwright.config.ts` starts a **second**
instance of the same build on its own port with only `BRAND_*` variables set (no fork, no code
change) and the spec asserts the branded instance shows "Contoso Live Assist" with the credit
hidden, the unbranded instance still shows "VoiceBridge" with the credit visible, and
`GET /api/v1/branding` reflects both. Run it locally with `make e2e`, or just that file:

```bash
PW_DISABLE_TS_ESM=1 bunx playwright test test/e2e/branding.spec.ts
```
