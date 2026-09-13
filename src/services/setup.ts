/**
 * The first-run checklist behind the onboarding wizard.
 *
 * Two rules shaped this. First, it is computed from the live configuration on every request, not
 * from a stored "dismissed" flag: a deployment that loses its Knowledge Box, or whose only API key
 * is revoked, should see that step come back rather than keep a tick it no longer deserves.
 * Second, only the steps that actually block the product are required — the sample conversation,
 * the Ask tester and the whole session API work with no credentials at all, and a wizard that
 * demands an ElevenLabs key before showing anything would be lying about that.
 */
import type { ProductDeps } from "../server.ts";

export interface SetupStep {
  id: string;
  title: string;
  body: string;
  done: boolean;
  optional: boolean;
  detail?: string;
  href?: string;
  action?: string;
}

export interface SetupState {
  steps: SetupStep[];
  complete: boolean;
  required_done: number;
  required_total: number;
}

export function buildSetup(deps: ProductDeps): SetupState {
  const { env, voice, registry, apiKeys } = deps;
  const prospects = registry.list();
  const first = prospects[0];
  const agentWired = prospects.some((p) => {
    const id = (p.agent_id || voice.defaultAgentId || "").trim();
    return Boolean(id) && !/REPLACE_ME/i.test(id);
  });
  const branded = voice.branding.productName !== "VoiceBridge" || Boolean(voice.branding.logoUrl);

  const steps: SetupStep[] = [
    {
      id: "knowledge",
      title: "Point it at a Knowledge Box",
      body:
        "Every answer comes from Progress Agentic RAG. Give the deployment a Knowledge Box id and " +
        "a service-account token, or keep the built-in sample box to explore first.",
      done: !env.arag.mock && Boolean(env.arag.kbId && env.arag.apiKey),
      optional: false,
      detail: env.arag.mock
        ? "Running on the in-process sample Knowledge Box — good for a look, not for your content"
        : `Connected to ${env.arag.kbId.slice(0, 8)}… in ${env.arag.region}`,
      href: "/settings/#connection",
      action: "Open Connection",
    },
    {
      id: "prospect",
      title: "Describe who you answer for",
      body:
        "A prospect is one customer of this deployment: their Knowledge Box, their greeting, their " +
        "handoff line and their branding. The registry ships with an example you can edit.",
      done: prospects.length > 0,
      optional: false,
      detail: first
        ? `${prospects.length} prospect${prospects.length === 1 ? "" : "s"} — first is ${first.display_name}`
        : "No prospects yet",
      href: "/prospects/",
      action: "Open Prospects",
    },
    {
      id: "try",
      title: "Ask it something",
      body:
        "Type a question and watch the nine-step pipeline run: the guards, the retrieval, the " +
        "handoff decision and the line the caller would hear.",
      done: deps.metrics.size > 0,
      optional: false,
      detail: deps.metrics.size
        ? `${deps.metrics.size} turn${deps.metrics.size === 1 ? "" : "s"} recorded`
        : "No turns recorded yet",
      href: "/knowledge/#ask",
      action: "Open the Ask tester",
    },
    {
      id: "apikey",
      title: "Lock the API down",
      body:
        "With no key, anyone who can reach this deployment can call it. Mint one and the API " +
        "requires it — the workspace keeps working on its own session.",
      done: apiKeys.activeCount > 0,
      optional: true,
      detail:
        apiKeys.activeCount > 0
          ? `${apiKeys.activeCount} active key${apiKeys.activeCount === 1 ? "" : "s"}`
          : "The public API is open",
      href: "/settings/#api-keys",
      action: "Manage API keys",
    },
    {
      id: "elevenlabs",
      title: "Turn the voice on",
      body:
        "An ElevenLabs key gives you live microphone transcription, the spoken brief and the " +
        "voice agent. Without one the sample, typed and webhook paths still carry the product.",
      done: Boolean(voice.elevenLabsApiKey),
      optional: true,
      detail: voice.elevenLabsApiKey ? "ElevenLabs is configured" : "Not configured",
      href: "/settings/#elevenlabs",
      action: "Open ElevenLabs settings",
    },
    {
      id: "agent",
      title: "Wire the phone call",
      body:
        "Push the agent configuration to ElevenLabs from Settings — the router prompt, the " +
        "greeting, the voice, and the custom server tool pointed back at this deployment with its " +
        "API key. No dashboard visit required.",
      done: agentWired,
      optional: true,
      detail: agentWired ? "An agent id is configured" : "No agent wired yet",
      href: "/settings/#voice-agent",
      action: "Configure the agent",
    },
    {
      id: "brand",
      title: "Make it yours",
      body:
        "Product name, tagline, logo and colours are settings, not a fork. Per-prospect overlays " +
        "let one deployment serve several of your customers.",
      done: branded,
      optional: true,
      detail: branded ? `Branded as ${voice.branding.productName}` : "Using the Progress default identity",
      href: "/settings/#branding",
      action: "Open Branding",
    },
  ];

  const required = steps.filter((s) => !s.optional);
  return {
    steps,
    required_done: required.filter((s) => s.done).length,
    required_total: required.length,
    complete: required.every((s) => s.done),
  };
}
