/**
 * The logo upload's SVG check, against the files a partner will actually hand it.
 *
 * A check that refuses real vector art is worse than no check: it turns the branding feature off
 * for everyone while looking like security. The first version of this rule flattened whitespace
 * before testing for an `on…=` handler, so `fill="none" stroke="currentColor"` — the single most
 * common idiom in exported SVG, and what this product's own wordmark uses — read as an event
 * handler. Both halves are pinned here: the real files must pass, and every evasion must not.
 */
import { readFileSync } from "node:fs";
import { svgIsActive } from "../src/routes/settings.ts";
import { describe, expect, it } from "./_expect.ts";

describe("svgIsActive", () => {
  it("accepts the vector art this product itself ships", () => {
    for (const file of [
      "public/brand/arag-logo.svg",
      "public/brand/arag-logo-alt.svg",
      "vendor/arag-platform/ui/favicon.svg",
      "vendor/arag-platform/ui/brand/arag-logo.svg",
      "vendor/arag-platform/ui/brand/arag-logo-alt.svg",
    ]) {
      expect(svgIsActive(readFileSync(file, "utf8"))).toBe(false);
    }
  });

  it("accepts the idioms exported vector art is full of", () => {
    const fine = [
      '<svg fill="none" stroke="currentColor" stroke-width="1.5"><path d="M0 0"/></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/></svg>',
      // A legitimate animation: it moves the art, it does not rewrite a link.
      '<svg><animateTransform attributeName="transform" type="rotate" dur="2s"/></svg>',
      '<svg><linearGradient id="a"><stop offset="0" stop-color="#5ce500"/></linearGradient></svg>',
      '<svg><text font-family="Progress Sans">on sale</text></svg>',
    ];
    for (const svg of fine) expect(svgIsActive(svg)).toBe(false);
  });

  it("refuses script, handlers, schemes and link rewriting, however they are spelled", () => {
    const active = [
      "<svg><script>fetch('/api/v1/admin/settings')</script></svg>",
      '<svg><rect onload="x"/></svg>',
      '<svg><rect/onload="x"/></svg>',
      "<svg><rect onload=x /></svg>",
      '<svg><a href="&#106;avascript:alert(1)">x</a></svg>',
      '<svg><a href="&#x6a;avascript:alert(1)">x</a></svg>',
      '<svg><a href="vbscript:x">y</a></svg>',
      "<svg><foreignObject><body/></foreignObject></svg>",
      '<svg><animate attributeName="href" values="javascript:1"/></svg>',
      '<svg><set attributeName="xlink:href" to="javascript:1"/></svg>',
      '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg/>',
      '<svg><image href="data:text/html,<script>1</script>"/></svg>',
    ];
    for (const svg of active) expect(svgIsActive(svg)).toBe(true);
  });
});
