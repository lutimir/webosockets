import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import { Redis } from "ioredis";
import postgres from "postgres";

import { createDb, type Db } from "./db/client.js";
import { type Env } from "./env.js";
import { healthzRoutes } from "./plugins/healthz.js";
import { realtimeRoutes } from "./plugins/realtime.js";

declare module "fastify" {
  interface FastifyInstance {
    env: Env;
    sql: postgres.Sql;
    db: Db;
    redis: Redis;
  }
}

export async function buildApp(env: Env): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === "test" ? "warn" : "info",
      ...(env.NODE_ENV === "development" ? { transport: { target: "pino-pretty" } } : {}),
    },
  });

  const sql = postgres(env.DATABASE_URL, { max: 10, connect_timeout: 5 });
  const redis = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: (times) => Math.min(times * 200, 2_000),
  });
  redis.on("error", (error) => app.log.warn({ err: error }, "redis connection error"));

  app.decorate("env", env);
  app.decorate("sql", sql);
  app.decorate("db", createDb(sql));
  app.decorate("redis", redis);

  app.addHook("onClose", async () => {
    await Promise.allSettled([sql.end({ timeout: 5 }), redis.quit()]);
  });

  await app.register(websocket, {
    options: { maxPayload: 64 * 1024 },
  });
  await app.register(healthzRoutes);
  await app.register(realtimeRoutes, { prefix: "/v1" });

  return app;
}
