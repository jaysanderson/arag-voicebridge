/**
 * ElevenLabs voices list — powers the voice dropdown for the Call agent.
 * Server-side only (uses the ElevenLabs key). The browser applies the chosen voice to the
 * ConvAI widget via the `override-voice-id` attribute (agent must allow the voice_id override).
 */

import { config } from "./config.ts";

export interface VoiceOption {
  id: string;
  name: string;
  category?: string;
}

export async function fetchVoices(): Promise<VoiceOption[]> {
  const url = `${config.elevenLabsApiBase.replace(/\/$/, "")}/v1/voices`;
  const res = await fetch(url, { headers: { "xi-api-key": config.elevenLabsApiKey } });
  if (!res.ok) throw new Error(`ElevenLabs voices -> HTTP ${res.status}`);
  const j = (await res.json()) as { voices?: unknown };
  const vs = Array.isArray(j.voices) ? (j.voices as Record<string, unknown>[]) : [];
  const out: VoiceOption[] = [];
  for (const v of vs) {
    const id = v.voice_id as string | undefined;
    if (!id) continue;
    out.push({ id, name: (v.name as string) ?? id, category: (v.category as string) ?? undefined });
  }
  // Cloned / professional / generated voices first, then premade — yours usually matter most.
  out.sort((a, b) => {
    const rank = (c?: string) => (c === "premade" ? 1 : 0);
    return rank(a.category) - rank(b.category) || a.name.localeCompare(b.name);
  });
  return out;
}
