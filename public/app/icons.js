// The product's icon accessor. Since platform v0.2.0 the UI kit owns the icon convention and a
// 35-icon core set, so this module is a thin adapter: everything the kit carries is delegated to
// `icon()` under the kit's own name, and only VoiceBridge's domain icons — liveness, the three
// transcript sources, the workspace sections the kit has no glyph for — live here.
//
// Local paths follow the same convention (fill="none", stroke="currentColor", round caps and
// joins, aria-hidden when decorative, stroke width scaled with the render size). They are drawn on
// a 24×24 grid rather than the kit's 20×20, so their stroke is scaled by 24/20 to keep the optical
// weight identical to a kit icon rendered at the same size.
import { icon as kitIcon } from "/ui/arag-ui.js";

/** VoiceBridge name → kit name. Everything in here is the kit's glyph, not ours. */
const KIT = {
  check: "check",
  chevronDown: "chevron-down",
  chevronRight: "chevron-right",
  clock: "clock",
  copy: "copy",
  cross: "x",
  download: "download",
  external: "external-link",
  filter: "filter",
  info: "info",
  jobs: "jobs",
  knowledge: "book",
  logs: "logs",
  menu: "menu",
  operator: "shield",
  person: "users",
  play: "play",
  plug: "plug",
  plus: "plus",
  quality: "chart",
  refresh: "refresh",
  search: "search",
  settings: "settings",
  shield: "shield",
  sortArrow: "sort",
  source: "document",
  trash: "trash",
  warning: "alert-triangle",
};

/** Domain icons the kit does not carry. 24×24 grid, one path each. */
const PATHS = {
  // The product's own vocabulary: a live conversation, and where its words come from.
  live: "M12 3v18M8 7v10M4 10v4M16 7v10M20 10v4",
  mic: "M12 2a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3zM19 10v1a7 7 0 0 1-14 0v-1M12 19v3",
  webhook:
    "M9 17H6.5a3.5 3.5 0 1 1 3-5.3M15 7l1.3 2.2A3.5 3.5 0 1 1 18 16h-2M12 21l-2.6-4.5M10 7a3.5 3.5 0 1 1 5.6 2.8",
  keyboard: "M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10",
  stop: "M6 6h12v12H6z",
  end: "M21 3L3 21M9 5h10v10",
  // Workspace sections with no kit glyph.
  conversations: "M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12z",
  prospects:
    "M16 20v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V20M9.5 7.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM17 11l2 2 4-4",
  usage: "M3 3v18h18M7 15l4-5 3 3 5-7",
  brand: "M4 7h16v10H4zM8 11h8M8 14h5",
  // Brief vocabulary.
  target:
    "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z",
  spark: "M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4L12 3z",
};

// The kit's own ramp (arag-ui.js), so a local glyph never looks heavier or lighter than a kit one.
const KIT_STROKE = (size) => (size <= 14 ? 1.7 : size <= 20 ? 1.5 : size <= 24 ? 1.4 : 1.25);
const LOCAL_STROKE = (size) => Math.round(KIT_STROKE(size) * (24 / 20) * 100) / 100;

/**
 * Render one icon as an inline SVG string. Decorative by default; pass `label` when the icon is
 * the only thing naming its control. Unknown names render nothing rather than a mystery glyph.
 */
export function icon(name, size = 16, extraClass = "", label = "") {
  const kit = KIT[name];
  if (kit) return kitIcon(kit, { size, cls: extraClass, label });
  const d = PATHS[name];
  if (!d) return "";
  const a = label
    ? `role="img" aria-label="${String(label).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)}"`
    : 'aria-hidden="true" focusable="false"';
  return (
    `<svg ${a} class="arag-icon${extraClass ? ` ${extraClass}` : ""}" width="${size}" height="${size}" ` +
    `viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${LOCAL_STROKE(size)}" ` +
    `stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`
  );
}

export const iconNames = [...Object.keys(KIT), ...Object.keys(PATHS)];
