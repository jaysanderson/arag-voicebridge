// Inline SVG icon set. One 24×24 stroke grid, `currentColor`, no emoji anywhere in the product.
// Kept as path data rather than files so an icon costs no request and inherits colour and size.

const PATHS = {
  // navigation
  live: "M12 3v18M8 7v10M4 10v4M16 7v10M20 10v4",
  conversations: "M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12z",
  knowledge: "M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5zM8 7h7M8 11h7",
  prospects:
    "M16 20v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V20M9.5 7.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM17 11l2 2 4-4",
  quality: "M4 19V9M10 19V5M16 19v-7M22 19H2",
  settings:
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7.5 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H1a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 2.6 7.5a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H7a1.6 1.6 0 0 0 1-1.5V1a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V7a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z",
  operator: "M12 3l8 4v5c0 4.4-3.4 8.4-8 9-4.6-.6-8-4.6-8-9V7l8-4zM9 12l2 2 4-4",

  // sources and controls
  mic: "M12 2a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3zM19 10v1a7 7 0 0 1-14 0v-1M12 19v3",
  webhook:
    "M9 17H6.5a3.5 3.5 0 1 1 3-5.3M15 7l1.3 2.2A3.5 3.5 0 1 1 18 16h-2M12 21l-2.6-4.5M10 7a3.5 3.5 0 1 1 5.6 2.8",
  keyboard: "M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10",
  play: "M6 4l14 8-14 8V4z",
  stop: "M6 6h12v12H6z",
  end: "M21 3L3 21M9 5h10v10",

  // objects
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3",
  filter: "M3 5h18l-7 8v6l-4 2v-8L3 5z",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  source:
    "M14 3v4a1 1 0 0 0 1 1h4M15 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7l-4-4zM9 13h6M9 17h4",
  download: "M12 3v12M7 11l5 5 5-5M4 20h16",
  copy: "M9 9h10v12H9zM5 15H3V3h12v2",
  plus: "M12 5v14M5 12h14",
  check: "M4 12l5 5L20 6",
  cross: "M6 6l12 12M18 6L6 18",
  warning: "M12 3l9 16H3l9-16zM12 9v5M12 17h.01",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01",
  person: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0z",
  target:
    "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z",
  chevronDown: "M6 9l6 6 6-6",
  chevronRight: "M9 6l6 6-6 6",
  menu: "M4 7h16M4 12h16M4 17h16",
  refresh: "M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6",
  external: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  trash: "M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13h10l1-13",
  shield: "M12 3l8 4v5c0 4.4-3.4 8.4-8 9-4.6-.6-8-4.6-8-9V7l8-4z",
  plug: "M9 3v6M15 3v6M7 9h10v3a5 5 0 0 1-10 0V9zM12 17v4",
  spark: "M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4L12 3z",
  brand: "M4 7h16v10H4zM8 11h8M8 14h5",
  logs: "M5 4h14v16H5zM9 8h6M9 12h6M9 16h3",
  jobs: "M4 8h16v12H4zM8 8V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M4 13h16",
  usage: "M3 3v18h18M7 15l4-5 3 3 5-7",
  sortArrow: "M12 5v14M7 14l5 5 5-5",
};

/** Render one icon as an inline SVG string. */
export function icon(name, size = 16, extraClass = "") {
  const d = PATHS[name];
  if (!d) return "";
  return (
    `<svg class="vb-icon ${extraClass}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" ` +
    `stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" ` +
    `aria-hidden="true" focusable="false"><path d="${d}"/></svg>`
  );
}

export const iconNames = Object.keys(PATHS);
