# Progress Agentic RAG brand assets

Official artwork. Ship it as-is; do not redraw, recolour, stretch or re-letter it.

| File | Use on | Wordmark colour | Mark colour |
| --- | --- | --- | --- |
| `arag-logo.svg` | light surfaces (white, `--arag-surface`, `--arag-surface-raised`) | `#4b4e52` | `#5ce500` |
| `arag-logo-alt.svg` | dark surfaces (`--arag-ink-950` brand band, dark theme) | `#ffffff` | `#5ce500` |

`arag-logo.svg` is `viewBox="0 0 526.06 61"` and `arag-logo-alt.svg` is
`viewBox="0 0 525.25 61"` — both about 8.6:1, and not identical, so never swap one for
the other inside a fixed-width box. Set a height (18 px in the band, 14 px in a footer credit,
22–26 px on a sign-in card) and let the width follow; never set both.

## Progress green `#5ce500` — the usage rule

All three product teams landed on the same rule independently (doc-processing, VoiceBridge and Call
Analysis `design/PRODUCT-EXPERIENCE.md`), so the kit enforces it by convention:

**Green is a fill and a dark-surface colour. It is never text on a light surface, never a hairline,
and never the only signal for a state.**

It measures 1.6:1 against white — nowhere near WCAG AA — so in the kit it appears in exactly three
places, all of them artwork or a solid fill:

1. inside the wordmark artwork (`--arag-green` is not used to draw it; the SVG carries its own);
2. the 2 px rule under the `.arag-appband` brand band (`--arag-green`, on ink-950);
3. `.arag-pill-live` — a solid green fill carrying `--arag-green-ink` (`#00123c`) text, and the
   current-item marker on the **dark** rail (on `rail="light"` that marker is the action colour,
   because green is never a marker on a light surface).

Where each file is used in the kit: `arag-logo-alt.svg` in the `.arag-appband` brand band and the
two-band `.arag-band`; `arag-logo.svg` as the light footer's powered-by credit
(`.arag-footer .credit`, 14 px at 75% opacity) and anywhere a product puts the mark on a light
surface. Both resolve under the shell's `brand-base` attribute (default `/ui/brand`).

Status, success, "ready" and any other meaning-carrying green comes from `--arag-accent-*`
(`#00b563` / `--arag-accent-fg #00663a`), which is contrast-tuned and swaps in dark mode. If you
find yourself reaching for `--arag-green` to say something, you want `--arag-accent-500`.

## White-label

`applyBranding()` never rewrites this artwork. A partner mark set through `BRAND_LOGO_URL` lands in
the shell's **sidebar identity block** (`[data-brand-logo]`), beside the product name — the Progress
wordmark stays in the band, once, and `BRAND_POWERED_BY=0` removes the band entirely rather than
recolouring it. See `docs/ui-kit.md` § Branding hook.
