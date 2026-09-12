/**
 * ElevenLabs voices list — powers the voice dropdown for the Call agent. Server-side only (it
 * uses the ElevenLabs key); the browser applies the chosen voice as a session override.
 */
import type { VoiceConfig } from "../config.ts";
import type { FetchLike } from "./scribe.ts";

export interface VoiceOption {
  id: string;
  name: string;
  category?: string;
}

export class VoicesError extends Error {
  readonly status: number | undefined;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "VoicesError";
    this.status = status;
  }
}

export async function fetchVoices(cfg: VoiceConfig, fetchImpl: FetchLike = fetch): Promise<VoiceOption[]> {
  if (!cfg.elevenLabsApiKey) throw new VoicesError("ELEVENLABS_API_KEY is not configured", 503);
  const url = `${cfg.elevenLabsApiBase.replace(/\/$/, "")}/v1/voices`;
  let res: Response;
  try {
    res = await fetchImpl(url, { headers: { "xi-api-key": cfg.elevenLabsApiKey } });
  } catch (err) {
    throw new VoicesError(`ElevenLabs network error: ${(err as Error).message}`, 502);
  }
  if (!res.ok) throw new VoicesError(`ElevenLabs voices -> HTTP ${res.status}`, res.status);
  const j = (await res.json()) as { voices?: unknown };
  const vs = Array.isArray(j.voices) ? (j.voices as Record<string, unknown>[]) : [];
  const out: VoiceOption[] = [];
  for (const v of vs) {
    const id = v.voice_id as string | undefined;
    if (!id) continue;
    out.push({ id, name: (v.name as string) ?? id, category: (v.category as string) ?? undefined });
  }
  // Cloned / professional / generated voices first, then premade.
  out.sort((a, b) => {
    const rank = (c?: string) => (c === "premade" ? 1 : 0);
    return rank(a.category) - rank(b.category) || a.name.localeCompare(b.name);
  });
  return out;
}
