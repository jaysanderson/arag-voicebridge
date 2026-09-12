/**
 * The ElevenLabs Agents (Conversational AI) configuration for a prospect.
 *
 * VoiceBridge is not a voice platform: the agent lives in ElevenLabs and calls
 * `POST /api/v1/voice-answer` as a custom server tool, so every spoken answer still comes from the
 * Knowledge Box. Everything a partner has to paste into the ElevenLabs dashboard is derived here,
 * from the registry entry and the deployment's own configuration, so the product can show it
 * rather than sending people to a document.
 *
 * The canonical prose lives in docs/developer/examples.md — this module is the machine-readable
 * twin of that section, and the two must be changed together.
 */
import type { VoiceConfig } from "../config.ts";
import type { ProspectRecord } from "../types.ts";

export interface VoiceAgentTool {
  name: string;
  method: string;
  url: string;
  timeoutMs: number;
  bodySchema: Record<string, unknown>;
}

export interface VoiceAgentConfig {
  prospect: string;
  display_name: string;
  provider: "elevenlabs";
  /** Non-secret agent identifier. Null when this prospect has no agent wired yet. */
  agent_id: string | null;
  /** True once the agent id is a real one (not the example registry's placeholder). */
  ready: boolean;
  configured: boolean;
  voice_id: string | null;
  greeting: string;
  handoff_msg: string;
  tool: VoiceAgentTool;
  system_prompt: string;
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

/** The custom server tool the agent calls, exactly as the ElevenLabs dashboard wants it. */
export function toolDefinition(publicUrl: string, prospect: string, timeoutMs: number): VoiceAgentTool {
  return {
    name: "voice_answer",
    method: "POST",
    url: `${publicUrl.replace(/\/$/, "")}/api/v1/voice-answer`,
    timeoutMs,
    bodySchema: {
      type: "object",
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
            properties: {
              author: { type: "string", enum: ["USER", "NUCLIA"] },
              text: { type: "string" },
            },
          },
        },
      },
    },
  };
}

/** Everything the Settings view and the Live call tool need to describe this prospect's agent. */
export function voiceAgentConfig(
  prospect: ProspectRecord,
  voice: VoiceConfig,
  publicUrl: string,
): VoiceAgentConfig {
  const agentId = prospect.agent_id?.trim() || "";
  const placeholder = /REPLACE_ME/i.test(agentId);
  return {
    prospect: prospect.id,
    display_name: prospect.display_name,
    provider: "elevenlabs",
    agent_id: agentId ? agentId : null,
    ready: Boolean(agentId) && !placeholder,
    configured: Boolean(voice.elevenLabsApiKey),
    voice_id: prospect.voice_id?.trim() || voice.ttsVoiceId || null,
    greeting: prospect.greeting,
    handoff_msg: prospect.handoff_msg,
    tool: toolDefinition(publicUrl, prospect.id, voice.agentToolTimeoutMs),
    system_prompt: systemPrompt(prospect.display_name),
    docs_url: "/api/v1/docs",
  };
}
