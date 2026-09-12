// Microphone → transcript chunks, via ElevenLabs Scribe realtime.
//
// This is one transcript source among several: the listen session on the server does not know or
// care that these words came from a microphone. Without an ElevenLabs key on the server the
// product still works — the sample conversation and typed text feed the same session API.
import { api } from "/ui/arag-ui.js";

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
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/**
 * A microphone capture that emits final transcript chunks, via ElevenLabs Scribe v2 Realtime.
 *
 * Handlers: onStatus(text), onState({state, latencyMs, language, model}), onInterim(text),
 * onFinal(text), onStopped(). The listen session API itself stays transcription-agnostic — this
 * is simply the transcription source the product ships with.
 */
export class Microphone {
  constructor(handlers = {}, opts = {}) {
    this.h = handlers;
    this.model = opts.model ?? "scribe_v2_realtime";
    this.active = false;
    this.ws = null;
    this.ctx = null;
    this.stream = null;
    this.nodes = null;
    this.inRate = 16000;
    this.reconnect = null;
    // Reported so the product can be honest about how fast the transcription actually is.
    this.state = "idle";
    this.language = "";
    this.latencyMs = 0;
    this.segmentStartedAt = 0;
  }

  report(state) {
    if (state) this.state = state;
    this.h.onState?.({
      state: this.state,
      latencyMs: this.latencyMs,
      language: this.language,
      model: this.model,
    });
  }

  async start() {
    if (this.active) return;
    this.active = true;
    this.report("starting");
    try {
      await this.setup();
    } catch (err) {
      this.h.onStatus?.(`Microphone unavailable: ${err.message}`);
      this.stop();
      return;
    }
    await this.connect();
  }

  async setup() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === "suspended") {
      try {
        await this.ctx.resume();
      } catch {
        /* a user gesture already opened this path */
      }
    }
    this.inRate = this.ctx.sampleRate;
    const source = this.ctx.createMediaStreamSource(this.stream);
    const processor = this.ctx.createScriptProcessor(4096, 1, 1);
    const mute = this.ctx.createGain();
    mute.gain.value = 0;
    source.connect(processor);
    processor.connect(mute);
    mute.connect(this.ctx.destination);
    processor.onaudioprocess = (e) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      const f32 = downsample(e.inputBuffer.getChannelData(0), this.inRate, 16000);
      try {
        this.ws.send(
          JSON.stringify({
            message_type: "input_audio_chunk",
            audio_base_64: toBase64(new Uint8Array(pcm16(f32).buffer)),
            commit: false,
          }),
        );
      } catch {
        /* the socket is closing; the reconnect path takes over */
      }
    };
    this.nodes = { source, processor, mute };
  }

  async connect() {
    if (!this.active) return;
    this.h.onStatus?.(this.ws ? "Reconnecting to transcription…" : "Connecting to transcription…");
    let token;
    try {
      token = (await api("/api/v1/scribe-token", { method: "POST" })).token;
    } catch (err) {
      this.h.onStatus?.(
        `Microphone transcription needs an ElevenLabs key on this deployment (${err.message}). ` +
          "The sample conversation and typed text work without one.",
      );
      this.stop();
      return;
    }
    const qs = new URLSearchParams({
      model_id: this.model,
      audio_format: "pcm_16000",
      commit_strategy: "vad",
      token,
    });
    const ws = new WebSocket(`wss://api.elevenlabs.io/v1/speech-to-text/realtime?${qs}`);
    this.ws = ws;
    ws.onopen = () => {
      this.h.onStatus?.("Listening to the microphone — speak naturally.");
      this.report("connected");
    };
    ws.onmessage = (ev) => {
      let m;
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (m.language_code || m.language) this.language = m.language_code || m.language;
      if (m.message_type === "partial_transcript") {
        if (!this.segmentStartedAt) this.segmentStartedAt = performance.now();
        this.h.onInterim?.(m.text || "");
      } else if (m.message_type === "committed_transcript") {
        // How long the last words took to become final — the number that decides whether the
        // brief can keep up with the conversation.
        if (this.segmentStartedAt) {
          this.latencyMs = Math.round(performance.now() - this.segmentStartedAt);
          this.segmentStartedAt = 0;
        }
        this.report("connected");
        this.h.onInterim?.("");
        const text = (m.text || "").trim();
        if (text) this.h.onFinal?.(text);
      } else if (["error", "auth_error", "quota_exceeded"].includes(m.message_type)) {
        this.h.onStatus?.(`Transcription error: ${m.error || m.message_type}`);
        this.report("error");
      }
    };
    ws.onclose = () => {
      if (ws === this.ws) this.ws = null;
      if (this.active && !this.reconnect) {
        this.report("reconnecting");
        this.reconnect = setTimeout(() => {
          this.reconnect = null;
          this.connect();
        }, 1200);
      }
    };
  }

  stop() {
    this.active = false;
    clearTimeout(this.reconnect);
    this.reconnect = null;
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      try {
        ws.close();
      } catch {
        /* already closed */
      }
    }
    if (this.nodes) {
      for (const n of Object.values(this.nodes)) {
        try {
          n.disconnect();
        } catch {
          /* already disconnected */
        }
      }
      this.nodes = null;
    }
    if (this.ctx) {
      try {
        this.ctx.close();
      } catch {
        /* already closed */
      }
      this.ctx = null;
    }
    if (this.stream) {
      for (const t of this.stream.getTracks()) t.stop();
      this.stream = null;
    }
    this.h.onInterim?.("");
    this.report("idle");
    this.h.onStopped?.();
  }
}
