// Prospects — the registry. One entry per customer this deployment answers for: its Knowledge
// Box, its greeting and handoff line, its golden set, and its own brand overlay.
//
// Reading the registry is part of the workspace. Changing it is an operator action, so the
// editing surface only appears once the deployment's admin token has been exchanged for a
// cookie — the same gate the operator views use.
//
// The editor is a form. Every field in `ProspectConfig` has a real control with a real label, a
// help line that says what the field does, and an error slot the server's own message lands in.
// The branding half carries a live miniature of the product's identity, redrawn on every
// keystroke, because a prospect's `brand` block layers on top of the deployment's branding and an
// operator has to see the *result* before they save, not after. Raw JSON is still reachable — it
// is a tab, for the power user who wants to paste a whole record — but it is no longer the
// editor.
import { wireTabs } from "/ui/arag-ui.js";
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
/** The deployment's own branding — what every prospect's overlay layers on top of. */
let deployment = {};
/** The deployment default Knowledge Box, so "empty" can name what it falls back to. */
let defaultKbId = "";
/** Per-editor scratch: the golden set being edited, and the router prompt the server generates. */
let golden = [];
let generatedPrompt = null;

const $ = (s) => document.querySelector(s);

/**
 * The platform's colour grammar, copied verbatim from `isSafeColor`
 * (vendor/arag-platform/src/config/branding.ts) so the browser and the server agree on what a
 * colour is. It is also what makes a pasted value safe to write into a custom property: nothing
 * that fails this ever reaches CSS. The server stays the authority — if the two ever drift, its
 * error is the one shown.
 */
const COLOR_RE =
  /^(#[0-9a-f]{3,8}|rgba?\(\s*\d{1,3}%?\s*[,\s]\s*\d{1,3}%?\s*[,\s]\s*\d{1,3}%?\s*(?:[,/]\s*(?:0|1|0?\.\d+|\d{1,3}%)\s*)?\)|hsla?\(\s*\d{1,3}(?:deg)?\s*[,\s]\s*\d{1,3}%\s*[,\s]\s*\d{1,3}%\s*(?:[,/]\s*(?:0|1|0?\.\d+|\d{1,3}%)\s*)?\)|[a-z]{3,20})$/i;
const isSafeColor = (v) => COLOR_RE.test(String(v ?? ""));

/** `^[a-z0-9][a-z0-9_-]{1,40}$` — PROSPECT_KEY_RE in src/services/registry.ts. */
const KEY_RE = /^[a-z0-9][a-z0-9_-]{1,40}$/;

/** A new prospect starts as something that would work, not as an empty form. */
const TEMPLATE = {
  display_name: "",
  kb_id: "",
  region: "aws-us-east-2-1",
  locale: "en-GB",
  greeting: "Hi, thanks for calling. What can I help you with?",
  handoff_msg: "Let me put you through to a specialist who can help with that.",
  reranker: "",
  golden_questions: [],
};

/** Optional single-line strings: registry field → input id. */
const TEXT_FIELDS = [
  ["kb_id", "prKbId"],
  ["ask_config", "prAskConfig"],
  ["generative_model", "prGenerativeModel"],
  ["brief_model", "prBriefModel"],
  ["agent_id", "prAgentId"],
  ["voice_id", "prVoiceId"],
  ["tool_id", "prToolId"],
  ["agent_api_key_id", "prAgentApiKeyId"],
  ["system_prompt", "prSystemPrompt"],
];

/** The brand overlay, in the order the preview reads top to bottom. */
const BRAND_FIELDS = [
  { key: "productName", id: "prBrandProductName", label: "Product name", max: 120 },
  { key: "tagline", id: "prBrandTagline", label: "Tagline", max: 200 },
  { key: "logoUrl", id: "prBrandLogoUrl", label: "Logo URL", max: 500 },
  { key: "primaryColor", id: "prBrandPrimaryColor", label: "Primary colour", kind: "colour" },
  { key: "accentColor", id: "prBrandAccentColor", label: "Accent colour", kind: "colour" },
  { key: "footerText", id: "prBrandFooterText", label: "Footer text", max: 200 },
  { key: "poweredBy", id: "prBrandPoweredBy", label: "Progress credit", kind: "boolean" },
];

/** Every path the server can name in a 400, mapped to the control that owns it. */
const FIELD_IDS = {
  key: "prKey",
  display_name: "prDisplayName",
  locale: "prLocale",
  region: "prRegion",
  reranker: "prReranker",
  max_tokens: "prMaxTokens",
  temperature: "prTemperature",
  greeting: "prGreeting",
  handoff_msg: "prHandoff",
  ...Object.fromEntries(TEXT_FIELDS),
  ...Object.fromEntries(BRAND_FIELDS.map((f) => [`brand/${f.key}`, f.id])),
};

const TABS = [
  { id: "setup", label: "Setup" },
  { id: "voice", label: "Voice" },
  { id: "golden", label: "Golden set" },
  { id: "brand", label: "Branding" },
  { id: "json", label: "JSON" },
];

// ── the list view ────────────────────────────────────────────────────────────

function chrome() {
  return `
    ${operator ? "" : signInBanner()}
    <div class="arag-datatable">
      <div class="scroll">
        <table id="prTable">
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
  return `<div class="arag-card pad vb-pr-signin" style="margin-bottom:18px">
    <div class="vb-pr-signin-row">
      <span class="arag-icon-box" style="width:34px;height:34px">${icon("operator", 17)}</span>
      <div class="vb-pr-signin-copy">
        <strong>Viewing the registry read-only</strong>
        <p class="muted small" style="margin:4px 0 0">Adding, editing, provisioning and deleting a
          prospect are operator actions. Enter this deployment's admin token to unlock them.</p>
      </div>
      <div class="arag-field vb-pr-signin-form">
        <label for="prToken">Admin token</label>
        <div class="arag-row">
          <input id="prToken" class="arag-input" type="password" placeholder="Admin token" />
          <button class="arag-btn" id="prSignIn">Unlock</button>
        </div>
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
    ? Object.values(brand).some((v) => v !== undefined && v !== "")
    : Boolean(
        (brand.productName && brand.productName !== base.productName) ||
          (brand.primaryColor && brand.primaryColor !== base.primaryColor) ||
          (brand.logoUrl && brand.logoUrl !== base.logoUrl),
      );
  const kb = operator
    ? p.kb_id
      ? `<span class="mono">${esc(p.kb_id)}</span>`
      : chip("deployment default", "neutral")
    : "—";
  return `<tr data-key="${esc(p.id ?? p.key)}">
    <td>
      <span class="cell-title">${esc(p.display_name)}</span>
      <div class="cell-sub mono">${esc(p.id ?? p.key)}</div>
    </td>
    <td>${kb}</td>
    <td class="mono">${esc(p.region ?? "—")}</td>
    <td>${p.ask_config ? `<span class="mono">${esc(p.ask_config)}</span>` : chip("inline", "neutral")}</td>
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
      loadDefaultKb();
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

/** The deployment default Knowledge Box, so an empty `kb_id` can say what it inherits. */
async function loadDefaultKb() {
  if (defaultKbId) return;
  try {
    const { groups } = await api("/api/v1/admin/settings");
    const f = groups.flatMap((g) => g.fields).find((x) => x.key === "kbId");
    defaultKbId = String(f?.value ?? "");
    const hint = $("#prKbInherits");
    if (hint) hint.textContent = kbInheritText();
  } catch {
    /* the hint is a nicety; the field works without it */
  }
}

function kbInheritText() {
  return defaultKbId
    ? `Leave empty to answer from the deployment default, ${defaultKbId}.`
    : "Leave empty to answer from the deployment default (Settings → Connection).";
}

// ── form building blocks ─────────────────────────────────────────────────────

/**
 * One labelled control with its help line and its own error slot. The error slot is empty and
 * hidden until something fails, and the input points at both through `aria-describedby`, so a
 * message that names a field is announced with that field rather than shouted as a toast.
 */
function field(o) {
  const id = o.id;
  const req = o.required ? ' <span aria-hidden="true">*</span>' : "";
  const count = o.count ? `<span class="vb-pr-count" id="${id}-count"></span>` : "";
  const described = [o.help ? `${id}-help` : "", `${id}-err`].filter(Boolean).join(" ");
  const attrs = [
    `id="${id}"`,
    `aria-describedby="${described}"`,
    o.required ? "required" : "",
    o.max ? `maxlength="${o.max}"` : "",
    o.placeholder ? `placeholder="${esc(o.placeholder)}"` : "",
    o.list ? `list="${o.list}"` : "",
    o.attrs ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  let control;
  if (o.kind === "select") {
    control = `<select class="arag-select" ${attrs}>${o.options
      .map(
        (x) =>
          `<option value="${esc(x.value)}"${x.value === String(o.value ?? "") ? " selected" : ""}>${esc(x.label)}</option>`,
      )
      .join("")}</select>`;
  } else if (o.kind === "textarea") {
    control = `<textarea class="arag-textarea${o.mono ? " vb-pr-json" : ""}" rows="${o.rows ?? 4}"
      spellcheck="${o.mono ? "false" : "true"}" ${attrs}>${esc(o.value ?? "")}</textarea>`;
  } else if (o.kind === "colour") {
    // A colour needs both: the swatch for picking and the text box a partner pastes a hex into.
    control = `<div class="vb-pr-colour">
      <input type="color" class="arag-input" id="${id}-swatch" data-colour-for="${id}"
        aria-label="${esc(o.label)} colour picker" value="${esc(o.swatch)}" />
      <input type="text" class="arag-input" ${attrs} value="${esc(o.value ?? "")}"
        placeholder="${esc(o.placeholder ?? "inherited")}" />
    </div>`;
  } else {
    control = `<input type="${o.kind ?? "text"}" class="arag-input${o.mono ? " mono" : ""}" ${attrs}
      value="${esc(o.value ?? "")}" />`;
  }
  return `<div class="arag-field${o.span ? " vb-pr-field-span" : ""}">
    <label for="${id}"${o.labelHidden ? ' class="sr-only"' : ""}>${esc(o.label)}${req}${count}</label>
    ${control}
    ${o.help ? `<span class="arag-help" id="${id}-help">${o.help}</span>` : ""}
    <span class="arag-help vb-pr-error" id="${id}-err" role="alert" hidden></span>
  </div>`;
}

function card(title, lead, body) {
  return `<section class="arag-card" style="margin-bottom:16px">
    <div class="head"><h2>${esc(title)}</h2></div>
    <div class="body">
      ${lead ? `<p class="vb-pr-lead">${lead}</p>` : ""}
      ${body}
    </div>
  </section>`;
}

/** One golden-set row: the question, what it must do, and the substrings that prove it. */
function goldenRow(q, i) {
  const n = i + 1;
  return `<div class="vb-gq" data-gq="${i}">
    <div class="vb-gq-head"><span>Question ${n}</span><span class="spacer"></span>
      <button type="button" class="arag-btn ghost sm" data-gq-remove="${i}"
        aria-label="Remove question ${n}">${icon("trash", 13)} Remove</button></div>
    ${field({
      id: `prGq${i}q`,
      label: `Question ${n}`,
      labelHidden: true,
      value: q.q ?? "",
      attrs: "data-gq-q",
      placeholder: "What does my plan cover for dental?",
    })}
    <div class="vb-pr-pair">
      ${field({
        id: `prGq${i}expect`,
        label: "Expected behaviour",
        kind: "select",
        value: q.expect ?? "answer",
        attrs: "data-gq-expect",
        options: [
          { value: "answer", label: "Answer — grounded, with a citation" },
          { value: "handoff", label: "Hand off — must not attempt an answer" },
        ],
      })}
      ${field({
        id: `prGq${i}include`,
        label: "Must include",
        value: (q.must_include ?? []).join(", "),
        attrs: "data-gq-include",
        placeholder: "sinter, Desktop Metal",
      })}
    </div>
  </div>`;
}

function renderGolden() {
  const host = $("#prGolden");
  if (!host) return;
  host.innerHTML = golden.length
    ? golden.map(goldenRow).join("")
    : `<p class="arag-help" style="margin:0 0 12px">No golden questions yet. A prospect can be saved
       without one, but nothing then holds its answers to account.</p>`;
}

/** Read the rows back out of the DOM, so add/remove never loses a half-typed question. */
function readGoldenRows() {
  return [...document.querySelectorAll("#prGolden [data-gq]")].map((el) => {
    const must = (el.querySelector("[data-gq-include]")?.value ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const out = {
      q: el.querySelector("[data-gq-q]")?.value ?? "",
      expect: el.querySelector("[data-gq-expect]")?.value ?? "answer",
    };
    if (must.length) out.must_include = must;
    return out;
  });
}

// ── the branding preview ─────────────────────────────────────────────────────

/** The overlay as it would be stored: only the fields this prospect actually sets. */
function readBrand() {
  const out = {};
  for (const f of BRAND_FIELDS) {
    const el = document.getElementById(f.id);
    if (!el) continue;
    if (f.kind === "boolean") {
      if (el.value) out.poweredBy = el.value === "true";
    } else {
      const v = el.value.trim();
      if (v) out[f.key] = v;
    }
  }
  return out;
}

/** The same layering the server does in `ProspectRegistry.brandFor`: empty means inherit. */
function effectiveBrand(overlay) {
  const out = { ...deployment };
  for (const [k, v] of Object.entries(overlay)) if (v !== undefined && v !== "") out[k] = v;
  return out;
}

/** A logo is only rendered when its URL is one a browser should follow. */
function safeLogo(url) {
  const u = String(url ?? "").trim();
  return /^(https?:\/\/|\/)[^\s"']*$/i.test(u) ? u : "";
}

const PREVIEW = `
  <div class="vb-pv" id="prPreview">
    <div class="vb-pv-band" data-pv-credit>
      <img src="/ui/brand/arag-logo-alt.svg" alt="" aria-hidden="true" />
      <span class="spacer"></span><span>API docs</span>
    </div>
    <div class="vb-pv-body">
      <div class="vb-pv-rail">
        <div class="vb-pv-ident">
          <span class="vb-pv-mark" data-pv-mark></span>
          <span class="vb-pv-name" data-pv-name></span>
          <span class="vb-pv-tagline" data-pv-tagline></span>
        </div>
        <ul class="vb-pv-nav">
          <li aria-current="true">Live</li><li>Conversations</li><li>Knowledge</li>
        </ul>
        <div class="vb-pv-foot" data-pv-footer></div>
      </div>
      <div class="vb-pv-main">
        <div class="vb-pv-head">
          <span class="vb-pv-h1">Live</span><span class="spacer"></span>
          <span class="vb-pv-btn">Ask</span>
        </div>
        <div class="vb-pv-card">
          <span class="vb-pv-pill">listening</span>
          <span class="vb-pv-line"></span><span class="vb-pv-line short"></span>
        </div>
        <div class="vb-pv-credit" data-pv-credit>Built on Progress Agentic RAG</div>
      </div>
    </div>
  </div>
  <p class="vb-pv-legend">
    <span><span class="swatch"></span>this prospect's own value</span>
    <span>everything else is inherited from the deployment</span>
  </p>`;

/**
 * Redraw the miniature from the form, on every keystroke.
 *
 * The point of the preview is the layering: a field this prospect leaves empty falls through to
 * the deployment's value, and the operator has to be able to tell which is which. Two signals say
 * so — a dotted rule under anything the prospect owns, and the list underneath that names every
 * brand field, the value that wins, and where it came from.
 */
function renderPreview() {
  const host = $("#prPreview");
  if (!host) return;
  const overlay = readBrand();
  const eff = effectiveBrand(overlay);
  const own = (k) => Object.hasOwn(overlay, k);

  // Nothing reaches CSS that the platform's own grammar would reject.
  for (const [prop, key] of [
    ["--vb-pv-primary", "primaryColor"],
    ["--vb-pv-accent", "accentColor"],
  ]) {
    const v = String(eff[key] ?? "");
    if (v && isSafeColor(v)) host.style.setProperty(prop, v);
    else host.style.removeProperty(prop);
  }

  const name = String(eff.productName ?? "") || "VoiceBridge";
  const put = (sel, text, key) => {
    const el = host.querySelector(sel);
    el.textContent = text;
    el.dataset.origin = own(key) ? "override" : "inherited";
  };
  put("[data-pv-name]", name, "productName");
  put("[data-pv-tagline]", String(eff.tagline ?? ""), "tagline");
  put("[data-pv-footer]", String(eff.footerText ?? ""), "footerText");

  const mark = host.querySelector("[data-pv-mark]");
  const logo = safeLogo(eff.logoUrl);
  mark.innerHTML = logo
    ? `<img src="${esc(logo)}" alt="" aria-hidden="true" />`
    : esc(name.slice(0, 1).toUpperCase());
  mark.dataset.origin = own("logoUrl") ? "override" : "inherited";

  // The single most-asked-about white-label behaviour: poweredBy false takes the Progress
  // wordmark out of the band and the credit out of the foot.
  const credit = eff.poweredBy !== false;
  for (const el of host.querySelectorAll("[data-pv-credit]")) el.hidden = !credit;

  $("#prLayers").innerHTML = BRAND_FIELDS.map((f) => {
    const set = own(f.key);
    const value =
      f.key === "poweredBy" ? (eff.poweredBy === false ? "hidden" : "shown") : String(eff[f.key] ?? "");
    return `<li>
      <span class="k">${esc(f.label)}</span>
      <span class="v${value ? "" : " none"}">${value ? esc(value) : "not set"}</span>
      ${chip(set ? "overridden" : "inherited", set ? "info" : "neutral")}
    </li>`;
  }).join("");
}

// ── errors ───────────────────────────────────────────────────────────────────

function clearErrors() {
  for (const el of document.querySelectorAll(".vb-pr-error")) {
    el.hidden = true;
    el.textContent = "";
  }
  for (const el of document.querySelectorAll("[aria-invalid]")) el.removeAttribute("aria-invalid");
  const box = $("#prError");
  if (box) box.hidden = true;
}

/**
 * Put one message against the field its path names.
 *
 * Paths arrive in two shapes: `/greeting` from the registry's own validation and from the PUT
 * body schema, and `/config/greeting` from POST, whose body wraps the configuration. Golden-set
 * paths carry the row index (`/golden_questions/2/q`). Returns false when nothing owns the path,
 * so the caller can still show the message rather than swallow it.
 */
function placeError(path, message) {
  const p = String(path ?? "")
    .replace(/^\//, "")
    .replace(/^config\//, "");
  const gq = p.match(/^golden_questions\/(\d+)\/(q|expect|must_include)$/);
  const attr = { q: "data-gq-q", expect: "data-gq-expect", must_include: "data-gq-include" };
  const input = gq
    ? document.querySelector(`[data-gq="${gq[1]}"] [${attr[gq[2]]}]`)
    : document.getElementById(FIELD_IDS[p] ?? "");
  if (!input) return false;
  const slot = document.getElementById(`${input.id}-err`);
  if (!slot) return false;
  slot.textContent = message;
  slot.hidden = false;
  input.setAttribute("aria-invalid", "true");
  return true;
}

/** Show the errors, reveal the first tab that has one, and focus the first bad field. */
function showErrors(errors, fallback = "") {
  clearErrors();
  const unplaced = [];
  for (const e of errors) if (!placeError(e.path, e.message)) unplaced.push(`${e.path} ${e.message}`);
  const first = document.querySelector('[aria-invalid="true"]');
  if (first) {
    const panel = first.closest("[data-panel]");
    if (panel) selectTab(panel.dataset.panel);
    first.focus();
    first.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  const box = $("#prError");
  if (!box) return;
  const n = errors.length - unplaced.length;
  const parts = [];
  if (n) parts.push(`${n} field${n === 1 ? "" : "s"} need${n === 1 ? "s" : ""} attention.`);
  if (unplaced.length) parts.push(unplaced.join("; "));
  if (!parts.length && fallback) parts.push(fallback);
  box.textContent = parts.join(" ");
  box.hidden = !parts.length;
}

/** Turn whatever the API threw into the `[{path, message}]` shape the form places. */
function problemErrors(e) {
  const p = e.problem;
  if (p?.errors?.length) return p.errors.map((x) => ({ path: x.path, message: x.message }));
  return [];
}

// ── tabs ─────────────────────────────────────────────────────────────────────

function selectTab(id) {
  for (const t of document.querySelectorAll("#prTabs [role=tab]")) {
    t.setAttribute("aria-selected", String(t.dataset.tab === id));
  }
  for (const p of document.querySelectorAll("[data-panel]")) p.hidden = p.dataset.panel !== id;
  wireTabs($("#prTabs"), document.querySelector(`[data-panel="${id}"]`));
  if (id === "json") syncJson();
  if (id === "brand") renderPreview();
}

// ── reading and writing the whole form ───────────────────────────────────────

const val = (id) => (document.getElementById(id)?.value ?? "").trim();

/**
 * The configuration as the API wants it.
 *
 * `id`, `createdAt` and `updatedAt` are store fields, not input: `ProspectInput` is
 * `additionalProperties: false`, so a record echoed straight back is rejected. This builds the
 * body from the form instead of editing the record, which is the only way it cannot happen.
 */
function readForm() {
  const cfg = {
    display_name: val("prDisplayName"),
    region: val("prRegion"),
    locale: val("prLocale"),
    greeting: val("prGreeting"),
    handoff_msg: val("prHandoff"),
  };
  for (const [f, id] of TEXT_FIELDS) {
    const v = val(id);
    if (v) cfg[f] = v;
  }
  const reranker = val("prReranker");
  if (reranker) cfg.reranker = reranker;
  const maxTokens = val("prMaxTokens");
  if (maxTokens !== "") cfg.max_tokens = Number(maxTokens);
  const temperature = val("prTemperature");
  if (temperature !== "") cfg.temperature = Number(temperature);
  const gq = readGoldenRows();
  if (gq.length) cfg.golden_questions = gq;
  const brand = readBrand();
  if (Object.keys(brand).length) cfg.brand = brand;
  return cfg;
}

/** Push a configuration object into the form — used on open and by the JSON tab's Apply. */
function writeForm(cfg) {
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.value = v ?? "";
  };
  set("prDisplayName", cfg.display_name);
  set("prRegion", cfg.region);
  set("prLocale", cfg.locale);
  set("prGreeting", cfg.greeting);
  set("prHandoff", cfg.handoff_msg);
  for (const [f, id] of TEXT_FIELDS) set(id, cfg[f]);
  set("prReranker", cfg.reranker ?? "");
  set("prMaxTokens", cfg.max_tokens ?? "");
  set("prTemperature", cfg.temperature ?? "");
  const brand = cfg.brand ?? {};
  for (const f of BRAND_FIELDS) {
    if (f.kind === "boolean") set(f.id, brand.poweredBy === undefined ? "" : String(brand.poweredBy));
    else set(f.id, brand[f.key] ?? "");
    if (f.kind === "colour") syncSwatch(f.id);
  }
  golden = (cfg.golden_questions ?? []).map((q) => ({ ...q }));
  renderGolden();
  for (const id of ["prGreeting", "prHandoff", "prSystemPrompt"]) updateCount(id);
  renderPreview();
}

/** Keep the swatch showing the text box's colour, when the text box holds one it can show. */
function syncSwatch(id) {
  const text = document.getElementById(id);
  const swatch = document.getElementById(`${id}-swatch`);
  if (!text || !swatch) return;
  const v = text.value.trim() || String(effectiveBrand(readBrand())[brandKey(id)] ?? "");
  if (/^#[0-9a-f]{6}$/i.test(v)) swatch.value = v;
}

const brandKey = (id) => BRAND_FIELDS.find((f) => f.id === id)?.key ?? "";

function updateCount(id) {
  const el = document.getElementById(id);
  const out = document.getElementById(`${id}-count`);
  if (!el || !out) return;
  const max = Number(el.getAttribute("maxlength")) || 0;
  out.textContent = `${el.value.length} / ${max}`;
  out.dataset.over = String(el.value.length > max);
}

function syncJson() {
  const el = $("#prJson");
  if (el) el.value = JSON.stringify(readForm(), null, 2);
}

// ── validation in the browser, mirroring the server ──────────────────────────

/**
 * The checks the server would make, made here first so the answer is instant. This never decides
 * that something is *valid* — it only catches what it is certain about; the server still runs
 * `validateProspect` and its verdict is the one that is shown.
 */
function localErrors(cfg, key) {
  const errors = [];
  if (key !== null && !KEY_RE.test(key)) {
    errors.push({
      path: "/key",
      message: "must be lowercase letters, digits, - or _, and 2–41 characters long",
    });
  }
  for (const f of ["display_name", "region", "locale", "greeting", "handoff_msg"]) {
    if (!cfg[f]) errors.push({ path: `/${f}`, message: "is required" });
  }
  if (cfg.max_tokens !== undefined && !(cfg.max_tokens >= 16 && cfg.max_tokens <= 4000)) {
    errors.push({ path: "/max_tokens", message: "must be a whole number between 16 and 4000" });
  }
  if (cfg.temperature !== undefined && !(cfg.temperature >= 0 && cfg.temperature <= 2)) {
    errors.push({ path: "/temperature", message: "must be a number between 0 and 2" });
  }
  (cfg.golden_questions ?? []).forEach((q, i) => {
    if (!q.q.trim()) errors.push({ path: `/golden_questions/${i}/q`, message: "is required" });
  });
  for (const k of ["primaryColor", "accentColor"]) {
    const v = cfg.brand?.[k];
    if (v && !isSafeColor(v)) {
      errors.push({
        path: `/brand/${k}`,
        message: "is not a colour this deployment will accept — use a hex, rgb(), hsl() or a CSS keyword",
      });
    }
  }
  return errors;
}

// ── the editor drawer ────────────────────────────────────────────────────────

/** The editor. `key` null creates a new prospect. */
function editor(key) {
  const record = key ? records.find((r) => (r.id ?? r.key) === key) : null;
  const config = record ?? TEMPLATE;
  generatedPrompt = null;
  golden = (config.golden_questions ?? []).map((q) => ({ ...q }));

  const close = openDrawer({
    title: key ? `Edit ${record?.display_name ?? key}` : "New prospect",
    sub: key
      ? `<span class="mono">${esc(key)}</span>`
      : "A registry key, then the configuration this deployment answers with.",
    body: `
      <div class="arag-tabs vb-pr-tabs" id="prTabs" role="tablist" aria-label="Prospect sections">
        ${TABS.map(
          (t, i) =>
            `<button type="button" role="tab" id="prTab-${t.id}" data-tab="${t.id}"
              aria-controls="prPanel-${t.id}" aria-selected="${i === 0}">${esc(t.label)}</button>`,
        ).join("")}
      </div>
      ${setupPanel(key, config)}
      ${voicePanel(key, config)}
      ${goldenPanel()}
      ${brandPanel(config)}
      ${jsonPanel(key)}
      <div class="vb-pr-foot">
        <p id="prError" class="arag-alert error" hidden style="margin:0 0 10px"></p>
        <div id="prResult"></div>
        <div class="arag-row">
          <button class="arag-btn" id="prSave">${key ? "Save changes" : "Create prospect"}</button>
          ${key ? '<button class="arag-btn secondary" id="prProvision">Provision search config</button>' : ""}
          <span class="spacer"></span>
          ${key ? `<button class="arag-btn ghost danger" id="prDelete">${icon("trash", 14)} Delete</button>` : ""}
        </div>
      </div>
      <datalist id="prRegions"><option value="aws-us-east-2-1"></option><option value="europe-1"></option></datalist>
      <datalist id="prLocales">
        <option value="en-GB"></option><option value="en-US"></option><option value="en-AU"></option>
        <option value="de-DE"></option><option value="es-ES"></option><option value="fr-FR"></option>
      </datalist>`,
  });

  writeForm(config);
  selectTab("setup");
  wireEditor(key, close);
  if (key) loadGeneratedPrompt(key);
}

function setupPanel(key, config) {
  return `<div data-panel="setup" id="prPanel-setup" role="tabpanel" tabindex="0">
    ${card(
      "Identity",
      "What this customer is called, and the key the API answers to.",
      `<div class="vb-pr-pair">
        ${field({
          id: "prDisplayName",
          label: "Display name",
          value: config.display_name,
          required: true,
          max: 120,
          placeholder: "Northwind Health",
          help: "Shown in the workspace, and used to generate the agent's router prompt.",
        })}
        ${
          key
            ? `<div class="arag-field">
                 <label for="prKeyRO">Registry key</label>
                 <input id="prKeyRO" class="arag-input mono" value="${esc(key)}" readonly
                   aria-describedby="prKeyRO-help" />
                 <span class="arag-help" id="prKeyRO-help">The record id. It appears in API calls and
                   cannot be changed — create a new prospect to change it.</span>
               </div>`
            : field({
                id: "prKey",
                label: "Registry key",
                required: true,
                mono: true,
                placeholder: "northwind",
                attrs: 'autocapitalize="off" autocorrect="off" spellcheck="false"',
                help: "Lowercase letters, digits, <code>-</code> and <code>_</code>; 2–41 characters. It is the record id and cannot be changed later.",
              })
        }
        ${field({
          id: "prLocale",
          label: "Locale",
          value: config.locale,
          required: true,
          max: 20,
          list: "prLocales",
          span: true,
          help: "BCP-47 tag. It sets the spoken language and how the agent is addressed.",
        })}
      </div>`,
    )}
    ${card(
      "Knowledge Box",
      "Where this prospect's answers come from.",
      `<div class="vb-pr-pair">
        ${field({
          id: "prKbId",
          label: "Knowledge Box id",
          value: config.kb_id ?? "",
          mono: true,
          max: 80,
          span: true,
          placeholder: "inherits the deployment default",
          help: `<span id="prKbInherits">${esc(kbInheritText())}</span> One deployment usually
            answers for several customers out of one box; give a prospect its own id only when it
            has its own content.`,
        })}
        ${field({
          id: "prRegion",
          label: "Region",
          value: config.region,
          required: true,
          max: 60,
          list: "prRegions",
          help: "The ARAG zone slug the Knowledge Box lives in.",
        })}
        ${field({
          id: "prAskConfig",
          label: "Search configuration",
          value: config.ask_config ?? "",
          mono: true,
          max: 120,
          placeholder: "inline",
          help: "A stored ask configuration. Empty uses the inline settings below. Provision writes one.",
        })}
      </div>`,
    )}
    ${card(
      "Answering",
      "The inline retrieval and generation settings, used when no stored search configuration is named.",
      `<div class="vb-pr-pair">
        ${field({
          id: "prGenerativeModel",
          label: "Generative model",
          value: config.generative_model ?? "",
          max: 120,
          placeholder: "the Knowledge Box default",
          help: "Overrides the box's own model for spoken answers.",
        })}
        ${field({
          id: "prBriefModel",
          label: "Brief model",
          value: config.brief_model ?? "",
          max: 120,
          placeholder: "the Knowledge Box default",
          help: "The fast model behind the live brief — latency matters more than depth here.",
        })}
        ${field({
          id: "prReranker",
          label: "Reranker",
          kind: "select",
          value: config.reranker ?? "",
          options: [
            { value: "", label: "Not set — no reranking (the default)" },
            { value: "noop", label: "noop — no reranking, set explicitly" },
            { value: "predict", label: "predict — rerank with the predict model" },
          ],
          help: "Reranking buys precision and costs a little latency.",
        })}
        ${field({
          id: "prMaxTokens",
          label: "Max tokens",
          kind: "number",
          value: config.max_tokens ?? "",
          attrs: 'min="16" max="4000" step="1"',
          placeholder: "160",
          help: "16–4000. A spoken answer is short; long answers are what a caller hangs up on.",
        })}
        ${field({
          id: "prTemperature",
          label: "Temperature",
          kind: "number",
          value: config.temperature ?? "",
          attrs: 'min="0" max="2" step="0.1"',
          placeholder: "0",
          help: "0–2. Zero keeps demos and golden runs repeatable.",
        })}
      </div>`,
    )}
  </div>`;
}

function voicePanel(key, config) {
  return `<div data-panel="voice" id="prPanel-voice" role="tabpanel" tabindex="0" hidden>
    ${card(
      "Spoken lines",
      "These are said out loud, so they are written to be heard rather than read. Both are required.",
      `${field({
        id: "prGreeting",
        label: "Greeting",
        kind: "textarea",
        rows: 3,
        value: config.greeting,
        required: true,
        max: 600,
        count: true,
        help: "The first thing a caller hears. Say who is answering and what they can ask about.",
      })}
      ${field({
        id: "prHandoff",
        label: "Handoff line",
        kind: "textarea",
        rows: 3,
        value: config.handoff_msg,
        required: true,
        max: 600,
        count: true,
        help: "Spoken instead of a guess, whenever the Knowledge Box does not support an answer.",
      })}`,
    )}
    ${card(
      "Voice agent",
      "The agent lives in ElevenLabs and calls this deployment as a custom server tool. These are its non-secret identifiers.",
      `<div class="vb-pr-pair">
        ${field({
          id: "prAgentId",
          label: "Agent id",
          value: config.agent_id ?? "",
          mono: true,
          max: 120,
          placeholder: "the deployment default agent",
          help: "The ElevenLabs Conversational AI agent that answers for this prospect.",
        })}
        ${field({
          id: "prVoiceId",
          label: "Voice id",
          value: config.voice_id ?? "",
          mono: true,
          max: 120,
          placeholder: "the deployment default voice",
          help: "Which ElevenLabs voice speaks.",
        })}
        ${field({
          id: "prToolId",
          label: "Tool id",
          value: config.tool_id ?? "",
          mono: true,
          max: 120,
          placeholder: "not pushed yet",
          help: "The custom server tool's id, once this product has created or adopted one.",
        })}
        ${field({
          id: "prAgentApiKeyId",
          label: "API key",
          value: config.agent_api_key_id ?? "",
          mono: true,
          max: 80,
          placeholder: "none",
          help: "Which stored API key the pushed tool's <code>X-API-Key</code> header carries. Never the secret itself.",
        })}
      </div>
      ${field({
        id: "prSystemPrompt",
        label: "Router prompt",
        kind: "textarea",
        rows: 8,
        value: config.system_prompt ?? "",
        max: 8000,
        count: true,
        placeholder: "the generated default",
        help: "Keeps the agent routing to the tool rather than answering by itself. Empty uses the prompt generated from the display name.",
      })}
      <details id="prPromptDefault" style="margin-top:6px">
        <summary class="arag-help" style="cursor:pointer">What "empty" uses</summary>
        <div id="prPromptBody" class="arag-help" style="margin-top:8px">${
          key
            ? "Loading the generated prompt…"
            : "Save this prospect first, then reopen it to see the prompt this deployment would generate."
        }</div>
      </details>`,
    )}
  </div>`;
}

function goldenPanel() {
  return `<div data-panel="golden" id="prPanel-golden" role="tabpanel" tabindex="0" hidden>
    ${card(
      "Golden set",
      `The questions this prospect is held to. Every one runs through this deployment's own
       pipeline, and the quality gate opens only when all of them behave — a deliberate handoff is
       a pass, not a failure. <strong>Must include</strong> is a comma-separated list of substrings
       the spoken answer has to contain, matched case-insensitively.`,
      `<div id="prGolden"></div>
       <button type="button" class="arag-btn secondary sm" id="prGoldenAdd">
         ${icon("plus", 14)} Add a question</button>`,
    )}
  </div>`;
}

function brandPanel(config) {
  const brand = config.brand ?? {};
  const swatchFor = (k, fallback) => {
    const v = String(brand[k] ?? deployment[k] ?? "");
    return /^#[0-9a-f]{6}$/i.test(v) ? v : fallback;
  };
  return `<div data-panel="brand" id="prPanel-brand" role="tabpanel" tabindex="0" hidden>
    <div class="vb-pv-wrap">${PREVIEW}</div>
    <ul class="vb-pv-layers" id="prLayers"></ul>
    ${card(
      "Brand overlay",
      `One deployment serves several of a partner's customers, so each prospect may carry its own
       identity. Anything left empty falls through to the deployment's branding, which is set under
       the operator's Branding view.`,
      `${field({
        id: "prBrandProductName",
        label: "Product name",
        value: brand.productName ?? "",
        max: 120,
        placeholder: String(deployment.productName ?? "inherited"),
        help: "Replaces the name in the rail, the browser tab and the docs.",
      })}
      ${field({
        id: "prBrandTagline",
        label: "Tagline",
        value: brand.tagline ?? "",
        max: 200,
        placeholder: String(deployment.tagline ?? "inherited"),
        help: "One line under the name. Empty hides it entirely.",
      })}
      ${field({
        id: "prBrandLogoUrl",
        label: "Logo URL",
        value: brand.logoUrl ?? "",
        max: 500,
        mono: true,
        placeholder: String(deployment.logoUrl || "inherited"),
        help: "An absolute <code>https://</code> URL or a path this deployment serves, such as <code>/branding/acme.svg</code>.",
      })}
      <div class="vb-pr-pair">
        ${field({
          id: "prBrandPrimaryColor",
          label: "Primary colour",
          kind: "colour",
          value: brand.primaryColor ?? "",
          swatch: swatchFor("primaryColor", "#2b2bb2"),
          placeholder: String(deployment.primaryColor || "inherited"),
          max: 40,
          help: "The action colour: buttons, links, the mark.",
        })}
        ${field({
          id: "prBrandAccentColor",
          label: "Accent colour",
          kind: "colour",
          value: brand.accentColor ?? "",
          swatch: swatchFor("accentColor", "#5ce500"),
          placeholder: String(deployment.accentColor || "inherited"),
          max: 40,
          help: "The liveness colour: the live pill, the current rail item.",
        })}
      </div>
      ${field({
        id: "prBrandFooterText",
        label: "Footer text",
        value: brand.footerText ?? "",
        max: 200,
        placeholder: String(deployment.footerText ?? "inherited"),
        help: "The line at the foot of the rail — usually a copyright.",
      })}
      ${field({
        id: "prBrandPoweredBy",
        label: "Progress credit",
        kind: "select",
        value: brand.poweredBy === undefined ? "" : String(brand.poweredBy),
        options: [
          { value: "", label: "Inherit from the deployment" },
          { value: "true", label: "Show the Progress wordmark and credit" },
          { value: "false", label: "Hide them — full white label" },
        ],
        help: "Hiding removes the wordmark band and the credit line. Attribution stays in LICENSE and THIRD_PARTY_NOTICES.",
      })}`,
    )}
  </div>`;
}

function jsonPanel(key) {
  return `<div data-panel="json" id="prPanel-json" role="tabpanel" tabindex="0" hidden>
    ${card(
      "Raw configuration",
      `The record as the API sees it, for pasting a whole prospect in or out. The form is the
       source of truth: this is generated from it, and Apply reads it back into the form so
       everything is still validated before it is sent.`,
      `${field({
        id: "prJson",
        label: "Configuration JSON",
        kind: "textarea",
        rows: 20,
        mono: true,
        help: `<code>id</code>, <code>createdAt</code> and <code>updatedAt</code> are store fields,
          not input — they are never sent${key ? ", so a record pasted back from the API is accepted" : ""}.`,
      })}
      <div class="arag-row">
        <button type="button" class="arag-btn secondary sm" id="prJsonApply">Apply to the form</button>
        <span class="arag-help">Replaces every field with what is written above.</span>
      </div>`,
    )}
  </div>`;
}

// ── wiring ───────────────────────────────────────────────────────────────────

function wireEditor(key, close) {
  const tabs = $("#prTabs");
  tabs.addEventListener("click", (e) => {
    const t = e.target.closest("[role=tab]");
    if (t) selectTab(t.dataset.tab);
  });

  // The preview is the point of the branding half: it redraws as the value is typed, not on blur.
  for (const f of BRAND_FIELDS) {
    const el = document.getElementById(f.id);
    el?.addEventListener("input", () => {
      if (f.kind === "colour") syncSwatch(f.id);
      renderPreview();
    });
    el?.addEventListener("change", renderPreview);
    const swatch = document.getElementById(`${f.id}-swatch`);
    swatch?.addEventListener("input", () => {
      document.getElementById(f.id).value = swatch.value;
      renderPreview();
    });
  }

  for (const id of ["prGreeting", "prHandoff", "prSystemPrompt"]) {
    document.getElementById(id)?.addEventListener("input", () => updateCount(id));
  }

  $("#prGoldenAdd")?.addEventListener("click", () => {
    golden = [...readGoldenRows(), { q: "", expect: "answer" }];
    renderGolden();
    document.querySelector(`[data-gq="${golden.length - 1}"] [data-gq-q]`)?.focus();
  });
  $("#prGolden")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-gq-remove]");
    if (!btn) return;
    const i = Number(btn.dataset.gqRemove);
    golden = readGoldenRows().filter((_, n) => n !== i);
    renderGolden();
    ($(`[data-gq="${Math.min(i, golden.length - 1)}"] [data-gq-q]`) ?? $("#prGoldenAdd"))?.focus();
  });

  $("#prJsonApply")?.addEventListener("click", () => {
    let parsed;
    try {
      parsed = JSON.parse($("#prJson").value);
    } catch (e) {
      return showErrors([], `That is not valid JSON: ${e.message}`);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return showErrors([], "The configuration has to be a JSON object.");
    }
    clearErrors();
    writeForm(parsed);
    selectTab("setup");
    toast("Applied to the form", "info");
  });

  $("#prSave").addEventListener("click", () => save(key, close));
  $("#prProvision")?.addEventListener("click", () => provision(key));
  $("#prDelete")?.addEventListener("click", () => remove(key, close));
}

async function save(key, close) {
  clearErrors();
  const cfg = readForm();
  const newKey = key ?? val("prKey");
  const local = localErrors(cfg, key ? null : newKey);
  if (local.length) return showErrors(local);

  const btn = $("#prSave");
  btn.disabled = true;
  try {
    if (key) {
      await api(`/api/v1/admin/prospects/${encodeURIComponent(key)}`, { method: "PUT", json: cfg });
    } else {
      await api("/api/v1/admin/prospects", { method: "POST", json: { key: newKey, config: cfg } });
    }
    toast("Prospect saved", "info");
    close();
    await load();
  } catch (e) {
    // The server is the authority. Whatever it named, name it in the same place.
    showErrors(problemErrors(e), e.problem?.detail ?? e.message);
  } finally {
    btn.disabled = false;
  }
}

async function provision(key) {
  $("#prResult").innerHTML = '<div class="arag-skeleton" style="height:50px;margin-bottom:10px"></div>';
  try {
    const r = await api(`/api/v1/admin/prospects/${encodeURIComponent(key)}/provision`, {
      method: "POST",
      json: {},
    });
    $("#prResult").innerHTML = `<div class="arag-alert ok" style="margin:0 0 10px">Stored search
      configuration <strong>${esc(r.name)}</strong> ${r.applied ? "written to the Knowledge Box" : "unchanged"}.
      The registry now points at it.</div>`;
    const el = document.getElementById("prAskConfig");
    if (el && r.name) el.value = r.name;
    await load();
  } catch (e) {
    $("#prResult").innerHTML = `<div class="arag-alert error" style="margin:0 0 10px">${esc(
      e.problem?.detail ?? e.message,
    )}</div>`;
  }
}

async function remove(key, close) {
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
    showErrors(problemErrors(e), e.problem?.detail ?? e.message);
  }
}

/**
 * What an empty router prompt actually resolves to.
 *
 * `GET /api/v1/voice-agent` returns the *effective* prompt, so it shows the generated default only
 * while this prospect has no override of its own. When it does, the honest thing to say is what
 * the override is and how to get back to the default.
 */
async function loadGeneratedPrompt(key) {
  const body = $("#prPromptBody");
  if (!body) return;
  try {
    const cfg = await api(`/api/v1/voice-agent?prospect=${encodeURIComponent(key)}`);
    generatedPrompt = cfg.system_prompt_custom ? null : cfg.system_prompt;
    if (!body.isConnected) return;
    body.innerHTML = generatedPrompt
      ? `<p style="margin:0 0 8px">Leaving the field empty sends this, generated from the display name:</p>
         <pre style="white-space:pre-wrap;font-size:12px;margin:0 0 8px">${esc(generatedPrompt)}</pre>
         <button type="button" class="arag-btn ghost sm" id="prPromptUse">Start from this prompt</button>`
      : `<p style="margin:0">This prospect overrides the router prompt, so the agent is being sent the
         text above rather than the generated one. Clear the field and save to go back to the
         default, which is built from the display name.</p>`;
    $("#prPromptUse")?.addEventListener("click", () => {
      const el = $("#prSystemPrompt");
      el.value = generatedPrompt;
      updateCount("prSystemPrompt");
      el.focus();
    });
  } catch (e) {
    if (body.isConnected) body.textContent = `The generated prompt could not be read: ${e.message}`;
  }
}

// ── read-only detail, for someone without the operator token ─────────────────

function viewer(key) {
  const p = records.find((r) => (r.id ?? r.key) === key);
  if (!p) return;
  openDrawer({
    title: p.display_name,
    sub: `<span class="mono">${esc(key)}</span>`,
    body: `
      <dl class="arag-kv">
        <dt>Locale</dt><dd>${esc(p.locale ?? "—")}</dd>
        <dt>Greeting</dt><dd>${esc(p.greeting ?? "—")}</dd>
        <dt>Handoff line</dt><dd>${esc(p.handoff_msg ?? "—")}</dd>
        <dt>Voice agent</dt><dd>${p.agent_id ? `<span class="mono">${esc(p.agent_id)}</span>` : "not configured"}</dd>
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

// ── page ─────────────────────────────────────────────────────────────────────

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
deployment = state.branding ?? {};
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
