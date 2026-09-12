/**
 * ElevenLabs text-to-speech — the optional spoken brief.
 *
 * Live can read the grounded brief, or a single whisper cue, aloud to whoever is handling the
 * conversation. The synthesis happens here rather than in the browser for the same reason Scribe's
 * token does: the ElevenLabs key never leaves the server.
 *
 * This is deliberately opt-in. The product's promise is that it never speaks into the call — a
 * spoken cue is for the handler's own ear, on their own device, and is off by default.
 */
import type { VoiceConfig } from "../config.ts";
import type { FetchLike } from "./scribe.ts";

export class TtsError extends Error {
  readonly status: number | undefined;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "TtsError";
    this.status = status;
  }
}

/** A neutral, widely-available ElevenLabs voice, used when no prospect voice is configured. */
export const DEFAULT_TTS_VOICE = "21m00Tcm4TlvDq8ikWAM";
/** Low-latency model: a cue that arrives after the moment has passed is worse than none. */
export const DEFAULT_TTS_MODEL = "eleven_flash_v2_5";

export interface SpeechRequest {
  text: string;
  voiceId?: string;
  modelId?: string;
}

export interface SpeechResult {
  audio: Uint8Array;
  contentType: string;
  voiceId: string;
  modelId: string;
}

/** Synthesise one short line of speech. Never returns a partial or silent buffer. */
export async function synthesizeSpeech(
  cfg: VoiceConfig,
  req: SpeechRequest,
  fetchImpl: FetchLike = fetch,
): Promise<SpeechResult> {
  if (!cfg.elevenLabsApiKey) throw new TtsError("ELEVENLABS_API_KEY is not configured", 503);
  const text = (req.text ?? "").trim();
  if (!text) throw new TtsError("Nothing to speak", 400);
  const voiceId = req.voiceId || cfg.ttsVoiceId || DEFAULT_TTS_VOICE;
  const modelId = req.modelId || cfg.ttsModelId || DEFAULT_TTS_MODEL;
  const url =
    `${cfg.elevenLabsApiBase.replace(/\/$/, "")}/v1/text-to-speech/${encodeURIComponent(voiceId)}` +
    "?output_format=mp3_44100_64";
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { "xi-api-key": cfg.elevenLabsApiKey, "content-type": "application/json" },
      body: JSON.stringify({ text, model_id: modelId }),
    });
  } catch (err) {
    throw new TtsError(`ElevenLabs network error: ${(err as Error).message}`, 502);
  }
  if (!res.ok) throw new TtsError(`ElevenLabs text-to-speech -> HTTP ${res.status}`, res.status);
  const audio = new Uint8Array(await res.arrayBuffer());
  if (audio.byteLength === 0) throw new TtsError("ElevenLabs returned no audio", 502);
  return {
    audio,
    contentType: res.headers.get("content-type") ?? "audio/mpeg",
    voiceId,
    modelId,
  };
}

/**
 * Reduce a brief to something worth hearing.
 *
 * "brief" reads the headline context; "cue" is the one line the handler could say next. Both are
 * clamped hard — a spoken cue that runs longer than the pause it fills is a distraction.
 */
export function speakableFromBrief(brief: unknown, mode: "brief" | "cue" = "cue", maxChars = 420): string {
  if (!brief || typeof brief !== "object") return "";
  const b = brief as Record<string, unknown>;
  const str = (k: string) => (typeof b[k] === "string" ? (b[k] as string).trim() : "");
  const first = (k: string) => {
    const arr = Array.isArray(b[k]) ? (b[k] as unknown[]) : [];
    const hit = arr.map((x) => String(x ?? "").trim()).find(Boolean);
    return hit ?? "";
  };
  const parts =
    mode === "cue"
      ? [first("suggested_answers") || first("suggested_questions")]
      : [str("topic"), str("their_goal"), str("summary"), first("key_points")];
  return parts.filter(Boolean).join(". ").replace(/\s+/g, " ").trim().slice(0, maxChars);
}
