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
let selectedModel = ""; // "" = KB default; otherwise an ARAG generative_model id
let selectedVoice = ""; // "" = agent default; otherwise an ElevenLabs voice_id (Call mode)

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
  stopAvatar(); // tear down any avatar session from the previous prospect
  stopListen();
  buildModeSwitch(current);
  setMode(defaultModeFor(current));
  mountVoice(current);
  loadModels(current);
}

// Populate the voice dropdown from the ElevenLabs account (voices are account-wide).
async function loadVoices() {
  const sel = el("voice");
  try {
    const res = await fetch(`${BRIDGE_URL}/v1/voices`);
    if (!res.ok) return; // 503 when no EL key — leave just "Agent default"
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

// Populate the model dropdown from the prospect's KB (its available generative models).
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
  } catch {
    /* leave just KB default */
  }
}

// Available modes for a prospect, in display order.
function modesFor(p) {
  const modes = [];
  if (p.agent_id) modes.push({ key: "voice", label: "Call" });
  if (p.scribe_ready) modes.push({ key: "listen", label: "Listen" });
  if (p.avatar_ready) modes.push({ key: "avatar", label: "Avatar" });
  if (modes.length === 0) modes.push({ key: "voice", label: "Call" }); // text-only fallback
  return modes;
}
function defaultModeFor(p) {
  return modesFor(p)[0].key;
}
function buildModeSwitch(p) {
  const modes = modesFor(p);
  const sw = el("modeSwitch");
  sw.innerHTML = modes
    .map((m) => `<button data-mode="${m.key}" class="seg">${m.label}</button>`)
    .join("");
  sw.hidden = modes.length < 2;
  for (const b of sw.querySelectorAll(".seg")) {
    b.addEventListener("click", () => setMode(b.dataset.mode));
  }
}

// ---- On-brand Call (ElevenLabs JS SDK, not the embed widget) ----------------
// We drive the conversation with @elevenlabs/client so the UI is our own (no floating
// launcher) and we can apply the voice override + stream the transcript into the panel.
let callConvo = null;
let callMuted = false;
let ElevenSDK = null;

async function loadSdk() {
  if (ElevenSDK) return ElevenSDK;
  ElevenSDK = await import("https://esm.sh/@elevenlabs/client@1.14.0");
  return ElevenSDK;
}

function hasRealAgent(p) {
  return p.agent_id && !/REPLACE_ME/i.test(p.agent_id);
}
function setConn(state, label) {
  el("connState").dataset.on = state === "ready" ? "true" : "false";
  el("connState").textContent = label;
}
function callStatus(msg) {
  const s = el("callStatus");
  if (s) s.textContent = msg;
}

function mountVoice(p) {
  const mount = el("voiceMount");
  endCall(); // tear down any active call when (re)mounting
  if (hasRealAgent(p)) {
    setConn("ready", "ready");
    mount.innerHTML =
      `<div class="call-pane">` +
      `<button id="callBtn" class="btn primary call-btn">📞 Start call</button>` +
      `<button id="muteBtn" class="btn ghost small" hidden>Mute</button>` +
      `<span class="hint" id="callStatus">Tap start and allow your mic to talk to ${escapeHtml(p.display_name)}.</span>` +
      `</div>` +
      `<p class="hint voice-caption">Answers are grounded in the knowledge base. The transcript ` +
      `appears in the panel and the live-metrics bar updates as the call runs.</p>`;
    el("callBtn").addEventListener("click", () => (callConvo ? endCall() : startCall()));
    el("muteBtn").addEventListener("click", toggleMute);
  } else {
    setConn("offline", "text mode");
    mount.innerHTML = `<p class="hint">No live <code>agent_id</code> for <b>${escapeHtml(
      p.display_name,
    )}</b> yet. Add one to the registry to enable the call. Meanwhile, use the ask box ` +
      `below — it drives the same bridge → ARAG path (the agent-assist “whisper” view).</p>`;
  }
}

async function startCall() {
  if (!current || !current.agent_id || callConvo) return;
  const btn = el("callBtn");
  btn.disabled = true;
  callStatus("connecting…");
  setOrb("thinking");
  try {
    const { Conversation } = await loadSdk();
    const opts = {
      agentId: current.agent_id,
      connectionType: "webrtc",
      onConnect: () => {
        btn.textContent = "End call";
        btn.disabled = false;
        el("muteBtn").hidden = false;
        callStatus("connected — listening");
        setConn("ready", "in call");
        setOrb("idle");
      },
      onDisconnect: () => { callConvo = null; resetCallUI(); },
      onStatusChange: ({ status }) => { if (status && status !== "connected") callStatus(status); },
      onModeChange: ({ mode }) => {
        setOrb(mode === "speaking" ? "speaking" : "idle");
        callStatus(mode === "speaking" ? "agent speaking…" : "listening…");
      },
      onMessage: ({ message, source }) => renderCallMessage(source, message),
      onError: (m) => callStatus(`error: ${m}`),
    };
    // Apply the selected voice (agent must allow the voice_id override).
    if (selectedVoice) opts.overrides = { tts: { voiceId: selectedVoice } };
    callConvo = await Conversation.startSession(opts);
  } catch (err) {
    callStatus(`error: ${err.message || err}`);
    setOrb("idle");
    btn.disabled = false;
    callConvo = null;
  }
}

async function endCall() {
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
  if (viewMode === "voice") { setOrb("idle"); callStatus("Ready."); setConn("ready", "ready"); }
}

function toggleMute() {
  if (!callConvo) return;
  callMuted = !callMuted;
  try { callConvo.setMicMuted(callMuted); } catch {}
  el("muteBtn").textContent = callMuted ? "Unmute" : "Mute";
}

// Stream the live call transcript into the panel.
function renderCallMessage(source, text) {
  if (!text || !String(text).trim()) return;
  const who = source === "user" ? "Caller" : (current ? current.display_name : "Agent");
  const div = document.createElement("div");
  div.className = `turn call-turn ${source === "user" ? "from-user" : "from-agent"}`;
  div.innerHTML = `<div class="q"><b>${escapeHtml(who)}:</b> ${escapeHtml(text)}</div>`;
  log.prepend(div);
}

// ---- Voice / Listen / Avatar mode switch -----------------------------------
let viewMode = "voice";
function setMode(mode) {
  viewMode = mode;
  for (const b of document.querySelectorAll("#modeSwitch .seg")) {
    b.classList.toggle("active", b.dataset.mode === mode);
  }
  el("voiceMount").hidden = mode !== "voice";
  el("avatarPane").hidden = mode !== "avatar";
  el("listenPane").hidden = mode !== "listen";
  if (mode !== "avatar") stopAvatar();
  if (mode !== "listen") stopListen();
}

// ---- LiveAvatar (HeyGen) video pane over LiveKit ---------------------------
let livekitPromise = null;
function ensureLiveKit() {
  if (livekitPromise) return livekitPromise;
  livekitPromise = new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/livekit-client/dist/livekit-client.umd.min.js";
    s.async = true;
    s.onload = () => resolve(window.LivekitClient || window.LiveKitClient || null);
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
  });
  return livekitPromise;
}

let avatarRoom = null;
function avatarStatus(msg) {
  el("avatarStatus").textContent = msg;
}

async function startAvatar() {
  if (!current || avatarRoom) return;
  el("avatarBtn").disabled = true;
  avatarStatus("connecting…");
  setOrb("thinking");
  try {
    const LK = await ensureLiveKit();
    if (!LK) throw new Error("LiveKit client failed to load");
    // 1. Ask the bridge to mint a room + viewer token and start the LiveAvatar session.
    const res = await fetch(`${BRIDGE_URL}/v1/avatar/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prospect: current.key }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error || `bridge HTTP ${res.status}`);
    }
    const { livekit_url, token } = await res.json();
    // 2. Join the room; attach the avatar's video/audio; publish our mic.
    const room = new LK.Room({ adaptiveStream: true, dynacast: true });
    avatarRoom = room;
    room.on(LK.RoomEvent.TrackSubscribed, (track) => {
      if (track.kind === "video" || track.kind === "audio") {
        track.attach(el("avatarVideo"));
        avatarStatus("live — talk to the avatar");
        setOrb("speaking");
      }
    });
    room.on(LK.RoomEvent.Disconnected, () => stopAvatar());
    await room.connect(livekit_url, token);
    await room.localParticipant.setMicrophoneEnabled(true);
    avatarStatus("connected — waiting for avatar…");
    el("avatarBtn").textContent = "End avatar call";
    el("avatarBtn").disabled = false;
  } catch (err) {
    avatarStatus(`error: ${err.message}`);
    el("avatarBtn").disabled = false;
    setOrb("idle");
    avatarRoom = null;
  }
}

function stopAvatar() {
  if (avatarRoom) {
    try { avatarRoom.disconnect(); } catch {}
    avatarRoom = null;
  }
  const v = el("avatarVideo");
  if (v) v.srcObject = null;
  const btn = el("avatarBtn");
  if (btn) { btn.textContent = "Start avatar call"; btn.disabled = false; }
  avatarStatus("Idle.");
  if (viewMode === "avatar") setOrb("idle");
}

// ---- Ambient "Listen" mode (Scribe STT → continuously updated live brief) ---
// Continuously transcribes and, off the ROLLING transcript (no waiting for you to pause),
// keeps a single live brief refreshed with the most relevant knowledge as you talk.
let listenActive = false; // intent: the user wants to be listening (survives WS reconnects)
let listenWS = null;
let listenCtx = null;
let listenStream = null;
let listenNodes = null;
let listenInRate = 16000;
let reconnectTimer = null;
let committedText = "";
let partialText = "";
let fullTranscript = ""; // the whole conversation so far (for context/persona)
let lastBrief = null; // previous brief object, fed back so the model builds it up
let querying = false;
let lastQueryNorm = "";
let lastFireAt = 0;
let briefLoop = null;
const briefSources = new Map();

const WINDOW_WORDS = 28; // size of the rolling window used for retrieval ("now")
const KEEP_WORDS = 60; // committed-buffer cap
const TRANSCRIPT_KEEP_CHARS = 8000; // running transcript cap
const MIN_QUERY_GAP_MS = 1500; // don't fire faster than ARAG can answer
const TICK_MS = 600; // how often we consider refreshing

function listenStatus(msg) {
  el("listenStatus").textContent = msg;
}
function lastWords(str, n) {
  const w = (str || "").trim().split(/\s+/).filter(Boolean);
  return w.slice(-n).join(" ");
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
    for (let i = oB; i < next && i < buffer.length; i++) {
      acc += buffer[i];
      cnt++;
    }
    result[oR++] = cnt ? acc / cnt : 0;
    oB = next;
  }
  return result;
}
function bytesToBase64(bytes) {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

// Mic is set up ONCE and kept alive across WebSocket reconnects.
async function setupMic() {
  listenStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  listenCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (listenCtx.state === "suspended") { try { await listenCtx.resume(); } catch {} }
  listenInRate = listenCtx.sampleRate;
  const source = listenCtx.createMediaStreamSource(listenStream);
  const processor = listenCtx.createScriptProcessor(4096, 1, 1);
  const mute = listenCtx.createGain();
  mute.gain.value = 0; // avoid echoing the mic to the speakers
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
      /* socket mid-close; chunk dropped, fine */
    }
  };
  listenNodes = { source, processor, mute };
}

// (Re)connect the Scribe WebSocket. Auto-reconnects on drop while listenActive.
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
    if (listenActive) { listenStatus("reconnecting…"); scheduleReconnect(); } // keep the session alive
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
  briefLoop = setInterval(tickBrief, TICK_MS); // keeps refreshing across reconnects
  connectScribe();
}

function stopListen() {
  listenActive = false;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (briefLoop) { clearInterval(briefLoop); briefLoop = null; }
  if (listenWS) {
    const ws = listenWS;
    listenWS = null;
    try { ws.close(); } catch {}
  }
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

// Runs on a timer while listening: refresh the brief off the rolling transcript window.
// Fires WHILE you're still talking (uses partials), not only when you pause.
function tickBrief() {
  if (querying || !listenActive) return; // keep refreshing even during a brief WS reconnect
  const window = lastWords(`${committedText} ${partialText}`, WINDOW_WORDS);
  const norm = normWords(window);
  if (norm.split(" ").filter(Boolean).length < 4) return; // need a little context
  if (Date.now() - lastFireAt < MIN_QUERY_GAP_MS) return; // rate-limit to ARAG's pace
  if (norm === lastQueryNorm) return; // nothing new said
  if (lastQueryNorm && jaccard(norm, lastQueryNorm) > 0.85) return; // not enough changed
  fireBriefQuery(window, norm);
}

async function fireBriefQuery(window, norm) {
  querying = true;
  lastFireAt = Date.now();
  lastQueryNorm = norm;
  setOrb("thinking");
  el("briefMeta").textContent = "updating…";
  try {
    // Structured: ARAG returns a JSON brief (answer_json_schema), not a text blob.
    const res = await fetch(`${BRIDGE_URL}/v1/brief`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prospect: current.key,
        text: window,
        transcript: fullTranscript, // whole conversation → context + persona
        prev: lastBrief, // previous brief → build it up, don't restart
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

// Render the evolving call brief IN PLACE; accumulate a deduped source rail.
function updateBrief(b, citations) {
  lastBrief = b; // remember it so the next refresh builds on it
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
        generative_model: selectedModel || undefined,
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
el("model").addEventListener("change", (e) => (selectedModel = e.target.value));
el("voice").addEventListener("change", (e) => {
  selectedVoice = e.target.value;
  // The voice override applies at session start, so restart an active call to apply it.
  if (viewMode === "voice" && current && current.agent_id) {
    const wasInCall = !!callConvo;
    mountVoice(current); // ends any active call + rebuilds the controls
    if (wasInCall) startCall();
  }
});
el("askForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const v = el("askInput").value.trim();
  if (!v) return;
  el("askInput").value = "";
  ask(v);
});
el("runGolden").addEventListener("click", runGolden);
el("clearLog").addEventListener("click", () => (log.innerHTML = ""));
// Mode-switch segments get their listeners in buildModeSwitch() per prospect.
el("avatarBtn").addEventListener("click", () => (avatarRoom ? stopAvatar() : startAvatar()));
el("listenBtn").addEventListener("click", () => (listenWS ? stopListen() : startListen()));

loadProspects();
loadVoices();
pollMetrics();
setInterval(pollMetrics, METRICS_POLL_MS);
