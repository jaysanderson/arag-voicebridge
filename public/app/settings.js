// Settings — the deployment, editable.
//
// The rule this screen implements (V-26): environment variables are defaults, the JSON store is
// the authority, and a change takes effect without a restart. Nothing the product reads from
// configuration is read-only here except secrets, which are set once and then shown as
// "set · rotate".
//
// Nothing on this page is hand-listed. `GET /api/v1/admin/settings` returns groups of fields with
// their type, label, help, bounds, effective value and where that value came from, and the form is
// rendered from that payload — so a setting added to the server's table appears here with no
// front-end change. What *is* hand-written is the surrounding product: the live connection state,
// the branding preview and logo upload, the ElevenLabs integration and agent push, the API key
// store, and purge.
//
// Gating follows Prospects (V-22): the page renders for anyone with the read view it can get, and
// the editing surface appears in place once the deployment's admin token has been exchanged for
// the operator cookie. Nobody is sent to /admin/ to change a setting.
import { confirmDialog, icon as kitIcon } from "/ui/arag-ui.js";
import {
  ago,
  api,
  applyBrand,
  boot,
  chip,
  confirmAction,
  empty,
  errorState,
  esc,
  fmtMs,
  icon,
  isOperator,
  mountShell,
  openDrawer,
  prospectSwitcher,
  signInOperator,
  snippet,
  state,
  toast,
} from "./shell.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/** The page's sections, in reading order. The ids are the deep links the wizard uses. */
const SECTIONS = [
  { id: "connection", label: "Connection", group: "connection" },
  { id: "branding", label: "Branding", group: "branding" },
  { id: "limits", label: "Limits", group: "limits" },
  { id: "elevenlabs", label: "ElevenLabs", group: "elevenlabs" },
  { id: "api-keys", label: "API keys", group: null },
  { id: "retention", label: "Retention", group: "retention" },
  { id: "api", label: "API", group: null },
];

/** Scopes of the purge control. Everything but `retention` ignores the age windows. */
const PURGE_SCOPES = [
  { id: "retention", label: "Apply the retention windows", what: "records older than the windows above" },
  { id: "turns", label: "Every recorded turn", what: "every recorded turn, at any age" },
  {
    id: "sessions",
    label: "Every conversation",
    what: "every listen session and its transcript, at any age",
  },
  { id: "evals", label: "Every golden run", what: "every stored golden-set evaluation, at any age" },
  {
    id: "all",
    label: "Everything",
    what: "every turn, every conversation with its transcript, and every golden run",
  },
];

let operator = false;
/** The described groups, keyed by id — the contract this form is rendered from. */
let groups = new Map();
let keys = { items: [], open: true, active: 0 };

// ── field rendering ──────────────────────────────────────────────────────────

const fieldId = (f) => `set-${f.group}-${f.key}`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Fields that need the full width of the card: URLs, prose, anything with a long value. */
function isWide(f) {
  return f.type === "text" || ["logoUrl", "baseUrl", "publicUrl", "help", "footerText"].includes(f.key);
}

/**
 * Where this value came from, and — when it is an override — how to put it back.
 *
 * It sits under the control rather than beside the label: a long environment variable name next to
 * a short label wraps, and a wrapped label makes every control in the row start at a different
 * height. Provenance reads perfectly well next to the help text.
 */
function origin(f) {
  if (f.source !== "stored") {
    return `<p class="vb-set-origin">from <code>${esc(f.env)}</code></p>`;
  }
  const v = f.envValue;
  const shown = v === "" || v === undefined || v === null ? "empty" : String(v);
  const back =
    f.type === "secret"
      ? "the value in the environment"
      : `<code>${esc(shown)}</code> from <code>${esc(f.env)}</code>`;
  return `<p class="vb-set-origin stored">overridden ·
    <button type="button" data-reset="${esc(f.group)}.${esc(f.key)}">reset</button> to ${back}</p>`;
}

/**
 * An empty colour means "whatever the workspace is already using". Seeding the swatch with
 * #000000 would claim the colour is black, so it is seeded from the variable this field actually
 * feeds — the colour in force is what the operator is about to change.
 */
const COLOUR_VAR = { primaryColor: "--arag-brand-500", accentColor: "--arag-green" };

function swatchValue(f) {
  const v = String(f.value ?? "").trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v;
  const token = COLOUR_VAR[f.key];
  const inForce = token ? getComputedStyle(document.documentElement).getPropertyValue(token).trim() : "";
  return /^#[0-9a-f]{6}$/i.test(inForce) ? inForce : "#ffffff";
}

function control(f) {
  const id = fieldId(f);
  const common = `id="${id}" data-control name="${esc(f.key)}"`;
  switch (f.type) {
    case "boolean":
      return `<label class="arag-switch"><input type="checkbox" ${common}${f.value ? " checked" : ""} />
        <span class="muted small">${f.value ? "On" : "Off"}</span></label>`;
    case "number":
      return `<input class="arag-input" type="number" ${common} value="${esc(String(f.value ?? ""))}"
        ${f.min !== undefined ? `min="${f.min}"` : ""} ${f.max !== undefined ? `max="${f.max}"` : ""}
        inputmode="numeric" />`;
    case "enum":
      return `<select class="arag-select" ${common}>${(f.options ?? [])
        .map((o) => `<option value="${esc(o)}"${o === f.value ? " selected" : ""}>${esc(o)}</option>`)
        .join("")}</select>`;
    case "color":
      // A partner pastes a hex; a designer picks one. Both edit the same value, and the text field
      // is the authority — it can be empty, which a colour input cannot express.
      return `<div class="vb-set-colour">
        <input class="arag-input" type="color" data-swatch aria-label="${esc(f.label)} swatch"
          value="${esc(swatchValue(f))}" />
        <input class="arag-input mono" type="text" ${common} value="${esc(String(f.value ?? ""))}"
          placeholder="${esc(f.placeholder ?? "default")}" spellcheck="false" autocomplete="off" />
      </div>`;
    case "secret":
      return f.set
        ? `<div class="vb-set-secret" data-secret>
             <span class="arag-chip ok">set</span><code>${esc(f.hint ?? "")}</code>
             <button type="button" class="arag-btn ghost sm" data-rotate="${esc(f.group)}.${esc(f.key)}">Rotate</button>
           </div>`
        : `<input class="arag-input" type="password" ${common} value="" autocomplete="new-password"
             placeholder="not set" spellcheck="false" />`;
    case "text":
      return `<textarea class="arag-textarea" ${common} rows="4" spellcheck="false">${esc(
        String(f.value ?? ""),
      )}</textarea>`;
    default:
      return `<input class="arag-input" type="text" ${common} value="${esc(String(f.value ?? ""))}"
        placeholder="${esc(f.placeholder ?? "")}" spellcheck="false" autocomplete="off" />`;
  }
}

function fieldHtml(f) {
  return `<div class="arag-field vb-set-field${isWide(f) ? " wide" : ""}"
      data-field="${esc(f.group)}.${esc(f.key)}" data-type="${esc(f.type)}">
    <label for="${fieldId(f)}">${esc(f.label)}</label>
    ${control(f)}
    <p class="arag-help">${esc(f.help)}</p>
    ${origin(f)}
    <p class="vb-set-err" hidden></p>
  </div>`;
}

/** The form for one group: its fields, then its own Save. Saves are per group, never page-wide. */
function groupForm(id) {
  const g = groups.get(id);
  if (!operator) {
    return `<p class="arag-help" data-locked>Operator-only. Unlock this page to see and change these
      values; every one of them is editable here.</p>`;
  }
  if (!g) return `<div class="arag-skeleton" style="height:120px"></div>`;
  return `<form class="vb-set-form" data-group="${esc(id)}" novalidate>
      <div class="vb-set-grid">${g.fields.map(fieldHtml).join("")}</div>
      <p class="arag-alert error vb-set-summary" hidden></p>
      <div class="vb-set-foot">
        <button class="arag-btn" type="submit" data-save disabled>Save</button>
        <button class="arag-btn ghost sm" type="button" data-reset-group="${esc(id)}">Reset to the environment</button>
        <span class="spacer"></span>
        <span class="vb-set-status" data-status aria-live="polite"></span>
      </div>
    </form>`;
}

// ── reading the form back ────────────────────────────────────────────────────

function fieldSpec(group, key) {
  return groups.get(group)?.fields.find((f) => f.key === key);
}

/**
 * What this control holds now, and whether that differs from what the server last described.
 * A secret is only ever "changed" when the operator actually typed one: an empty submit must not
 * blank a key that is set.
 */
function readField(el) {
  const [group, key] = el.dataset.field.split(".");
  const f = fieldSpec(group, key);
  const input = $("[data-control]", el);
  if (!f || !input) return { f: null, changed: false };
  if (f.type === "secret") {
    const typed = input.value;
    return { f, value: typed, changed: typed.length > 0 };
  }
  if (f.type === "boolean") return { f, value: input.checked, changed: input.checked !== Boolean(f.value) };
  if (f.type === "number") {
    const raw = input.value.trim();
    if (raw === "") return { f, value: null, changed: true, error: "Enter a number." };
    const n = Number(raw);
    if (!Number.isFinite(n)) return { f, value: null, changed: true, error: "Enter a number." };
    return { f, value: n, changed: n !== Number(f.value) };
  }
  const v = input.value;
  return { f, value: v, changed: v !== String(f.value ?? "") };
}

function formFields(form) {
  return $$(".vb-set-field", form).filter((el) => $("[data-control]", el));
}

function dirtyCount(form) {
  return formFields(form).filter((el) => readField(el).changed).length;
}

function refreshDirty(form) {
  const n = dirtyCount(form);
  const save = $("[data-save]", form);
  save.disabled = n === 0;
  const status = $("[data-status]", form);
  if (!status.dataset.sticky) {
    status.className = "vb-set-status";
    status.textContent = n ? `${n} change${n === 1 ? "" : "s"} not saved` : "";
  }
}

function clearErrors(form) {
  for (const el of $$(".vb-set-field", form)) {
    delete el.dataset.invalid;
    const err = $(".vb-set-err", el);
    err.hidden = true;
    err.textContent = "";
  }
  const summary = $(".vb-set-summary", form);
  summary.hidden = true;
  summary.textContent = "";
}

function showFieldError(form, group, key, message) {
  const el = $(`.vb-set-field[data-field="${group}.${key}"]`, form);
  if (!el) return false;
  el.dataset.invalid = "1";
  const err = $(".vb-set-err", el);
  err.hidden = false;
  err.textContent = message;
  return true;
}

/**
 * Land a server-side validation problem on the control that caused it.
 *
 * `errors[].path` is `/branding/primaryColor` for a field. The turn-budget invariant is checked
 * after the whole patch is applied, so it comes back as `/limits` with the offending environment
 * variable named in the message — that is enough to put it against the right field rather than
 * throwing a toast at the operator.
 */
function applyProblem(form, group, err) {
  const problem = err.problem ?? {};
  const rows = Array.isArray(problem.errors) ? problem.errors : [];
  let placed = 0;
  const unplaced = [];
  for (const row of rows) {
    const parts = String(row.path ?? "")
      .split("/")
      .filter(Boolean);
    const key = parts.length >= 2 ? parts[1] : null;
    if (key && showFieldError(form, group, key, row.message)) {
      placed++;
      continue;
    }
    // A group-level failure: find the field whose environment variable the message names.
    const named = (groups.get(group)?.fields ?? []).find((f) => row.message?.includes(f.env));
    if (named && showFieldError(form, group, named.key, row.message)) placed++;
    else unplaced.push(`${row.path || "/"} ${row.message}`);
  }
  if (!placed || unplaced.length) {
    const summary = $(".vb-set-summary", form);
    summary.hidden = false;
    summary.textContent = unplaced.length ? unplaced.join("; ") : (problem.detail ?? err.message);
  }
  const status = $("[data-status]", form);
  status.dataset.sticky = "1";
  status.className = "vb-set-status bad";
  status.textContent = placed ? "Not saved — see the fields marked below" : "Not saved";
}

// ── saving ───────────────────────────────────────────────────────────────────

async function loadSettings() {
  if (!operator) return;
  const { groups: list } = await api("/api/v1/admin/settings");
  groups = new Map(list.map((g) => [g.id, g]));
}

/** Re-render one group's form from the freshly described payload. */
function repaintGroup(id) {
  const host = $(`[data-group-host="${id}"]`);
  if (!host) return;
  host.innerHTML = groupForm(id);
  wireGroup(host);
  if (id === "branding") paintPreview();
}

async function saveGroup(form) {
  const group = form.dataset.group;
  clearErrors(form);
  const patch = {};
  let localError = false;
  for (const el of formFields(form)) {
    const { f, value, changed, error } = readField(el);
    if (!f || !changed) continue;
    if (error) {
      showFieldError(form, group, f.key, error);
      localError = true;
      continue;
    }
    patch[f.key] = value;
  }
  if (localError) return;
  if (Object.keys(patch).length === 0) return;

  const save = $("[data-save]", form);
  save.disabled = true;
  const status = $("[data-status]", form);
  delete status.dataset.sticky;
  status.className = "vb-set-status";
  status.textContent = "Saving…";
  try {
    const { groups: list } = await api("/api/v1/admin/settings", {
      method: "PATCH",
      json: { [group]: patch },
    });
    groups = new Map(list.map((g) => [g.id, g]));
    repaintGroup(group);
    const fresh = $(`[data-group-host="${group}"] [data-status]`);
    if (fresh) {
      fresh.dataset.sticky = "1";
      fresh.className = "vb-set-status ok";
      fresh.textContent = "Saved — live now, no restart";
    }
    await afterSave(group);
  } catch (e) {
    applyProblem(form, group, e);
    refreshDirty(form);
  }
}

/** The consequences of a save that the rest of the page has to hear about. */
async function afterSave(group) {
  if (group === "branding") {
    // GET /api/v1/branding is the authority; the shell repaints from it without a reload. The
    // prospect list is refreshed with it, because a prospect's `brand` is the *effective* payload
    // — deployment branding with that prospect's overlay on top — and it has just gone stale.
    const [b, list] = await Promise.all([
      api("/api/v1/branding").catch(() => null),
      api("/api/v1/prospects").catch(() => null),
    ]);
    if (b) state.branding = b;
    if (list?.items) {
      state.prospects = list.items;
      state.current = list.items.find((p) => p.key === state.current?.key) ?? list.items[0] ?? null;
    }
    applyBrand(state.current?.brand ?? state.branding);
    paintPreview();
  }
  if (group === "connection") await loadHealth();
  if (group === "elevenlabs") {
    await loadIntegrations();
    await loadAgent();
  }
}

async function resetField(group, key) {
  try {
    const { groups: list } = await api("/api/v1/admin/settings", {
      method: "PATCH",
      json: { [group]: { [key]: null } },
    });
    groups = new Map(list.map((g) => [g.id, g]));
    repaintGroup(group);
    await afterSave(group);
    toast("Reset to the environment default", "info");
  } catch (e) {
    toast(problemText(e), "error");
  }
}

async function resetGroup(id) {
  const g = groups.get(id);
  const yes = await confirmAction({
    title: `Reset ${g?.title ?? id} to the environment?`,
    body: "Every stored override in this group is dropped and the deployment falls back to the values its environment variables supply. It takes effect immediately.",
    confirmLabel: "Reset the group",
  });
  if (!yes) return;
  try {
    const { groups: list } = await api("/api/v1/admin/settings/reset", {
      method: "POST",
      json: { group: id },
    });
    groups = new Map(list.map((x) => [x.id, x]));
    repaintGroup(id);
    await afterSave(id);
    toast(`${g?.title ?? id} reset to the environment`, "info");
  } catch (e) {
    toast(problemText(e), "error");
  }
}

function problemText(e) {
  const p = e.problem;
  if (p?.errors?.length) return p.errors.map((x) => `${x.path || "/"} ${x.message}`).join("; ");
  return p?.detail ?? e.message;
}

// ── wiring one group's form ──────────────────────────────────────────────────

function wireGroup(host) {
  const form = $("form[data-group]", host);
  if (!form) return;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    saveGroup(form);
  });
  form.addEventListener("input", (e) => {
    const el = e.target.closest(".vb-set-field");
    if (el) {
      delete el.dataset.invalid;
      const err = $(".vb-set-err", el);
      err.hidden = true;
    }
    // The swatch and the hex field are one value: whichever the operator moved, the other follows.
    if (el?.dataset.type === "color") {
      if (e.target.dataset.swatch !== undefined) $("[data-control]", el).value = e.target.value;
      else if (/^#[0-9a-f]{6}$/i.test(e.target.value)) $("[data-swatch]", el).value = e.target.value;
    }
    if (e.target.type === "checkbox") {
      const label = e.target.nextElementSibling;
      if (label) label.textContent = e.target.checked ? "On" : "Off";
    }
    delete $("[data-status]", form).dataset.sticky;
    refreshDirty(form);
    if (form.dataset.group === "branding") paintPreview();
  });
  form.addEventListener("click", async (e) => {
    const reset = e.target.closest("[data-reset]");
    if (reset) {
      const [group, key] = reset.dataset.reset.split(".");
      return resetField(group, key);
    }
    const rotate = e.target.closest("[data-rotate]");
    if (rotate) {
      const [, key] = rotate.dataset.rotate.split(".");
      const box = rotate.closest("[data-secret]");
      const f = fieldSpec(form.dataset.group, key);
      box.outerHTML = `<input class="arag-input" type="password" id="${fieldId(f)}" data-control
        name="${esc(key)}" value="" autocomplete="new-password" placeholder="Paste the new value"
        spellcheck="false" />`;
      $(`#${CSS.escape(fieldId(f))}`, form)?.focus();
      refreshDirty(form);
      return;
    }
    const group = e.target.closest("[data-reset-group]");
    if (group) resetGroup(group.dataset.resetGroup);
  });
  refreshDirty(form);
}

// ── the page ─────────────────────────────────────────────────────────────────

function signInBanner() {
  return `<div class="arag-card pad" id="stSignIn" style="margin-bottom:20px">
    <div class="arag-row" style="align-items:flex-start;gap:14px">
      <span class="arag-icon-box" style="width:34px;height:34px">${icon("operator", 17)}</span>
      <div style="flex:1;min-width:220px">
        <strong>Viewing this deployment read-only</strong>
        <p class="muted small" style="margin:4px 0 0">Every setting on this page is editable — the
          store overrides the environment and a change takes effect without a restart. Enter this
          deployment's admin token to unlock the forms.</p>
      </div>
      <div class="arag-row" style="flex:none">
        <input id="stToken" class="arag-input" type="password" placeholder="Admin token"
          autocomplete="off" style="width:200px" />
        <button class="arag-btn" id="stUnlock">Unlock</button>
      </div>
    </div>
    <p id="stSignInError" class="arag-alert error" hidden style="margin:12px 0 0"></p>
  </div>`;
}

function sectionNav() {
  return `<nav class="arag-tabs vb-set-nav" aria-label="Settings sections">
    ${SECTIONS.map((s) => `<a href="#${s.id}" data-jump="${s.id}">${esc(s.label)}</a>`).join("")}
  </nav>`;
}

function card(id, title, description, body, headExtra = "") {
  return `<section class="arag-card vb-set-section" id="${id}">
    <div class="head"><h2>${esc(title)}</h2><span class="spacer"></span>${headExtra}</div>
    <div class="body">
      ${description ? `<p class="muted small" style="margin:0 0 18px;max-width:68ch">${esc(description)}</p>` : ""}
      ${body}
    </div>
  </section>`;
}

function groupHost(id) {
  return `<div data-group-host="${id}">${groupForm(id)}</div>`;
}

function chrome() {
  const g = (id) => groups.get(id);
  return `
    ${operator ? "" : signInBanner()}
    ${sectionNav()}

    ${card(
      "connection",
      "Connection",
      g("connection")?.description ??
        "How the bridge reaches Progress Agentic RAG. The Knowledge Box here is the deployment default — a prospect may point at its own.",
      `<div id="stConnection" style="margin-bottom:22px"><div class="arag-skeleton" style="height:130px"></div></div>
       ${groupHost("connection")}`,
    )}

    ${card(
      "branding",
      "Branding",
      g("branding")?.description ??
        "How this deployment identifies itself. A partner rebrands without a fork; per-prospect overlays layer on top of these under Prospects.",
      `<div class="arag-split" style="margin-bottom:22px">
         <div id="stBrandForm">${groupHost("branding")}</div>
         <div class="sticky">
           <div id="stBrand"></div>
           <div id="stLogo" style="margin-top:18px"></div>
         </div>
       </div>`,
    )}

    ${card(
      "limits",
      "Limits and timeouts",
      g("limits")?.description ??
        "The budgets that keep a voice turn inside the agent's tool timeout and stop one caller spending everyone's quota.",
      groupHost("limits"),
    )}

    ${card(
      "elevenlabs",
      "ElevenLabs",
      g("elevenlabs")?.description ??
        "The default voice stack: Scribe transcription, the Conversational AI agent and the optional spoken brief.",
      `<div id="stIntegrations">
         ${groupHost("elevenlabs")}
         <div id="stCapabilities" style="margin-top:24px"><div class="arag-skeleton" style="height:120px"></div></div>
         <div id="voice-agent" class="vb-set-anchor" style="margin-top:26px"><div id="stAgent"></div></div>
       </div>`,
    )}

    ${card("api-keys", "API keys", "", `<div id="stKeys"><div class="arag-skeleton" style="height:150px"></div></div>`)}

    ${card(
      "retention",
      "Retention",
      g("retention")?.description ??
        "How long recorded turns, conversations and golden runs are kept before purging.",
      `${groupHost("retention")}
       <div id="stPurge" style="margin-top:26px"></div>`,
    )}

    ${card(
      "api",
      "API",
      "Everything this workspace does, your own application can do. The session API is transport-agnostic: any source that can post JSON can drive a brief.",
      `<div class="arag-chips">
         <a class="arag-btn secondary sm" href="/api/">${icon("api", 14)} API explorer</a>
         <a class="arag-btn ghost sm" href="/api/v1/docs">${icon("source", 14)} Reference</a>
         <a class="arag-btn ghost sm" href="/api/v1/swagger">Swagger</a>
         <a class="arag-btn ghost sm" href="/api/v1/openapi.json">OpenAPI document</a>
       </div>
       <p class="muted small" style="margin:16px 0 6px">Open a session and stream its brief:</p>
       ${snippet(
         `curl -sX POST ${location.origin}/api/v1/listen/sessions -H 'content-type: application/json' \\\n  -d '{"prospect":"${esc(
           state.current?.key ?? "your-prospect",
         )}"}'`,
       )}`,
    )}`;
}

// ── connection health ────────────────────────────────────────────────────────

async function loadHealth() {
  const host = $("#stConnection");
  if (!host) return;
  try {
    const r = await api("/readyz");
    const a = r.arag ?? {};
    host.innerHTML = `
      <div class="arag-row" style="gap:8px;margin-bottom:12px;flex-wrap:wrap">
        <strong style="font-size:0.86rem">Connection health</strong>
        ${a.ok ? chip("connected", "ok") : chip("unreachable", "danger")}
        ${a.mock ? chip("mock Knowledge Box", "warn") : ""}
      </div>
      ${
        a.mock
          ? `<div class="arag-alert warn" style="margin-bottom:14px">This deployment is answering from
              the in-process sample Knowledge Box. Fill in the Knowledge Box id, the service-account
              token and the region below to point it at your own content — no restart needed.</div>`
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
        under <a href="/admin/#connection">Operator → Connection</a>.</p>`;
  } catch (e) {
    host.innerHTML = errorState(e.message, "stHealthRetry");
    $("#stHealthRetry")?.addEventListener("click", loadHealth);
  }
}

// ── branding preview and the logo ────────────────────────────────────────────

/** Is anything in the branding form typed but not yet saved? The preview says so when it is. */
function dirtyBranding() {
  const form = document.querySelector('form[data-group="branding"]');
  return Boolean(form) && dirtyCount(form) > 0;
}

/** What the branding form holds right now — typed values first, saved values behind them. */
function previewBrand() {
  const b = { ...(state.branding ?? {}) };
  const g = groups.get("branding");
  if (!operator || !g) return b;
  for (const f of g.fields) {
    const el = $(`.vb-set-field[data-field="branding.${f.key}"]`);
    const input = el ? $("[data-control]", el) : null;
    if (!input) {
      b[f.key] = f.value;
      continue;
    }
    b[f.key] = f.type === "boolean" ? input.checked : input.value;
  }
  return b;
}

/** The rail as a customer will see it, repainted on every keystroke — before anything is saved. */
function paintPreview() {
  const host = $("#stBrand");
  if (!host) return;
  const b = previewBrand();
  const powered = b.poweredBy !== false;
  const mark = b.logoUrl
    ? `<img src="${esc(b.logoUrl)}" alt="" />`
    : powered
      ? `<img src="/ui/brand/arag-logo-alt.svg" alt="Progress Agentic RAG" />`
      : "";
  host.innerHTML = `
    <div class="arag-row" style="gap:8px;margin-bottom:10px;flex-wrap:wrap">
      <strong style="font-size:0.86rem">Preview</strong>
      ${powered ? chip("Progress default", "neutral") : chip("white-labelled", "info")}
      ${dirtyBranding() ? '<span class="muted small">including unsaved changes</span>' : ""}
    </div>
    <div class="vb-set-preview">
      <div class="mark">${mark}</div>
      <div>
        <div class="name">${esc(b.productName || "VoiceBridge")}</div>
        <div class="tagline">${esc(b.tagline ?? "")}</div>
      </div>
      <div class="swatches">
        <span class="swatch" style="background:${esc(safeColor(b.primaryColor) || "var(--arag-brand-500)")}"></span>
        <span class="swatch" style="background:${esc(safeColor(b.accentColor) || "var(--arag-green)")}"></span>
        <span style="opacity:.5;font-size:11px">primary · accent</span>
      </div>
      <div class="foot">${esc(b.footerText ?? "")}${powered ? " · Built on Progress Agentic RAG" : ""}</div>
    </div>
    <p class="arag-help" style="margin-top:8px">Saving repaints the whole workspace — the rail, the
      tab title and the action colour — without a reload.</p>`;
}

/**
 * Only a value this browser can safely put in a style attribute reaches one. The server validates
 * colours too, but the preview renders *before* the save, so it does its own checking.
 */
function safeColor(v) {
  const s = String(v ?? "").trim();
  return /^(#[0-9a-f]{3,8}|rgb\([\d\s,.%/]+\)|hsl\([\d\s,.%/deg]+\)|[a-z]{3,20})$/i.test(s) ? s : "";
}

function paintLogo() {
  const host = $("#stLogo");
  if (!host) return;
  if (!operator) {
    host.innerHTML = "";
    return;
  }
  const url = fieldSpec("branding", "logoUrl")?.value ?? "";
  host.innerHTML = `
    <strong style="font-size:0.86rem;display:block;margin-bottom:10px">Logo</strong>
    <div class="vb-set-logo" style="margin-bottom:12px">
      <span class="frame">${
        url ? `<img src="${esc(url)}" alt="The current mark" />` : '<span class="muted small">no mark</span>'
      }</span>
      <div style="flex:1;min-width:150px">
        <p class="arag-help" style="margin:0">${
          url
            ? "Replaces the Progress wordmark on the rail and in the preview."
            : "With none set, the rail carries the Progress wordmark."
        }</p>
        ${url ? '<button class="arag-btn ghost sm danger" id="stLogoRemove" style="margin-top:8px">Remove</button>' : ""}
      </div>
    </div>
    <div class="arag-dropzone vb-set-dropzone" id="stDrop" tabindex="0" role="button"
      aria-label="Upload a logo">
      <span class="icon">${kitIcon("upload", { size: 26 })}</span>
      <strong>Drop an image, or choose a file</strong>
      <span class="small">SVG, PNG, JPEG, WebP or GIF · 1 MB max</span>
      <input type="file" id="stLogoFile" accept="image/svg+xml,image/png,image/jpeg,image/webp,image/gif" hidden />
    </div>
    <p class="vb-set-err" id="stLogoError" hidden></p>`;

  const drop = $("#stDrop");
  const file = $("#stLogoFile");
  drop.addEventListener("click", () => file.click());
  drop.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      file.click();
    }
  });
  for (const ev of ["dragenter", "dragover"]) {
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.add("drag");
    });
  }
  for (const ev of ["dragleave", "drop"]) {
    drop.addEventListener(ev, () => drop.classList.remove("drag"));
  }
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    if (e.dataTransfer?.files?.[0]) uploadLogo(e.dataTransfer.files[0]);
  });
  file.addEventListener("change", () => file.files?.[0] && uploadLogo(file.files[0]));
  $("#stLogoRemove")?.addEventListener("click", removeLogo);
}

async function uploadLogo(f) {
  const err = $("#stLogoError");
  err.hidden = true;
  const body = new FormData();
  body.append("file", f);
  try {
    const res = await fetch("/api/v1/admin/settings/logo", {
      method: "POST",
      body,
      credentials: "same-origin",
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.detail ?? `${res.status} ${res.statusText}`);
    await loadSettings();
    repaintGroup("branding");
    paintLogo();
    await afterSave("branding");
    toast("Logo uploaded", "ok");
  } catch (e) {
    err.hidden = false;
    err.textContent = e.message;
  }
}

async function removeLogo() {
  const yes = await confirmAction({
    title: "Remove the logo?",
    body: "The file is deleted from this deployment and the rail falls back to the wordmark. You can upload another at any time.",
    confirmLabel: "Remove it",
  });
  if (!yes) return;
  try {
    await api("/api/v1/admin/settings/logo", { method: "DELETE" });
    await loadSettings();
    repaintGroup("branding");
    paintLogo();
    await afterSave("branding");
  } catch (e) {
    toast(problemText(e), "error");
  }
}

// ── integrations and the voice agent ─────────────────────────────────────────

/** One integration, shown in full: what it powers here, whether it is on, and what switches it on. */
function integrationCard(i) {
  return `<div>
    <div class="arag-row" style="gap:8px;flex-wrap:wrap;margin-bottom:6px">
      <strong style="font-size:0.86rem">${esc(i.name)}</strong>
      ${i.primary ? '<span class="vb-powered">Primary</span>' : ""}
      <span class="spacer" style="flex:1"></span>
      ${i.configured ? chip("configured", "ok") : chip("not configured", "neutral")}
    </div>
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
                <td>${c.enabled ? chip("in use", "ok") : chip("unavailable", "neutral")}</td>
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
      <dt>Environment default</dt><dd class="mono">${esc(i.setup)}</dd>
    </dl>`;
}

async function loadIntegrations() {
  const host = $("#stCapabilities");
  if (!host) return;
  try {
    const { items } = await api("/api/v1/integrations");
    const el = items.find((i) => i.id === "elevenlabs");
    host.innerHTML = el
      ? integrationCard(el)
      : '<p class="muted small">This deployment reports no ElevenLabs integration.</p>';
  } catch (e) {
    host.innerHTML = errorState(e.message, "stIntRetry");
    $("#stIntRetry")?.addEventListener("click", loadIntegrations);
  }
}

function diffTable(diff) {
  return `<div class="arag-datatable vb-set-diff">
    <div class="scroll">
      <table>
        <thead><tr><th>Field</th><th>This deployment</th><th>ElevenLabs</th><th></th></tr></thead>
        <tbody>${diff
          .map(
            (d) => `<tr data-matches="${d.matches}">
              <td><span class="cell-title">${esc(d.label)}</span></td>
              <td class="val">${esc(trim(d.local))}</td>
              <td class="val">${esc(trim(d.remote))}</td>
              <td>${d.matches ? chip("same", "ok") : chip("differs", "warn")}</td>
            </tr>`,
          )
          .join("")}</tbody>
      </table>
    </div>
  </div>`;
}

const trim = (v) => {
  const s = String(v ?? "");
  return s.length > 140 ? `${s.slice(0, 140)}…` : s || "—";
};

/** The desired configuration, as anyone may read it. */
function desiredPanel(cfg) {
  return `<dl class="arag-kv">
      <dt>Agent id</dt><dd>${
        cfg.ready
          ? `<span class="mono">${esc(cfg.agent_id)}</span>`
          : chip("not wired — set agent_id under Prospects", "warn")
      }</dd>
      <dt>Tool</dt><dd class="mono">${esc(cfg.tool.method)} ${esc(cfg.tool.url)}</dd>
      <dt>Tool timeout</dt><dd>${cfg.tool.timeoutMs} ms</dd>
      <dt>Voice</dt><dd class="mono">${esc(cfg.voice_id ?? "agent default")}</dd>
      <dt>Greeting</dt><dd>${esc(cfg.greeting)}</dd>
      <dt>X-API-Key header</dt><dd>${
        cfg.api_key
          ? `${esc(cfg.api_key.name)} <span class="mono muted">${esc(cfg.api_key.prefix)}…</span>`
          : '<span class="muted small">no key — the tool calls an open deployment</span>'
      }</dd>
    </dl>
    <p class="muted small" style="margin:14px 0 6px">Agent system prompt</p>
    ${snippet(cfg.system_prompt)}`;
}

async function loadAgent() {
  const host = $("#stAgent");
  if (!host) return;
  if (!state.current) {
    host.innerHTML = empty({
      icon: "prospects",
      title: "No prospect to wire an agent for",
      body: "A voice agent belongs to a prospect — its greeting, its handoff line and its Knowledge Box. Add one under Prospects first.",
      action: '<a class="arag-btn secondary sm" href="/prospects/">Open Prospects</a>',
    });
    return;
  }
  host.innerHTML = '<div class="arag-skeleton" style="height:140px"></div>';
  const intro = `<h3 style="margin:0 0 4px">Voice agent for ${esc(state.current.display_name)}</h3>
    <p class="muted small" style="margin:0 0 16px;max-width:68ch">The agent lives in ElevenLabs
      Conversational AI and calls this deployment as a custom server tool, so every spoken answer
      still comes from Progress Agentic RAG. This is the configuration the product wants, what
      ElevenLabs actually has, and the button that makes them the same.</p>`;

  if (!operator) {
    try {
      const cfg = await api(`/api/v1/voice-agent?prospect=${encodeURIComponent(state.current.key)}`);
      host.innerHTML = `${intro}
        <div class="arag-alert info" style="margin-bottom:16px">Reading and pushing the live agent is
          an operator action. Unlock the page above to compare this against ElevenLabs and push it.</div>
        ${desiredPanel(cfg)}`;
    } catch (e) {
      host.innerHTML = `${intro}<p class="muted small">The agent configuration could not be read: ${esc(e.message)}</p>`;
    }
    return;
  }

  try {
    const s = await api(`/api/v1/admin/voice-agent?prospect=${encodeURIComponent(state.current.key)}`);
    const configured = s.desired.configured;
    host.innerHTML = `${intro}
      ${
        configured
          ? ""
          : `<div class="arag-alert warn" style="margin-bottom:16px">ElevenLabs is not configured, so
              there is nothing to compare against. Set the <strong>API key</strong> in the form above
              and this panel will read the live agent.</div>`
      }
      <div class="arag-row" style="gap:8px;flex-wrap:wrap;margin-bottom:14px">
        ${
          !configured
            ? chip("not configured", "neutral")
            : !s.reachable
              ? chip("no agent in ElevenLabs yet", "warn")
              : s.in_sync
                ? chip("in sync with ElevenLabs", "ok")
                : chip(
                    plural(s.diff.filter((d) => !d.matches).length, "field differs", "fields differ"),
                    "warn",
                  )
        }
        ${s.remote?.agent?.error ? `<span class="muted small">${esc(s.remote.agent.error)}</span>` : ""}
      </div>
      ${desiredPanel(s.desired)}
      ${
        s.diff.length
          ? `<p class="muted small" style="margin:20px 0 8px">Field by field, against the live agent</p>
             ${diffTable(s.diff)}`
          : ""
      }
      <div class="vb-set-foot">
        <button class="arag-btn" id="stPush"${configured ? "" : " disabled"}>
          ${s.reachable ? "Push to ElevenLabs" : "Create and push the agent"}
        </button>
        <span class="muted small">Writes the prompt, greeting, voice and the tool — including the
          <code>X-API-Key</code> header — into ElevenLabs. Settings this product does not own
          (turn-taking, ASR, evaluation) are merged, never replaced.</span>
        <span class="spacer"></span>
        <span class="vb-set-status" id="stPushStatus" aria-live="polite"></span>
      </div>`;
    $("#stPush")?.addEventListener("click", pushAgent);
  } catch (e) {
    host.innerHTML = `${intro}${errorState(problemText(e), "stAgentRetry")}`;
    $("#stAgentRetry")?.addEventListener("click", loadAgent);
  }
}

async function pushAgent() {
  const btn = $("#stPush");
  const status = $("#stPushStatus");
  btn.disabled = true;
  status.className = "vb-set-status";
  status.textContent = "Pushing…";
  try {
    const r = await api("/api/v1/admin/voice-agent/push", {
      method: "POST",
      json: { prospect: state.current.key },
    });
    const made = [r.created_agent ? "agent created" : null, r.created_tool ? "tool created" : null].filter(
      Boolean,
    );
    toast(made.length ? `Pushed — ${made.join(", ")}` : "Pushed to ElevenLabs", "ok");
    await loadAgent();
    const fresh = $("#stPushStatus");
    if (fresh) {
      fresh.className = "vb-set-status ok";
      fresh.textContent = `Applied ${r.applied.length} field${r.applied.length === 1 ? "" : "s"}`;
    }
  } catch (e) {
    btn.disabled = false;
    status.className = "vb-set-status bad";
    status.textContent = problemText(e);
  }
}

// ── API keys ─────────────────────────────────────────────────────────────────

function keyRow(k) {
  return `<tr data-key="${esc(k.id)}"${k.revoked ? ' class="muted"' : ""}>
    <td><span class="cell-title">${esc(k.name)}</span></td>
    <td class="mono">${esc(k.prefix)}…</td>
    <td>${k.origin === "env" ? chip("environment", "neutral") : chip("minted here", "info")}</td>
    <td>${ago(k.createdAt)}</td>
    <td>${k.lastUsedAt ? ago(k.lastUsedAt) : '<span class="muted small">never</span>'}</td>
    <td class="num">${k.uses}</td>
    <td>${k.revoked ? chip("revoked", "danger") : chip("active", "ok")}</td>
    <td class="num">${
      k.revoked
        ? ""
        : `<button class="arag-btn ghost sm" data-rename="${esc(k.id)}">Rename</button>
           <button class="arag-btn ghost sm" data-revoke="${esc(k.id)}">Revoke</button>`
    }</td>
  </tr>`;
}

async function loadKeys() {
  const host = $("#stKeys");
  if (!host) return;
  if (!operator) {
    host.innerHTML = `<p class="arag-help">Operator-only. Unlock this page to see which keys exist,
      mint one, or revoke one.</p>`;
    return;
  }
  try {
    keys = await api("/api/v1/admin/api-keys");
  } catch (e) {
    host.innerHTML = errorState(problemText(e), "stKeysRetry");
    $("#stKeysRetry")?.addEventListener("click", loadKeys);
    return;
  }
  host.innerHTML = `
    <p class="muted small" style="margin:0 0 16px;max-width:68ch"><code>API_KEYS</code> seeds this
      store on first boot and then stops being the authority: a key created or revoked here bites on
      the next request, with no restart. A revoked key stays in the list so its audit trail survives.</p>
    <div id="stOnce"></div>
    ${
      keys.open
        ? `<div class="arag-alert warn" style="margin-bottom:16px"><strong>The public API is open.</strong>
            With no active key, anyone who can reach this deployment can call every non-operator
            endpoint — including the voice turn. Mint a key below and the API starts requiring one;
            this workspace keeps working on its own session.</div>`
        : `<div class="arag-alert" style="margin-bottom:16px">${keys.active} active key${
            keys.active === 1 ? "" : "s"
          }. The API requires one of them on every non-operator call.</div>`
    }
    <div class="arag-row" style="gap:10px;align-items:flex-end;margin-bottom:18px;flex-wrap:wrap">
      <div class="arag-field" style="flex:1;min-width:220px">
        <label class="arag-label" for="stKeyName">Name a new key</label>
        <input class="arag-input" id="stKeyName" placeholder="Acme telephony bridge" autocomplete="off" />
        <span class="arag-help">Name it after the caller, not the person — that is what a revocation
          decision needs later.</span>
      </div>
      <button class="arag-btn" id="stKeyCreate">${icon("plus", 14)} Create key</button>
    </div>
    <div class="arag-datatable">
      <div class="scroll">
        <table id="stKeyTable">
          <thead><tr>
            <th>Name</th><th>Prefix</th><th>Origin</th><th>Created</th><th>Last used</th>
            <th class="num">Uses</th><th>Status</th><th></th>
          </tr></thead>
          <tbody>${
            keys.items.length
              ? keys.items.map(keyRow).join("")
              : `<tr><td colspan="8">${empty({
                  icon: "key",
                  title: "No keys yet",
                  body: "The public API is open until this deployment has one.",
                })}</td></tr>`
          }</tbody>
        </table>
      </div>
    </div>`;
  $("#stKeyCreate").addEventListener("click", createKey);
  $("#stKeyName").addEventListener("keydown", (e) => e.key === "Enter" && createKey());
}

async function createKey() {
  const input = $("#stKeyName");
  const name = input.value.trim();
  if (!name) {
    toast("Give the key a name first", "error");
    input.focus();
    return;
  }
  const btn = $("#stKeyCreate");
  btn.disabled = true;
  try {
    const created = await api("/api/v1/admin/api-keys", { method: "POST", json: { name } });
    await loadKeys();
    showOnce(created);
  } catch (e) {
    toast(problemText(e), "error");
  } finally {
    const again = $("#stKeyCreate");
    if (again) again.disabled = false;
  }
}

/**
 * The secret, shown exactly once. The API will never return it again, so this panel is loud, it
 * carries a copy control, and it says so in as many words. It is also the only place on this page
 * where a secret reaches the DOM at all.
 */
function showOnce(created) {
  const host = $("#stOnce");
  if (!host) return;
  host.innerHTML = `<div class="vb-set-once" id="stOncePanel" role="alert" tabindex="-1">
    <h3>${esc(created.key.name)} — copy this key now</h3>
    <p>This is the only time it will ever be shown. Close this panel and the secret is gone: the
      store keeps it for authentication, but the API will not return it again. If you lose it,
      revoke the key and mint another.</p>
    ${snippet(created.secret)}
    <div class="arag-row" style="margin-top:12px">
      <button class="arag-btn secondary sm" id="stOnceDone">I have copied it</button>
    </div>
  </div>`;
  $("#stOncePanel").focus();
  $("#stOnceDone").addEventListener("click", () => {
    host.innerHTML = "";
  });
}

function renameKey(id) {
  const k = keys.items.find((x) => x.id === id);
  if (!k) return;
  const close = openDrawer({
    title: "Rename the key",
    sub: `<span class="mono">${esc(k.prefix)}…</span>`,
    body: `<div class="arag-field">
        <label for="stRenameName">Name</label>
        <input class="arag-input" id="stRenameName" value="${esc(k.name)}" autocomplete="off" />
        <span class="arag-help">Only the name changes — the secret, its history and its uses are untouched.</span>
      </div>
      <p class="arag-alert error" id="stRenameError" hidden style="margin-top:12px"></p>
      <div class="arag-row" style="margin-top:14px">
        <button class="arag-btn" id="stRenameSave">Save</button>
      </div>`,
  });
  $("#stRenameSave").addEventListener("click", async () => {
    try {
      await api(`/api/v1/admin/api-keys/${encodeURIComponent(id)}`, {
        method: "PATCH",
        json: { name: $("#stRenameName").value.trim() },
      });
      close();
      await loadKeys();
    } catch (e) {
      const err = $("#stRenameError");
      err.hidden = false;
      err.textContent = problemText(e);
    }
  });
}

async function revokeKey(id) {
  const k = keys.items.find((x) => x.id === id);
  if (!k) return;
  const last = keys.active === 1 && !k.revoked;
  const yes = await confirmDialog({
    title: "Revoke this key?",
    body: `<p>Every caller using <strong>${esc(k.name)}</strong> (<code>${esc(
      k.prefix,
    )}…</code>) is refused from the next request onwards. It cannot be un-revoked — mint a new key
      instead. The record stays in the list so the audit trail survives.</p>${
        last
          ? `<p class="arag-alert warn">This is the only active key. Revoking it reopens the public
              API to anyone who can reach this deployment.</p>`
          : ""
      }`,
    confirmLabel: "Revoke the key",
    typed: "revoke",
  });
  if (!yes) return;
  try {
    await api(`/api/v1/admin/api-keys/${encodeURIComponent(id)}`, { method: "DELETE" });
    await loadKeys();
    toast("Key revoked", "info");
  } catch (e) {
    toast(problemText(e), "error");
  }
}

// ── purge ────────────────────────────────────────────────────────────────────

function paintPurge() {
  const host = $("#stPurge");
  if (!host) return;
  if (!operator) {
    host.innerHTML = "";
    return;
  }
  host.innerHTML = `
    <h3 style="margin:0 0 4px">Purge now</h3>
    <p class="muted small" style="margin:0 0 14px;max-width:68ch">Applying the windows deletes only
      what is older than them. Every other scope deletes records <strong>regardless of age</strong>
      and cannot be undone.</p>
    <div class="arag-row" style="gap:10px;align-items:flex-end;flex-wrap:wrap">
      <div class="arag-field" style="flex:1;min-width:240px">
        <label class="arag-label" for="stPurgeScope">What to purge</label>
        <select class="arag-select" id="stPurgeScope">
          ${PURGE_SCOPES.map((s) => `<option value="${esc(s.id)}">${esc(s.label)}</option>`).join("")}
        </select>
      </div>
      <button class="arag-btn danger" id="stPurgeRun">Purge</button>
    </div>
    <div id="stPurgeResult" style="margin-top:14px"></div>`;
  $("#stPurgeRun").addEventListener("click", runPurge);
}

async function runPurge() {
  const scope = $("#stPurgeScope").value;
  const meta = PURGE_SCOPES.find((s) => s.id === scope);
  const yes =
    scope === "retention"
      ? await confirmAction({
          title: "Apply the retention windows?",
          body: `Deletes ${meta.what}. Anything inside a window, and anything whose window is 0, is kept.`,
          confirmLabel: "Apply the windows",
          danger: false,
        })
      : await confirmDialog({
          title: `Delete ${meta.label.toLowerCase()}?`,
          body: `<p>This deletes <strong>${esc(meta.what)}</strong>. It ignores the retention windows
            entirely, it cannot be undone, and it is recorded in the operator log.</p>`,
          confirmLabel: "Purge",
          typed: scope,
        });
  if (!yes) return;
  const host = $("#stPurgeResult");
  host.innerHTML = '<div class="arag-skeleton" style="height:40px"></div>';
  try {
    const r = await api("/api/v1/admin/purge", { method: "POST", json: { scope } });
    host.innerHTML = `<div class="arag-alert ok">Purged ${r.turns} turn${r.turns === 1 ? "" : "s"},
      ${r.sessions} conversation${r.sessions === 1 ? "" : "s"} and ${r.evals} golden
      run${r.evals === 1 ? "" : "s"}.</div>`;
  } catch (e) {
    host.innerHTML = `<div class="arag-alert error">${esc(problemText(e))}</div>`;
  }
}

// ── section index ────────────────────────────────────────────────────────────

/** Mark the section the reader is in, and honour a #hash arriving after the async render. */
function wireIndex() {
  const links = new Map($$("[data-jump]").map((a) => [a.dataset.jump, a]));
  const mark = (id) => {
    for (const [key, a] of links) {
      if (key === id) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    }
  };
  /**
   * Which section is the reader in? Decided from geometry, not from whichever entry the observer
   * happened to report: a section taller than the viewport stops producing entries while you are
   * still inside it, which left the index pointing at the section above.
   */
  const pick = () => {
    const line = 140; // just below the sticky index
    let current = SECTIONS[0].id;
    for (const el of $$(".vb-set-section")) {
      if (el.getBoundingClientRect().top <= line) current = el.id;
    }
    mark(current);
  };
  let queued = false;
  const onScroll = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      pick();
    });
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll, { passive: true });
  mark(location.hash.slice(1) || SECTIONS[0].id);
  window.addEventListener("hashchange", () => {
    mark(location.hash.slice(1));
    scrollToHash();
  });
  scrollToHash();
  // After the jump, geometry is the authority again.
  requestAnimationFrame(pick);
}

function scrollToHash() {
  const id = location.hash.slice(1);
  if (!id) return;
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ block: "start", behavior: "auto" });
}

// ── boot ─────────────────────────────────────────────────────────────────────

async function render() {
  host.innerHTML = chrome();
  for (const s of SECTIONS) {
    if (s.group) wireGroup($(`[data-group-host="${s.group}"]`));
  }
  paintPreview();
  paintLogo();
  paintPurge();
  wireIndex();
  await Promise.all([loadHealth(), loadIntegrations(), loadKeys(), loadAgent()]);
}

const host = mountShell({
  section: "settings",
  title: "Settings",
  description:
    "Everything this deployment reads from configuration, editable here. The store overrides the " +
    "environment and a change takes effect immediately — no restart, no redeploy.",
  actions: `<a class="arag-btn ghost sm" href="/admin/">${icon("operator", 14)} Operator views</a>`,
});

await boot();
operator = await isOperator();
if (operator) {
  await loadSettings().catch((e) => toast(problemText(e), "error"));
}
await render();
prospectSwitcher(() => loadAgent());

// The sign-in banner, the key table and the section index all live inside re-rendered regions, so
// their handlers are delegated from the page root rather than re-bound on every repaint.
document.addEventListener("click", async (e) => {
  const unlock = e.target.closest("#stUnlock");
  if (unlock) {
    const err = $("#stSignInError");
    err.hidden = true;
    try {
      await signInOperator($("#stToken").value);
      operator = true;
      await loadSettings();
      await render();
    } catch (err2) {
      err.hidden = false;
      err.textContent = err2.status === 401 ? "That token was not accepted." : err2.message;
    }
    return;
  }
  const rename = e.target.closest("[data-rename]");
  if (rename) return renameKey(rename.dataset.rename);
  const revoke = e.target.closest("[data-revoke]");
  if (revoke) return revokeKey(revoke.dataset.revoke);
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.id === "stToken") $("#stUnlock")?.click();
});
