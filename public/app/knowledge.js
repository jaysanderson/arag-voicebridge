// Knowledge — what this prospect is grounded in, whether it is answering well enough to be
// trusted, and a tester for asking it something directly.
//
// The old "Ask" tab lives here as a tool: a text question is the same nine-step pipeline a voice
// turn runs, so it belongs next to the knowledge it is drawing on, not as a destination of its own.
import { sse } from "/ui/arag-ui.js";
import {
  ago,
  api,
  boot,
  chip,
  citeChip,
  empty,
  errorState,
  esc,
  fmtMs,
  icon,
  mountShell,
  openDrawer,
  prospectSwitcher,
  skeletonRows,
  stat,
  state,
  toast,
} from "./shell.js";

let host;
let knowledge = null;
let goldenClose = null;

const $ = (s) => document.querySelector(s);

function chrome() {
  return `
    <div class="vb-grid" style="margin-bottom:20px">
      <div id="kbCard"><div class="vb-skeleton" style="height:150px"></div></div>
    </div>
    <div class="vb-split">
      <section class="vb-card">
        <header>
          <h2>Golden set</h2>
          <span class="spacer"></span>
          <span id="kbGoldenChip" class="arag-chip neutral">not run</span>
          <button class="arag-btn sm" id="kbRunGolden">Run golden set</button>
        </header>
        <div class="vb-card-body">
          <p class="muted small">The gate before a prospect is trusted to answer: every question runs
            through the same pipeline a live turn uses. Answerable questions must answer, cite a
            source and stay inside three spoken sentences; out-of-scope questions must hand off.</p>
          <div id="kbGoldenRun"></div>
          <div class="vb-table-wrap" style="margin-top:14px">
            <div class="vb-scroll">
              <table class="vb-table" id="kbGoldenTable">
                <thead><tr><th>Question</th><th>Expected</th><th>Result</th><th class="num">ms</th></tr></thead>
                <tbody><tr><td colspan="4">${empty({
                  icon: "check",
                  title: "Nothing has run in this session",
                  body: "Run the golden set to see each question, what it was expected to do, and what it did.",
                })}</td></tr></tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      <div class="vb-grid">
        <section class="vb-card">
          <header><h2>Ask it something</h2><span class="spacer"></span>${chip("same pipeline as a call", "info")}</header>
          <div class="vb-card-body">
            <div class="arag-row" style="flex-wrap:nowrap">
              <input id="kbQuestion" class="arag-input" placeholder="Ask something the Knowledge Box can answer…" style="min-width:0" />
              <button id="kbAsk" class="arag-btn" style="flex:none">Ask</button>
            </div>
            <div class="vb-chip-row" id="kbSuggestions" style="margin-top:10px"></div>
            <div id="kbAnswers" class="arag-chat" style="margin-top:12px;min-height:120px;max-height:44vh;overflow-y:auto">${empty(
              {
                icon: "knowledge",
                title: "Ask the Knowledge Box a question",
                body: "A typed question runs the same pipeline a spoken turn does — the same retrieval, the same handoff rule, the same citations.",
              },
            )}</div>
          </div>
        </section>

        <section class="vb-card">
          <header><h2>Run history</h2><span class="spacer"></span>
            <button class="arag-btn ghost sm" id="kbReloadRuns">${icon("refresh", 14)}</button></header>
          <div class="vb-card-body" style="padding:0">
            <div class="vb-scroll">
              <table class="vb-table" id="kbRuns">
                <thead><tr><th>When</th><th>Result</th><th class="num">p50</th><th class="num">p95</th></tr></thead>
                <tbody>${skeletonRows(3, 4)}</tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    </div>`;
}

function kbCard(k) {
  const ok = k.kb.ok;
  return `<section class="vb-card">
    <header>
      <h2>Knowledge Box</h2>
      <span class="spacer"></span>
      ${
        ok
          ? `<span class="arag-chip ok">connected${k.kb.ms ? ` · ${fmtMs(k.kb.ms)}` : ""}</span>`
          : `<span class="arag-chip danger">unreachable</span>`
      }
      ${k.kb.mock ? chip("sample content", "warn") : ""}
    </header>
    <div class="vb-card-body">
      ${
        ok
          ? ""
          : `<div class="arag-alert error" style="margin-bottom:14px">${esc(k.kb.error ?? "The Knowledge Box did not answer.")} Check the connection under Settings.</div>`
      }
      <dl class="vb-kv">
        <dt>Answers for</dt><dd>${esc(k.display_name)}</dd>
        <dt>Knowledge Box</dt><dd class="vb-mono">${esc(k.kb.id_masked ?? "—")}${k.kb.title ? ` · ${esc(k.kb.title)}` : ""}</dd>
        <dt>Region</dt><dd class="vb-mono">${esc(k.kb.region)}</dd>
        <dt>Resources</dt><dd>${k.kb.resources ?? "—"}</dd>
        <dt>Answer model</dt><dd>${esc(k.kb.generative_model ?? "Knowledge Box default")}</dd>
        <dt>Brief model</dt><dd>${esc(k.kb.brief_model ?? "fast default")}</dd>
        <dt>Reranker</dt><dd>${esc(k.kb.reranker ?? "noop")}</dd>
        <dt>Stored search config</dt><dd>${k.kb.ask_config ? `<span class="vb-mono">${esc(k.kb.ask_config)}</span>` : "inline (not provisioned)"}</dd>
      </dl>
      <p class="muted small" style="margin:14px 0 0">The Knowledge Box itself is managed in Progress
        Agentic RAG. This deployment only reads from it — it never writes, and never answers from
        anything else.</p>
    </div>
  </section>`;
}

function renderGoldenState(k) {
  const e = k.last_eval;
  const el = $("#kbGoldenChip");
  if (!e) {
    el.className = "arag-chip neutral";
    el.textContent = "not run";
    return;
  }
  el.className = `arag-chip ${e.ok ? "ok" : "danger"}`;
  el.textContent = e.ok ? "gate open" : "gate closed";
}

function suggestions(k) {
  const answerable = (k.golden_questions ?? []).filter((q) => q.expect === "answer").slice(0, 4);
  const off = (k.golden_questions ?? []).find((q) => q.expect === "handoff");
  const all = [...answerable, ...(off ? [off] : [])];
  $("#kbSuggestions").innerHTML = all
    .map(
      (q) =>
        `<button type="button" class="arag-btn ghost sm vb-suggestion" data-q="${esc(q.q)}">${esc(q.q)}${
          q.expect === "handoff"
            ? ' <span class="arag-chip warn" style="margin-left:6px">should hand off</span>'
            : ""
        }</button>`,
    )
    .join("");
  if (all[0]) $("#kbQuestion").value = all[0].q;
  for (const b of $("#kbSuggestions").querySelectorAll("button")) {
    b.addEventListener("click", () => {
      $("#kbQuestion").value = b.dataset.q;
      ask();
    });
  }
}

async function ask() {
  const q = $("#kbQuestion").value.trim();
  if (!q || !state.current) return;
  $("#kbAsk").disabled = true;
  const box = $("#kbAnswers");
  if (box.querySelector(".vb-empty")) box.innerHTML = "";
  box.insertAdjacentHTML(
    "beforeend",
    `<div class="arag-bubble user">${esc(q)}</div><div class="arag-bubble assistant" id="kbPending">Thinking…</div>`,
  );
  box.scrollTop = box.scrollHeight;
  try {
    const r = await api("/api/v1/voice-answer", {
      method: "POST",
      json: { prospect: state.current.key, question: q, history: [] },
    });
    const badge = r.handoff
      ? `<span class="arag-chip warn">handoff · ${esc(r.handoff_reason ?? "")}</span>`
      : '<span class="arag-chip ok">answered</span>';
    $("#kbPending").outerHTML = `<div class="arag-bubble assistant">${esc(r.answer)}
        <div class="vb-chip-row" style="margin-top:8px">${badge}${r.citations.map(citeChip).join("")}
        <span class="subtle small">retrieve ${fmtMs(r.latency_ms.retrieve)} · first token ${fmtMs(
          r.latency_ms.first_token,
        )} · total ${fmtMs(r.latency_ms.total)}</span></div></div>`;
    box.scrollTop = box.scrollHeight;
  } catch (e) {
    $("#kbPending").outerHTML = `<div class="arag-bubble assistant"><span class="arag-chip danger">${esc(
      e.message,
    )}</span></div>`;
  } finally {
    $("#kbAsk").disabled = false;
  }
}

async function loadRuns() {
  const tbody = $("#kbRuns tbody");
  tbody.innerHTML = skeletonRows(3, 4);
  try {
    const { items } = await api(
      `/api/v1/golden-evals?prospect=${encodeURIComponent(state.current.key)}&limit=15`,
    );
    tbody.innerHTML = items.length
      ? items
          .map(
            (r) => `<tr tabindex="0" data-eval="${esc(r.id)}">
              <td>${ago(r.createdAt)}</td>
              <td>${
                r.ok
                  ? '<span class="arag-chip ok">all passed</span>'
                  : `<span class="arag-chip danger">${r.failed} failed</span>`
              } <span class="vb-sub">${r.passed}/${r.total}</span></td>
              <td class="num">${r.latency_ms?.p50 ?? "—"}</td>
              <td class="num">${r.latency_ms?.p95 ?? "—"}</td>
            </tr>`,
          )
          .join("")
      : `<tr><td colspan="4">${empty({
          icon: "check",
          title: "The golden set has never run here",
          body: "Run it to see whether this prospect is answering well enough to be trusted on a call.",
        })}</td></tr>`;
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="4">${errorState(e.message, "kbRunsRetry")}</td></tr>`;
    $("#kbRunsRetry")?.addEventListener("click", loadRuns);
  }
}

async function showEval(id) {
  const close = openDrawer({
    title: "Golden run",
    sub: `<span class="vb-mono">${esc(id)}</span>`,
    body: '<div class="vb-skeleton" style="height:200px"></div>',
  });
  try {
    const r = await api(`/api/v1/golden-evals/${encodeURIComponent(id)}`);
    document.querySelector(".vb-drawer-body").innerHTML = `
      <div class="vb-stats" style="margin-bottom:18px">
        ${stat("Result", r.ok ? "Gate open" : "Gate closed")}
        ${stat("Passed", `${r.passed}/${r.total}`)}
        ${stat("p50", `${r.latency_ms.p50} ms`, `p95 ${r.latency_ms.p95} ms`)}
        ${stat("Ran", new Date(r.createdAt).toLocaleString())}
      </div>
      ${r.cases.map(caseBlock).join("")}`;
  } catch (e) {
    document.querySelector(".vb-drawer-body").innerHTML = errorState(e.message);
  }
  return close;
}

function caseBlock(c) {
  const failures = c.checks.filter((x) => !x.ok);
  return `<div class="vb-card" style="margin-bottom:10px">
    <header>
      <h3 style="font-weight:550">${esc(c.q)}</h3>
      <span class="spacer"></span>
      ${c.passed ? '<span class="arag-chip ok">pass</span>' : '<span class="arag-chip danger">fail</span>'}
      <span class="arag-chip neutral">${c.latency_ms} ms</span>
    </header>
    <div class="vb-card-body">
      <p class="muted small" style="margin:0 0 8px">Expected <strong>${esc(c.expect)}</strong> · got
        <strong>${c.handoff ? "handoff" : "answer"}</strong>${c.handoff_reason ? ` (${esc(c.handoff_reason)})` : ""} ·
        ${c.citations} citation${c.citations === 1 ? "" : "s"}</p>
      <p style="margin:0 0 8px">${esc(c.answer)}</p>
      ${
        failures.length
          ? `<ul class="muted small" style="margin:0;padding-left:18px">${failures
              .map((f) => `<li>${esc(f.label)}</li>`)
              .join("")}</ul>`
          : ""
      }
    </div>
  </div>`;
}

async function runGolden() {
  const btn = $("#kbRunGolden");
  btn.disabled = true;
  $("#kbGoldenChip").className = "arag-chip info";
  $("#kbGoldenChip").textContent = "running";
  $("#kbGoldenTable").querySelector("tbody").innerHTML =
    '<tr><td colspan="4"><span class="vb-skeleton" style="display:block;width:60%"></span></td></tr>';
  $("#kbGoldenRun").innerHTML = '<arag-job-timeline id="kbTimeline"></arag-job-timeline>';
  try {
    const { job } = await api("/api/v1/golden-evals", {
      method: "POST",
      json: { prospect: state.current.key },
    });
    const tl = $("#kbTimeline");
    tl.job = job;
    goldenClose?.();
    goldenClose = sse(`/api/v1/jobs/${job.id}/events`, {
      event: (e) => tl.apply(e),
      job: async (j) => {
        const done = j.job ?? j;
        tl.job = done;
        if (["succeeded", "failed", "cancelled"].includes(done.status)) {
          goldenClose?.();
          goldenClose = null;
          btn.disabled = false;
          await renderGoldenResult(job.id);
          loadRuns();
        }
      },
    });
  } catch (e) {
    toast(e.message, "error");
    $("#kbGoldenChip").className = "arag-chip danger";
    $("#kbGoldenChip").textContent = "failed to start";
    btn.disabled = false;
  }
}

async function renderGoldenResult(jobId) {
  const r = await api(`/api/v1/golden-evals/${jobId}`);
  $("#kbGoldenTable").querySelector("tbody").innerHTML = r.cases
    .map(
      (c) =>
        `<tr><td>${esc(c.q)}</td><td>${esc(c.expect)}</td><td>${
          c.passed
            ? '<span class="arag-chip ok">pass</span>'
            : `<span class="arag-chip danger">fail</span> <span class="vb-sub">${esc(
                c.checks
                  .filter((x) => !x.ok)
                  .map((x) => x.label)
                  .join("; "),
              )}</span>`
        }</td><td class="num">${c.latency_ms}</td></tr>`,
    )
    .join("");
  const el = $("#kbGoldenChip");
  el.className = `arag-chip ${r.ok ? "ok" : "danger"}`;
  el.textContent = r.ok ? "gate open" : "gate closed";
  $("#kbGoldenRun").insertAdjacentHTML(
    "beforeend",
    `<p class="muted small" style="margin-top:8px">${r.passed}/${r.total} passed · p50 ${r.latency_ms.p50} ms · p95 ${r.latency_ms.p95} ms</p>`,
  );
}

async function loadKnowledge() {
  if (!state.current) return;
  try {
    knowledge = await api(`/api/v1/knowledge?prospect=${encodeURIComponent(state.current.key)}`);
    $("#kbCard").innerHTML = kbCard(knowledge);
    renderGoldenState(knowledge);
    suggestions(knowledge);
  } catch (e) {
    $("#kbCard").innerHTML = errorState(e.message, "kbRetry");
    $("#kbRetry")?.addEventListener("click", loadKnowledge);
  }
  loadRuns();
}

host = mountShell({
  section: "knowledge",
  title: "Knowledge",
  description:
    "The content behind every brief and every answer — which Knowledge Box, how it is retrieved, " +
    "and whether it still passes its golden set.",
});

await boot();
host.innerHTML = chrome();
prospectSwitcher(() => loadKnowledge());

if (!state.current) {
  host.innerHTML = empty({
    icon: "warning",
    kind: "error",
    title: "No prospect is configured",
    body: "A prospect points this deployment at a Knowledge Box.",
    action: '<a class="arag-btn" href="/prospects/">Open Prospects</a>',
  });
} else {
  $("#kbAsk").addEventListener("click", ask);
  $("#kbQuestion").addEventListener("keydown", (e) => e.key === "Enter" && ask());
  $("#kbRunGolden").addEventListener("click", runGolden);
  $("#kbReloadRuns").addEventListener("click", loadRuns);
  document.addEventListener("click", (e) => {
    const tr = e.target.closest("#kbRuns tbody tr[data-eval]");
    if (tr) showEval(tr.dataset.eval);
  });
  await loadKnowledge();
}
