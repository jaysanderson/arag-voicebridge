/**
 * Contract tests: the OpenAPI document is the source of truth.
 *   - the spec lints clean (operationIds, tags, responses, resolvable $refs)
 *   - every registered /api/v1 route appears in the spec
 *   - real responses validate against the declared schemas
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readVoiceEnv } from "../src/config.ts";
import { openapi } from "../src/openapi.ts";
import { createProduct, type Product } from "../src/server.ts";
import { Logger, readEnv, testing } from "../vendor/arag-platform/src/index.ts";
import { after, before, describe, expect, it } from "./_expect.ts";

const ADMIN = "contract-admin";
const admin = { Authorization: `Bearer ${ADMIN}` };
let product: Product;
let client: testing.TestClient;

before(async () => {
  const env = readEnv({
    ARAG_MOCK: "1",
    DATA_DIR: mkdtempSync(join(tmpdir(), "vb-contract-")),
    ADMIN_TOKEN: ADMIN,
    RATE_LIMIT_RPS: "500",
    RATE_LIMIT_BURST: "500",
    LOG_LEVEL: "error",
  });
  product = await createProduct(env, readVoiceEnv({}), {
    log: new Logger({ level: "error", ringSize: 50, write: () => {} }),
    persist: false,
  });
  client = await testing.startTestServer(product.app);
});

after(async () => {
  await client.close();
  await product.close();
});

describe("OpenAPI document", () => {
  it("lints clean", () => {
    expect(testing.lintSpec(openapi)).toEqual([]);
  });

  it("describes every registered API route", () => {
    expect(testing.missingFromSpec(product.app, openapi)).toEqual([]);
  });

  it("documents the compatibility alias alongside the versioned path", () => {
    const paths = openapi.paths as Record<string, Record<string, { operationId: string }>>;
    expect(paths["/v1/voice-answer"]?.post?.operationId).toBe("voiceAnswerLegacy");
    expect(paths["/api/v1/voice-answer"]?.post?.operationId).toBe("voiceAnswer");
  });

  it("marks every admin operation as requiring the admin token", () => {
    const paths = openapi.paths as Record<string, Record<string, Record<string, unknown>>>;
    for (const [path, ops] of Object.entries(paths)) {
      if (!path.startsWith("/api/v1/admin") || path.endsWith("/login")) continue;
      for (const [method, op] of Object.entries(ops)) {
        if (method === "parameters") continue;
        expect(JSON.stringify(op.security)).toContain("AdminToken");
      }
    }
  });
});

describe("responses validate against the spec", () => {
  const check = (path: string, method: string, status: number, body: unknown) =>
    expect(testing.checkResponse(openapi, path, method, status, body)).toEqual([]);

  it("branding", async () => {
    check("/api/v1/branding", "get", 200, (await client.get("/api/v1/branding")).json);
  });

  it("listen sessions", async () => {
    const created = await client.post("/api/v1/listen/sessions", { prospect: "progress" });
    check("/api/v1/listen/sessions", "post", 201, created.json);
    const id = (created.json as { id: string }).id;
    const appended = await client.post(`/api/v1/listen/sessions/${id}/transcript`, {
      chunks: [{ speaker: "caller", text: "we print stainless steel brackets and need a sintering furnace" }],
    });
    check("/api/v1/listen/sessions/{id}/transcript", "post", 202, appended.json);
    for (let i = 0; i < 100; i++) {
      const s = (await client.get(`/api/v1/listen/sessions/${id}`)).json as { briefVersion: number };
      if (s.briefVersion > 0) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    check(
      "/api/v1/listen/sessions/{id}",
      "get",
      200,
      (await client.get(`/api/v1/listen/sessions/${id}`)).json,
    );
    check("/api/v1/listen/sessions", "get", 200, (await client.get("/api/v1/listen/sessions")).json);
    check(
      "/api/v1/listen/sessions",
      "get",
      200,
      (
        await client.get(
          "/api/v1/listen/sessions?prospect=progress&status=live&q=stainless&sort=updated&order=asc&limit=5&offset=0",
        )
      ).json,
    );
    check(
      "/api/v1/listen/sessions/{id}/export",
      "get",
      200,
      (await client.get(`/api/v1/listen/sessions/${id}/export`)).json,
    );
    const refreshed = await client.post(`/api/v1/listen/sessions/${id}/refresh`);
    check("/api/v1/listen/sessions/{id}/refresh", "post", 200, refreshed.json);
    const md = await client.get(`/api/v1/listen/sessions/${id}/export?format=markdown`);
    expect(md.status).toBe(200);
    expect(String(md.text)).toContain("# Conversation");
    const ended = await client.request("DELETE", `/api/v1/listen/sessions/${id}`);
    check("/api/v1/listen/sessions/{id}", "delete", 200, ended.json);
    check(
      "/api/v1/admin/listen-sessions",
      "get",
      200,
      (await client.get("/api/v1/admin/listen-sessions", admin)).json,
    );
  });

  it("voice-answer (both paths)", async () => {
    const r = await client.post("/api/v1/voice-answer", {
      prospect: "progress",
      question: "What is binder jetting?",
    });
    check("/api/v1/voice-answer", "post", 200, r.json);
    const alias = await client.post("/v1/voice-answer", {
      prospect: "progress",
      question: "What is binder jetting?",
    });
    check("/v1/voice-answer", "post", 200, alias.json);
  });

  it("brief", async () => {
    const r = await client.post("/api/v1/brief", { prospect: "progress", text: "stainless steel batches" });
    check("/api/v1/brief", "post", 200, r.json);
  });

  it("prospects, models and metrics", async () => {
    check("/api/v1/prospects", "get", 200, (await client.get("/api/v1/prospects")).json);
    check("/api/v1/prospects/{key}", "get", 200, (await client.get("/api/v1/prospects/progress")).json);
    check("/api/v1/models", "get", 200, (await client.get("/api/v1/models?prospect=progress")).json);
    check("/api/v1/metrics", "get", 200, (await client.get("/api/v1/metrics")).json);
    check("/api/v1/integrations", "get", 200, (await client.get("/api/v1/integrations")).json);
    check(
      "/api/v1/voice-agent",
      "get",
      200,
      (await client.get("/api/v1/voice-agent?prospect=progress")).json,
    );
  });

  it("the ElevenLabs surfaces", async () => {
    // Synthesis mints nothing but does spend an upstream credential, so it is never anonymous.
    const anon = await client.post("/api/v1/speech", { text: "hello" });
    expect(anon.status).toBe(401);
    check("/api/v1/speech", "post", 401, anon.json);
    // Identified, but this deployment holds no ElevenLabs key: 503, the shape the toggle reads.
    const r = await client.post("/api/v1/speech", { text: "The Shop System suits mid-volume parts." }, admin);
    expect(r.status).toBe(503);
    check("/api/v1/speech", "post", 503, r.json);
    check("/api/v1/voice-agent", "get", 404, (await client.get("/api/v1/voice-agent?prospect=nope")).json);
  });

  it("the workspace surfaces: turn log, knowledge and golden history", async () => {
    await client.post("/api/v1/voice-answer", { prospect: "progress", question: "What is binder jetting?" });
    check("/api/v1/turns", "get", 200, (await client.get("/api/v1/turns", admin)).json);
    check(
      "/api/v1/turns",
      "get",
      200,
      (await client.get("/api/v1/turns?prospect=progress&outcome=handoff&limit=10&offset=0", admin)).json,
    );
    check("/api/v1/turns", "get", 401, (await client.get("/api/v1/turns")).json);
    check("/api/v1/knowledge", "get", 200, (await client.get("/api/v1/knowledge?prospect=progress")).json);
    check("/api/v1/golden-evals", "get", 200, (await client.get("/api/v1/golden-evals")).json);
  });

  it("jobs and golden evaluations", async () => {
    const created = await client.post("/api/v1/golden-evals", { prospect: "progress" });
    check("/api/v1/golden-evals", "post", 202, created.json);
    const jobId = (created.json as { job: { id: string } }).job.id;
    let status = "queued";
    for (let i = 0; i < 100 && !["succeeded", "failed", "cancelled"].includes(status); i++) {
      await new Promise((r) => setTimeout(r, 50));
      status = ((await client.get(`/api/v1/jobs/${jobId}`)).json as { status: string }).status;
    }
    check("/api/v1/jobs", "get", 200, (await client.get("/api/v1/jobs")).json);
    check("/api/v1/jobs/{id}", "get", 200, (await client.get(`/api/v1/jobs/${jobId}`)).json);
    check("/api/v1/golden-evals/{id}", "get", 200, (await client.get(`/api/v1/golden-evals/${jobId}`)).json);
  });

  it("admin surfaces", async () => {
    check("/api/v1/admin/health", "get", 200, (await client.get("/api/v1/admin/health", admin)).json);
    check("/api/v1/admin/config", "get", 200, (await client.get("/api/v1/admin/config", admin)).json);
    check("/api/v1/admin/usage", "get", 200, (await client.get("/api/v1/admin/usage", admin)).json);
    check("/api/v1/admin/logs", "get", 200, (await client.get("/api/v1/admin/logs", admin)).json);
    check("/api/v1/admin/prospects", "get", 200, (await client.get("/api/v1/admin/prospects", admin)).json);
    check(
      "/api/v1/admin/prospects/{key}",
      "get",
      200,
      (await client.get("/api/v1/admin/prospects/progress", admin)).json,
    );
  });

  it("problem responses match the Problem schema", async () => {
    const r = await client.post("/api/v1/voice-answer", { prospect: "progress" });
    check("/api/v1/voice-answer", "post", 400, r.json);
    const missing = await client.get("/api/v1/prospects/nope");
    check("/api/v1/prospects/{key}", "get", 404, missing.json);
    const unauth = await client.get("/api/v1/admin/usage");
    check("/api/v1/admin/usage", "get", 401, unauth.json);
  });
});
