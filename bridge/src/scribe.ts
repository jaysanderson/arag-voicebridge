/**
 * ElevenLabs Scribe v2 Realtime — single-use token minting (for the ambient "Listen" mode).
 *
 * The browser must NOT hold the ElevenLabs API key. Instead the bridge mints a short-lived
 * single-use token (15 min, consumed on use) that the browser passes as the `token` query param
 * when it opens the Scribe realtime WebSocket. Verified live:
 *   POST https://api.elevenlabs.io/v1/single-use-token/realtime_scribe  (header xi-api-key) -> { token }
 *
 * Docs: https://elevenlabs.io/docs/api-reference/tokens/create
 *       https://elevenlabs.io/docs/api-reference/speech-to-text/v-1-speech-to-text-realtime
 */

import { config } from "./config.ts";

export class ScribeError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ScribeError";
  }
}

/** Mint a single-use realtime_scribe token. The browser uses it to open the Scribe WS. */
export async function mintScribeToken(): Promise<string> {
  const url = `${config.elevenLabsApiBase.replace(/\/$/, "")}/v1/single-use-token/realtime_scribe`;
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "xi-api-key": config.elevenLabsApiKey } });
  } catch (err) {
    throw new ScribeError(`ElevenLabs network error: ${(err as Error).message}`);
  }
  const text = await res.text();
  if (!res.ok) {
    throw new ScribeError(`single-use-token -> HTTP ${res.status}: ${text.slice(0, 200)}`, res.status);
  }
  let token: string | undefined;
  try {
    token = JSON.parse(text).token;
  } catch {
    /* fall through */
  }
  if (!token) throw new ScribeError(`No token in response: ${text.slice(0, 120)}`);
  return token;
}
