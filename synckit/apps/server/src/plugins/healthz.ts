import { type FastifyInstance } from "fastify";

type DependencyStatus = "ok" | "error";

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function healthzRoutes(app: FastifyInstance): void {
  app.get("/healthz", async (_request, reply) => {
    const [dbResult, redisResult] = await Promise.allSettled([
      withTimeout(app.sql`select 1`, 2_000),
      withTimeout(app.redis.ping(), 2_000),
    ]);

    const db: DependencyStatus = dbResult.status === "fulfilled" ? "ok" : "error";
    const redis: DependencyStatus = redisResult.status === "fulfilled" ? "ok" : "error";
    const healthy = db === "ok" && redis === "ok";

    if (!healthy) {
      app.log.error(
        {
          db: dbResult.status === "rejected" ? String(dbResult.reason) : "ok",
          redis: redisResult.status === "rejected" ? String(redisResult.reason) : "ok",
        },
        "health check failed",
      );
    }

    return reply
      .status(healthy ? 200 : 503)
      .send({ status: healthy ? "ok" : "degraded", db, redis });
  });
}
