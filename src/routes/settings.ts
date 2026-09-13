/**
 * Operator routes for everything that used to be an environment variable: the settings store,
 * the API key store, the ElevenLabs agent push, retention and purge, and the logo upload.
 *
 * Everything here is `auth: "admin"` — an operator act — and everything that changes state is
 * audited by its service into the log the operator can read at `/api/v1/admin/logs`.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  type App,
  badRequest,
  type Ctx,
  notFound,
  operationSchemas,
  serviceUnavailable,
} from "../../vendor/arag-platform/src/index.ts";
import { openapi } from "../openapi.ts";
import type { ProductDeps } from "../server.ts";
import { agentDiff, getAgent, getTool, pushAgent } from "../services/elevenAgent.ts";
import type { SettingsGroupId, SettingsPatch } from "../services/settings.ts";
import { desiredAgent, voiceAgentConfig } from "../services/voiceAgent.ts";

/** Image types a partner may upload as a logo. No SVG-in-disguise, no arbitrary uploads. */
const LOGO_TYPES: Record<string, string> = {
  "image/svg+xml": "svg",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};
const LOGO_MAX_BYTES = 1024 * 1024;
const LOGO_BASENAME = "logo";

/** Who made this change, for the audit line. Operators are identified by how they authenticated. */
function actorOf(ctx: Ctx): string {
  return ctx.auth.via === "admin-token" ? "operator" : (ctx.auth.via ?? "unknown");
}

export function registerSettingsRoutes(app: App, deps: ProductDeps): void {
  // ── settings ───────────────────────────────────────────────────────────────
  app.get("/api/v1/admin/settings", () => ({ groups: deps.settings.describe() }), {
    auth: "admin",
    operationId: "adminGetSettings",
  });

  app.patch(
    "/api/v1/admin/settings",
    (ctx) => ({ groups: deps.settings.update(ctx.body as SettingsPatch, actorOf(ctx)) }),
    {
      auth: "admin",
      validate: operationSchemas(openapi, "/api/v1/admin/settings", "patch"),
      operationId: "adminUpdateSettings",
    },
  );

  app.post(
    "/api/v1/admin/settings/reset",
    (ctx) => {
      const { group } = (ctx.body ?? {}) as { group?: SettingsGroupId };
      return { groups: deps.settings.reset(group, actorOf(ctx)) };
    },
    {
      auth: "admin",
      validate: operationSchemas(openapi, "/api/v1/admin/settings/reset", "post"),
      operationId: "adminResetSettings",
    },
  );

  // The logo lands in DATA_DIR/branding/, which the server already mounts at /branding — so an
  // uploaded mark survives a restart and is served by the product, not by a third party.
  app.post(
    "/api/v1/admin/settings/logo",
    (ctx) => {
      const file = ctx.files?.[0];
      if (!file) throw badRequest("Send the image as a multipart field named 'file'.");
      const ext = LOGO_TYPES[file.contentType.split(";")[0]!.trim().toLowerCase()];
      if (!ext) {
        throw badRequest(`Unsupported image type "${file.contentType}". Use SVG, PNG, JPEG, WebP or GIF.`);
      }
      if (file.data.byteLength > LOGO_MAX_BYTES) {
        throw badRequest(`The logo must be at most ${LOGO_MAX_BYTES / 1024} KB.`);
      }
      const dir = resolve(deps.env.dataDir, "branding");
      mkdirSync(dir, { recursive: true });
      // One canonical name per type, so re-uploading replaces rather than accumulates. The cache
      // buster is what makes a replacement visible without a hard refresh.
      for (const e of Object.values(LOGO_TYPES)) {
        if (e !== ext) rmSync(resolve(dir, `${LOGO_BASENAME}.${e}`), { force: true });
      }
      writeFileSync(resolve(dir, `${LOGO_BASENAME}.${ext}`), file.data);
      const logoUrl = `/branding/${LOGO_BASENAME}.${ext}?v=${Date.now().toString(36)}`;
      deps.settings.update({ branding: { logoUrl } }, actorOf(ctx));
      return { logoUrl, bytes: file.data.byteLength, contentType: file.contentType };
    },
    { auth: "admin", body: "multipart", bodyLimit: LOGO_MAX_BYTES + 8192, operationId: "adminUploadLogo" },
  );

  app.delete(
    "/api/v1/admin/settings/logo",
    (ctx) => {
      const dir = resolve(deps.env.dataDir, "branding");
      for (const e of Object.values(LOGO_TYPES))
        rmSync(resolve(dir, `${LOGO_BASENAME}.${e}`), { force: true });
      deps.settings.update({ branding: { logoUrl: null } }, actorOf(ctx));
      ctx.noContent();
    },
    { auth: "admin", operationId: "adminDeleteLogo" },
  );

  // ── API keys ───────────────────────────────────────────────────────────────
  app.get(
    "/api/v1/admin/api-keys",
    () => ({
      items: deps.apiKeys.list(),
      active: deps.apiKeys.activeCount,
      open: deps.apiKeys.activeCount === 0,
    }),
    { auth: "admin", operationId: "adminListApiKeys" },
  );

  app.post(
    "/api/v1/admin/api-keys",
    (ctx) => {
      const { name } = ctx.body as { name: string };
      const created = deps.apiKeys.create(name, actorOf(ctx));
      ctx.json(201, created, { Location: `/api/v1/admin/api-keys/${created.key.id}` });
    },
    {
      auth: "admin",
      validate: operationSchemas(openapi, "/api/v1/admin/api-keys", "post"),
      operationId: "adminCreateApiKey",
    },
  );

  app.patch(
    "/api/v1/admin/api-keys/:id",
    (ctx) => {
      const { name } = ctx.body as { name: string };
      const view = deps.apiKeys.rename(ctx.params.id!, name, actorOf(ctx));
      if (!view) throw notFound("API key");
      return view;
    },
    {
      auth: "admin",
      validate: operationSchemas(openapi, "/api/v1/admin/api-keys/{id}", "patch"),
      operationId: "adminRenameApiKey",
    },
  );

  app.delete(
    "/api/v1/admin/api-keys/:id",
    (ctx) => {
      const view = deps.apiKeys.revoke(ctx.params.id!, actorOf(ctx));
      if (!view) throw notFound("API key");
      return view;
    },
    { auth: "admin", operationId: "adminRevokeApiKey" },
  );

  // ── the ElevenLabs agent ───────────────────────────────────────────────────

  /** The key whose secret goes into the tool's X-API-Key header, if there is one to use. */
  const keyForProspect = (prospectKeyId?: string) => {
    const rec = prospectKeyId ? deps.apiKeys.get(prospectKeyId) : null;
    const active = rec && !rec.revokedAt ? rec : deps.apiKeys.anyActive();
    return active ? { id: active.id, name: active.name, prefix: active.prefix, secret: active.secret } : null;
  };

  app.get(
    "/api/v1/admin/voice-agent",
    async (ctx) => {
      const prospect = deps.registry.require(String(ctx.queryObj.prospect ?? ""));
      const key = keyForProspect(prospect.agent_api_key_id);
      const desired = voiceAgentConfig(
        prospect,
        deps.voice,
        deps.env.publicUrl || `http://localhost:${deps.env.port}`,
        key ? { id: key.id, name: key.name, prefix: key.prefix } : null,
      );
      if (!deps.voice.elevenLabsApiKey) {
        return {
          desired,
          remote: { agent: { found: false, error: "ElevenLabs is not configured" }, tool: { found: false } },
          diff: [],
          in_sync: false,
          reachable: false,
        };
      }
      const wanted = desiredAgent(
        prospect,
        deps.voice,
        deps.env.publicUrl || `http://localhost:${deps.env.port}`,
        key?.secret,
      );
      const agent = wanted.agentId ? await getAgent(deps.voice, wanted.agentId) : { found: false };
      const tool = wanted.toolId ? await getTool(deps.voice, wanted.toolId) : { found: false };
      const diff = agentDiff(wanted, agent, tool);
      return {
        desired,
        remote: { agent, tool },
        diff,
        in_sync: diff.every((d) => d.matches),
        reachable: agent.found || tool.found,
      };
    },
    {
      auth: "admin",
      validate: operationSchemas(openapi, "/api/v1/admin/voice-agent", "get"),
      operationId: "adminGetVoiceAgent",
    },
  );

  app.post(
    "/api/v1/admin/voice-agent/push",
    async (ctx) => {
      const { prospect: key, api_key_id } = ctx.body as { prospect: string; api_key_id?: string };
      const prospect = deps.registry.require(key);
      if (!deps.voice.elevenLabsApiKey) {
        throw serviceUnavailable(
          "ElevenLabs is not configured: set the API key under Settings → ElevenLabs first.",
        );
      }
      const apiKey = keyForProspect(api_key_id ?? prospect.agent_api_key_id);
      const wanted = desiredAgent(
        prospect,
        deps.voice,
        deps.env.publicUrl || `http://localhost:${deps.env.port}`,
        apiKey?.secret,
      );
      const result = await pushAgent(deps.voice, wanted);
      // Remember what we created, so the next read compares against the right objects.
      const patch: Record<string, unknown> = { ...prospect };
      if (result.tool_id) patch.tool_id = result.tool_id;
      if (result.agent.agent_id) patch.agent_id = result.agent.agent_id;
      if (apiKey) patch.agent_api_key_id = apiKey.id;
      const updated = deps.registry.replace(prospect.id, patch);
      deps.log.info("voiceagent.pushed", {
        actor: actorOf(ctx),
        prospect: prospect.id,
        applied: result.applied,
        created_agent: result.created_agent,
        created_tool: result.created_tool,
      });
      return { ...result, prospect: updated };
    },
    {
      auth: "admin",
      validate: operationSchemas(openapi, "/api/v1/admin/voice-agent/push", "post"),
      operationId: "adminPushVoiceAgent",
    },
  );

  // ── conversations and retention ────────────────────────────────────────────
  app.delete(
    "/api/v1/admin/listen-sessions/:id",
    (ctx) => {
      if (!deps.listen.delete(ctx.params.id!)) throw notFound("Listen session");
      deps.log.info("listen.session.deleted.admin", { actor: actorOf(ctx), id: ctx.params.id });
      ctx.noContent();
    },
    { auth: "admin", operationId: "adminDeleteListenSession" },
  );

  app.post(
    "/api/v1/admin/purge",
    (ctx) => {
      const { scope } = (ctx.body ?? {}) as { scope?: "retention" | "turns" | "sessions" | "evals" | "all" };
      return deps.retention.purge(scope ?? "retention", actorOf(ctx));
    },
    {
      auth: "admin",
      validate: operationSchemas(openapi, "/api/v1/admin/purge", "post"),
      operationId: "adminPurge",
    },
  );
}
