/** Entrypoint: load env, build the app, listen, shut down cleanly. */
import { assertAragEnv, loadDotEnv, log, readEnv } from "../vendor/arag-platform/src/index.ts";
import { readVoiceEnv } from "./config.ts";
import { createProduct } from "./server.ts";

loadDotEnv();
const env = readEnv();
log.level = env.logLevel;
assertAragEnv(env);
const voice = readVoiceEnv();
const product = await createProduct(env, voice);
await product.app.listen();
log.info("product.started", {
  name: product.name,
  version: product.version,
  mock: env.arag.mock,
  port: env.port,
  prospects: product.deps.registry.size,
});

const shutdown = async () => {
  log.info("product.stopping");
  await product.close();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
