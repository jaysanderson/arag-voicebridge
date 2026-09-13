/**
 * The ElevenLabs Agents API — reading and writing the voice agent from inside the product.
 *
 * `src/services/voiceAgent.ts` computes what the agent *should* be (the router prompt, the custom
 * server tool, the greeting, the handoff line). This module is the other half: it reads what the
 * agent *is* in ElevenLabs, shows the difference, and pushes the desired configuration up. That
 * is the whole point of the pass — a partner wires a working voice call from Settings, without
 * ever opening the ElevenLabs dashboard.
 *
 * REST surface used (verified shapes):
 *   GET   /v1/convai/agents/{id}          → { name, conversation_config: { agent, tts } }
 *   PATCH /v1/convai/agents/{id}          ← partial conversation_config
 *   POST  /v1/convai/agents/create        ← { name, conversation_config }
 *   GET   /v1/convai/tools/{id}           → { id, tool_config: { name, api_schema, … } }
 *   PATCH /v1/convai/tools/{id}           ← { tool_config }
 *   POST  /v1/convai/tools                ← { tool_config }
 *
 * Everything is merged into what the remote already has rather than replaced, because an agent
 * carries far more configuration than this product owns (turn-taking, ASR, evaluation criteria)
 * and a blind PATCH of the whole object would silently reset it.
 */
import type { VoiceConfig } from "../config.ts";
import type { FetchLike } from "./scribe.ts";

export class AgentError extends Error {
  readonly status: number | undefined;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "AgentError";
    this.status = status;
  }
}

type Json = Record<string, unknown>;

const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});

/** The tool's HTTP contract, as this deployment needs ElevenLabs to call it. */
export interface DesiredTool {
  name: string;
  description: string;
  url: string;
  method: string;
  timeoutMs: number;
  /** Sent on every tool call. This is where the deployment's own API key goes. */
  headers: Record<string, string>;
  bodySchema: Record<string, unknown>;
}

/** Everything this product owns on an ElevenLabs agent. */
export interface DesiredAgent {
  agentId: string;
  toolId?: string;
  name: string;
  voiceId?: string;
  language?: string;
  greeting: string;
  systemPrompt: string;
  tool: DesiredTool;
}

/** What the remote actually has, reduced to the fields this product owns. */
export interface RemoteAgent {
  found: boolean;
  agent_id?: string;
  name?: string;
  first_message?: string;
  system_prompt?: string;
  voice_id?: string;
  language?: string;
  tool_ids?: string[];
  error?: string;
}

export interface RemoteTool {
  found: boolean;
  tool_id?: string;
  name?: string;
  url?: string;
  method?: string;
  timeout_secs?: number;
  /** Header names only, plus whether the API-key header carries a value. Never the value. */
  header_names?: string[];
  has_api_key_header?: boolean;
  error?: string;
}

export interface AgentDiffRow {
  field: string;
  label: string;
  local: string;
  remote: string;
  matches: boolean;
}

async function call(cfg: VoiceConfig, path: string, init: RequestInit, fetchImpl: FetchLike): Promise<Json> {
  if (!cfg.elevenLabsApiKey) throw new AgentError("ElevenLabs is not configured (no API key)", 503);
  const url = `${cfg.elevenLabsApiBase.replace(/\/$/, "")}${path}`;
  let res: Response;
  try {
    res = await fetchImpl(url, {
      ...init,
      headers: {
        "xi-api-key": cfg.elevenLabsApiKey,
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...(init.headers as Record<string, string> | undefined),
      },
    });
  } catch (err) {
    throw new AgentError(`ElevenLabs network error: ${(err as Error).message}`, 502);
  }
  const text = await res.text();
  if (!res.ok) {
    // The body can carry a useful validation message; it never carries our key.
    const detail = text.slice(0, 400).replace(/\s+/g, " ").trim();
    throw new AgentError(
      `${init.method ?? "GET"} ${path} -> HTTP ${res.status}${detail ? `: ${detail}` : ""}`,
      res.status,
    );
  }
  if (!text) return {};
  try {
    return JSON.parse(text) as Json;
  } catch {
    throw new AgentError(`ElevenLabs returned a non-JSON body for ${path}`, 502);
  }
}

// ── reading ──────────────────────────────────────────────────────────────────

/** Reduce an agent payload to the fields this product owns. */
export function summariseAgent(raw: Json): RemoteAgent {
  const conv = obj(raw.conversation_config);
  const agent = obj(conv.agent);
  const prompt = obj(agent.prompt);
  const tts = obj(conv.tts);
  return {
    found: true,
    agent_id: (raw.agent_id as string) ?? undefined,
    name: (raw.name as string) ?? undefined,
    first_message: (agent.first_message as string) ?? undefined,
    system_prompt: (prompt.prompt as string) ?? undefined,
    voice_id: (tts.voice_id as string) ?? undefined,
    language: (agent.language as string) ?? undefined,
    tool_ids: Array.isArray(prompt.tool_ids) ? (prompt.tool_ids as string[]) : undefined,
  };
}

/**
 * Header collections come back either as a map or as a list of `{ name, value }`. Normalise to
 * names only — the value is this deployment's API key and must never be echoed to a browser.
 */
export function headerNames(headers: unknown): string[] {
  if (Array.isArray(headers)) {
    return headers.map((h) => String(obj(h).name ?? "")).filter(Boolean);
  }
  return Object.keys(obj(headers));
}

export function summariseTool(raw: Json): RemoteTool {
  const cfgRaw = obj(raw.tool_config);
  const api = obj(cfgRaw.api_schema);
  const names = headerNames(api.request_headers);
  return {
    found: true,
    tool_id: (raw.id as string) ?? (raw.tool_id as string) ?? undefined,
    name: (cfgRaw.name as string) ?? undefined,
    url: (api.url as string) ?? undefined,
    method: (api.method as string) ?? undefined,
    timeout_secs: (cfgRaw.response_timeout_secs as number) ?? undefined,
    header_names: names,
    has_api_key_header: names.some((n) => n.toLowerCase() === "x-api-key"),
  };
}

export async function getAgent(
  cfg: VoiceConfig,
  agentId: string,
  fetchImpl: FetchLike = fetch,
): Promise<RemoteAgent> {
  try {
    return summariseAgent(await call(cfg, `/v1/convai/agents/${encodeURIComponent(agentId)}`, {}, fetchImpl));
  } catch (err) {
    const e = err as AgentError;
    if (e.status === 404) return { found: false, error: "No such agent in ElevenLabs" };
    return { found: false, error: e.message };
  }
}

export async function getTool(
  cfg: VoiceConfig,
  toolId: string,
  fetchImpl: FetchLike = fetch,
): Promise<RemoteTool> {
  try {
    return summariseTool(await call(cfg, `/v1/convai/tools/${encodeURIComponent(toolId)}`, {}, fetchImpl));
  } catch (err) {
    const e = err as AgentError;
    if (e.status === 404) return { found: false, error: "No such tool in ElevenLabs" };
    return { found: false, error: e.message };
  }
}

// ── writing ──────────────────────────────────────────────────────────────────

/** The `tool_config` body for a create or a merge-patch. */
export function toolConfigBody(tool: DesiredTool, existing: Json = {}): Json {
  const existingApi = obj(obj(existing.tool_config).api_schema);
  // Preserve header entries we do not own, in whichever shape the remote uses.
  let requestHeaders: unknown;
  if (Array.isArray(existingApi.request_headers)) {
    const kept = (existingApi.request_headers as unknown[]).filter(
      (h) =>
        !Object.keys(tool.headers).some((n) => n.toLowerCase() === String(obj(h).name ?? "").toLowerCase()),
    );
    requestHeaders = [
      ...kept,
      ...Object.entries(tool.headers).map(([name, value]) => ({ type: "value", name, value })),
    ];
  } else {
    const kept = obj(existingApi.request_headers);
    for (const name of Object.keys(kept)) {
      if (Object.keys(tool.headers).some((n) => n.toLowerCase() === name.toLowerCase())) delete kept[name];
    }
    requestHeaders = { ...kept, ...tool.headers };
  }
  return {
    tool_config: {
      ...obj(existing.tool_config),
      type: "webhook",
      name: tool.name,
      description: tool.description,
      response_timeout_secs: Math.max(1, Math.round(tool.timeoutMs / 1000)),
      api_schema: {
        ...existingApi,
        url: tool.url,
        method: tool.method,
        request_headers: requestHeaders,
        request_body_schema: tool.bodySchema,
      },
    },
  };
}

/** The `conversation_config` merge patch for the fields this product owns. */
export function agentPatchBody(desired: DesiredAgent, existing: Json = {}, toolId?: string): Json {
  const conv = obj(existing.conversation_config);
  const agent = obj(conv.agent);
  const prompt = obj(agent.prompt);
  const tts = obj(conv.tts);
  const toolIds = Array.isArray(prompt.tool_ids) ? [...(prompt.tool_ids as string[])] : [];
  if (toolId && !toolIds.includes(toolId)) toolIds.push(toolId);
  const nextPrompt: Json = {
    ...prompt,
    prompt: desired.systemPrompt,
    ...(toolIds.length ? { tool_ids: toolIds } : {}),
  };
  // A GET returns both the deprecated inline `tools` array and `tool_ids`; sending both back is
  // rejected ("Cannot specify both tools and tool IDs"), verified live. We speak tool_ids, so the
  // inline copy is dropped from the patch.
  if (toolIds.length) delete nextPrompt.tools;
  const body: Json = {
    name: desired.name,
    conversation_config: {
      ...conv,
      agent: {
        ...agent,
        first_message: desired.greeting,
        ...(desired.language ? { language: desired.language } : {}),
        prompt: nextPrompt,
      },
      ...(desired.voiceId ? { tts: { ...tts, voice_id: desired.voiceId } } : {}),
    },
  };
  return body;
}

export interface PushResult {
  agent: RemoteAgent;
  tool: RemoteTool;
  tool_id: string | null;
  created_tool: boolean;
  created_agent: boolean;
  applied: string[];
}

/**
 * Push the desired configuration to ElevenLabs.
 *
 * The tool goes first: the agent references it by id, so creating the tool second would mean a
 * second agent write. A missing tool id (or a tool that 404s) is created rather than failing —
 * that is what makes "wire this up from the product" true for a brand-new deployment.
 */
export async function pushAgent(
  cfg: VoiceConfig,
  desired: DesiredAgent,
  fetchImpl: FetchLike = fetch,
): Promise<PushResult> {
  const applied: string[] = [];
  let toolId = desired.toolId?.trim() || "";
  let createdTool = false;
  let existingTool: Json = {};
  if (toolId) {
    try {
      existingTool = await call(cfg, `/v1/convai/tools/${encodeURIComponent(toolId)}`, {}, fetchImpl);
    } catch (err) {
      if ((err as AgentError).status !== 404) throw err;
      toolId = "";
    }
  }
  if (toolId) {
    await call(
      cfg,
      `/v1/convai/tools/${encodeURIComponent(toolId)}`,
      { method: "PATCH", body: JSON.stringify(toolConfigBody(desired.tool, existingTool)) },
      fetchImpl,
    );
    applied.push("tool.url", "tool.request_headers", "tool.timeout", "tool.body_schema");
  } else {
    const created = await call(
      cfg,
      "/v1/convai/tools",
      { method: "POST", body: JSON.stringify(toolConfigBody(desired.tool)) },
      fetchImpl,
    );
    toolId = String(created.id ?? created.tool_id ?? "");
    createdTool = true;
    applied.push("tool.created");
  }

  let agentId = desired.agentId.trim();
  let createdAgent = false;
  let existingAgent: Json = {};
  if (agentId) {
    try {
      existingAgent = await call(cfg, `/v1/convai/agents/${encodeURIComponent(agentId)}`, {}, fetchImpl);
    } catch (err) {
      if ((err as AgentError).status !== 404) throw err;
      agentId = "";
    }
  }
  if (agentId) {
    await call(
      cfg,
      `/v1/convai/agents/${encodeURIComponent(agentId)}`,
      { method: "PATCH", body: JSON.stringify(agentPatchBody(desired, existingAgent, toolId)) },
      fetchImpl,
    );
    applied.push("agent.system_prompt", "agent.first_message", "agent.tool_ids");
    if (desired.voiceId) applied.push("agent.voice_id");
  } else {
    const created = await call(
      cfg,
      "/v1/convai/agents/create",
      { method: "POST", body: JSON.stringify(agentPatchBody(desired, {}, toolId)) },
      fetchImpl,
    );
    agentId = String(created.agent_id ?? created.id ?? "");
    createdAgent = true;
    applied.push("agent.created");
  }

  return {
    agent: await getAgent(cfg, agentId, fetchImpl),
    tool: await getTool(cfg, toolId, fetchImpl),
    tool_id: toolId || null,
    created_tool: createdTool,
    created_agent: createdAgent,
    applied,
  };
}

/** Delete an agent (used by the throwaway-agent verification, never by the product's UI). */
export async function deleteAgent(
  cfg: VoiceConfig,
  agentId: string,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  await call(cfg, `/v1/convai/agents/${encodeURIComponent(agentId)}`, { method: "DELETE" }, fetchImpl);
}

/**
 * Delete a tool. A tool an agent still references is refused with 409 ("Tool is still in use"),
 * verified live — `force` is the documented escape hatch, and the only sane default for a
 * throwaway object whose agent has already gone.
 */
export async function deleteTool(
  cfg: VoiceConfig,
  toolId: string,
  fetchImpl: FetchLike = fetch,
  opts: { force?: boolean } = {},
): Promise<void> {
  const query = opts.force === false ? "" : "?force=true";
  await call(cfg, `/v1/convai/tools/${encodeURIComponent(toolId)}${query}`, { method: "DELETE" }, fetchImpl);
}

// ── comparison ───────────────────────────────────────────────────────────────

function row(field: string, label: string, local: string, remote: string): AgentDiffRow {
  return { field, label, local, remote, matches: (local ?? "") === (remote ?? "") };
}

/**
 * What the product wants versus what ElevenLabs has. This is the table Settings shows before
 * anyone presses "Push": a diff is a much better answer than a spinner and a success toast.
 */
export function agentDiff(desired: DesiredAgent, agent: RemoteAgent, tool: RemoteTool): AgentDiffRow[] {
  const rows: AgentDiffRow[] = [
    row("agent_id", "Agent id", desired.agentId, agent.agent_id ?? (agent.found ? "" : "not found")),
    row("first_message", "Greeting", desired.greeting, agent.first_message ?? ""),
    row("system_prompt", "System prompt", desired.systemPrompt, agent.system_prompt ?? ""),
    row("tool_url", "Tool URL", desired.tool.url, tool.url ?? (tool.found ? "" : "no tool")),
    row("tool_method", "Tool method", desired.tool.method, tool.method ?? ""),
  ];
  if (desired.voiceId) rows.push(row("voice_id", "Voice", desired.voiceId, agent.voice_id ?? ""));
  const wantHeader = Object.keys(desired.tool.headers).some((n) => n.toLowerCase() === "x-api-key");
  if (wantHeader) {
    rows.push({
      field: "tool_api_key_header",
      label: "X-API-Key header",
      local: "set",
      remote: tool.has_api_key_header ? "set" : "missing",
      matches: Boolean(tool.has_api_key_header),
    });
  }
  const secs = Math.max(1, Math.round(desired.tool.timeoutMs / 1000));
  rows.push(
    row("tool_timeout", "Tool timeout", `${secs}s`, tool.timeout_secs ? `${tool.timeout_secs}s` : ""),
  );
  if (desired.toolId) {
    rows.push({
      field: "tool_linked",
      label: "Tool linked to the agent",
      local: desired.toolId,
      remote: (agent.tool_ids ?? []).includes(desired.toolId) ? desired.toolId : "not linked",
      matches: (agent.tool_ids ?? []).includes(desired.toolId),
    });
  }
  return rows;
}
