/**
 * Unit tests for the third-party integrations (ElevenLabs Scribe + voices, LiveAvatar).
 * `fetch` is injected, so these never touch the network and need no credentials.
 */
import { describe, expect, it } from "./_expect.ts";
import { Logger } from "../vendor/arag-platform/src/index.ts";
import { readVoiceEnv } from "../src/config.ts";
import { LiveAvatarClient, LiveAvatarError } from "../src/services/liveavatar.ts";
import { mintScribeToken, ScribeError } from "../src/services/scribe.ts";
import { fetchVoices, VoicesError } from "../src/services/voices.ts";

const log = new Logger({ level: "error", ringSize: 0, write: () => {} });
const configured = readVoiceEnv({ ELEVENLABS_API_KEY: "xi-test", LIVEAVATAR_API_KEY: "la-test" });

function reply(status: number, body: unknown, capture?: (url: string, init?: RequestInit) => void) {
  return async (url: string, init?: RequestInit) => {
    capture?.(url, init);
    return new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
}

async function expectError<T>(fn: () => Promise<T>): Promise<{ name: string; status?: number; message: string }> {
  try {
    await fn();
  } catch (err) {
    const e = err as { name: string; status?: number; message: string };
    return { name: e.name, status: e.status, message: e.message };
  }
  throw new Error("expected the call to throw");
}

describe("mintScribeToken", () => {
  it("mints a single-use token with the server-side key", async () => {
    let seenUrl = "";
    let seenKey: string | undefined;
    const token = await mintScribeToken(
      configured,
      reply(200, { token: "tok_123" }, (url, init) => {
        seenUrl = url;
        seenKey = (init?.headers as Record<string, string>)["xi-api-key"];
      }),
    );
    expect(token).toBe("tok_123");
    expect(seenUrl).toContain("/v1/single-use-token/realtime_scribe");
    expect(seenKey).toBe("xi-test");
  });

  it("503s when ElevenLabs is not configured", async () => {
    const e = await expectError(() => mintScribeToken(readVoiceEnv({})));
    expect(e.status).toBe(503);
    expect(e.name).toBe("ScribeError");
  });

  it("surfaces the upstream status without leaking the body", async () => {
    const e = await expectError(() => mintScribeToken(configured, reply(429, { detail: "quota" })));
    expect(e.status).toBe(429);
    expect(e.message).not.toContain("quota");
  });

  it("fails clearly when the response carries no token", async () => {
    const e = await expectError(() => mintScribeToken(configured, reply(200, {})));
    expect(e.message).toContain("no token");
    expect(new ScribeError("x").name).toBe("ScribeError");
  });

  it("maps a network failure to a 502", async () => {
    const e = await expectError(() =>
      mintScribeToken(configured, async () => {
        throw new Error("socket hang up");
      }),
    );
    expect(e.status).toBe(502);
  });
});

describe("fetchVoices", () => {
  it("maps the ElevenLabs payload and puts custom voices first", async () => {
    const voices = await fetchVoices(
      configured,
      reply(200, {
        voices: [
          { voice_id: "v1", name: "Zoe", category: "premade" },
          { voice_id: "v2", name: "Custom", category: "cloned" },
          { name: "no id" },
        ],
      }),
    );
    expect(voices).toHaveLength(2);
    expect(voices[0]!.id).toBe("v2");
  });

  it("503s without a key and 502s on upstream errors", async () => {
    expect((await expectError(() => fetchVoices(readVoiceEnv({})))).status).toBe(503);
    expect((await expectError(() => fetchVoices(configured, reply(500, {})))).status).toBe(500);
    expect(new VoicesError("x").name).toBe("VoicesError");
  });
});

describe("LiveAvatarClient", () => {
  it("registers the ElevenLabs key once and caches the secret id", async () => {
    let calls = 0;
    const client = new LiveAvatarClient(configured, {
      log,
      fetch: reply(200, { secret_id: "sec_1" }, () => {
        calls++;
      }),
    });
    expect(await client.resolveSecretId()).toBe("sec_1");
    expect(await client.resolveSecretId()).toBe("sec_1");
    expect(calls).toBe(1);
  });

  it("prefers a pre-registered secret id and never calls the API", async () => {
    const client = new LiveAvatarClient(
      readVoiceEnv({ LIVEAVATAR_API_KEY: "la", LIVEAVATAR_ELEVENLABS_SECRET_ID: "sec_env" }),
      {
        log,
        fetch: async () => {
          throw new Error("must not be called");
        },
      },
    );
    expect(await client.resolveSecretId()).toBe("sec_env");
  });

  it("explains what to configure when nothing is set", async () => {
    const client = new LiveAvatarClient(readVoiceEnv({}), { log });
    const e = await expectError(() => client.resolveSecretId());
    expect(e.status).toBe(503);
    expect(e.message).toContain("LIVEAVATAR_ELEVENLABS_SECRET_ID");
  });

  it("starts a LITE session with our own LiveKit room", async () => {
    let body: Record<string, unknown> = {};
    const client = new LiveAvatarClient(configured, {
      log,
      fetch: reply(200, { session_id: "sess_9" }, (_url, init) => {
        body = JSON.parse(String(init?.body));
      }),
    });
    const session = await client.startLiteSession({
      avatarId: "av1",
      secretId: "sec",
      agentId: "agent",
      livekitUrl: "wss://lk.test",
      livekitRoom: "room-1",
      livekitWorkerToken: "worker-token",
    });
    expect(session.sessionId).toBe("sess_9");
    expect(body.mode).toBe("LITE");
    expect((body.custom_livekit_config as { livekit_room: string }).livekit_room).toBe("room-1");
  });

  it("maps upstream failures and non-JSON bodies to LiveAvatarError", async () => {
    const bad = new LiveAvatarClient(configured, { log, fetch: reply(500, "boom") });
    expect((await expectError(() => bad.registerElevenLabsKey("k"))).status).toBe(500);
    const html = new LiveAvatarClient(configured, { log, fetch: reply(200, "<html>") });
    expect((await expectError(() => html.registerElevenLabsKey("k"))).message).toContain("non-JSON");
    const offline = new LiveAvatarClient(configured, {
      log,
      fetch: async () => {
        throw new Error("dns");
      },
    });
    expect((await expectError(() => offline.registerElevenLabsKey("k"))).status).toBe(502);
    expect(new LiveAvatarError("x").name).toBe("LiveAvatarError");
  });

  it("fails when the API returns no secret id", async () => {
    const client = new LiveAvatarClient(configured, { log, fetch: reply(200, {}) });
    expect((await expectError(() => client.registerElevenLabsKey("k"))).message).toContain("no secret_id");
  });
});
