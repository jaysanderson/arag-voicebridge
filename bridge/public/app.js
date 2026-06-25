// ARAG Voice control panel.
// Talks ONLY to the bridge (never to ARAG/ElevenLabs directly — no secrets in the browser).
// The ElevenLabs ConvAI widget owns live audio; this panel owns the transcript, citation
// chips, latency strip, golden-set runner, and live metrics (SPEC §6.5, §13).

const { BRIDGE_URL, METRICS_POLL_MS } = window.ARAG_VOICE_CONFIG;

const el = (id) => document.getElementById(id);
const orb = el("orb");
const log = el("log");
let prospects = [];
let current = null;

function setOrb(state) {
  orb.dataset.state = state;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

// ---- load prospects --------------------------------------------------------
async function loadProspects() {
  try {
    const res = await fetch(`${BRIDGE_URL}/v1/prospects`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    prospects = await res.json();
    el("mBridge").textContent = "online";
    el("mBridge").style.color = "var(--ok)";
  } catch (err) {
    prospects = [];
    el("mBridge").textContent = "offline";
    el("mBridge").style.color = "var(--bad)";
    el("voiceHint").innerHTML = `Can't reach the bridge at <code>${escapeHtml(
      BRIDGE_URL,
    )}</code>. Start it with <code>make dev</code>, or set <code>?bridge=URL</code>.`;
    return;
  }
  const sel = el("prospect");
  sel.innerHTML = "";
  for (const p of prospects) {
    const opt = document.createElement("option");
    opt.value = p.key;
    opt.textContent = p.display_name;
    sel.appendChild(opt);
  }
  if (prospects.length) selectProspect(prospects[0].key);
}

function selectProspect(key) {
  current = prospects.find((p) => p.key === key) || null;
  if (!current) return;
  el("consoleTitle").textContent = `Voice console — ${current.display_name}`;
  el("greeting").textContent = current.greeting ? `Greeting: “${current.greeting}”` : "";
  mountVoice(current);
}

// ---- ElevenLabs ConvAI widget (live audio) ---------------------------------
// The widget script upgrades any <elevenlabs-convai> element on the page. We load it once,
// resolve a promise on load/error, and reflect the state in the console's connection pill.
let widgetScriptPromise = null;
function ensureWidgetScript() {
  if (widgetScriptPromise) return widgetScriptPromise;
  widgetScriptPromise = new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = "https://unpkg.com/@elevenlabs/convai-widget-embed";
    s.async = true;
    s.type = "text/javascript";
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
  return widgetScriptPromise;
}

function hasRealAgent(p) {
  return p.agent_id && !/REPLACE_ME/i.test(p.agent_id);
}

function setConn(state, label) {
  el("connState").dataset.on = state === "ready" ? "true" : "false";
  el("connState").textContent = label;
}

function mountVoice(p) {
  const mount = el("voiceMount");
  if (hasRealAgent(p)) {
    setConn("connecting", "connecting voice…");
    // Render the widget element + a caption that frames the agent-assist story.
    mount.innerHTML =
      `<elevenlabs-convai agent-id="${escapeHtml(p.agent_id)}"></elevenlabs-convai>` +
      `<p class="hint voice-caption">🎙️ Click the <b>talk</b> button to start a voice call with ` +
      `<b>${escapeHtml(p.display_name)}</b> (allow your mic when asked). Answers are grounded in ` +
      `the knowledge base; the <b>transcript &amp; citations</b> panel and the <b>live metrics</b> ` +
      `bar below update as the call runs.</p>`;
    ensureWidgetScript().then((ok) =>
      ok
        ? setConn("ready", "voice ready")
        : setConn("error", "voice widget failed to load"),
    );
  } else {
    setConn("offline", "text mode");
    mount.innerHTML = `<p class="hint">No live <code>agent_id</code> for <b>${escapeHtml(
      p.display_name,
    )}</b> yet. Add one to the registry to enable the voice widget. Meanwhile, use the ask box ` +
      `below — it drives the same bridge → ARAG path (the agent-assist “whisper” view).</p>`;
  }
}

// ---- ask one question via the bridge ---------------------------------------
async function ask(question) {
  if (!current) return;
  setOrb("thinking");
  const turn = renderPendingTurn(question);
  try {
    const res = await fetch(`${BRIDGE_URL}/v1/voice-answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prospect: current.key,
        question,
        conversation_id: "panel",
        history: [],
      }),
    });
    if (!res.ok) throw new Error(`bridge HTTP ${res.status}`);
    const data = await res.json();
    fillTurn(turn, data);
    setOrb(data.handoff ? "handoff" : "speaking");
    setTimeout(() => setOrb("idle"), 1400);
  } catch (err) {
    turn.classList.add("error");
    turn.querySelector(".a").textContent = `Error: ${err.message}`;
    setOrb("idle");
  }
}

function renderPendingTurn(question) {
  const div = document.createElement("div");
  div.className = "turn";
  div.innerHTML = `<div class="q"><b>Caller:</b> ${escapeHtml(question)}</div>
    <div class="a">…</div>`;
  log.prepend(div);
  return div;
}

function fillTurn(div, data) {
  if (data.handoff) div.classList.add("handoff");
  div.querySelector(".a").textContent = data.answer;

  const badges = [];
  if (data.handoff) badges.push(`<span class="badge ho">HANDOFF</span>`);
  badges.push(`<span class="badge lat">${data.latency_ms.total} ms</span>`);
  const badgeRow = `<div class="badges">${badges.join("")}</div>`;

  let cites = "";
  if (data.citations && data.citations.length) {
    cites =
      `<div class="cites">` +
      data.citations
        .map((c) => {
          const href = c.url ? escapeHtml(c.url) : "#";
          return `<a class="cite" href="${href}" target="_blank" rel="noopener">
            📄 ${escapeHtml(c.title)} <span class="score">${c.score.toFixed(2)}</span></a>`;
        })
        .join("") +
      `</div>`;
  }

  const l = data.latency_ms;
  const lat = `<div class="latstrip">
      <span>retrieve <b>${l.retrieve}ms</b></span>
      <span>1st-token <b>${l.first_token}ms</b></span>
      <span>total <b>${l.total}ms</b></span>
    </div>`;

  div.insertAdjacentHTML("beforeend", badgeRow + cites + lat);
}

// ---- golden set runner -----------------------------------------------------
const URL_RE = /\bhttps?:\/\//i;
const MARKER_RE = /\[\s*\d+\s*\]/;
const sentenceCount = (s) => (s.match(/[.!?]+/g) || []).length || (s.trim() ? 1 : 0);

async function runGolden() {
  if (!current) return;
  const qs = current.golden_questions || [];
  const block = document.createElement("div");
  block.className = "turn golden";
  block.innerHTML = `<div class="q"><b>Golden set:</b> ${escapeHtml(
    current.display_name,
  )} — ${qs.length} questions</div><div class="rows"></div><div class="a summary">Running…</div>`;
  log.prepend(block);
  const rows = block.querySelector(".rows");

  let pass = 0;
  const lats = [];
  for (const gq of qs) {
    let data;
    try {
      const res = await fetch(`${BRIDGE_URL}/v1/voice-answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prospect: current.key, question: gq.q, history: [] }),
      });
      data = await res.json();
    } catch (err) {
      addGoldenRow(rows, gq.q, false, err.message);
      continue;
    }
    lats.push(data.latency_ms.total);
    const ok = checkGolden(gq, data);
    if (ok.pass) pass++;
    addGoldenRow(rows, gq.q, ok.pass, ok.why);
  }
  const p95 = percentile(lats, 95);
  block.querySelector(".summary").textContent =
    `${pass}/${qs.length} passed · p95 ${p95}ms · gate ${pass === qs.length ? "OPEN ✓" : "CLOSED ✖"}`;
}

function checkGolden(gq, data) {
  const expectHandoff = gq.expect === "handoff";
  if (data.handoff !== expectHandoff)
    return { pass: false, why: `expected ${gq.expect}, got ${data.handoff ? "handoff" : "answer"}` };
  if (gq.expect === "answer") {
    if (!data.citations || data.citations.length < 1) return { pass: false, why: "no citation (S4)" };
    if (URL_RE.test(data.answer)) return { pass: false, why: "URL spoken (S5)" };
    if (MARKER_RE.test(data.answer)) return { pass: false, why: "citation marker (S5)" };
    if (sentenceCount(data.answer) > 3) return { pass: false, why: ">3 sentences (S5)" };
    for (const t of gq.must_include || [])
      if (!data.answer.toLowerCase().includes(t.toLowerCase()))
        return { pass: false, why: `missing "${t}"` };
  }
  return { pass: true, why: "ok" };
}

function addGoldenRow(rows, q, pass, why) {
  const r = document.createElement("div");
  r.className = `row ${pass ? "pass" : "fail"}`;
  r.innerHTML = `<span>${pass ? "✓" : "✖"} ${escapeHtml(q)}</span><span>${escapeHtml(why)}</span>`;
  rows.appendChild(r);
}

function percentile(values, p) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1);
  return Math.round(s[Math.max(0, i)]);
}

// ---- metrics polling -------------------------------------------------------
async function pollMetrics() {
  try {
    const res = await fetch(`${BRIDGE_URL}/metrics`);
    if (!res.ok) return;
    const m = await res.json();
    el("mTurns").textContent = m.turns;
    el("mP50").textContent = `${m.latency_total_ms.p50}ms`;
    el("mP95").textContent = `${m.latency_total_ms.p95}ms`;
    el("mFt").textContent = `${m.latency_first_token_ms.p50}ms`;
    el("mHo").textContent = `${Math.round(m.handoff_rate * 100)}%`;
    el("mCov").textContent = `${Math.round(m.citation_coverage * 100)}%`;
  } catch {
    /* bridge offline; leave dashes */
  }
}

// ---- wiring ----------------------------------------------------------------
el("prospect").addEventListener("change", (e) => selectProspect(e.target.value));
el("askForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const v = el("askInput").value.trim();
  if (!v) return;
  el("askInput").value = "";
  ask(v);
});
el("runGolden").addEventListener("click", runGolden);
el("clearLog").addEventListener("click", () => (log.innerHTML = ""));

loadProspects();
pollMetrics();
setInterval(pollMetrics, METRICS_POLL_MS);
