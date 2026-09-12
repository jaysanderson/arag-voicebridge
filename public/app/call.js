// The voice-agent call tool. This is the follow-on capability, not the hero: it answers a caller
// directly when nobody is available. It lives in a drawer inside Live rather than as a top-level
// destination, because supporting the person on the call is the product.
//
// The agent runs on ElevenLabs and calls this service's POST /api/v1/voice-answer as a custom
// tool, so every spoken answer still comes from the Knowledge Box.
import { api, esc, icon, openDrawer, snippet, toast } from "./shell.js";

let convo = null;
let muted = false;
let gen = 0;
let sdk = null;

async function loadSdk() {
  if (!sdk) sdk = await import("/vendor/elevenlabs-client.js");
  return sdk;
}

const $ = (s) => document.querySelector(s);

function setChip(text, kind) {
  const el = $("#vbCallChip");
  if (!el) return;
  el.textContent = text;
  el.className = `arag-chip ${kind}`;
}

function say(msg) {
  const el = $("#vbCallStatus");
  if (el) el.textContent = msg;
}

function resetUi() {
  muted = false;
  const btn = $("#vbCallBtn");
  if (btn) {
    btn.textContent = "Start call";
    btn.disabled = false;
  }
  const mute = $("#vbCallMute");
  if (mute) {
    mute.hidden = true;
    mute.textContent = "Mute";
  }
  setChip("idle", "neutral");
  say("Ready.");
}

function renderMessage(source, text, prospect) {
  if (!text || !String(text).trim()) return;
  const who = source === "user" ? "You" : (prospect?.display_name ?? "Agent");
  const log = $("#vbCallLog");
  if (!log) return;
  log.insertAdjacentHTML(
    "beforeend",
    `<div class="arag-bubble ${source === "user" ? "user" : "assistant"}"><b>${esc(who)}:</b> ${esc(text)}</div>`,
  );
  log.scrollTop = log.scrollHeight;
}

async function endCall() {
  gen++;
  const c = convo;
  convo = null;
  if (c) {
    try {
      await c.endSession();
    } catch {
      /* already ended */
    }
  }
  resetUi();
}

async function startCall(prospect, voiceId, useVoiceOverride = true) {
  if (!prospect?.agent_id || /REPLACE_ME/.test(prospect.agent_id)) {
    say("No voice agent is configured for this prospect — set agent_id under Prospects.");
    return;
  }
  if (convo) {
    const c = convo;
    convo = null;
    try {
      await c.endSession();
    } catch {
      /* already ended */
    }
  }
  const mine = ++gen;
  const liveCall = () => mine === gen;
  const applyingVoice = Boolean(voiceId && useVoiceOverride);
  const btn = $("#vbCallBtn");
  if (btn) btn.disabled = true;
  say("Connecting…");
  setChip("connecting", "info");
  const fallback = () => {
    if (!liveCall()) return;
    say("That voice needs the Voice ID override enabled on the agent — using the default voice.");
    startCall(prospect, voiceId, false);
  };
  try {
    const { Conversation } = await loadSdk();
    if (!liveCall()) return;
    const opts = {
      agentId: prospect.agent_id,
      connectionType: "webrtc",
      onConnect: () => {
        if (!liveCall()) return;
        const b = $("#vbCallBtn");
        if (b) {
          b.textContent = "End call";
          b.disabled = false;
        }
        const m = $("#vbCallMute");
        if (m) m.hidden = false;
        setChip("connected", "ok");
        say("Connected — listening.");
      },
      onDisconnect: (details) => {
        const reason = details?.reason;
        const msg = details?.message || details?.closeReason || "";
        if (applyingVoice && (reason === "error" || /voice_id|override/i.test(msg))) return fallback();
        if (!liveCall()) return;
        convo = null;
        resetUi();
        if (reason === "error" && msg) say(`Disconnected: ${msg}`);
      },
      onModeChange: ({ mode }) => {
        if (liveCall()) setChip(mode === "speaking" ? "agent speaking" : "listening", "ok");
      },
      onMessage: ({ message, source }) => liveCall() && renderMessage(source, message, prospect),
      onError: (m) => {
        if (applyingVoice && /voice_id|override/i.test(String(m))) return fallback();
        if (liveCall()) say(`Error: ${m}`);
      },
    };
    if (applyingVoice) opts.overrides = { tts: { voiceId } };
    const started = await Conversation.startSession(opts);
    if (!liveCall()) {
      try {
        await started.endSession();
      } catch {
        /* superseded */
      }
      return;
    }
    convo = started;
  } catch (err) {
    const msg = err?.message ?? String(err);
    if (applyingVoice && /voice_id|override/i.test(msg)) return fallback();
    if (!liveCall()) return;
    say(`Error: ${msg}`);
    setChip("error", "danger");
    const b = $("#vbCallBtn");
    if (b) b.disabled = false;
    convo = null;
  }
}

/** Open the call tool for a prospect. */
export function openCallDrawer(prospect) {
  let voiceId = "";
  const close = openDrawer({
    title: "Start a voice call",
    sub: 'ElevenLabs Conversational AI <span class="vb-powered">Powered by ElevenLabs</span>',
    body: `
      <p class="muted">Speak to the agent and hear grounded answers back. The agent runs on
        ElevenLabs and calls this service's <code>/api/v1/voice-answer</code> as a custom server
        tool, so every spoken answer comes from the Knowledge Box, and it hands off by a fixed rule
        when the content cannot support an answer.</p>
      <div id="vbAgentCard"></div>
      <div class="arag-row" style="margin:16px 0 8px">
        <button class="arag-btn lg" id="vbCallBtn">Start call</button>
        <button class="arag-btn ghost" id="vbCallMute" hidden>Mute</button>
        <span class="spacer" style="flex:1"></span>
        <span id="vbCallChip" class="arag-chip neutral">idle</span>
      </div>
      <p class="muted small" id="vbCallStatus">Ready.</p>
      <div class="arag-field" style="margin-top:12px">
        <label for="vbCallVoice">Voice</label>
        <select id="vbCallVoice" class="arag-select"><option value="">Agent default</option></select>
        <span class="arag-help" id="vbVoiceHelp">Needs an ElevenLabs key on this deployment.</span>
      </div>
      <h3 style="margin-top:22px">Call transcript</h3>
      <div id="vbCallLog" class="arag-chat" style="min-height:160px"></div>`,
  });

  $("#vbCallBtn")?.addEventListener("click", () => (convo ? endCall() : startCall(prospect, voiceId)));
  $("#vbCallMute")?.addEventListener("click", () => {
    if (!convo) return;
    muted = !muted;
    try {
      convo.setMicMuted(muted);
    } catch {
      /* the SDK handles its own state */
    }
    const m = $("#vbCallMute");
    if (m) m.textContent = muted ? "Unmute" : "Mute";
  });
  $("#vbCallVoice")?.addEventListener("change", (e) => {
    voiceId = e.target.value;
    if (convo) {
      endCall().then(() => startCall(prospect, voiceId));
    }
  });

  if (prospect?.scribe_ready) {
    const help = $("#vbVoiceHelp");
    if (help) help.textContent = "The agent must allow voice overrides for this to apply.";
    api("/api/v1/voices")
      .then(({ voices }) => {
        const sel = $("#vbCallVoice");
        for (const v of voices ?? []) {
          const o = document.createElement("option");
          o.value = v.id;
          o.textContent = v.name;
          sel?.appendChild(o);
        }
      })
      .catch(() => undefined);
  }
  // Same test startCall applies, so the button is disabled for exactly the cases it would refuse.
  // The agent's own configuration, so an unwired prospect can be fixed from here rather than
  // from a document: the tool definition and router prompt are on the Settings view.
  api(`/api/v1/voice-agent?prospect=${encodeURIComponent(prospect?.key ?? "")}`)
    .then((cfg) => {
      const card = $("#vbAgentCard");
      if (!card) return;
      card.innerHTML = `<dl class="vb-kv" style="margin:14px 0">
          <dt>Provider</dt><dd>ElevenLabs Conversational AI</dd>
          <dt>Agent</dt><dd>${
            cfg.ready
              ? `<span class="vb-mono">${esc(cfg.agent_id)}</span>`
              : '<span class="arag-chip warn">not wired</span>'
          }</dd>
          <dt>Tool timeout</dt><dd>${cfg.tool.timeoutMs} ms</dd>
        </dl>
        <p class="muted small" style="margin:0 0 4px">Tool endpoint</p>
        ${snippet(`${cfg.tool.method} ${cfg.tool.url}`)}
        ${
          cfg.ready
            ? ""
            : '<p class="muted small">Set this prospect\'s <code>agent_id</code> under Prospects, then paste the tool definition and prompt from Settings into the ElevenLabs dashboard.</p>'
        }`;
    })
    .catch(() => undefined);

  if (!prospect?.agent_id || /REPLACE_ME/.test(prospect.agent_id)) {
    say("No voice agent is configured for this prospect — set agent_id under Prospects.");
    const b = $("#vbCallBtn");
    if (b) b.disabled = true;
  }

  return () => {
    endCall().catch(() => toast("Could not end the call cleanly", "error"));
    close();
  };
}

export { icon };
