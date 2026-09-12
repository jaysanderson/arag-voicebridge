/** Quality surface: live metrics and golden-set evaluations (run as jobs). */
import { type App, notFound, operationSchemas } from "../../vendor/arag-platform/src/index.ts";
import { openapi } from "../openapi.ts";
import type { ProductDeps } from "../server.ts";

export const GOLDEN_EVAL_JOB = "golden-eval";

export function registerQualityRoutes(app: App, deps: ProductDeps): void {
  app.get("/api/v1/metrics", (ctx) => deps.metrics.snapshot(ctx.queryObj.prospect as string | undefined), {
    auth: "api",
    validate: operationSchemas(openapi, "/api/v1/metrics", "get"),
    operationId: "getMetrics",
  });

  app.post(
    "/api/v1/golden-evals",
    (ctx) => {
      const { prospect: key } = ctx.body as { prospect: string };
      const prospect = deps.registry.require(key);
      const job = deps.jobs.submit(
        GOLDEN_EVAL_JOB,
        { prospect: key, questions: (prospect.golden_questions ?? []).length },
        { ref: key },
      );
      ctx.json(202, { job }, { Location: `/api/v1/jobs/${job.id}` });
    },
    {
      auth: "api",
      validate: operationSchemas(openapi, "/api/v1/golden-evals", "post"),
      operationId: "createGoldenEval",
    },
  );

  app.get(
    "/api/v1/golden-evals/:id",
    (ctx) => {
      const id = ctx.params.id!;
      const direct = deps.evals.get(id);
      if (direct) return direct;
      // Also accept the job id, so a caller can poll with what POST returned.
      const job = deps.jobs.get(id);
      const result = job?.result as { id?: string } | undefined;
      const fromJob = result?.id ? deps.evals.get(result.id) : undefined;
      if (fromJob) return fromJob;
      throw notFound("Golden evaluation");
    },
    {
      auth: "api",
      validate: operationSchemas(openapi, "/api/v1/golden-evals/{id}", "get"),
      operationId: "getGoldenEval",
    },
  );
}
