import { buildApp } from "./app.js";
import { loadEnv } from "./env.js";

const env = loadEnv();
const app = await buildApp(env);

let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, "shutting down: closing listeners and draining connections");

  // If graceful close hangs (stuck sockets, unreachable DB), force-exit.
  const forceExit = setTimeout(() => {
    app.log.error("graceful shutdown timed out, forcing exit");
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  try {
    await app.close();
    app.log.info("shutdown complete");
    process.exit(0);
  } catch (error) {
    app.log.error({ err: error }, "error during shutdown");
    process.exit(1);
  }
}

process.on("SIGTERM", (signal) => void shutdown(signal));
process.on("SIGINT", (signal) => void shutdown(signal));

try {
  await app.listen({ port: env.PORT, host: env.HOST });
} catch (error) {
  app.log.error({ err: error }, "failed to start server");
  process.exit(1);
}
