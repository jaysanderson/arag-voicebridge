/**
 * ask-bridge entrypoint. Validates config, loads the registry, starts Fastify.
 */

import { config, assertConfig } from "./config.ts";
import { loadRegistry } from "./registry.ts";
import { buildServer } from "./server.ts";
import { log } from "./logger.ts";

async function main(): Promise<void> {
  assertConfig();
  const reg = loadRegistry();
  log.info("registry.loaded", { prospects: Object.keys(reg) });

  const app = buildServer();
  await app.listen({ port: config.port, host: "0.0.0.0" });
  log.info("bridge.listening", {
    port: config.port,
    env: config.nodeEnv,
    arag_timeout_ms: config.aragTimeoutMs,
  });
}

main().catch((err) => {
  log.error("bridge.fatal", { message: (err as Error).message });
  process.exit(1);
});
