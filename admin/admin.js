// VoiceBridge admin panel — consumes /api/v1/admin/* only; auth via an HttpOnly cookie.
import { api, esc, toast } from "/ui/arag-ui.js";

const $ = (s) => document.querySelector(s);
const chip = (kind, text) => `<span class="arag-chip ${kind}">${esc(text)}</span>`;
let editingKey = null;

const BLANK = {
  display_name: "Acme Corp",
  kb_id: "00000000-0000-0000-0000-000000000000",
  region: "aws-us-east-2-1",
  locale: "en-US",
  greeting: "Hi, thanks for calling. What can I help you with?",
  handoff_msg: "Let me hand you to a specialist who can help with that.",
  reranker: "noop",
  golden_questions: [{ q: "What do you sell?", expect: "answer" }],
};

// ── auth ─────────────────────────────────────────────────────────────────────
async function check() {
  try {
    await api("/api/v1/admin/health");
    show(true);
  } catch (e) {
    show(false);
    if (e.status === 403) {
      $("#loginError").hidden = false;
      $("#loginError").textContent = e.message;
    }
  }
}

function show(authed) {
  $("#login").hidden = authed;
  $("#panel").hidden = !authed;
  if (authed) {
    // The JSON viewers auto-load on page load, i.e. before sign-in — refresh them now that the
    // admin cookie exists.
    for (const el of document.querySelectorAll("arag-json[src]")) el.load();
    document.querySelector("#log")?.load();
    loadHealth();
    loadProspects();
    loadTurns();
    loadEvals();
    loadListen();
  }
}

$("#signin").addEventListener("click", async () => {
  try {
    await api("/api/v1/admin/login", { method: "POST", json: { token: $("#token").value } });
    $("#token").value = "";
    $("#loginError").hidden = true;
    toast("Signed in");
    check();
  } catch (e) {
    $("#loginError").hidden = false;
    $("#loginError").textContent = e.message;
  }
});
$("#token").addEventListener("keydown", (e) => e.key === "Enter" && $("#signin").click());

document.querySelectorAll('[role="tab"]').forEach((t) =>
  t.addEventListener("click", () => {
    document
      .querySelectorAll('[role="tab"]')
      .forEach((x) => x.setAttribute("aria-selected", String(x === t)));
    for (const p of document.querySelectorAll("[data-panel]")) {
      p.hidden = p.dataset.panel !== t.dataset.tab;
    }
  }),
);

// ── health ───────────────────────────────────────────────────────────────────
async function loadHealth() {
  const body = $("#healthTable").querySelector("tbody");
  body.innerHTML = '<tr><td colspan="4" class="muted">testing…</td></tr>';
  try {
    const d = await api("/api/v1/admin/health");
    body.innerHTML = d.prospects
      .map(
        (p) =>
          `<tr><td>${esc(p.display_name)} <span class="subtle">${esc(p.key)}</span></td>` +
          `<td class="mono small">${esc((p.kbId ?? "").slice(0, 8))}… ${d.mock ? chip("warn", "mock") : ""}</td>` +
          `<td>${p.ok ? chip("ok", `connected · ${p.resources ?? 0} resources`) : chip("danger", p.error ?? "unreachable")}</td>` +
          `<td class="num">${p.ms ?? ""}</td></tr>`,
      )
      .join("");
    $("#usage").load();
  } catch (e) {
    body.innerHTML = `<tr><td colspan="4">${chip("danger", e.message)}</td></tr>`;
  }
}
$("#reloadHealth").addEventListener("click", loadHealth);

// ── prospects ────────────────────────────────────────────────────────────────
async function loadProspects() {
  const { items } = await api("/api/v1/admin/prospects");
  $("#prospectTable").querySelector("tbody").innerHTML = items
    .map(
      (p) =>
        `<tr data-key="${esc(p.id)}"><td class="mono small">${esc(p.id)}</td><td>${esc(p.display_name)}</td>` +
        `<td class="small">${esc(p.region)}</td><td class="small">${esc(p.ask_config ?? "—")}</td>` +
        `<td><button class="arag-btn ghost sm edit">Edit</button></td></tr>`,
    )
    .join("");
  for (const b of $("#prospectTable").querySelectorAll(".edit")) {
    b.addEventListener("click", () => edit(b.closest("tr").dataset.key, items));
  }
  const sel = $("#turnProspect");
  sel.innerHTML =
    '<option value="">all prospects</option>' + items.map((p) => `<option>${esc(p.id)}</option>`).join("");
}

function edit(key, items) {
  const p = items.find((x) => x.id === key);
  if (!p) return;
  editingKey = key;
  const { id: _id, createdAt: _createdAt, updatedAt, ...config } = p;
  $("#pKey").value = key;
  $("#pKey").disabled = true;
  $("#pJson").value = JSON.stringify(config, null, 2);
  $("#editorTitle").textContent = `Edit ${key}`;
  $("#editorState").textContent = `updated ${String(updatedAt ?? "")
    .slice(0, 19)
    .replace("T", " ")}`;
  $("#editorError").hidden = true;
  $("#provisionResult").data = undefined;
}

$("#newProspect").addEventListener("click", () => {
  editingKey = null;
  $("#pKey").value = "";
  $("#pKey").disabled = false;
  $("#pJson").value = JSON.stringify(BLANK, null, 2);
  $("#editorTitle").textContent = "New prospect";
  $("#editorState").textContent = "";
  $("#editorError").hidden = true;
});

function parseConfig() {
  try {
    return JSON.parse($("#pJson").value);
  } catch (e) {
    throw new Error(`Configuration is not valid JSON: ${e.message}`);
  }
}

function fail(e) {
  $("#editorError").hidden = false;
  $("#editorError").textContent = e.problem?.errors
    ? `${e.message} — ${e.problem.errors.map((x) => `${x.path} ${x.message}`).join("; ")}`
    : e.message;
}

$("#saveProspect").addEventListener("click", async () => {
  try {
    const config = parseConfig();
    if (editingKey) {
      await api(`/api/v1/admin/prospects/${encodeURIComponent(editingKey)}`, { method: "PUT", json: config });
      toast("Prospect saved");
    } else {
      const key = $("#pKey").value.trim();
      await api("/api/v1/admin/prospects", { method: "POST", json: { key, config } });
      editingKey = key;
      $("#pKey").disabled = true;
      toast("Prospect created");
    }
    $("#editorError").hidden = true;
    loadProspects();
  } catch (e) {
    fail(e);
  }
});

$("#deleteProspect").addEventListener("click", async () => {
  if (!editingKey) return;
  try {
    await api(`/api/v1/admin/prospects/${encodeURIComponent(editingKey)}`, { method: "DELETE" });
    toast(`Deleted ${editingKey}`);
    editingKey = null;
    $("#pJson").value = "";
    $("#pKey").value = "";
    $("#pKey").disabled = false;
    loadProspects();
  } catch (e) {
    fail(e);
  }
});

$("#provisionProspect").addEventListener("click", async () => {
  if (!editingKey) {
    fail(new Error("Save the prospect first, then provision its stored search configuration."));
    return;
  }
  try {
    const r = await api(`/api/v1/admin/prospects/${encodeURIComponent(editingKey)}/provision`, {
      method: "POST",
      json: {},
    });
    $("#provisionResult").data = r;
    toast(`Provisioned ${r.name}`);
    loadProspects();
  } catch (e) {
    fail(e);
  }
});

// ── turn log ─────────────────────────────────────────────────────────────────
async function loadTurns() {
  const q = $("#turnProspect").value;
  const { items } = await api(
    `/api/v1/admin/turns?limit=200${q ? `&prospect=${encodeURIComponent(q)}` : ""}`,
  );
  $("#turnTable").querySelector("tbody").innerHTML =
    items
      .map(
        (t) =>
          `<tr><td class="small muted">${esc(String(t.createdAt).slice(11, 19))}</td><td class="small">${esc(t.prospect)}</td>` +
          `<td class="small">${t.question ? esc(t.question) : '<span class="subtle">redacted (guard trip)</span>'}</td>` +
          `<td>${
            t.guard_trip
              ? chip("danger", `guard · ${t.reason ?? ""}`)
              : t.handoff
                ? chip("warn", `handoff · ${t.reason ?? ""}`)
                : chip("ok", "answered")
          }</td>` +
          `<td class="num">${t.total}</td><td class="num">${t.first_token}</td><td class="num">${t.citations}</td></tr>`,
      )
      .join("") || '<tr><td colspan="7" class="muted">No turns recorded yet.</td></tr>';
}
$("#reloadTurns").addEventListener("click", loadTurns);
$("#turnProspect").addEventListener("change", loadTurns);

// ── golden evals ─────────────────────────────────────────────────────────────
async function loadEvals() {
  const { items } = await api("/api/v1/admin/golden-evals?limit=25");
  $("#evalTable").querySelector("tbody").innerHTML =
    items
      .map(
        (r) =>
          `<tr data-id="${esc(r.id)}"><td class="small muted">${esc(String(r.createdAt).slice(0, 19).replace("T", " "))}</td>` +
          `<td class="small">${esc(r.prospect)}</td><td>${
            r.ok ? chip("ok", `${r.passed}/${r.total}`) : chip("danger", `${r.passed}/${r.total}`)
          }</td><td class="num">${r.latency_ms?.p50 ?? ""}</td></tr>`,
      )
      .join("") ||
    '<tr><td colspan="4" class="muted">No evaluations yet — run one from the console.</td></tr>';
  for (const row of $("#evalTable").querySelectorAll("tr[data-id]")) {
    row.addEventListener("click", () => showEval(row.dataset.id, items));
  }
  if (items[0]) showEval(items[0].id, items);
}

function showEval(id, items) {
  const r = items.find((x) => x.id === id);
  if (!r) return;
  $("#evalMeta").textContent =
    `${r.display_name} · ${r.passed}/${r.total} passed · p50 ${r.latency_ms?.p50 ?? "—"} ms · p95 ${r.latency_ms?.p95 ?? "—"} ms`;
  $("#evalDetail").querySelector("tbody").innerHTML = r.cases
    .map(
      (c) =>
        `<tr><td class="small">${esc(c.q)}</td><td class="small">${esc(c.expect)}</td><td>${
          c.passed
            ? chip("ok", "pass")
            : `${chip("danger", "fail")} <span class="subtle small">${esc(
                c.checks
                  .filter((x) => !x.ok)
                  .map((x) => x.label)
                  .join("; "),
              )}</span>`
        }</td><td class="num">${c.latency_ms}</td></tr>`,
    )
    .join("");
}
$("#reloadEvals").addEventListener("click", loadEvals);

// ── listen sessions ────────────────────────────────────────────────────────
let listenSessions = [];

async function loadListen() {
  const { items } = await api("/api/v1/admin/listen-sessions?limit=25");
  listenSessions = items;
  $("#listenTable").querySelector("tbody").innerHTML =
    items
      .map(
        (s) =>
          `<tr data-id="${esc(s.id)}"><td class="small muted">${esc(String(s.createdAt).slice(11, 19))}</td>` +
          `<td class="small">${esc(s.prospect)}</td>` +
          `<td>${s.status === "live" ? chip("ok", "live") : chip("neutral", "ended")}</td>` +
          `<td class="num">${s.stats.refreshes}</td><td class="num">${s.stats.skipped}</td>` +
          `<td class="num">${s.stats.p50LatencyMs || ""}</td></tr>`,
      )
      .join("") ||
    '<tr><td colspan="6" class="muted">No listen sessions yet — start one from the console.</td></tr>';
  for (const row of $("#listenTable").querySelectorAll("tr[data-id]")) {
    row.addEventListener("click", () => showListen(row.dataset.id));
  }
  if (items[0]) showListen(items[0].id);
}

function showListen(id) {
  const s = listenSessions.find((x) => x.id === id);
  if (!s) return;
  $("#listenMeta").textContent =
    `${s.prospect} · ${s.stats.chunks} chunks · ${s.stats.refreshes} refreshes · ${s.stats.skipped} throttled · ` +
    `p50 ${s.stats.p50LatencyMs || "—"} ms · p95 ${s.stats.p95LatencyMs || "—"} ms`;
  const history = [...(s.briefHistory ?? [])].reverse();
  $("#briefHistory").innerHTML =
    history
      .map(
        (h) =>
          `<div class="arag-card pad"><div class="arag-row" style="justify-content:space-between">` +
          `<b>v${h.version}</b><span class="muted small">${esc(String(h.at).slice(11, 19))} · ${h.latencyMs} ms</span></div>` +
          `<div class="small" style="margin-top:6px">${esc(h.brief?.summary ?? "")}</div>` +
          `${(h.brief?.key_points ?? []).length ? `<ul class="small">${(h.brief.key_points ?? []).map((k) => `<li>${esc(k)}</li>`).join("")}</ul>` : ""}</div>`,
      )
      .join("") || '<p class="muted small">No brief was produced in this session.</p>';
}
$("#reloadListen").addEventListener("click", loadListen);

// ── logs ─────────────────────────────────────────────────────────────────────
$("#level").addEventListener("change", (e) => {
  $("#log").setAttribute("level", e.target.value);
  $("#log").load();
});
$("#contains").addEventListener("change", (e) => {
  $("#log").setAttribute("contains", e.target.value);
  $("#log").load();
});

check();
