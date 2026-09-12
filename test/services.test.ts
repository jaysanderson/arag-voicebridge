import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertVoiceConfig,
  avatarEnabled,
  describeVoiceConfig,
  readVoiceEnv,
  scribeEnabled,
} from "../src/config.ts";
import { buildBriefRequest, LIVE_BRIEF_SCHEMA, prevBriefToText } from "../src/services/brief.ts";
import { AragClientPool } from "../src/services/clientPool.ts";
import { checkTurn, countSentences } from "../src/services/goldenEval.ts";
import { MetricsService } from "../src/services/metrics.ts";
import { classify, optionsFrom, rankModels } from "../src/services/models.ts";
import { buildSearchConfiguration, configName } from "../src/services/provision.ts";
import { RateLimiter } from "../src/services/ratelimit.ts";
import type { ProspectRecord } from "../src/types.ts";
import { Logger, readEnv, Store } from "../vendor/arag-platform/src/index.ts";
import { describe, expect, it } from "./_expect.ts";

const log = new Logger({ level: "error", ringSize: 0, write: () => {} });
const store = () => new Store(mkdtempSync(join(tmpdir(), "vb-svc-")));

const prospect: ProspectRecord = {
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

describe("config", () => {
  it("defaults are demo-safe and the turn timeout stays under the agent tool timeout", () => {
    const v = readVoiceEnv({});
    expect(v.turnTimeoutMs).toBeLessThanOrEqual(v.agentToolTimeoutMs - 1);
    assertVoiceConfig(readEnv({ ARAG_MOCK: "1" }), v);
  });

  it("rejects a turn timeout that would outlive the agent's tool call", () => {
    const v = readVoiceEnv({ VOICE_TURN_TIMEOUT_MS: "9000", AGENT_TOOL_TIMEOUT_MS: "8000" });
    let threw = false;
    try {
      assertVoiceConfig(readEnv({ ARAG_MOCK: "1" }), v);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  it("requires an admin token in production", () => {
    let threw = false;
    try {
      assertVoiceConfig(readEnv({ NODE_ENV: "production", ARAG_MOCK: "1" }), readVoiceEnv({}));
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  it("feature flags follow the credentials", () => {
    expect(scribeEnabled(readVoiceEnv({}))).toBe(false);
    expect(scribeEnabled(readVoiceEnv({ ELEVENLABS_API_KEY: "k" }))).toBe(true);
    expect(avatarEnabled(readVoiceEnv({ ELEVENLABS_API_KEY: "k" }))).toBe(false);
    expect(
      avatarEnabled(
        readVoiceEnv({
          ELEVENLABS_API_KEY: "k",
          LIVEAVATAR_API_KEY: "la",
          LIVEKIT_URL: "wss://x",
          LIVEKIT_API_KEY: "a",
          LIVEKIT_API_SECRET: "b",
        }),
      ),
    ).toBe(true);
  });

  it("describeVoiceConfig never exposes a secret", () => {
    const described = JSON.stringify(
      describeVoiceConfig(
        readVoiceEnv({ ELEVENLABS_API_KEY: "sk-super-secret", LIVEKIT_API_SECRET: "s3cret" }),
      ),
    );
    expect(described).not.toContain("sk-super-secret");
    expect(described).not.toContain("s3cret");
  });
});

describe("AragClientPool", () => {
  const env = readEnv({ ARAG_REGION: "aws-us-east-2-1", ARAG_API_KEY: "key", ARAG_KB_ID: "kb-env" });
  const voice = readVoiceEnv({});

  it("derives the zone host from the prospect's region", () => {
    const pool = new AragClientPool({ env, voice, log });
    expect(pool.baseUrlFor(prospect)).toBe("https://europe-1.dp.progress.cloud/api/v1");
  });

  it("honours ARAG_BASE_URL for prospects in the deployment's own zone", () => {
    const local = readEnv({
      ARAG_REGION: "aws-us-east-2-1",
      ARAG_BASE_URL: "https://aws-us-east-2-1.dp.progress.cloud/api/v1",
    });
    const pool = new AragClientPool({ env: local, voice, log });
    expect(pool.baseUrlFor({ kb_id: "k", region: "aws-us-east-2-1" })).toBe(
      "https://aws-us-east-2-1.dp.progress.cloud/api/v1",
    );
    expect(pool.baseUrlFor({ kb_id: "k", region: "europe-1" })).toBe(
      "https://europe-1.dp.progress.cloud/api/v1",
    );
  });

  it("routes every prospect to the mock when one is configured", () => {
    const pool = new AragClientPool({
      env,
      voice,
      log,
      mock: { url: "http://127.0.0.1:1/api/v1", kbId: "mock-kb", apiKey: "mock" },
    });
    expect(pool.for(prospect).kbId).toBe("mock-kb");
    expect(pool.for({ kb_id: "other", region: "europe-1" }).kbId).toBe("mock-kb");
  });

  it("caches one client per kb+host and clears on demand", () => {
    const pool = new AragClientPool({ env, voice, log });
    pool.for(prospect);
    pool.for(prospect);
    expect(pool.size).toBe(1);
    pool.for({ kb_id: "kb-2", region: "europe-1" });
    expect(pool.size).toBe(2);
    pool.clear();
    expect(pool.size).toBe(0);
  });

  it("falls back to ARAG_REGION_DEFAULT when a prospect omits the region", () => {
    const pool = new AragClientPool({ env, voice: readVoiceEnv({ ARAG_REGION_DEFAULT: "europe-1" }), log });
    expect(pool.regionFor({ kb_id: "k" })).toBe("europe-1");
  });
});

describe("MetricsService", () => {
  const turn = (over: Partial<Parameters<MetricsService["record"]>[0]> = {}) => ({
    prospect: "acme",
    total: 100,
    first_token: 50,
    retrieve: 20,
    citations: 1,
    handoff: false,
    guard_trip: false,
    source: "voice-answer" as const,
    ...over,
  });

  it("computes percentiles, handoff rate and citation coverage", () => {
    const m = new MetricsService({ store: store() });
    for (const total of [100, 200, 300, 400]) m.record(turn({ total }));
    m.record(turn({ handoff: true, citations: 0 }));
    const s = m.snapshot();
    expect(s.turns).toBe(5);
    expect(s.latency_total_ms.p50).toBeGreaterThan(0);
    expect(s.handoff_rate).toBe(0.2);
    expect(s.citation_coverage).toBe(1);
  });

  it("counts guard trips and splits by prospect", () => {
    const m = new MetricsService({ store: store() });
    m.record(turn());
    m.record(turn({ prospect: "other", guard_trip: true, handoff: true }));
    expect(m.snapshot().guard_trip_rate).toBe(0.5);
    expect(m.snapshot("acme").turns).toBe(1);
    expect(m.snapshot().by_prospect.other).toBe(1);
  });

  it("keeps a bounded, newest-first turn log", () => {
    const m = new MetricsService({ store: store(), cap: 3 });
    for (let i = 0; i < 5; i++) m.record(turn({ total: i }));
    expect(m.size).toBe(3);
    expect(m.recent({ limit: 2 })).toHaveLength(2);
    m.reset();
    expect(m.size).toBe(0);
  });

  it("reports an empty snapshot safely", () => {
    const s = new MetricsService({ store: store() }).snapshot();
    expect(s.turns).toBe(0);
    expect(s.citation_coverage).toBe(1);
  });
});

describe("RateLimiter", () => {
  it("allows a burst then refuses with a Retry-After", () => {
    const rl = new RateLimiter(1, 3);
    const now = Date.now();
    expect(rl.take("ip", now).ok).toBe(true);
    expect(rl.take("ip", now).ok).toBe(true);
    expect(rl.take("ip", now).ok).toBe(true);
    const denied = rl.take("ip", now);
    expect(denied.ok).toBe(false);
    expect(denied.retryAfter).toBeGreaterThanOrEqual(1);
  });

  it("refills over time and isolates keys", () => {
    const rl = new RateLimiter(1, 1);
    const now = Date.now();
    expect(rl.take("a", now).ok).toBe(true);
    expect(rl.take("a", now).ok).toBe(false);
    expect(rl.take("b", now).ok).toBe(true);
    expect(rl.take("a", now + 1100).ok).toBe(true);
  });

  it("is disabled when rps <= 0", () => {
    const rl = new RateLimiter(0, 1);
    expect(rl.take("x").ok).toBe(true);
    expect(rl.take("x").ok).toBe(true);
  });
});

describe("models", () => {
  it("classifies fast, premium and balanced families", () => {
    expect(classify("gemini-2.5-flash-lite").speed).toBe(3);
    expect(classify("claude-3-opus").quality).toBe(3);
    expect(classify("chatgpt-azure-4o").quality).toBe(3);
  });

  it("parses option lists from several schema shapes", () => {
    expect(optionsFrom({ options: [{ value: "a", name: "A" }] })[0]!.label).toBe("A");
    expect(optionsFrom({ enum: ["b"] })[0]!.id).toBe("b");
    expect(optionsFrom(undefined)).toEqual([]);
  });

  it("ranks fast models first and dedupes provider routing variants", () => {
    const ranked = rankModels([
      { id: "gcp-claude-sonnet", label: "Claude Sonnet", speed: 2, quality: 3, price: 2 },
      { id: "claude-sonnet", label: "Claude Sonnet", speed: 2, quality: 3, price: 2 },
      { id: "gemini-flash-lite", label: "Gemini Flash Lite", speed: 3, quality: 2, price: 1 },
    ]);
    expect(ranked).toHaveLength(2);
    expect(ranked[0]!.id).toBe("gemini-flash-lite");
  });
});

describe("provision", () => {
  it("builds an idempotent stored ask configuration carrying the voice prompt", () => {
    const cfg = buildSearchConfiguration(prospect, { reranker: "predict", generative_model: "m1" });
    expect(cfg.kind).toBe("ask");
    expect(String(cfg.config.prompt)).toContain("HANDOFF:");
    expect(cfg.config.reranker).toBe("predict");
    expect(cfg.config.generative_model).toBe("m1");
    expect((cfg.config.security as { groups: string[] }).groups).toEqual(["public"]);
  });

  it("names the configuration after the prospect unless overridden", () => {
    expect(configName(prospect)).toBe("acme_voice");
    expect(configName({ ...prospect, ask_config: "stored" })).toBe("stored");
    expect(configName(prospect, { name: "custom" })).toBe("custom");
  });
});

describe("golden-eval checks", () => {
  it("counts sentences", () => {
    expect(countSentences("One. Two! Three?")).toBe(3);
    expect(countSentences("no punctuation")).toBe(1);
    expect(countSentences("")).toBe(0);
  });

  it("passes a grounded, voice-shaped answer", () => {
    const checks = checkTurn(
      { q: "x", expect: "answer", must_include: ["plan"] },
      { answer: "Your plan renews monthly.", handoff: false, citations: 2 },
    );
    expect(checks.every((c) => c.ok)).toBe(true);
  });

  it("fails an uncited answer, a spoken URL and a missing term", () => {
    const checks = checkTurn(
      { q: "x", expect: "answer", must_include: ["dental"] },
      { answer: "See https://example.test for more.", handoff: false, citations: 0 },
    );
    const failed = checks.filter((c) => !c.ok).map((c) => c.label);
    expect(failed.length).toBeGreaterThanOrEqual(3);
  });

  it("requires out-of-scope questions to hand off", () => {
    expect(
      checkTurn({ q: "x", expect: "handoff" }, { answer: "anything", handoff: false, citations: 0 })[0]!.ok,
    ).toBe(false);
    expect(
      checkTurn({ q: "x", expect: "handoff" }, { answer: "escalating", handoff: true, citations: 0 })[0]!.ok,
    ).toBe(true);
  });
});

describe("brief", () => {
  it("asks for structured output and keeps the schema's required summary", () => {
    const body = buildBriefRequest({ text: "we need stainless steel parts" }, prospect);
    expect(body.answer_json_schema).toBe(LIVE_BRIEF_SCHEMA);
    expect(LIVE_BRIEF_SCHEMA.parameters.required).toEqual(["summary"]);
    expect(body.citations).toBe(undefined);
  });

  it("strips braces from injected text (ARAG's templater only allows {context}/{question})", () => {
    const body = buildBriefRequest({ text: "hi", transcript: "a {weird} transcript" }, prospect);
    const user = (body.prompt as { user: string }).user;
    expect(user).toContain("weird");
    expect(user).not.toContain("{weird}");
    expect(user).toContain("{context}");
  });

  it("renders the previous brief as brace-free lines so it can be refined, not restarted", () => {
    const text = prevBriefToText({ topic: "Metal printing", key_points: ["a", "b"], nothing: "" });
    expect(text).toContain("Topic: Metal printing");
    expect(text).toContain("Key points: a; b");
    expect(prevBriefToText(null)).toBe("");
  });

  it("prefers the per-request model, then the prospect's fast brief model", () => {
    expect(buildBriefRequest({ text: "x", model: "m-req" }, prospect).generative_model).toBe("m-req");
    expect(buildBriefRequest({ text: "x" }, { ...prospect, brief_model: "m-fast" }).generative_model).toBe(
      "m-fast",
    );
  });
});
