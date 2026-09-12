/** Public registry projection, the model picker and the ElevenLabs voice list. */
import { type App, operationSchemas } from "../../vendor/arag-platform/src/index.ts";
import { openapi } from "../openapi.ts";
import type { ProductDeps } from "../server.ts";
import { fetchModels } from "../services/models.ts";
import { fetchVoices } from "../services/voices.ts";

export function registerProspectRoutes(app: App, deps: ProductDeps): void {
  app.get(
    "/api/v1/prospects",
    () => ({ items: deps.registry.list().map((p) => deps.registry.publicView(p)) }),
    {
      auth: "api",
      operationId: "listProspects",
    },
  );

  app.get(
    "/api/v1/prospects/:key",
    (ctx) => deps.registry.publicView(deps.registry.require(ctx.params.key!)),
    {
      auth: "api",
      validate: operationSchemas(openapi, "/api/v1/prospects/{key}", "get"),
      operationId: "getProspect",
    },
  );

  app.get(
    "/api/v1/models",
    async (ctx) => {
      const prospect = deps.registry.require(String(ctx.queryObj.prospect ?? ""));
      return fetchModels(deps.clients.for(prospect));
    },
    {
      auth: "api",
      validate: operationSchemas(openapi, "/api/v1/models", "get"),
      operationId: "listModels",
    },
  );

  app.get("/api/v1/voices", async () => ({ voices: await fetchVoices(deps.voice) }), {
    auth: "api",
    operationId: "listVoices",
  });
}
