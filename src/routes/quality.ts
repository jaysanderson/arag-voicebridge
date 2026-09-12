/** Quality surface: live metrics and golden-set evaluations (run as jobs). */
import {
  type App,
  type Ctx,
  notFound,
  operationSchemas,
  unauthorized,
} from "../../vendor/arag-platform/src/index.ts";
import { openapi } from "../openapi.ts";
import type { ProductDeps } from "../server.ts";

export const GOLDEN_EVAL_JOB = "golden-eval";

/**
 * Reading the turn log is never anonymous, even on a deployment that leaves `/api/v1` open.
 *
 * Before the Quality view existed, the questions people asked were admin-only. Moving the turn log
 * into the workspace must not turn "open API" into "anyone who can reach the host can read what
 * callers asked". A same-origin session (which the workspace mints at boot) is enough; a passing
 * stranger with curl is not.
 */
function requireIdentified(ctx: Ctx): void {
  if (!ctx.auth.admin && !ctx.auth.apiKey && !ctx.auth.session) {
    throw unauthorized(
      "A session or API key is required to read the turn log. Call POST /api/v1/session first " +
        "(the workspace does this automatically).",
    );
  }
}

/** Show enough of an identifier to recognise it, not enough to reuse it. */
export function maskId(id: string): string {
  const s = String(id ?? "");
  return s.length <= 8 ? s : `${s.slice(0, 4)}…${s.slice(-4)}`;
}

export function registerQualityRoutes(app: App, deps: ProductDeps): void {
  app.get("/api/v1/metrics", (ctx) => deps.metrics.snapshot(ctx.queryObj.prospect as string | undefined), {
    auth: "api",
    validate: operationSchemas(openapi, "/api/v1/metrics", "get"),
    operationId: "getMetrics",
  });

  // The Quality view's turn log. Same ring as the admin one, same redaction rule: a turn whose
  // input tripped a safety guard carries the reason and no question text.
  app.get(
    "/api/v1/turns",
    (ctx) => {
      requireIdentified(ctx);
      const q = ctx.queryObj as Record<string, unknown>;
      const prospect = q.prospect as string | undefined;
      const { items, total } = deps.metrics.query({
        prospect,
        outcome: q.outcome as "answered" | "handoff" | "guard" | undefined,
        source: q.source as "voice-answer" | "golden-eval" | undefined,
        reason: q.reason as string | undefined,
        limit: (q.limit as number | undefined) ?? 100,
        offset: (q.offset as number | undefined) ?? 0,
      });
      return { items, total, reasons: deps.metrics.reasons(prospect) };
    },
    {
      auth: "api",
      validate: operationSchemas(openapi, "/api/v1/turns", "get"),
      operationId: "listTurns",
    },
  );

  // What a prospect is grounded in. The Knowledge Box id is masked here — the full id belongs to
  // the operator surface (GET /api/v1/admin/health), not to every browser that opens the app.
  app.get(
    "/api/v1/knowledge",
    async (ctx) => {
      const prospect = deps.registry.require(String(ctx.queryObj.prospect ?? ""));
      const health = await deps.clients.for(prospect).health();
      return {
        prospect: prospect.id,
        display_name: prospect.display_name,
        kb: {
          ok: health.ok,
          id_masked: maskId(prospect.kb_id),
          title: deps.voice.kbTitle || undefined,
          region: prospect.region || deps.voice.aragRegionDefault,
          resources: typeof health.resources === "number" ? health.resources : null,
          generative_model: prospect.generative_model || health.generativeModel || undefined,
          reranker: prospect.reranker ?? "noop",
          ask_config: prospect.ask_config,
          brief_model: prospect.brief_model,
          ms: Math.round(health.ms ?? 0),
          mock: deps.env.arag.mock,
          error: health.error,
        },
        golden_questions: prospect.golden_questions ?? [],
        last_eval: deps.evals.latest(prospect.id),
      };
    },
    {
      auth: "api",
      validate: operationSchemas(openapi, "/api/v1/knowledge", "get"),
      operationId: "getKnowledge",
    },
  );

  app.get(
    "/api/v1/golden-evals",
    (ctx) =>
      deps.evals.query({
        prospect: ctx.queryObj.prospect as string | undefined,
        limit: (ctx.queryObj.limit as number | undefined) ?? 25,
        offset: (ctx.queryObj.offset as number | undefined) ?? 0,
      }),
    {
      auth: "api",
      validate: operationSchemas(openapi, "/api/v1/golden-evals", "get"),
      operationId: "listGoldenEvals",
    },
  );

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
