/**
 * The ElevenLabs Agents integration.
 *
 * The pure half (what the agent *should* be) is tested directly; the network half runs against a
 * small in-process fake of the ElevenLabs Agents API, so the request method, path, headers and
 * merge behaviour are all exercised for real without a key, a network or a live agent. The live
 * agent is never touched from a test.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readVoiceEnv, type VoiceConfig } from "../src/config.ts";
import {
  AgentError,
  agentDiff,
  agentPatchBody,
  deleteAgent,
  deleteTool,
  getAgent,
  getTool,
  headerNames,
  pushAgent,
  redactSecrets,
  summariseAgent,
  summariseTool,
  toolConfigBody,
} from "../src/services/elevenAgent.ts";
import {
  desiredAgent,
  desiredTool,
  effectiveSystemPrompt,
  systemPrompt,
  toolUrl,
  voiceAgentConfig,
} from "../src/services/voiceAgent.ts";
import type { ProspectRecord } from "../src/types.ts";
import { after, before, describe, expect, it } from "./_expect.ts";

const PROSPECT: ProspectRecord = {
  id: "acme",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  display_name: "Acme",
  region: "europe-1",
  locale: "en-GB",
  greeting: "Acme support, how can I help?",
  handoff_msg: "Let me get a colleague for you.",
  agent_id: "agent_live_1",
  tool_id: "tool_live_1",
};

// ── the fake ElevenLabs ──────────────────────────────────────────────────────

interface Call {
  method: string;
  path: string;
  apiKey: string | undefined;
  body: Record<string, unknown> | null;
}

let server: Server;
let base = "";
let calls: Call[] = [];
/** The fake's stored objects, so a PATCH can be read back like the real API. */
let agents: Record<string, Record<string, unknown>> = {};
let tools: Record<string, Record<string, unknown>> = {};
let nextId = 0;

function reset(): void {
  calls = [];
  nextId = 0;
  agents = {
    agent_live_1: {
      agent_id: "agent_live_1",
      name: "Old name",
      conversation_config: {
        // Configuration this product does not own: it must survive a push untouched.
        turn: { turn_timeout: 7 },
        agent: {
          first_message: "Old greeting",
          prompt: { prompt: "Old prompt", llm: "gpt-4o-mini", tool_ids: ["tool_other"] },
        },
        tts: { voice_id: "voice_old", model_id: "eleven_flash_v2_5" },
      },
    },
  };
  tools = {
    tool_live_1: {
      id: "tool_live_1",
      tool_config: {
        type: "webhook",
        name: "voice_answer",
        description: "old",
        response_timeout_secs: 20,
        api_schema: {
          // The state the live agent is actually in: the old path, and no header at all.
          url: "https://arag-voice-bridge.fly.dev/v1/voice-answer",
          method: "POST",
          request_headers: { "X-Trace": "keep-me" },
          request_body_schema: { type: "object" },
        },
      },
    },
  };
}

before(async () => {
  reset();
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const path = (req.url ?? "").split("?")[0] ?? "";
      calls.push({
        method: req.method ?? "",
        path,
        apiKey: req.headers["xi-api-key"] as string | undefined,
        body: raw ? (JSON.parse(raw) as Record<string, unknown>) : null,
      });
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (req.headers["xi-api-key"] !== "xi-test") return send(401, { detail: "bad key" });

      const agentMatch = /^\/v1\/convai\/agents\/([^/]+)$/.exec(path);
      const toolMatch = /^\/v1\/convai\/tools\/([^/]+)$/.exec(path);
      if (path === "/v1/convai/agents/create" && req.method === "POST") {
        const id = `agent_new_${++nextId}`;
        agents[id] = { ...(JSON.parse(raw) as Record<string, unknown>), agent_id: id };
        return send(200, { agent_id: id });
      }
      if (path === "/v1/convai/tools" && req.method === "POST") {
        const id = `tool_new_${++nextId}`;
        tools[id] = { ...(JSON.parse(raw) as Record<string, unknown>), id };
        return send(200, { id });
      }
      if (agentMatch) {
        const id = agentMatch[1]!;
        if (!agents[id]) return send(404, { detail: "agent not found" });
        if (req.method === "PATCH") {
          agents[id] = { ...agents[id], ...(JSON.parse(raw) as Record<string, unknown>), agent_id: id };
          return send(200, agents[id]);
        }
        if (req.method === "DELETE") {
          delete agents[id];
          return send(200, {});
        }
        return send(200, agents[id]);
      }
      if (toolMatch) {
        const id = toolMatch[1]!;
        if (!tools[id]) return send(404, { detail: "tool not found" });
        if (req.method === "PATCH") {
          tools[id] = { ...tools[id], ...(JSON.parse(raw) as Record<string, unknown>), id };
          return send(200, tools[id]);
        }
        if (req.method === "DELETE") {
          delete tools[id];
          return send(200, {});
        }
        return send(200, tools[id]);
      }
      send(404, { detail: "no route" });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function cfg(overrides: Record<string, string> = {}): VoiceConfig {
  return readVoiceEnv({ ELEVENLABS_API_KEY: "xi-test", ELEVENLABS_API_BASE: base, ...overrides });
}

// ── the desired configuration (pure) ─────────────────────────────────────────

describe("the desired agent configuration", () => {
  it("points the tool at this deployment's /api/v1/voice-answer, not the old path", () => {
    expect(toolUrl("https://arag-voice-bridge.fly.dev")).toBe(
      "https://arag-voice-bridge.fly.dev/api/v1/voice-answer",
    );
    expect(toolUrl("https://example.com/")).toBe("https://example.com/api/v1/voice-answer");
  });

  it("carries the deployment's API key as the X-API-Key header", () => {
    const tool = desiredTool({
      publicUrl: "https://x.test",
      prospect: "acme",
      timeoutMs: 8000,
      apiKeySecret: "vbk_secret",
    });
    expect(tool.headers).toEqual({ "X-API-Key": "vbk_secret" });
    expect(tool.method).toBe("POST");
    // Without a key there is no header at all — an empty one would fail auth confusingly.
    expect(desiredTool({ publicUrl: "https://x.test", prospect: "acme", timeoutMs: 8000 }).headers).toEqual(
      {},
    );
  });

  it("pins the prospect key into the tool's body schema", () => {
    const tool = desiredTool({ publicUrl: "https://x.test", prospect: "acme", timeoutMs: 8000 });
    const props = (tool.bodySchema as { properties: Record<string, { description: string }> }).properties;
    expect(props.prospect!.description).toContain('"acme"');
  });

  /**
   * Regression for a live 422: the Agents API rejects a tool whose request-body schema has any
   * property without a `description` — nested ones included. Found by `make agent-check`.
   */
  it("gives every property in the body schema a description, at every depth", () => {
    const schema = desiredTool({ publicUrl: "https://x.test", prospect: "acme", timeoutMs: 8000 })
      .bodySchema as Record<string, unknown>;
    const walk = (node: Record<string, unknown>, path: string): void => {
      const props = node.properties as Record<string, Record<string, unknown>> | undefined;
      for (const [key, value] of Object.entries(props ?? {})) {
        expect(typeof value.description).toBe("string");
        expect(String(value.description).length).toBeGreaterThan(0);
        walk(value, `${path}/${key}`);
        if (value.items) walk(value.items as Record<string, unknown>, `${path}/${key}[]`);
      }
    };
    walk(schema, "");
  });

  it("uses the generated router prompt unless the prospect overrides it", () => {
    expect(effectiveSystemPrompt(PROSPECT)).toBe(systemPrompt("Acme"));
    expect(effectiveSystemPrompt({ ...PROSPECT, system_prompt: "  Say hello.  " })).toBe("Say hello.");
  });

  it("falls back to the deployment's agent id and voice when the prospect has none", () => {
    const wanted = desiredAgent(
      { ...PROSPECT, agent_id: undefined, voice_id: undefined },
      cfg({ VOICE_DEFAULT_AGENT_ID: "agent_default", ELEVENLABS_TTS_VOICE_ID: "voice_default" }),
      "https://x.test",
    );
    expect(wanted.agentId).toBe("agent_default");
    expect(wanted.voiceId).toBe("voice_default");
    expect(wanted.language).toBe("en");
  });

  it("describes the agent for the UI without ever including the key value", () => {
    const view = voiceAgentConfig(PROSPECT, cfg(), "https://x.test", {
      id: "key_1",
      name: "Agent key",
      prefix: "vbk_abc123",
    });
    expect(view.tool.headerNames).toEqual(["X-API-Key"]);
    expect(view.api_key!.prefix).toBe("vbk_abc123");
    expect(view.system_prompt_custom).toBe(false);
    // The editor needs to be able to say what clearing the override would give.
    expect(view.system_prompt_default).toBe(systemPrompt("Acme"));
    const overridden = voiceAgentConfig(
      { ...PROSPECT, system_prompt: "Say hello." },
      cfg(),
      "https://x.test",
    );
    expect(overridden.system_prompt).toBe("Say hello.");
    expect(overridden.system_prompt_default).toBe(systemPrompt("Acme"));
    expect(overridden.system_prompt_custom).toBe(true);
    expect(view.tool_id).toBe("tool_live_1");
    expect(JSON.stringify(view)).not.toContain("secret");
  });
});

// ── merge behaviour ──────────────────────────────────────────────────────────

describe("merging into what the remote already has", () => {
  const tool = desiredTool({
    publicUrl: "https://x.test",
    prospect: "acme",
    timeoutMs: 8000,
    apiKeySecret: "vbk_secret",
  });

  it("keeps headers it does not own and replaces the one it does", () => {
    const body = toolConfigBody(tool, {
      tool_config: { api_schema: { request_headers: { "X-Trace": "keep", "x-api-key": "stale" } } },
    });
    const headers = (body.tool_config as { api_schema: { request_headers: Record<string, string> } })
      .api_schema.request_headers;
    expect(headers["X-Trace"]).toBe("keep");
    expect(headers["X-API-Key"]).toBe("vbk_secret");
    // The stale entry under a different casing is replaced, not duplicated.
    expect(Object.keys(headers)).toHaveLength(2);
  });

  it("handles the list-of-objects header shape as well as the map shape", () => {
    const body = toolConfigBody(tool, {
      tool_config: {
        api_schema: {
          request_headers: [
            { type: "value", name: "X-Trace", value: "keep" },
            { type: "value", name: "X-API-Key", value: "stale" },
          ],
        },
      },
    });
    const headers = (
      body.tool_config as { api_schema: { request_headers: Array<{ name: string; value: string }> } }
    ).api_schema.request_headers;
    expect(headers).toHaveLength(2);
    expect(headers.find((h) => h.name === "X-Trace")!.value).toBe("keep");
    expect(headers.find((h) => h.name === "X-API-Key")!.value).toBe("vbk_secret");
  });

  it("converts the timeout to the seconds the API wants", () => {
    const body = toolConfigBody({ ...tool, timeoutMs: 8000 });
    expect((body.tool_config as { response_timeout_secs: number }).response_timeout_secs).toBe(8);
  });

  it("adds the tool to the agent's tool list without dropping the others", () => {
    const wanted = desiredAgent(PROSPECT, cfg(), "https://x.test", "vbk_secret");
    const body = agentPatchBody(
      wanted,
      { conversation_config: { agent: { prompt: { tool_ids: ["tool_other"], llm: "gpt-4o-mini" } } } },
      "tool_live_1",
    );
    const prompt = (
      body.conversation_config as { agent: { prompt: { tool_ids: string[]; llm: string; prompt: string } } }
    ).agent.prompt;
    expect(prompt.tool_ids).toEqual(["tool_other", "tool_live_1"]);
    // Settings this product does not own survive.
    expect(prompt.llm).toBe("gpt-4o-mini");
    expect(prompt.prompt).toContain("router");
  });

  /**
   * Regression for a live 400: a GET returns both the deprecated inline `tools` array and
   * `tool_ids`, and sending both back is refused ("Cannot specify both tools and tool IDs").
   */
  it("drops the deprecated inline tools array when it sets tool_ids", () => {
    const wanted = desiredAgent(PROSPECT, cfg(), "https://x.test", "vbk_secret");
    const body = agentPatchBody(
      wanted,
      {
        conversation_config: {
          agent: { prompt: { tools: [{ name: "voice_answer", type: "webhook" }], tool_ids: [] } },
        },
      },
      "tool_live_1",
    );
    const prompt = (body.conversation_config as { agent: { prompt: Record<string, unknown> } }).agent.prompt;
    expect(prompt.tool_ids).toEqual(["tool_live_1"]);
    expect("tools" in prompt).toBe(false);
  });

  it("does not touch the voice when the deployment has no opinion about it", () => {
    const wanted = desiredAgent({ ...PROSPECT, voice_id: undefined }, cfg(), "https://x.test");
    const body = agentPatchBody(wanted, { conversation_config: { tts: { voice_id: "keep_me" } } });
    expect((body.conversation_config as { tts: { voice_id: string } }).tts.voice_id).toBe("keep_me");
  });
});

// ── reading and summarising ──────────────────────────────────────────────────

describe("reading the remote", () => {
  it("normalises both header shapes to names only", () => {
    expect(headerNames({ "X-API-Key": "secret", Accept: "json" })).toEqual(["X-API-Key", "Accept"]);
    expect(headerNames([{ name: "X-API-Key", value: "secret" }])).toEqual(["X-API-Key"]);
    expect(headerNames(undefined)).toEqual([]);
  });

  it("never carries a header value out of a tool summary", () => {
    const summary = summariseTool({
      id: "t",
      tool_config: { api_schema: { request_headers: { "X-API-Key": "super-secret" } } },
    });
    expect(summary.has_api_key_header).toBe(true);
    expect(JSON.stringify(summary)).not.toContain("super-secret");
  });

  it("survives a payload that is missing everything", () => {
    expect(summariseAgent({}).found).toBe(true);
    expect(summariseTool({}).header_names).toEqual([]);
  });

  it("reports a missing agent as not found rather than throwing", async () => {
    const agent = await getAgent(cfg(), "agent_nope");
    expect(agent.found).toBe(false);
    expect(agent.error).toContain("No such agent");
    expect((await getTool(cfg(), "tool_nope")).found).toBe(false);
  });

  it("503s when ElevenLabs is not configured at all", async () => {
    const agent = await getAgent(readVoiceEnv({}), "agent_live_1");
    expect(agent.found).toBe(false);
    expect(agent.error).toContain("not configured");
    expect(new AgentError("x", 500).name).toBe("AgentError");
  });
});

// ── the push ─────────────────────────────────────────────────────────────────

describe("pushing to ElevenLabs", () => {
  it("fixes exactly what the live agent has wrong: the tool path and the missing header", async () => {
    reset();
    const wanted = desiredAgent(PROSPECT, cfg(), "https://arag-voice-bridge.fly.dev", "vbk_secret");
    const result = await pushAgent(cfg(), wanted);

    expect(result.created_agent).toBe(false);
    expect(result.created_tool).toBe(false);
    expect(result.tool_id).toBe("tool_live_1");

    const api = (tools.tool_live_1!.tool_config as { api_schema: Record<string, unknown> }).api_schema;
    expect(api.url).toBe("https://arag-voice-bridge.fly.dev/api/v1/voice-answer");
    expect((api.request_headers as Record<string, string>)["X-API-Key"]).toBe("vbk_secret");
    // The unrelated header the tool already carried is still there.
    expect((api.request_headers as Record<string, string>)["X-Trace"]).toBe("keep-me");

    const conv = agents.agent_live_1!.conversation_config as {
      agent: { first_message: string; prompt: { prompt: string; tool_ids: string[]; llm: string } };
      turn: { turn_timeout: number };
      tts: { voice_id: string; model_id: string };
    };
    expect(conv.agent.first_message).toBe("Acme support, how can I help?");
    expect(conv.agent.prompt.prompt).toContain("Acme");
    expect(conv.agent.prompt.tool_ids).toEqual(["tool_other", "tool_live_1"]);
    // Untouched configuration survived the push.
    expect(conv.turn.turn_timeout).toBe(7);
    expect(conv.tts.model_id).toBe("eleven_flash_v2_5");
    expect(result.applied).toContain("tool.request_headers");
  });

  it("authenticates every call with the server-side key and never in the URL", async () => {
    reset();
    await pushAgent(cfg(), desiredAgent(PROSPECT, cfg(), "https://x.test", "vbk_secret"));
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c.apiKey).toBe("xi-test");
      expect(c.path).not.toContain("xi-test");
    }
    // The tool is written before the agent, because the agent references it by id.
    const first = calls.find((c) => c.method === "PATCH")!;
    expect(first.path).toContain("/tools/");
  });

  it("creates the tool and the agent when neither exists yet", async () => {
    reset();
    const wanted = desiredAgent(
      { ...PROSPECT, agent_id: "", tool_id: undefined },
      cfg(),
      "https://x.test",
      "vbk_secret",
    );
    const result = await pushAgent(cfg(), wanted);
    expect(result.created_tool).toBe(true);
    expect(result.created_agent).toBe(true);
    expect(result.tool_id!.startsWith("tool_new_")).toBe(true);
    expect(result.agent.agent_id!.startsWith("agent_new_")).toBe(true);
    expect(result.agent.first_message).toBe("Acme support, how can I help?");
  });

  it("recreates an object the remote no longer has instead of failing the push", async () => {
    reset();
    const wanted = desiredAgent(
      { ...PROSPECT, tool_id: "tool_deleted", agent_id: "agent_deleted" },
      cfg(),
      "https://x.test",
      "vbk_secret",
    );
    const result = await pushAgent(cfg(), wanted);
    expect(result.created_tool).toBe(true);
    expect(result.created_agent).toBe(true);
  });

  /**
   * A validation failure from the Agents API quotes the request that caused it, and the request we
   * send carries two secrets: the ElevenLabs key, and this deployment's own API key as the value
   * of the tool's X-API-Key header. The error message reaches a browser and the log.
   */
  it("never lets a secret come back inside an upstream error message", async () => {
    // Reads succeed; the write that carries the secrets is the one that fails, echoing the body.
    const echoing: typeof fetch = async (_url, init) => {
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
      if (!init?.body) return json({ id: "tool_live_1", tool_config: {} });
      return json({ detail: [{ msg: "Value error", input: JSON.parse(String(init.body)) }] }, 422);
    };
    const wanted = desiredAgent(PROSPECT, cfg(), "https://x.test", "vbk_the_deployments_own_key");
    let message = "";
    try {
      await pushAgent(cfg(), wanted, echoing);
    } catch (err) {
      message = (err as AgentError).message;
    }
    expect(message).toContain("422");
    expect(message).not.toContain("vbk_the_deployments_own_key");
    expect(message).not.toContain("xi-test");
    expect(message).toContain("•••");
  });

  it("redacts only values long enough to be a secret", () => {
    expect(redactSecrets("the url is /api/v1 and the key is abcdefghij", ["abcdefghij"])).toBe(
      "the url is /api/v1 and the key is •••",
    );
    // A short value is not treated as a secret at all, so an error message stays readable.
    expect(redactSecrets("POST /v1/convai/tools", [])).toBe("POST /v1/convai/tools");
  });

  it("surfaces an upstream failure with its status, not as a silent success", async () => {
    reset();
    const wanted = desiredAgent(PROSPECT, cfg(), "https://x.test", "vbk_secret");
    let status = 0;
    try {
      await pushAgent(readVoiceEnv({ ELEVENLABS_API_KEY: "wrong", ELEVENLABS_API_BASE: base }), wanted);
    } catch (err) {
      status = (err as AgentError).status ?? 0;
    }
    expect(status).toBe(401);
  });

  /**
   * Regression: deleting a tool an agent still references is a 409 unless `force` is set, so the
   * default is forced — the caller always means it.
   */
  it("force-deletes a tool by default, and can be asked not to", async () => {
    reset();
    await deleteTool(cfg(), "tool_live_1");
    expect(calls.at(-1)!.path).toBe("/v1/convai/tools/tool_live_1");
    const forced = calls.at(-1)!;
    expect(forced.method).toBe("DELETE");
    reset();
    tools.tool_keep = { id: "tool_keep", tool_config: {} };
    let seen = "";
    await deleteTool(
      cfg(),
      "tool_keep",
      async (url) => {
        seen = url;
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      },
      { force: false },
    );
    expect(seen).not.toContain("force=true");
  });

  it("deletes a throwaway agent and tool cleanly", async () => {
    reset();
    const wanted = desiredAgent({ ...PROSPECT, agent_id: "", tool_id: undefined }, cfg(), "https://x.test");
    const result = await pushAgent(cfg(), wanted);
    await deleteAgent(cfg(), result.agent.agent_id!);
    await deleteTool(cfg(), result.tool_id!);
    expect((await getAgent(cfg(), result.agent.agent_id!)).found).toBe(false);
    expect((await getTool(cfg(), result.tool_id!)).found).toBe(false);
  });
});

// ── the diff ─────────────────────────────────────────────────────────────────

describe("the desired-versus-actual diff", () => {
  it("reports the live agent's two real problems before anything is pushed", async () => {
    reset();
    const wanted = desiredAgent(PROSPECT, cfg(), "https://arag-voice-bridge.fly.dev", "vbk_secret");
    const diff = agentDiff(
      wanted,
      await getAgent(cfg(), "agent_live_1"),
      await getTool(cfg(), "tool_live_1"),
    );
    const by = Object.fromEntries(diff.map((d) => [d.field, d]));
    expect(by.tool_url!.matches).toBe(false);
    expect(by.tool_url!.remote).toContain("/v1/voice-answer");
    expect(by.tool_api_key_header!.matches).toBe(false);
    expect(by.tool_api_key_header!.remote).toBe("missing");
    expect(by.tool_linked!.matches).toBe(false);
  });

  it("reports everything in sync after a push", async () => {
    reset();
    const wanted = desiredAgent(PROSPECT, cfg(), "https://arag-voice-bridge.fly.dev", "vbk_secret");
    await pushAgent(cfg(), wanted);
    const diff = agentDiff(
      wanted,
      await getAgent(cfg(), "agent_live_1"),
      await getTool(cfg(), "tool_live_1"),
    );
    const failing = diff.filter((d) => !d.matches).map((d) => d.field);
    expect(failing).toEqual([]);
  });
});
