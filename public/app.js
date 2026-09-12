// VoiceBridge console. Talks ONLY to /api/v1 — no secrets ever reach the browser.
import { api, esc, fmtMs, sse, toast } from "/ui/arag-ui.js";

const $ = (s) => document.querySelector(s);
const state = {
  prospects: [],
  current: null,
  selectedModel: "",
  selectedVoice: "",
  goldenClose: null,
};

// ── boot ─────────────────────────────────────────────────────────────────────
async function ensureSession() {
  try {
    await api("/api/v1/session", { method: "POST" });
  } catch {
    /* open API — the session is only needed for credential-minting routes */
  }
}

async function loadProspects() {
  const { items } = await api("/api/v1/prospects");
  state.prospects = items;
  $("#prospect").innerHTML = items
    .map((p) => `<option value="${esc(p.key)}">${esc(p.display_name)}</option>`)
    .join("");
  selectProspect(items[0]?.key);
}

function selectProspect(key) {
  state.current = state.prospects.find((p) => p.key === key) ?? null;
  if (!state.current) return;
  $("#prospect").value = state.current.key;
  $("#prospectGreeting").textContent = state.current.greeting;
  const qs = (state.current.golden_questions ?? []).filter((q) => q.expect === "answer").slice(0, 4);
  const off = (state.current.golden_questions ?? []).find((q) => q.expect === "handoff");
  const chips = [...qs, ...(off ? [off] : [])];
  $("#suggestions").innerHTML = chips
    .map((q) => `<button type="button" data-q="${esc(q.q)}">${esc(q.q)}</button>`)
    .join("");
  for (const b of $("#suggestions").querySelectorAll("button")) {
    b.addEventListener("click", () => {
      $("#question").value = b.dataset.q;
      ask();
    });
  }
  $("#question").value = chips[0]?.q ?? "";
  $("#voiceHelp").textContent = state.current.scribe_ready
    ? "The agent must allow voice overrides for this to apply."
    : "Needs an ElevenLabs key on the server.";
  loadModels();
  $("#goldenTable").querySelector("tbody").innerHTML = "";
  $("#goldenSummary").textContent = "";
  setChip("#goldenChip", "not run", "neutral");
}

// ── ASK (text turn tester) ───────────────────────────────────────────────────
function setSteps(states) {
  for (const li of $("#pipelineSteps").querySelectorAll("li")) {
    li.className = states[li.dataset.step] ?? "";
  }
}

async function ask() {
  const q = $("#question").value.trim();
  if (!q || !state.current) return;
  $("#ask").disabled = true;
  const box = $("#answers");
  box.insertAdjacentHTML(
    "beforeend",
    `<div class="arag-bubble user">${esc(q)}</div><div class="arag-bubble assistant" id="pending">Thinking…</div>`,
  );
  box.scrollTop = box.scrollHeight;
  try {
    const r = await api("/api/v1/voice-answer", {
      method: "POST",
      json: { prospect: state.current.key, question: q, history: [] },
    });
    const chips = r.citations
      .map((c) => `<span class="arag-cite" title="score ${c.score}">${esc(c.title)}</span>`)
      .join("");
    const badge = r.handoff
      ? `<span class="arag-chip warn">handoff · ${esc(r.handoff_reason ?? "")}</span>`
      : `<span class="arag-chip ok">answered</span>`;
    $("#pending").outerHTML =
      `<div class="arag-bubble assistant">${esc(r.answer)}<div class="vb-meta">${badge}${chips}` +
      `<span class="subtle">retrieve ${fmtMs(r.latency_ms.retrieve)} · first token ${fmtMs(r.latency_ms.first_token)} · total ${fmtMs(r.latency_ms.total)}</span></div></div>`;
    box.scrollTop = box.scrollHeight;
    $("#factHandoff").innerHTML = badge;
    $("#factCitations").textContent = String(r.citations.length);
    $("#factRetrieve").textContent = fmtMs(r.latency_ms.retrieve);
    $("#factFirst").textContent = fmtMs(r.latency_ms.first_token);
    $("#factTotal").textContent = fmtMs(r.latency_ms.total);
    const guard = [
      "empty-question",
      "question-too-long",
      "prompt-injection",
      "unsafe-request",
      "empty-output",
      "unspeakable-content",
    ].includes(r.handoff_reason);
    setSteps({
      "guard-in": guard ? "warn" : "ok",
      ask: guard ? "skip" : "ok",
      handoff: r.handoff ? "warn" : "ok",
      shape: r.handoff ? "skip" : "ok",
      cite: r.citations.length ? "ok" : "skip",
      "guard-out": r.handoff_reason === "unspeakable-content" ? "warn" : "ok",
    });
    pollMetrics();
  } catch (e) {
    $("#pending").outerHTML =
      `<div class="arag-bubble assistant"><span class="arag-chip danger">${esc(e.message)}</span></div>`;
  } finally {
    $("#ask").disabled = false;
  }
}

// ── model / voice pickers ────────────────────────────────────────────────────
async function loadModels() {
  const sel = $("#model");
  sel.innerHTML = '<option value="">Auto — fast default</option>';
  state.selectedModel = "";
  if (!state.current) return;
  try {
    const { models } = await api(`/api/v1/models?prospect=${encodeURIComponent(state.current.key)}`);
    const bar = (n, ch) => ch.repeat(Math.max(0, n)) + "·".repeat(Math.max(0, 3 - n));
    for (const m of models ?? []) {
      const o = document.createElement("option");
      o.value = m.id;
      o.textContent = `${m.label}   ${bar(m.speed, "⚡")} ${bar(m.quality, "★")} ${"$".repeat(m.price || 1)}`;
      sel.appendChild(o);
    }
    const prefer = ["gemini-2.5-flash-lite", "gemini-2.5-flash", "chatgpt4o-mini"].find((id) =>
      (models ?? []).some((m) => m.id === id),
    );
    if (prefer) {
      sel.value = prefer;
      state.selectedModel = prefer;
    }
  } catch {
    /* the picker degrades to "Auto" */
  }
}

async function loadVoices() {
  try {
    const { voices } = await api("/api/v1/voices");
    for (const v of voices ?? []) {
      const o = document.createElement("option");
      o.value = v.id;
      o.textContent = v.category && v.category !== "premade" ? `${v.name} ★` : v.name;
      $("#voice").appendChild(o);
    }
  } catch {
    /* 503 without an ElevenLabs key → just "Agent default" */
  }
}

// ── CALL (vendored @elevenlabs/client, pinned — never a runtime CDN import) ───
let callConvo = null;
let callMuted = false;
let callGen = 0;
let sdk = null;

function setChip(sel, text, kind) {
  const el = $(sel);
  el.textContent = text;
  el.className = `arag-chip ${kind}`;
}
function callStatus(msg) {
  $("#callStatus").textContent = msg;
}

async function loadSdk() {
  if (!sdk) sdk = await import("/vendor/elevenlabs-client.js");
  return sdk;
}

async function startCall(useVoiceOverride = true) {
  if (!state.current?.agent_id || /REPLACE_ME/.test(state.current.agent_id)) {
    callStatus(
      "No ElevenLabs agent configured for this prospect — use the Ask tab, or set agent_id in Admin.",
    );
    return;
  }
  if (callConvo) {
    const c = callConvo;
    callConvo = null;
    try {
      await c.endSession();
    } catch {}
  }
  const gen = ++callGen;
  const live = () => gen === callGen;
  const applyingVoice = Boolean(state.selectedVoice && useVoiceOverride);
  $("#callBtn").disabled = true;
  callStatus("connecting…");
  setChip("#callChip", "connecting", "info");
  const fallbackToDefault = () => {
    if (!live()) return;
    callStatus("custom voice needs the Voice ID override enabled on the agent — using the default voice");
    startCall(false);
  };
  try {
    const { Conversation } = await loadSdk();
    if (!live()) return;
    const opts = {
      agentId: state.current.agent_id,
      connectionType: "webrtc",
      onConnect: () => {
        if (!live()) return;
        $("#callBtn").textContent = "End call";
        $("#callBtn").disabled = false;
        $("#muteBtn").hidden = false;
        setChip("#callChip", "connected", "ok");
        callStatus("connected — listening");
      },
      onDisconnect: (details) => {
        const reason = details?.reason;
        const msg = details?.message || details?.closeReason || "";
        if (applyingVoice && (reason === "error" || /voice_id|override/i.test(msg)))
          return fallbackToDefault();
        if (!live()) return;
        callConvo = null;
        resetCallUI();
        if (reason === "error" && msg) callStatus(`disconnected: ${msg}`);
      },
      onModeChange: ({ mode }) => {
        if (!live()) return;
        setChip("#callChip", mode === "speaking" ? "agent speaking" : "listening", "ok");
      },
      onMessage: ({ message, source }) => live() && renderCallMessage(source, message),
      onError: (m) => {
        if (applyingVoice && /voice_id|override/i.test(String(m))) return fallbackToDefault();
        if (live()) callStatus(`error: ${m}`);
      },
    };
    if (applyingVoice) opts.overrides = { tts: { voiceId: state.selectedVoice } };
    const convo = await Conversation.startSession(opts);
    if (!live()) {
      try {
        await convo.endSession();
      } catch {}
      return;
    }
    callConvo = convo;
  } catch (err) {
    const msg = err?.message ?? String(err);
    if (applyingVoice && /voice_id|override/i.test(msg)) return fallbackToDefault();
    if (!live()) return;
    callStatus(`error: ${msg}`);
    setChip("#callChip", "error", "danger");
    $("#callBtn").disabled = false;
    callConvo = null;
  }
}

async function endCall() {
  callGen++;
  const c = callConvo;
  callConvo = null;
  if (c) {
    try {
      await c.endSession();
    } catch {}
  }
  resetCallUI();
}

function resetCallUI() {
  callMuted = false;
  $("#callBtn").textContent = "Start call";
  $("#callBtn").disabled = false;
  $("#muteBtn").hidden = true;
  $("#muteBtn").textContent = "Mute";
  setChip("#callChip", "idle", "neutral");
  callStatus("Ready.");
}

function renderCallMessage(source, text) {
  if (!text || !String(text).trim()) return;
  const who = source === "user" ? "You" : (state.current?.display_name ?? "Agent");
  $("#callLog").insertAdjacentHTML(
    "beforeend",
    `<div class="arag-bubble ${source === "user" ? "user" : "assistant"}"><b>${esc(who)}:</b> ${esc(text)}</div>`,
  );
  $("#callLog").scrollTop = $("#callLog").scrollHeight;
}

// ── LISTEN (Scribe realtime STT → evolving brief) ────────────────────────────
const listen = {
  active: false,
  ws: null,
  ctx: null,
  stream: null,
  nodes: null,
  inRate: 16000,
  reconnect: null,
  committed: "",
  partial: "",
  transcript: "",
  prev: null,
  querying: false,
  lastNorm: "",
  lastFire: 0,
  loop: null,
  sources: new Map(),
};
const WINDOW_WORDS = 28;
const KEEP_WORDS = 60;
const TRANSCRIPT_KEEP = 8000;
const MIN_GAP_MS = 1500;

const lastWords = (s, n) => (s || "").trim().split(/\s+/).filter(Boolean).slice(-n).join(" ");
const normWords = (s) =>
  (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
function jaccard(a, b) {
  const A = new Set(a.split(" ").filter(Boolean));
  const B = new Set(b.split(" ").filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}
function pcm16(input) {
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
  const len = Math.round(buffer.length / ratio);
  const result = new Float32Array(len);
  let o = 0;
  let b = 0;
  while (o < len) {
    const next = Math.round((o + 1) * ratio);
    let acc = 0;
    let cnt = 0;
    for (let i = b; i < next && i < buffer.length; i++) {
      acc += buffer[i];
      cnt++;
    }
    result[o++] = cnt ? acc / cnt : 0;
    b = next;
  }
  return result;
}
function toBase64(bytes) {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk)
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(bin);
}

async function setupMic() {
  listen.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  listen.ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (listen.ctx.state === "suspended") {
    try {
      await listen.ctx.resume();
    } catch {}
  }
  listen.inRate = listen.ctx.sampleRate;
  const source = listen.ctx.createMediaStreamSource(listen.stream);
  const processor = listen.ctx.createScriptProcessor(4096, 1, 1);
  const mute = listen.ctx.createGain();
  mute.gain.value = 0;
  source.connect(processor);
  processor.connect(mute);
  mute.connect(listen.ctx.destination);
  processor.onaudioprocess = (e) => {
    if (!listen.ws || listen.ws.readyState !== WebSocket.OPEN) return;
    const f32 = downsample(e.inputBuffer.getChannelData(0), listen.inRate, 16000);
    try {
      listen.ws.send(
        JSON.stringify({
          message_type: "input_audio_chunk",
          audio_base_64: toBase64(new Uint8Array(pcm16(f32).buffer)),
          commit: false,
        }),
      );
    } catch {}
  };
  listen.nodes = { source, processor, mute };
}

async function connectScribe() {
  if (!listen.active) return;
  $("#listenStatus").textContent = listen.ws ? "reconnecting…" : "connecting…";
  let token;
  try {
    token = (await api("/api/v1/scribe-token", { method: "POST" })).token;
  } catch (err) {
    $("#listenStatus").textContent = `token error: ${err.message}`;
    setChip("#listenChip", "unavailable", "warn");
    stopListen();
    return;
  }
  const qs = new URLSearchParams({
    model_id: "scribe_v2_realtime",
    audio_format: "pcm_16000",
    commit_strategy: "vad",
    token,
  });
  const ws = new WebSocket(`wss://api.elevenlabs.io/v1/speech-to-text/realtime?${qs}`);
  listen.ws = ws;
  ws.onopen = () => {
    $("#listenStatus").textContent = "listening — speak naturally";
    $("#listenBtn").textContent = "Stop listening";
    $("#listenBtn").disabled = false;
    setChip("#listenChip", "listening", "ok");
  };
  ws.onmessage = (ev) => {
    let m;
    try {
      m = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (m.message_type === "partial_transcript") {
      listen.partial = m.text || "";
      $("#listenInterim").textContent = listen.partial || "…";
    } else if (m.message_type === "committed_transcript") {
      const t = (m.text || "").trim();
      if (t) {
        listen.committed = lastWords(`${listen.committed} ${t}`, KEEP_WORDS);
        listen.transcript = `${listen.transcript} ${t}`.slice(-TRANSCRIPT_KEEP);
      }
      listen.partial = "";
      $("#listenInterim").textContent = "…";
    } else if (["error", "auth_error", "quota_exceeded"].includes(m.message_type)) {
      $("#listenStatus").textContent = `error: ${m.error || m.message_type}`;
    }
  };
  ws.onclose = () => {
    if (ws === listen.ws) listen.ws = null;
    if (listen.active && !listen.reconnect) {
      listen.reconnect = setTimeout(() => {
        listen.reconnect = null;
        connectScribe();
      }, 1200);
    }
  };
}

async function startListen() {
  if (listen.active || !state.current) return;
  listen.active = true;
  $("#listenBtn").disabled = true;
  $("#listenStatus").textContent = "starting mic…";
  try {
    await setupMic();
  } catch (err) {
    $("#listenStatus").textContent = `mic error: ${err.message}`;
    listen.active = false;
    $("#listenBtn").disabled = false;
    return;
  }
  listen.loop = setInterval(tickBrief, 600);
  connectScribe();
}

function stopListen() {
  listen.active = false;
  clearTimeout(listen.reconnect);
  listen.reconnect = null;
  clearInterval(listen.loop);
  listen.loop = null;
  if (listen.ws) {
    const ws = listen.ws;
    listen.ws = null;
    try {
      ws.close();
    } catch {}
  }
  if (listen.nodes) {
    for (const n of Object.values(listen.nodes)) {
      try {
        n.disconnect();
      } catch {}
    }
    listen.nodes = null;
  }
  if (listen.ctx) {
    try {
      listen.ctx.close();
    } catch {}
    listen.ctx = null;
  }
  if (listen.stream) {
    for (const t of listen.stream.getTracks()) t.stop();
    listen.stream = null;
  }
  Object.assign(listen, {
    committed: "",
    partial: "",
    transcript: "",
    prev: null,
    lastNorm: "",
    querying: false,
  });
  $("#listenBtn").textContent = "Start listening";
  $("#listenBtn").disabled = false;
  $("#listenInterim").textContent = "…";
  $("#listenStatus").textContent = "Idle.";
  setChip("#listenChip", "idle", "neutral");
}

function tickBrief() {
  if (listen.querying || !listen.active) return;
  const window = lastWords(`${listen.committed} ${listen.partial}`, WINDOW_WORDS);
  const norm = normWords(window);
  if (norm.split(" ").filter(Boolean).length < 4) return;
  if (Date.now() - listen.lastFire < MIN_GAP_MS) return;
  if (norm === listen.lastNorm) return;
  if (listen.lastNorm && jaccard(norm, listen.lastNorm) > 0.85) return;
  fireBrief(window, norm);
}

async function fireBrief(window, norm) {
  listen.querying = true;
  listen.lastFire = Date.now();
  listen.lastNorm = norm;
  $("#briefMeta").textContent = "updating…";
  try {
    const data = await api("/api/v1/brief", {
      method: "POST",
      json: {
        prospect: state.current.key,
        text: window,
        transcript: listen.transcript,
        prev: listen.prev ?? undefined,
        generative_model: state.selectedModel || undefined,
      },
    });
    if (data.brief && (data.brief.summary || data.brief.key_points?.length)) {
      renderBrief(data.brief, data.citations ?? []);
    } else {
      $("#briefMeta").textContent = "listening… (nothing relevant yet)";
    }
  } catch {
    $("#briefMeta").textContent = "listening…";
  } finally {
    listen.querying = false;
  }
}

function list(items, cls = "") {
  const arr = (items ?? []).filter((x) => x && String(x).trim());
  return arr.length ? `<ul class="${cls}">${arr.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "";
}

function renderBrief(b, citations) {
  listen.prev = b;
  let html = "";
  if (b.topic) html += `<div class="topic">${esc(b.topic)}</div>`;
  const chips = [];
  if (b.their_goal) chips.push(`<span class="arag-chip info">🎯 ${esc(b.their_goal)}</span>`);
  if (b.stage) chips.push(`<span class="arag-chip outline">${esc(b.stage)}</span>`);
  if (chips.length) html += `<div class="row">${chips.join("")}</div>`;
  if (b.caller_profile) html += `<div class="muted small">👤 ${esc(b.caller_profile)}</div>`;
  if (b.summary) html += `<p>${esc(b.summary)}</p>`;
  if (b.key_points?.length) html += `<div class="label">Key points</div>${list(b.key_points)}`;
  if (b.suggested_questions?.length)
    html += `<div class="label">Ask them</div>${list(b.suggested_questions)}`;
  if (b.suggested_answers?.length)
    html += `<div class="label">You could say</div>${list(b.suggested_answers)}`;
  if (b.recommended_products?.length)
    html += `<div class="label">Recommend</div>${list(b.recommended_products)}`;
  $("#briefBody").innerHTML = html || "<span class='muted'>Listening…</span>";
  $("#briefBody").classList.remove("muted");
  for (const c of citations) {
    if (c.title) listen.sources.set(c.title.toLowerCase(), { ...c, seen: Date.now() });
  }
  $("#briefSources").innerHTML = [...listen.sources.values()]
    .sort((a, b2) => b2.seen - a.seen)
    .slice(0, 8)
    .map((c) => `<span class="arag-cite">${esc(c.title)}</span>`)
    .join("");
  $("#briefMeta").textContent = "updated live";
}

// ── GOLDEN SET ───────────────────────────────────────────────────────────────
async function runGolden() {
  if (!state.current) return;
  showTab("golden");
  const rows = $("#goldenTable").querySelector("tbody");
  rows.innerHTML = "";
  $("#goldenSummary").textContent = "running…";
  setChip("#goldenChip", "running", "info");
  for (const b of [$("#runGolden"), $("#runGolden2")]) b.disabled = true;
  try {
    const { job } = await api("/api/v1/golden-evals", {
      method: "POST",
      json: { prospect: state.current.key },
    });
    const tl = $("#goldenTimeline");
    tl.job = job;
    state.goldenClose?.();
    state.goldenClose = sse(`/api/v1/jobs/${job.id}/events`, {
      event: (e) => tl.apply(e),
      job: async (j) => {
        const done = j.job ?? j;
        tl.job = done;
        if (["succeeded", "failed", "cancelled"].includes(done.status)) {
          state.goldenClose?.();
          state.goldenClose = null;
          for (const b of [$("#runGolden"), $("#runGolden2")]) b.disabled = false;
          await renderGolden(job.id);
          pollMetrics();
        }
      },
    });
  } catch (e) {
    toast(e.message, "error");
    $("#goldenSummary").textContent = e.message;
    setChip("#goldenChip", "error", "danger");
    for (const b of [$("#runGolden"), $("#runGolden2")]) b.disabled = false;
  }
}

async function renderGolden(jobId) {
  const r = await api(`/api/v1/golden-evals/${jobId}`);
  $("#goldenTable").querySelector("tbody").innerHTML = r.cases
    .map(
      (c) =>
        `<tr><td>${esc(c.q)}</td><td>${esc(c.expect)}</td><td>${
          c.passed
            ? '<span class="arag-chip ok">pass</span>'
            : `<span class="arag-chip danger">fail</span> <span class="subtle">${esc(
                c.checks
                  .filter((x) => !x.ok)
                  .map((x) => x.label)
                  .join("; "),
              )}</span>`
        }</td><td class="num">${c.latency_ms}</td></tr>`,
    )
    .join("");
  $("#goldenSummary").textContent =
    `${r.passed}/${r.total} passed · p50 ${r.latency_ms.p50} ms · p95 ${r.latency_ms.p95} ms`;
  setChip("#goldenChip", r.ok ? "gate open" : "gate closed", r.ok ? "ok" : "danger");
}

// ── metrics footer ───────────────────────────────────────────────────────────
async function pollMetrics() {
  try {
    const m = await api("/api/v1/metrics");
    $("#mTurns").textContent = m.turns;
    $("#mP50").textContent = `${m.latency_total_ms.p50} ms`;
    $("#mP95").textContent = `${m.latency_total_ms.p95} ms`;
    $("#mFt").textContent = `${m.latency_first_token_ms.p50} ms`;
    $("#mHo").textContent = `${Math.round(m.handoff_rate * 100)}%`;
    $("#mCov").textContent = `${Math.round(m.citation_coverage * 100)}%`;
    $("#mBridge").textContent = "online";
  } catch {
    $("#mBridge").textContent = "offline";
  }
}

// ── tabs + wiring ────────────────────────────────────────────────────────────
function showTab(name) {
  for (const t of document.querySelectorAll('#modeTabs [role="tab"]')) {
    t.setAttribute("aria-selected", String(t.dataset.tab === name));
  }
  for (const p of document.querySelectorAll("[data-panel]")) p.hidden = p.dataset.panel !== name;
  if (name !== "call") endCall();
  if (name !== "listen") stopListen();
}

for (const t of document.querySelectorAll('#modeTabs [role="tab"]')) {
  t.addEventListener("click", () => showTab(t.dataset.tab));
}
$("#prospect").addEventListener("change", (e) => selectProspect(e.target.value));
$("#ask").addEventListener("click", ask);
$("#question").addEventListener("keydown", (e) => e.key === "Enter" && ask());
$("#callBtn").addEventListener("click", () => (callConvo ? endCall() : startCall()));
$("#muteBtn").addEventListener("click", () => {
  if (!callConvo) return;
  callMuted = !callMuted;
  try {
    callConvo.setMicMuted(callMuted);
  } catch {}
  $("#muteBtn").textContent = callMuted ? "Unmute" : "Mute";
});
$("#clearCall").addEventListener("click", () => {
  $("#callLog").innerHTML = "";
});
$("#listenBtn").addEventListener("click", () => (listen.active ? stopListen() : startListen()));
$("#model").addEventListener("change", (e) => {
  state.selectedModel = e.target.value;
});
$("#voice").addEventListener("change", (e) => {
  state.selectedVoice = e.target.value;
  if (callConvo) {
    endCall();
    startCall();
  }
});
$("#runGolden").addEventListener("click", runGolden);
$("#runGolden2").addEventListener("click", runGolden);

await ensureSession();
await loadProspects().catch((e) => toast(e.message, "error"));
loadVoices();
pollMetrics();
setInterval(pollMetrics, 5000);
