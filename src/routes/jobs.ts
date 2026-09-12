/** Job inspection: list, get, cancel and an SSE stream of stage events. */
import { type App, notFound, operationSchemas } from "../../vendor/arag-platform/src/index.ts";
import { openapi } from "../openapi.ts";
import type { ProductDeps } from "../server.ts";

export function registerJobRoutes(app: App, deps: ProductDeps): void {
  app.get(
    "/api/v1/jobs",
    (ctx) => ({
      items: deps.jobs.list({
        status: ctx.queryObj.status as never,
        limit: (ctx.queryObj.limit as number | undefined) ?? 50,
      }),
    }),
    { auth: "api", validate: operationSchemas(openapi, "/api/v1/jobs", "get"), operationId: "listJobs" },
  );

  app.get("/api/v1/jobs/:id", (ctx) => deps.jobs.get(ctx.params.id!) ?? raise(), {
    auth: "api",
    operationId: "getJob",
  });

  app.delete(
    "/api/v1/jobs/:id",
    (ctx) => {
      if (!deps.jobs.cancel(ctx.params.id!)) throw notFound("Job");
      ctx.noContent();
    },
    { auth: "api", operationId: "cancelJob" },
  );

  app.get(
    "/api/v1/jobs/:id/events",
    (ctx) => {
      const job = deps.jobs.get(ctx.params.id!);
      if (!job) throw notFound("Job");
      const sse = ctx.sse();
      for (const e of job.events) sse.send("event", e);
      if (["succeeded", "failed", "cancelled"].includes(job.status)) {
        sse.send("job", { stage: "job", status: job.status, job });
        sse.close();
        return;
      }
      const unsubscribe = deps.jobs.subscribe(job.id, (e) => {
        if ("stage" in e && e.stage === "job") {
          sse.send("job", e);
          if (["succeeded", "failed", "cancelled"].includes((e as { status: string }).status)) sse.close();
        } else {
          sse.send("event", e);
        }
      });
      sse.onClose(unsubscribe);
    },
    { auth: "api", noRateLimit: true, operationId: "jobEvents" },
  );
}

function raise(): never {
  throw notFound("Job");
}
