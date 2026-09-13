// The in-product API explorer.
//
// Every `/api/v1` operation in the OpenAPI document gets a screen entry here: its description, its
// parameters, a try-it form that calls the live endpoint, the request and response as they really
// were, and a copyable curl. Nothing is hand-listed — the page is built from
// `/api/v1/openapi.json`, so an operation cannot be added to the API and forgotten here.
//
// Auth: a try-it call goes out with the viewer's own session cookie by default (the shell opens
// one at boot), or with an API key the viewer pastes, or with the operator cookie for `/admin`
// routes. The explorer never holds a key beyond the page.
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
  snippet,
  state,
  toast,
} from "./shell.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const METHOD_ORDER = ["get", "post", "put", "patch", "delete"];
/** Methods that change or destroy something — the explorer asks before firing one. */
const DESTRUCTIVE = new Set(["delete"]);

let spec = null;
/** Flattened operations, in document order. */
let ops = [];
let current = null;
/** The API key the viewer pasted, kept in the page only. */
let apiKey = "";

// ── reading the document ─────────────────────────────────────────────────────

function flatten(doc) {
  const out = [];
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    const shared = item.parameters ?? [];
    for (const method of METHOD_ORDER) {
      const op = item[method];
      if (!op) continue;
      out.push({
        id: op.operationId ?? `${method}${path}`,
        method,
        path,
        summary: op.summary ?? "",
        description: op.description ?? "",
        tag: (op.tags ?? ["other"])[0],
        parameters: [...shared, ...(op.parameters ?? [])],
        requestBody: op.requestBody,
        responses: op.responses ?? {},
        security: op.security ?? doc.security ?? [],
      });
    }
  }
  return out;
}

/** Resolve a local `$ref` against the document. */
function deref(schema, seen = 0) {
  if (!schema || typeof schema !== "object" || seen > 8) return schema ?? {};
  if (schema.$ref) {
    const name = String(schema.$ref).split("/").pop();
    return deref(spec.components?.schemas?.[name] ?? {}, seen + 1);
  }
  return schema;
}

/**
 * A request body to start from, built from the schema. Required fields first, examples and
 * defaults honoured — a form the viewer edits beats an empty textarea they have to invent.
 */
function exampleFor(schema, depth = 0) {
  const s = deref(schema);
  if (!s || depth > 5) return null;
  if (s.example !== undefined) return s.example;
  if (s.default !== undefined) return s.default;
  if (Array.isArray(s.enum) && s.enum.length) return s.enum[0];
  const type = Array.isArray(s.type) ? s.type.find((t) => t !== "null") : s.type;
  if (type === "object" || s.properties) {
    const out = {};
    const required = new Set(s.required ?? []);
    for (const [key, value] of Object.entries(s.properties ?? {})) {
      // Keep the example small: required fields always, optional ones only near the top level.
      if (!required.has(key) && depth > 0) continue;
      out[key] = exampleFor(value, depth + 1);
    }
    return out;
  }
  if (type === "array") return [exampleFor(s.items, depth + 1)].filter((v) => v !== null);
  if (type === "integer" || type === "number") return s.minimum ?? 0;
  if (type === "boolean") return false;
  if (s.format === "date-time") return new Date().toISOString();
  return "";
}

function authLabel(op) {
  const names = op.security.flatMap((s) => Object.keys(s));
  if (names.includes("AdminToken")) return { label: "operator", kind: "warn" };
  if (names.length) return { label: "api key or session", kind: "info" };
  return { label: "open", kind: "neutral" };
}

// ── rendering ────────────────────────────────────────────────────────────────

function opRow(op) {
  const a = authLabel(op);
  return `<button type="button" class="vb-op" data-op="${esc(op.id)}"${
    current?.id === op.id ? ' aria-current="true"' : ""
  }>
    <span class="vb-method ${esc(op.method)}">${esc(op.method.toUpperCase())}</span>
    <span class="vb-op-body">
      <code class="vb-op-path">${esc(op.path)}</code>
      <span class="vb-op-summary">${esc(op.summary)}</span>
    </span>
    ${chip(a.label, a.kind)}
  </button>`;
}

function renderList(filter = "") {
  const q = filter.trim().toLowerCase();
  const matching = ops.filter(
    (op) =>
      !q ||
      op.path.toLowerCase().includes(q) ||
      op.summary.toLowerCase().includes(q) ||
      op.id.toLowerCase().includes(q) ||
      op.method.includes(q) ||
      op.tag.toLowerCase().includes(q),
  );
  const host = $("#apiList");
  if (matching.length === 0) {
    host.innerHTML = empty({ icon: "search", title: "No operation matches", body: filter });
    $("#apiCount").textContent = `0 of ${ops.length}`;
    return;
  }
  const byTag = new Map();
  for (const op of matching) {
    if (!byTag.has(op.tag)) byTag.set(op.tag, []);
    byTag.get(op.tag).push(op);
  }
  const tagDesc = Object.fromEntries((spec.tags ?? []).map((t) => [t.name, t.description ?? ""]));
  host.innerHTML = [...byTag.entries()]
    .map(
      ([tag, list]) => `<section class="vb-op-group">
        <h3>${esc(tag)} <span class="muted small">${list.length}</span></h3>
        ${tagDesc[tag] ? `<p class="muted small">${esc(tagDesc[tag])}</p>` : ""}
        ${list.map(opRow).join("")}
      </section>`,
    )
    .join("");
  $("#apiCount").textContent =
    matching.length === ops.length ? `${ops.length} operations` : `${matching.length} of ${ops.length}`;
}

function paramField(p) {
  const s = deref(p.schema ?? {});
  const id = `pf-${p.in}-${p.name}`;
  const opts = Array.isArray(s.enum)
    ? `<select class="arag-select" id="${esc(id)}" data-param="${esc(p.name)}" data-in="${esc(p.in)}">
         ${p.required ? "" : '<option value=""></option>'}
         ${s.enum.map((v) => `<option>${esc(String(v))}</option>`).join("")}
       </select>`
    : `<input class="arag-input" id="${esc(id)}" data-param="${esc(p.name)}" data-in="${esc(p.in)}"
         type="${s.type === "integer" || s.type === "number" ? "number" : "text"}"
         placeholder="${esc(s.pattern ? String(s.pattern) : (s.format ?? s.type ?? ""))}"
         value="${esc(defaultParam(p, s))}" />`;
  return `<div class="arag-field">
    <label class="arag-label" for="${esc(id)}">${esc(p.name)}
      ${p.required ? '<span class="vb-req" title="required">*</span>' : ""}
      <span class="vb-param-in">in ${esc(p.in)}</span>
    </label>
    ${opts}
    ${p.description ? `<p class="arag-help">${esc(p.description)}</p>` : ""}
  </div>`;
}

/**
 * Fill in what the viewer would otherwise have to look up. The selected prospect is the one thing
 * every body here needs and nobody should have to type; a question is seeded so "Send" on the
 * voice turn works on the first click.
 */
function prefill(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  if ("prospect" in body && !body.prospect && state.current) body.prospect = state.current.key;
  if ("question" in body && !body.question) body.question = "What is binder jetting?";
  if ("text" in body && !body.text) body.text = "We print metal parts and are looking at binder jetting.";
  if ("name" in body && !body.name) body.name = "My integration";
  return body;
}

/** Prefill what we can: the selected prospect, sensible defaults from the schema. */
function defaultParam(p, s) {
  if (p.name === "prospect" && state.current) return state.current.key;
  if (s.default !== undefined) return String(s.default);
  return "";
}

function renderDetail(op) {
  current = op;
  const a = authLabel(op);
  const bodySchema = op.requestBody?.content?.["application/json"]?.schema;
  const multipart = op.requestBody?.content?.["multipart/form-data"];
  const example = bodySchema ? prefill(exampleFor(bodySchema)) : null;
  const params = op.parameters.filter((p) => p.in === "path" || p.in === "query");
  const responses = Object.entries(op.responses).map(
    ([code, r]) => `<tr><td><code>${esc(code)}</code></td><td>${esc(r.description ?? "")}</td></tr>`,
  );

  $("#apiDetail").innerHTML = `
    <header class="vb-op-head">
      <div class="arag-row" style="gap:10px;align-items:center;flex-wrap:wrap">
        <span class="vb-method ${esc(op.method)}">${esc(op.method.toUpperCase())}</span>
        <code class="vb-op-path lg">${esc(op.path)}</code>
        ${chip(a.label, a.kind)}
      </div>
      <h2>${esc(op.summary || op.id)}</h2>
      ${op.description ? `<p class="muted">${esc(op.description)}</p>` : ""}
      <p class="muted small"><code>operationId: ${esc(op.id)}</code></p>
    </header>

    <form id="apiForm" class="arag-card pad" novalidate>
      <h3>Try it</h3>
      ${
        params.length
          ? `<div class="arag-grid cols-2">${params.map(paramField).join("")}</div>`
          : '<p class="muted small">No parameters.</p>'
      }
      ${
        bodySchema
          ? `<div class="arag-field" style="margin-top:12px">
              <label class="arag-label" for="apiBody">Request body <span class="muted small">application/json</span></label>
              <textarea class="arag-input mono" id="apiBody" rows="10" spellcheck="false">${esc(
                JSON.stringify(example, null, 2),
              )}</textarea>
              <p class="arag-help">Prefilled from the schema. Edit it before sending.</p>
            </div>`
          : ""
      }
      ${
        multipart
          ? `<div class="arag-field" style="margin-top:12px">
              <label class="arag-label" for="apiFile">File <span class="muted small">multipart/form-data</span></label>
              <input class="arag-input" type="file" id="apiFile" />
            </div>`
          : ""
      }
      <div class="arag-row" style="margin-top:14px;gap:10px;align-items:center;flex-wrap:wrap">
        <button class="arag-btn" type="submit" id="apiSend">${icon("play", 14)} Send</button>
        <span class="muted small" id="apiAuthNote"></span>
      </div>
    </form>

    <div id="apiResult" class="vb-result" hidden></div>

    <section class="arag-card" style="margin-top:18px">
      <div class="head"><h2>curl</h2></div>
      <div class="body" id="apiCurl"></div>
    </section>

    <section class="arag-card" style="margin-top:18px">
      <div class="head"><h2>Responses</h2></div>
      <div class="body">
        <div class="arag-datatable"><div class="scroll"><table>
          <thead><tr><th>Status</th><th>Meaning</th></tr></thead>
          <tbody>${responses.join("")}</tbody>
        </table></div></div>
      </div>
    </section>`;

  $("#apiAuthNote").textContent =
    a.label === "operator"
      ? "Sent with your operator cookie. Sign in under Operator if this returns 401."
      : a.label === "open"
        ? "No authentication required."
        : "Sent with this browser's session, or the API key above.";

  $("#apiForm").addEventListener("submit", (e) => {
    e.preventDefault();
    send(op);
  });
  for (const el of $$("#apiForm input, #apiForm select, #apiForm textarea")) {
    el.addEventListener("input", () => updateCurl(op));
  }
  updateCurl(op);
  for (const b of $$("[data-op]")) b.setAttribute("aria-current", b.dataset.op === op.id ? "true" : "false");
  location.hash = `#${op.id}`;
}

// ── building and sending the request ─────────────────────────────────────────

function collect(op) {
  let path = op.path;
  const query = new URLSearchParams();
  let missing = null;
  for (const el of $$("#apiForm [data-param]")) {
    const name = el.dataset.param;
    const value = el.value.trim();
    const param = op.parameters.find((p) => p.name === name && p.in === el.dataset.in);
    if (!value) {
      if (param?.required) missing = name;
      continue;
    }
    if (el.dataset.in === "path") path = path.replace(`{${name}}`, encodeURIComponent(value));
    else query.set(name, value);
  }
  const qs = query.toString();
  const bodyEl = $("#apiBody");
  let body;
  let bodyError = null;
  if (bodyEl) {
    const raw = bodyEl.value.trim();
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch (err) {
        bodyError = err.message;
      }
    }
  }
  return { url: `${path}${qs ? `?${qs}` : ""}`, body, missing, bodyError, file: $("#apiFile")?.files?.[0] };
}

function updateCurl(op) {
  const { url, body, file } = collect(op);
  const lines = [`curl -X ${op.method.toUpperCase()} '${location.origin}${url}'`];
  const auth = authLabel(op);
  if (auth.label === "operator") lines.push(`  -H 'Authorization: Bearer $ADMIN_TOKEN'`);
  else if (auth.label !== "open") lines.push(`  -H 'X-API-Key: ${apiKey || "$API_KEY"}'`);
  if (file) lines.push(`  -F 'file=@${file.name}'`);
  else if (body !== undefined) {
    lines.push(`  -H 'Content-Type: application/json'`);
    lines.push(`  -d '${JSON.stringify(body)}'`);
  }
  $("#apiCurl").innerHTML = snippet(lines.join(" \\\n"));
}

async function send(op) {
  const { url, body, missing, bodyError, file } = collect(op);
  if (missing) return toast(`"${missing}" is required`, "error");
  if (bodyError) return toast(`The request body is not valid JSON: ${bodyError}`, "error");
  if (DESTRUCTIVE.has(op.method)) {
    const ok = await confirmAction({
      title: "Send a destructive request?",
      body: `${op.method.toUpperCase()} ${url} runs against this live deployment and cannot be undone.`,
      confirmLabel: "Send it",
    });
    if (!ok) return;
  }

  const host = $("#apiResult");
  host.hidden = false;
  host.innerHTML = '<div class="arag-skeleton" style="height:80px"></div>';
  const headers = {};
  if (apiKey) headers["X-API-Key"] = apiKey;
  const init = { method: op.method.toUpperCase(), headers, credentials: "same-origin" };
  if (file) {
    const form = new FormData();
    form.append("file", file);
    init.body = form;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  const started = performance.now();
  let res;
  let text = "";
  try {
    res = await fetch(url, init);
    text = await res.text();
  } catch (err) {
    host.innerHTML = errorState(err.message);
    return;
  }
  const ms = Math.round(performance.now() - started);
  const type = res.headers.get("content-type") ?? "";
  let rendered;
  if (type.includes("json")) {
    try {
      rendered = JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      rendered = text;
    }
  } else if (type.startsWith("audio/")) {
    rendered = `(${text.length} bytes of ${type} — audio is not rendered here)`;
  } else {
    rendered = text.slice(0, 20000);
  }
  const kind = res.ok ? "ok" : res.status < 500 ? "warn" : "danger";
  host.innerHTML = `
    <div class="vb-result-head">
      <span class="arag-chip ${kind}">${res.status} ${esc(res.statusText)}</span>
      <span class="muted small">${ms} ms · ${esc(type || "no content type")}</span>
      <span class="spacer"></span>
      <span class="muted small">${esc(op.method.toUpperCase())} ${esc(url)}</span>
    </div>
    <div id="apiResponseBody"></div>`;
  $("#apiResponseBody").innerHTML = snippet(rendered || "(empty body)");
  // A key the viewer just created is the one thing here worth offering to keep.
  if (op.id === "adminCreateApiKey" && res.ok) {
    try {
      const secret = JSON.parse(text).secret;
      if (secret) {
        apiKey = secret;
        $("#apiKeyInput").value = secret;
        toast("The new key is now used for try-it calls on this page", "ok");
      }
    } catch {
      /* not a key response after all */
    }
  }
}

// ── page ─────────────────────────────────────────────────────────────────────

const host = mountShell({
  section: "api",
  title: "API",
  description: "Every operation this deployment exposes, with a try-it form that calls the live endpoint.",
  actions: `<a class="arag-btn ghost sm" href="/api/v1/docs">${icon("source", 14)} Reference</a>
    <a class="arag-btn ghost sm" href="/api/v1/openapi.json">OpenAPI</a>`,
});

await boot();
host.innerHTML = `
  <div class="arag-split rail-left vb-api">
    <aside class="vb-api-side">
      <div class="arag-filterbar">
        <label class="arag-search">
          ${icon("search", 15)}
          <input id="apiSearch" type="search" placeholder="Search operations" aria-label="Search operations" />
        </label>
        <span class="count" id="apiCount"></span>
      </div>
      <div class="arag-field" style="margin:10px 0 14px">
        <label class="arag-label" for="apiKeyInput">API key for try-it (optional)</label>
        <input class="arag-input mono" id="apiKeyInput" type="password" placeholder="vbk_…"
          autocomplete="off" />
        <p class="arag-help">Kept in this page only. Without one, calls use your browser session.</p>
      </div>
      <div id="apiList"></div>
    </aside>
    <div class="vb-api-main" id="apiDetail"></div>
  </div>`;

try {
  spec = await api("/api/v1/openapi.json");
  ops = flatten(spec);
  renderList();
  const fromHash = ops.find((o) => o.id === location.hash.slice(1));
  renderDetail(fromHash ?? ops[0]);
  if (!(await isOperator())) {
    $("#apiDetail").insertAdjacentHTML(
      "afterbegin",
      `<div class="arag-alert info" style="margin-bottom:16px">Operator operations will return 401 until you
        <a href="/admin/">sign in as an operator</a>. Everything else is ready to try.</div>`,
    );
  }
} catch (err) {
  host.innerHTML = errorState(`The OpenAPI document could not be read: ${err.message}`);
}

$("#apiSearch")?.addEventListener("input", (e) => renderList(e.target.value));
$("#apiKeyInput")?.addEventListener("input", (e) => {
  apiKey = e.target.value.trim();
  if (current) updateCurl(current);
});
$("#apiList")?.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-op]");
  if (!btn) return;
  const op = ops.find((o) => o.id === btn.dataset.op);
  if (op) renderDetail(op);
});
window.addEventListener("hashchange", () => {
  const op = ops.find((o) => o.id === location.hash.slice(1));
  if (op && op.id !== current?.id) renderDetail(op);
});
