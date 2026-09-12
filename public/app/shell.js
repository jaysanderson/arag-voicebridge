// The application shell: the dark Progress rail, the section navigation, the top bar and the
// content host. Every page in public/ mounts this first, so the product is one workspace rather
// than a set of pages that happen to share a stylesheet.
//
// Branding: the deployment's BRAND_* configuration (GET /api/v1/branding) always wins. With none
// set, the default identity is Progress — the official "Progress Agentic RAG" wordmark on the
// rail and Progress green as the accent.
import { api, applyBranding, esc, fmtMs, toast } from "/ui/arag-ui.js";
import { icon } from "./icons.js";

export { api, esc, fmtMs, toast };

/** The product's information architecture. One entry per workspace section. */
export const SECTIONS = [
  { id: "live", label: "Live", href: "/", icon: "live" },
  { id: "conversations", label: "Conversations", href: "/conversations/", icon: "conversations" },
  { id: "knowledge", label: "Knowledge", href: "/knowledge/", icon: "knowledge" },
  { id: "prospects", label: "Prospects", href: "/prospects/", icon: "prospects" },
  { id: "quality", label: "Quality", href: "/quality/", icon: "quality" },
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

export const state = {
  branding: null,
  prospects: [],
  /** The selected prospect (a PublicProspect), shared by every section. */
  current: null,
  operator: false,
};

const PROSPECT_KEY = "vb.prospect";

/** Mount the shell into <body> and return the content host to render into. */
export function mountShell(opts) {
  const { section, operator = false, title, description, actions = "" } = opts;
  const nav = operator ? OPERATOR_SECTIONS : SECTIONS;
  const navHtml = nav
    .map(
      (s) =>
        `<a href="${s.href}" data-nav="${s.id}"${s.id === section ? ' aria-current="page"' : ""}>` +
        `${icon(s.icon, 16)}<span>${esc(s.label)}</span><span class="vb-nav-slot" data-slot="${s.id}"></span></a>`,
    )
    .join("");

  document.body.className = "arag vb-body";
  document.body.innerHTML = `
    <div class="vb-app" data-rail="closed">
      <a class="arag-btn ghost sm sr-only" href="#vb-main">Skip to content</a>
      <aside class="vb-rail">
        <a class="vb-wordmark" href="/" aria-label="Progress Agentic RAG">
          <img data-brand-mark src="/brand/arag-logo-alt.svg" alt="Progress Agentic RAG" />
          <span class="vb-wordmark-text" data-brand-mark-text hidden></span>
        </a>
        <div class="vb-product">
          <span class="name" data-brand-name>VoiceBridge</span>
          <span class="tag" data-brand-tagline></span>
        </div>
        <nav class="vb-nav" aria-label="${operator ? "Operator" : "Workspace"}">
          ${operator ? '<span class="vb-nav-label">Operator</span>' : ""}
          ${navHtml}
          ${
            operator
              ? `<span class="vb-nav-label">Workspace</span><a href="/" data-nav="back">${icon("live", 16)}<span>Back to the product</span></a>`
              : `<span class="vb-nav-label">Deployment</span><a href="/admin/" data-nav="operator">${icon("operator", 16)}<span>Operator</span></a>`
          }
        </nav>
        <div class="vb-rail-foot">
          <a href="/api/v1/docs" data-docs-link>API docs</a>
          <span data-brand-footer>Open source · Apache-2.0</span>
          <span class="vb-credit" data-powered-by>Built on Progress Agentic RAG</span>
        </div>
      </aside>
      <div class="vb-main">
        <header class="vb-topbar">
          <button class="arag-btn ghost sm vb-menu-btn" id="vbMenu" aria-label="Open navigation">${icon("menu", 16)}</button>
          <div class="vb-crumbs">
            <span data-brand-name-crumb>VoiceBridge</span>
            ${icon("chevronRight", 13)}
            <strong>${esc(title ?? "")}</strong>
          </div>
          <span class="spacer"></span>
          <div class="vb-chip-row" id="vbTopbarSlot"></div>
          <arag-status endpoint="/readyz" label="service"></arag-status>
        </header>
        <main class="vb-content" id="vb-main">
          <div class="vb-page-head">
            <div>
              <h1>${esc(title ?? "")}</h1>
              ${description ? `<p>${esc(description)}</p>` : ""}
            </div>
            <div class="vb-actions" id="vbPageActions">${actions}</div>
          </div>
          <div id="vbView"></div>
        </main>
      </div>
    </div>`;

  const app = document.querySelector(".vb-app");
  document.getElementById("vbMenu")?.addEventListener("click", () => {
    app.dataset.rail = app.dataset.rail === "open" ? "closed" : "open";
  });
  document.addEventListener("click", (e) => {
    if (app.dataset.rail === "open" && !e.target.closest(".vb-rail") && !e.target.closest("#vbMenu")) {
      app.dataset.rail = "closed";
    }
  });
  return document.getElementById("vbView");
}

/** Put a control into the top bar (the prospect switcher, a live-session pill). */
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
 * Apply a branding payload to the shell. The UI kit handles the colour variables; the rail's
 * wordmark, name, tagline, footer and credit are this shell's own.
 */
export function applyBrand(b) {
  if (!b) return;
  applyBranding(b);
  // Progress green stays the default accent; a partner's accentColor replaces it everywhere.
  if (b.accentColor) document.documentElement.style.setProperty("--vb-accent", b.accentColor);
  const set = (sel, fn) => {
    for (const el of document.querySelectorAll(sel)) fn(el);
  };
  if (b.productName) {
    set("[data-brand-name]", (el) => {
      el.textContent = b.productName;
    });
    set("[data-brand-name-crumb]", (el) => {
      el.textContent = b.productName;
    });
    document.title = document.title.replace(/^[^·]+/, `${b.productName} `);
  }
  set("[data-brand-tagline]", (el) => {
    el.textContent = b.tagline ?? "";
    el.hidden = !b.tagline;
  });
  // A partner logo replaces the Progress wordmark on the rail; without one we keep the official
  // dark-surface wordmark, which is the product's default identity.
  if (b.logoUrl) {
    set("[data-brand-mark]", (el) => {
      el.src = b.logoUrl;
      el.alt = b.productName ?? "";
    });
  }
  if (b.footerText) {
    set("[data-brand-footer]", (el) => {
      el.textContent = b.footerText;
    });
  }
  if (b.poweredBy === false) {
    set("[data-powered-by]", (el) => {
      el.hidden = true;
    });
    // No Progress credit means no Progress wordmark either: the deployment is the partner's.
    set("[data-brand-mark]", (el) => {
      if (!b.logoUrl) el.hidden = true;
    });
    set("[data-brand-mark-text]", (el) => {
      if (!b.logoUrl) {
        el.textContent = b.productName ?? "";
        el.hidden = false;
      }
    });
  }
  if (b.docsUrl) {
    set("[data-docs-link]", (el) => {
      el.href = b.docsUrl;
    });
  }
}

/** The shared prospect switcher, rendered into the top bar. */
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

export function empty({ icon: name = "info", title, body = "", action = "", kind = "" }) {
  return `<div class="vb-empty ${kind}">
    <span class="vb-empty-icon">${icon(name, 20)}</span>
    <h3>${esc(title)}</h3>
    ${body ? `<p>${esc(body)}</p>` : ""}
    ${action ? `<div class="vb-chip-row" style="justify-content:center">${action}</div>` : ""}
  </div>`;
}

export function errorState(message, retryId = "") {
  return empty({
    icon: "warning",
    kind: "error",
    title: "That did not load",
    body: message,
    action: retryId ? `<button class="arag-btn secondary sm" id="${retryId}">Try again</button>` : "",
  });
}

export function skeletonRows(rows = 5, cols = 4) {
  const cell = '<td><span class="vb-skeleton" style="display:block;width:70%"></span></td>';
  return Array.from({ length: rows }, () => `<tr>${cell.repeat(cols)}</tr>`).join("");
}

export function stat(k, v, s = "") {
  return `<div class="vb-stat"><span class="k">${esc(k)}</span><span class="v">${esc(String(v))}</span>${
    s ? `<span class="s">${esc(s)}</span>` : ""
  }</div>`;
}

export function chip(text, kind = "neutral") {
  return `<span class="arag-chip ${kind}">${esc(text)}</span>`;
}

export function citeChip(c) {
  const href = c.url ? ` href="${esc(c.url)}" target="_blank" rel="noreferrer noopener"` : "";
  const tag = c.url ? "a" : "span";
  return `<${tag} class="arag-cite"${href} title="relevance ${Number(c.score ?? 0).toFixed(2)}">${esc(c.title)}</${tag}>`;
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

/** A right-hand drawer. Returns a close() function. */
export function openDrawer({ title, sub = "", actions = "", body, onClose }) {
  const host = document.createElement("div");
  host.className = "vb-drawer-backdrop";
  host.innerHTML = `<section class="vb-drawer" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <header>
        <div>
          <h2>${esc(title)}</h2>
          ${sub ? `<div class="vb-sub">${sub}</div>` : ""}
        </div>
        <div class="vb-actions">${actions}<button class="arag-btn ghost sm" data-close aria-label="Close">${icon("cross", 16)}</button></div>
      </header>
      <div class="vb-drawer-body">${body}</div>
    </section>`;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    host.remove();
    document.removeEventListener("keydown", onKey);
    onClose?.();
  };
  const onKey = (e) => e.key === "Escape" && close();
  host.addEventListener("click", (e) => {
    if (e.target === host || e.target.closest("[data-close]")) close();
  });
  document.addEventListener("keydown", onKey);
  document.body.appendChild(host);
  host.querySelector("[data-close]")?.focus();
  return close;
}

/** Confirm before something destructive. Resolves true when confirmed. */
export function confirmAction({ title, body, confirmLabel = "Delete", danger = true }) {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    host.className = "arag-modal-backdrop";
    host.innerHTML = `<div class="arag-modal" role="dialog" aria-modal="true">
        <div class="head"><h3 style="margin:0">${esc(title)}</h3></div>
        <div class="body">
          <p class="muted">${esc(body)}</p>
          <div class="arag-row" style="justify-content:flex-end">
            <button class="arag-btn ghost" data-no>Cancel</button>
            <button class="arag-btn ${danger ? "danger" : ""}" data-yes>${esc(confirmLabel)}</button>
          </div>
        </div>
      </div>`;
    const done = (v) => {
      host.remove();
      resolve(v);
    };
    host.addEventListener("click", (e) => {
      if (e.target.closest("[data-yes]")) done(true);
      else if (e.target.closest("[data-no]") || e.target === host) done(false);
    });
    document.body.appendChild(host);
    host.querySelector("[data-yes]")?.focus();
  });
}

/** A copyable snippet (webhook URLs, curl examples). */
export function snippet(text, label = "Copy") {
  const id = `snip${Math.random().toString(36).slice(2, 8)}`;
  queueMicrotask(() => {
    document.getElementById(id)?.addEventListener("click", async (e) => {
      try {
        await navigator.clipboard.writeText(text);
        e.target.textContent = "Copied";
        setTimeout(() => {
          e.target.textContent = label;
        }, 1500);
      } catch {
        toast("Copying needs clipboard permission — select the text instead", "error");
      }
    });
  });
  return `<div class="vb-snippet">${esc(text)}<button class="vb-copy" id="${id}" type="button">${esc(label)}</button></div>`;
}

export { icon };
