// Settings — how this deployment is connected, how it is branded, and which optional integrations
// are switched on. Everything here is configuration a partner controls from the environment; the
// page explains what to set rather than pretending it can be changed from a browser.
import {
  api,
  boot,
  chip,
  errorState,
  esc,
  fmtMs,
  icon,
  mountShell,
  prospectSwitcher,
  snippet,
  state,
} from "./shell.js";

const $ = (s) => document.querySelector(s);

function chrome() {
  return `
    <div class="arag-grid cols-2">
      <section class="arag-card" id="stConnection"><div class="body"><div class="arag-skeleton" style="height:150px"></div></div></section>
      <section class="arag-card" id="stBrand"><div class="body"><div class="arag-skeleton" style="height:150px"></div></div></section>
    </div>
    <section class="arag-card" id="stIntegrations" style="margin-top:20px">
      <div class="body"><div class="arag-skeleton" style="height:120px"></div></div>
    </section>
    <section class="arag-card" style="margin-top:20px">
      <div class="head"><h2>API</h2></div>
      <div class="body">
        <p class="muted small">Everything this workspace does, your own application can do. The
          session API is transport-agnostic: any source that can post JSON can drive a brief.</p>
        <div class="arag-chips">
          <a class="arag-btn secondary sm" href="/api/v1/docs">${icon("source", 14)} API reference</a>
          <a class="arag-btn ghost sm" href="/api/v1/swagger">Try it out</a>
          <a class="arag-btn ghost sm" href="/api/v1/openapi.json">OpenAPI document</a>
        </div>
        <p class="muted small" style="margin:14px 0 6px">Open a session and stream its brief:</p>
        ${snippet(
          `curl -sX POST ${location.origin}/api/v1/listen/sessions -H 'content-type: application/json' \\\n  -d '{"prospect":"${esc(state.current?.key ?? "your-prospect")}"}'`,
        )}
      </div>
    </section>`;
}

async function loadConnection() {
  const card = $("#stConnection");
  try {
    const r = await api("/readyz");
    const a = r.arag ?? {};
    card.innerHTML = `
      <div class="head">
        <h2>Connection</h2><span class="spacer"></span>
        ${a.ok ? '<span class="arag-chip ok">connected</span>' : '<span class="arag-chip danger">unreachable</span>'}
        ${a.mock ? chip("mock Knowledge Box", "warn") : ""}
      </div>
      <div class="body">
        ${
          a.mock
            ? `<div class="arag-alert warn" style="margin-bottom:14px">This deployment is running against
                the in-process sample Knowledge Box. Set <code>ARAG_KB_ID</code>, <code>ARAG_API_KEY</code>
                and <code>ARAG_REGION</code> to point it at your own content.</div>`
            : ""
        }
        <dl class="arag-kv">
          <dt>Service</dt><dd>${esc(r.version ?? "—")}</dd>
          <dt>Knowledge Box</dt><dd>${a.ok ? `responded in ${esc(fmtMs(a.ms ?? 0))}` : esc(a.error ?? "no response")}</dd>
          <dt>Endpoint</dt><dd class="mono">${esc(a.baseUrl ?? "—")}</dd>
          <dt>Resources</dt><dd>${a.resources ?? "—"}</dd>
          <dt>Answer model</dt><dd>${esc(a.generativeModel ?? "Knowledge Box default")}</dd>
          <dt>Prospects</dt><dd>${r.prospects ?? 0}</dd>
        </dl>
        <p class="muted small" style="margin:14px 0 0">Per-prospect connections and their health live
          under <a href="/admin/#connection">Operator → Connection</a>.</p>
      </div>`;
  } catch (e) {
    card.innerHTML = `<div class="body">${errorState(e.message, "stConnRetry")}</div>`;
    $("#stConnRetry")?.addEventListener("click", loadConnection);
  }
}

function brandCard() {
  const b = state.branding ?? {};
  const swatch = (label, value) =>
    value
      ? `<div class="arag-row" style="gap:8px"><span style="width:18px;height:18px;border-radius:5px;border:1px solid var(--arag-border);background:${esc(
          value,
        )}"></span><span class="muted small">${esc(label)}</span><code>${esc(value)}</code></div>`
      : "";
  $("#stBrand").innerHTML = `
    <div class="head"><h2>Branding</h2><span class="spacer"></span>
      ${b.poweredBy === false ? chip("white-labelled", "info") : chip("Progress default", "neutral")}</div>
    <div class="body">
      <div class="arag-card pad" style="background:var(--arag-ink-950);color:#fff;margin-bottom:16px">
        <div class="arag-row" style="gap:10px">
          ${
            b.logoUrl
              ? `<img src="${esc(b.logoUrl)}" alt="" style="height:20px" />`
              : b.poweredBy === false
                ? ""
                : '<img src="/ui/brand/arag-logo-alt.svg" alt="Progress Agentic RAG" style="height:16px" />'
          }
        </div>
        <div style="margin-top:12px">
          <strong style="font-size:15px">${esc(b.productName ?? "VoiceBridge")}</strong>
          <div style="opacity:.6;font-size:12px">${esc(b.tagline ?? "")}</div>
        </div>
        <div style="margin-top:14px;display:flex;gap:8px;align-items:center">
          <span style="background:var(--arag-green);width:34px;height:6px;border-radius:3px"></span>
          <span style="background:var(--arag-brand-500);width:34px;height:6px;border-radius:3px"></span>
          <span style="opacity:.5;font-size:11px">accent · primary</span>
        </div>
        <div style="margin-top:14px;opacity:.45;font-size:11px">${esc(b.footerText ?? "")}${
          b.poweredBy === false ? "" : " · Built on Progress Agentic RAG"
        }</div>
      </div>
      ${swatch("Primary", b.primaryColor)}
      ${swatch("Accent", b.accentColor)}
      <p class="muted small" style="margin:14px 0 8px">A partner rebrands a deployment with environment
        variables alone — no fork, no code change. Per-prospect overlays layer on top, under Prospects.</p>
      ${snippet(
        [
          "BRAND_PRODUCT_NAME=Acme Live Assist",
          "BRAND_TAGLINE=grounded call context",
          "BRAND_LOGO_URL=/branding/acme.svg",
          "BRAND_PRIMARY_COLOR=#6b2fa0",
          "BRAND_ACCENT_COLOR=#5ce500",
          "BRAND_POWERED_BY=0",
          "BRAND_FOOTER_TEXT=© Acme",
        ].join("\n"),
      )}
    </div>`;
}

/** One integration, shown in full: what it powers here, whether it is on, and what to set. */
function integrationCard(i) {
  return `<section class="arag-card" style="margin-top:16px">
    <div class="head">
      <h2>${esc(i.name)}</h2>
      ${i.primary ? '<span class="vb-powered">Primary</span>' : ""}
      <span class="spacer"></span>
      ${
        i.configured
          ? '<span class="arag-chip ok">configured</span>'
          : '<span class="arag-chip neutral">not configured</span>'
      }
    </div>
    <div class="body">
      <p class="muted small" style="margin:0 0 12px">${esc(i.purpose)}</p>
      <div class="arag-datatable">
        <div class="scroll">
        <table>
          <thead><tr><th>Capability</th><th>What it does here</th><th>Status</th></tr></thead>
          <tbody>${(i.capabilities ?? [])
            .map(
              (c) => `<tr>
                <td><span class="cell-title">${esc(c.name)}</span></td>
                <td class="subtle small">${esc(c.detail)}</td>
                <td>${
                  c.enabled
                    ? '<span class="arag-chip ok">in use</span>'
                    : '<span class="arag-chip neutral">unavailable</span>'
                }</td>
              </tr>`,
            )
            .join("")}</tbody>
        </table>
        </div>
      </div>
      <dl class="arag-kv" style="margin-top:14px">
        ${Object.entries(i.config ?? {})
          .map(([k, v]) => `<dt>${esc(k)}</dt><dd class="mono">${esc(String(v))}</dd>`)
          .join("")}
        <dt>Switch it on with</dt><dd class="mono">${esc(i.setup)}</dd>
      </dl>
      ${i.id === "elevenlabs" ? '<div id="stAgent"></div>' : ""}
    </div>
  </section>`;
}

async function loadIntegrations() {
  const card = $("#stIntegrations");
  try {
    const { items } = await api("/api/v1/integrations");
    const primary = items.filter((i) => i.primary);
    const secondary = items.filter((i) => !i.primary);
    card.outerHTML = `<div id="stIntegrations">
      <h2 style="margin:24px 0 0">Integrations</h2>
      <p class="muted small" style="margin:4px 0 0">${items.filter((i) => i.configured).length} of
        ${items.length} configured. The session API stays vendor-neutral — these are the
        implementations this deployment ships with.</p>
      ${primary.map(integrationCard).join("")}
      ${secondary.map(integrationCard).join("")}
    </div>`;
    await loadAgent();
  } catch (e) {
    card.innerHTML = `<div class="body">${errorState(e.message, "stIntRetry")}</div>`;
    $("#stIntRetry")?.addEventListener("click", loadIntegrations);
  }
}

/** The ElevenLabs agent configuration: exactly what a partner pastes into the dashboard. */
async function loadAgent() {
  const host = $("#stAgent");
  if (!host || !state.current) return;
  try {
    const cfg = await api(`/api/v1/voice-agent?prospect=${encodeURIComponent(state.current.key)}`);
    host.innerHTML = `
      <h3 style="margin-top:22px">Voice agent for ${esc(cfg.display_name)}</h3>
      <p class="muted small">The agent lives in ElevenLabs Conversational AI and calls this service
        as a custom server tool, so every spoken answer still comes from the Knowledge Box. Paste
        these two into the agent.</p>
      <dl class="arag-kv" style="margin-bottom:12px">
        <dt>Agent id</dt><dd>${
          cfg.ready
            ? `<span class="mono">${esc(cfg.agent_id)}</span>`
            : '<span class="arag-chip warn">not wired — set agent_id under Prospects</span>'
        }</dd>
        <dt>Voice</dt><dd class="mono">${esc(cfg.voice_id ?? "agent default")}</dd>
        <dt>Tool timeout</dt><dd>${cfg.tool.timeoutMs} ms</dd>
      </dl>
      <p class="muted small" style="margin-bottom:6px">Custom server tool</p>
      ${snippet(`${cfg.tool.method} ${cfg.tool.url}\n\n${JSON.stringify(cfg.tool.bodySchema, null, 2)}`)}
      <p class="muted small" style="margin:14px 0 6px">Agent system prompt</p>
      ${snippet(cfg.system_prompt)}`;
  } catch (e) {
    host.innerHTML = `<p class="muted small">The agent configuration could not be read: ${esc(e.message)}</p>`;
  }
}

const host = mountShell({
  section: "settings",
  title: "Settings",
  description: "How this deployment is connected, branded and integrated.",
  actions: `<a class="arag-btn ghost sm" href="/admin/">${icon("operator", 14)} Operator views</a>`,
});

await boot();
host.innerHTML = chrome();
prospectSwitcher(() => loadAgent());
brandCard();
await Promise.all([loadConnection(), loadIntegrations()]);
