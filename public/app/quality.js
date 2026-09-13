// Quality — is the product behaving? Latency against the budget a live conversation allows, how
// often it hands off rather than guessing, whether answers are cited, and which guard trips and
// handoff reasons are actually firing.
import {
  activatableRows,
  ago,
  api,
  boot,
  empty,
  errorState,
  esc,
  icon,
  mountShell,
  openDrawer,
  prospectSwitcher,
  skeletonRows,
  stat,
  state,
} from "./shell.js";

const PAGE = 50;
const filters = { outcome: "", source: "", reason: "", offset: 0 };
let total = 0;
let turns = [];

const $ = (s) => document.querySelector(s);

function chrome() {
  return `
    <div class="arag-statstrip" id="qMetrics" style="margin-bottom:20px">
      ${Array.from({ length: 6 }, () => '<div><div class="arag-skeleton" style="width:70%"></div></div>').join("")}
    </div>

    <section class="arag-card">
        <div class="head">
          <h2>Turn log</h2>
          <span class="spacer"></span>
          <select id="qOutcome" class="arag-select" style="width:auto;height:32px;padding-block:0" aria-label="Outcome">
            <option value="">Every turn</option>
            <option value="answered">Answered</option>
            <option value="handoff">Handed off</option>
            <option value="guard">Guard trips</option>
          </select>
          <select id="qSource" class="arag-select" style="width:auto;height:32px;padding-block:0" aria-label="Source">
            <option value="">Any source</option>
            <option value="voice-answer">Live turns</option>
            <option value="golden-eval">Golden runs</option>
          </select>
          <button class="arag-btn ghost sm" id="qReload">${icon("refresh", 14)}</button>
        </div>
        <div class="body" style="padding:0">
          <div class="arag-datatable vb-flat">
            <div class="scroll">
              <table id="qTable">
                <thead><tr>
                  <th>When</th><th>Question</th><th>Result</th>
                  <th class="num">total</th><th class="num">1st token</th><th class="num">cites</th>
                </tr></thead>
                <tbody>${skeletonRows(8, 6)}</tbody>
              </table>
            </div>
            <nav class="arag-pagination" id="qPager" hidden>
              <button class="arag-btn ghost sm" id="qPrev">Previous</button>
              <button class="arag-btn ghost sm" id="qNext">Next</button>
              <span class="spacer"></span><span class="range" id="qRange"></span>
            </nav>
          </div>
        </div>
      </section>

      <div class="arag-grid cols-2" style="margin-top:20px">
        <section class="arag-card">
          <div class="head"><h2>Why turns did not answer</h2></div>
          <div class="body" id="qReasons"><div class="arag-skeleton" style="height:90px"></div></div>
        </section>
        <section class="arag-card">
          <div class="head"><h2>How quality is decided</h2></div>
          <div class="body">
            <p class="muted small" style="margin:0 0 10px">The golden set under Knowledge is the
              source of truth: every question runs through this deployment's own pipeline, and the
              gate opens only when all of them behave. Nothing else can open it.</p>
            <p class="muted small" style="margin:0">ElevenLabs agent testing and simulated
              conversations exercise the <em>voice</em> layer — whether the agent routes to the
              <code>voice_answer</code> tool, and how it speaks the result. They are complementary:
              run them against the agent in the ElevenLabs dashboard once the golden set passes
              here, because a simulation of a wrong answer is still a wrong answer. There is no
              automated quality gate for the live brief itself yet.</p>
          </div>
        </section>
        <section class="arag-card">
          <div class="head"><h2>What the numbers mean</h2></div>
          <div class="body">
            <dl class="arag-kv">
              <dt>Handoff rate</dt><dd>Turns escalated rather than answered. A deliberate handoff is a
                good outcome — it is the alternative to guessing.</dd>
              <dt>Citation coverage</dt><dd>Share of answered turns carrying at least one source. An
                answer without one should not have been spoken.</dd>
              <dt>Guard trips</dt><dd>Inputs or outputs a safety guard stopped. The text that tripped
                an input guard is never stored.</dd>
              <dt>Latency</dt><dd>A person speaking eight to fifteen seconds a turn leaves a two-to-four
                second budget for the brief alongside them.</dd>
            </dl>
          </div>
        </section>
      </div>`;
}

function pct(x) {
  return `${Math.round((x ?? 0) * 100)}%`;
}

async function loadMetrics() {
  const el = $("#qMetrics");
  try {
    const q = state.current ? `?prospect=${encodeURIComponent(state.current.key)}` : "";
    const m = await api(`/api/v1/metrics${q}`);
    el.innerHTML = [
      stat("Turns in window", m.turns),
      stat("p50 total", `${m.latency_total_ms.p50} ms`, `p95 ${m.latency_total_ms.p95} ms`),
      stat("p50 first token", `${m.latency_first_token_ms.p50} ms`),
      stat("Handoff rate", pct(m.handoff_rate)),
      stat("Citation coverage", pct(m.citation_coverage)),
      stat("Guard trips", pct(m.guard_trip_rate)),
    ].join("");
  } catch (e) {
    el.outerHTML = `<div id="qMetrics">${errorState(e.message, "qMetricsRetry")}</div>`;
    $("#qMetricsRetry")?.addEventListener("click", loadMetrics);
  }
}

function turnRow(t, i) {
  const badge = t.guard_trip
    ? `<span class="arag-chip danger">guard · ${esc(t.reason ?? "")}</span>`
    : t.handoff
      ? `<span class="arag-chip warn">handoff · ${esc(t.reason ?? "")}</span>`
      : '<span class="arag-chip ok">answered</span>';
  return `<tr tabindex="0" data-turn="${i}">
    <td>${ago(t.createdAt)}<div class="cell-sub">${esc(t.source)}</div></td>
    <td><span class="arag-truncate" style="max-width:40ch">${
      t.question ? esc(t.question) : '<span class="muted">redacted (guard trip)</span>'
    }</span></td>
    <td>${badge}</td>
    <td class="num">${t.total} ms</td>
    <td class="num">${t.first_token} ms</td>
    <td class="num">${t.citations}</td>
  </tr>`;
}

function renderReasons(reasons) {
  const el = $("#qReasons");
  if (!reasons.length) {
    el.innerHTML = empty({
      icon: "check",
      title: "Nothing has handed off",
      body: "Every turn in the window answered from the Knowledge Box.",
    });
    return;
  }
  const max = Math.max(...reasons.map((r) => r.count));
  el.innerHTML = reasons
    .map(
      (r) => `<div style="margin-bottom:10px">
        <div class="arag-row" style="justify-content:space-between;font-size:12.5px">
          <span>${esc(r.reason)} ${r.guard ? '<span class="arag-chip danger" style="margin-left:4px">guard</span>' : ""}</span>
          <strong style="font-variant-numeric:tabular-nums">${r.count}</strong>
        </div>
        <div class="arag-progress" style="margin-top:4px"><i style="width:${Math.round((r.count / max) * 100)}%"></i></div>
      </div>`,
    )
    .join("");
}

async function loadTurns() {
  const tbody = $("#qTable tbody");
  tbody.innerHTML = skeletonRows(8, 6);
  const qs = new URLSearchParams({ limit: String(PAGE), offset: String(filters.offset) });
  if (state.current) qs.set("prospect", state.current.key);
  if (filters.outcome) qs.set("outcome", filters.outcome);
  if (filters.source) qs.set("source", filters.source);
  if (filters.reason) qs.set("reason", filters.reason);
  try {
    const page = await api(`/api/v1/turns?${qs}`);
    turns = page.items;
    total = page.total;
    tbody.innerHTML = page.items.length
      ? page.items.map(turnRow).join("")
      : `<tr><td colspan="6">${empty({
          icon: "quality",
          title: "No turns yet",
          body: "The turn log fills as questions are answered — ask something under Knowledge, or run a golden set.",
          action: '<a class="arag-btn secondary sm" href="/knowledge/">Open Knowledge</a>',
        })}</td></tr>`;
    renderReasons(page.reasons ?? []);
    const pager = $("#qPager");
    pager.hidden = total <= PAGE;
    $("#qRange").textContent = `${filters.offset + 1}–${Math.min(filters.offset + PAGE, total)} of ${total}`;
    $("#qPrev").disabled = filters.offset === 0;
    $("#qNext").disabled = filters.offset + PAGE >= total;
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="6">${errorState(e.message, "qRetry")}</td></tr>`;
    $("#qRetry")?.addEventListener("click", loadTurns);
  }
}

function turnDetail(i) {
  const t = turns[Number(i)];
  if (!t) return;
  openDrawer({
    title: "Turn",
    sub: `<span class="mono">${esc(t.id)}</span>`,
    body: `
      <div class="arag-statstrip" style="margin-bottom:18px">
        ${stat("Total", `${t.total} ms`)}
        ${stat("First token", `${t.first_token} ms`)}
        ${stat("Retrieval", `${t.retrieve} ms`)}
        ${stat("Citations", t.citations)}
      </div>
      <dl class="arag-kv">
        <dt>When</dt><dd>${new Date(t.createdAt).toLocaleString()}</dd>
        <dt>Prospect</dt><dd>${esc(t.prospect)}</dd>
        <dt>Source</dt><dd>${esc(t.source)}</dd>
        <dt>Conversation</dt><dd class="mono">${esc(t.conversation_id ?? "—")}</dd>
        <dt>Outcome</dt><dd>${t.handoff ? "handed off" : "answered"}${t.reason ? ` · ${esc(t.reason)}` : ""}</dd>
        <dt>Question</dt><dd>${
          t.question
            ? esc(t.question)
            : '<span class="muted">Not stored. A turn whose input tripped a safety guard keeps the reason and nothing else.</span>'
        }</dd>
      </dl>`,
  });
}

const host = mountShell({
  section: "quality",
  title: "Quality",
  description:
    "Latency against the budget a live conversation allows, how often the product hands off rather " +
    "than guesses, and which guards are firing.",
});

await boot();
host.innerHTML = chrome();
prospectSwitcher(() => {
  filters.offset = 0;
  loadMetrics();
  loadTurns();
});

$("#qOutcome").addEventListener("change", (e) => {
  filters.outcome = e.target.value;
  filters.offset = 0;
  loadTurns();
});
$("#qSource").addEventListener("change", (e) => {
  filters.source = e.target.value;
  filters.offset = 0;
  loadTurns();
});
$("#qReload").addEventListener("click", () => {
  loadMetrics();
  loadTurns();
});
$("#qPrev").addEventListener("click", () => {
  filters.offset = Math.max(0, filters.offset - PAGE);
  loadTurns();
});
$("#qNext").addEventListener("click", () => {
  filters.offset += PAGE;
  loadTurns();
});
activatableRows("#qTable tbody tr[data-turn]", (tr) => turnDetail(tr.dataset.turn));

await Promise.all([loadMetrics(), loadTurns()]);
