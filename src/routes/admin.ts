/**
 * Admin surface (ADMIN_TOKEN): health per prospect, configuration, usage, logs, the prospect
 * registry CRUD, stored-configuration provisioning, the turn log and golden-eval history.
 */
import {
  type App,
  conflict,
  constantTimeEqual,
  describeEnv,
  notFound,
  operationSchemas,
  unauthorized,
} from "../../vendor/arag-platform/src/index.ts";
import { describeVoiceConfig } from "../config.ts";
import { openapi, VERSION } from "../openapi.ts";
import type { ProductDeps } from "../server.ts";
import { configName, provisionProspect } from "../services/provision.ts";

export function registerAdminRoutes(app: App, deps: ProductDeps): void {
  app.post(
    "/api/v1/admin/login",
    (ctx) => {
      const { token } = ctx.body as { token: string };
      // Constant-time compare: a timing oracle on the admin token is a real attack.
      if (!deps.env.adminToken || !constantTimeEqual(token, deps.env.adminToken)) {
        throw unauthorized("Invalid admin token");
      }
      ctx.setCookie("arag_admin", token, { maxAge: 12 * 3600 });
      return { ok: true };
    },
    {
      validate: operationSchemas(openapi, "/api/v1/admin/login", "post"),
      operationId: "adminLogin",
    },
  );

  app.get(
    "/api/v1/admin/health",
    async (ctx) => {
      const only = ctx.queryObj.prospect as string | undefined;
      const list = only ? [deps.registry.require(only)] : deps.registry.list();
      const prospects = await Promise.all(
        list.map(async (p) => {
          const h = await deps.clients.for(p).health();
          return {
            key: p.id,
            display_name: p.display_name,
            ok: h.ok,
            kbId: h.kbId,
            baseUrl: h.baseUrl,
            resources: h.resources,
            generativeModel: h.generativeModel,
            ms: h.ms,
            error: h.error,
          };
        }),
      );
      return {
        ok: prospects.every((p) => p.ok),
        version: VERSION,
        uptimeSec: Math.round((Date.now() - deps.usage.startedAt) / 1000),
        mock: deps.env.arag.mock,
        prospects,
      };
    },
    {
      auth: "admin",
      validate: operationSchemas(openapi, "/api/v1/admin/health", "get"),
      operationId: "adminHealth",
    },
  );

  app.get(
    "/api/v1/admin/config",
    () => ({
      env: describeEnv(deps.env),
      voice: describeVoiceConfig(deps.voice),
      platformVersion: deps.platformVersion,
      version: VERSION,
      stores: deps.store.stats(),
      routes: app.listRoutes(),
    }),
    { auth: "admin", operationId: "adminConfig" },
  );

  app.get(
    "/api/v1/admin/usage",
    () => ({
      ...deps.usage,
      uptimeSec: Math.round((Date.now() - deps.usage.startedAt) / 1000),
      prospects: deps.registry.size,
      turns: deps.metrics.size,
      listenSessions: deps.listen.size,
      metrics: deps.metrics.snapshot(),
      jobs: {
        queued: deps.jobs.count({ status: "queued" }),
        running: deps.jobs.count({ status: "running" }),
        succeeded: deps.jobs.count({ status: "succeeded" }),
        failed: deps.jobs.count({ status: "failed" }),
      },
    }),
    { auth: "admin", operationId: "adminUsage" },
  );

  app.get(
    "/api/v1/admin/logs",
    (ctx) => ({
      items: deps.log.recent({
        level: ctx.queryObj.level as never,
        contains: ctx.queryObj.contains as string | undefined,
        limit: ctx.queryObj.limit as number | undefined,
      }),
    }),
    {
      auth: "admin",
      validate: operationSchemas(openapi, "/api/v1/admin/logs", "get"),
      operationId: "adminLogs",
    },
  );

  // ── registry CRUD ────────────────────────────────────────────────────────────
  app.get("/api/v1/admin/prospects", () => ({ items: deps.registry.list() }), {
    auth: "admin",
    operationId: "adminListProspects",
  });

  app.post(
    "/api/v1/admin/prospects",
    (ctx) => {
      const { key, config } = ctx.body as { key: string; config: Record<string, unknown> };
      if (deps.registry.get(key)) throw conflict(`Prospect "${key}" already exists`);
      const record = deps.registry.create(key, config);
      deps.clients.clear();
      ctx.json(201, record, { Location: `/api/v1/admin/prospects/${key}` });
    },
    {
      auth: "admin",
      validate: operationSchemas(openapi, "/api/v1/admin/prospects", "post"),
      operationId: "adminCreateProspect",
    },
  );

  app.get("/api/v1/admin/prospects/:key", (ctx) => deps.registry.require(ctx.params.key!), {
    auth: "admin",
    validate: operationSchemas(openapi, "/api/v1/admin/prospects/{key}", "get"),
    operationId: "adminGetProspect",
  });

  app.put(
    "/api/v1/admin/prospects/:key",
    (ctx) => {
      const record = deps.registry.replace(ctx.params.key!, ctx.body);
      deps.clients.clear();
      return record;
    },
    {
      auth: "admin",
      validate: operationSchemas(openapi, "/api/v1/admin/prospects/{key}", "put"),
      operationId: "adminReplaceProspect",
    },
  );

  app.delete(
    "/api/v1/admin/prospects/:key",
    (ctx) => {
      if (!deps.registry.delete(ctx.params.key!)) throw notFound("Prospect");
      deps.clients.clear();
      ctx.noContent();
    },
    { auth: "admin", operationId: "adminDeleteProspect" },
  );

  app.post(
    "/api/v1/admin/prospects/:key/provision",
    async (ctx) => {
      const prospect = deps.registry.require(ctx.params.key!);
      const body = (ctx.body ?? {}) as {
        name?: string;
        reranker?: "noop" | "predict";
        generative_model?: string;
        dry_run?: boolean;
      };
      const opts = {
        name: body.name,
        reranker: body.reranker,
        generative_model: body.generative_model,
        dryRun: body.dry_run === true,
      };
      const result = await provisionProspect(prospect, deps.clients.for(prospect), opts);
      let updated = prospect;
      if (result.applied && prospect.ask_config !== result.name) {
        // Point the registry entry at the stored configuration we just wrote.
        updated = deps.registry.replace(prospect.id, { ...prospect, ask_config: result.name });
      }
      deps.log.info("prospect.provisioned", {
        key: prospect.id,
        name: configName(prospect, opts),
        applied: result.applied,
      });
      return { ...result, prospect: updated };
    },
    {
      auth: "admin",
      validate: operationSchemas(openapi, "/api/v1/admin/prospects/{key}/provision", "post"),
      operationId: "adminProvisionProspect",
    },
  );

  // ── observability ────────────────────────────────────────────────────────────
  app.get(
    "/api/v1/admin/turns",
    (ctx) => ({
      items: deps.metrics.recent({
        prospect: ctx.queryObj.prospect as string | undefined,
        limit: (ctx.queryObj.limit as number | undefined) ?? 100,
      }),
    }),
    {
      auth: "admin",
      validate: operationSchemas(openapi, "/api/v1/admin/turns", "get"),
      operationId: "adminTurns",
    },
  );

  app.get(
    "/api/v1/admin/listen-sessions",
    (ctx) => ({
      items: deps.listen
        .list({
          prospect: ctx.queryObj.prospect as string | undefined,
          limit: (ctx.queryObj.limit as number | undefined) ?? 25,
        })
        .map((s) => deps.listen.adminView(deps.listen.require(s.id))),
    }),
    {
      auth: "admin",
      validate: operationSchemas(openapi, "/api/v1/admin/listen-sessions", "get"),
      operationId: "adminListenSessions",
    },
  );

  app.get(
    "/api/v1/admin/golden-evals",
    (ctx) => ({
      items: deps.evals.list({
        prospect: ctx.queryObj.prospect as string | undefined,
        limit: (ctx.queryObj.limit as number | undefined) ?? 25,
      }),
    }),
    {
      auth: "admin",
      validate: operationSchemas(openapi, "/api/v1/admin/golden-evals", "get"),
      operationId: "adminGoldenEvals",
    },
  );
}
