/**
 * Provision a prospect's stored ARAG `ask` search configuration.
 *
 * The stored configuration is the production path: it pins the voice prompt, the retrieval
 * governance (language filter, security group, no OCR noise) and the latency levers inside the
 * Knowledge Box, so the bridge only has to send `search_configuration: <name>`. It is idempotent
 * — re-running updates the same named configuration.
 */
import type { AragClient, SearchConfiguration } from "../../vendor/arag-platform/src/index.ts";
import type { ProspectRecord } from "../types.ts";
import { voicePromptForSearchConfig } from "./voicePrompt.ts";

export interface ProvisionOptions {
  /** Override the configuration name (defaults to the prospect's ask_config or `<key>_voice`). */
  name?: string;
  reranker?: "noop" | "predict";
  generative_model?: string;
  /** Build the body but do not send it. */
  dryRun?: boolean;
}

export interface ProvisionResult {
  name: string;
  applied: boolean;
  config: SearchConfiguration;
}

/** The stored-configuration body for a prospect. */
export function buildSearchConfiguration(
  prospect: ProspectRecord,
  opts: ProvisionOptions = {},
): SearchConfiguration {
  const config: Record<string, unknown> = {
    // Governance: English fields only, public security group, drop OCR noise.
    filter_expression: {
      field: { prop: "language", language: "en" },
      paragraph: { not: { prop: "kind", kind: "OCR" } },
      operator: "and",
    },
    security: { groups: ["public"] },
    // Latency levers.
    reranker: opts.reranker ?? prospect.reranker ?? "noop",
    max_tokens: prospect.max_tokens ?? 160,
    temperature: prospect.temperature ?? 0,
    // The reusable voice-answer prompt — what makes written answers sound spoken.
    prompt: voicePromptForSearchConfig(prospect.display_name, prospect.locale),
    citations: true,
  };
  const model = opts.generative_model ?? prospect.generative_model;
  if (model) config.generative_model = model;
  return { kind: "ask", config };
}

export function configName(prospect: ProspectRecord, opts: ProvisionOptions = {}): string {
  return opts.name ?? prospect.ask_config ?? `${prospect.id}_voice`;
}

/** Create/replace the stored configuration in the prospect's Knowledge Box. */
export async function provisionProspect(
  prospect: ProspectRecord,
  client: AragClient,
  opts: ProvisionOptions = {},
): Promise<ProvisionResult> {
  const name = configName(prospect, opts);
  const config = buildSearchConfiguration(prospect, opts);
  if (opts.dryRun) return { name, applied: false, config };
  await client.putSearchConfiguration(name, config);
  return { name, applied: true, config };
}
