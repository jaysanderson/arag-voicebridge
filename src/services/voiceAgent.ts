/**
 * The ElevenLabs Agents (Conversational AI) configuration for a prospect.
 *
 * VoiceBridge is not a voice platform: the agent lives in ElevenLabs and calls
 * `POST /api/v1/voice-answer` as a custom server tool, so every spoken answer still comes from the
 * Knowledge Box. This module derives the *desired* configuration — agent id, tool URL, the
 * `X-API-Key` header the tool must send, voice, greeting, handoff line and router prompt — from
 * the registry entry and the deployment's own settings.
 *
 * `src/services/elevenAgent.ts` is the half that reads and writes ElevenLabs; this half is the
 * half that decides what the answer should be, and it stays pure so it can be unit-tested and
 * shown in the UI without touching the network.
 *
 * The canonical prose lives in docs/developer/examples.md — this module is the machine-readable
 * twin of that section, and the two must be changed together.
 */
import type { VoiceConfig } from "../config.ts";
import type { ProspectRecord } from "../types.ts";
import type { DesiredAgent, DesiredTool } from "./elevenAgent.ts";

export interface VoiceAgentTool {
  name: string;
  method: string;
  url: string;
  timeoutMs: number;
  /** Header names the tool sends. The API-key value is never included here. */
  headerNames: string[];
  bodySchema: Record<string, unknown>;
}

export interface VoiceAgentConfig {
  prospect: string;
  display_name: string;
  provider: "elevenlabs";
  /** Non-secret agent identifier. Null when this prospect has no agent wired yet. */
  agent_id: string | null;
  /** The custom server tool's id in ElevenLabs, once one exists. */
  tool_id: string | null;
  /** True once the agent id is a real one (not the example registry's placeholder). */
  ready: boolean;
  configured: boolean;
  voice_id: string | null;
  greeting: string;
  handoff_msg: string;
  tool: VoiceAgentTool;
  system_prompt: string;
  /**
   * What an empty override would give. The editor needs this to answer "what does clearing this
   * do?" without making the operator clear it and save to find out.
   */
  system_prompt_default: string;
  /** True when the prompt is this prospect's own text rather than the generated default. */
  system_prompt_custom: boolean;
  /** Which stored API key the tool's X-API-Key header carries (id and prefix, never the secret). */
  api_key: { id: string; name: string; prefix: string } | null;
  docs_url: string;
}

/** The agent-level system prompt. The agent is a router; the tool's answer is the product. */
export function systemPrompt(displayName: string): string {
  return [
    `You are the voice for ${displayName} support. You are a router, not the answer source.`,
    "",
    "For ANY factual or support question, you MUST call the `voice_answer` tool. Do not answer",
    "factual questions from your own knowledge — you don't have the knowledge base, the tool does.",
    "",
    "When the tool returns, speak its `answer` field VERBATIM. Do not rephrase, summarise, expand,",
    "add to it, or read out any URLs. If the tool returns handoff = true, speak the answer (it is",
    "the handoff line) warmly and hand the caller to a human.",
    "",
    "Open the conversation with the configured greeting. Keep your own speech minimal — the tool's",
    "answer is the product.",
  ].join("\n");
}

/** The prospect's effective router prompt: its own override, else the generated default. */
export function effectiveSystemPrompt(prospect: ProspectRecord): string {
  return prospect.system_prompt?.trim() || systemPrompt(prospect.display_name);
}

export const TOOL_DESCRIPTION =
  "Answer the caller's question from the customer's Knowledge Box. Always call this for factual " +
  "or support questions and speak the `answer` field verbatim.";

/**
 * The tool's request body, as ElevenLabs wants it.
 *
 * Every property — including the nested ones inside `history` — carries a `description`. That is
 * not documentation polish: the Agents API rejects a tool whose schema has a property without one
 * ("Must set one of: description, dynamic_variable, is_system_provided, constant_value, or
 * is_omitted"), verified live against a throwaway agent.
 */
export function toolBodySchema(prospect: string): Record<string, unknown> {
  return {
    type: "object",
    description: "One caller turn to answer from the Knowledge Box.",
    required: ["prospect", "question"],
    properties: {
      prospect: { type: "string", description: `Always "${prospect}" for this agent.` },
      question: { type: "string", description: "The caller's most recent question, transcribed." },
      conversation_id: { type: "string", description: "The conversation id, for correlating logs." },
      history: {
        type: "array",
        description: "Recent prior turns; the bridge caps it to MAX_HISTORY_TURNS.",
        items: {
          type: "object",
          description: "One prior turn of the conversation.",
          properties: {
            author: {
              type: "string",
              description: 'Who spoke: "USER" for the caller, "NUCLIA" for the assistant.',
              enum: ["USER", "NUCLIA"],
            },
            text: { type: "string", description: "What was said, as transcribed." },
          },
        },
      },
    },
  };
}

export function toolUrl(publicUrl: string): string {
  return `${publicUrl.replace(/\/$/, "")}/api/v1/voice-answer`;
}

/**
 * The custom server tool, including the secret header.
 *
 * The header is the point of this pass: `/api/v1/voice-answer` is API-key protected as soon as
 * the deployment has any key, so an agent whose tool sends no `X-API-Key` gets a 401 and the
 * caller hears the handoff line on every turn. The key is passed in rather than read from a
 * store so this function stays pure and the caller decides which key to expose.
 */
export function desiredTool(opts: {
  publicUrl: string;
  prospect: string;
  timeoutMs: number;
  apiKeySecret?: string;
}): DesiredTool {
  return {
    name: "voice_answer",
    description: TOOL_DESCRIPTION,
    url: toolUrl(opts.publicUrl),
    method: "POST",
    timeoutMs: opts.timeoutMs,
    headers: opts.apiKeySecret ? { "X-API-Key": opts.apiKeySecret } : {},
    bodySchema: toolBodySchema(opts.prospect),
  };
}

/** The whole desired agent, ready to push. */
export function desiredAgent(
  prospect: ProspectRecord,
  voice: VoiceConfig,
  publicUrl: string,
  apiKeySecret?: string,
): DesiredAgent {
  return {
    agentId: prospect.agent_id?.trim() || voice.defaultAgentId || "",
    toolId: prospect.tool_id?.trim() || undefined,
    name: `${prospect.display_name} — VoiceBridge`,
    voiceId: prospect.voice_id?.trim() || voice.ttsVoiceId || undefined,
    language: (prospect.locale || "en").slice(0, 2),
    greeting: prospect.greeting,
    systemPrompt: effectiveSystemPrompt(prospect),
    tool: desiredTool({
      publicUrl,
      prospect: prospect.id,
      timeoutMs: voice.agentToolTimeoutMs,
      apiKeySecret,
    }),
  };
}

/** Everything the Settings view and the Live call tool need to describe this prospect's agent. */
export function voiceAgentConfig(
  prospect: ProspectRecord,
  voice: VoiceConfig,
  publicUrl: string,
  apiKey?: { id: string; name: string; prefix: string } | null,
): VoiceAgentConfig {
  const agentId = prospect.agent_id?.trim() || voice.defaultAgentId || "";
  const placeholder = /REPLACE_ME/i.test(agentId);
  const tool = desiredTool({
    publicUrl,
    prospect: prospect.id,
    timeoutMs: voice.agentToolTimeoutMs,
    apiKeySecret: apiKey ? "set" : undefined,
  });
  return {
    prospect: prospect.id,
    display_name: prospect.display_name,
    provider: "elevenlabs",
    agent_id: agentId ? agentId : null,
    tool_id: prospect.tool_id?.trim() || null,
    ready: Boolean(agentId) && !placeholder,
    configured: Boolean(voice.elevenLabsApiKey),
    voice_id: prospect.voice_id?.trim() || voice.ttsVoiceId || null,
    greeting: prospect.greeting,
    handoff_msg: prospect.handoff_msg,
    tool: {
      name: tool.name,
      method: tool.method,
      url: tool.url,
      timeoutMs: tool.timeoutMs,
      headerNames: Object.keys(tool.headers),
      bodySchema: tool.bodySchema,
    },
    system_prompt: effectiveSystemPrompt(prospect),
    system_prompt_default: systemPrompt(prospect.display_name),
    system_prompt_custom: Boolean(prospect.system_prompt?.trim()),
    api_key: apiKey ?? null,
    docs_url: "/api/v1/docs",
  };
}
