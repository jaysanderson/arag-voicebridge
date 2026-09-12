/**
 * White-label branding, read from environment variables so a partner can rebrand a deployment
 * without touching code (DECISIONS D-25). Products expose it at `GET /api/v1/branding` and the
 * UI kit shell applies it (`<arag-shell>` attributes or `applyBranding()`).
 */
export interface Branding {
  /** Product name shown in the header, title and docs (default: the product's working title). */
  productName: string;
  tagline: string;
  /** Absolute URL or a path served by the product (e.g. /branding/logo.svg). Empty = wordmark only. */
  logoUrl: string;
  /** CSS colours; empty = platform defaults. */
  primaryColor: string;
  accentColor: string;
  /** Show the "Built on Progress Agentic RAG" band/credit. Partners may hide it (attribution stays in LICENSE/NOTICE). */
  poweredBy: boolean;
  footerText: string;
  docsUrl: string;
  supportUrl: string;
}

const COLOR_RE = /^(#[0-9a-f]{3,8}|rgb\(.*\)|hsl\(.*\)|[a-z]{3,20})$/i;

/** Parse BRAND_* variables (falls back to `defaults`). Invalid colours are ignored. */
export function readBranding(
  src: Record<string, string | undefined> = process.env,
  defaults: Partial<Branding> = {},
): Branding {
  const s = (k: string, d = "") => {
    const v = src[k];
    return v === undefined || v === "" ? d : v;
  };
  const colour = (k: string, d = "") => {
    const v = s(k, d);
    return COLOR_RE.test(v) ? v : d;
  };
  const pb = s("BRAND_POWERED_BY", "");
  return {
    productName: s("BRAND_PRODUCT_NAME", defaults.productName ?? "ARAG Product"),
    tagline: s("BRAND_TAGLINE", defaults.tagline ?? ""),
    logoUrl: s("BRAND_LOGO_URL", defaults.logoUrl ?? ""),
    primaryColor: colour("BRAND_PRIMARY_COLOR", defaults.primaryColor ?? ""),
    accentColor: colour("BRAND_ACCENT_COLOR", defaults.accentColor ?? ""),
    poweredBy:
      pb === "" ? (defaults.poweredBy ?? true) : !["0", "false", "no", "off"].includes(pb.toLowerCase()),
    footerText: s("BRAND_FOOTER_TEXT", defaults.footerText ?? ""),
    docsUrl: s("BRAND_DOCS_URL", defaults.docsUrl ?? "/api/v1/docs"),
    supportUrl: s("BRAND_SUPPORT_URL", defaults.supportUrl ?? ""),
  };
}

/** OpenAPI schema for the branding payload (add under components.schemas.Branding). */
export const BrandingSchema = {
  type: "object",
  required: ["productName", "poweredBy"],
  properties: {
    productName: { type: "string" },
    tagline: { type: "string" },
    logoUrl: { type: "string" },
    primaryColor: { type: "string" },
    accentColor: { type: "string" },
    poweredBy: { type: "boolean" },
    footerText: { type: "string" },
    docsUrl: { type: "string" },
    supportUrl: { type: "string" },
  },
} as const;
