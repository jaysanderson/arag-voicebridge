// Operator views — the same shell as the product, with the operator's own navigation. Everything
// here needs the deployment's admin token, exchanged once for an HttpOnly cookie.

import { renderBrief } from "/app/brief.js";
import {
  activatableRows,
  ago,
  api,
  applyBrand,
  chip,
  confirmAction,
  duration,
  empty,
  errorState,
  esc,
  fmtMs,
  icon,
  isOperator,
  mountShell,
  openDrawer,
  signInOperator,
  skeletonRows,
  stat,
  state,
  toast,
} from "/app/shell.js";
import { closeOverlay } from "/ui/arag-ui.js";

const $ = (s) => document.querySelector(s);
let host;
let prospects = [];

const VIEWS = {
  overview: renderOverview,
  connection: renderConnection,
  sessions: renderSessions,
  turns: renderTurns,
  evals: renderEvals,
  jobs: renderJobs,
  logs: renderLogs,
  branding: renderBranding,
  security: renderSecurity,
};

const TITLES = {
  overview: "Overview",
  connection: "Connection",
  sessions: "Listen sessions",
  turns: "Turn log",
  evals: "Golden runs",
  jobs: "Jobs",
  logs: "Logs",
  branding: "Branding",
  security: "Security",
};

// ── sign-in ──────────────────────────────────────────────────────────────────

function signInView() {
  document.body.className = "arag";
  // The kit's bandless sign-in: full-bleed ink, and the card carries the only wordmark on the page.
  document.body.innerHTML = `
    <div class="arag-signin standalone">
      <div class="card">
        <img class="wordmark" src="/ui/brand/arag-logo.svg" alt="Progress Agentic RAG" />
        <h1>Operator sign-in</h1>
        <p class="muted small">Enter the <code>ADMIN_TOKEN</code> configured for this deployment. It is
          exchanged for an HttpOnly cookie and never stored in the page.</p>
        <div class="arag-row" style="margin-top:16px;flex-wrap:nowrap">
          <input id="token" class="arag-input" type="password" placeholder="Admin token" autocomplete="current-password" />
          <button id="signin" class="arag-btn" style="flex:none">Sign in</button>
        </div>
        <div class="error-slot"><p id="loginError" class="arag-alert error" hidden></p></div>
        <p class="muted small" style="margin-top:6px"><a href="/">Back to the product</a></p>
      </div>
    </div>`;
  const attempt = async () => {
    const err = $("#loginError");
    err.hidden = true;
    try {
      await signInOperator($("#token").value);
      location.reload();
    } catch (e) {
      err.hidden = false;
      err.textContent = e.status === 401 ? "That token was not accepted." : e.message;
    }
  };
  $("#signin").addEventListener("click", attempt);
  $("#token").addEventListener("keydown", (e) => e.key === "Enter" && attempt());
  $("#token").focus();
}

// ── views ────────────────────────────────────────────────────────────────────

async function renderOverview(el) {
  el.innerHTML = `<div class="arag-statstrip" id="ovStats">${Array.from(
    { length: 6 },
    () => '<div><div class="arag-skeleton" style="width:70%"></div></div>',
  ).join("")}</div>
    <div class="arag-split" style="margin-top:20px">
      <section class="arag-card"><div class="head"><h2>Jobs</h2></div><div class="body" id="ovJobs"></div></section>
      <section class="arag-card"><div class="head"><h2>Stores</h2></div><div class="body" id="ovStores"></div></section>
    </div>`;
  try {
    const [usage, config] = await Promise.all([api("/api/v1/admin/usage"), api("/api/v1/admin/config")]);
    $("#ovStats").innerHTML = [
      stat("Uptime", duration(usage.uptimeSec)),
      stat("Requests", usage.requests),
      stat("Knowledge Box calls", usage.aragCalls, `${usage.aragErrors} errors`),
      stat(
        "Mean upstream",
        usage.aragCalls ? fmtMs(usage.aragMs / usage.aragCalls) : "—",
        "per Knowledge Box call",
      ),
      stat("Listen sessions", usage.listenSessions),
      stat("Turns recorded", usage.turns),
    ].join("");
    $("#ovJobs").innerHTML = `<dl class="arag-kv">
        <dt>Queued</dt><dd>${usage.jobs.queued}</dd>
        <dt>Running</dt><dd>${usage.jobs.running}</dd>
        <dt>Succeeded</dt><dd>${usage.jobs.succeeded}</dd>
        <dt>Failed</dt><dd>${usage.jobs.failed}</dd>
      </dl>`;
    $("#ovStores").innerHTML = `<dl class="arag-kv">
        <dt>Service</dt><dd>${esc(config.version)}</dd>
        <dt>Platform</dt><dd>${esc(config.platformVersion)}</dd>
        ${Object.entries(config.stores ?? {})
          .map(
            ([k, v]) =>
              `<dt>${esc(k)}</dt><dd>${esc(String(v?.count ?? 0))} record${v?.count === 1 ? "" : "s"}` +
              `${v?.file ? ` <span class="mono subtle small">${esc(v.file)}</span>` : ""}</dd>`,
          )
          .join("")}
      </dl>`;
  } catch (e) {
    el.innerHTML = errorState(e.message);
  }
}

async function renderConnection(el) {
  el.innerHTML = `
    <div class="arag-datatable">
      <div class="scroll">
        <table id="cnTable">
          <thead><tr><th>Prospect</th><th>Knowledge Box</th><th>Endpoint</th><th>Model</th><th>Status</th><th class="num">ms</th></tr></thead>
          <tbody>${skeletonRows(3, 6)}</tbody>
        </table>
      </div>
    </div>
    <section class="arag-card" style="margin-top:20px">
      <div class="head"><h2>Effective configuration</h2><span class="spacer"></span>${chip("secrets redacted", "neutral")}</div>
      <div class="body"><arag-json src="/api/v1/admin/config"></arag-json></div>
    </section>`;
  try {
    const h = await api("/api/v1/admin/health");
    $("#cnTable tbody").innerHTML = h.prospects
      .map(
        (p) => `<tr>
          <td><span class="cell-title">${esc(p.display_name)}</span><div class="cell-sub mono">${esc(p.key)}</div></td>
          <td class="mono">${esc(p.kbId ?? "—")}</td>
          <td class="mono subtle small">${esc(p.baseUrl ?? "—")}</td>
          <td class="subtle small">${esc(p.generativeModel ?? "KB default")}</td>
          <td>${
            p.ok
              ? '<span class="arag-chip ok">connected</span>'
              : `<span class="arag-chip danger">${esc(p.error ?? "unreachable")}</span>`
          }</td>
          <td class="num">${Math.round(p.ms ?? 0)}</td>
        </tr>`,
      )
      .join("");
  } catch (e) {
    $("#cnTable tbody").innerHTML = `<tr><td colspan="6">${errorState(e.message)}</td></tr>`;
  }
}

async function renderSessions(el) {
  el.innerHTML = `
    <div class="arag-filterbar">
      <select id="seProspect" class="arag-select" aria-label="Prospect">
        <option value="">All prospects</option>
        ${prospects.map((p) => `<option value="${esc(p.id)}">${esc(p.display_name)}</option>`).join("")}
      </select>
      <select id="seStatus" class="arag-select" aria-label="Status">
        <option value="">Any status</option><option value="live">Live</option><option value="ended">Ended</option>
      </select>
      <span class="spacer"></span><span class="count" id="seCount"></span>
    </div>
    <div class="arag-datatable">
      <div class="scroll">
        <table id="seTable">
          <thead><tr><th>Started</th><th>Prospect</th><th>Status</th><th class="num">chunks</th>
            <th class="num">refreshes</th><th class="num">skipped</th><th class="num">failures</th>
            <th class="num">p50</th><th></th></tr></thead>
          <tbody>${skeletonRows(5, 9)}</tbody>
        </table>
      </div>
    </div>`;
  const load = async () => {
    const qs = new URLSearchParams({ limit: "50" });
    if ($("#seProspect").value) qs.set("prospect", $("#seProspect").value);
    if ($("#seStatus").value) qs.set("status", $("#seStatus").value);
    try {
      const page = await api(`/api/v1/listen/sessions?${qs}`);
      $("#seCount").textContent = `${page.total} session${page.total === 1 ? "" : "s"}`;
      $("#seTable tbody").innerHTML = page.items.length
        ? page.items
            .map(
              (s) => `<tr tabindex="0" data-session="${esc(s.id)}">
                <td>${ago(s.createdAt)}<div class="cell-sub mono">${esc(s.id.slice(0, 8))}</div></td>
                <td>${esc(s.prospect)}</td>
                <td>${s.status === "live" ? '<span class="arag-chip ok">live</span>' : '<span class="arag-chip neutral">ended</span>'}</td>
                <td class="num">${s.stats.chunks}</td>
                <td class="num">${s.stats.refreshes}</td>
                <td class="num">${s.stats.skipped}</td>
                <td class="num">${s.stats.failures}</td>
                <td class="num">${s.stats.p50LatencyMs || "—"}</td>
                <td class="actions"><button class="arag-btn ghost sm" data-delete="${esc(s.id)}"
                  aria-label="Delete the conversation started ${esc(s.createdAt)}">${icon("trash", 14)}</button></td>
              </tr>`,
            )
            .join("")
        : `<tr><td colspan="9">${empty({ icon: "conversations", title: "No sessions recorded" })}</td></tr>`;
    } catch (e) {
      $("#seTable tbody").innerHTML = `<tr><td colspan="9">${errorState(e.message)}</td></tr>`;
    }
  };
  $("#seProspect").addEventListener("change", load);
  $("#seStatus").addEventListener("change", load);
  // The delete button lives inside the row, so it must not also open the row it sits in.
  $("#seTable").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-delete]");
    if (!btn) return;
    e.stopPropagation();
    deleteSession(btn.dataset.delete);
  });
  activatableRows("#seTable tbody tr[data-session]", (tr) => sessionDrawer(tr.dataset.session));
  await load();
}

/**
 * Delete a conversation and everything recorded with it.
 *
 * A transcript is what a real caller said, so this is the one destructive act in the operator
 * area that is about a person rather than about the deployment: it asks with the id typed back,
 * and it says plainly what goes.
 */
async function deleteSession(id) {
  const ok = await confirmAction({
    title: "Delete this conversation?",
    body: `The transcript, every version of the brief and the sources it gathered are deleted from ${esc(
      id,
    )}. This cannot be undone.`,
    confirmLabel: "Delete the conversation",
  });
  if (!ok) return;
  try {
    await api(`/api/v1/admin/listen-sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
    toast("Conversation deleted", "ok");
    closeOverlay();
    if (currentView() === "sessions") route();
  } catch (e) {
    toast(e.message, "error");
  }
}

async function sessionDrawer(id) {
  openDrawer({
    title: "Listen session",
    sub: `<span class="mono">${esc(id)}</span>`,
    actions:
      `<a class="arag-btn secondary sm" href="/api/v1/listen/sessions/${encodeURIComponent(id)}/export?format=markdown">Export</a>` +
      `<button class="arag-btn danger sm" id="seDelete">${icon("trash", 14)} Delete</button>`,
    body: '<div class="arag-skeleton" style="height:220px"></div>',
  });
  $("#seDelete")?.addEventListener("click", () => deleteSession(id));
  try {
    const s = await api(`/api/v1/listen/sessions/${encodeURIComponent(id)}/export`);
    document.querySelector(".arag-drawer .body").innerHTML = `
      <div class="arag-statstrip" style="margin-bottom:18px">
        ${stat("Prospect", s.prospect)}
        ${stat("Duration", duration(s.durationSec))}
        ${stat("Brief versions", s.briefVersion)}
        ${stat("Refreshes", s.stats.refreshes, `${s.stats.skipped} throttled · ${s.stats.failures} failed`)}
        ${stat("p50 refresh", s.stats.p50LatencyMs ? fmtMs(s.stats.p50LatencyMs) : "—")}
      </div>
      <h3>Brief history</h3>
      <p class="muted small">Every refresh that produced a usable brief, newest first — how the brief
        evolved through the call, and how long each refresh took.</p>
      ${
        s.briefHistory.length
          ? s.briefHistory
              .slice()
              .reverse()
              .map(
                (h) => `<div class="arag-card" style="margin-bottom:10px">
                  <div class="head"><h3>v${h.version}</h3><span class="spacer"></span>
                    <span class="muted small">${ago(h.at)}</span>
                    <span class="arag-chip neutral">${esc(fmtMs(h.latencyMs))}</span></div>
                  <div class="body"><div class="vb-brief">${renderBrief(h.brief)}</div></div>
                </div>`,
              )
              .join("")
          : '<p class="muted small">No refresh produced a usable brief.</p>'
      }`;
  } catch (e) {
    document.querySelector(".arag-drawer .body").innerHTML = errorState(e.message);
  }
}

async function renderTurns(el) {
  el.innerHTML = `
    <div class="arag-filterbar">
      <select id="tuProspect" class="arag-select" aria-label="Prospect">
        <option value="">All prospects</option>
        ${prospects.map((p) => `<option value="${esc(p.id)}">${esc(p.display_name)}</option>`).join("")}
      </select>
      <select id="tuOutcome" class="arag-select" aria-label="Outcome">
        <option value="">Every turn</option><option value="answered">Answered</option>
        <option value="handoff">Handed off</option><option value="guard">Guard trips</option>
      </select>
      <span class="spacer"></span><span class="count" id="tuCount"></span>
    </div>
    <p class="muted small">The question text is stored only for turns that passed the input guard — an
      unsafe or injected prompt is recorded as a reason, never as text.</p>
    <div class="arag-datatable">
      <div class="scroll">
        <table id="tuTable">
          <thead><tr><th>When</th><th>Prospect</th><th>Question</th><th>Result</th>
            <th class="num">total</th><th class="num">1st token</th><th class="num">cites</th></tr></thead>
          <tbody>${skeletonRows(8, 7)}</tbody>
        </table>
      </div>
    </div>`;
  const load = async () => {
    const qs = new URLSearchParams({ limit: "200" });
    if ($("#tuProspect").value) qs.set("prospect", $("#tuProspect").value);
    if ($("#tuOutcome").value) qs.set("outcome", $("#tuOutcome").value);
    try {
      const page = await api(`/api/v1/turns?${qs}`);
      $("#tuCount").textContent = `${page.total} turn${page.total === 1 ? "" : "s"}`;
      $("#tuTable tbody").innerHTML = page.items.length
        ? page.items
            .map(
              (t) => `<tr>
                <td>${ago(t.createdAt)}<div class="cell-sub">${esc(t.source)}</div></td>
                <td>${esc(t.prospect)}</td>
                <td><span class="arag-truncate" style="max-width:44ch">${
                  t.question ? esc(t.question) : '<span class="muted">redacted (guard trip)</span>'
                }</span></td>
                <td>${
                  t.guard_trip
                    ? `<span class="arag-chip danger">guard · ${esc(t.reason ?? "")}</span>`
                    : t.handoff
                      ? `<span class="arag-chip warn">handoff · ${esc(t.reason ?? "")}</span>`
                      : '<span class="arag-chip ok">answered</span>'
                }</td>
                <td class="num">${t.total}</td><td class="num">${t.first_token}</td><td class="num">${t.citations}</td>
              </tr>`,
            )
            .join("")
        : `<tr><td colspan="7">${empty({ icon: "logs", title: "No turns recorded yet" })}</td></tr>`;
    } catch (e) {
      $("#tuTable tbody").innerHTML = `<tr><td colspan="7">${errorState(e.message)}</td></tr>`;
    }
  };
  $("#tuProspect").addEventListener("change", load);
  $("#tuOutcome").addEventListener("change", load);
  await load();
}

async function renderEvals(el) {
  el.innerHTML = `
    <div class="arag-split">
      <section class="arag-card">
        <div class="head"><h2>Run history</h2></div>
        <div class="body" style="padding:0"><div class="arag-datatable vb-flat"><div class="scroll">
          <table id="evTable">
            <thead><tr><th>When</th><th>Prospect</th><th>Result</th><th class="num">p50</th></tr></thead>
            <tbody>${skeletonRows(4, 4)}</tbody>
          </table>
        </div></div></div>
      </section>
      <section class="arag-card">
        <div class="head"><h2>Detail</h2><span class="spacer"></span><span id="evMeta" class="muted small"></span></div>
        <div class="body" id="evDetail">${empty({ icon: "check", title: "Select a run" })}</div>
      </section>
    </div>`;
  try {
    const { items } = await api("/api/v1/golden-evals?limit=25");
    $("#evTable tbody").innerHTML = items.length
      ? items
          .map(
            (r) => `<tr tabindex="0" data-eval="${esc(r.id)}">
              <td>${ago(r.createdAt)}</td><td>${esc(r.display_name ?? r.prospect)}</td>
              <td>${r.ok ? '<span class="arag-chip ok">all passed</span>' : `<span class="arag-chip danger">${r.failed} failed</span>`}
                <span class="subtle small">${r.passed}/${r.total}</span></td>
              <td class="num">${r.latency_ms?.p50 ?? "—"}</td>
            </tr>`,
          )
          .join("")
      : `<tr><td colspan="4">${empty({ icon: "check", title: "No golden run has been recorded" })}</td></tr>`;
  } catch (e) {
    $("#evTable tbody").innerHTML = `<tr><td colspan="4">${errorState(e.message)}</td></tr>`;
  }
  activatableRows("#evTable tbody tr[data-eval]", async (tr) => {
    $("#evDetail").innerHTML = '<div class="arag-skeleton" style="height:180px"></div>';
    try {
      const r = await api(`/api/v1/golden-evals/${encodeURIComponent(tr.dataset.eval)}`);
      $("#evMeta").textContent = `${r.passed}/${r.total} passed · p50 ${r.latency_ms.p50} ms`;
      $("#evDetail").innerHTML = `<div class="arag-datatable vb-flat"><div class="scroll"><table>
          <thead><tr><th>Question</th><th>Expected</th><th>Result</th><th class="num">ms</th></tr></thead>
          <tbody>${r.cases
            .map(
              (c) => `<tr><td>${esc(c.q)}</td><td>${esc(c.expect)}</td>
                <td>${
                  c.passed
                    ? '<span class="arag-chip ok">pass</span>'
                    : `<span class="arag-chip danger">fail</span> <span class="subtle small">${esc(
                        c.checks
                          .filter((x) => !x.ok)
                          .map((x) => x.label)
                          .join("; "),
                      )}</span>`
                }</td>
                <td class="num">${c.latency_ms}</td></tr>`,
            )
            .join("")}</tbody></table></div></div>`;
    } catch (err) {
      $("#evDetail").innerHTML = errorState(err.message);
    }
  });
}

async function renderJobs(el) {
  el.innerHTML = `<div class="arag-datatable"><div class="scroll">
      <table id="jbTable">
        <thead><tr><th>Submitted</th><th>Kind</th><th>Reference</th><th>Status</th><th></th></tr></thead>
        <tbody>${skeletonRows(4, 5)}</tbody>
      </table></div></div>`;
  const load = async () => {
    try {
      const { items } = await api("/api/v1/jobs?limit=50");
      $("#jbTable tbody").innerHTML = items.length
        ? items
            .map(
              (j) => `<tr>
                <td>${ago(j.createdAt)}</td><td>${esc(j.kind)}</td><td class="mono subtle small">${esc(j.ref ?? "—")}</td>
                <td><span class="arag-chip ${{ succeeded: "ok", failed: "danger", cancelled: "warn" }[j.status] ?? "info"}">${esc(j.status)}</span></td>
                <td class="num">${
                  ["queued", "running"].includes(j.status)
                    ? `<button class="arag-btn ghost sm danger" data-cancel="${esc(j.id)}">Cancel</button>`
                    : ""
                }</td>
              </tr>`,
            )
            .join("")
        : `<tr><td colspan="5">${empty({ icon: "jobs", title: "No jobs have run" })}</td></tr>`;
    } catch (e) {
      $("#jbTable tbody").innerHTML = `<tr><td colspan="5">${errorState(e.message)}</td></tr>`;
    }
  };
  el.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-cancel]");
    if (!btn) return;
    const yes = await confirmAction({
      title: "Cancel this job?",
      body: "A running golden evaluation stops where it is. Cases already recorded are kept.",
      confirmLabel: "Cancel job",
    });
    if (!yes) return;
    try {
      await api(`/api/v1/jobs/${btn.dataset.cancel}`, { method: "DELETE" });
      await load();
    } catch (err) {
      toast(err.message, "error");
    }
  });
  await load();
}

/**
 * The operator log, paged.
 *
 * The ring holds 500 records and an operator chasing one request needs to walk past the noise,
 * not raise a limit until the page is unusable — so this pages rather than showing "the last N",
 * and the filter is applied before the count so the total is the number of *matches*.
 *
 * Live refresh and paging are mutually exclusive on purpose: a log that reloads under you while
 * you are reading page three is worse than one that waits.
 */
function renderLogs(el) {
  const PAGE = 50;
  let offset = 0;
  let live = true;
  let timer = null;

  el.innerHTML = `
    <div class="arag-filterbar">
      <select id="lgLevel" class="arag-select" aria-label="Level">
        <option value="">All levels</option><option>info</option><option>warn</option><option>error</option>
      </select>
      <label class="arag-search">${icon("search", 15)}
        <input id="lgContains" placeholder="Filter log lines…" /></label>
      <label class="arag-switch"><input type="checkbox" id="lgLive" checked /> <span>Follow</span></label>
      <span class="spacer"></span>
      <span class="count" id="lgCount"></span>
    </div>
    <div class="arag-card"><div class="body" style="padding:0">
      <div class="arag-log" id="lgLog" tabindex="0" role="log" aria-label="Operator log"></div>
      <nav class="arag-pagination" aria-label="Log pages">
        <span class="range" id="lgRange"></span>
        <span class="spacer"></span>
        <button type="button" id="lgPrev" data-page="prev">Newer</button>
        <button type="button" id="lgNext" data-page="next">Older</button>
      </nav>
    </div></div>`;

  const line = (r) => {
    const { ts, level, msg, ...rest } = r;
    const fields = Object.entries(rest)
      .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
      .join(" ");
    return `<div class="line">
      <span class="muted">${esc(new Date(ts).toLocaleTimeString())}</span>
      <span class="lvl-${esc(level)}">${esc(level)}</span>
      <span>${esc(msg)}${fields ? ` <span class="muted">${esc(fields)}</span>` : ""}</span>
    </div>`;
  };

  const load = async () => {
    const qs = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
    if ($("#lgLevel").value) qs.set("level", $("#lgLevel").value);
    if ($("#lgContains").value) qs.set("contains", $("#lgContains").value);
    try {
      const page = await api(`/api/v1/admin/logs?${qs}`);
      $("#lgLog").innerHTML = page.items.length
        ? page.items.map(line).join("")
        : `<div class="line"><span></span><span></span><span class="muted">Nothing matches that filter.</span></div>`;
      const from = page.total === 0 ? 0 : page.offset + 1;
      const to = Math.min(page.offset + page.limit, page.total);
      $("#lgRange").textContent = `${from}–${to} of ${page.total} · ring holds ${page.ring}`;
      $("#lgCount").textContent = `${page.total} record${page.total === 1 ? "" : "s"}`;
      $("#lgPrev").disabled = page.offset === 0;
      $("#lgNext").disabled = to >= page.total;
    } catch (e) {
      $("#lgLog").innerHTML =
        `<div class="line"><span></span><span class="lvl-error">error</span><span>${esc(e.message)}</span></div>`;
    }
  };

  const retime = () => {
    if (timer) clearInterval(timer);
    timer = live ? setInterval(load, 5000) : null;
  };
  // The operator area re-renders on every hash change; leaving a timer behind would stack one
  // poller per visit.
  const stop = () => {
    if (timer) clearInterval(timer);
    timer = null;
    window.removeEventListener("hashchange", stop);
  };
  window.addEventListener("hashchange", stop);

  const reset = () => {
    offset = 0;
    load();
  };
  $("#lgLevel").addEventListener("change", reset);
  $("#lgContains").addEventListener("input", reset);
  $("#lgLive").addEventListener("change", (e) => {
    live = e.target.checked;
    if (live) offset = 0;
    retime();
    load();
  });
  $("#lgPrev").addEventListener("click", () => {
    offset = Math.max(0, offset - PAGE);
    load();
  });
  $("#lgNext").addEventListener("click", () => {
    offset += PAGE;
    // Paging away from the newest records means you are reading, not following.
    if (live) {
      live = false;
      $("#lgLive").checked = false;
      retime();
    }
    load();
  });
  retime();
  load();
}

async function renderBranding(el) {
  el.innerHTML = '<div class="arag-skeleton" style="height:200px"></div>';
  try {
    const config = await api("/api/v1/admin/config");
    const b = config.branding?.deployment ?? {};
    const per = config.branding?.perProspect ?? {};
    el.innerHTML = `
      <section class="arag-card">
        <div class="head"><h2>Effective branding</h2><span class="spacer"></span>
          ${b.poweredBy === false ? chip("white-labelled", "info") : chip("Progress default", "neutral")}</div>
        <div class="body">
          <dl class="arag-kv">
            <dt>Product name</dt><dd>${esc(b.productName ?? "—")}</dd>
            <dt>Tagline</dt><dd>${esc(b.tagline ?? "—")}</dd>
            <dt>Logo</dt><dd>${b.logoUrl ? `<span class="mono">${esc(b.logoUrl)}</span>` : "Progress Agentic RAG wordmark"}</dd>
            <dt>Primary colour</dt><dd class="mono">${esc(b.primaryColor ?? "UI kit default")}</dd>
            <dt>Accent colour</dt><dd class="mono">${esc(b.accentColor ?? "#5ce500 (Progress green)")}</dd>
            <dt>Progress credit</dt><dd>${b.poweredBy === false ? "hidden" : "shown"}</dd>
            <dt>Footer</dt><dd>${esc(b.footerText ?? "—")}</dd>
            <dt>Docs link</dt><dd class="mono">${esc(b.docsUrl ?? "/api/v1/docs")}</dd>
          </dl>
          <p class="muted small" style="margin-top:14px">Set with <code>BRAND_*</code> environment
            variables; brand assets dropped into <code>DATA_DIR/branding/</code> are served from
            <code>/branding/</code>, so a rebrand needs no rebuild. Attribution stays in
            <code>LICENSE</code> and <code>THIRD_PARTY_NOTICES.md</code> whatever the toggle says.</p>
        </div>
      </section>
      <section class="arag-card" style="margin-top:20px">
        <div class="head"><h2>Per-prospect overlays</h2></div>
        <div class="body" style="padding:0"><div class="arag-datatable vb-flat"><div class="scroll">
          <table>
            <thead><tr><th>Prospect</th><th>Presents as</th></tr></thead>
            <tbody>${Object.entries(per)
              .map(
                ([k, name]) =>
                  `<tr><td class="mono">${esc(k)}</td><td>${esc(name)}${
                    name === b.productName ? ' <span class="subtle small">(deployment default)</span>' : ""
                  }</td></tr>`,
              )
              .join("")}</tbody>
          </table>
        </div></div></div>
      </section>`;
  } catch (e) {
    el.innerHTML = errorState(e.message);
  }
}

async function renderSecurity(el) {
  el.innerHTML = '<div class="arag-skeleton" style="height:200px"></div>';
  try {
    const config = await api("/api/v1/admin/config");
    const env = config.env ?? {};
    const voice = config.voice ?? {};
    // describeEnv keeps empty arrays and redacts secrets to bullet strings, so "configured" has to
    // mean "non-empty", not "truthy".
    const set = (v) => (Array.isArray(v) ? v.length > 0 : Boolean(v));
    const yes = (v) =>
      set(v) ? '<span class="arag-chip ok">on</span>' : '<span class="arag-chip warn">off</span>';
    const list = (v) => (Array.isArray(v) && v.length ? v.join(", ") : "");
    // A window of 0 means "kept until the ring evicts it", which is the default.
    const retention = (days) => (days > 0 ? `, kept ${days} day${days === 1 ? "" : "s"}` : "");
    el.innerHTML = `
      <div class="arag-split">
        <section class="arag-card">
          <div class="head"><h2>Access</h2></div>
          <div class="body">
            <dl class="arag-kv">
              <dt>Admin token</dt><dd>${yes(env.adminToken)} required for every operator route</dd>
              <dt>API keys</dt><dd>${yes(env.apiKeys)} ${
                set(env.apiKeys)
                  ? `${env.apiKeys.length} active · <code>X-API-Key</code> required on /api/v1`
                  : "none active · /api/v1 is open to anyone who can reach it"
              } · <a href="/settings/#api-keys">manage</a></dd>
              <dt>CORS origins</dt><dd class="mono">${esc(list(env.allowedOrigins) || "same-origin only")}</dd>
              <dt>Proxy trust</dt><dd class="mono">${esc(String(env.trustProxy || "none"))}</dd>
            </dl>
          </div>
        </section>
        <section class="arag-card">
          <div class="head"><h2>Budgets</h2></div>
          <div class="body">
            <dl class="arag-kv">
              <dt>Global rate limit</dt><dd>${esc(String(env.rateLimitRps ?? "—"))} rps · burst ${esc(String(env.rateLimitBurst ?? "—"))}</dd>
              <dt>Brief and sessions</dt><dd>${esc(String(voice.rateLimits?.brief?.rps ?? "—"))} rps · burst ${esc(String(voice.rateLimits?.brief?.burst ?? "—"))}</dd>
              <dt>Speech tokens</dt><dd>${esc(String(voice.rateLimits?.scribeToken?.rps ?? "—"))} rps · burst ${esc(String(voice.rateLimits?.scribeToken?.burst ?? "—"))}</dd>
              <dt>Max body</dt><dd>${esc(String(env.maxBodyBytes ?? "—"))} bytes</dd>
              <dt>Turn timeout</dt><dd>${esc(String(voice.turnTimeoutMs ?? "—"))} ms (tool timeout ${esc(String(voice.agentToolTimeoutMs ?? "—"))} ms)</dd>
            </dl>
          </div>
        </section>
      </div>
      <section class="arag-card" style="margin-top:20px">
        <div class="head"><h2>Data kept</h2></div>
        <div class="body">
          <dl class="arag-kv">
            <dt>Turn log</dt><dd>Last ${esc(String(voice.turnLogLimit ?? "—"))} turns${retention(voice.retention?.turnDays)}. A turn whose input tripped a safety guard keeps the reason and never the text.</dd>
            <dt>Conversations</dt><dd>Transcript, brief history (last 20 versions), citations and stats${retention(voice.retention?.sessionDays)}, or until the session store rolls over.</dd>
            <dt>Golden runs</dt><dd>The last 50 runs with their per-question detail${retention(voice.retention?.evalDays)}.</dd>
            <dt>Automatic purge</dt><dd>${
              voice.retention?.autoPurge
                ? '<span class="arag-chip ok">on</span> the windows above are applied hourly'
                : '<span class="arag-chip neutral">off</span> retention is applied only when an operator purges'
            } · <a href="/settings/#retention">change</a></dd>
            <dt>Secrets</dt><dd>The ARAG service-account token and the ElevenLabs key live in the
              environment or, once rotated in the product, in <code>DATA_DIR/settings.json</code>;
              API keys live in <code>DATA_DIR/api-keys.json</code> because authenticating one needs
              the plaintext. None of them is ever sent to a browser, returned by the
              settings API after it is set, or written to a log.</dd>
          </dl>
        </div>
      </section>`;
  } catch (e) {
    el.innerHTML = errorState(e.message);
  }
}

// ── routing ──────────────────────────────────────────────────────────────────

function currentView() {
  const id = location.hash.replace(/^#/, "") || "overview";
  return VIEWS[id] ? id : "overview";
}

async function route() {
  const id = currentView();
  host = mountShell({
    section: id,
    operator: true,
    title: TITLES[id],
    description: DESCRIPTIONS[id],
  });
  applyBrand(state.branding);
  await VIEWS[id](host);
}

const DESCRIPTIONS = {
  overview: "What this deployment has been doing since it started.",
  connection: "Every prospect's Knowledge Box, and the configuration in force.",
  sessions: "Every listen session, with the brief history behind each one.",
  turns: "Every answered turn, handoff and guard trip.",
  evals: "Golden runs, and the per-question detail behind each.",
  jobs: "Asynchronous work: golden evaluations run here.",
  logs: "Recent log lines from this process.",
  branding: "The branding this deployment presents, and each prospect's overlay.",
  security: "Who can reach what, the budgets in force, and what is kept.",
};

if (!(await isOperator())) {
  signInView();
} else {
  try {
    const [branding, list] = await Promise.all([
      api("/api/v1/branding").catch(() => null),
      api("/api/v1/admin/prospects").catch(() => ({ items: [] })),
    ]);
    state.branding = branding;
    prospects = list.items ?? [];
  } catch {
    /* the views report their own errors */
  }
  await route();
  window.addEventListener("hashchange", route);
}
