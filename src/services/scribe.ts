/**
 * ElevenLabs Scribe v2 Realtime — single-use token minting (ambient "Listen" mode).
 *
 * The browser must NOT hold the ElevenLabs API key. The bridge mints a short-lived single-use
 * token (15 min, consumed on use) that the browser passes as the `token` query parameter when
 * it opens the Scribe realtime WebSocket. Verified live:
 *   POST https://api.elevenlabs.io/v1/single-use-token/realtime_scribe (header xi-api-key) -> { token }
 */
import type { VoiceConfig } from "../config.ts";

export class ScribeError extends Error {
  readonly status: number | undefined;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "ScribeError";
    this.status = status;
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Mint a single-use realtime_scribe token. The browser uses it to open the Scribe WS. */
export async function mintScribeToken(cfg: VoiceConfig, fetchImpl: FetchLike = fetch): Promise<string> {
  if (!cfg.elevenLabsApiKey) throw new ScribeError("ELEVENLABS_API_KEY is not configured", 503);
  const url = `${cfg.elevenLabsApiBase.replace(/\/$/, "")}/v1/single-use-token/realtime_scribe`;
  let res: Response;
  try {
    res = await fetchImpl(url, { method: "POST", headers: { "xi-api-key": cfg.elevenLabsApiKey } });
  } catch (err) {
    throw new ScribeError(`ElevenLabs network error: ${(err as Error).message}`, 502);
  }
  const text = await res.text();
  if (!res.ok) throw new ScribeError(`single-use-token -> HTTP ${res.status}`, res.status);
  let token: string | undefined;
  try {
    token = JSON.parse(text).token;
  } catch {
    /* fall through */
  }
  if (!token) throw new ScribeError("ElevenLabs returned no token", 502);
  return token;
}
