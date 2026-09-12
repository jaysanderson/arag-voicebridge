// Prospects — the registry. One entry per customer this deployment answers for: its Knowledge
// Box, its greeting and handoff line, its golden set, and its own brand overlay.
//
// Reading the registry is part of the workspace. Changing it is an operator action, so the
// editing surface only appears once the deployment's admin token has been exchanged for a
// cookie — the same gate the operator views use.
import {
  api,
  boot,
  chip,
  confirmAction,
  empty,
  errorState,
  esc,
  icon,
  isOperator,
  mountShell,
  openDrawer,
  signInOperator,
  skeletonRows,
  state,
  toast,
} from "./shell.js";

let records = [];
let operator = false;

const $ = (s) => document.querySelector(s);

const TEMPLATE = {
  display_name: "New customer",
  kb_id: "",
  region: "aws-us-east-2-1",
  locale: "en-GB",
  greeting: "Hi, thanks for calling. What can I help you with?",
  handoff_msg: "Let me put you through to a specialist who can help with that.",
  golden_questions: [{ q: "", expect: "answer" }],
};

function chrome() {
  return `
    ${operator ? "" : signInBanner()}
    <div class="vb-table-wrap">
      <div class="vb-scroll">
        <table class="vb-table" id="prTable">
          <thead><tr>
            <th>Prospect</th><th>Knowledge Box</th><th>Region</th><th>Search config</th>
            <th>Golden set</th><th>Branding</th><th></th>
          </tr></thead>
          <tbody>${skeletonRows(3, 7)}</tbody>
        </table>
      </div>
    </div>`;
}

function signInBanner() {
  return `<div class="vb-card pad" style="margin-bottom:18px">
    <div class="arag-row" style="align-items:flex-start;gap:14px">
      <span class="vb-empty-icon" style="width:34px;height:34px">${icon("operator", 17)}</span>
      <div style="flex:1;min-width:220px">
        <strong>Viewing the registry read-only</strong>
        <p class="muted small" style="margin:4px 0 0">Adding, editing, provisioning and deleting a
          prospect are operator actions. Enter this deployment's admin token to unlock them.</p>
      </div>
      <div class="arag-row" style="flex:none">
        <input id="prToken" class="arag-input" type="password" placeholder="Admin token" style="width:200px" />
        <button class="arag-btn" id="prSignIn">Unlock</button>
      </div>
    </div>
    <p id="prSignInError" class="arag-alert error" hidden style="margin:12px 0 0"></p>
  </div>`;
}

function row(p) {
  // In operator mode `brand` is the raw per-prospect overlay; in read-only mode the API returns the
  // effective branding, so an overlay is what differs from the deployment's own.
  const brand = p.brand ?? {};
  const base = state.branding ?? {};
  const overlay = operator
    ? Boolean(brand.productName || brand.primaryColor || brand.logoUrl || brand.tagline)
    : Boolean(
        (brand.productName && brand.productName !== base.productName) ||
          (brand.primaryColor && brand.primaryColor !== base.primaryColor) ||
          (brand.logoUrl && brand.logoUrl !== base.logoUrl),
      );
  return `<tr data-key="${esc(p.id ?? p.key)}">
    <td>
      <span class="vb-primary">${esc(p.display_name)}</span>
      <div class="vb-sub vb-mono">${esc(p.id ?? p.key)}</div>
    </td>
    <td class="vb-mono">${esc(operator ? (p.kb_id ?? "—") : "—")}</td>
    <td class="vb-mono">${esc(p.region ?? "—")}</td>
    <td>${p.ask_config ? `<span class="vb-mono">${esc(p.ask_config)}</span>` : chip("inline", "neutral")}</td>
    <td>${(p.golden_questions ?? []).length} question${(p.golden_questions ?? []).length === 1 ? "" : "s"}</td>
    <td>${overlay ? chip("overlay set", "info") : '<span class="muted small">deployment default</span>'}</td>
    <td class="num">${
      operator
        ? `<button class="arag-btn ghost sm" data-edit="${esc(p.id ?? p.key)}">Edit</button>`
        : `<button class="arag-btn ghost sm" data-view="${esc(p.id ?? p.key)}">View</button>`
    }</td>
  </tr>`;
}

async function load() {
  const tbody = $("#prTable tbody");
  tbody.innerHTML = skeletonRows(3, 7);
  try {
    if (operator) {
      records = (await api("/api/v1/admin/prospects")).items;
    } else {
      records = (await api("/api/v1/prospects")).items.map((p) => ({ ...p, id: p.key }));
    }
    tbody.innerHTML = records.length
      ? records.map(row).join("")
      : `<tr><td colspan="7">${empty({
          icon: "prospects",
          title: "No prospects yet",
          body: "A prospect points this deployment at a Knowledge Box and gives it a greeting, a handoff line and a golden set.",
          action: operator ? '<button class="arag-btn" id="prNewEmpty">Add a prospect</button>' : "",
        })}</td></tr>`;
    $("#prNewEmpty")?.addEventListener("click", () => editor(null));
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="7">${errorState(e.message, "prRetry")}</td></tr>`;
    $("#prRetry")?.addEventListener("click", load);
  }
}

/** The editor drawer. `key` null creates a new prospect. */
function editor(key) {
  const record = key ? records.find((r) => (r.id ?? r.key) === key) : null;
  const config = record
    ? Object.fromEntries(
        Object.entries(record).filter(([k]) => !["id", "createdAt", "updatedAt"].includes(k)),
      )
    : TEMPLATE;
  const close = openDrawer({
    title: key ? `Edit ${record?.display_name ?? key}` : "New prospect",
    sub: key ? `<span class="vb-mono">${esc(key)}</span>` : "A registry key, then its configuration.",
    body: `
      ${
        key
          ? ""
          : `<div class="arag-field">
              <label for="prKey">Key</label>
              <input id="prKey" class="arag-input" placeholder="acme" />
              <span class="arag-help">Lowercase letters, digits, <code>-</code> and <code>_</code>. It appears in API calls and cannot be changed later.</span>
            </div>`
      }
      <div class="arag-field">
        <label for="prJson">Configuration</label>
        <textarea id="prJson" class="arag-textarea" rows="22" spellcheck="false">${esc(
          JSON.stringify(config, null, 2),
        )}</textarea>
        <span class="arag-help">Required: <code>display_name</code>, <code>kb_id</code>,
          <code>region</code>, <code>locale</code>, <code>greeting</code>, <code>handoff_msg</code>.
          Optional: <code>golden_questions</code>, <code>ask_config</code>, <code>reranker</code>,
          <code>generative_model</code>, <code>brief_model</code>, <code>agent_id</code>,
          <code>avatar_id</code>, and a <code>brand</code> overlay.</span>
      </div>
      <p id="prError" class="arag-alert error" hidden></p>
      <div class="arag-row" style="margin-top:14px">
        <button class="arag-btn" id="prSave">Save</button>
        ${key ? '<button class="arag-btn secondary" id="prProvision">Provision search config</button>' : ""}
        ${key ? '<button class="arag-btn ghost danger" id="prDelete">Delete</button>' : ""}
      </div>
      <div id="prResult" style="margin-top:14px"></div>
      <h3 style="margin-top:26px">Brand overlay</h3>
      <p class="muted small">A partner running one deployment for several of their own customers sets
        these per prospect; they layer on top of the deployment's <code>BRAND_*</code> configuration.
        Add a <code>brand</code> block to the configuration above:</p>
      <pre style="font-size:12px">${esc(
        JSON.stringify(
          {
            brand: {
              productName: "Acme Live Assist",
              tagline: "grounded call context",
              logoUrl: "/branding/acme.svg",
              primaryColor: "#6b2fa0",
              accentColor: "#5ce500",
              footerText: "© Acme",
              poweredBy: false,
            },
          },
          null,
          2,
        ),
      )}</pre>`,
  });

  const fail = (msg) => {
    const el = $("#prError");
    el.hidden = false;
    el.textContent = msg;
  };

  $("#prSave")?.addEventListener("click", async () => {
    $("#prError").hidden = true;
    let body;
    try {
      body = JSON.parse($("#prJson").value);
    } catch (e) {
      return fail(`That is not valid JSON: ${e.message}`);
    }
    try {
      if (key) {
        await api(`/api/v1/admin/prospects/${encodeURIComponent(key)}`, { method: "PUT", json: body });
      } else {
        const k = $("#prKey").value.trim();
        if (!k) return fail("A registry key is required.");
        await api("/api/v1/admin/prospects", { method: "POST", json: { key: k, config: body } });
      }
      toast("Prospect saved", "info");
      close();
      await load();
    } catch (e) {
      fail(detail(e));
    }
  });

  $("#prProvision")?.addEventListener("click", async () => {
    $("#prResult").innerHTML = '<div class="vb-skeleton" style="height:60px"></div>';
    try {
      const r = await api(`/api/v1/admin/prospects/${encodeURIComponent(key)}/provision`, {
        method: "POST",
        json: {},
      });
      $("#prResult").innerHTML = `<div class="arag-alert ok">Stored search configuration
        <strong>${esc(r.name)}</strong> ${r.applied ? "written to the Knowledge Box" : "unchanged"}.
        The registry now points at it.</div>`;
      await load();
    } catch (e) {
      $("#prResult").innerHTML = `<div class="arag-alert error">${esc(detail(e))}</div>`;
    }
  });

  $("#prDelete")?.addEventListener("click", async () => {
    const yes = await confirmAction({
      title: `Delete "${key}"?`,
      body: "The registry entry goes away immediately. Sessions and turns already recorded for it are kept.",
      confirmLabel: "Delete prospect",
    });
    if (!yes) return;
    try {
      await api(`/api/v1/admin/prospects/${encodeURIComponent(key)}`, { method: "DELETE" });
      toast("Prospect deleted", "info");
      close();
      await load();
    } catch (e) {
      fail(detail(e));
    }
  });
}

/** Read-only detail, for someone without the operator token. */
function viewer(key) {
  const p = records.find((r) => (r.id ?? r.key) === key);
  if (!p) return;
  openDrawer({
    title: p.display_name,
    sub: `<span class="vb-mono">${esc(key)}</span>`,
    body: `
      <dl class="vb-kv">
        <dt>Locale</dt><dd>${esc(p.locale ?? "—")}</dd>
        <dt>Greeting</dt><dd>${esc(p.greeting ?? "—")}</dd>
        <dt>Handoff line</dt><dd>${esc(p.handoff_msg ?? "—")}</dd>
        <dt>Voice agent</dt><dd>${p.agent_id ? `<span class="vb-mono">${esc(p.agent_id)}</span>` : "not configured"}</dd>
        <dt>Microphone</dt><dd>${p.scribe_ready ? "available" : "needs an ElevenLabs key"}</dd>
      </dl>
      <h3 style="margin-top:22px">Golden set</h3>
      ${
        (p.golden_questions ?? []).length
          ? `<ul style="padding-left:18px">${p.golden_questions
              .map(
                (q) =>
                  `<li>${esc(q.q)} <span class="arag-chip ${q.expect === "handoff" ? "warn" : "neutral"}">${esc(q.expect)}</span></li>`,
              )
              .join("")}</ul>`
          : '<p class="muted small">No golden questions are set for this prospect.</p>'
      }
      <p class="muted small" style="margin-top:20px">Editing needs the deployment's admin token.</p>`,
  });
}

function detail(e) {
  const p = e.problem;
  if (p?.errors?.length) return p.errors.map((x) => `${x.path} ${x.message}`).join("; ");
  return p?.detail ?? e.message;
}

const host = mountShell({
  section: "prospects",
  title: "Prospects",
  description:
    "Each prospect is one customer this deployment answers for — its Knowledge Box, how it greets " +
    "and hands off, its golden set, and its own branding.",
  actions: `<button class="arag-btn ghost sm" id="prReload">${icon("refresh", 14)} Reload</button>
            <button class="arag-btn sm" id="prNew" hidden>${icon("plus", 14)} New prospect</button>`,
});

await boot();
operator = await isOperator();
host.innerHTML = chrome();
document.getElementById("prNew").hidden = !operator;
document.getElementById("prNew").addEventListener("click", () => editor(null));
document.getElementById("prReload").addEventListener("click", load);

$("#prSignIn")?.addEventListener("click", async () => {
  const err = $("#prSignInError");
  err.hidden = true;
  try {
    await signInOperator($("#prToken").value);
    operator = true;
    host.innerHTML = chrome();
    document.getElementById("prNew").hidden = false;
    await load();
  } catch (e) {
    err.hidden = false;
    err.textContent = e.status === 401 ? "That token was not accepted." : e.message;
  }
});
$("#prToken")?.addEventListener("keydown", (e) => e.key === "Enter" && $("#prSignIn").click());

document.addEventListener("click", (e) => {
  const edit = e.target.closest("[data-edit]");
  if (edit) return editor(edit.dataset.edit);
  const view = e.target.closest("[data-view]");
  if (view) viewer(view.dataset.view);
});

await load();
