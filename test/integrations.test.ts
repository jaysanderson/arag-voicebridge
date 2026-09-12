/**
 * Unit tests for the third-party integrations (ElevenLabs Scribe + voices, LiveAvatar).
 * `fetch` is injected, so these never touch the network and need no credentials.
 */

import { readVoiceEnv } from "../src/config.ts";
import { LiveAvatarClient, LiveAvatarError } from "../src/services/liveavatar.ts";
import { mintScribeToken, ScribeError } from "../src/services/scribe.ts";
import {
  DEFAULT_TTS_MODEL,
  DEFAULT_TTS_VOICE,
  speakableFromBrief,
  synthesizeSpeech,
} from "../src/services/tts.ts";
import { systemPrompt, voiceAgentConfig } from "../src/services/voiceAgent.ts";
import { fetchVoices, VoicesError } from "../src/services/voices.ts";
import { Logger } from "../vendor/arag-platform/src/index.ts";
import { describe, expect, it } from "./_expect.ts";

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

async function expectError<T>(
  fn: () => Promise<T>,
): Promise<{ name: string; status?: number; message: string }> {
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

describe("synthesizeSpeech (the optional spoken brief)", () => {
  it("synthesises with the server-side key and a low-latency model", async () => {
    let seenUrl = "";
    let seenBody: Record<string, unknown> = {};
    let seenKey: string | undefined;
    const audio = async (url: string, init?: RequestInit) => {
      seenUrl = url;
      seenKey = (init?.headers as Record<string, string>)["xi-api-key"];
      seenBody = JSON.parse(String(init?.body));
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "audio/mpeg" },
      });
    };
    const r = await synthesizeSpeech(configured, { text: "The Shop System suits mid-volume parts." }, audio);
    expect(r.contentType).toBe("audio/mpeg");
    expect(r.audio.byteLength).toBe(3);
    expect(r.modelId).toBe(DEFAULT_TTS_MODEL);
    expect(r.voiceId).toBe(DEFAULT_TTS_VOICE);
    expect(seenKey).toBe("xi-test");
    expect(seenUrl).toContain(`/v1/text-to-speech/${DEFAULT_TTS_VOICE}`);
    expect(seenBody.model_id).toBe(DEFAULT_TTS_MODEL);
    expect(seenBody.text).toContain("Shop System");
  });

  it("prefers an explicit voice, then the deployment's configured one", async () => {
    const ok = async () => new Response(new Uint8Array([1]), { status: 200 });
    const withVoice = readVoiceEnv({ ELEVENLABS_API_KEY: "xi-test", ELEVENLABS_TTS_VOICE_ID: "cfg-voice" });
    expect((await synthesizeSpeech(withVoice, { text: "hi" }, ok)).voiceId).toBe("cfg-voice");
    expect((await synthesizeSpeech(withVoice, { text: "hi", voiceId: "req" }, ok)).voiceId).toBe("req");
  });

  it("503s when ElevenLabs is not configured, so the toggle can stay hidden", async () => {
    const e = await expectError(() => synthesizeSpeech(readVoiceEnv({}), { text: "hi" }));
    expect(e.status).toBe(503);
    expect(e.name).toBe("TtsError");
  });

  it("refuses to spend a synthesis on nothing", async () => {
    const e = await expectError(() => synthesizeSpeech(configured, { text: "   " }));
    expect(e.status).toBe(400);
  });

  it("surfaces the upstream status, and treats empty audio as an upstream failure", async () => {
    const bad = await expectError(() =>
      synthesizeSpeech(configured, { text: "hi" }, async () => new Response("nope", { status: 429 })),
    );
    expect(bad.status).toBe(429);
    const empty = await expectError(() =>
      synthesizeSpeech(
        configured,
        { text: "hi" },
        async () => new Response(new Uint8Array([]), { status: 200 }),
      ),
    );
    expect(empty.status).toBe(502);
  });
});

describe("speakableFromBrief", () => {
  const brief = {
    topic: "Metal binder jetting",
    their_goal: "Understand the post-print steps",
    summary: "They machine manifolds today and want to print them.",
    key_points: ["Sintering is a separate furnace"],
    suggested_answers: ["The Shop System suits mid-volume metal parts."],
    suggested_questions: ["What volumes per month?"],
  };

  it("speaks the one line the handler could say next", () => {
    expect(speakableFromBrief(brief, "cue")).toBe("The Shop System suits mid-volume metal parts.");
  });

  it("falls back to a question when there is nothing to say yet", () => {
    expect(speakableFromBrief({ suggested_questions: ["What volumes?"] }, "cue")).toBe("What volumes?");
  });

  it("reads the headline context in brief mode", () => {
    const spoken = speakableFromBrief(brief, "brief");
    expect(spoken).toContain("Metal binder jetting");
    expect(spoken).toContain("machine manifolds");
  });

  it("clamps long output — a cue must fit the pause it fills", () => {
    const long = speakableFromBrief({ suggested_answers: ["x".repeat(900)] }, "cue", 100);
    expect(long.length).toBe(100);
  });

  it("returns nothing for an absent or empty brief", () => {
    expect(speakableFromBrief(null)).toBe("");
    expect(speakableFromBrief({})).toBe("");
  });
});

describe("voiceAgentConfig (ElevenLabs Conversational AI)", () => {
  const prospect = {
    id: "acme",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    display_name: "Acme",
    kb_id: "kb-1",
    region: "europe-1",
    locale: "en-GB",
    greeting: "Hello",
    handoff_msg: "One moment",
  };

  it("derives the custom server tool from the deployment and the registry", () => {
    const cfg = voiceAgentConfig({ ...prospect, agent_id: "agent_123" }, configured, "https://bridge.test/");
    expect(cfg.provider).toBe("elevenlabs");
    expect(cfg.agent_id).toBe("agent_123");
    expect(cfg.ready).toBe(true);
    expect(cfg.configured).toBe(true);
    expect(cfg.tool.name).toBe("voice_answer");
    expect(cfg.tool.url).toBe("https://bridge.test/api/v1/voice-answer");
    // The tool timeout must outlast the bridge's own turn budget, or the agent gets dead air.
    expect(cfg.tool.timeoutMs).toBeGreaterThan(configured.turnTimeoutMs);
    expect(JSON.stringify(cfg.tool.bodySchema)).toContain("acme");
  });

  it("tells the truth about an unwired or placeholder agent", () => {
    expect(voiceAgentConfig(prospect, configured, "https://b.test").ready).toBe(false);
    expect(voiceAgentConfig(prospect, configured, "https://b.test").agent_id).toBe(null);
    const placeholder = voiceAgentConfig(
      { ...prospect, agent_id: "REPLACE_ME_AGENT_ID" },
      configured,
      "https://b.test",
    );
    expect(placeholder.ready).toBe(false);
  });

  it("keeps the agent a router, not the answer source", () => {
    const prompt = systemPrompt("Acme");
    expect(prompt).toContain("router, not the answer source");
    expect(prompt).toContain("voice_answer");
    expect(prompt).toContain("VERBATIM");
  });
});
