/*! ARAG UI kit v0.2.0 — Apache-2.0. Framework-free helpers + web components used by every ARAG product UI.
    Usage: <script type="module" src="/ui/arag-ui.js"></script>

    Components: <arag-app-shell> (left-rail application shell), <arag-shell> (two-band marketing/demo
                shell; layout="rail" renders the application shell instead), <arag-icon>,
                <arag-status>, <arag-json>, <arag-log>, <arag-health>, <arag-job-timeline>
    Overlays:   openDrawer, confirmDialog, menuButton, popover, tour, closeOverlay
    Behaviours: wireTabs, wireSegmented, wireTable, wireCopy, announce
    Pure:       icon, sortRows, nextSort, paginate, filterRows, parseNav, brandingPlan, brandingVars,
                placeCard, esc, fmtMs, fmtBytes, fmtRelative
    Helpers:    window.aragUI = { api, toast, sse, … } (every export above is also on window.aragUI)

    Everything below is importable in plain Node (the module registers custom elements and touches
    `window`/`document` only when they exist), so the pure half is unit-tested directly. */

const HAS_DOM = typeof document !== "undefined";

const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
const fmtMs = (ms) =>
  ms === undefined || ms === null ? "" : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
const fmtBytes = (n) =>
  n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`;

const RELATIVE = [
  [60, "second", 1],
  [3600, "minute", 60],
  [86400, "hour", 3600],
  [2592000, "day", 86400],
];
/** "3 min ago". Always pair with the absolute timestamp in a `title`. */
function fmtRelative(iso, now = Date.now()) {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const secs = (now - t) / 1000;
  if (secs < 45) return "just now";
  for (const [limit, unit, div] of RELATIVE) {
    if (secs < limit) {
      const n = Math.round(secs / div);
      return `${n} ${unit}${n === 1 ? "" : "s"} ago`;
    }
  }
  return new Date(t).toISOString().slice(0, 10);
}

// ─────────────────────────────── icons ───────────────────────────────
// Convention (see arag-ui.css § icons): inline SVG only — never an icon font, a sprite sheet or an
// emoji. One 20×20 grid, fill none, stroke currentColor, round caps and joins. Stroke width is
// scaled with the render size so the optical weight stays constant from 14 px to 32 px.
// Products add their own domain icons; these are the ones all three product passes needed.
const ICON_PATHS = {
  document: "M6 2h6l4 4v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z M12 2v4h4",
  folder: "M2.5 5.5a1 1 0 0 1 1-1h3.6l1.5 2h7.9a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1v-9Z",
  upload: "M10 13V3 M6.5 6.5 10 3l3.5 3.5 M3 13v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2",
  download: "M10 3v10 M6.5 9.5 10 13l3.5-3.5 M3 15v1a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1",
  search: "M9 15A6 6 0 1 0 9 3a6 6 0 0 0 0 12Z M13.5 13.5 17 17",
  filter: "M3 4h14l-5.5 6.5V16L8.5 14v-3.5L3 4Z",
  sort: "M10 4v12 M6 12l4 4 4-4",
  "chevron-down": "m5 7.5 5 5 5-5",
  "chevron-up": "m5 12.5 5-5 5 5",
  "chevron-right": "m7.5 5 5 5-5 5",
  "chevron-left": "m12.5 5-5 5 5 5",
  check: "m4 10.5 4 4 8-9",
  plus: "M10 4v12 M4 10h12",
  x: "m5 5 10 10 M15 5 5 15",
  menu: "M3 5h14 M3 10h14 M3 15h14",
  "more-horizontal": "M4.5 10h.01 M10 10h.01 M15.5 10h.01",
  settings:
    "M10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z M16.5 10a6.5 6.5 0 0 0-.1-1.1l1.4-1.1-1.5-2.6-1.7.6a6.5 6.5 0 0 0-1.9-1.1L12.4 3H9.6l-.3 1.7a6.5 6.5 0 0 0-1.9 1.1l-1.7-.6-1.5 2.6 1.4 1.1a6.5 6.5 0 0 0 0 2.2l-1.4 1.1 1.5 2.6 1.7-.6c.6.5 1.2.8 1.9 1.1l.3 1.7h2.8l.3-1.7c.7-.3 1.3-.6 1.9-1.1l1.7.6 1.5-2.6-1.4-1.1c.06-.36.1-.73.1-1.1Z",
  shield: "M10 2.5 16.5 5v4.5c0 3.7-2.8 7-6.5 7.5-3.7-.5-6.5-3.8-6.5-7.5V5L10 2.5Z m-2.5 7.5 2 2 3.5-3.5",
  key: "M12.5 3a4.5 4.5 0 0 1 1.6 8.7L13 13H10v2H8v2H4v-3l5.3-5.3A4.5 4.5 0 0 1 12.5 3Z M13.8 6.2h.01",
  plug: "M7 3v5 M13 3v5 M4.5 8h11v2a5.5 5.5 0 0 1-11 0V8Z M10 15.5V18",
  chart: "M4 16V9 M8.5 16V4 M13 16v-5 M17 16h-14",
  clock: "M10 17A7 7 0 1 0 10 3a7 7 0 0 0 0 14Z M10 6v4.5l3 1.8",
  users:
    "M13 16v-1.2a3 3 0 0 0-3-3H5a3 3 0 0 0-3 3V16 M10 6.2a2.6 2.6 0 1 1-5.2 0 2.6 2.6 0 0 1 5.2 0Z M14 9l1.6 1.6L18.5 7.7",
  trash: "M3.5 5.5h13 M8 5.5V3.5h4v2 M5.5 5.5 6.5 17h7l1-11.5 M8.5 8.5v6 M11.5 8.5v6",
  refresh: "M17 10a7 7 0 1 1-2.05-4.95 M17 3v4h-4",
  play: "M7 4.5 15 10l-8 5.5v-11Z",
  copy: "M7.5 7.5h9v9h-9z M4.5 12.5h-1v-9h9v1",
  "external-link": "M11 3h6v6 M17 3l-8 8 M15 12v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4",
  info: "M10 17A7 7 0 1 0 10 3a7 7 0 0 0 0 14Z M10 9v5 M10 6.4h.01",
  "alert-triangle": "M10 3.5 18 16.5H2L10 3.5Z M10 8v3.5 M10 14h.01",
  jobs: "M3.5 7h13v9.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V7Z M7 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2 M3.5 11h13",
  logs: "M4.5 3h11v14h-11z M7.5 6.5h5 M7.5 10h5 M7.5 13.5h3",
  layers: "M10 3 3 6.5 10 10l7-3.5L10 3Z M3 13.5 10 17l7-3.5 M3 10 10 13.5 17 10",
  home: "M3 9l7-6 7 6v7a1 1 0 0 1-1 1h-4v-5H8v5H4a1 1 0 0 1-1-1V9Z",
  book: "M3.5 4.5A1.5 1.5 0 0 1 5 3h11v12H5a1.5 1.5 0 0 0-1.5 1.5v-12Z M7 6.5h6 M7 9.5h6",
};

const ICON_STROKE = (size) => (size <= 14 ? 1.7 : size <= 20 ? 1.5 : size <= 24 ? 1.4 : 1.25);

/**
 * Inline SVG for `name`. Decorative by default (`aria-hidden`); pass `label` when the icon is the
 * only thing naming its control. Unknown names render nothing rather than a mystery glyph.
 */
function icon(name, { size = 16, cls = "", label = "" } = {}) {
  const d = ICON_PATHS[name];
  if (!d) return "";
  const a = label ? `role="img" aria-label="${esc(label)}"` : 'aria-hidden="true" focusable="false"';
  return (
    `<svg ${a} class="arag-icon${cls ? ` ${esc(cls)}` : ""}" width="${size}" height="${size}" ` +
    `viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="${ICON_STROKE(size)}" ` +
    `stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`
  );
}
const iconNames = Object.keys(ICON_PATHS);

// ─────────────────────────────── fetch / toast / sse ───────────────────────────────

/** Problem-aware fetch wrapper: throws Error with .problem for non-2xx, parses JSON. */
async function api(path, opts = {}) {
  const headers = { ...(opts.headers ?? {}) };
  let body = opts.body;
  if (opts.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.json);
  }
  const res = await fetch(path, { ...opts, headers, body, credentials: "same-origin" });
  const ct = res.headers.get("content-type") ?? "";
  const data = ct.includes("json") ? await res.json().catch(() => null) : await res.text();
  if (!res.ok) {
    const err = new Error(data?.detail || data?.title || `${res.status} ${res.statusText}`);
    err.status = res.status;
    err.problem = data;
    throw err;
  }
  return data;
}

let toastHost;
function toast(msg, kind = "info", ms = 4200) {
  if (!HAS_DOM) return;
  if (!toastHost) {
    toastHost = document.createElement("div");
    toastHost.className = "arag-toast";
    document.body.appendChild(toastHost);
  }
  const el = document.createElement("div");
  el.className = kind;
  el.setAttribute("role", kind === "error" ? "alert" : "status");
  el.textContent = msg;
  toastHost.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

/** Subscribe to an SSE endpoint; handlers keyed by event name. Returns close(). */
function sse(url, handlers) {
  const es = new EventSource(url, { withCredentials: true });
  for (const [ev, fn] of Object.entries(handlers)) {
    es.addEventListener(ev, (e) => {
      let data = e.data;
      try {
        data = JSON.parse(e.data);
      } catch {
        /* text */
      }
      fn(data, e);
    });
  }
  es.onerror = () => handlers.error?.({ message: "connection lost" });
  return () => es.close();
}

/**
 * Announce into the screen's one polite live region (never stack assertive ones). The kit shells
 * render `#aragLive`; a product with its own shell gets it created on first use rather than a
 * silent no-op — the same reasoning as the `data-brand-*` hook.
 */
function announce(message) {
  if (!HAS_DOM) return;
  let region = document.getElementById("aragLive");
  if (!region) {
    region = document.createElement("div");
    region.id = "aragLive";
    region.className = "sr-only";
    region.setAttribute("role", "status");
    region.setAttribute("aria-live", "polite");
    document.body.appendChild(region);
  }
  region.textContent = message;
}

// ─────────────────────────────── branding hook ───────────────────────────────

/**
 * CSS custom properties a branding payload implies. Pure.
 * Only the action/accent ramps move — surfaces, text and status colours are contrast-tuned and
 * a partner colour dropped into them would break legibility.
 */
function brandingVars(b) {
  const vars = {};
  if (b?.primaryColor) {
    vars["--arag-brand-500"] = b.primaryColor;
    vars["--arag-brand-600"] = b.primaryColor;
    vars["--arag-brand-700"] = b.primaryColor;
  }
  if (b?.accentColor) {
    vars["--arag-accent-400"] = b.accentColor;
    vars["--arag-accent-500"] = b.accentColor;
  }
  return vars;
}

/**
 * The documented branding hook. Pure: returns the list of DOM operations a payload implies, keyed
 * by data attribute, so ANY element in ANY shell can opt in — a product does not have to use
 * `<arag-shell>` or `<arag-app-shell>` to be white-labelled (this was the 0.1.x limitation: the
 * kit only walked `<arag-shell>`, so a product with its own shell re-implemented all of it).
 *
 *   <span data-brand-name>       → productName
 *   <span data-brand-tagline>    → tagline (hidden when empty)
 *   <img  data-brand-logo>       → logoUrl + alt (hidden when empty)
 *   <span data-brand-footer>     → footerText
 *   <a    data-docs-link>        → docsUrl
 *   <div  data-powered-by>       → hidden when poweredBy === false
 *   <span data-powered-by-credit>→ hidden when poweredBy === false
 */
function brandingPlan(b) {
  if (!b) return [];
  const on = b.poweredBy !== false;
  return [
    { sel: "[data-brand-name]", text: b.productName || undefined },
    { sel: "[data-brand-tagline]", text: b.tagline ?? "", hidden: !b.tagline },
    {
      sel: "[data-brand-logo]",
      attr: b.logoUrl ? { src: b.logoUrl, alt: b.productName ?? "" } : undefined,
      removeAttr: b.logoUrl ? undefined : ["src"],
      hidden: !b.logoUrl,
    },
    { sel: "[data-brand-footer]", text: b.footerText || undefined },
    { sel: "[data-docs-link]", attr: b.docsUrl ? { href: b.docsUrl } : undefined },
    { sel: "[data-powered-by]", hidden: !on },
    { sel: "[data-powered-by-credit]", hidden: !on },
  ];
}

/** Execute one branding op against every matching element under `root`. */
function applyBrandingOp(op, root) {
  for (const el of root.querySelectorAll(op.sel)) {
    if (op.text !== undefined) el.textContent = op.text;
    if (op.attr) for (const [k, v] of Object.entries(op.attr)) el.setAttribute(k, v);
    if (op.removeAttr) for (const k of op.removeAttr) el.removeAttribute(k);
    if (op.hidden !== undefined) el.hidden = op.hidden;
  }
}

/**
 * Apply a branding payload (from GET /api/v1/branding) to `root` (default: the whole document):
 * CSS variables, `document.title`, and every element carrying a `data-brand-*` hook above.
 */
function applyBranding(b, root = HAS_DOM ? document : null) {
  if (!b || !root) return;
  const docEl = root.documentElement ?? root.ownerDocument?.documentElement;
  if (docEl?.style) for (const [k, v] of Object.entries(brandingVars(b))) docEl.style.setProperty(k, v);
  for (const op of brandingPlan(b)) applyBrandingOp(op, root);
  if (HAS_DOM && root === document && b.productName) {
    const rest = document.title.split("·").slice(1).join("·").trim();
    document.title = rest ? `${b.productName} · ${rest}` : b.productName;
  }
  // Symmetric: a later payload that turns the Progress signature back on must restore the band's
  // height, not leave the layout collapsed around a hidden element.
  if (docEl?.style) {
    if (b.poweredBy === false) docEl.style.setProperty("--arag-band-h", "0px");
    else docEl.style.removeProperty("--arag-band-h");
  }
  if (typeof window !== "undefined") window.__aragBranding = b;
  if (HAS_DOM && root === document)
    for (const el of document.querySelectorAll("arag-shell, arag-app-shell")) el.onBranding?.(b);
}

// ─────────────────────────────── list-view logic (pure) ───────────────────────────────

const collator = typeof Intl !== "undefined" ? new Intl.Collator(undefined, { numeric: true }) : null;

const isEmptyCell = (v) => v === undefined || v === null || v === "";

function compareValues(a, b) {
  if (a === b) return 0;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return (a ? 1 : 0) - (b ? 1 : 0);
  const as = String(a);
  const bs = String(b);
  return collator ? collator.compare(as, bs) : as < bs ? -1 : as > bs ? 1 : 0;
}

/**
 * Stable sort by `key` (or a `get(row)` accessor). `dir` is the ARIA value: "ascending",
 * "descending" or "none" (returns a copy unchanged). Empty cells always sort last.
 */
function sortRows(rows, { key, dir = "ascending", get } = {}) {
  const out = [...(rows ?? [])];
  if (!dir || dir === "none" || (!key && !get)) return out;
  const read = get ?? ((r) => r?.[key]);
  const sign = dir === "descending" ? -1 : 1;
  return out
    .map((row, i) => ({ row, i }))
    .sort((x, y) => {
      const a = read(x.row);
      const b = read(y.row);
      // A missing value is not "smallest": empty cells sort last in BOTH directions.
      if (isEmptyCell(a) || isEmptyCell(b))
        return isEmptyCell(a) && isEmptyCell(b) ? x.i - y.i : isEmptyCell(a) ? 1 : -1;
      const c = compareValues(a, b) * sign;
      return c === 0 ? x.i - y.i : c;
    })
    .map((e) => e.row);
}

/** Header click → the next aria-sort state. A new column starts ascending; the same one toggles. */
function nextSort(current, key) {
  if (!current || current.key !== key) return { key, dir: "ascending" };
  if (current.dir === "ascending") return { key, dir: "descending" };
  return { key: null, dir: "none" };
}

/** Page maths, clamped. `page` is 1-based; `from`/`to` are 1-based inclusive for display. */
function paginate(total, page = 1, pageSize = 25) {
  const size = Math.max(1, Math.trunc(pageSize) || 1);
  const count = Math.max(0, Math.trunc(total) || 0);
  const pages = Math.max(1, Math.ceil(count / size));
  const p = Math.min(pages, Math.max(1, Math.trunc(page) || 1));
  const offset = (p - 1) * size;
  return {
    page: p,
    pages,
    pageSize: size,
    total: count,
    offset,
    from: count === 0 ? 0 : offset + 1,
    to: Math.min(count, offset + size),
    hasPrev: p > 1,
    hasNext: p < pages,
  };
}

/** Case- and accent-insensitive substring match across `fields` (or every own string value). */
function filterRows(rows, query, fields) {
  const q = String(query ?? "")
    .trim()
    .toLowerCase();
  if (!q) return [...(rows ?? [])];
  const terms = q.split(/\s+/);
  return (rows ?? []).filter((row) => {
    const hay = (fields ?? Object.keys(row ?? {}))
      .map((f) => row?.[f])
      .filter((v) => typeof v === "string" || typeof v === "number")
      .join(" ")
      .toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}

/**
 * Parse a shell `nav` attribute. Entries are comma-separated:
 *   "Documents=/documents=document"  label = href = icon name
 *   "Settings=/settings"             icon omitted
 *   "--Operate"                      a group heading
 * Returns [{ kind: "group"|"link", label, href, icon }].
 */
function parseNav(spec) {
  return String(spec ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      if (s.startsWith("--")) return { kind: "group", label: s.slice(2).trim() };
      const [label = "", href = "/", ic = ""] = s.split("=").map((p) => p.trim());
      return { kind: "link", label, href, icon: ic };
    })
    .filter((n) => n.label);
}

/** Which nav href is the current page, by longest-prefix match. Pure so it can be tested. */
function activeNavHref(items, path) {
  const p = (String(path ?? "/").replace(/\/+$/, "") || "/").toLowerCase();
  let best = null;
  for (const n of items) {
    if (n.kind !== "link") continue;
    const h = (n.href.split(/[?#]/)[0].replace(/\/+$/, "") || "/").toLowerCase();
    if (h === p) return n.href;
    if (h !== "/" && p.startsWith(`${h}/`) && (!best || h.length > best.len))
      best = { href: n.href, len: h.length };
  }
  return best?.href ?? null;
}

/**
 * Where to put a floating card (tour step, popover) next to `target`, kept inside the viewport.
 * Pure rectangle maths — `target` and `card` are {width,height} / DOMRect-shaped.
 */
function placeCard(target, card, viewport, { gap = 10, scrollX = 0, scrollY = 0 } = {}) {
  const below = target.bottom + gap + card.height <= viewport.height;
  const top = below ? target.bottom + gap : Math.max(gap, target.top - gap - card.height);
  const left = Math.min(Math.max(gap, target.left), Math.max(gap, viewport.width - card.width - gap));
  return { top: top + scrollY, left: left + scrollX, placement: below ? "below" : "above" };
}

// ─────────────────────────────── render helpers ───────────────────────────────

function emptyState({ icon: iconName = "document", title, body = "", actions = "", kind = "" } = {}) {
  return `<div class="arag-emptystate${kind ? ` ${esc(kind)}` : ""}">
      ${iconName ? `<span class="arag-icon-box">${icon(iconName, { size: 20 })}</span>` : ""}
      <h2>${esc(title)}</h2>${body ? `<p>${esc(body)}</p>` : ""}
      ${actions ? `<div class="actions">${actions}</div>` : ""}
    </div>`;
}

/** What happened · what it affects · what to do, with the machine detail behind a disclosure. */
function errorState(err, { retry = "" } = {}) {
  const detail = err?.problem?.detail || err?.message || "The service did not respond.";
  const code = err?.status ? `HTTP ${err.status}` : "";
  const rid = err?.problem?.requestId ? ` · request ${esc(err.problem.requestId)}` : "";
  return `<div class="arag-alert error arag-prose" role="alert">
      <div>${esc(detail)}</div>
      ${retry ? `<div style="margin-top:8px">${retry}</div>` : ""}
      ${code ? `<details style="margin-top:8px"><summary class="small">Details</summary><span class="small mono">${esc(code)}${rid}</span></details>` : ""}
    </div>`;
}

const skeletonRows = (n = 6) =>
  `<div aria-busy="true" aria-label="Loading">${Array.from(
    { length: n },
    () => '<div class="arag-skeleton row" aria-hidden="true"></div>',
  ).join("")}</div>`;

/** A code block with a copy button. Wire it with wireCopy(host) after inserting. */
const snippet = (text, { lang = "" } = {}) =>
  `<pre class="arag-snippet"${lang ? ` data-lang="${esc(lang)}"` : ""}><button class="copy" type="button">Copy</button>${esc(text)}</pre>`;

function wireCopy(root = HAS_DOM ? document : null) {
  if (!root) return;
  for (const btn of root.querySelectorAll(".arag-snippet .copy")) {
    if (btn.dataset.wired) continue;
    btn.dataset.wired = "1";
    btn.addEventListener("click", async () => {
      const pre = btn.closest(".arag-snippet");
      const text = [...pre.childNodes]
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent)
        .join("");
      try {
        await navigator.clipboard.writeText(text.trim());
        btn.textContent = "Copied";
        announce("Copied to clipboard");
        setTimeout(() => {
          btn.textContent = "Copy";
        }, 1600);
      } catch {
        toast("Could not copy — select the text instead", "error");
      }
    });
  }
}

// ─────────────────────────────── overlays ───────────────────────────────

let openOverlay = null;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function trapFocus(container) {
  container.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const items = [...container.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });
}

/** Make the page behind an overlay unreachable — not merely untabbable. */
function inertBackground(on) {
  const app = document.querySelector(".arag-app") ?? document.querySelector("arag-shell");
  if (!app) return;
  app.inert = on;
  if (on) app.setAttribute("aria-hidden", "true");
  else app.removeAttribute("aria-hidden");
}

/**
 * Right-hand drawer. Returns { host, close }. Escape and the scrim close it, focus is trapped and
 * returns to the trigger, and `onClose` is where a route-backed drawer pops the hash so Back works.
 *
 * `title`, `sub`, `body` and `foot` are HTML — that is the contract, because a drawer head carries
 * chips and its body carries a form. Run any value that came from a user or from ARAG through
 * `esc()` before interpolating it.
 */
function openDrawer({ title, body = "", foot = "", sub = "", wide = false, side = "right", onClose }) {
  closeOverlay();
  const host = document.createElement("div");
  host.innerHTML = `
    <div class="arag-drawer-backdrop" data-close></div>
    <aside class="arag-drawer${wide ? " wide" : ""}${side === "left" ? " left" : ""}" role="dialog"
           aria-modal="true" aria-labelledby="aragDrawerTitle">
      <div class="head">
        <div><h2 id="aragDrawerTitle" tabindex="-1">${title}</h2>${sub ? `<div class="sub">${sub}</div>` : ""}</div>
        <button class="arag-btn ghost sm close" type="button" data-close aria-label="Close">${icon("x")}</button>
      </div>
      <div class="body">${body}</div>
      ${foot ? `<div class="foot">${foot}</div>` : ""}
    </aside>`;
  document.body.appendChild(host);
  const el = host.querySelector(".arag-drawer");
  requestAnimationFrame(() => el.classList.add("is-open"));
  inertBackground(true);
  const trigger = document.activeElement;
  host.querySelector("#aragDrawerTitle").focus();
  trapFocus(el);
  wireCopy(host);
  const close = () => {
    host.remove();
    inertBackground(false);
    openOverlay = null;
    trigger?.focus?.();
    onClose?.();
  };
  for (const b of host.querySelectorAll("[data-close]")) b.addEventListener("click", close);
  openOverlay = { close, el: host };
  return { host, close };
}

/**
 * Confirmation for anything destructive. Resolves true/false. Focus starts on Cancel, never on the
 * verb. Pass `typed: "delete 12 documents"` for the type-to-confirm variant: the confirm button
 * stays disabled until the text matches exactly.
 *
 * `title` and `body` are HTML (a confirm body names the objects it is about, in <strong>); escape
 * anything user-supplied with `esc()`. `confirmLabel` and `typed` are escaped for you.
 */
function confirmDialog({ title, body = "", confirmLabel = "Delete", typed = null, danger = true } = {}) {
  return new Promise((resolvePromise) => {
    closeOverlay();
    const host = document.createElement("div");
    host.className = "arag-modal-backdrop";
    host.innerHTML = `
      <div class="arag-modal arag-confirm" role="alertdialog" aria-modal="true"
           aria-labelledby="aragConfirmTitle" aria-describedby="aragConfirmBody">
        <div class="head"><h2 id="aragConfirmTitle" tabindex="-1">${title}</h2></div>
        <div class="body" id="aragConfirmBody">${body}
          ${
            typed
              ? `<div class="arag-field" style="margin-top:12px">
                   <label for="aragTyped">Type <code>${esc(typed)}</code> to confirm</label>
                   <input class="arag-input" id="aragTyped" autocomplete="off" autocapitalize="off" spellcheck="false" />
                 </div>`
              : ""
          }
        </div>
        <div class="foot">
          <button class="arag-btn ghost" type="button" data-cancel>Cancel</button>
          <button class="arag-btn${danger ? " danger" : ""}" type="button" data-ok${typed ? " disabled" : ""}>${esc(confirmLabel)}</button>
        </div>
      </div>`;
    document.body.appendChild(host);
    inertBackground(true);
    const trigger = document.activeElement;
    const ok = host.querySelector("[data-ok]");
    const done = (value) => {
      host.remove();
      inertBackground(false);
      openOverlay = null;
      trigger?.focus?.();
      resolvePromise(value);
    };
    if (typed) {
      const input = host.querySelector("#aragTyped");
      input.addEventListener("input", () => {
        ok.disabled = input.value.trim() !== typed;
      });
    }
    host.querySelector("[data-cancel]").addEventListener("click", () => done(false));
    ok.addEventListener("click", () => done(true));
    host.addEventListener("click", (e) => {
      if (e.target === host) done(false);
    });
    trapFocus(host);
    host.querySelector("[data-cancel]").focus();
    openOverlay = { close: () => done(false), el: host };
  });
}

function closeOverlay() {
  openOverlay?.close();
}

/**
 * Row-actions menu. `itemsFactory()` returns [{ label, onSelect, danger, hidden, href }]. The
 * trigger carries the object's name in its accessible label, so twenty identical `⋯` buttons in a
 * table are still distinguishable.
 */
function menuButton(itemsFactory, { ariaLabel = "Actions", align = "right" } = {}) {
  const wrap = document.createElement("div");
  wrap.className = "arag-menu";
  wrap.innerHTML = `<button class="trigger" type="button" aria-haspopup="menu" aria-expanded="false" aria-label="${esc(ariaLabel)}">${icon("more-horizontal")}</button>`;
  const trigger = wrap.firstElementChild;
  let panel = null;
  const onOutside = (e) => {
    if (!wrap.contains(e.target)) close();
  };
  const close = () => {
    panel?.remove();
    panel = null;
    trigger.setAttribute("aria-expanded", "false");
    document.removeEventListener("click", onOutside, true);
  };
  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    if (panel) return close();
    panel = document.createElement("div");
    panel.className = `panel${align === "left" ? " left" : ""}`;
    panel.setAttribute("role", "menu");
    for (const item of itemsFactory().filter((i) => i && !i.hidden)) {
      if (item.separator) {
        const sep = document.createElement("div");
        sep.className = "sep";
        panel.appendChild(sep);
        continue;
      }
      const b = document.createElement(item.href ? "a" : "button");
      if (item.href) b.href = item.href;
      else b.type = "button";
      b.setAttribute("role", "menuitem");
      if (item.danger) b.className = "danger";
      b.textContent = item.label;
      b.addEventListener("click", (ev) => {
        if (!item.href) ev.preventDefault();
        ev.stopPropagation();
        close();
        item.onSelect?.();
      });
      panel.appendChild(b);
    }
    wrap.appendChild(panel);
    trigger.setAttribute("aria-expanded", "true");
    panel.querySelector("button, a")?.focus();
    document.addEventListener("click", onOutside, true);
    panel.addEventListener("keydown", (ev) => {
      const items = [...panel.querySelectorAll("button, a")];
      const i = items.indexOf(document.activeElement);
      if (ev.key === "ArrowDown") items[(i + 1) % items.length]?.focus();
      else if (ev.key === "ArrowUp") items[(i - 1 + items.length) % items.length]?.focus();
      else if (ev.key === "Escape") {
        close();
        trigger.focus();
        // The document-level Escape handler closes the OPEN OVERLAY. A menu nested inside a drawer
        // must not take the drawer with it, so the event stops here.
        ev.stopPropagation();
      } else return;
      ev.preventDefault();
    });
  });
  return wrap;
}

/** A small explanatory popover anchored under `anchor`. `html` is HTML — escape untrusted values. */
function popover(anchor, html) {
  const existing = document.querySelector(".arag-popover");
  const already = existing?.dataset.for === anchor.id;
  existing?.remove();
  if (already) return null;
  const el = document.createElement("div");
  el.className = "arag-popover";
  el.dataset.for = anchor.id;
  el.setAttribute("role", "dialog");
  el.innerHTML = html;
  document.body.appendChild(el);
  const r = anchor.getBoundingClientRect();
  const pos = placeCard(
    r,
    { width: el.offsetWidth, height: el.offsetHeight },
    { width: window.innerWidth, height: window.innerHeight },
    { gap: 6, scrollX: window.scrollX, scrollY: window.scrollY },
  );
  el.style.top = `${pos.top}px`;
  el.style.left = `${pos.left}px`;
  setTimeout(() => {
    document.addEventListener("click", function once(e) {
      if (!el.contains(e.target)) {
        el.remove();
        document.removeEventListener("click", once);
      }
    });
  }, 0);
  return el;
}

/**
 * Guided tour. `steps` is [{ target: selector, title, body }] — `title` is escaped, `body` is HTML.
 * Advisory, never a cage: the scrim does not capture clicks, so the user can do the thing the step
 * describes. Returns { stop }.
 */
function tour(steps, { onDone, storageKey } = {}) {
  if (!steps?.length) return { stop() {} };
  // A coachmark is not modal: it keeps role="dialog" but no aria-modal, and the page underneath
  // stays clickable. It does register as the open overlay, so opening a real drawer or a confirm
  // (or pressing Escape) ends the tour instead of stacking two dialogs on top of each other.
  closeOverlay();
  const scrim = document.createElement("div");
  scrim.className = "arag-tour-scrim";
  const card = document.createElement("div");
  card.className = "arag-tour-card";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-live", "polite");
  document.body.append(scrim, card);
  let i = 0;
  let marked = null;
  const stop = () => {
    marked?.classList.remove("arag-tour-target");
    scrim.remove();
    card.remove();
    document.removeEventListener("keydown", onKey);
    if (openOverlay?.el === card) openOverlay = null;
    try {
      if (storageKey) localStorage.setItem(storageKey, "done");
    } catch {
      /* private mode */
    }
    onDone?.();
  };
  const onKey = (e) => {
    if (e.key === "Escape") stop();
  };
  const show = () => {
    const s = steps[i];
    marked?.classList.remove("arag-tour-target");
    marked = s.target ? document.querySelector(s.target) : null;
    marked?.classList.add("arag-tour-target");
    marked?.scrollIntoView({ block: "center", behavior: "smooth" });
    card.innerHTML = `<div class="step">Step ${i + 1} of ${steps.length}</div>
      <h3>${esc(s.title)}</h3><p>${s.body}</p>
      <div class="actions"><button class="arag-btn ghost sm" type="button" data-skip>Skip</button>
        <span class="spacer"></span>
        ${i > 0 ? '<button class="arag-btn ghost sm" type="button" data-prev>Back</button>' : ""}
        <button class="arag-btn sm" type="button" data-next>${i === steps.length - 1 ? "Done" : "Next"}</button></div>`;
    const r = marked?.getBoundingClientRect() ?? {
      top: window.innerHeight / 2,
      bottom: window.innerHeight / 2,
      left: window.innerWidth / 2 - 165,
    };
    const pos = placeCard(
      r,
      { width: card.offsetWidth, height: card.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
      { scrollX: window.scrollX, scrollY: window.scrollY },
    );
    card.style.top = `${pos.top}px`;
    card.style.left = `${pos.left}px`;
    card.querySelector("[data-skip]").addEventListener("click", stop);
    card.querySelector("[data-prev]")?.addEventListener("click", () => {
      i--;
      show();
    });
    card.querySelector("[data-next]").addEventListener("click", () => {
      if (i === steps.length - 1) return stop();
      i++;
      show();
    });
    card.querySelector("[data-next]").focus();
  };
  document.addEventListener("keydown", onKey);
  show();
  openOverlay = { close: stop, el: card };
  return { stop };
}

// ─────────────────────────────── tabs / segmented / table ───────────────────────────────

/**
 * Keyboard behaviour a tablist owes a screen-reader user: Left/Right between tabs, Home/End to the
 * ends, Space to activate. Works for both forms — <button role="tab"> (in-page panels) and
 * <a role="tab"> (a tab that is a real route). Optionally points `panel` back at the selected tab.
 */
function wireTabs(tablist, panel) {
  if (!tablist) return;
  const tabs = [...tablist.querySelectorAll('[role="tab"]')];
  if (!tabs.length) return;
  // Idempotent, like wireTable: re-marking the selected tab must not add a second keydown handler.
  const rewire = wiredBehaviours.has(tablist);
  const selected = tabs.find((t) => t.getAttribute("aria-selected") === "true") ?? tabs[0];
  for (const t of tabs) t.tabIndex = t === selected ? 0 : -1;
  if (panel) {
    if (!selected.id) selected.id = `aragTab-${Math.random().toString(36).slice(2, 8)}`;
    if (!panel.id) panel.id = "aragTabPanel";
    panel.setAttribute("aria-labelledby", selected.id);
    selected.setAttribute("aria-controls", panel.id);
  }
  if (rewire) return;
  wiredBehaviours.add(tablist);
  tablist.addEventListener("keydown", (e) => {
    // Re-read on every keypress: a re-render may have replaced the tabs since we were wired.
    const live = [...tablist.querySelectorAll('[role="tab"]')];
    const i = live.indexOf(document.activeElement);
    if (i === -1) return;
    let next = null;
    if (e.key === "ArrowRight") next = live[(i + 1) % live.length];
    else if (e.key === "ArrowLeft") next = live[(i - 1 + live.length) % live.length];
    else if (e.key === "Home") next = live[0];
    else if (e.key === "End") next = live[live.length - 1];
    else if (e.key === " " || e.key === "Spacebar") {
      e.preventDefault();
      live[i].click();
      return;
    }
    if (!next) return;
    e.preventDefault();
    for (const t of live) t.tabIndex = t === next ? 0 : -1;
    next.focus();
  });
}

/**
 * Segmented control: one selected option, arrow keys move and select. Calls onChange(value).
 * Idempotent and delegated, like wireTable and wireTabs.
 */
function wireSegmented(root, onChange) {
  if (!root) return;
  const options = () => [...root.querySelectorAll("button")];
  const select = (btn) => {
    for (const b of options()) {
      const on = b === btn;
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
    }
    segmentedHandlers.get(root)?.(btn.dataset.value ?? btn.textContent.trim(), btn);
  };
  for (const b of options()) b.tabIndex = b.getAttribute("aria-selected") === "true" ? 0 : -1;
  // The callback lives outside the closure, so re-wiring swaps it without rebinding listeners.
  segmentedHandlers.set(root, onChange);
  if (wiredBehaviours.has(root)) return;
  wiredBehaviours.add(root);
  root.addEventListener("click", (e) => {
    const btn = e.target.closest?.("button");
    if (btn && root.contains(btn)) select(btn);
  });
  root.addEventListener("keydown", (e) => {
    const live = options();
    const i = live.indexOf(document.activeElement);
    if (i === -1) return;
    let next = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = live[(i + 1) % live.length];
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = live[(i - 1 + live.length) % live.length];
    if (!next) return;
    e.preventDefault();
    next.focus();
    select(next);
  });
}

/**
 * Wire an already-rendered `.arag-datatable`: sortable headers, a select-all checkbox with a real
 * indeterminate state, per-row checkboxes, the bulk bar, row activation and pagination.
 *
 * Markup contract (see docs/ui-kit.md):
 *   th[data-sort="key"] > button        header sort control (aria-sort lives on the th)
 *   input[data-check-all]               select-all
 *   input[data-check="id"]              row checkbox
 *   [data-bulkbar] / [data-bulk-count]  bulk bar + its live count
 *   tr[data-href] / tr[data-id]         row target
 *   [data-page="prev|next|N"]           pagination controls
 *
 * Returns { selected: Set, refresh() }. Callbacks: onSort({key,dir}), onSelect(Set), onOpen(id,row),
 * onPage(page).
 */
const wiredTables = new WeakMap();
/** Roots whose delegated listeners are already attached (wireTabs / wireSegmented). */
const wiredBehaviours = new WeakSet();
const segmentedHandlers = new WeakMap();

function wireTable(root, opts = {}) {
  if (!root) return { selected: opts.selected ?? new Set(), refresh() {} };
  // Idempotent: a list view that re-renders its rows calls this again with the same root. Binding a
  // second set of listeners would fire every callback twice (and three times after the next
  // render), so an already-wired root just swaps its callbacks and re-reads its state.
  const wired = wiredTables.get(root);
  if (wired) {
    Object.assign(wired.opts, opts);
    wired.handle.selected = wired.opts.selected;
    wired.refresh();
    return wired.handle;
  }
  const state = { opts: { selected: new Set(), ...opts } };
  // Everything reads through `state.opts`, never through a captured local, so re-wiring with new
  // callbacks (or a new selection Set) takes effect without rebinding a thing.
  const call = (name, ...args) => state.opts[name]?.(...args);
  const sel = () => state.opts.selected;
  // Re-queried rather than captured: a re-render replaces these nodes.
  const master = () => root.querySelector("[data-check-all]");
  const boxes = () => [...root.querySelectorAll("[data-check]")];

  const refresh = () => {
    const bs = boxes();
    const on = bs.filter((b) => b.checked).length;
    const m = master();
    if (m) {
      m.checked = bs.length > 0 && on === bs.length;
      m.indeterminate = on > 0 && on < bs.length;
    }
    for (const b of bs) b.closest("tr")?.setAttribute("aria-selected", String(b.checked));
    const bar = root.querySelector("[data-bulkbar]");
    if (bar) bar.hidden = sel().size === 0;
    const count = root.querySelector("[data-bulk-count]");
    if (count) count.textContent = `${sel().size} selected`;
  };

  // All handlers are delegated from the root, so they survive a tbody (or a whole-table) re-render.
  root.addEventListener("click", (e) => {
    const th = e.target.closest?.("th[data-sort]");
    if (th && root.contains(th)) {
      const key = th.dataset.sort;
      const current = [...root.querySelectorAll("th[data-sort]")]
        .filter((t) => (t.getAttribute("aria-sort") ?? "none") !== "none")
        .map((t) => ({ key: t.dataset.sort, dir: t.getAttribute("aria-sort") }))[0];
      const next = nextSort(current, key);
      for (const t of root.querySelectorAll("th[data-sort]"))
        t.setAttribute("aria-sort", t.dataset.sort === next.key ? next.dir : "none");
      call("onSort", next);
      return;
    }
    const pager = e.target.closest?.("[data-page]");
    if (pager && root.contains(pager)) {
      call("onPage", pager.dataset.page);
      return;
    }
    // Whole-row click is a convenience only — the first cell always holds a real anchor, and
    // clicks on a control, a link or the checkbox cell never navigate.
    const tr = e.target.closest?.("tbody tr");
    if (!tr || e.target.closest("a, button, input, label, .arag-menu")) return;
    if (tr.dataset.href) location.assign(tr.dataset.href);
    else if (tr.dataset.id) call("onOpen", tr.dataset.id, tr);
  });

  root.addEventListener("change", (e) => {
    const m = e.target.closest?.("[data-check-all]");
    if (m) {
      for (const b of boxes()) {
        b.checked = m.checked;
        if (m.checked) sel().add(b.dataset.check);
        else sel().delete(b.dataset.check);
      }
      refresh();
      announce(`${sel().size} selected`);
      call("onSelect", sel());
      return;
    }
    const box = e.target.closest?.("[data-check]");
    if (!box) return;
    if (box.checked) sel().add(box.dataset.check);
    else sel().delete(box.dataset.check);
    refresh();
    call("onSelect", sel());
  });

  root.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const tr = e.target.closest?.("tbody tr[tabindex]");
    if (!tr || e.target !== tr) return;
    e.preventDefault();
    if (tr.dataset.href) location.assign(tr.dataset.href);
    else call("onOpen", tr.dataset.id, tr);
  });

  refresh();
  state.refresh = refresh;
  state.handle = { selected: state.opts.selected, refresh };
  wiredTables.set(root, state);
  return state.handle;
}

// ─────────────────────────────── components ───────────────────────────────

// Custom elements extend HTMLElement, which is evaluated when the class is defined — so in Node
// (where the unit tests import this module for its pure half) the base is an inert stub instead.
const ElementBase = typeof HTMLElement !== "undefined" ? HTMLElement : class {};

/** Where the kit's own assets are mounted. Products that serve the kit somewhere other than /ui
    override it per shell with `brand-base="/assets/arag"`. */
const BRAND_BASE = "/ui/brand";

const BAND_HTML = (docs, admin, brandBase = BRAND_BASE, poweredByAttr = " data-powered-by") => `
  <div class="arag-appband"${poweredByAttr}>
    <button class="arag-rail-menu arag-btn on-dark sm" type="button" aria-label="Show navigation"
            aria-expanded="false" aria-controls="aragRail">${icon("menu")}</button>
    <a class="wordmark" href="/" aria-label="Progress Agentic RAG">
      <img src="${esc(brandBase)}/arag-logo-alt.svg" alt="" aria-hidden="true" /></a>
    <span class="spacer"></span>
    <a href="${esc(docs)}" data-docs-link>API docs</a>
    ${admin ? `<a href="${esc(admin)}">Admin</a>` : ""}
  </div>`;

function railNavHtml(items, path) {
  const active = activeNavHref(items, path);
  return items
    .map((n) =>
      n.kind === "group"
        ? `<div class="group">${esc(n.label)}</div>`
        : `<a href="${esc(n.href)}" data-nav="${esc(n.label)}" title="${esc(n.label)}"${n.href === active ? ' aria-current="page"' : ""}>${
            n.icon ? icon(n.icon, { size: 18 }) : ""
          }<span>${esc(n.label)}</span></a>`,
    )
    .join("");
}

/**
 * Left-rail application shell — the shape all three product passes converged on.
 *
 * <arag-app-shell product="Docs" tagline="…" nav="--Workspace,Documents=/=document,Settings=/settings=settings"
 *                 docs-href="/api/v1/docs" admin-href="/admin/" branding-src="/api/v1/branding"
 *                 status-endpoint="/readyz" rail="dark|light" brand-base="/ui/brand" collapsible>
 *   …page content…
 * </arag-app-shell>
 *
 * The Progress wordmark sits in the band, once. The rail's identity block carries the PRODUCT's
 * name, tagline and (when BRAND_LOGO_URL is set) the partner's mark — never a second wordmark.
 */
class AragAppShell extends ElementBase {
  connectedCallback() {
    if (this._rendered) return;
    this._rendered = true;
    const product = this.getAttribute("product") ?? "ARAG product";
    const tagline = this.getAttribute("tagline") ?? "";
    const nav = parseNav(this.getAttribute("nav"));
    const docs = this.getAttribute("docs-href") ?? "/api/v1/docs";
    const admin = this.getAttribute("admin-href");
    const home = this.getAttribute("home-href") ?? nav.find((n) => n.kind === "link")?.href ?? "/";
    const statusEndpoint = this.getAttribute("status-endpoint") ?? "/readyz";
    const collapsible = this.hasAttribute("collapsible");
    const brandBase = this.getAttribute("brand-base") ?? BRAND_BASE;
    const path = location.pathname;
    const content = Array.from(this.childNodes);
    let rail = "expanded";
    try {
      if (collapsible && localStorage.getItem("arag.rail") === "collapsed") rail = "collapsed";
    } catch {
      /* private mode */
    }
    const railTheme = this.getAttribute("rail") === "light" ? "light" : "dark";
    this.innerHTML = `
      <a class="arag-skip" href="#main">Skip to content</a>
      <div class="arag-app" data-rail="${rail}" data-rail-theme="${railTheme}">
        ${BAND_HTML(docs, admin, brandBase)}
        <div class="body">
          <nav class="arag-rail" id="aragRail" aria-label="Product">
            <a class="ident" href="${esc(home)}">
              <img data-brand-logo alt="" hidden />
              <span class="name" data-brand-name>${esc(product)}</span>
              <span class="tag" data-brand-tagline${tagline ? "" : " hidden"}>${esc(tagline)}</span>
            </a>
            <div class="arag-railnav">${railNavHtml(nav, path)}</div>
            ${
              collapsible
                ? `<button class="arag-rail-toggle" type="button" aria-expanded="${rail === "expanded"}"
                     aria-controls="aragRail">${icon("chevron-left")}<span>Collapse</span></button>`
                : ""
            }
            <div class="foot">
              <arag-status endpoint="${esc(statusEndpoint)}" label="Knowledge Box" title="Knowledge Box"></arag-status>
              <span data-brand-footer data-powered-by-credit>Built on Progress Agentic RAG</span>
            </div>
          </nav>
          <main class="arag-main" id="main" tabindex="-1">
            <div class="arag-content" data-slot="content"></div>
          </main>
        </div>
      </div>
      <div class="sr-only" id="aragLive" role="status" aria-live="polite"></div>`;
    const host = this.querySelector('[data-slot="content"]');
    for (const n of content) host.appendChild(n);

    const app = this.querySelector(".arag-app");
    // Mobile drawer.
    const menu = this.querySelector(".arag-rail-menu");
    const openRail = (on) => {
      app.dataset.rail = on ? "open" : rail;
      menu.setAttribute("aria-expanded", String(on));
      this.querySelector(".arag-scrim")?.remove();
      if (on) {
        const scrim = document.createElement("div");
        scrim.className = "arag-scrim";
        scrim.addEventListener("click", () => openRail(false));
        app.appendChild(scrim);
        this.querySelector(".arag-railnav a")?.focus();
      }
    };
    menu.addEventListener("click", () => openRail(app.dataset.rail !== "open"));
    this._onHash = () => openRail(false);
    this._onKey = (e) => {
      if (e.key === "Escape" && app.dataset.rail === "open") openRail(false);
    };
    window.addEventListener("hashchange", this._onHash);
    document.addEventListener("keydown", this._onKey);
    // Collapsible rail (>= 900px).
    const toggle = this.querySelector(".arag-rail-toggle");
    toggle?.addEventListener("click", () => {
      rail = rail === "collapsed" ? "expanded" : "collapsed";
      app.dataset.rail = rail;
      toggle.setAttribute("aria-expanded", String(rail === "expanded"));
      toggle.querySelector("span").textContent = rail === "collapsed" ? "Expand" : "Collapse";
      try {
        localStorage.setItem("arag.rail", rail);
      } catch {
        /* private mode */
      }
    });
    if (toggle && rail === "collapsed") toggle.querySelector("span").textContent = "Expand";

    // A client-side router changes the URL without a reload, so the rail has to be told. popstate
    // and hashchange are handled here; a pushState router calls setActivePath() after it renders
    // (history.pushState fires no event, and the kit will not monkey-patch History to invent one).
    // Kept on the instance so disconnectedCallback can remove them: a host app that destroys and
    // recreates the shell must not leak a listener onto window/document per instance.
    this._onNavigate = () => this.setActivePath();
    for (const ev of ["popstate", "hashchange"]) window.addEventListener(ev, this._onNavigate);
    this.querySelector(".arag-railnav")?.addEventListener("click", (e) => {
      const a = e.target.closest?.("a[href]");
      if (a) this.setActivePath(new URL(a.href, location.href).pathname);
    });

    wireCopy(this);
    loadBranding(this);
  }
  disconnectedCallback() {
    if (this._onNavigate)
      for (const ev of ["popstate", "hashchange"]) window.removeEventListener(ev, this._onNavigate);
    if (this._onHash) window.removeEventListener("hashchange", this._onHash);
    if (this._onKey) document.removeEventListener("keydown", this._onKey);
  }
  /**
   * Re-mark the current rail item. Call it after a pushState navigation; with no argument it reads
   * `location.pathname`. Matching is longest-prefix, so /notes/abc keeps "Notes" current.
   */
  setActivePath(path = location.pathname) {
    const links = [...this.querySelectorAll(".arag-railnav a[href]")];
    const items = links.map((a) => ({
      kind: "link",
      label: a.dataset.nav ?? "",
      href: a.getAttribute("href"),
    }));
    const active = activeNavHref(items, path);
    for (const a of links) {
      if (a.getAttribute("href") === active) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    }
  }
  /** Nav badge, e.g. setNavBadge("Jobs", 3). */
  setNavBadge(label, value) {
    const a = this.querySelector(`[data-nav="${CSS.escape(label)}"]`);
    if (!a) return;
    a.querySelector(".count")?.remove();
    if (!Number(value)) return;
    const s = document.createElement("span");
    s.className = "count";
    s.textContent = String(value);
    a.appendChild(s);
  }
  onBranding() {
    /* applyBranding() drives every data-brand-* hook in this shell already. */
  }
}

function loadBranding(el) {
  const src = el.getAttribute("branding-src") ?? "/api/v1/branding";
  if (window.__aragBranding) applyBranding(window.__aragBranding);
  else if (src !== "none")
    api(src)
      .then((b) => applyBranding(b))
      .catch(() => undefined);
}

/** Two-band product shell (marketing / single-page demos). `layout="rail"` renders the application
    shell instead, so a product can migrate by changing one attribute. */
class AragShell extends ElementBase {
  connectedCallback() {
    if (this.getAttribute("layout") === "rail") return AragAppShell.prototype.connectedCallback.call(this);
    const product = this.getAttribute("product") ?? "ARAG Product";
    const tagline = this.getAttribute("tagline") ?? "";
    const nav = parseNav(this.getAttribute("nav"));
    const path = location.pathname.replace(/\/$/, "") || "/";
    const brandBase = this.getAttribute("brand-base") ?? BRAND_BASE;
    const docs = this.getAttribute("docs-href") ?? "/api/v1/docs";
    const admin = this.getAttribute("admin-href");
    const content = Array.from(this.childNodes);
    this.innerHTML = `
      <div class="arag-band" data-powered-by><div class="arag-container">
        <span class="brand"><img src="${esc(brandBase)}/arag-logo-alt.svg" alt="Progress Agentic RAG" style="height:16px;width:auto" /></span>
        <span class="band-actions">
          <a class="arag-btn on-dark sm" href="${esc(docs)}" data-docs-link>API docs</a>
          ${admin ? `<a class="arag-btn on-dark sm" href="${esc(admin)}">Admin</a>` : ""}
        </span>
      </div></div>
      <header class="arag-header"><div class="arag-container">
        <a class="product" href="/"><img data-brand-logo alt="" style="height:26px;width:auto" hidden /><span data-brand-name>${esc(product)}</span><span class="tag" data-brand-tagline${tagline ? "" : " hidden"}>${esc(tagline)}</span></a>
        <nav class="arag-nav">${nav
          .filter((n) => n.kind === "link")
          .map(
            (n) =>
              `<a href="${esc(n.href)}"${(n.href.replace(/\/$/, "") || "/") === path ? ' aria-current="page"' : ""}>${esc(n.label)}</a>`,
          )
          .join("")}</nav>
        <span class="spacer"></span>
        <arag-status endpoint="/readyz" label="service"></arag-status>
      </div></header>
      <main class="arag-main"><div class="arag-container" data-slot="content"></div></main>
      <footer class="arag-footer"><div class="arag-container"><span data-brand-footer>Open source · Apache-2.0</span>
        <span class="credit" data-powered-by-credit><img src="${esc(brandBase)}/arag-logo.svg" alt="Built on Progress Agentic RAG" /></span></div></footer>
      <div class="sr-only" id="aragLive" role="status" aria-live="polite"></div>`;
    const host = this.querySelector('[data-slot="content"]');
    for (const n of content) host.appendChild(n);
    loadBranding(this);
  }
  onBranding() {}
}

/** Declarative icon: <arag-icon name="search" size="18" label="Search"></arag-icon>. */
class AragIcon extends ElementBase {
  static get observedAttributes() {
    return ["name", "size", "label"];
  }
  connectedCallback() {
    this.render();
  }
  attributeChangedCallback() {
    if (this.isConnected) this.render();
  }
  render() {
    this.style.display = "inline-flex";
    this.innerHTML = icon(this.getAttribute("name"), {
      size: Number(this.getAttribute("size") ?? 16),
      label: this.getAttribute("label") ?? "",
    });
  }
}

/** Live status pill polling a JSON endpoint ({ok:boolean, ...}). Attributes: endpoint, label, interval */
class AragStatus extends ElementBase {
  connectedCallback() {
    this.className = "arag-status";
    this.dataset.state = "busy";
    this.innerHTML = `<span class="dot"></span><span class="txt">${esc(this.getAttribute("label") ?? "status")}</span>`;
    this.poll();
    this.timer = setInterval(() => this.poll(), Number(this.getAttribute("interval") ?? 15000));
  }
  disconnectedCallback() {
    clearInterval(this.timer);
  }
  async poll() {
    try {
      const d = await api(this.getAttribute("endpoint") ?? "/readyz");
      const ok = d?.ok !== false && d?.arag?.ok !== false;
      this.dataset.state = ok ? "ok" : "warn";
      const text = `${this.getAttribute("label") ?? "status"} · ${ok ? "online" : "degraded"}`;
      this.querySelector(".txt").textContent = text;
      // The collapsed rail hides the label, so the state has to survive somewhere readable.
      this.title = text;
      this.dispatchEvent(new CustomEvent("status", { detail: d }));
    } catch {
      this.dataset.state = "error";
      const text = `${this.getAttribute("label") ?? "status"} · offline`;
      this.querySelector(".txt").textContent = text;
      this.title = text;
    }
  }
}

function highlightJson(value) {
  const json = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return esc(json).replace(
    /("(?:\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(?:\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
    (m) => {
      let cls = "n";
      if (m.startsWith('"')) cls = m.endsWith(":") ? "k" : "s";
      else if (/true|false|null/.test(m)) cls = "b";
      return `<span class="${cls}">${m}</span>`;
    },
  );
}

/** Pretty JSON viewer. Set .data or attribute src (URL). */
class AragJson extends ElementBase {
  static get observedAttributes() {
    return ["src"];
  }
  set data(v) {
    this._data = v;
    this.render();
  }
  get data() {
    return this._data;
  }
  connectedCallback() {
    this.className = "arag-json";
    if (this.getAttribute("src")) this.load();
    else if (this.textContent.trim() && this._data === undefined) {
      try {
        this._data = JSON.parse(this.textContent);
      } catch {
        this._data = this.textContent;
      }
    }
    this.render();
  }
  attributeChangedCallback() {
    if (this.isConnected) this.load();
  }
  async load() {
    try {
      this._data = await api(this.getAttribute("src"));
    } catch (e) {
      this._data = { error: e.message };
    }
    this.render();
  }
  render() {
    this.innerHTML = this._data === undefined ? '<span class="subtle">—</span>' : highlightJson(this._data);
  }
}

/** Log viewer for /api/v1/admin/logs style records. Attributes: src, limit, level, refresh */
class AragLog extends ElementBase {
  connectedCallback() {
    this.className = "arag-log";
    this.load();
    const r = Number(this.getAttribute("refresh") ?? 0);
    if (r > 0) this.timer = setInterval(() => this.load(), r);
  }
  disconnectedCallback() {
    clearInterval(this.timer);
  }
  async load() {
    try {
      const q = new URLSearchParams();
      if (this.getAttribute("limit")) q.set("limit", this.getAttribute("limit"));
      if (this.getAttribute("level")) q.set("level", this.getAttribute("level"));
      if (this.getAttribute("contains")) q.set("contains", this.getAttribute("contains"));
      const d = await api(`${this.getAttribute("src") ?? "/api/v1/admin/logs"}?${q}`);
      const rows = d.items ?? d;
      this.innerHTML = rows
        .slice()
        .reverse()
        .map((r) => {
          const { ts, level, msg, ...rest } = r;
          return `<div class="line"><span>${esc(String(ts).slice(11, 19))}</span><span class="lvl-${esc(level)}">${esc(level)}</span><span>${esc(msg)} <span class="subtle">${esc(JSON.stringify(rest))}</span></span></div>`;
        })
        .join("");
    } catch (e) {
      this.innerHTML = `<div class="line"><span></span><span class="lvl-error">error</span><span>${esc(e.message)}</span></div>`;
    }
  }
}

/** Health card for admin pages: shows service + ARAG KB connectivity. Attribute: src (default /api/v1/admin/health) */
class AragHealth extends ElementBase {
  connectedCallback() {
    this.className = "arag-card pad";
    this.innerHTML = '<div class="muted">Checking…</div>';
    this.load();
  }
  async load() {
    try {
      const d = await api(this.getAttribute("src") ?? "/api/v1/admin/health");
      const a = d.arag ?? {};
      this.innerHTML = `
        <div class="arag-row" style="justify-content:space-between"><h3 style="margin:0">Health</h3>
          <span class="arag-chip ${d.ok ? "ok" : "danger"}">${d.ok ? "healthy" : "degraded"}</span></div>
        <dl class="arag-kv" style="margin-top:10px">
          <dt>Version</dt><dd>${esc(d.version ?? "—")}</dd>
          <dt>Uptime</dt><dd>${esc(d.uptimeSec !== undefined ? `${Math.round(d.uptimeSec / 60)} min` : "—")}</dd>
          <dt>ARAG KB</dt><dd>${esc(a.kbId ?? "—")} <span class="arag-chip ${a.ok ? "ok" : "danger"}">${a.ok ? `connected · ${fmtMs(a.ms)}` : esc(a.error ?? "unreachable")}</span></dd>
          <dt>Endpoint</dt><dd class="mono small">${esc(a.baseUrl ?? "—")}${a.mock ? ' <span class="arag-chip warn">mock</span>' : ""}</dd>
          <dt>Model</dt><dd>${esc(a.generativeModel ?? "KB default")}</dd>
          <dt>Resources</dt><dd>${esc(a.resources ?? "—")}</dd>
        </dl>`;
      this.dispatchEvent(new CustomEvent("health", { detail: d }));
    } catch (e) {
      this.innerHTML = `<div class="arag-alert error">${esc(e.message)}</div>`;
    }
  }
}

/** Job timeline: renders a Job's events as a stepper. Set .job or attribute src=/api/v1/jobs/{id}; live via events-src. */
class AragJobTimeline extends ElementBase {
  set job(j) {
    this._job = j;
    this.render();
  }
  connectedCallback() {
    if (this.getAttribute("src")) this.load();
    const ev = this.getAttribute("events-src");
    if (ev) {
      this._close = sse(ev, {
        event: (e) => this.apply(e),
        job: (j) => {
          this._job = j.job ?? j;
          this.render();
        },
      });
    }
    this.render();
  }
  disconnectedCallback() {
    this._close?.();
  }
  async load() {
    try {
      this._job = await api(this.getAttribute("src"));
    } catch (e) {
      this._job = { events: [], error: { message: e.message } };
    }
    this.render();
  }
  apply(e) {
    if (!this._job) this._job = { events: [] };
    this._job.events = [...(this._job.events ?? []), e];
    this.render();
  }
  render() {
    const j = this._job;
    if (!j) {
      this.innerHTML = '<div class="subtle">No job</div>';
      return;
    }
    const stages = new Map();
    for (const e of j.events ?? []) {
      const s = stages.get(e.stage) ?? { stage: e.stage, status: "start", message: "", ms: undefined };
      s.status = e.status === "progress" ? s.status : e.status;
      if (e.message) s.message = e.message;
      if (e.ms !== undefined) s.ms = e.ms;
      stages.set(e.stage, s);
    }
    const cls = (s) =>
      ({ start: "active", progress: "active", ok: "ok", error: "error", skip: "skip" })[s.status] ?? "";
    this.innerHTML = `<ol class="arag-steps">${[...stages.values()].map((s) => `<li class="${cls(s)}"><span class="ic"></span><span>${esc(s.stage)} <span class="subtle small">${esc(s.message)}</span></span><span class="meta">${esc(fmtMs(s.ms))}</span></li>`).join("")}</ol>
      ${j.status ? `<div class="arag-row small" style="margin-top:8px"><span class="arag-chip ${({ succeeded: "ok", failed: "danger", cancelled: "warn" })[j.status] ?? "info"}">${esc(j.status)}</span>${j.error ? `<span class="muted">${esc(j.error.message)}</span>` : ""}</div>` : ""}`;
  }
}

// ─────────────────────────────── registration ───────────────────────────────

const API = {
  api,
  toast,
  esc,
  fmtMs,
  fmtBytes,
  fmtRelative,
  sse,
  highlightJson,
  applyBranding,
  brandingPlan,
  brandingVars,
  announce,
  icon,
  iconNames,
  sortRows,
  nextSort,
  paginate,
  filterRows,
  parseNav,
  activeNavHref,
  placeCard,
  emptyState,
  errorState,
  skeletonRows,
  snippet,
  wireCopy,
  openDrawer,
  confirmDialog,
  closeOverlay,
  menuButton,
  popover,
  tour,
  wireTabs,
  wireSegmented,
  wireTable,
};

if (typeof customElements !== "undefined") {
  for (const [name, cls] of [
    ["arag-app-shell", AragAppShell],
    ["arag-shell", AragShell],
    ["arag-icon", AragIcon],
    ["arag-status", AragStatus],
    ["arag-json", AragJson],
    ["arag-log", AragLog],
    ["arag-health", AragHealth],
    ["arag-job-timeline", AragJobTimeline],
  ]) {
    if (!customElements.get(name)) customElements.define(name, cls);
  }
}

if (HAS_DOM) {
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeOverlay();
  });
}
if (typeof window !== "undefined") window.aragUI = API;

export {
  api,
  toast,
  esc,
  fmtMs,
  fmtBytes,
  fmtRelative,
  sse,
  highlightJson,
  applyBranding,
  brandingPlan,
  brandingVars,
  announce,
  icon,
  iconNames,
  sortRows,
  nextSort,
  paginate,
  filterRows,
  parseNav,
  activeNavHref,
  placeCard,
  emptyState,
  errorState,
  skeletonRows,
  snippet,
  wireCopy,
  openDrawer,
  confirmDialog,
  closeOverlay,
  menuButton,
  popover,
  tour,
  wireTabs,
  wireSegmented,
  wireTable,
};
