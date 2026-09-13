/**
 * A mock of the ElevenLabs Agents API, for Exercise 9.
 *
 * VoiceBridge configures its voice agent by talking to ElevenLabs directly
 * (`src/services/elevenAgent.ts`): it reads the agent and its custom server tool, diffs them
 * against what this deployment wants, and pushes the difference. Doing that against the real API
 * needs a paid account, and `make agent-check` — which does exactly that against a *throwaway*
 * agent — is deliberately opt-in for the same reason.
 *
 * This server stands in for it. It speaks the six routes the product actually uses, stores what it
 * is sent so a PATCH can be read back like the real thing, and records every call so the exercise
 * can assert on the requests rather than only on the responses.
 *
 *   node enablement/developer-track/starter/mock-elevenlabs.ts          # listens on :8791
 *   PORT=9000 XI_KEY=my-key node .../mock-elevenlabs.ts                 # or pick your own
 *
 * Routes (the product's half of the contract — see the header of `src/services/elevenAgent.ts`):
 *   GET    /v1/convai/agents/{id}     → the stored agent
 *   PATCH  /v1/convai/agents/{id}     ← a partial conversation_config, merged
 *   POST   /v1/convai/agents/create   ← a new agent, returns { agent_id }
 *   GET    /v1/convai/tools/{id}      → the stored tool
 *   PATCH  /v1/convai/tools/{id}      ← a partial tool_config, merged
 *   POST   /v1/convai/tools           ← a new tool, returns { id }
 *   GET    /v1/voices                 → two voices, so Settings can populate its voice picker
 *
 * Four extras that are not ElevenLabs routes, for the exercise only:
 *   GET    /__calls                   → every request received, in order, with its body
 *   DELETE /__calls                   → forget them
 *   GET    /__state                   → the agents and tools this server is holding right now
 *   POST   /__reset                   → back to the hand-wired starting state, calls cleared
 *
 * It starts with one agent (`agent_lab_1`) and one tool (`tool_lab_1`) already in it, wired by
 * hand the way a partner would have wired them in the dashboard before the product existed.
 *
 * It also reproduces the one live-API constraint you can trip from the product
 * (`DECISIONS.md` V-28): an agent PATCH carrying **both** a `tools` array and `tool_ids` is
 * refused with a 400, exactly as the real API refuses it. `pushAgent()` drops the deprecated
 * inline copy, so a correct push never sees this — set MOCK_STRICT=0 to switch the check off if
 * you want to see what the failure looks like from the other side.
 *
 * Zero dependencies, like the product. Node 22.18+ runs it directly.
 */
import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 8791);
const XI_KEY = process.env.XI_KEY ?? "xi-lab";
const STRICT = process.env.MOCK_STRICT !== "0";

interface Call {
  method: string;
  path: string;
  /** Present so you can see the product sends the key on every call — never the key itself. */
  keyOk: boolean;
  body: unknown;
}

const calls: Call[] = [];
let nextId = 0;

/**
 * The server starts with one agent and one tool already in it, as if a partner had wired them by
 * hand in the ElevenLabs dashboard before the product existed: an old greeting, an old prompt, the
 * tool pointing at a stale URL with no `X-API-Key` header at all — and, crucially, a `turn` block
 * this product does not own. Bringing that agent under the product's control without destroying
 * the hand-tuning is the whole point of Exercise 9.
 */
function seedAgents(): Record<string, Record<string, unknown>> {
  return {
    agent_lab_1: {
      agent_id: "agent_lab_1",
      name: "Hand-wired lab agent",
      conversation_config: {
        // Nothing in VoiceBridge owns turn-taking. It must survive every push untouched.
        turn: { turn_timeout: 7, mode: "silence" },
        agent: {
          first_message: "Hello, you've reached the lab. How can I help?",
          prompt: { prompt: "Be helpful and answer from what you know.", llm: "gpt-4o-mini" },
        },
        tts: { voice_id: "voice_lab_2", model_id: "eleven_flash_v2_5" },
      },
    },
  };
}

function seedTools(): Record<string, Record<string, unknown>> {
  return {
    tool_lab_1: {
      id: "tool_lab_1",
      tool_config: {
        type: "webhook",
        name: "voice_answer",
        description: "Ask the bridge.",
        response_timeout_secs: 20,
        api_schema: {
          // The stale state: an old path, and no API key header.
          url: "https://example.invalid/v1/voice-answer",
          method: "POST",
          request_headers: { "X-Trace": "keep-me" },
          request_body_schema: { type: "object" },
        },
      },
    },
  };
}

let agents = seedAgents();
let tools = seedTools();

const json = (v: unknown) => JSON.stringify(v);

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * A PATCH on the real API merges into the stored object rather than replacing it, and it merges
 * all the way down — that is exactly why VoiceBridge can send only the fields it owns. A shallow
 * merge here would wipe `conversation_config.turn` on the first push and make the exercise teach
 * the opposite of the truth, so the mock merges deeply too.
 */
function deepMerge(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    const existing = out[k];
    out[k] = isObj(existing) && isObj(v) ? deepMerge(existing, v) : v;
  }
  return out;
}

const server = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c) => chunks.push(c as Buffer));
  req.on("end", () => {
    const raw = Buffer.concat(chunks).toString("utf8");
    const path = (req.url ?? "").split("?")[0] ?? "";
    const method = req.method ?? "GET";
    const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
    const keyOk = req.headers["xi-api-key"] === XI_KEY;

    const send = (status: number, payload: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(json(payload));
      console.log(`${status} ${method} ${path}`);
    };

    if (path === "/__calls") {
      if (method === "DELETE") {
        calls.length = 0;
        return send(200, { ok: true });
      }
      return send(200, { items: calls });
    }

    if (path === "/__state") return send(200, { agents, tools });

    if (path === "/__reset") {
      agents = seedAgents();
      tools = seedTools();
      calls.length = 0;
      nextId = 0;
      return send(200, { ok: true });
    }

    calls.push({ method, path, keyOk, body });

    // The real API answers 401 to a wrong or missing key, on every route.
    if (!keyOk) return send(401, { detail: "invalid xi-api-key" });

    if (path === "/v1/voices" && method === "GET") {
      return send(200, {
        voices: [
          { voice_id: "voice_lab_1", name: "Lab voice one" },
          { voice_id: "voice_lab_2", name: "Lab voice two" },
        ],
      });
    }

    if (path === "/v1/convai/agents/create" && method === "POST") {
      const id = `agent_mock_${++nextId}`;
      agents[id] = { ...(body ?? {}), agent_id: id };
      return send(200, { agent_id: id });
    }

    if (path === "/v1/convai/tools" && method === "POST") {
      const id = `tool_mock_${++nextId}`;
      tools[id] = { ...(body ?? {}), id };
      return send(200, { id });
    }

    const agentMatch = /^\/v1\/convai\/agents\/([^/]+)$/.exec(path);
    if (agentMatch) {
      const id = agentMatch[1] as string;
      const stored = agents[id];
      if (!stored) return send(404, { detail: "agent not found" });
      if (method === "PATCH") {
        const conv = (body?.conversation_config ?? {}) as Record<string, unknown>;
        const agent = (conv.agent ?? {}) as Record<string, unknown>;
        const prompt = (agent.prompt ?? {}) as Record<string, unknown>;
        if (STRICT && "tools" in prompt && "tool_ids" in prompt) {
          return send(400, { detail: "Cannot specify both tools and tool IDs" });
        }
        agents[id] = { ...deepMerge(stored, body ?? {}), agent_id: id };
        return send(200, agents[id]);
      }
      if (method === "DELETE") {
        delete agents[id];
        return send(200, {});
      }
      return send(200, stored);
    }

    const toolMatch = /^\/v1\/convai\/tools\/([^/]+)$/.exec(path);
    if (toolMatch) {
      const id = toolMatch[1] as string;
      const stored = tools[id];
      if (!stored) return send(404, { detail: "tool not found" });
      if (method === "PATCH") {
        tools[id] = { ...deepMerge(stored, body ?? {}), id };
        return send(200, tools[id]);
      }
      if (method === "DELETE") {
        delete tools[id];
        return send(200, {});
      }
      return send(200, stored);
    }

    send(404, { detail: `no route for ${method} ${path}` });
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`mock ElevenLabs listening on http://127.0.0.1:${PORT} (xi-api-key: ${XI_KEY})`);
});
