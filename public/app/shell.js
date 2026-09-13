// The application shell: the UI kit's left-rail workspace (`<arag-app-shell>`), VoiceBridge's
// navigation, and the content host every page renders into. Every page in public/ mounts this
// first, so the product is one workspace rather than a set of pages that happen to share a
// stylesheet.
//
// Since platform v0.2.0 the kit owns the chrome — the band, the rail, the collapsible/drawer
// behaviour, the overlays, the focus trap, the live region and the copy button. What is left here
// is VoiceBridge's own: its information architecture, the prospect switcher, the per-prospect
// branding overlay, and the small render helpers the sections share.
//
// Branding: the deployment's BRAND_* configuration (GET /api/v1/branding) always wins, and a
// prospect's own `brand` block layers on top of it at runtime. With none set, the default identity
// is Progress — the official wordmark in the band and Progress green as the accent.
import {
  announce,
  api,
  applyBranding,
  confirmDialog,
  emptyState,
  esc,
  fmtMs,
  errorState as kitErrorState,
  openDrawer as kitOpenDrawer,
  snippet as kitSnippet,
  toast,
  wireCopy,
} from "/ui/arag-ui.js";
import { icon } from "./icons.js";

export { announce, api, esc, fmtMs, toast };

/** The product's information architecture. One entry per workspace section. */
export const SECTIONS = [
  { id: "live", label: "Live", href: "/", icon: "live" },
  { id: "conversations", label: "Conversations", href: "/conversations/", icon: "conversations" },
  { id: "knowledge", label: "Knowledge", href: "/knowledge/", icon: "knowledge" },
  { id: "prospects", label: "Prospects", href: "/prospects/", icon: "prospects" },
  { id: "quality", label: "Quality", href: "/quality/", icon: "quality" },
  { id: "api", label: "API", href: "/api/", icon: "api" },
  { id: "settings", label: "Settings", href: "/settings/", icon: "settings" },
];

/** The operator (admin) views, in the same shell. */
export const OPERATOR_SECTIONS = [
  { id: "overview", label: "Overview", href: "/admin/#overview", icon: "usage" },
  { id: "connection", label: "Connection", href: "/admin/#connection", icon: "plug" },
  { id: "sessions", label: "Listen sessions", href: "/admin/#sessions", icon: "conversations" },
  { id: "turns", label: "Turn log", href: "/admin/#turns", icon: "logs" },
  { id: "evals", label: "Golden runs", href: "/admin/#evals", icon: "check" },
  { id: "jobs", label: "Jobs", href: "/admin/#jobs", icon: "jobs" },
  { id: "logs", label: "Logs", href: "/admin/#logs", icon: "logs" },
  { id: "branding", label: "Branding", href: "/admin/#branding", icon: "brand" },
  { id: "security", label: "Security", href: "/admin/#security", icon: "shield" },
];

const TAGLINE = "Live call context, grounded in your content";

export const state = {
  branding: null,
  prospects: [],
  /** The selected prospect (a PublicProspect), shared by every section. */
  current: null,
  operator: false,
};

const PROSPECT_KEY = "vb.prospect";
/** At most one drawer is open at a time, whichever section opened it. The kit enforces this too. */
let openPanel = null;
const registeredRows = new Set();
const rowHandlers = new Map();

/** The deployment-level destinations, below the workspace sections. */
const SETUP_LINK = { label: "Set up", href: "/setup/", icon: "check" };
const OPERATOR_LINK = { label: "Operator", href: "/admin/", icon: "operator" };
const BACK_LINK = { label: "Back to the product", href: "/", icon: "live" };

/** The kit's `nav` attribute: `Label=/href=icon`, `--Heading` starts a group. */
function navSpec(items, heading, extra) {
  const entry = (s) => `${s.label}=${s.href}=${s.icon}`;
  return [`--${heading}`, ...items.map(entry), ...extra].join(",");
}

/** Mount the shell into <body> and return the content host to render into. */
export function mountShell(opts) {
  const { section, operator = false, title, description, actions = "" } = opts;
  const items = operator ? OPERATOR_SECTIONS : SECTIONS;
  const nav = operator
    ? navSpec(items, "Operator", ["--Workspace", `${BACK_LINK.label}=${BACK_LINK.href}=`])
    : navSpec(items, "Workspace", [
        "--Deployment",
        `${SETUP_LINK.label}=${SETUP_LINK.href}=`,
        `${OPERATOR_LINK.label}=${OPERATOR_LINK.href}=`,
      ]);
  const label =
    items.find((s) => s.id === section)?.label ?? (section === "setup" ? SETUP_LINK.label : (title ?? ""));

  document.body.className = "arag";
  // `branding-src="none"`: boot() reads the payload once and applyBrand() layers the selected
  // prospect's overlay on top of it. Letting the shell fetch it as well would land a second,
  // unlayered payload after the overlay and quietly undo it.
  document.body.innerHTML = `
    <arag-app-shell product="VoiceBridge" tagline="${esc(TAGLINE)}" nav="${esc(nav)}"
      home-href="/" docs-href="/api/v1/docs"${operator ? "" : ' admin-href="/admin/"'}
      status-endpoint="/readyz" branding-src="none" collapsible>
      <div class="arag-pagehead">
        <button class="arag-btn ghost sm vb-railmenu" type="button" aria-label="Show navigation">
          ${icon("menu", 16)}
        </button>
        <nav class="arag-breadcrumb" aria-label="Breadcrumb">
          <ol>
            <li><a href="/" data-brand-name>VoiceBridge</a></li>
            ${operator ? '<li><a href="/admin/">Operator</a></li>' : ""}
            <li aria-current="page">${esc(title ?? "")}</li>
          </ol>
        </nav>
        <div class="row">
          <div>
            <h1>${esc(title ?? "")}</h1>
            ${description ? `<p class="sub">${esc(description)}</p>` : ""}
          </div>
          <div class="actions" id="vbPageActions">
            <span class="arag-chips" id="vbTopbarSlot"></span>${actions}
          </div>
        </div>
      </div>
      <div id="vbView"></div>
    </arag-app-shell>`;

  // Below 900 px the rail is a drawer opened from the band's hamburger — but a white-labelled
  // deployment (BRAND_POWERED_BY=0) hides the whole band, and with it the only way to reach the
  // navigation. This stand-in drives the kit's own control, so the scrim, focus and Escape
  // behaviour stay the kit's; CSS shows it only when the band is actually gone.
  document
    .querySelector(".vb-railmenu")
    ?.addEventListener("click", () => document.querySelector(".arag-rail-menu")?.click());
  paintNavIcons(operator ? [...items, BACK_LINK] : [...items, SETUP_LINK, OPERATOR_LINK]);
  setActive(label);
  return document.getElementById("vbView");
}

/**
 * Put VoiceBridge's own glyphs on the rail. The kit's shell renders nav icons with its own
 * `icon()`, so a name outside the kit's core set ("live", "conversations", "prospects") renders
 * nothing — the product repaints them with its accessor afterwards.
 */
function paintNavIcons(items) {
  const shell = document.querySelector("arag-app-shell");
  if (!shell) return;
  for (const s of items) {
    const a = shell.querySelector(`.arag-railnav a[data-nav="${CSS.escape(s.label)}"]`);
    if (!a) continue;
    a.querySelector("svg")?.remove();
    a.insertAdjacentHTML("afterbegin", icon(s.icon, 18));
  }
}

/**
 * Mark the current rail item. The kit matches on `location.pathname`, which cannot tell the
 * operator's nine hash views apart — they all live at /admin/ — so the section that mounted the
 * shell says which one it is.
 */
function setActive(label) {
  const shell = document.querySelector("arag-app-shell");
  if (!shell) return;
  for (const a of shell.querySelectorAll(".arag-railnav a[href]")) {
    if (a.dataset.nav === label) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
}

/** Put a control into the page head (the prospect switcher, a live-session pill). */
export function topbar(html) {
  const slot = document.getElementById("vbTopbarSlot");
  if (slot) slot.innerHTML = html;
  return slot;
}

/** Load branding + the prospect registry. Every page calls this once, before rendering. */
export async function boot() {
  try {
    await api("/api/v1/session", { method: "POST" });
  } catch {
    /* open deployment — the session only matters for credential-minting routes */
  }
  const [branding, prospects] = await Promise.all([
    api("/api/v1/branding").catch(() => null),
    api("/api/v1/prospects").catch(() => ({ items: [] })),
  ]);
  state.branding = branding;
  state.prospects = prospects.items ?? [];
  const stored = localStorage.getItem(PROSPECT_KEY);
  state.current = state.prospects.find((p) => p.key === stored) ?? state.prospects[0] ?? null;
  applyBrand(state.current?.brand ?? branding);
  return state;
}

/**
 * Apply a branding payload to the shell. The kit's `applyBranding()` owns the documented
 * `data-brand-*` hooks, the action/accent ramps, the document title and the Progress signature;
 * VoiceBridge adds one thing on top — Progress green is a *liveness* colour here (the rail's
 * current-item marker, the live dot, the timeline's newest entry), so a partner accent has to
 * replace it as well as the accent ramp.
 */
export function applyBrand(b) {
  if (!b) return;
  applyBranding(b);
  const root = document.documentElement.style;
  if (b.accentColor) root.setProperty("--arag-green", b.accentColor);
  else root.removeProperty("--arag-green");
}

/** The shared prospect switcher, rendered into the page head. */
export function prospectSwitcher(onChange) {
  if (state.prospects.length === 0) return;
  const slot = topbar(
    `<label class="arag-label" for="vbProspect">Prospect</label>
     <select id="vbProspect" class="arag-select" style="width:auto;min-width:170px;height:32px;padding-block:0">
       ${state.prospects.map((p) => `<option value="${esc(p.key)}">${esc(p.display_name)}</option>`).join("")}
     </select>`,
  );
  const sel = slot.querySelector("#vbProspect");
  sel.value = state.current?.key ?? "";
  sel.addEventListener("change", () => {
    state.current = state.prospects.find((p) => p.key === sel.value) ?? null;
    localStorage.setItem(PROSPECT_KEY, sel.value);
    applyBrand(state.current?.brand ?? state.branding);
    onChange?.(state.current);
  });
}

/** Is this browser holding a valid operator cookie? Cached for the life of the page. */
export async function isOperator() {
  if (state.operator) return true;
  try {
    await api("/api/v1/admin/usage");
    state.operator = true;
  } catch {
    state.operator = false;
  }
  return state.operator;
}

/** Exchange the admin token for the operator cookie. */
export async function signInOperator(token) {
  await api("/api/v1/admin/login", { method: "POST", json: { token } });
  state.operator = true;
}

// ── small rendering helpers shared by every section ───────────────────────────
// Each of these is the kit's component with VoiceBridge's call signature in front of it, so a
// section that was written against the old shell keeps working unchanged.

export function empty({ icon: name = "info", title, body = "", action = "", kind = "" }) {
  // emptyState() renders the kit's own icon set; VoiceBridge's empty states name product icons
  // ("live", "conversations", "prospects"), so the markup is built here with the product's
  // accessor. The classes, and therefore the component, are the kit's.
  return `<div class="arag-emptystate${kind ? ` ${esc(kind)}` : ""}">
    ${name ? `<span class="arag-icon-box${kind === "error" ? " danger" : ""}">${icon(name, 20)}</span>` : ""}
    <h2>${esc(title)}</h2>
    ${body ? `<p>${esc(body)}</p>` : ""}
    ${action ? `<div class="actions">${action}</div>` : ""}
  </div>`;
}

export function errorState(message, retryId = "") {
  const err = message instanceof Error ? message : { message: String(message ?? "") };
  return kitErrorState(err, {
    retry: retryId ? `<button class="arag-btn secondary sm" id="${esc(retryId)}">Try again</button>` : "",
  });
}

/** Skeleton table rows, on the kit's shimmer. */
export function skeletonRows(rows = 5, cols = 4) {
  const cell = '<td><span class="arag-skeleton" style="display:block;width:70%"></span></td>';
  return Array.from({ length: rows }, () => `<tr>${cell.repeat(cols)}</tr>`).join("");
}

/** One cell of an `.arag-statstrip`. Block children: the kit's `.label`/`.value`/`.sub` set type
    and spacing, not display, and the strip's cells are plain blocks. */
export function stat(k, v, s = "") {
  return `<div><div class="label">${esc(k)}</div><div class="value">${esc(String(v))}</div>${
    s ? `<div class="sub">${esc(s)}</div>` : ""
  }</div>`;
}

export function chip(text, kind = "neutral") {
  return `<span class="arag-chip ${kind}">${esc(text)}</span>`;
}

/**
 * A source chip. Only http(s) becomes a link: citation URLs come from Knowledge Box content, and
 * content is not trusted to choose a URL scheme — a `javascript:` "source" would be a click away
 * from running in the workspace.
 */
export function citeChip(c) {
  const safe = /^https?:\/\//i.test(String(c.url ?? "")) ? String(c.url) : "";
  const attrs = safe ? ` href="${esc(safe)}" target="_blank" rel="noreferrer noopener"` : "";
  const tag = safe ? "a" : "span";
  return `<${tag} class="arag-cite"${attrs} title="relevance ${Number(c.score ?? 0).toFixed(2)}">${esc(c.title)}</${tag}>`;
}

/** Relative time for list rows ("4 min ago"), absolute on hover. */
export function ago(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  const label =
    s < 60
      ? `${s}s ago`
      : s < 3600
        ? `${Math.round(s / 60)} min ago`
        : s < 86400
          ? `${Math.round(s / 3600)} h ago`
          : new Date(t).toLocaleDateString();
  return `<time datetime="${esc(iso)}" title="${esc(new Date(t).toLocaleString())}">${label}</time>`;
}

export function duration(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m ? `${m}m ${s}s` : `${s}s`;
}

/**
 * Make table rows behave like the controls they look like: a row marked `tabindex="0"` is
 * announced as focusable, so Enter and Space must open it, not only a mouse click.
 */
export function activatableRows(selector, open) {
  // The operator area re-renders a view on every hash change, so the handler is registered once
  // per selector and the latest callback replaces the previous one.
  rowHandlers.set(selector, open);
  if (registeredRows.has(selector)) return;
  registeredRows.add(selector);
  document.addEventListener("click", (e) => {
    const row = e.target.closest(selector);
    if (row) rowHandlers.get(selector)?.(row);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const row = e.target.closest?.(selector);
    if (!row) return;
    e.preventDefault();
    rowHandlers.get(selector)?.(row);
  });
}

/**
 * A right-hand drawer, returning a close() function. The kit owns the focus trap, Escape, the
 * scrim and making the page behind it inert; the head's action slot is this product's, so an
 * export button sits next to the title rather than at the bottom of a scrolling body.
 */
export function openDrawer({ title, sub = "", actions = "", body = "", onClose }) {
  openPanel?.();
  const { host, close } = kitOpenDrawer({ title: esc(title), sub, body, wide: true, onClose });
  if (actions) {
    const el = document.createElement("div");
    el.className = "actions";
    el.innerHTML = actions;
    host.querySelector(".arag-drawer > .head > .close")?.before(el);
  }
  let closed = false;
  const wrapped = () => {
    if (closed) return;
    closed = true;
    if (openPanel === wrapped) openPanel = null;
    close();
  };
  openPanel = wrapped;
  return wrapped;
}

/** Confirm before something destructive. Resolves true when confirmed. */
export function confirmAction({ title, body, confirmLabel = "Delete", danger = true }) {
  return confirmDialog({ title: esc(title), body: `<p>${esc(body)}</p>`, confirmLabel, danger });
}

/** A copyable snippet (webhook URLs, curl examples). */
export function snippet(text) {
  queueMicrotask(() => wireCopy(document));
  return kitSnippet(text);
}

export { emptyState, icon };
