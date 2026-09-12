// Live — the hero workspace. A conversation goes in from whatever source you have; one evolving,
// cited brief comes back and stays on screen. The brief is the main pane; the transcript, the
// session stats and the controls sit alongside it.
//
// Everything about throttling, the brief itself and the citation list lives on the server
// (src/services/listen.ts). This view feeds a session and renders what comes back.
import { sse } from "/ui/arag-ui.js";
import { renderBrief } from "./brief.js";
import { openCallDrawer } from "./call.js";
import { Microphone } from "./mic.js";
import {
  ago,
  api,
  boot,
  citeChip,
  empty,
  esc,
  fmtMs,
  icon,
  mountShell,
  openDrawer,
  prospectSwitcher,
  snippet,
  state,
  toast,
} from "./shell.js";

const ONBOARDED = "vb.onboarded";

/** A scripted discovery call, so the hero path works with no microphone and no credentials. */
const SAMPLE = [
  { speaker: "agent", text: "Thanks for taking the call — what are you making at the moment?" },
  {
    speaker: "caller",
    text: "We run a machine shop. Mostly stainless steel brackets and manifolds, a few hundred a week.",
  },
  {
    speaker: "caller",
    text: "We are looking at metal 3D printing because machining the manifolds is slow and wasteful.",
  },
  {
    speaker: "agent",
    text: "Have you looked at binder jetting, or were you thinking laser powder bed fusion?",
  },
  {
    speaker: "caller",
    text: "Binder jetting, I think. Somebody mentioned the Desktop Metal Shop System to us.",
  },
  {
    speaker: "caller",
    text: "What I do not understand is what happens after the printer. Is there a separate furnace?",
  },
  { speaker: "agent", text: "There is — debinding and sintering. Let me check what the furnace supports." },
  {
    speaker: "caller",
    text: "We would need stainless steel today, and titanium later for an aerospace customer.",
  },
  {
    speaker: "caller",
    text: "And honestly the budget matters. We cannot put in a whole new facility this year.",
  },
];

const live = {
  sessionId: null,
  status: "idle",
  closeSse: null,
  poll: null,
  sample: null,
  version: 0,
  stale: false,
  mic: null,
  models: [],
  model: "",
  session: null,
  /** ElevenLabs: Scribe transcription state, and the opt-in spoken cue. */
  scribe: { state: "idle", latencyMs: 0, language: "", model: "scribe_v2_realtime" },
  speak: false,
  spokenVersion: 0,
  audio: null,
};

const $ = (s) => document.querySelector(s);

// ── rendering ────────────────────────────────────────────────────────────────

function view() {
  const first = !localStorage.getItem(ONBOARDED);
  return `
    ${first ? onboarding() : ""}
    <div class="vb-live">
      <section class="vb-brief-card">
        <header>
          <h2>Brief</h2>
          <span id="vbBriefState" class="arag-chip neutral">no session</span>
          <span class="spacer"></span>
          <span id="vbBriefMeta" class="muted small"></span>
        </header>
        <div class="vb-brief-body" id="vbBrief"></div>
        <div class="vb-sources" id="vbSources" hidden>
          <span class="vb-sources-label">Sources used so far</span>
        </div>
      </section>

      <div class="vb-side">
        <section class="vb-card" id="vbSessionCard">
          <header>
            <h3>Session</h3>
            <span class="spacer"></span>
            <span id="vbSessionChip" class="arag-chip neutral">not started</span>
          </header>
          <div class="vb-card-body" id="vbSessionBody"></div>
        </section>

        <section class="vb-card">
          <header>
            <h3>Transcript</h3>
            <span class="spacer"></span>
            <span id="vbTranscriptCount" class="muted small"></span>
          </header>
          <div class="vb-card-body">
            <div id="vbInterim" class="muted small" hidden></div>
            <div class="vb-transcript" id="vbTranscript"></div>
          </div>
        </section>
      </div>
    </div>`;
}

function onboarding() {
  return `<section class="vb-onboard" id="vbOnboard">
    <div>
      <h2>The right answer, while you are still talking</h2>
      <p class="muted">This listens as a conversation moves and keeps one short, evolving brief on
        screen: who you are speaking to, what they want, and what to say next — with a source behind
        every fact. Start with the sample call; it runs the real pipeline against the sample
        Knowledge Box.</p>
      <ol class="vb-steps">
        <li><span>Start a session from a microphone, your telephony webhook, or typed text.</span></li>
        <li><span>Watch the brief rewrite itself as the conversation develops, sources gathering underneath.</span></li>
        <li><span>End the session — the brief, its sources and how it developed are kept in Conversations.</span></li>
      </ol>
      <div class="vb-chip-row" style="margin-top:16px">
        <button class="arag-btn lg" id="vbSampleOnboard">${icon("play", 16)} Play sample conversation</button>
        <button class="arag-btn ghost" id="vbDismissOnboard">Skip</button>
      </div>
    </div>
    <aside class="vb-aside">
      <strong>What it will not do</strong>
      <div><span class="vb-tick">${icon("check", 13)}</span> It never speaks — nothing is injected into the call.</div>
      <div><span class="vb-tick">${icon("check", 13)}</span> Facts come only from your approved content.</div>
      <div><span class="vb-tick">${icon("check", 13)}</span> A failed refresh leaves the last good brief in place.</div>
    </aside>
  </section>`;
}

/**
 * The idle state of the main pane: the brief has nothing to show yet, so the space teaches what
 * it will show and offers the three ways to start feeding it.
 */
function starter() {
  const scribe = state.current?.scribe_ready;
  return `
    ${empty({
      icon: "live",
      title: "The brief appears here",
      body:
        "Start a session and it keeps rewriting itself as the conversation moves — topic, who you " +
        "are speaking to, what they want, what to ask and what to say, with the sources underneath.",
    })}
    <div class="vb-starter">
      <div class="vb-starter-head">
        <span class="label">Start listening from</span>
        ${
          localStorage.getItem(ONBOARDED)
            ? `<button class="arag-btn" id="vbSample">${icon("play", 15)} Play sample conversation</button>`
            : ""
        }
      </div>
      <div class="vb-sources-picker">
        <button class="vb-source-option" id="vbMic" ${scribe ? "" : "disabled"}>
          <span class="vb-source-icon">${icon("mic", 17)}</span>
          <strong class="vb-source-title">Microphone</strong>
          <span class="vb-source-desc">${
            scribe
              ? "Transcribed by ElevenLabs Scribe v2 Realtime and fed straight into the session."
              : "Needs an ElevenLabs key on this deployment."
          }</span>
          <span class="vb-powered">Powered by ElevenLabs</span>
        </button>
        <button class="vb-source-option" id="vbWebhook">
          <span class="vb-source-icon">${icon("webhook", 17)}</span>
          <strong class="vb-source-title">Telephony webhook</strong>
          <span class="vb-source-desc">Post transcript chunks from your phone system, meeting bot or speech service.</span>
          <span class="vb-powered muted">Vendor-neutral</span>
        </button>
        <button class="vb-source-option" id="vbTypeHere">
          <span class="vb-source-icon">${icon("keyboard", 17)}</span>
          <strong class="vb-source-title">Typed or pasted</strong>
          <span class="vb-source-desc">Paste a real transcript and see what the brief would have shown.</span>
          <span class="vb-powered muted">Vendor-neutral</span>
        </button>
      </div>
    </div>`;
}

/** The idle state of the session card: send conversation by hand, and pick the brief's model. */
function idlePanel() {
  return `
    <p class="muted small" style="margin:0 0 4px">No session yet. Pick a source, or type a
      conversation below and one starts on the first line you send.</p>
    ${typedBox()}
    <div class="arag-field" style="margin-top:14px">
      <label for="vbModel">Brief model</label>
      <select id="vbModel" class="arag-select"><option value="">Auto — fast default</option></select>
      <span class="arag-help">The brief runs alongside a live conversation, so speed matters more than eloquence.</span>
    </div>`;
}

/**
 * What the transcription is doing right now. VoiceBridge does not transcribe — ElevenLabs Scribe
 * does — so the product says which model, in what language, and how long the last words took to
 * become final. That number is what decides whether the brief can keep up.
 */
function scribeStrip() {
  const s = live.scribe;
  const tone =
    s.state === "connected" ? "ok" : s.state === "error" ? "danger" : s.state === "idle" ? "neutral" : "info";
  return `<div class="vb-scribe">
    <div class="vb-scribe-head">
      <span class="arag-chip ${tone}">${s.state === "connected" ? '<span class="vb-live-dot" style="margin-right:5px"></span>' : ""}${esc(s.state)}</span>
      <span class="label">Transcription: ElevenLabs Scribe</span>
    </div>
    <dl class="vb-kv">
      <dt>Model</dt><dd class="vb-mono">${esc(s.model)}</dd>
      <dt>Language</dt><dd>${esc(s.language || "detecting…")}</dd>
      <dt>Last final</dt><dd>${s.latencyMs ? esc(fmtMs(s.latencyMs)) : "—"}</dd>
    </dl>
  </div>`;
}

/** The optional spoken cue. Off by default, and never audible to the caller. */
function speakToggle() {
  if (!state.current?.scribe_ready) return "";
  return `<label class="arag-switch" style="margin-top:14px">
      <input type="checkbox" id="vbSpeak" ${live.speak ? "checked" : ""} />
      <span>Read the next line aloud <span class="vb-powered">Powered by ElevenLabs</span></span>
    </label>
    <p class="arag-help">Spoken into your own ear as each brief lands — nothing is ever injected into
      the conversation.</p>`;
}

function typedBox() {
  return `<div class="arag-field" style="margin-top:14px">
      <label for="vbTyped">Conversation</label>
      <textarea id="vbTyped" class="arag-textarea" rows="3"
        placeholder="caller: we print stainless steel brackets and the sintering step is our bottleneck&#10;agent: how many parts a week are you running?"></textarea>
      <span class="arag-help">One line per turn. Prefix with <code>caller:</code> or <code>agent:</code> to label the speaker.</span>
    </div>
    <div class="arag-row">
      <button class="arag-btn" id="vbSend">Send to session</button>
      <span id="vbSendHint" class="muted small"></span>
    </div>`;
}

/** The running state of the session card: what is happening, the stats, and how to stop. */
function runningPanel(s) {
  const ended = s.status === "ended";
  return `
    <div class="vb-chip-row" style="margin-bottom:12px">
      ${
        ended
          ? ""
          : `<button class="arag-btn secondary sm" id="vbMicToggle" ${
              state.current?.scribe_ready ? "" : 'disabled title="Needs an ElevenLabs key on this deployment"'
            }>${icon("mic", 14)} ${live.mic?.active ? "Stop microphone" : "Microphone"}</button>`
      }
      ${ended ? "" : `<button class="arag-btn ghost sm" id="vbSample">${icon("play", 14)} ${live.sample ? "Stop sample" : "Play sample"}</button>`}
      ${
        ended
          ? `<a class="arag-btn secondary sm" href="/conversations/#${esc(s.id)}">Open in Conversations</a>
             <button class="arag-btn sm" id="vbNew">Start another session</button>`
          : `<button class="arag-btn ghost sm danger" id="vbEnd">${icon("end", 14)} End and save</button>`
      }
    </div>
    <p class="muted small" id="vbStatus"></p>
    ${ended ? "" : `<div id="vbScribe" hidden>${scribeStrip()}</div>`}
    ${ended ? "" : speakToggle()}
    ${ended ? "" : typedBox()}
    <dl class="vb-kv" id="vbStats" style="margin-top:14px"></dl>`;
}

function renderStats(s) {
  const el = $("#vbStats");
  if (!el || !s) return;
  el.innerHTML = `
    <dt>Session</dt><dd class="vb-mono">${esc(s.id.slice(0, 8))}</dd>
    <dt>Started</dt><dd>${ago(s.createdAt)}</dd>
    <dt>Turns heard</dt><dd>${s.stats.chunks}</dd>
    <dt>Brief refreshes</dt><dd>${s.stats.refreshes}</dd>
    <dt>Skipped by throttle</dt><dd>${s.stats.skipped}</dd>
    <dt>Last refresh</dt><dd>${s.stats.lastLatencyMs ? fmtMs(s.stats.lastLatencyMs) : "—"}</dd>
    <dt>p50 / p95</dt><dd>${s.stats.p50LatencyMs ? `${fmtMs(s.stats.p50LatencyMs)} / ${fmtMs(s.stats.p95LatencyMs)}` : "—"}</dd>`;
}

function renderTranscript(entries, total) {
  const el = $("#vbTranscript");
  if (!el) return;
  if (!entries?.length) {
    el.innerHTML = `<p class="muted small" style="margin:0">Nothing heard yet.</p>`;
    return;
  }
  el.innerHTML = entries
    .map(
      (t) =>
        `<div class="line ${esc(t.speaker)}${t.final ? "" : " interim"}">` +
        `<span class="who">${esc(t.speaker)}</span><span>${esc(t.text)}</span></div>`,
    )
    .join("");
  el.scrollTop = el.scrollHeight;
  $("#vbTranscriptCount").textContent = `${total ?? entries.length} turns`;
}

/**
 * Speak the one line the handler could say next (ElevenLabs text-to-speech). Opt-in, one cue per
 * brief version, and a failure is silent — a spoken cue is a convenience, never a dependency.
 */
async function speakCue(brief, version) {
  if (!live.speak || !brief || version <= live.spokenVersion) return;
  live.spokenVersion = version;
  const text = cueFrom(brief);
  if (!text) return;
  try {
    const res = await fetch("/api/v1/speech", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ text, prospect: state.current?.key }),
    });
    if (!res.ok) {
      if (res.status === 503) {
        live.speak = false;
        const box = document.getElementById("vbSpeak");
        if (box) box.checked = false;
        toast("Reading aloud needs an ElevenLabs key on this deployment", "error");
      }
      return;
    }
    const url = URL.createObjectURL(await res.blob());
    live.audio?.pause();
    live.audio = new Audio(url);
    live.audio.onended = () => URL.revokeObjectURL(url);
    await live.audio.play();
  } catch {
    /* a cue that cannot be spoken is simply not spoken */
  }
}

/** The single line worth hearing: what to say next, or failing that, what to ask. */
function cueFrom(brief) {
  const b = brief ?? {};
  const first = (k) =>
    (Array.isArray(b[k]) ? b[k] : []).map((x) => String(x ?? "").trim()).find(Boolean) ?? "";
  return (first("suggested_answers") || first("suggested_questions")).slice(0, 420);
}

function renderBriefPane(brief, citations, version) {
  const body = $("#vbBrief");
  const html = renderBrief(brief);
  if (!html) return;
  live.version = version ?? live.version;
  live.stale = false;
  body.innerHTML = `<div class="vb-brief">${html}</div>`;
  const sources = $("#vbSources");
  const chips = (citations ?? []).map(citeChip).join("");
  sources.hidden = !chips;
  sources.innerHTML = `<span class="vb-sources-label">Sources used so far</span>${chips}`;
  setBriefMeta();
  void speakCue(brief, live.version);
}

/**
 * The freshness line beside the brief. A refresh that found nothing, or failed, is staleness —
 * never an error, never a toast, and never an empty pane. The retry is offered rather than taken
 * automatically, because the alternative (appending transcript) would fabricate words nobody said.
 */
function setBriefMeta(note = "") {
  const meta = $("#vbBriefMeta");
  if (!meta) return;
  const v = live.version ? `<span class="version">v${live.version}</span>` : "";
  if (live.stale) {
    meta.innerHTML =
      `<span class="vb-stale">${icon("clock", 12)} showing the last good brief</span>` +
      `<button class="arag-btn ghost sm" id="vbRetry" type="button">Retry now</button>${v ? ` ${v}` : ""}`;
    $("#vbRetry")?.addEventListener("click", retryRefresh);
    return;
  }
  meta.innerHTML = note ? `${esc(note)}${v ? ` · ${v}` : ""}` : v ? `updated live · ${v}` : "";
}

/** Ask the server for one more refresh of the same conversation. */
async function retryRefresh() {
  if (!live.sessionId) return;
  const btn = $("#vbRetry");
  if (btn) btn.disabled = true;
  setBriefMeta("refreshing…");
  try {
    const s = await api(`/api/v1/listen/sessions/${live.sessionId}/refresh`, { method: "POST" });
    live.session = s;
    renderStats(s);
    if (s.brief && s.briefVersion > live.version) renderBriefPane(s.brief, s.citations, s.briefVersion);
    else {
      live.stale = live.version > 0;
      setBriefMeta();
    }
  } catch {
    live.stale = live.version > 0;
    setBriefMeta();
  }
}

/** The main pane while a session is open but has produced nothing yet. */
function briefPlaceholder() {
  $("#vbBrief").innerHTML = empty({
    icon: "live",
    title: "Listening",
    body:
      "The brief appears as soon as there is enough conversation to ground it. A refresh that finds " +
      "nothing leaves what is on screen alone rather than blanking it.",
  });
}

function setSessionChip(text, kind) {
  const el = $("#vbSessionChip");
  if (el) el.className = `arag-chip ${kind}`;
  if (el) el.textContent = text;
  const bs = $("#vbBriefState");
  if (bs) {
    bs.className = `arag-chip ${kind}`;
    bs.innerHTML =
      kind === "ok" ? `<span class="vb-live-dot" style="margin-right:6px"></span>${esc(text)}` : esc(text);
  }
}

function status(msg) {
  const el = $("#vbStatus");
  if (el) el.textContent = msg;
}

// ── session lifecycle ────────────────────────────────────────────────────────

async function ensureSession() {
  if (live.sessionId) return live.sessionId;
  if (!state.current) throw new Error("No prospect is configured for this deployment.");
  const s = await api("/api/v1/listen/sessions", {
    method: "POST",
    json: { prospect: state.current.key, generative_model: live.model || undefined },
  });
  live.sessionId = s.id;
  live.session = s;
  live.version = 0;
  live.stale = false;
  $("#vbSessionBody").innerHTML = runningPanel(s);
  wireRunning();
  setSessionChip("listening", "ok");
  status("Session open. Everything you send is transcript for this call.");
  renderStats(s);
  renderTranscript([], 0);
  briefPlaceholder();

  live.closeSse?.();
  live.closeSse = sse(`/api/v1/listen/sessions/${s.id}/events`, {
    brief: (e) => {
      if (e.brief) renderBriefPane(e.brief, e.citations ?? [], e.version);
      if (e.stats) renderStats({ ...live.session, id: s.id, stats: e.stats });
    },
    transcript: (e) => {
      if (e.stats) renderStats({ ...live.session, id: s.id, stats: e.stats });
      syncSession();
    },
    status: (e) => {
      if (e.status === "refreshing") setBriefMeta("refreshing…");
      // A refresh that found nothing, or failed, must never blank the brief: say so quietly.
      if (e.status === "skipped") {
        live.stale = live.version > 0;
        setBriefMeta(live.version ? "" : "listening…");
      }
      if (e.status === "ended") setSessionChip("ended", "neutral");
    },
  });
  clearInterval(live.poll);
  live.poll = setInterval(syncSession, 3000);
  return s.id;
}

async function syncSession() {
  if (!live.sessionId) return;
  try {
    const s = await api(`/api/v1/listen/sessions/${live.sessionId}?transcript_tail=40`);
    live.session = s;
    renderTranscript(s.transcript, s.transcriptTotal);
    renderStats(s);
    if (s.brief && s.briefVersion > live.version) renderBriefPane(s.brief, s.citations, s.briefVersion);
  } catch {
    /* transient — the next event or poll catches up */
  }
}

async function sendChunks(chunks) {
  const id = await ensureSession();
  const out = await api(`/api/v1/listen/sessions/${id}/transcript`, { method: "POST", json: { chunks } });
  const hint = $("#vbSendHint");
  if (hint) {
    hint.textContent =
      out.refresh === "started"
        ? "brief refreshing…"
        : out.refresh === "scheduled"
          ? "queued (throttled)"
          : `skipped (${out.reason})`;
  }
  live.session = out.session;
  renderStats(out.session);
  renderTranscript(out.session.transcript, out.session.transcriptTotal);
  setTimeout(syncSession, 700);
  return out;
}

async function endSession() {
  if (!live.sessionId) return;
  stopSample();
  live.mic?.stop();
  let ended = null;
  try {
    ended = await api(`/api/v1/listen/sessions/${live.sessionId}`, { method: "DELETE" });
  } catch {
    /* already gone */
  }
  live.closeSse?.();
  live.closeSse = null;
  clearInterval(live.poll);
  live.poll = null;
  const id = live.sessionId;
  live.sessionId = null;
  setSessionChip("ended", "neutral");
  $("#vbSessionBody").innerHTML = runningPanel({ ...(ended ?? live.session), id, status: "ended" });
  wireRunning();
  status("Session saved. The brief above is its final state.");
  renderStats(ended ?? live.session);
}

function resetToIdle() {
  live.sessionId = null;
  live.version = 0;
  live.stale = false;
  live.session = null;
  setSessionChip("not started", "neutral");
  $("#vbSessionBody").innerHTML = idlePanel();
  $("#vbBrief").innerHTML = starter();
  wireIdle();
  loadModels();
  renderTranscript([], 0);
  $("#vbSources").hidden = true;
  setBriefMeta();
}

// ── sources ──────────────────────────────────────────────────────────────────

function stopSample() {
  if (live.sample) {
    clearTimeout(live.sample);
    live.sample = null;
  }
  const btn = $("#vbSample");
  if (btn) btn.innerHTML = `${icon("play", 14)} Play sample`;
}

async function playSample() {
  if (live.sample) {
    stopSample();
    status("Sample paused.");
    return;
  }
  localStorage.setItem(ONBOARDED, "1");
  document.getElementById("vbOnboard")?.remove();
  const btn0 = $("#vbSample");
  if (btn0) btn0.innerHTML = `${icon("stop", 14)} Stop sample`;
  status("Playing a sample discovery call…");
  let i = 0;
  const step = async () => {
    if (i >= SAMPLE.length) {
      stopSample();
      status("Sample finished — the brief above is what the handler would be reading.");
      return;
    }
    const line = SAMPLE[i++];
    try {
      await sendChunks([line]);
    } catch (e) {
      toast(e.message, "error");
      stopSample();
      return;
    }
    const btn = $("#vbSample");
    if (btn) btn.innerHTML = `${icon("stop", 14)} Stop sample`;
    live.sample = setTimeout(step, 1400);
  };
  await step();
}

function parseTyped(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const m = /^([A-Za-z][\w .-]{0,30}):\s*(.+)$/.exec(line);
      return m ? { speaker: m[1].toLowerCase(), text: m[2] } : { speaker: "caller", text: line };
    });
}

async function sendTyped() {
  const box = $("#vbTyped");
  const chunks = parseTyped(box.value);
  if (!chunks.length) return;
  $("#vbSend").disabled = true;
  try {
    await sendChunks(chunks);
    box.value = "";
  } catch (e) {
    toast(e.message, "error");
  } finally {
    $("#vbSend").disabled = false;
  }
}

async function toggleMic() {
  if (live.mic?.active) {
    live.mic.stop();
    return;
  }
  await ensureSession();
  live.mic = new Microphone(
    {
      onStatus: status,
      onState: (s) => {
        live.scribe = s;
        const host = $("#vbScribe");
        if (!host) return;
        host.hidden = s.state === "idle";
        host.innerHTML = scribeStrip();
      },
      onInterim: (t) => {
        const el = $("#vbInterim");
        if (!el) return;
        el.hidden = !t;
        el.textContent = t ? `hearing: ${t}` : "";
      },
      onFinal: (text) => sendChunks([{ speaker: "caller", text }]).catch(() => undefined),
      onStopped: () => {
        const b = $("#vbMicToggle");
        if (b) b.innerHTML = `${icon("mic", 14)} Microphone`;
      },
    },
    { model: live.scribe.model },
  );
  await live.mic.start();
  const b = $("#vbMicToggle");
  if (b && live.mic.active) b.innerHTML = `${icon("stop", 14)} Stop microphone`;
}

function webhookDrawer() {
  const base = location.origin;
  const key = state.current?.key ?? "your-prospect";
  return openDrawer({
    title: "Feed a session from your telephony or meeting platform",
    sub: "The session API is transport-agnostic: any source that can POST JSON can drive the brief.",
    body: `
      <p class="muted">Nothing here is specific to a speech vendor. Open a session when a call
        connects, post transcript chunks as they are recognised, and read the brief over
        Server-Sent Events — or render it in your own agent desktop.</p>

      <h3 style="margin-top:20px">1. Open a session when the call connects</h3>
      ${snippet(`curl -sX POST ${base}/api/v1/listen/sessions \\\n  -H 'content-type: application/json' \\\n  -d '{"prospect":"${key}","metadata":{"call_id":"<your call id>"}}'`)}

      <h3 style="margin-top:20px">2. Post transcript chunks as they arrive</h3>
      ${snippet(`curl -sX POST ${base}/api/v1/listen/sessions/<id>/transcript \\\n  -H 'content-type: application/json' \\\n  -d '{"chunks":[{"speaker":"caller","text":"...","final":true}]}'`)}
      <p class="muted small">Interim hypotheses are welcome — send <code>"final": false</code> and the
        next final chunk replaces them. The server throttles refreshes, so a chatty client cannot
        turn every word into a model call.</p>

      <h3 style="margin-top:20px">3. Read the brief</h3>
      ${snippet(`curl -sN ${base}/api/v1/listen/sessions/<id>/events`)}
      <p class="muted small">Events: <code>brief</code>, <code>transcript</code>, <code>status</code>.
        Polling <code>GET /api/v1/listen/sessions/{id}</code> works just as well.</p>

      <h3 style="margin-top:20px">4. End the call</h3>
      ${snippet(`curl -sX DELETE ${base}/api/v1/listen/sessions/<id>`)}
      <p class="muted small">The brief, its sources and the stats are kept and appear under
        Conversations.</p>
      <p style="margin-top:18px"><a href="/api/v1/docs">Full API reference</a></p>`,
  });
}

// ── wiring ───────────────────────────────────────────────────────────────────

function wireIdle() {
  $("#vbSample")?.addEventListener("click", playSample);
  $("#vbMic")?.addEventListener("click", async () => {
    await ensureSession();
    await toggleMic();
  });
  $("#vbWebhook")?.addEventListener("click", webhookDrawer);
  $("#vbTypeHere")?.addEventListener("click", () => $("#vbTyped")?.focus());
  $("#vbSend")?.addEventListener("click", sendTyped);
  $("#vbModel")?.addEventListener("change", (e) => {
    live.model = e.target.value;
  });
  wireTypedShortcut();
}

function wireRunning() {
  $("#vbSpeak")?.addEventListener("change", (e) => {
    live.speak = e.target.checked;
    if (!live.speak) live.audio?.pause();
  });
  $("#vbSample")?.addEventListener("click", playSample);
  $("#vbMicToggle")?.addEventListener("click", toggleMic);
  $("#vbSend")?.addEventListener("click", sendTyped);
  $("#vbEnd")?.addEventListener("click", endSession);
  $("#vbNew")?.addEventListener("click", resetToIdle);
  wireTypedShortcut();
}

function wireTypedShortcut() {
  $("#vbTyped")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) sendTyped();
  });
}

async function loadModels() {
  const sel = $("#vbModel");
  if (!sel || !state.current) return;
  try {
    const { models } = await api(`/api/v1/models?prospect=${encodeURIComponent(state.current.key)}`);
    const scale = ["", "low", "medium", "high"];
    for (const m of models ?? []) {
      const o = document.createElement("option");
      o.value = m.id;
      o.textContent = `${m.label} — speed ${scale[m.speed] ?? "?"}, quality ${scale[m.quality] ?? "?"}`;
      sel.appendChild(o);
    }
    const prefer = ["gemini-2.5-flash-lite", "gemini-2.5-flash", "chatgpt4o-mini"].find((id) =>
      (models ?? []).some((m) => m.id === id),
    );
    if (prefer) {
      sel.value = prefer;
      live.model = prefer;
    }
  } catch {
    /* the picker degrades to "Auto" */
  }
}

// ── page ─────────────────────────────────────────────────────────────────────

const host = mountShell({
  section: "live",
  title: "Live",
  description:
    "Start a listening session, and one brief keeps rewriting itself as the conversation moves — " +
    "with a source behind every fact.",
  actions: `<button class="arag-btn ghost sm" id="vbCallTool">${icon("mic", 14)} Voice agent call</button>`,
});

await boot();
host.innerHTML = view();
prospectSwitcher(() => {
  if (!live.sessionId) resetToIdle();
  else toast("The prospect changes on the next session — this one keeps its Knowledge Box.", "info");
});
resetToIdle();

document.getElementById("vbCallTool")?.addEventListener("click", () => openCallDrawer(state.current));
document.getElementById("vbSampleOnboard")?.addEventListener("click", playSample);
document.getElementById("vbDismissOnboard")?.addEventListener("click", () => {
  localStorage.setItem(ONBOARDED, "1");
  document.getElementById("vbOnboard")?.remove();
});

if (state.prospects.length === 0) {
  host.innerHTML = empty({
    icon: "warning",
    kind: "error",
    title: "No prospect is configured",
    body: "A prospect points this deployment at a Knowledge Box. Add one under Prospects to start listening.",
    action: '<a class="arag-btn" href="/prospects/">Open Prospects</a>',
  });
}
