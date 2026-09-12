/*! ARAG UI kit v0.1.0 — Apache-2.0. Framework-free helpers + web components used by every ARAG product UI.
    Usage: <script type="module" src="/ui/arag-ui.js"></script>
    Components: <arag-shell>, <arag-status>, <arag-json>, <arag-log>, <arag-health>, <arag-job-timeline>
    Helpers: window.aragUI = { api, toast, esc, fmtMs, fmtBytes, sse } */

const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
const fmtMs = (ms) =>
  ms === undefined || ms === null ? "" : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
const fmtBytes = (n) =>
  n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`;

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
  if (!toastHost) {
    toastHost = document.createElement("div");
    toastHost.className = "arag-toast";
    document.body.appendChild(toastHost);
  }
  const el = document.createElement("div");
  el.className = kind;
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

/** Two-band product shell. Attributes: product, tagline, nav="Label=/path,Label2=/path2", admin-href, docs-href */
class AragShell extends HTMLElement {
  connectedCallback() {
    const product = this.getAttribute("product") ?? "ARAG Product";
    const tagline = this.getAttribute("tagline") ?? "";
    const nav = (this.getAttribute("nav") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const [label, href] = s.split("=");
        return { label, href };
      });
    const path = location.pathname.replace(/\/$/, "") || "/";
    const docs = this.getAttribute("docs-href") ?? "/api/v1/docs";
    const admin = this.getAttribute("admin-href");
    const content = Array.from(this.childNodes);
    this.innerHTML = `
      <div class="arag-band"><div class="arag-container">
        <span class="brand"><span class="dot"></span>Progress Agentic RAG</span>
        <span class="band-actions">
          <a class="arag-btn ghost sm" style="color:#fff;border-color:rgba(255,255,255,.3)" href="${esc(docs)}">API docs</a>
          ${admin ? `<a class="arag-btn ghost sm" style="color:#fff;border-color:rgba(255,255,255,.3)" href="${esc(admin)}">Admin</a>` : ""}
        </span>
      </div></div>
      <header class="arag-header"><div class="arag-container">
        <a class="product" href="/">${esc(product)}${tagline ? `<span class="tag">${esc(tagline)}</span>` : ""}</a>
        <nav class="arag-nav">${nav.map((n) => `<a href="${esc(n.href)}"${(n.href.replace(/\/$/, "") || "/") === path ? ' aria-current="page"' : ""}>${esc(n.label)}</a>`).join("")}</nav>
        <span class="spacer"></span>
        <slot name="actions"></slot>
        <arag-status endpoint="/readyz" label="service"></arag-status>
      </div></header>
      <main class="arag-main"><div class="arag-container" data-slot="content"></div></main>
      <footer class="arag-footer"><div class="arag-container"><span>Open source · Apache-2.0</span><span>Built on Progress Agentic RAG</span></div></footer>`;
    const host = this.querySelector('[data-slot="content"]');
    for (const n of content) host.appendChild(n);
  }
}

/** Live status pill polling a JSON endpoint ({ok:boolean, ...}). Attributes: endpoint, label, interval */
class AragStatus extends HTMLElement {
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
      this.querySelector(".txt").textContent =
        `${this.getAttribute("label") ?? "status"} · ${ok ? "online" : "degraded"}`;
      this.dispatchEvent(new CustomEvent("status", { detail: d }));
    } catch {
      this.dataset.state = "error";
      this.querySelector(".txt").textContent = `${this.getAttribute("label") ?? "status"} · offline`;
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
class AragJson extends HTMLElement {
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
class AragLog extends HTMLElement {
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
class AragHealth extends HTMLElement {
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
class AragJobTimeline extends HTMLElement {
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

for (const [name, cls] of [
  ["arag-shell", AragShell],
  ["arag-status", AragStatus],
  ["arag-json", AragJson],
  ["arag-log", AragLog],
  ["arag-health", AragHealth],
  ["arag-job-timeline", AragJobTimeline],
]) {
  if (!customElements.get(name)) customElements.define(name, cls);
}

window.aragUI = { api, toast, esc, fmtMs, fmtBytes, sse, highlightJson };
export { api, toast, esc, fmtMs, fmtBytes, sse, highlightJson };
