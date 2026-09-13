/**
 * Opt-in LIVE check of the ElevenLabs Agents integration.
 *
 *   make agent-check              # needs ELEVENLABS_API_KEY in the environment or .env
 *
 * It creates a *throwaway* agent and custom server tool, pushes this deployment's desired
 * configuration to them, reads them back, pushes a second time to exercise the patch path, and
 * then deletes both. It refuses to touch an agent id passed in from the registry: a live agent is
 * changed only from the product's own Settings screen, never by a script.
 *
 * This is the check that found the three things the unit tests could not:
 *   1. every property in `request_body_schema` must carry a `description` (422 otherwise);
 *   2. a GET returns both the deprecated inline `tools` array and `tool_ids`, and sending both
 *      back is rejected — the patch must drop the inline copy;
 *   3. deleting a tool an agent still references needs `?force=true`.
 *
 * Never prints the key. Exits non-zero on the first failure, after trying to clean up.
 */
import { readVoiceEnv } from "../src/config.ts";
import { deleteAgent, deleteTool, getAgent, getTool, pushAgent } from "../src/services/elevenAgent.ts";
import { desiredAgent } from "../src/services/voiceAgent.ts";
import type { ProspectRecord } from "../src/types.ts";
import { loadDotEnv } from "../vendor/arag-platform/src/index.ts";

loadDotEnv();
const cfg = readVoiceEnv();
if (!cfg.elevenLabsApiKey) {
  console.error("ELEVENLABS_API_KEY is not set — nothing to check.");
  process.exit(1);
}

/** A prospect that exists only for this check. Its agent id is deliberately empty. */
const throwaway: ProspectRecord = {
  id: "throwaway",
  createdAt: "",
  updatedAt: "",
  display_name: "VoiceBridge throwaway check",
  region: cfg.aragRegionDefault,
  locale: "en-GB",
  greeting: "Throwaway greeting, please delete me.",
  handoff_msg: "Throwaway handoff.",
};

const publicUrl = process.env.PUBLIC_URL || "https://arag-voice-bridge.example";
// Blank the deployment's default agent id as well as the prospect's: this check must create its
// own agent, never adopt the one the deployment actually uses.
const throwawayCfg = { ...cfg, defaultAgentId: "" };
const wanted = desiredAgent(
  { ...throwaway, agent_id: "" },
  throwawayCfg,
  publicUrl,
  "vbk_throwaway_not_a_real_key",
);
if (wanted.agentId || wanted.toolId) {
  console.error("Refusing to run: the desired configuration names an existing agent or tool.");
  process.exit(1);
}

const fail = (why: string): never => {
  console.error(`✗ ${why}`);
  process.exit(1);
};

let agentId = "";
let toolId = "";
try {
  console.log("→ creating a throwaway tool and agent…");
  const created = await pushAgent(throwawayCfg, wanted);
  agentId = created.agent.agent_id ?? "";
  toolId = created.tool_id ?? "";
  if (!created.created_agent || !created.created_tool) fail("expected both objects to be created");
  console.log(`  agent ${agentId}\n  tool  ${toolId}`);

  const tool = await getTool(cfg, toolId);
  const agent = await getAgent(cfg, agentId);
  console.log("← read back");
  console.log(`  tool url      ${tool.url}`);
  console.log(`  tool headers  ${(tool.header_names ?? []).join(", ") || "(none)"}`);
  console.log(`  tool timeout  ${tool.timeout_secs}s`);
  console.log(`  greeting      ${agent.first_message}`);
  console.log(`  tool linked   ${(agent.tool_ids ?? []).includes(toolId)}`);

  if (tool.url !== `${publicUrl}/api/v1/voice-answer`) fail(`tool URL is ${tool.url}`);
  if (!tool.has_api_key_header) fail("the tool carries no X-API-Key header");
  if (agent.first_message !== throwaway.greeting) fail("the greeting did not take");
  if (!(agent.tool_ids ?? []).includes(toolId)) fail("the tool is not linked to the agent");

  console.log("→ pushing again (the patch path, and idempotence)…");
  const again = await pushAgent(throwawayCfg, { ...wanted, agentId, toolId });
  if (again.created_agent || again.created_tool) fail("the second push created new objects");
  if ((again.agent.tool_ids ?? []).filter((t) => t === toolId).length !== 1) {
    fail("the second push duplicated the tool link");
  }
  console.log("  unchanged, as it should be");
} finally {
  console.log("→ deleting the throwaway objects…");
  if (agentId) await deleteAgent(cfg, agentId).catch((e) => console.error(`  agent: ${e.message}`));
  if (toolId) await deleteTool(cfg, toolId).catch((e) => console.error(`  tool: ${e.message}`));
  if (agentId && (await getAgent(cfg, agentId)).found) console.error(`  ⚠ agent ${agentId} still exists`);
  if (toolId && (await getTool(cfg, toolId)).found) console.error(`  ⚠ tool ${toolId} still exists`);
}
console.log("\n✓ the ElevenLabs Agents integration works against the live API");
