// ARAG Voice — two functions: Call (talk to the agent) and Listen (silent copilot brief).
// Talks ONLY to the bridge; no secrets in the browser.

const { BRIDGE_URL, METRICS_POLL_MS } = window.ARAG_VOICE_CONFIG;
const el = (id) => document.getElementById(id);
const orb = el("orb");

let current = null; // the active prospect (auto-selected — the deployment's KB)
let viewMode = "voice"; // "voice" (Call) | "listen"
let selectedModel = ""; // "" = KB default; else an ARAG generative_model id (brief)
let selectedVoice = ""; // "" = agent default; else an ElevenLabs voice_id (Call)

function setOrb(state) {
  orb.dataset.state = state;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

// ---- init: load the deployment's prospect + its models + the voices ---------
async function init() {
  try {
    const res = await fetch(`${BRIDGE_URL}/v1/prospects`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const list = await res.json();
    current = list[0] || null; // single-KB deployment → first prospect
  } catch {
    current = null;
  }
  if (current) loadModels(current);
  loadVoices();
}

// ---- mode switch (the two functions) ---------------------------------------
function setMode(mode) {
  viewMode = mode;
  for (const b of document.querySelectorAll("#modeToggle .seg")) {
    b.classList.toggle("active", b.dataset.mode === mode);
  }
  el("callView").hidden = mode !== "voice";
  el("listenView").hidden = mode !== "listen";
  if (mode !== "voice") endCall();
  if (mode !== "listen") stopListen();
  setOrb("idle");
}

// ---- dropdowns -------------------------------------------------------------
async function loadVoices() {
  const sel = el("voice");
  try {
    const res = await fetch(`${BRIDGE_URL}/v1/voices`);
    if (!res.ok) return; // 503 without an EL key → just "Agent default"
    const { voices } = await res.json();
    for (const v of voices || []) {
      const o = document.createElement("option");
      o.value = v.id;
      o.textContent = v.category && v.category !== "premade" ? `${v.name} ★` : v.name;
      sel.appendChild(o);
    }
  } catch {
    /* leave just Agent default */
  }
}

async function loadModels(p) {
  const sel = el("model");
  sel.innerHTML = '<option value="">KB default</option>';
  selectedModel = "";
  try {
    const res = await fetch(`${BRIDGE_URL}/v1/models?prospect=${encodeURIComponent(p.key)}`);
    if (!res.ok) return;
    const { models, current: def } = await res.json();
    if (def) sel.options[0].textContent = `KB default (${def})`;
    for (const m of models || []) {
      const o = document.createElement("option");
      o.value = m.id;
      o.textContent = m.label || m.id;
      sel.appendChild(o);
    }
    // Default the brief to a FAST model so the card updates continuously (slow models like
    // Claude can't return the structured brief in time and leave it frozen).
    const fast = ["gemini-2.5-flash", "chatgpt4o-mini", "chatgpt-azure-4o-mini", "gemini-2.5-flash-lite"]
      .find((id) => (models || []).some((m) => m.id === id));
    if (fast) { sel.value = fast; selectedModel = fast; }
  } catch {
    /* leave just KB default */
  }
}

// ============================================================================
// CALL — on-brand voice call via @elevenlabs/client (no embed widget)
// ============================================================================
let callConvo = null;
let callMuted = false;
let callGen = 0; // generation guard: stale handlers no-op after a new attempt
let ElevenSDK = null;

async function loadSdk() {
  if (ElevenSDK) return ElevenSDK;
  ElevenSDK = await import("https://esm.sh/@elevenlabs/client@1.14.0");
  return ElevenSDK;
}
function callStatus(msg) {
  const s = el("callStatus");
  if (s) s.textContent = msg;
}
function isVoiceOverrideError(msg) {
  return /voice_id|override/i.test(String(msg || ""));
}

async function startCall(useVoiceOverride = true) {
  if (!current || !current.agent_id) {
    callStatus("no agent configured for this knowledge base.");
    return;
  }
  if (callConvo) { const c = callConvo; callConvo = null; try { await c.endSession(); } catch {} }
  const gen = ++callGen;
  const btn = el("callBtn");
  if (btn) btn.disabled = true;
  callStatus("connecting…");
  setOrb("thinking");
  const applyingVoice = Boolean(selectedVoice && useVoiceOverride);
  const live = () => gen === callGen;

  const fallbackToDefault = () => {
    if (!live()) return; // already superseded → don't double-retry
    callStatus("custom voice needs 'Voice ID' override on the agent — using default voice");
    startCall(false);
  };

  try {
    const { Conversation } = await loadSdk();
    if (!live()) return;
    const opts = {
      agentId: current.agent_id,
      connectionType: "webrtc",
      onConnect: () => {
        if (!live()) return;
        btn.textContent = "End call";
        btn.disabled = false;
        el("muteBtn").hidden = false;
        callStatus(applyingVoice ? "connected — listening (custom voice)" : "connected — listening");
        setOrb("idle");
      },
      onDisconnect: (details) => {
        const reason = details && details.reason;
        const msg = (details && (details.message || details.closeReason)) || "";
        // The override is rejected via an error-disconnect. While applying a voice override,
        // ANY error-disconnect is almost certainly that → retry on the default voice instead
        // of dropping the call. (fallbackToDefault self-guards against double-retry.)
        if (applyingVoice && (reason === "error" || isVoiceOverrideError(msg))) {
          fallbackToDefault();
          return;
        }
        if (!live()) return;
        callConvo = null;
        resetCallUI();
        if (reason === "error" && msg) callStatus(`disconnected: ${msg}`);
      },
      onStatusChange: ({ status }) => { if (live() && status && status !== "connected") callStatus(status); },
      onModeChange: ({ mode }) => {
        if (!live()) return;
        setOrb(mode === "speaking" ? "speaking" : "idle");
        callStatus(mode === "speaking" ? "agent speaking…" : "listening…");
      },
      onMessage: ({ message, source }) => { if (live()) renderCallMessage(source, message); },
      onError: (m) => {
        if (applyingVoice && isVoiceOverrideError(m)) { fallbackToDefault(); return; }
        if (live()) callStatus(`error: ${m}`);
      },
    };
    if (applyingVoice) opts.overrides = { tts: { voiceId: selectedVoice } };
    const convo = await Conversation.startSession(opts);
    if (!live()) { try { await convo.endSession(); } catch {} return; }
    callConvo = convo;
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    if (applyingVoice && isVoiceOverrideError(msg)) { fallbackToDefault(); return; }
    if (!live()) return;
    callStatus(`error: ${msg}`);
    setOrb("idle");
    if (btn) btn.disabled = false;
    callConvo = null;
  }
}

async function endCall() {
  callGen++; // invalidate any in-flight attempt
  const c = callConvo;
  callConvo = null;
  if (c) { try { await c.endSession(); } catch {} }
  resetCallUI();
}

function resetCallUI() {
  callMuted = false;
  const btn = el("callBtn");
  if (btn) { btn.textContent = "📞 Start call"; btn.disabled = false; }
  const mb = el("muteBtn");
  if (mb) { mb.hidden = true; mb.textContent = "Mute"; }
  if (viewMode === "voice") { setOrb("idle"); callStatus("Ready."); }
}

function toggleMute() {
  if (!callConvo) return;
  callMuted = !callMuted;
  try { callConvo.setMicMuted(callMuted); } catch {}
  el("muteBtn").textContent = callMuted ? "Unmute" : "Mute";
}

function renderCallMessage(source, text) {
  if (!text || !String(text).trim()) return;
  const who = source === "user" ? "You" : current ? current.display_name : "Agent";
  const div = document.createElement("div");
  div.className = `turn call-turn ${source === "user" ? "from-user" : "from-agent"}`;
  div.innerHTML = `<div class="q"><b>${escapeHtml(who)}:</b> ${escapeHtml(text)}</div>`;
  el("callLog").prepend(div);
}

// ============================================================================
// LISTEN — Scribe STT → continuously evolving structured brief (silent)
// ============================================================================
let listenActive = false;
let listenWS = null;
let listenCtx = null;
let listenStream = null;
let listenNodes = null;
let listenInRate = 16000;
let reconnectTimer = null;
let committedText = "";
let partialText = "";
let fullTranscript = "";
let lastBrief = null;
let querying = false;
let lastQueryNorm = "";
let lastFireAt = 0;
let briefLoop = null;
const briefSources = new Map();

const WINDOW_WORDS = 28;
const KEEP_WORDS = 60;
const TRANSCRIPT_KEEP_CHARS = 8000;
const MIN_QUERY_GAP_MS = 1500;
const TICK_MS = 600;

function listenStatus(msg) {
  el("listenStatus").textContent = msg;
}
function lastWords(str, n) {
  return (str || "").trim().split(/\s+/).filter(Boolean).slice(-n).join(" ");
}
function normWords(str) {
  return (str || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}
function jaccard(a, b) {
  const A = new Set(a.split(" ").filter(Boolean));
  const B = new Set(b.split(" ").filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}
function floatTo16BitPCM(input) {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}
function downsample(buffer, inRate, outRate) {
  if (outRate >= inRate) return buffer;
  const ratio = inRate / outRate;
  const newLen = Math.round(buffer.length / ratio);
  const result = new Float32Array(newLen);
  let oR = 0;
  let oB = 0;
  while (oR < newLen) {
    const next = Math.round((oR + 1) * ratio);
    let acc = 0;
    let cnt = 0;
    for (let i = oB; i < next && i < buffer.length; i++) { acc += buffer[i]; cnt++; }
    result[oR++] = cnt ? acc / cnt : 0;
    oB = next;
  }
  return result;
}
function bytesToBase64(bytes) {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(bin);
}

async function setupMic() {
  listenStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  listenCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (listenCtx.state === "suspended") { try { await listenCtx.resume(); } catch {} }
  listenInRate = listenCtx.sampleRate;
  const source = listenCtx.createMediaStreamSource(listenStream);
  const processor = listenCtx.createScriptProcessor(4096, 1, 1);
  const mute = listenCtx.createGain();
  mute.gain.value = 0;
  source.connect(processor);
  processor.connect(mute);
  mute.connect(listenCtx.destination);
  processor.onaudioprocess = (e) => {
    if (!listenWS || listenWS.readyState !== WebSocket.OPEN) return;
    const f32 = downsample(e.inputBuffer.getChannelData(0), listenInRate, 16000);
    const b64 = bytesToBase64(new Uint8Array(floatTo16BitPCM(f32).buffer));
    try {
      listenWS.send(JSON.stringify({ message_type: "input_audio_chunk", audio_base_64: b64, commit: false }));
    } catch {
      /* socket mid-close */
    }
  };
  listenNodes = { source, processor, mute };
}

async function connectScribe() {
  if (!listenActive) return;
  listenStatus(listenWS ? "reconnecting…" : "connecting…");
  let token;
  try {
    const tr = await fetch(`${BRIDGE_URL}/v1/scribe-token`);
    if (!tr.ok) throw new Error((await tr.json().catch(() => ({}))).error || `token HTTP ${tr.status}`);
    token = (await tr.json()).token;
  } catch (err) {
    listenStatus(`token error: ${err.message}`);
    scheduleReconnect();
    return;
  }
  const qs = new URLSearchParams({
    model_id: "scribe_v2_realtime",
    audio_format: "pcm_16000",
    commit_strategy: "vad",
    token,
  });
  const ws = new WebSocket(`wss://api.elevenlabs.io/v1/speech-to-text/realtime?${qs}`);
  listenWS = ws;
  ws.onopen = () => {
    listenStatus("listening — speak naturally");
    el("listenBtn").textContent = "Stop listening";
    el("listenBtn").disabled = false;
    setOrb("idle");
  };
  ws.onmessage = (ev) => {
    let m;
    try { m = JSON.parse(ev.data); } catch { return; }
    if (m.message_type === "partial_transcript") {
      partialText = m.text || "";
      el("listenInterim").textContent = partialText || "…";
    } else if (m.message_type === "committed_transcript") {
      const t = (m.text || "").trim();
      if (t) {
        committedText = lastWords(`${committedText} ${t}`, KEEP_WORDS);
        fullTranscript = `${fullTranscript} ${t}`.slice(-TRANSCRIPT_KEEP_CHARS);
      }
      partialText = "";
      el("listenInterim").textContent = "…";
    } else if (m.message_type === "error" || m.message_type === "auth_error" || m.message_type === "quota_exceeded") {
      listenStatus(`error: ${m.error || m.message_type}`);
    }
  };
  ws.onerror = () => {};
  ws.onclose = () => {
    if (ws === listenWS) listenWS = null;
    if (listenActive) { listenStatus("reconnecting…"); scheduleReconnect(); }
  };
}

function scheduleReconnect() {
  if (!listenActive || reconnectTimer) return;
  reconnectTimer = setTimeout(() => { reconnectTimer = null; connectScribe(); }, 1200);
}

async function startListen() {
  if (!current || listenActive) return;
  listenActive = true;
  el("listenBtn").disabled = true;
  setOrb("thinking");
  listenStatus("starting mic…");
  try {
    await setupMic();
  } catch (err) {
    listenStatus(`mic error: ${err.message}`);
    listenActive = false;
    setOrb("idle");
    el("listenBtn").disabled = false;
    return;
  }
  briefLoop = setInterval(tickBrief, TICK_MS);
  connectScribe();
}

function stopListen() {
  listenActive = false;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (briefLoop) { clearInterval(briefLoop); briefLoop = null; }
  if (listenWS) { const ws = listenWS; listenWS = null; try { ws.close(); } catch {} }
  if (listenNodes) {
    try { listenNodes.processor.disconnect(); listenNodes.source.disconnect(); listenNodes.mute.disconnect(); } catch {}
    listenNodes = null;
  }
  if (listenCtx) { try { listenCtx.close(); } catch {} listenCtx = null; }
  if (listenStream) { listenStream.getTracks().forEach((t) => t.stop()); listenStream = null; }
  committedText = "";
  partialText = "";
  fullTranscript = "";
  lastBrief = null;
  lastQueryNorm = "";
  querying = false;
  const btn = el("listenBtn");
  if (btn) { btn.textContent = "Start listening"; btn.disabled = false; }
  el("listenInterim").textContent = "…";
  if (viewMode === "listen") listenStatus("Idle.");
}

function tickBrief() {
  if (querying || !listenActive) return;
  const window = lastWords(`${committedText} ${partialText}`, WINDOW_WORDS);
  const norm = normWords(window);
  if (norm.split(" ").filter(Boolean).length < 4) return;
  if (Date.now() - lastFireAt < MIN_QUERY_GAP_MS) return;
  if (norm === lastQueryNorm) return;
  if (lastQueryNorm && jaccard(norm, lastQueryNorm) > 0.85) return;
  fireBriefQuery(window, norm);
}

async function fireBriefQuery(window, norm) {
  querying = true;
  lastFireAt = Date.now();
  lastQueryNorm = norm;
  setOrb("thinking");
  el("briefMeta").textContent = "updating…";
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 14000); // > bridge brief timeout; just a stall guard
  try {
    const res = await fetch(`${BRIDGE_URL}/v1/brief`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: ctrl.signal,
      body: JSON.stringify({
        prospect: current.key,
        text: window,
        transcript: fullTranscript,
        prev: lastBrief,
        generative_model: selectedModel || undefined,
      }),
    });
    const data = await res.json();
    const b = data.brief;
    const hasContent =
      b &&
      ((b.summary && b.summary.trim()) ||
        (Array.isArray(b.key_points) && b.key_points.length) ||
        (b.caller_profile && b.caller_profile.trim()));
    if (hasContent) {
      updateBrief(b, data.citations || []);
      setOrb("speaking");
    } else {
      el("briefMeta").textContent = "listening… (nothing relevant yet)";
      setOrb("idle");
    }
  } catch {
    el("briefMeta").textContent = "listening…";
    setOrb("idle");
  } finally {
    clearTimeout(to);
    querying = false;
  }
}

function briefList(items, cls) {
  const arr = (items || []).filter((x) => x && String(x).trim());
  if (!arr.length) return "";
  return `<ul class="${cls}">${arr.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>`;
}
function hasItems(a) {
  return Array.isArray(a) && a.filter((x) => x && String(x).trim()).length;
}

function updateBrief(b, citations) {
  lastBrief = b;
  let html = "";
  if (b.topic && b.topic.trim()) html += `<div class="brief-topic">${escapeHtml(b.topic)}</div>`;

  const chips = [];
  if (b.their_goal && b.their_goal.trim()) chips.push(`<span class="persona-chip goal">🎯 ${escapeHtml(b.their_goal)}</span>`);
  if (b.stage && b.stage.trim()) chips.push(`<span class="persona-chip stage">${escapeHtml(b.stage)}</span>`);
  if (chips.length) html += `<div class="persona-row">${chips.join("")}</div>`;
  if (b.caller_profile && b.caller_profile.trim())
    html += `<div class="brief-profile">👤 ${escapeHtml(b.caller_profile)}</div>`;
  if (b.summary && b.summary.trim()) html += `<p class="brief-summary">${escapeHtml(b.summary)}</p>`;
  if (hasItems(b.key_points))
    html += `<div class="brief-section-label">Key points</div>` + briefList(b.key_points, "brief-points");
  if (hasItems(b.suggested_questions))
    html += `<div class="brief-section-label ask">Ask them</div>` + briefList(b.suggested_questions, "brief-suggest");
  if (hasItems(b.suggested_answers))
    html += `<div class="brief-section-label say">You could say</div>` + briefList(b.suggested_answers, "brief-suggest");
  el("briefBody").innerHTML = html || "<span class='hint'>Listening…</span>";

  for (const c of citations) {
    const key = (c.title || "").toLowerCase();
    if (!key) continue;
    const prev = briefSources.get(key);
    briefSources.set(key, {
      title: c.title,
      url: c.url,
      score: Math.max(c.score || 0, prev ? prev.score : 0),
      seen: Date.now(),
    });
  }
  const top = [...briefSources.values()].sort((a, b2) => b2.seen - a.seen).slice(0, 8);
  el("briefSources").innerHTML = top
    .map((c) => {
      const href = c.url ? escapeHtml(c.url) : "#";
      return `<a class="cite" href="${href}" target="_blank" rel="noopener">📄 ${escapeHtml(c.title)}</a>`;
    })
    .join("");
  el("briefMeta").textContent = "updated live";
}

// ---- metrics footer --------------------------------------------------------
async function pollMetrics() {
  try {
    const res = await fetch(`${BRIDGE_URL}/metrics`);
    if (!res.ok) throw new Error();
    const m = await res.json();
    el("mTurns").textContent = m.turns;
    el("mP50").textContent = `${m.latency_total_ms.p50}ms`;
    el("mP95").textContent = `${m.latency_total_ms.p95}ms`;
    el("mFt").textContent = `${m.latency_first_token_ms.p50}ms`;
    el("mHo").textContent = `${Math.round(m.handoff_rate * 100)}%`;
    el("mCov").textContent = `${Math.round(m.citation_coverage * 100)}%`;
    el("mBridge").textContent = "online";
    el("mBridge").style.color = "var(--ok)";
  } catch {
    el("mBridge").textContent = "offline";
    el("mBridge").style.color = "var(--bad)";
  }
}

// ---- wiring ----------------------------------------------------------------
for (const b of document.querySelectorAll("#modeToggle .seg")) {
  b.addEventListener("click", () => setMode(b.dataset.mode));
}
el("callBtn").addEventListener("click", () => (callConvo ? endCall() : startCall()));
el("muteBtn").addEventListener("click", toggleMute);
el("clearCall").addEventListener("click", () => (el("callLog").innerHTML = ""));
el("listenBtn").addEventListener("click", () => (listenActive ? stopListen() : startListen()));
el("model").addEventListener("change", (e) => (selectedModel = e.target.value));
el("voice").addEventListener("change", (e) => {
  selectedVoice = e.target.value;
  // The voice override applies at session start, so restart an active call to apply it.
  if (viewMode === "voice" && callConvo) { endCall(); startCall(); }
});

init();
setMode("voice");
pollMetrics();
setInterval(pollMetrics, METRICS_POLL_MS);
